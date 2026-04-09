'use strict';

const axios = require('axios');
const qs = require('qs');

// PayPal sandbox NVP endpoint
const PAYPAL_NVP_ENDPOINT = 'https://api-3t.sandbox.paypal.com/nvp';
const PAYPAL_CHECKOUT_URL = 'https://www.sandbox.paypal.com/checkoutnow?token=';

/**
 * Send a raw NVP request to PayPal.
 * Returns a parsed key/value object from the response.
 */
async function nvpRequest(params) {
  const payload = {
    USER: process.env.PAYPAL_API_USERNAME,
    PWD: process.env.PAYPAL_API_PASSWORD,
    SIGNATURE: process.env.PAYPAL_API_SIGNATURE,
    VERSION: '204.0',
    ...params,
  };

  const response = await axios.post(
    PAYPAL_NVP_ENDPOINT,
    qs.stringify(payload),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const result = qs.parse(response.data);
  if (result.ACK !== 'Success' && result.ACK !== 'SuccessWithWarning') {
    const errMsg = result.L_LONGMESSAGE0 || result.L_SHORTMESSAGE0 || 'Unknown PayPal error';
    throw new Error(`PayPal NVP error [${result.ACK}]: ${errMsg}`);
  }
  return result;
}

/**
 * Step 1 – SetExpressCheckout
 *
 * Registers the transaction with PayPal and returns a TOKEN.
 * The key Instant Update parameters are:
 *   CALLBACK      – URL PayPal will POST to when buyer changes shipping address
 *   CALLBACKVERSION – must be >= 61.0
 *   L_SHIPPINGOPTIONISDEFAULT0 – marks the default shipping option shown before callback fires
 */
async function setExpressCheckout({ returnUrl, cancelUrl, callbackUrl }) {
  const params = {
    METHOD: 'SetExpressCheckout',

    // ----- Core payment fields -----
    PAYMENTREQUEST_0_AMT: '25.00',        // Subtotal (before shipping/tax)
    PAYMENTREQUEST_0_ITEMAMT: '20.00',    // Must equal sum of line items
    PAYMENTREQUEST_0_SHIPPINGAMT: '5.00', // Initial shipping estimate
    PAYMENTREQUEST_0_TAXAMT: '0.00',
    PAYMENTREQUEST_0_CURRENCYCODE: 'USD',
    PAYMENTREQUEST_0_PAYMENTACTION: 'Sale',

    // ----- Line items -----
    L_PAYMENTREQUEST_0_NAME0: 'Widget Pro',
    L_PAYMENTREQUEST_0_NUMBER0: 'SKU-001',
    L_PAYMENTREQUEST_0_DESC0: 'Premium widget with all the bells',
    L_PAYMENTREQUEST_0_AMT0: '10.00',
    L_PAYMENTREQUEST_0_QTY0: '2',

    // ----- Return / cancel URLs -----
    RETURNURL: returnUrl,
    CANCELURL: cancelUrl,

    // ----- Instant Update (Callback) fields -----
    CALLBACK: callbackUrl,           // PayPal will POST shipping address here
    CALLBACKVERSION: '204.0',        // Must be >= 61.0
    CALLBACKTIMEOUT: '6',            // Seconds PayPal waits for your callback response

    // Initial (fallback) flat-rate shipping option shown before callback fires
    L_SHIPPINGOPTIONISDEFAULT0: 'true',
    L_SHIPPINGOPTIONNAME0: 'Standard',
    L_SHIPPINGOPTIONLABEL0: 'Standard (5–7 days)',
    L_SHIPPINGOPTIONAMOUNT0: '5.00',
  };

  const result = await nvpRequest(params);
  return {
    token: result.TOKEN,
    redirectUrl: `${PAYPAL_CHECKOUT_URL}${result.TOKEN}`,
  };
}

/**
 * Step 3 – GetExpressCheckoutDetails
 * Called after buyer returns from PayPal to fetch their chosen info.
 */
async function getExpressCheckoutDetails(token) {
  return nvpRequest({ METHOD: 'GetExpressCheckoutDetails', TOKEN: token });
}

/**
 * Step 4 – DoExpressCheckoutPayment
 * Actually charges the buyer.
 */
async function doExpressCheckoutPayment({ token, payerId, shippingAmt }) {
  return nvpRequest({
    METHOD: 'DoExpressCheckoutPayment',
    TOKEN: token,
    PAYERID: payerId,
    PAYMENTREQUEST_0_AMT: (20.00 + parseFloat(shippingAmt || '5.00')).toFixed(2),
    PAYMENTREQUEST_0_ITEMAMT: '20.00',
    PAYMENTREQUEST_0_SHIPPINGAMT: shippingAmt || '5.00',
    PAYMENTREQUEST_0_TAXAMT: '0.00',
    PAYMENTREQUEST_0_CURRENCYCODE: 'USD',
    PAYMENTREQUEST_0_PAYMENTACTION: 'Sale',
  });
}

module.exports = { setExpressCheckout, getExpressCheckoutDetails, doExpressCheckoutPayment };
