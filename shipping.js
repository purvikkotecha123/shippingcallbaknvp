'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// SERVICEABLE PINCODES / ZIP CODES
//
// Replace this with your real delivery coverage data.
// Can be loaded from a database, CSV, or external API in production.
// ─────────────────────────────────────────────────────────────────────────────
const SERVICEABLE_ZIPS = new Set([
  // Sample US zip codes that ARE supported
  '10001', // New York, NY
  '90001', // Los Angeles, CA
  '60601', // Chicago, IL
  '77001', // Houston, TX
  '85001', // Phoenix, AZ
  '19101', // Philadelphia, PA
  '78201', // San Antonio, TX
  '92101', // San Diego, CA
  '75201', // Dallas, TX
  '95101', // San Jose, CA
  '94102', // San Francisco, CA
  '98101', // Seattle, WA
  '80201', // Denver, CO
  '02101', // Boston, MA
  '30301', // Atlanta, GA
]);

// Countries we ship to at all
const SERVICEABLE_COUNTRIES = new Set(['US', 'GB', 'CA', 'AU']);

/**
 * Check if a given zip/pincode is serviceable.
 *
 * In production, replace this with:
 *   - A database lookup
 *   - An external logistics API call
 *   - A zip code range check
 */
function isZipServiceable(zip, country) {
  if (!zip) return false;

  // For non-US countries, check country-level support only
  if (country !== 'US') {
    return SERVICEABLE_COUNTRIES.has(country);
  }

  // For US, check exact zip code
  const cleanZip = zip.trim().substring(0, 5); // normalize to 5-digit zip
  return SERVICEABLE_ZIPS.has(cleanZip);
}

/**
 * Calculate shipping options based on buyer's address from PayPal callback.
 *
 * PayPal sends these NVP fields:
 *   SHIPTOSTREET, SHIPTOCITY, SHIPTOSTATE, SHIPTOZIP, SHIPTOCOUNTRY
 *
 * Returns:
 *   { supported: false }                    — pincode not serviceable
 *   { supported: true, options: [...] }     — with shipping options
 */
function calculateShippingOptions(address) {
  const country = (address.SHIPTOCOUNTRY || 'US').toUpperCase();
  const state   = (address.SHIPTOSTATE   || '').toUpperCase();
  const zip     = (address.SHIPTOZIP     || '').trim();

  console.log(`\n📦 Checking delivery for: zip=${zip}, state=${state}, country=${country}`);

  // Step 1: Check if we deliver to this pincode at all
  if (!isZipServiceable(zip, country)) {
    console.log(`❌ Delivery NOT supported for zip=${zip}, country=${country}`);
    return { supported: false };
  }

  console.log(`✅ Delivery supported for zip=${zip}, country=${country}`);

  // Step 2: Calculate rates based on location
  if (country !== 'US') {
    return {
      supported: true,
      options: [
        { name: 'INT_STD', label: 'International Standard (10-14 days)', amount: '25.00', isDefault: true,  tax: '0.00' },
        { name: 'INT_EXP', label: 'International Express (5-7 days)',    amount: '45.00', isDefault: false, tax: '0.00' },
      ],
    };
  }

  if (['HI', 'AK'].includes(state)) {
    return {
      supported: true,
      options: [
        { name: 'REMOTE_STD', label: 'Standard (7-10 days)',  amount: '12.00', isDefault: true,  tax: '0.00' },
        { name: 'REMOTE_EXP', label: 'Expedited (3-5 days)', amount: '22.00', isDefault: false, tax: '0.00' },
      ],
    };
  }

  // Continental US
  return {
    supported: true,
    options: [
      { name: 'STD',  label: 'Standard (5-7 days)',  amount: '5.00',  isDefault: true,  tax: '1.00' },
      { name: 'EXP',  label: 'Expedited (2-3 days)', amount: '12.00', isDefault: false, tax: '1.00' },
      { name: 'NEXT', label: 'Overnight (next day)', amount: '25.00', isDefault: false, tax: '1.00' },
    ],
  };
}

/**
 * Build the NVP-encoded CallbackResponse string.
 *
 * If not supported → respond with NO_SHIPPING_OPTION_DETAILS=1
 * PayPal will show an error to the buyer and block checkout for that address.
 *
 * If supported → respond with shipping options.
 */
function buildCallbackResponse(result, currency = 'USD') {
  // Delivery not supported for this pincode
  if (!result.supported) {
    const pairs = new URLSearchParams({
      METHOD:                   'CallbackResponse',
      NO_SHIPPING_OPTION_DETAILS: '1',
    });
    return pairs.toString();
  }

  // Delivery supported — return shipping options
  const pairs = {
    METHOD:       'CallbackResponse',
    CURRENCYCODE: currency,
  };

  result.options.forEach((opt, i) => {
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

module.exports = { calculateShippingOptions, buildCallbackResponse, isZipServiceable };
