/**
 * AUTHENTICATION ROUTES
 * 
 * Handles user registration, login, and profile management
 * Routes:
 * - POST /api/auth/register - Create new user account
 * - POST /api/auth/login - Login and get JWT token
 * - GET /api/auth/me - Get current user profile
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { JWT_SECRET, verifyToken } = require('../middleware/auth');

const router = express.Router();

// ============================================
// REGISTER NEW USER
// POST /api/auth/register
// ============================================
router.post('/register', (req, res) => {
  const { username, email, password, role, branch } = req.body;

  // Validate required fields
  if (!username || !email || !password) {
    return res.status(400).json({ 
      success: false,
      error: 'Username, email and password are required' 
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ 
      success: false,
      error: 'Invalid email format' 
    });
  }

  // Validate password length
  if (password.length < 6) {
    return res.status(400).json({ 
      success: false,
      error: 'Password must be at least 6 characters long' 
    });
  }

  // Hash password (10 salt rounds)
  const hashedPassword = bcrypt.hashSync(password, 10);

  // Insert new user into database
  db.run(
    `INSERT INTO users (username, email, password, role, branch) 
     VALUES (?, ?, ?, ?, ?)`,
    [username, email, hashedPassword, role || 'user', branch || 'Main'],
    function(err) {
      if (err) {
        // Check if email or username already exists
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ 
            success: false,
            error: 'Email or username already exists' 
          });
        }
        return res.status(500).json({ 
          success: false,
          error: 'Failed to create user account' 
        });
      }

      // Success! User created
      res.status(201).json({ 
        success: true,
        message: 'User registered successfully',
        userId: this.lastID 
      });
    }
  );
});

// ============================================
// LOGIN USER
// POST /api/auth/login
// ============================================
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  // Validate required fields
  if (!email || !password) {
    return res.status(400).json({ 
      success: false,
      error: 'Email and password are required' 
    });
  }

  // Find user by email
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err) {
      return res.status(500).json({ 
        success: false,
        error: 'Database error occurred' 
      });
    }

    // Check if user exists
    if (!user) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid email or password' 
      });
    }

    // Check if account is active
    if (user.status !== 'active') {
      return res.status(403).json({ 
        success: false,
        error: 'Your account has been deactivated. Please contact admin.' 
      });
    }

    // Verify password
    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid email or password' 
      });
    }

    // Create JWT token (expires in 24 hours)
    const token = jwt.sign(
      { 
        id: user.id, 
        role: user.role,
        email: user.email 
      }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // Success! Return token and user info (without password)
    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        branch: user.branch,
        status: user.status
      }
    });
  });
});

// ============================================
// GET CURRENT USER PROFILE
// GET /api/auth/me
// Requires: Authentication
// ============================================
router.get('/me', verifyToken, (req, res) => {
  // Get user details (excluding password)
  db.get(
    'SELECT id, username, email, role, branch, status, created_at FROM users WHERE id = ?',
    [req.userId],
    (err, user) => {
      if (err) {
        return res.status(500).json({ 
          success: false,
          error: 'Failed to fetch user data' 
        });
      }

      if (!user) {
        return res.status(404).json({ 
          success: false,
          error: 'User not found' 
        });
      }

      res.json({
        success: true,
        user
      });
    }
  );
});

// ============================================
// CHANGE PASSWORD
// PUT /api/auth/change-password
// Requires: Authentication
// ============================================
router.put('/change-password', verifyToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // Validate inputs
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ 
      success: false,
      error: 'Current password and new password are required' 
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ 
      success: false,
      error: 'New password must be at least 6 characters long' 
    });
  }

  // Get current user
  db.get('SELECT password FROM users WHERE id = ?', [req.userId], (err, user) => {
    if (err || !user) {
      return res.status(500).json({ 
        success: false,
        error: 'Failed to verify user' 
      });
    }

    // Verify current password
    const isPasswordValid = bcrypt.compareSync(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false,
        error: 'Current password is incorrect' 
      });
    }

    // Hash new password
    const hashedPassword = bcrypt.hashSync(newPassword, 10);

    // Update password
    db.run(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, req.userId],
      (err) => {
        if (err) {
          return res.status(500).json({ 
            success: false,
            error: 'Failed to update password' 
          });
        }

        res.json({
          success: true,
          message: 'Password updated successfully'
        });
      }
    );
  });
});

module.exports = router;