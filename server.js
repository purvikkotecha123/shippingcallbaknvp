'use strict';

require('dotenv').config();

const express = require('express');
const qs      = require('qs');
const { setExpressCheckout, getExpressCheckoutDetails, doExpressCheckoutPayment } = require('./paypal');
const { calculateShippingOptions, buildCallbackResponse } = require('./shipping');

const app  = express();
const PORT = process.env.PORT || 3000;

// Parse both JSON and URL-encoded bodies
// PayPal sends the Instant Update callback as application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// HOME PAGE – simple product & "Pay with PayPal" button
// ─────────────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>EC Instant Update Demo</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 60px auto; padding: 0 20px; }
    .product { border: 1px solid #ddd; padding: 24px; border-radius: 8px; }
    .price   { font-size: 1.4em; color: #333; font-weight: bold; }
    .note    { font-size: 0.85em; color: #888; margin-top: 8px; }
    .btn     { display: inline-block; margin-top: 20px; padding: 12px 28px;
               background: #0070ba; color: white; border-radius: 6px;
               text-decoration: none; font-size: 1em; font-weight: bold; }
    .btn:hover { background: #005ea6; }
  </style>
</head>
<body>
  <h1>🛒 EC Instant Update API Demo</h1>
  <div class="product">
    <h2>Widget Pro (×2)</h2>
    <div class="price">$20.00 + shipping</div>
    <p class="note">
      Shipping options are calculated in real time from your PayPal address
      via the <strong>Instant Update (Callback) API</strong>.
    </p>
    <a class="btn" href="/checkout">Pay with PayPal</a>
  </div>
  <hr>
  <p class="note">
    <strong>How it works:</strong><br>
    1. Click "Pay with PayPal" → <code>SetExpressCheckout</code> is called with <code>CALLBACK</code> set to <code>/callback</code>.<br>
    2. On the PayPal review page, when the buyer changes their shipping address, PayPal POSTs to <code>/callback</code>.<br>
    3. The server calculates shipping options for that address and responds with <code>CallbackResponse</code> NVP data.<br>
    4. PayPal updates the shipping drop-down live without a page reload.<br>
    5. After buyer confirms, they return to <code>/return</code> where <code>DoExpressCheckoutPayment</code> is called.
  </p>
</body>
</html>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 – Start checkout: call SetExpressCheckout, redirect to PayPal
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
    console.log(`[SetExpressCheckout] Redirecting buyer to: ${redirectUrl}`);
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('[SetExpressCheckout] ERROR:', err.message);
    res.status(500).send(`<h2>Error starting checkout</h2><pre>${err.message}</pre>`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 – Instant Update Callback (PayPal → your server)
//
// PayPal POSTs here whenever the buyer changes their shipping address on the
// PayPal review page.  You must respond within CALLBACKTIMEOUT seconds with
// CallbackResponse NVP data.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/callback', (req, res) => {
  const body = req.body; // already parsed by express.urlencoded

  console.log('\n─── Instant Update Callback received ───');
  console.log('TOKEN    :', body.TOKEN);
  console.log('Address  :', {
    street:  body.SHIPTOSTREET,
    city:    body.SHIPTOCITY,
    state:   body.SHIPTOSTATE,
    zip:     body.SHIPTOZIP,
    country: body.SHIPTOCOUNTRY,
  });

  // Calculate shipping options for this address
  const options  = calculateShippingOptions(body);
  const nvpReply = buildCallbackResponse(options, body.CURRENCYCODE || 'USD');

  console.log('Shipping options returned:');
  options.forEach(o => console.log(`  ${o.name}: $${o.amount} (default=${o.isDefault})`));

  // Respond with NVP-encoded CallbackResponse
  res.setHeader('Content-Type', 'application/x-www-form-urlencoded');
  res.send(nvpReply);
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 – Return URL: buyer approved on PayPal, now capture payment
// ─────────────────────────────────────────────────────────────────────────────
app.get('/return', async (req, res) => {
  const { token, PayerID } = req.query;

  if (!token || !PayerID) {
    return res.status(400).send('<h2>Missing token or PayerID</h2>');
  }

  try {
    // Fetch buyer details & chosen shipping option
    const details = await getExpressCheckoutDetails(token);
    console.log('\n─── GetExpressCheckoutDetails ───');
    console.log('Payer    :', details.EMAIL);
    console.log('Ship to  :', details.SHIPTONAME, details.SHIPTOSTREET, details.SHIPTOCITY);
    console.log('Shipping :', details.PAYMENTREQUEST_0_SHIPPINGAMT);

    const shippingAmt = details.PAYMENTREQUEST_0_SHIPPINGAMT || '5.00';

    // Complete the payment
    const payment = await doExpressCheckoutPayment({ token, payerId: PayerID, shippingAmt });
    console.log('\n─── DoExpressCheckoutPayment ───');
    console.log('ACK         :', payment.ACK);
    console.log('Transaction :', payment.PAYMENTINFO_0_TRANSACTIONID);
    console.log('Status      :', payment.PAYMENTINFO_0_PAYMENTSTATUS);

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Payment Complete</title>
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
    <p><strong>Shipping used:</strong> $${shippingAmt}</p>
    <p><strong>Buyer email:</strong> ${details.EMAIL}</p>
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
// CANCEL URL – buyer clicked "Cancel" on the PayPal page
// ─────────────────────────────────────────────────────────────────────────────
app.get('/cancel', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Cancelled</title>
<style>body{font-family:Arial,sans-serif;max-width:600px;margin:60px auto;padding:0 20px}</style>
</head>
<body>
  <h1>❌ Payment Cancelled</h1>
  <p>You cancelled the PayPal checkout.</p>
  <p><a href="/">← Back to shop</a></p>
</body>
</html>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 EC Instant Update Demo running on http://localhost:${PORT}`);
  console.log(`   Callback URL PayPal will call: ${process.env.BASE_URL || '<BASE_URL not set>'}/callback`);
  console.log('   Make sure BASE_URL is publicly reachable (use ngrok for local dev)\n');
});
