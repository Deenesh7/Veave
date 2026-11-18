const CustomFont = require('../models/CustomFont');

// @desc    Get all custom imported fonts
// @route   GET /api/custom-fonts
// @access  Public / Optional Auth
exports.getFonts = async (req, res, next) => {
  try {
    // Guests only see shared (ownerless) fonts; accounts see their own plus the shared ones.
    const query = req.user ? { $or: [{ userId: req.user.id }, { userId: null }] } : { userId: null };
    const fonts = await CustomFont.find(query).sort({ createdAt: -1 }).limit(500).lean();

    res.status(200).json({
      success: true,
      count: fonts.length,
      data: fonts
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Store a newly imported custom font
// @route   POST /api/custom-fonts
// @access  Public / Optional Auth
exports.createFont = async (req, res, next) => {
  try {
    const { name, family, category, url, source } = req.body;

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Font name is required' });
    }

    const trimmedName = name.trim();
    const cleanFamily = typeof family === 'string' && family.trim() ? family.trim() : `'${trimmedName}', sans-serif`;

    const query = {
      name: { $regex: new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    };
    query.userId = req.user ? req.user.id : null;

    // Check if already exists
    let font = await CustomFont.findOne(query);

    if (font) {
      // Update existing
      font.family = cleanFamily;
      if (url) font.url = url;
      if (category) font.category = category;
      await font.save();
    } else {
      font = await CustomFont.create({
        userId: req.user ? req.user.id : null,
        name: trimmedName,
        family: cleanFamily,
        category: category || 'Imported',
        url: url || '',
        source: source || 'google'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Custom font saved successfully',
      data: font
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a custom font
// @route   DELETE /api/custom-fonts/:id
// @access  Public / Optional Auth
exports.deleteFont = async (req, res, next) => {
  try {
    const { id } = req.params;
    // Only the owner can delete a font; shared (ownerless) fonts are never deletable through the API.
    if (!req.user) return res.status(401).json({ success: false, error: 'Log in to remove fonts' });
    const query = { _id: id, userId: req.user.id };

    const font = await CustomFont.findOneAndDelete(query);
    if (!font) {
      return res.status(404).json({ success: false, error: 'Custom font not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Custom font removed successfully',
      data: {}
    });
  } catch (error) {
    next(error);
  }
};
