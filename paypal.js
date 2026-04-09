'use strict';

const axios = require('axios');
const qs    = require('qs');

const PAYPAL_NVP_ENDPOINT = 'https://api-3t.sandbox.paypal.com/nvp';
const PAYPAL_CHECKOUT_URL = 'https://www.sandbox.paypal.com/checkoutnow?token=';
const NVP_VERSION         = '109.0';

// Order amounts
const ITEM_AMT     = '20.00';
const SHIPPING_AMT = '5.00';
const TOTAL_AMT    = '25.00'; // ITEM_AMT + SHIPPING_AMT

// MAXAMT must be >= TOTAL_AMT + highest possible shipping option amount
// PayPal adds all shipping option amounts to its internal max check (error 11832 if too low)
const MAX_AMT = '100.00';

async function nvpRequest(params) {
  const payload = {
    USER:      process.env.PAYPAL_API_USERNAME,
    PWD:       process.env.PAYPAL_API_PASSWORD,
    SIGNATURE: process.env.PAYPAL_API_SIGNATURE,
    VERSION:   NVP_VERSION,
    ...params,
  };

  console.log('\n─── NVP REQUEST ───');
  const { USER, PWD, SIGNATURE, ...safe } = payload;
  console.log(JSON.stringify(safe, null, 2));

  const response = await axios.post(
    PAYPAL_NVP_ENDPOINT,
    qs.stringify(payload),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const result = qs.parse(response.data);

  console.log('\n─── NVP RESPONSE ───');
  console.log(JSON.stringify(result, null, 2));

  if (result.ACK !== 'Success' && result.ACK !== 'SuccessWithWarning') {
    const errors = [];
    let i = 0;
    while (result[`L_ERRORCODE${i}`]) {
      errors.push(`[${result[`L_ERRORCODE${i}`]}] ${result[`L_LONGMESSAGE${i}`] || result[`L_SHORTMESSAGE${i}`]}`);
      i++;
    }
    throw new Error(`PayPal NVP error [${result.ACK}]:\n${errors.join('\n')}`);
  }
  return result;
}

/**
 * Step 1 - SetExpressCheckout
 *
 * Key rules:
 *   AMT      = ITEMAMT + SHIPPINGAMT
 *   ITEMAMT  = sum of (L_AMTn * L_QTYn)
 *   SHIPPINGAMT must equal L_SHIPPINGOPTIONAMOUNT0 (the default option)
 *   MAXAMT   must be >= AMT + sum of ALL shipping option amounts
 *            (PayPal internally adds option amounts to validate against MAXAMT)
 */
async function setExpressCheckout({ returnUrl, cancelUrl, callbackUrl }) {
  const params = {
    METHOD: 'SetExpressCheckout',

    PAYMENTREQUEST_0_PAYMENTACTION: 'Sale',
    PAYMENTREQUEST_0_CURRENCYCODE:  'USD',
    PAYMENTREQUEST_0_AMT:           TOTAL_AMT,   // 25.00
    PAYMENTREQUEST_0_ITEMAMT:       ITEM_AMT,    // 20.00
    PAYMENTREQUEST_0_SHIPPINGAMT:   SHIPPING_AMT, // 5.00 — must match default option below
    MAXAMT:                         MAX_AMT,      // must cover AMT + all shipping options

    // Line items — required when CALLBACK is set
    L_PAYMENTREQUEST_0_NAME0:   'Widget Pro',
    L_PAYMENTREQUEST_0_NUMBER0: 'SKU-001',
    L_PAYMENTREQUEST_0_DESC0:   'Premium widget',
    L_PAYMENTREQUEST_0_AMT0:    ITEM_AMT,        // 20.00 x 1 = ITEMAMT ✓
    L_PAYMENTREQUEST_0_QTY0:    '1',

    RETURNURL: returnUrl,
    CANCELURL: cancelUrl,

    // Instant Update callback
    CALLBACK:        callbackUrl,
    CALLBACKVERSION: NVP_VERSION,
    CALLBACKTIMEOUT: '6',

    // Default shipping option — amount must equal SHIPPINGAMT above
    L_SHIPPINGOPTIONNAME0:      'Standard',
    L_SHIPPINGOPTIONLABEL0:     'Standard (5-7 days)',
    L_SHIPPINGOPTIONAMOUNT0:    SHIPPING_AMT,    // 5.00
    L_SHIPPINGOPTIONISDEFAULT0: 'true',
  };

  const result = await nvpRequest(params);
  return {
    token:       result.TOKEN,
    redirectUrl: `${PAYPAL_CHECKOUT_URL}${result.TOKEN}`,
  };
}

/**
 * Step 2 - GetExpressCheckoutDetails
 */
async function getExpressCheckoutDetails(token) {
  return nvpRequest({ METHOD: 'GetExpressCheckoutDetails', TOKEN: token });
}

/**
 * Step 3 - DoExpressCheckoutPayment
 */
async function doExpressCheckoutPayment({ token, payerId, shippingAmt }) {
  const shipping = parseFloat(shippingAmt || SHIPPING_AMT).toFixed(2);
  const total    = (parseFloat(ITEM_AMT) + parseFloat(shipping)).toFixed(2);

  return nvpRequest({
    METHOD:  'DoExpressCheckoutPayment',
    TOKEN:   token,
    PAYERID: payerId,

    PAYMENTREQUEST_0_PAYMENTACTION: 'Sale',
    PAYMENTREQUEST_0_CURRENCYCODE:  'USD',
    PAYMENTREQUEST_0_AMT:           total,
    PAYMENTREQUEST_0_ITEMAMT:       ITEM_AMT,
    PAYMENTREQUEST_0_SHIPPINGAMT:   shipping,
  });
}

module.exports = { setExpressCheckout, getExpressCheckoutDetails, doExpressCheckoutPayment };
