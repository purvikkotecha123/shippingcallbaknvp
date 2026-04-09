'use strict';

/**
 * Calculate shipping options based on the buyer's shipping address.
 *
 * PayPal sends these NVP fields to your CALLBACK URL:
 *   SHIPTOSTREET, SHIPTOCITY, SHIPTOSTATE, SHIPTOZIP, SHIPTOCOUNTRY
 *
 * You respond with CallbackResponse NVP fields:
 *   METHOD=CallbackResponse
 *   CURRENCYCODE
 *   L_SHIPPINGOPTIONNAMEn   – internal key
 *   L_SHIPPINGOPTIONLABELn  – human-readable label
 *   L_SHIPPINGOPTIONAMOUNTn – cost
 *   L_SHIPPINGOPTIONISDEFAULTn – exactly one must be "true"
 *   L_TAXAMTn                – (optional) tax for that option
 *
 * This demo applies simple rules:
 *  - International → only "International Shipping" available
 *  - Domestic (US):
 *      • Hawaii / Alaska → add $5 surcharge
 *      • Continental US  → Standard, Expedited, Overnight
 */
function calculateShippingOptions(address) {
  const country = (address.SHIPTOCOUNTRY || 'US').toUpperCase();
  const state   = (address.SHIPTOSTATE   || '').toUpperCase();

  // ---- International ----
  if (country !== 'US') {
    return [
      { name: 'INT_STD', label: 'International Standard (10–14 days)', amount: '25.00', isDefault: true, tax: '0.00' },
    ];
  }

  // ---- Remote US states ----
  if (['HI', 'AK'].includes(state)) {
    return [
      { name: 'REMOTE_STD',  label: 'Standard (7–10 days)',   amount: '12.00', isDefault: true,  tax: '0.00' },
      { name: 'REMOTE_EXP',  label: 'Expedited (3–5 days)',   amount: '22.00', isDefault: false, tax: '0.00' },
    ];
  }

  // ---- Continental US ----
  return [
    { name: 'STD',  label: 'Standard (5–7 days)',   amount: '5.00',  isDefault: true,  tax: '1.00' },
    { name: 'EXP',  label: 'Expedited (2–3 days)',  amount: '12.00', isDefault: false, tax: '1.00' },
    { name: 'NEXT', label: 'Overnight (next day)',  amount: '25.00', isDefault: false, tax: '1.00' },
  ];
}

/**
 * Build the NVP-encoded CallbackResponse string.
 * PayPal expects application/x-www-form-urlencoded.
 */
function buildCallbackResponse(options, currency = 'USD') {
  const pairs = {
    METHOD: 'CallbackResponse',
    CURRENCYCODE: currency,
  };

  options.forEach((opt, i) => {
    pairs[`L_SHIPPINGOPTIONNAME${i}`]      = opt.name;
    pairs[`L_SHIPPINGOPTIONLABEL${i}`]     = opt.label;
    pairs[`L_SHIPPINGOPTIONAMOUNT${i}`]    = opt.amount;
    pairs[`L_SHIPPINGOPTIONISDEFAULT${i}`] = opt.isDefault ? 'true' : 'false';
    if (opt.tax !== undefined) {
      pairs[`L_TAXAMT${i}`] = opt.tax;
    }
  });

  return new URLSearchParams(pairs).toString();
}

module.exports = { calculateShippingOptions, buildCallbackResponse };
