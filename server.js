'use strict';

require('dotenv').config();

const express = require('express');
const qs      = require('qs');
const { setExpressCheckout, getExpressCheckoutDetails, doExpressCheckoutPayment } = require('./paypal');
const { calculateShippingOptions, buildCallbackResponse } = require('./shipping');

const app  = express();
const PORT = process.env.PORT || 3000;

// localtunnel bypass header
app.use((req, res, next) => {
  res.setHeader('bypass-tunnel-reminder', 'true');
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// HOME PAGE
// ─────────────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>EC Instant Update Demo</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; }
    .product { border: 1px solid #ddd; padding: 24px; border-radius: 8px; }
    .price   { font-size: 1.4em; color: #333; font-weight: bold; }
    .note    { font-size: 0.85em; color: #888; margin-top: 8px; }
    .btn     { display: inline-block; margin-top: 20px; padding: 12px 28px;
               background: #0070ba; color: white; border-radius: 6px;
               text-decoration: none; font-size: 1em; font-weight: bold; }
    .btn:hover { background: #005ea6; }
    .zips { background:#f5f5f5; padding:12px; border-radius:6px; font-size:0.85em; margin-top:16px; }
    .zips strong { display:block; margin-bottom:6px; }
    .supported { color: #34a853; }
    .unsupported { color: #ea4335; }
  </style>
</head>
<body>
  <h1>🛒 EC Instant Update – Pincode Check Demo</h1>
  <div class="product">
    <h2>Widget Pro</h2>
    <div class="price">$20.00 + shipping</div>
    <p class="note">
      When you change your shipping address on PayPal, the server checks
      if your <strong>pincode is serviceable</strong> and updates shipping options in real time.
    </p>
    <a class="btn" href="/checkout">Pay with PayPal</a>

    <div class="zips">
      <strong>Test with these sandbox addresses:</strong>
      <span class="supported">✅ Supported zips:</span>
      10001 (NY), 90001 (LA), 60601 (Chicago), 94102 (SF), 95101 (San Jose), 98101 (Seattle)
      <br><br>
      <span class="unsupported">❌ Not supported (any other zip)</span>
      e.g. 33101 (Miami), 70112 (New Orleans), 99501 (Anchorage)
    </div>
  </div>
</body>
</html>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — SetExpressCheckout → redirect to PayPal
// ─────────────────────────────────────────────────────────────────────────────
app.get('/checkout', async (req, res) => {
  const base = process.env.BASE_URL;
  try {
    const { token, redirectUrl } = await setExpressCheckout({
      returnUrl:   `${base}/return`,
      cancelUrl:   `${base}/cancel`,
      callbackUrl: `${base}/callback`,
    });
    console.log(`[SetExpressCheckout] TOKEN=${token}`);
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('[SetExpressCheckout] ERROR:', err.message);
    res.status(500).send(`<h2>Error starting checkout</h2><pre>${err.message}</pre>`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Instant Update Callback (PayPal → your server)
//
// PayPal POSTs the buyer's shipping address here when they change it.
// We check if the pincode (SHIPTOZIP) is serviceable:
//   → YES: respond with shipping options (PayPal shows them in dropdown)
//   → NO:  respond with NO_SHIPPING_OPTION_DETAILS=1 (PayPal blocks that address)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/callback', (req, res) => {
  const body = req.body;

  const zip     = body.SHIPTOZIP     || '';
  const state   = body.SHIPTOSTATE   || '';
  const country = body.SHIPTOCOUNTRY || '';
  const city    = body.SHIPTOCITY    || '';

  console.log('\n🔔 ─── Instant Update Callback ───');
  console.log(`   Token   : ${body.TOKEN}`);
  console.log(`   Address : ${city}, ${state} ${zip}, ${country}`);

  // Calculate shipping — returns { supported, options? }
  const result   = calculateShippingOptions(body);
  const nvpReply = buildCallbackResponse(result, body.CURRENCYCODE || 'USD');

  if (result.supported) {
    console.log(`   ✅ Delivery SUPPORTED for zip: ${zip}`);
    result.options.forEach(o =>
      console.log(`      ${o.name}: $${o.amount} (default=${o.isDefault})`)
    );
  } else {
    console.log(`   ❌ Delivery NOT SUPPORTED for zip: ${zip}`);
    console.log(`      PayPal will block checkout for this address`);
  }

  res.setHeader('Content-Type', 'application/x-www-form-urlencoded');
  res.send(nvpReply);
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Return URL: capture payment
// ─────────────────────────────────────────────────────────────────────────────
app.get('/return', async (req, res) => {
  const { token, PayerID } = req.query;

  if (!token || !PayerID) {
    return res.status(400).send('<h2>Missing token or PayerID</h2>');
  }

  try {
    const details     = await getExpressCheckoutDetails(token);
    const shippingAmt = details.PAYMENTREQUEST_0_SHIPPINGAMT || '5.00';
    const zip         = details.SHIPTOZIP     || '';
    const country     = details.SHIPTOCOUNTRY || 'US';

    console.log('\n─── GetExpressCheckoutDetails ───');
    console.log('Payer    :', details.EMAIL);
    console.log('Zip      :', zip);
    console.log('Country  :', country);
    console.log('Shipping :', shippingAmt);

    // SERVER-SIDE PINCODE ENFORCEMENT
    // The callback warning is just UX — this is the real gate.
    // Even if the buyer clicked Continue despite the warning, we block here.
    const { isZipServiceable } = require('./shipping');
    if (!isZipServiceable(zip, country)) {
      console.log('\n🚫 BLOCKED: zip ' + zip + ' is not serviceable — payment rejected');
      return res.status(400).send(`<!DOCTYPE html>
<html lang=en>
<head>
  <meta charset=UTF-8><title>Delivery Not Available</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 60px auto; padding: 0 20px; }
    .error { background: #fce8e6; border: 1px solid #ea4335; padding: 24px; border-radius: 8px; }
    .error h1 { color: #c5221f; }
    .btn { display:inline-block; margin-top:16px; padding:10px 24px;
           background:#0070ba; color:white; border-radius:6px; text-decoration:none; }
  </style>
</head>
<body>
  <div class=error>
    <h1>🚫 Delivery Not Available</h1>
    <p>Sorry, we are unable to deliver to zip code <strong>${zip}</strong>.</p>
    <p>Your payment has <strong>not</strong> been charged.</p>
    <p>Please go back and use a supported delivery address.</p>
    <a class=btn href=/>← Back to shop</a>
  </div>
</body>
</html>`);
    }

    const payment = await doExpressCheckoutPayment({ token, payerId: PayerID, shippingAmt });

    console.log('\n─── DoExpressCheckoutPayment ───');
    console.log('Transaction:', payment.PAYMENTINFO_0_TRANSACTIONID);
    console.log('Status     :', payment.PAYMENTINFO_0_PAYMENTSTATUS);

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><title>Payment Complete</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 60px auto; padding: 0 20px; }
    .success { background: #e6f4ea; border: 1px solid #34a853; padding: 24px; border-radius: 8px; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="success">
    <h1>✅ Payment Successful!</h1>
    <p><strong>Transaction ID:</strong> <code>${payment.PAYMENTINFO_0_TRANSACTIONID}</code></p>
    <p><strong>Status:</strong> ${payment.PAYMENTINFO_0_PAYMENTSTATUS}</p>
    <p><strong>Amount charged:</strong> $${payment.PAYMENTINFO_0_AMT} ${payment.PAYMENTINFO_0_CURRENCYCODE}</p>
    <p><strong>Delivered to zip:</strong> ${details.SHIPTOZIP}</p>
    <p><strong>Shipping:</strong> $${shippingAmt}</p>
    <p><strong>Buyer:</strong> ${details.EMAIL}</p>
  </div>
  <p><a href="/">← Back to shop</a></p>
</body>
</html>`);
  } catch (err) {
    console.error('[Return] ERROR:', err.message);
    res.status(500).send(`<h2>Payment failed</h2><pre>${err.message}</pre>`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL
// ─────────────────────────────────────────────────────────────────────────────
app.get('/cancel', (req, res) => {
  res.send(`<h1>❌ Cancelled</h1><p><a href="/">← Back</a></p>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Server: http://localhost:${PORT}`);
  console.log(`   Callback: ${process.env.BASE_URL}/callback`);
  console.log(`\n   Supported zips: 10001, 90001, 60601, 94102, 95101, 98101`);
  console.log(`   All other zips → delivery blocked\n`);
});
