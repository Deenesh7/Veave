const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AuthError, ForbiddenError } = require('../utils/errors');

// Records when an account was last seen, at most once every 5 minutes per account (no write on every request).
const SEEN_EVERY_MS = 5 * 60 * 1000;
const lastSeen = new Map();
function touchActive(user) {
  const now = Date.now();
  if (now - (lastSeen.get(String(user._id)) || 0) < SEEN_EVERY_MS) return;
  if (lastSeen.size > 5000) lastSeen.clear();
  lastSeen.set(String(user._id), now);
  User.updateOne({ _id: user._id }, { $set: { lastActiveAt: new Date(now) } }).catch(() => {});
}

function assertNotSuspended(user) {
  if (user.status === 'suspended') {
    const error = new ForbiddenError('This account has been suspended. Contact support.', 'ACCOUNT_SUSPENDED');
    throw error;
  }
}

const auth = async (req, res, next) => {
  try {
    let token;
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.token) {
      token = req.cookies.token;
    }

    if (token === 'null' || token === 'undefined') {
      token = null;
    }

    if (!token) {
      throw new AuthError('Not authorized to access this route');
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id);
      if (!req.user) {
        throw new AuthError('User not found');
      }
      assertNotSuspended(req.user);
      touchActive(req.user);
      next();
    } catch (err) {
      if (err instanceof ForbiddenError) throw err;
      throw new AuthError('Not authorized to access this route');
    }
  } catch (error) {
    next(error);
  }
};

// Guests (no token) are allowed. A token that is present but expired/invalid is NOT a guest: answering 401
// lets the client re-login instead of silently saving work under no account.
const optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token || token === 'null' || token === 'undefined' || token === 'none') {
      req.user = null;
      return next();
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      const error = new AuthError(err.name === 'TokenExpiredError' ? 'Your session expired. Please log in again.' : 'Invalid session. Please log in again.');
      error.code = 'TOKEN_INVALID';
      return next(error);
    }
    req.user = await User.findById(decoded.id);
    if (!req.user) {
      const error = new AuthError('Account not found. Please log in again.');
      error.code = 'TOKEN_INVALID';
      return next(error);
    }
    assertNotSuspended(req.user);
    touchActive(req.user);
    return next();
  } catch (error) {
    return next(error);
  }
};

auth.optionalAuth = optionalAuth;
module.exports = auth;

