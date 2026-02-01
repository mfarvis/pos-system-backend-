/**
 * USER MANAGEMENT ROUTES
 * 
 * Handles user account operations:
 * - GET /api/users - Get all users (Admin only)
 * - GET /api/users/:id - Get single user details
 * - POST /api/users - Create new user (Admin only)
 * - PUT /api/users/:id - Update user (Admin only)
 * - DELETE /api/users/:id - Delete user (Admin only)
 * - PUT /api/users/:id/password - Change user password
 * - PUT /api/users/:id/status - Toggle user status (Admin only)
 * - GET /api/users/stats/overview - Get user statistics (Admin only)
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { verifyToken, isAdmin } = require('../middleware/auth');

const router = express.Router();

// ============================================
// GET ALL USERS
// GET /api/users?search=john&status=active&role=user
// Admin Only
// ============================================
router.get('/', verifyToken, isAdmin, (req, res) => {
  const { search, status, role } = req.query;

  // Build dynamic query
  let query = `
    SELECT id, username, email, role, branch, status, created_at 
    FROM users 
    WHERE 1=1
  `;
  const params = [];

  // Add search filter (searches username and email)
  if (search) {
    query += ' AND (username LIKE ? OR email LIKE ?)';
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }

  // Add status filter
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  // Add role filter
  if (role) {
    query += ' AND role = ?';
    params.push(role);
  }

  // Order by most recent first
  query += ' ORDER BY created_at DESC';

  // Execute query
  db.all(query, params, (err, users) => {
    if (err) {
      console.error('Error fetching users:', err);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to fetch users' 
      });
    }

    res.json({
      success: true,
      count: users.length,
      users
    });
  });
});

// ============================================
// GET SINGLE USER
// GET /api/users/:id
// Admin can view any user, regular users can only view themselves
// ============================================
router.get('/:id', verifyToken, (req, res) => {
  // Check permission: Admin can view anyone, users can only view themselves
  if (req.userRole !== 'admin' && parseInt(req.params.id) !== req.userId) {
    return res.status(403).json({ 
      success: false,
      error: 'You do not have permission to view this user' 
    });
  }

  db.get(
    'SELECT id, username, email, role, branch, status, created_at FROM users WHERE id = ?',
    [req.params.id],
    (err, user) => {
      if (err) {
        return res.status(500).json({ 
          success: false,
          error: 'Failed to fetch user' 
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
// CREATE NEW USER
// POST /api/users
// Admin Only
// ============================================
router.post('/', verifyToken, isAdmin, (req, res) => {
  const { username, email, password, role, branch } = req.body;

  // ──────────────────────────────────────
  // VALIDATION
  // ──────────────────────────────────────
  
  // Check required fields
  if (!username || !email || !password) {
    return res.status(400).json({ 
      success: false,
      error: 'Username, email, and password are required' 
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

  // Validate role
  const validRoles = ['admin', 'user'];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ 
      success: false,
      error: 'Invalid role. Must be "admin" or "user"' 
    });
  }

  // ──────────────────────────────────────
  // CREATE USER
  // ──────────────────────────────────────

  // Hash password
  const hashedPassword = bcrypt.hashSync(password, 10);

  // Insert user
  db.run(
    `INSERT INTO users (username, email, password, role, branch, status) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [username, email, hashedPassword, role || 'user', branch || 'Main', 'active'],
    function(err) {
      if (err) {
        console.error('Error creating user:', err);
        
        // Check for duplicate email or username
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ 
            success: false,
            error: 'Email or username already exists' 
          });
        }
        
        return res.status(500).json({ 
          success: false,
          error: 'Failed to create user' 
        });
      }

      res.status(201).json({ 
        success: true,
        message: 'User created successfully',
        userId: this.lastID 
      });
    }
  );
});

// ============================================
// UPDATE USER
// PUT /api/users/:id
// Admin Only
// ============================================
router.put('/:id', verifyToken, isAdmin, (req, res) => {
  const { username, email, role, branch, status } = req.body;

  // ──────────────────────────────────────
  // VALIDATION
  // ──────────────────────────────────────
  
  // Validate email if provided
  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid email format' 
      });
    }
  }

  // Validate role if provided
  if (role && !['admin', 'user'].includes(role)) {
    return res.status(400).json({ 
      success: false,
      error: 'Invalid role. Must be "admin" or "user"' 
    });
  }

  // Validate status if provided
  if (status && !['active', 'inactive'].includes(status)) {
    return res.status(400).json({ 
      success: false,
      error: 'Invalid status. Must be "active" or "inactive"' 
    });
  }

  // Prevent modifying the default admin (user ID 1)
  if (parseInt(req.params.id) === 1) {
    return res.status(403).json({ 
      success: false,
      error: 'Cannot modify the default admin account' 
    });
  }

  // ──────────────────────────────────────
  // UPDATE USER
  // ──────────────────────────────────────

  db.run(
    `UPDATE users 
     SET username = ?, email = ?, role = ?, branch = ?, status = ? 
     WHERE id = ?`,
    [username, email, role, branch, status, req.params.id],
    function(err) {
      if (err) {
        console.error('Error updating user:', err);
        
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ 
            success: false,
            error: 'Email or username already exists' 
          });
        }
        
        return res.status(500).json({ 
          success: false,
          error: 'Failed to update user' 
        });
      }

      if (this.changes === 0) {
        return res.status(404).json({ 
          success: false,
          error: 'User not found' 
        });
      }

      res.json({ 
        success: true,
        message: 'User updated successfully' 
      });
    }
  );
});

// ============================================
// DELETE USER
// DELETE /api/users/:id
// Admin Only
// ============================================
router.delete('/:id', verifyToken, isAdmin, (req, res) => {
  // Prevent deleting the default admin (user ID 1)
  if (parseInt(req.params.id) === 1) {
    return res.status(403).json({ 
      success: false,
      error: 'Cannot delete the default admin account' 
    });
  }

  // Prevent admin from deleting themselves
  if (parseInt(req.params.id) === req.userId) {
    return res.status(403).json({ 
      success: false,
      error: 'You cannot delete your own account' 
    });
  }

  db.run('DELETE FROM users WHERE id = ?', [req.params.id], function(err) {
    if (err) {
      console.error('Error deleting user:', err);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to delete user' 
      });
    }

    if (this.changes === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    res.json({ 
      success: true,
      message: 'User deleted successfully' 
    });
  });
});

// ============================================
// CHANGE USER PASSWORD
// PUT /api/users/:id/password
// Users can change their own password, admin can change anyone's
// ============================================
router.put('/:id/password', verifyToken, (req, res) => {
  const { current_password, new_password } = req.body;

  // ──────────────────────────────────────
  // PERMISSION CHECK
  // ──────────────────────────────────────
  
  // Users can only change their own password unless they're admin
  if (req.userRole !== 'admin' && parseInt(req.params.id) !== req.userId) {
    return res.status(403).json({ 
      success: false,
      error: 'You can only change your own password' 
    });
  }

  // ──────────────────────────────────────
  // VALIDATION
  // ──────────────────────────────────────
  
  if (!new_password) {
    return res.status(400).json({ 
      success: false,
      error: 'New password is required' 
    });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ 
      success: false,
      error: 'New password must be at least 6 characters long' 
    });
  }

  // Get user's current password from database
  db.get('SELECT password FROM users WHERE id = ?', [req.params.id], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    // If not admin, verify current password
    if (req.userRole !== 'admin') {
      if (!current_password) {
        return res.status(400).json({ 
          success: false,
          error: 'Current password is required' 
        });
      }

      const isPasswordValid = bcrypt.compareSync(current_password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ 
          success: false,
          error: 'Current password is incorrect' 
        });
      }
    }

    // Hash new password
    const hashedPassword = bcrypt.hashSync(new_password, 10);

    // Update password
    db.run(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, req.params.id],
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

// ============================================
// TOGGLE USER STATUS (Active/Inactive)
// PUT /api/users/:id/status
// Admin Only
// ============================================
router.put('/:id/status', verifyToken, isAdmin, (req, res) => {
  const { status } = req.body;

  // Validate status
  if (!status || !['active', 'inactive'].includes(status)) {
    return res.status(400).json({ 
      success: false,
      error: 'Status must be "active" or "inactive"' 
    });
  }

  // Prevent deactivating the default admin
  if (parseInt(req.params.id) === 1) {
    return res.status(403).json({ 
      success: false,
      error: 'Cannot deactivate the default admin account' 
    });
  }

  // Prevent admin from deactivating themselves
  if (parseInt(req.params.id) === req.userId && status === 'inactive') {
    return res.status(403).json({ 
      success: false,
      error: 'You cannot deactivate your own account' 
    });
  }

  db.run(
    'UPDATE users SET status = ? WHERE id = ?',
    [status, req.params.id],
    function(err) {
      if (err) {
        return res.status(500).json({ 
          success: false,
          error: 'Failed to update status' 
        });
      }

      if (this.changes === 0) {
        return res.status(404).json({ 
          success: false,
          error: 'User not found' 
        });
      }

      res.json({ 
        success: true,
        message: `User ${status === 'active' ? 'activated' : 'deactivated'} successfully` 
      });
    }
  );
});

// ============================================
// GET USER STATISTICS
// GET /api/users/stats/overview
// Admin Only - Returns user counts and activity
// ============================================
router.get('/stats/overview', verifyToken, isAdmin, (req, res) => {
  const stats = {};

  // Get total users
  db.get('SELECT COUNT(*) as total FROM users', (err, row) => {
    stats.totalUsers = row?.total || 0;

    // Get active users
    db.get('SELECT COUNT(*) as count FROM users WHERE status = "active"', (err, row) => {
      stats.activeUsers = row?.count || 0;

      // Get inactive users
      db.get('SELECT COUNT(*) as count FROM users WHERE status = "inactive"', (err, row) => {
        stats.inactiveUsers = row?.count || 0;

        // Get admin count
        db.get('SELECT COUNT(*) as count FROM users WHERE role = "admin"', (err, row) => {
          stats.adminCount = row?.count || 0;

          // Get regular user count
          db.get('SELECT COUNT(*) as count FROM users WHERE role = "user"', (err, row) => {
            stats.userCount = row?.count || 0;

            // Get recently created users (last 7 days)
            db.get(
              'SELECT COUNT(*) as count FROM users WHERE created_at >= datetime("now", "-7 days")', 
              (err, row) => {
                stats.newUsersThisWeek = row?.count || 0;

                // Get top users by sales
                db.all(
                  `SELECT 
                    u.id, u.username, u.email, u.branch,
                    COUNT(s.id) as total_sales,
                    SUM(s.grand_total) as total_revenue
                   FROM users u
                   LEFT JOIN sales s ON u.id = s.user_id
                   GROUP BY u.id
                   ORDER BY total_sales DESC
                   LIMIT 10`,
                  (err, topUsers) => {
                    stats.topUsers = topUsers || [];

                    res.json({
                      success: true,
                      stats
                    });
                  }
                );
              }
            );
          });
        });
      });
    });
  });
});

// ============================================
// GET USER ACTIVITY
// GET /api/users/:id/activity
// Returns sales and activity for specific user
// ============================================
router.get('/:id/activity', verifyToken, (req, res) => {
  // Permission check
  if (req.userRole !== 'admin' && parseInt(req.params.id) !== req.userId) {
    return res.status(403).json({ 
      success: false,
      error: 'You do not have permission to view this user\'s activity' 
    });
  }

  // Get user's sales statistics
  db.get(
    `SELECT 
      COUNT(*) as total_sales,
      SUM(grand_total) as total_revenue,
      AVG(grand_total) as average_sale
     FROM sales 
     WHERE user_id = ?`,
    [req.params.id],
    (err, salesStats) => {
      if (err) {
        return res.status(500).json({ 
          success: false,
          error: 'Failed to fetch activity' 
        });
      }

      // Get recent sales
      db.all(
        `SELECT id, invoice_number, customer_name, grand_total, created_at
         FROM sales 
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 10`,
        [req.params.id],
        (err, recentSales) => {
          res.json({
            success: true,
            activity: {
              salesStats: salesStats || { total_sales: 0, total_revenue: 0, average_sale: 0 },
              recentSales: recentSales || []
            }
          });
        }
      );
    }
  );
});

module.exports = router;