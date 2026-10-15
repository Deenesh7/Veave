const express = require('express');
const router = express.Router();
const themePaletteController = require('../controllers/themePaletteController');
const auth = require('../middleware/auth');

// Support optional auth so both logged-in users and guests can work seamlessly with theme palettes
router.use(auth.optionalAuth);

router.get('/', themePaletteController.getPalettes);
router.post('/', themePaletteController.createPalette);
router.get('/:id', themePaletteController.getPalette);
router.put('/:id', themePaletteController.updatePalette);
router.delete('/:id', themePaletteController.deletePalette);
router.patch('/:id/default', themePaletteController.setDefaultPalette);

module.exports = router;
