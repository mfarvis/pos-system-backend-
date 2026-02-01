/**
 * AUTHENTICATION MIDDLEWARE
 * 
 * Handles JWT token verification and role-based access control
 */

const jwt = require('jsonwebtoken');

// Get JWT secret from environment or use default
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Verify JWT Token
 * 
 * This middleware checks if the request has a valid JWT token
 * Usage: Add to any route that requires authentication
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const verifyToken = (req, res, next) => {
  // Get token from Authorization header
  // Expected format: "Bearer <token>"
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // Check if token exists
  if (!token) {
    return res.status(403).json({ 
      success: false,
      error: 'No token provided. Please login.' 
    });
  }

  // Verify token
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid or expired token. Please login again.' 
      });
    }

    // Token is valid, attach user info to request
    req.userId = decoded.id;
    req.userRole = decoded.role;
    req.userEmail = decoded.email;
    
    // Continue to next middleware or route
    next();
  });
};

/**
 * Check if User is Admin
 * 
 * This middleware ensures only admin users can access certain routes
 * Must be used AFTER verifyToken middleware
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const isAdmin = (req, res, next) => {
  // Check if user role is admin
  if (req.userRole !== 'admin') {
    return res.status(403).json({ 
      success: false,
      error: 'Admin access required. You do not have permission.' 
    });
  }

  // User is admin, continue
  next();
};

/**
 * Optional Authentication
 * 
 * This middleware verifies token if present, but allows request even without token
 * Useful for routes that have different behavior for logged-in users
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    // No token, but that's okay - continue without user info
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (!err) {
      // Valid token, attach user info
      req.userId = decoded.id;
      req.userRole = decoded.role;
    }
    // Continue regardless of token validity
    next();
  });
};

// Export middleware functions
module.exports = { 
  verifyToken, 
  isAdmin, 
  optionalAuth,
  JWT_SECRET 
};