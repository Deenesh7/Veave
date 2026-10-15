const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billingController');
const auth = require('../middleware/auth');

// All billing routes require authentication
router.use(auth);

router.get('/', billingController.getOverview);
router.post('/change-plan', billingController.changePlan);
router.post('/create-order', billingController.createOrder);
router.post('/verify-payment', billingController.verifyPayment);
router.get('/invoices', billingController.getInvoices);

module.exports = router;
