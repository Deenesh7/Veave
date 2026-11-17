const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billingController');
const auth = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimiter');

// All billing routes require authentication
router.use(auth);

router.get('/', billingController.getOverview);
router.post('/change-plan', paymentLimiter, billingController.changePlan);
router.post('/create-order', paymentLimiter, billingController.createOrder);
router.post('/verify-payment', paymentLimiter, billingController.verifyPayment);
router.post('/credits/create-order', paymentLimiter, billingController.createCreditOrder);
router.post('/credits/verify-payment', paymentLimiter, billingController.verifyCreditPayment);
router.get('/invoices', billingController.getInvoices);

module.exports = router;
