const ThemePalette = require('../models/ThemePalette');

// @desc    Get all theme palettes for current user or default palettes
// @route   GET /api/theme-palettes
// @access  Public / Optional Auth
exports.getPalettes = async (req, res, next) => {
  try {
    const query = req.user ? { $or: [{ userId: req.user.id }, { userId: null }] } : {};
    let palettes = await ThemePalette.find(query).sort({ isDefault: -1, createdAt: -1 });

    // If no palettes exist yet, automatically seed the initial modern palette
    if (palettes.length === 0) {
      const initialPalette = await ThemePalette.create({
        userId: req.user ? req.user.id : null,
        name: 'Veave Neutral Modern',
        description: 'Default high-contrast minimalist palette with crisp slate borders and clean typography.',
        colors: {
          primary: '#18181B',
          secondary: '#71717A',
          background: '#F8F9FA',
          foreground: '#111827',
          accent: '#27272A',
          border: '#E2E5E8',
          card: '#FFFFFF',
          muted: '#F1F5F9'
        },
        typography: {
          headingFont: 'Inter',
          bodyFont: 'Inter',
          monoFont: 'JetBrains Mono',
          scale: 'modern',
          headingWeight: '700'
        },
        radius: {
          button: '8px',
          card: '14px',
          container: '18px',
          preset: 'modern'
        },
        geometry: {
          density: 'standard',
          borderWidth: '1px',
          shadow: 'subtle'
        },
        isDefault: true,
        tags: ['Default', 'Neutral', 'Clean']
      });

      const bluePurplePalette = await ThemePalette.create({
        userId: req.user ? req.user.id : null,
        name: 'Veave Blue & Purple',
        description: 'Theme palette in refined shades of blue and purple.',
        colors: {
          primary: '#4F46E5',
          secondary: '#7C3AED',
          background: '#F8F9FA',
          foreground: '#111827',
          accent: '#2563EB',
          border: '#E2E5E8',
          card: '#FFFFFF',
          muted: '#F1F5F9'
        },
        typography: {
          headingFont: 'Inter',
          bodyFont: 'Inter',
          monoFont: 'JetBrains Mono',
          scale: 'modern',
          headingWeight: '700'
        },
        radius: {
          button: '8px',
          card: '14px',
          container: '18px',
          preset: 'modern'
        },
        geometry: {
          density: 'standard',
          borderWidth: '1px',
          shadow: 'subtle'
        },
        isDefault: false,
        tags: ['Theme', 'Blue', 'Purple']
      });

      palettes = [initialPalette, bluePurplePalette];
    }

    res.status(200).json({
      success: true,
      count: palettes.length,
      data: palettes
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a single theme palette by ID
// @route   GET /api/theme-palettes/:id
// @access  Public / Optional Auth
exports.getPalette = async (req, res, next) => {
  try {
    const query = { _id: req.params.id };
    if (req.user) {
      query.$or = [{ userId: req.user.id }, { userId: null }];
    }

    const palette = await ThemePalette.findOne(query);
    if (!palette) {
      return res.status(404).json({ success: false, error: 'Theme palette not found' });
    }

    res.status(200).json({ success: true, data: palette });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a new theme palette
// @route   POST /api/theme-palettes
// @access  Public / Optional Auth
exports.createPalette = async (req, res, next) => {
  try {
    const { name, description, colors, typography, radius, geometry, isDefault, tags } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Theme palette name is required' });
    }

    if (isDefault) {
      const filter = req.user ? { userId: req.user.id } : {};
      await ThemePalette.updateMany(filter, { isDefault: false });
    }

    const palette = await ThemePalette.create({
      userId: req.user ? req.user.id : null,
      name: name.trim(),
      description: (description || '').trim(),
      colors: {
        primary: colors?.primary || '#3B9FE8',
        secondary: colors?.secondary || '#64748B',
        background: colors?.background || '#F8F9FA',
        foreground: colors?.foreground || '#111827',
        accent: colors?.accent || '#0EA5E9',
        border: colors?.border || '#E2E5E8',
        card: colors?.card || '#FFFFFF',
        muted: colors?.muted || '#F1F5F9'
      },
      typography: {
        headingFont: typography?.headingFont || 'Inter',
        bodyFont: typography?.bodyFont || 'Inter',
        monoFont: typography?.monoFont || 'JetBrains Mono',
        scale: typography?.scale || 'modern',
        headingWeight: typography?.headingWeight || '700'
      },
      radius: {
        button: radius?.button || '8px',
        card: radius?.card || '14px',
        container: radius?.container || '18px',
        preset: radius?.preset || 'modern'
      },
      geometry: {
        density: geometry?.density || 'standard',
        borderWidth: geometry?.borderWidth || '1px',
        shadow: geometry?.shadow || 'subtle'
      },
      isDefault: Boolean(isDefault),
      tags: Array.isArray(tags) ? tags : []
    });

    res.status(201).json({
      success: true,
      message: 'Theme palette created successfully',
      data: palette
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update an existing theme palette
// @route   PUT /api/theme-palettes/:id
// @access  Public / Optional Auth
exports.updatePalette = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, colors, typography, radius, geometry, isDefault, tags } = req.body;

    const query = { _id: id };
    if (req.user) {
      query.$or = [{ userId: req.user.id }, { userId: null }];
    }

    if (isDefault) {
      const filter = req.user ? { userId: req.user.id } : {};
      await ThemePalette.updateMany(filter, { isDefault: false });
    }

    const updateFields = {};
    if (name) updateFields.name = name.trim();
    if (description !== undefined) updateFields.description = description.trim();
    if (colors) updateFields.colors = colors;
    if (typography) updateFields.typography = typography;
    if (radius) updateFields.radius = radius;
    if (geometry) updateFields.geometry = geometry;
    if (isDefault !== undefined) updateFields.isDefault = Boolean(isDefault);
    if (tags !== undefined) updateFields.tags = tags;

    const palette = await ThemePalette.findOneAndUpdate(
      query,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!palette) {
      return res.status(404).json({ success: false, error: 'Theme palette not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Theme palette updated successfully',
      data: palette
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a theme palette
// @route   DELETE /api/theme-palettes/:id
// @access  Public / Optional Auth
exports.deletePalette = async (req, res, next) => {
  try {
    const { id } = req.params;
    const query = { _id: id };
    if (req.user) {
      query.$or = [{ userId: req.user.id }, { userId: null }];
    }

    const palette = await ThemePalette.findOneAndDelete(query);
    if (!palette) {
      return res.status(404).json({ success: false, error: 'Theme palette not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Theme palette removed successfully',
      data: {}
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Set a theme palette as active default
// @route   PATCH /api/theme-palettes/:id/default
// @access  Public / Optional Auth
exports.setDefaultPalette = async (req, res, next) => {
  try {
    const { id } = req.params;
    const filter = req.user ? { userId: req.user.id } : {};
    await ThemePalette.updateMany(filter, { isDefault: false });

    const query = { _id: id };
    if (req.user) {
      query.$or = [{ userId: req.user.id }, { userId: null }];
    }

    const palette = await ThemePalette.findOneAndUpdate(
      query,
      { $set: { isDefault: true } },
      { new: true }
    );

    if (!palette) {
      return res.status(404).json({ success: false, error: 'Theme palette not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Active theme palette updated',
      data: palette
    });
  } catch (error) {
    next(error);
  }
};
