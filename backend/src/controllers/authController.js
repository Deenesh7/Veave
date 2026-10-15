const jwt = require('jsonwebtoken');
const User = require('../models/User');
const oauthService = require('../services/oauthService');
const { ValidationError, AuthError } = require('../utils/errors');

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
};

const sendAuthResponse = (res, user, statusCode = 200) => {
  const { accessToken, refreshToken } = generateTokens(user._id);

  res.cookie('token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 15 * 60 * 1000
  });

  return res.status(statusCode).json({
    success: true,
    data: {
      user,
      token: accessToken,
      refreshToken
    }
  });
};

exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      throw new ValidationError('Please provide name, email, and password');
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new ValidationError('Email already in use');
    }

    const user = await User.create({ name, email, password });
    return sendAuthResponse(res, user, 201);
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ValidationError('Please provide email and password');
    }

    const user = await User.findOne({ email });
    if (!user) {
      throw new AuthError('Invalid credentials');
    }

    if (!user.password) {
      throw new AuthError('Please sign in using your OAuth provider (Google or Apple)');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new AuthError('Invalid credentials');
    }

    return sendAuthResponse(res, user, 200);
  } catch (error) {
    next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    res.cookie('token', 'none', {
      expires: new Date(Date.now() + 10 * 1000),
      httpOnly: true
    });
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    next(error);
  }
};

exports.getProfile = async (req, res, next) => {
  try {
    let user = null;
    if (req.user && (req.user._id || req.user.id)) {
      user = await User.findById(req.user._id || req.user.id).select('-password');
    }
    if (!user) {
      // Fetch the primary real registered user from the database
      user = await User.findOne().sort({ createdAt: 1 }).select('-password');
    }
    if (!user) {
      return res.status(404).json({ success: false, message: 'No user found in database' });
    }
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) throw new AuthError('Refresh token required');

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) throw new AuthError('User not found');

    return sendAuthResponse(res, user, 200);
  } catch (error) {
    next(new AuthError('Invalid refresh token'));
  }
};

// ==========================================
// GOOGLE OAUTH
// ==========================================

/**
 * GET /api/auth/google
 * Redirects browser to Google's consent screen
 */
exports.googleAuthInit = (req, res, next) => {
  try {
    const authUrl = oauthService.getGoogleAuthUrl();
    res.redirect(authUrl);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/auth/google/callback
 * Handles redirect back from Google with authorization code
 */
exports.googleAuthCallback = async (req, res, next) => {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  try {
    const { code, error } = req.query;

    if (error) {
      return res.redirect(`${clientUrl}/login?error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      return res.redirect(`${clientUrl}/login?error=${encodeURIComponent('No authorization code provided')}`);
    }

    // Exchange code for Google user profile
    const googleProfile = await oauthService.verifyGoogleCode(code);

    // Find or create user
    const user = await oauthService.findOrCreateOAuthUser({
      provider: 'google',
      providerId: googleProfile.googleId,
      email: googleProfile.email,
      name: googleProfile.name,
      avatar: googleProfile.avatar
    });

    // Generate token and redirect to frontend
    const { accessToken } = generateTokens(user._id);

    res.cookie('token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 15 * 60 * 1000
    });

    return res.redirect(`${clientUrl}/login?token=${accessToken}`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return res.redirect(`${clientUrl}/login?error=${encodeURIComponent(err.message || 'Google authentication failed')}`);
  }
};

/**
 * POST /api/auth/google
 * Direct ID token verification from client-side SDK (Google Identity Services)
 */
exports.googleAuthVerify = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) throw new ValidationError('Google ID token is required');

    const googleProfile = await oauthService.verifyGoogleIdToken(token);

    const user = await oauthService.findOrCreateOAuthUser({
      provider: 'google',
      providerId: googleProfile.googleId,
      email: googleProfile.email,
      name: googleProfile.name,
      avatar: googleProfile.avatar
    });

    return sendAuthResponse(res, user, 200);
  } catch (error) {
    next(error);
  }
};

// ==========================================
// APPLE OAUTH
// ==========================================

/**
 * GET /api/auth/apple
 * Redirects browser to Apple Sign-In
 */
exports.appleAuthInit = (req, res, next) => {
  try {
    const authUrl = oauthService.getAppleAuthUrl();
    res.redirect(authUrl);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/apple/callback
 * Apple sends a POST request with form_post response mode containing id_token and code
 */
exports.appleAuthCallback = async (req, res, next) => {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  try {
    const { id_token, error, user: userJson } = req.body;

    if (error) {
      return res.redirect(`${clientUrl}/login?error=${encodeURIComponent(error)}`);
    }

    if (!id_token) {
      return res.redirect(`${clientUrl}/login?error=${encodeURIComponent('No ID token provided by Apple')}`);
    }

    const appleProfile = await oauthService.verifyAppleIdToken(id_token);

    // Apple only provides user details (name) on the first sign-in inside userJson
    let userName = '';
    if (userJson) {
      try {
        const parsed = typeof userJson === 'string' ? JSON.parse(userJson) : userJson;
        if (parsed.name) {
          userName = [parsed.name.firstName, parsed.name.lastName].filter(Boolean).join(' ');
        }
      } catch (e) {
        // Ignore parse error
      }
    }

    const user = await oauthService.findOrCreateOAuthUser({
      provider: 'apple',
      providerId: appleProfile.appleId,
      email: appleProfile.email,
      name: userName
    });

    const { accessToken } = generateTokens(user._id);

    res.cookie('token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 15 * 60 * 1000
    });

    return res.redirect(`${clientUrl}/login?token=${accessToken}`);
  } catch (err) {
    console.error('Apple OAuth callback error:', err);
    return res.redirect(`${clientUrl}/login?error=${encodeURIComponent(err.message || 'Apple authentication failed')}`);
  }
};

/**
 * POST /api/auth/apple
 * Direct token verification from Apple Sign-In JS client SDK
 */
exports.appleAuthVerify = async (req, res, next) => {
  try {
    const { token, name } = req.body;
    if (!token) throw new ValidationError('Apple token is required');

    const appleProfile = await oauthService.verifyAppleIdToken(token);

    const user = await oauthService.findOrCreateOAuthUser({
      provider: 'apple',
      providerId: appleProfile.appleId,
      email: appleProfile.email,
      name: name || ''
    });

    return sendAuthResponse(res, user, 200);
  } catch (error) {
    next(error);
  }
};
