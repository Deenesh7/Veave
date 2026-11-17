const Razorpay = require('razorpay');

let instance = null;

/** True only when real keys are set (the placeholder values from the example env file do not count). */
const isConfigured = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  return Boolean(keyId && keySecret && keyId !== 'rzp_test_YourKeyIdHere' && keySecret !== 'YourSecretHere');
};

const client = () => {
  if (!instance && isConfigured()) instance = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
  return instance;
};

module.exports = { isConfigured, client };
