const express = require('express');
const router = express.Router();
const customFontController = require('../controllers/customFontController');
const auth = require('../middleware/auth');

router.use(auth.optionalAuth);

router.get('/', customFontController.getFonts);
router.post('/', customFontController.createFont);
router.delete('/:id', customFontController.deleteFont);

module.exports = router;
