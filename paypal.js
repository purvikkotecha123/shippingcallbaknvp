'use strict';

const axios = require('axios');
const qs    = require('qs');

const PAYPAL_NVP_ENDPOINT = 'https://api-3t.sandbox.paypal.com/nvp';
const PAYPAL_CHECKOUT_URL = 'https://www.sandbox.paypal.com/checkoutnow?token=';

/**
 * Send a raw NVP request to PayPal.
 * Returns a parsed key/value object from the response.
 */
async function nvpRequest(params) {
  const payload = {
    USER:      process.env.PAYPAL_API_USERNAME,
    PWD:       process.env.PAYPAL_API_PASSWORD,
    SIGNATURE: process.env.PAYPAL_API_SIGNATURE,
    VERSION:   '109.0',
    ...params,
  };

  console.log('\n─── NVP REQUEST ───');
  // Log everything except credentials
  const { USER, PWD, SIGNATURE, ...safePayload } = payload;
  console.log(JSON.stringify(safePayload, null, 2));

  const response = await axios.post(
    PAYPAL_NVP_ENDPOINT,
    qs.stringify(payload),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const result = qs.parse(response.data);

  console.log('\n─── NVP RESPONSE ───');
  console.log(JSON.stringify(result, null, 2));

  if (result.ACK !== 'Success' && result.ACK !== 'SuccessWithWarning') {
    // Collect ALL error messages PayPal returned
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
 * AMT rules (strictly enforced):
 *   AMT      = ITEMAMT + SHIPPINGAMT
 *   ITEMAMT  = sum of (L_AMTn * L_QTYn) for all line items
 *
 * Here: 1 x Widget Pro @ $20.00
 *   ITEMAMT     = $20.00
 *   SHIPPINGAMT = $5.00
 *   AMT         = $25.00
 */
async function setExpressCheckout({ returnUrl, cancelUrl, callbackUrl }) {
  const params = {
    METHOD: 'SetExpressCheckout',

    PAYMENTREQUEST_0_PAYMENTACTION: 'Sale',
    PAYMENTREQUEST_0_CURRENCYCODE:  'USD',
    PAYMENTREQUEST_0_AMT:           '25.00',  // Grand total = ITEMAMT + SHIPPINGAMT
    PAYMENTREQUEST_0_ITEMAMT:       '20.00',  // Must equal sum of line items below
    PAYMENTREQUEST_0_SHIPPINGAMT:   '5.00',   // Estimate; updated live via callback

    // 1 line item: 1 x $20.00 = $20.00 == ITEMAMT ✓
    L_PAYMENTREQUEST_0_NAME0:   'Widget Pro',
    L_PAYMENTREQUEST_0_NUMBER0: 'SKU-001',
    L_PAYMENTREQUEST_0_DESC0:   'Premium widget',
    L_PAYMENTREQUEST_0_AMT0:    '20.00',
    L_PAYMENTREQUEST_0_QTY0:    '1',

    RETURNURL:  returnUrl,
    CANCELURL:  cancelUrl,

    // ── Instant Update (Callback) ──
    CALLBACK:        callbackUrl,
    CALLBACKVERSION: '109.0',   // must be >= 61.0
    CALLBACKTIMEOUT: '6',

    // Fallback shipping option before callback fires
    L_SHIPPINGOPTIONNAME0:      'Standard',
    L_SHIPPINGOPTIONLABEL0:     'Standard (5-7 days)',
    L_SHIPPINGOPTIONAMOUNT0:    '5.00',
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
 * AMT must again equal ITEMAMT + SHIPPINGAMT exactly.
 */
async function doExpressCheckoutPayment({ token, payerId, shippingAmt }) {
  const shipping = parseFloat(shippingAmt || '5.00').toFixed(2);
  const total    = (20.00 + parseFloat(shipping)).toFixed(2);

  return nvpRequest({
    METHOD:  'DoExpressCheckoutPayment',
    TOKEN:   token,
    PAYERID: payerId,

    PAYMENTREQUEST_0_PAYMENTACTION: 'Sale',
    PAYMENTREQUEST_0_CURRENCYCODE:  'USD',
    PAYMENTREQUEST_0_AMT:           total,
    PAYMENTREQUEST_0_ITEMAMT:       '20.00',
    PAYMENTREQUEST_0_SHIPPINGAMT:   shipping,
  });
}

module.exports = { setExpressCheckout, getExpressCheckoutDetails, doExpressCheckoutPayment };
