/**
 * PRODUCT MANAGEMENT ROUTES
 * 
 * Handles all product-related operations:
 * - GET /api/products - List all products (with filters)
 * - GET /api/products/:id - Get single product
 * - POST /api/products - Add new product (Admin only)
 * - PUT /api/products/:id - Update product (Admin only)
 * - DELETE /api/products/:id - Delete product (Admin only)
 * - GET /api/products/stats/dashboard - Get dashboard statistics
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { verifyToken, isAdmin } = require('../middleware/auth');

const router = express.Router();

// ============================================
// MULTER CONFIGURATION FOR IMAGE UPLOADS
// ============================================

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    // Create unique filename: timestamp-randomnumber.extension
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

// Configure multer with file filters
const upload = multer({
  storage: storage,
  limits: { 
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allowed image formats
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, JPG, PNG, GIF, WEBP) are allowed!'));
    }
  }
});

// ============================================
// GET ALL PRODUCTS (with optional filters)
// GET /api/products?search=laptop&category=electronics&status=in_stock
// ============================================
router.get('/', verifyToken, (req, res) => {
  const { search, category, status } = req.query;
  
  // Build dynamic query
  let query = 'SELECT * FROM products WHERE 1=1';
  const params = [];

  // Add search filter (searches name, sku, and category)
  if (search) {
    query += ' AND (name LIKE ? OR sku LIKE ? OR category LIKE ?)';
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  // Add category filter
  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  // Add status filter
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  // Order by most recent first
  query += ' ORDER BY created_at DESC';

  // Execute query
  db.all(query, params, (err, products) => {
    if (err) {
      console.error('Error fetching products:', err);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to fetch products',
        products: [] // ✅ Always send empty array on error
      });
    }

    res.json({
      success: true,
      count: products.length,
      products: products || [] // ✅ Ensure products is always an array
    });
  });
});

// ============================================
// GET SINGLE PRODUCT
// GET /api/products/:id
// ============================================
router.get('/:id', verifyToken, (req, res) => {
  db.get('SELECT * FROM products WHERE id = ?', [req.params.id], (err, product) => {
    if (err) {
      return res.status(500).json({ 
        success: false,
        error: 'Failed to fetch product' 
      });
    }

    if (!product) {
      return res.status(404).json({ 
        success: false,
        error: 'Product not found' 
      });
    }

    res.json({
      success: true,
      product
    });
  });
});

// ============================================
// ADD NEW PRODUCT
// POST /api/products
// Admin Only - With Image Upload
// ============================================
router.post('/', verifyToken, isAdmin, upload.single('image'), (req, res) => {
  const {
    name, sku, category, brand, description,
    purchase_price, selling_price, quantity, min_stock, supplier
  } = req.body;

  // Validate required fields
  if (!name || !sku || !selling_price) {
    return res.status(400).json({ 
      success: false,
      error: 'Name, SKU, and Selling Price are required' 
    });
  }

  // Get image path if uploaded
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;
  
  // Parse numeric values
  const qty = parseInt(quantity) || 0;
  const minStock = parseInt(min_stock) || 5;
  const purchasePrice = parseFloat(purchase_price) || 0;
  const sellingPrice = parseFloat(selling_price);
  
  // Determine stock status automatically
  let status = 'in_stock';
  if (qty === 0) {
    status = 'out_of_stock';
  } else if (qty <= minStock) {
    status = 'low_stock';
  }

  // Insert product into database
  db.run(
    `INSERT INTO products 
    (name, sku, category, brand, description, purchase_price, selling_price, 
     quantity, min_stock, image_path, supplier, status) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, sku, category, brand, description, purchasePrice, sellingPrice, 
     qty, minStock, imagePath, supplier, status],
    function(err) {
      if (err) {
        console.error('Error adding product:', err);
        
        // Check for duplicate SKU
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ 
            success: false,
            error: 'Product with this SKU already exists' 
          });
        }
        
        return res.status(500).json({ 
          success: false,
          error: 'Failed to add product' 
        });
      }

      // Success!
      res.status(201).json({ 
        success: true,
        message: 'Product added successfully',
        productId: this.lastID 
      });
    }
  );
});

// ============================================
// UPDATE PRODUCT
// PUT /api/products/:id
// Admin Only - With Optional Image Upload
// ============================================
router.put('/:id', verifyToken, isAdmin, upload.single('image'), (req, res) => {
  const {
    name, sku, category, brand, description,
    purchase_price, selling_price, quantity, min_stock, supplier
  } = req.body;

  // Parse values
  const qty = parseInt(quantity) || 0;
  const minStock = parseInt(min_stock) || 5;
  const purchasePrice = parseFloat(purchase_price) || 0;
  const sellingPrice = parseFloat(selling_price);

  // Determine status
  let status = 'in_stock';
  if (qty === 0) status = 'out_of_stock';
  else if (qty <= minStock) status = 'low_stock';

  // Build update query
  let query = `
    UPDATE products SET 
    name = ?, sku = ?, category = ?, brand = ?, description = ?,
    purchase_price = ?, selling_price = ?, quantity = ?, min_stock = ?,
    supplier = ?, status = ?, updated_at = CURRENT_TIMESTAMP
  `;
  
  const params = [
    name, sku, category, brand, description,
    purchasePrice, sellingPrice, qty, minStock, supplier, status
  ];

  // Add image if new one uploaded
  if (req.file) {
    query += ', image_path = ?';
    params.push(`/uploads/${req.file.filename}`);
  }

  query += ' WHERE id = ?';
  params.push(req.params.id);

  // Execute update
  db.run(query, params, function(err) {
    if (err) {
      console.error('Error updating product:', err);
      
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ 
          success: false,
          error: 'Another product with this SKU already exists' 
        });
      }
      
      return res.status(500).json({ 
        success: false,
        error: 'Failed to update product' 
      });
    }

    if (this.changes === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Product not found' 
      });
    }

    res.json({ 
      success: true,
      message: 'Product updated successfully' 
    });
  });
});

// ============================================
// DELETE PRODUCT
// DELETE /api/products/:id
// Admin Only
// ============================================
router.delete('/:id', verifyToken, isAdmin, (req, res) => {
  // First get the product to delete its image
  db.get('SELECT image_path FROM products WHERE id = ?', [req.params.id], (err, product) => {
    if (err) {
      return res.status(500).json({ 
        success: false,
        error: 'Failed to fetch product' 
      });
    }

    // Delete product from database
    db.run('DELETE FROM products WHERE id = ?', [req.params.id], function(err) {
      if (err) {
        return res.status(500).json({ 
          success: false,
          error: 'Failed to delete product' 
        });
      }

      if (this.changes === 0) {
        return res.status(404).json({ 
          success: false,
          error: 'Product not found' 
        });
      }

      // Delete image file if exists
      if (product && product.image_path) {
        const imagePath = path.join(__dirname, '..', product.image_path);
        fs.unlink(imagePath, (err) => {
          if (err) console.error('Error deleting image:', err);
        });
      }

      res.json({ 
        success: true,
        message: 'Product deleted successfully' 
      });
    });
  });
});

// ============================================
// GET DASHBOARD STATISTICS
// GET /api/products/stats/dashboard
// Admin Only
// ============================================
router.get('/stats/dashboard', verifyToken, isAdmin, (req, res) => {
  const stats = {};

  // Get total products and total stock quantity
  db.get(
    'SELECT COUNT(*) as total, SUM(quantity) as totalQty FROM products', 
    (err, row) => {
      if (err) {
        return res.status(500).json({ 
          success: false,
          error: 'Failed to fetch stats' 
        });
      }

      stats.totalProducts = row?.total || 0;
      stats.totalStock = row?.totalQty || 0;

      // Get low stock count
      db.get(
        'SELECT COUNT(*) as count FROM products WHERE status = "low_stock"', 
        (err, row) => {
          stats.lowStock = row?.count || 0;

          // Get today's sales
          db.get(
            'SELECT SUM(grand_total) as total FROM sales WHERE DATE(created_at) = DATE("now")', 
            (err, row) => {
              stats.salesToday = row?.total || 0;

              // Get this month's revenue
              db.get(
                'SELECT SUM(grand_total) as total FROM sales WHERE strftime("%Y-%m", created_at) = strftime("%Y-%m", "now")', 
                (err, row) => {
                  stats.monthlyProfit = row?.total || 0;
                  
                  res.json({
                    success: true,
                    stats
                  });
                }
              );
            }
          );
        }
      );
    }
  );
});

// ============================================
// GET CATEGORIES LIST
// GET /api/products/categories/list
// ============================================
router.get('/categories/list', verifyToken, (req, res) => {
  db.all(
    'SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != "" ORDER BY category',
    (err, rows) => {
      if (err) {
        return res.status(500).json({ 
          success: false,
          error: 'Failed to fetch categories' 
        });
      }

      const categories = rows.map(row => row.category);
      res.json({
        success: true,
        categories
      });
    }
  );
});

module.exports = router;