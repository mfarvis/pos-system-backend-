/**
 * DATABASE CONFIGURATION
 * 
 * This file handles all database operations:
 * - Creates SQLite database connection
 * - Initializes tables if they don't exist
 * - Creates default admin user
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

// Database file path
const dbPath = process.env.DB_PATH || path.join(__dirname, 'inventory.db');

// Create database connection
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error opening database:', err.message);
    process.exit(1); // Exit if database fails
  } else {
    console.log('✅ Connected to SQLite database at:', dbPath);
    initDatabase();
  }
});

/**
 * Initialize Database Tables
 * Creates all required tables if they don't exist
 */
function initDatabase() {
  
  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  // ============================================
  // USERS TABLE
  // Stores user accounts (admin and regular users)
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('admin', 'user')) DEFAULT 'user',
      branch TEXT DEFAULT 'Main',
      status TEXT CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('❌ Error creating users table:', err.message);
    } else {
      console.log('✅ Users table ready');
      createDefaultAdmin();
    }
  });

  // ============================================
  // PRODUCTS TABLE
  // Stores all inventory items
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT UNIQUE NOT NULL,
      category TEXT,
      brand TEXT,
      description TEXT,
      purchase_price REAL DEFAULT 0,
      selling_price REAL NOT NULL,
      quantity INTEGER DEFAULT 0,
      min_stock INTEGER DEFAULT 5,
      image_path TEXT,
      supplier TEXT,
      status TEXT CHECK(status IN ('in_stock', 'low_stock', 'out_of_stock')) DEFAULT 'in_stock',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('❌ Error creating products table:', err.message);
    } else {
      console.log('✅ Products table ready');
    }
  });

  // ============================================
  // SALES TABLE
  // Stores sales transactions
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      user_id INTEGER,
      customer_name TEXT,
      subtotal REAL NOT NULL,
      tax REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      grand_total REAL NOT NULL,
      payment_method TEXT CHECK(payment_method IN ('cash', 'card', 'online')) DEFAULT 'cash',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `, (err) => {
    if (err) {
      console.error('❌ Error creating sales table:', err.message);
    } else {
      console.log('✅ Sales table ready');
    }
  });

  // ============================================
  // SALE_ITEMS TABLE
  // Stores individual items in each sale
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      total REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    )
  `, (err) => {
    if (err) {
      console.error('❌ Error creating sale_items table:', err.message);
    } else {
      console.log('✅ Sale items table ready');
    }
  });
}

/**
 * Create Default Admin User
 * Only creates if admin doesn't already exist
 */
function createDefaultAdmin() {
  // Check if admin already exists
  db.get('SELECT id FROM users WHERE email = ?', ['admin@company.com'], (err, row) => {
    if (err) {
      console.error('❌ Error checking for admin:', err.message);
      return;
    }

    // If admin doesn't exist, create one
    if (!row) {
      const hashedPassword = bcrypt.hashSync('admin123', 10);
      
      db.run(
        `INSERT INTO users (username, email, password, role, branch, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['admin', 'admin@company.com', hashedPassword, 'admin', 'HQ', 'active'],
        (err) => {
          if (err) {
            console.error('❌ Error creating admin user:', err.message);
          } else {
            console.log('✅ Default admin user created');
            console.log('   📧 Email: admin@company.com');
            console.log('   🔑 Password: admin123');
          }
        }
      );
    } else {
      console.log('ℹ️  Admin user already exists');
    }
  });
}

// Export database instance
module.exports = db;