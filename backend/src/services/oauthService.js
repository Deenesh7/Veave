const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');
const User = require('../models/User');
const { AuthError, ValidationError } = require('../utils/errors');

// One place decides the redirect URI so the auth URL, token exchange and the setup hint always agree.
const googleRedirectUri = () => String(process.env.GOOGLE_CALLBACK_URL || `http://localhost:${process.env.PORT || 5001}/api/auth/google/callback`).trim();

class OAuthService {
  googleRedirectUri() { return googleRedirectUri(); }

  constructor() {
    this.googleClient = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      googleRedirectUri()
    );
  }

  /**
   * Generates Google OAuth consent screen URL
   */
  getGoogleAuthUrl() {
    if (!process.env.GOOGLE_CLIENT_ID) {
      throw new ValidationError('GOOGLE_CLIENT_ID is not configured in backend environment.');
    }

    const redirectUri = googleRedirectUri();
    const params = new URLSearchParams({
      client_id: String(process.env.GOOGLE_CLIENT_ID).trim(),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'consent'
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchanges Google authorization code for user profile
   */
  async verifyGoogleCode(code) {
    const redirectUri = googleRedirectUri();
    
    try {
      // Exchange code for tokens
      const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: String(process.env.GOOGLE_CLIENT_ID).trim(),
        client_secret: String(process.env.GOOGLE_CLIENT_SECRET || '').trim(),
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      });

      const { id_token, access_token } = tokenResponse.data;

      // Verify ID token or fetch userinfo
      let googleUser = null;
      if (id_token) {
        googleUser = await this.verifyGoogleIdToken(id_token);
      } else {
        const userInfoRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${access_token}` }
        });
        googleUser = {
          googleId: userInfoRes.data.sub,
          email: userInfoRes.data.email,
          name: userInfoRes.data.name || userInfoRes.data.email.split('@')[0],
          avatar: userInfoRes.data.picture || ''
        };
      }

      return googleUser;
    } catch (error) {
      const errDetail = error.response?.data?.error_description || error.message;
      throw new AuthError(`Failed to authenticate with Google: ${errDetail}`);
    }
  }

  /**
   * Verifies Google ID Token sent directly from client-side SDK
   */
  async verifyGoogleIdToken(idToken) {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      const payload = ticket.getPayload();

      return {
        googleId: payload.sub,
        email: payload.email,
        name: payload.name || payload.email.split('@')[0],
        avatar: payload.picture || ''
      };
    } catch (error) {
      throw new AuthError(`Invalid Google ID token: ${error.message}`);
    }
  }

  /**
   * Generates Apple Sign-In authorization URL
   */
  getAppleAuthUrl() {
    if (!process.env.APPLE_CLIENT_ID) {
      throw new ValidationError('APPLE_CLIENT_ID is not configured in backend environment.');
    }

    const redirectUri = process.env.APPLE_CALLBACK_URL || `http://localhost:${process.env.PORT || 5001}/api/auth/apple/callback`;
    const params = new URLSearchParams({
      client_id: process.env.APPLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code id_token',
      scope: 'name email',
      response_mode: 'form_post'
    });

    return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
  }

  /**
   * Verifies Apple ID Token from client SDK or form_post callback
   */
  async verifyAppleIdToken(idToken) {
    try {
      const payload = await appleSignin.verifyIdToken(idToken, {
        audience: process.env.APPLE_CLIENT_ID,
        ignoreExpiration: process.env.NODE_ENV !== 'production'
      });

      return {
        appleId: payload.sub,
        email: payload.email
      };
    } catch (error) {
      throw new AuthError(`Invalid Apple ID token: ${error.message}`);
    }
  }

  /**
   * Find existing user or create a new user from OAuth profile
   */
  async findOrCreateOAuthUser({ provider, providerId, email, name, avatar }) {
    if (!email) {
      throw new ValidationError('OAuth provider did not return an email address');
    }

    // 1. Look for user by provider ID
    const query = provider === 'google' 
      ? { googleId: providerId } 
      : { appleId: providerId };
    
    let user = await User.findOne(query);

    if (user) {
      // Update avatar if not already present
      if (avatar && !user.avatar) {
        user.avatar = avatar;
        await user.save();
      }
      return user;
    }

    // 2. Look for existing user by email to link account
    user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      if (provider === 'google') user.googleId = providerId;
      if (provider === 'apple') user.appleId = providerId;
      if (avatar && !user.avatar) user.avatar = avatar;
      await user.save();
      return user;
    }

    // 3. Create new user without password requirement
    const fallbackName = name || email.split('@')[0];
    user = await User.create({
      name: fallbackName,
      email: email.toLowerCase(),
      avatar: avatar || '',
      googleId: provider === 'google' ? providerId : undefined,
      appleId: provider === 'apple' ? providerId : undefined
    });

    return user;
  }
}

module.exports = new OAuthService();
