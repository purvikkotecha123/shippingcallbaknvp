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
 * Step 1 - SetExpressCheckout
 *
 * AMT rule (strictly enforced by PayPal):
 *   AMT = ITEMAMT + SHIPPINGAMT
 *   ITEMAMT must equal the exact sum of (L_AMTn * L_QTYn) for all line items
 *
 * Example here:
 *   1 x Widget Pro @ $20.00  => ITEMAMT = $20.00
 *   Shipping estimate         => SHIPPINGAMT = $5.00
 *   Grand total               => AMT = $25.00
 */
async function setExpressCheckout({ returnUrl, cancelUrl, callbackUrl }) {
  const ITEM_AMT     = '20.00';
  const SHIPPING_AMT = '5.00';
  const TOTAL_AMT    = '25.00'; // must equal ITEM_AMT + SHIPPING_AMT

  const params = {
    METHOD: 'SetExpressCheckout',

    // Grand total — must equal ITEMAMT + SHIPPINGAMT
    PAYMENTREQUEST_0_AMT:           TOTAL_AMT,
    PAYMENTREQUEST_0_CURRENCYCODE:  'USD',
    PAYMENTREQUEST_0_PAYMENTACTION: 'Sale',

    // Breakdown — ITEMAMT + SHIPPINGAMT must equal AMT exactly
    PAYMENTREQUEST_0_ITEMAMT:     ITEM_AMT,
    PAYMENTREQUEST_0_SHIPPINGAMT: SHIPPING_AMT,

    // Line items — (L_AMT0 * L_QTY0) must equal ITEMAMT exactly
    // 1 x $20.00 = $20.00 ✓
    L_PAYMENTREQUEST_0_NAME0:   'Widget Pro',
    L_PAYMENTREQUEST_0_NUMBER0: 'SKU-001',
    L_PAYMENTREQUEST_0_DESC0:   'Premium widget with all the bells',
    L_PAYMENTREQUEST_0_AMT0:    '20.00',
    L_PAYMENTREQUEST_0_QTY0:    '1',

    RETURNURL:  returnUrl,
    CANCELURL:  cancelUrl,

    // Instant Update / Callback fields
    CALLBACK:        callbackUrl,
    CALLBACKVERSION: '109.0',  // must be >= 61.0
    CALLBACKTIMEOUT: '6',

    // Fallback shipping option shown before callback fires
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
 * Fetch buyer info and chosen shipping after they return from PayPal.
 */
async function getExpressCheckoutDetails(token) {
  return nvpRequest({ METHOD: 'GetExpressCheckoutDetails', TOKEN: token });
}

/**
 * Step 3 - DoExpressCheckoutPayment
 * Capture the payment. AMT must again equal ITEMAMT + SHIPPINGAMT.
 */
async function doExpressCheckoutPayment({ token, payerId, shippingAmt }) {
  const shipping = parseFloat(shippingAmt || '5.00').toFixed(2);
  const total    = (20.00 + parseFloat(shipping)).toFixed(2);

  return nvpRequest({
    METHOD:   'DoExpressCheckoutPayment',
    TOKEN:    token,
    PAYERID:  payerId,

    PAYMENTREQUEST_0_AMT:           total,
    PAYMENTREQUEST_0_CURRENCYCODE:  'USD',
    PAYMENTREQUEST_0_PAYMENTACTION: 'Sale',
    PAYMENTREQUEST_0_ITEMAMT:       '20.00',
    PAYMENTREQUEST_0_SHIPPINGAMT:   shipping,
  });
}

module.exports = { setExpressCheckout, getExpressCheckoutDetails, doExpressCheckoutPayment };
