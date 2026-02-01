/**
 * INVENTORY MANAGEMENT SYSTEM - MAIN SERVER
 * 
 * This is the main entry point for the backend application
 * It sets up Express server, middleware, routes, and error handling
 */

// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ============================================
// SERVER CONFIGURATION
// ============================================

const app = express();
const PORT = process.env.PORT || 5000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
  console.log('✅ Created uploads directory');
}

// ============================================
// MIDDLEWARE SETUP
// ============================================

// CORS - Allow cross-origin requests from frontend
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));

// Body Parsers - Parse JSON and URL-encoded data
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static Files - Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Request Logger - Log all incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================
// IMPORT ROUTES
// ============================================

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const salesRoutes = require('./routes/sales');
const userRoutes = require('./routes/users');

// ============================================
// API ROUTES
// ============================================

// Health Check Endpoint - Test if server is running
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true,
    message: 'Inventory Management System API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Mount Route Handlers
app.use('/api/auth', authRoutes);        // Authentication routes
app.use('/api/products', productRoutes);  // Product management
app.use('/api/sales', salesRoutes);       // Sales/POS routes
app.use('/api/users', userRoutes);        // User management

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Inventory Management System API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      products: '/api/products',
      sales: '/api/sales',
      users: '/api/users'
    }
  });
});

// ============================================
// ERROR HANDLING MIDDLEWARE
// ============================================

// 404 - Route Not Found
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    error: 'Route not found',
    path: req.path 
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  
  // Multer errors (file upload)
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        success: false,
        error: 'File too large. Maximum size is 5MB' 
      });
    }
    return res.status(400).json({ 
      success: false,
      error: err.message 
    });
  }

  // Other errors
  res.status(err.status || 500).json({ 
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('🚀 INVENTORY MANAGEMENT SYSTEM API');
  console.log('='.repeat(50));
  console.log(`📡 Server running on: http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📁 Uploads directory: ${uploadsDir}`);
  console.log('='.repeat(50));
  console.log('📋 Available Endpoints:');
  console.log(`   - Health Check: http://localhost:${PORT}/api/health`);
  console.log(`   - Auth: http://localhost:${PORT}/api/auth`);
  console.log(`   - Products: http://localhost:${PORT}/api/products`);
  console.log(`   - Sales: http://localhost:${PORT}/api/sales`);
  console.log(`   - Users: http://localhost:${PORT}/api/users`);
  console.log('='.repeat(50));
  console.log('🔐 Default Admin Credentials:');
  console.log('   Email: admin@company.com');
  console.log('   Password: admin123');
  console.log('='.repeat(50) + '\n');
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n⚠️  SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n⚠️  SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

// Export app for testing
module.exports = app;