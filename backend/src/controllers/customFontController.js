const CustomFont = require('../models/CustomFont');

// @desc    Get all custom imported fonts
// @route   GET /api/custom-fonts
// @access  Public / Optional Auth
exports.getFonts = async (req, res, next) => {
  try {
    const query = req.user ? { $or: [{ userId: req.user.id }, { userId: null }] } : {};
    const fonts = await CustomFont.find(query).sort({ createdAt: -1 });

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

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Font name is required' });
    }

    const trimmedName = name.trim();
    const cleanFamily = family ? family.trim() : `'${trimmedName}', sans-serif`;

    const query = {
      name: { $regex: new RegExp(`^${trimmedName}$`, 'i') }
    };
    if (req.user) {
      query.$or = [{ userId: req.user.id }, { userId: null }];
    }

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
    const query = { _id: id };
    if (req.user) {
      query.$or = [{ userId: req.user.id }, { userId: null }];
    }

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
