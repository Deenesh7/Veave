const express = require('express');
const router = express.Router();
const templateController = require('../controllers/templateController');
const auth = require('../middleware/auth');

// Public templates are visible to guests; restricted ones need an account that has access.
router.use(auth.optionalAuth);

router.get('/', templateController.list);
router.get('/theme/library', templateController.themeLibrary);
router.get('/typography/library', templateController.themeLibrary);
router.get('/:id', templateController.detail);
router.get('/:id/preview', templateController.preview);
router.get('/:id/site-html', templateController.siteHtml);
router.post('/:id/theme-css', templateController.themeCss);
router.get('/:id/assets/*', templateController.asset);
router.post('/:id/select', templateController.select);

module.exports = router;
