const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AuthError } = require('../utils/errors');

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
      next();
    } catch (err) {
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
    return next();
  } catch (error) {
    return next(error);
  }
};

auth.optionalAuth = optionalAuth;
module.exports = auth;

