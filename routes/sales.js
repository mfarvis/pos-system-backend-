/**
  SALES ROUTES 
 */

const express = require('express');
const db = require('../database');
const { verifyToken, isAdmin } = require('../middleware/auth');

const router = express.Router();


// CREATE SALE  —  POST /api/sales

router.post('/', verifyToken, (req, res) => {
  const { customer_name, items, subtotal, tax, discount, grand_total, payment_method } = req.body;

  // ── validation ──
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'No items provided.' });
  }
  if (!grand_total) {
    return res.status(400).json({ success: false, error: 'Grand total is required.' });
  }

  const invoiceNumber = `INV-${Date.now()}-${Math.floor(Math.random() * 9000) + 1000}`;

  // ── run everything inside db.serialize so statements execute in order ──
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // 1. insert sale header
    db.run(
      `INSERT INTO sales
        (invoice_number, user_id, customer_name, subtotal, tax, discount, grand_total, payment_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceNumber,
        req.userId,
        customer_name || 'Walk-in Customer',
        subtotal || 0,
        tax || 0,
        discount || 0,
        grand_total,
        payment_method || 'cash'
      ]
    );

    // 2. get the new sale id
    db.get('SELECT last_insert_rowid() as id', (err, row) => {
      if (err || !row) {
        db.run('ROLLBACK');
        return res.status(500).json({ success: false, error: 'Failed to create sale record.' });
      }

      const saleId = row.id;

      // 3. loop over every item: check stock → insert sale_item → reduce stock
      let index = 0;

      const processNext = () => {
        // all items done → commit
        if (index >= items.length) {
          db.run('COMMIT', (commitErr) => {
            if (commitErr) {
              return res.status(500).json({ success: false, error: 'Transaction failed.' });
            }
            return res.status(201).json({
              success: true,
              message: 'Sale completed successfully',
              invoiceNumber,
              saleId,
              itemsCount: items.length,
              grandTotal: grand_total
            });
          });
          return;
        }

        const item = items[index];

        // 3a. check current stock
        db.get('SELECT quantity, min_stock, name FROM products WHERE id = ?', [item.product_id], (err, product) => {
          if (err || !product) {
            db.run('ROLLBACK');
            return res.status(400).json({ success: false, error: `Product ID ${item.product_id} not found.` });
          }

          if (product.quantity < item.quantity) {
            db.run('ROLLBACK');
            return res.status(400).json({
              success: false,
              error: `Not enough stock for "${product.name}". Available: ${product.quantity}, Requested: ${item.quantity}`
            });
          }

          // 3b. insert sale item row
          db.run(
            'INSERT INTO sale_items (sale_id, product_id, quantity, price, total) VALUES (?, ?, ?, ?, ?)',
            [saleId, item.product_id, item.quantity, item.price, item.total || (item.quantity * item.price)]
          );

          // 3c. reduce stock
          const newQty = product.quantity - item.quantity;
          let newStatus = 'in_stock';
          if (newQty === 0) newStatus = 'out_of_stock';
          else if (newQty <= product.min_stock) newStatus = 'low_stock';

          db.run(
            'UPDATE products SET quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [newQty, newStatus, item.product_id]
          );

          // move to next item
          index++;
          processNext();
        });
      };

      processNext(); // kick off the loop
    });
  });
});

// ============================================
// GET ALL SALES  —  GET /api/sales
// ============================================
router.get('/', verifyToken, (req, res) => {
  const { start_date, end_date, payment_method, customer } = req.query;

  let query = `
    SELECT s.*, u.username as cashier_name
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (req.userRole !== 'admin') {
    query += ' AND s.user_id = ?';
    params.push(req.userId);
  }
  if (start_date) {
    query += ' AND DATE(s.created_at) >= DATE(?)';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND DATE(s.created_at) <= DATE(?)';
    params.push(end_date);
  }
  if (payment_method) {
    query += ' AND s.payment_method = ?';
    params.push(payment_method);
  }
  if (customer) {
    query += ' AND s.customer_name LIKE ?';
    params.push(`%${customer}%`);
  }

  query += ' ORDER BY s.created_at DESC';

  db.all(query, params, (err, sales) => {
    if (err) return res.status(500).json({ success: false, error: 'Failed to fetch sales.' });
    res.json({ success: true, count: sales.length, sales: sales || [] });
  });
});

// ============================================
// GET SINGLE SALE  —  GET /api/sales/:id
// ============================================
router.get('/:id', verifyToken, (req, res) => {
  // guard: "reports" path handled below, not here
  if (req.params.id === 'reports') return res.status(404).json({ success: false, error: 'Not found' });

  db.get(
    `SELECT s.*, u.username as cashier_name
     FROM sales s LEFT JOIN users u ON s.user_id = u.id
     WHERE s.id = ?`,
    [req.params.id],
    (err, sale) => {
      if (err || !sale) return res.status(404).json({ success: false, error: 'Sale not found.' });

      if (req.userRole !== 'admin' && sale.user_id !== req.userId) {
        return res.status(403).json({ success: false, error: 'Permission denied.' });
      }

      db.all(
        `SELECT si.*, p.name as product_name, p.sku, p.category, p.image_path
         FROM sale_items si LEFT JOIN products p ON si.product_id = p.id
         WHERE si.sale_id = ?`,
        [req.params.id],
        (err2, items) => {
          sale.items = items || [];
          res.json({ success: true, sale });
        }
      );
    }
  );
});


// DELETE SALE  —  DELETE /api/sales/:id   (admin)

router.delete('/:id', verifyToken, isAdmin, (req, res) => {
  db.all('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?', [req.params.id], (err, items) => {
    if (err) return res.status(500).json({ success: false, error: 'Failed.' });

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      // restore stock
      (items || []).forEach(item => {
        db.run('UPDATE products SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [item.quantity, item.product_id]);
      });

      db.run('DELETE FROM sale_items WHERE sale_id = ?', [req.params.id]);
      db.run('DELETE FROM sales WHERE id = ?', [req.params.id], function (delErr) {
        if (delErr || this.changes === 0) {
          db.run('ROLLBACK');
          return res.status(404).json({ success: false, error: 'Sale not found.' });
        }
        db.run('COMMIT', () => {
          res.json({ success: true, message: 'Sale voided. Stock restored.' });
        });
      });
    });
  });
});

// ============================================
// REPORTS  —  GET /api/sales/reports/summary
// ============================================
router.get('/reports/summary', verifyToken, (req, res) => {
  const { period } = req.query;

  let dateFilter = '1=1';
  switch (period) {
    case 'today':  dateFilter = 'DATE(created_at) = DATE("now")'; break;
    case 'week':   dateFilter = 'DATE(created_at) >= DATE("now", "-7 days")'; break;
    case 'month':  dateFilter = 'strftime("%Y-%m", created_at) = strftime("%Y-%m", "now")'; break;
    case 'year':   dateFilter = 'strftime("%Y", created_at) = strftime("%Y", "now")'; break;
  }

  if (req.userRole !== 'admin') {
    dateFilter += ` AND user_id = ${parseInt(req.userId)}`;
  }

  db.get(
    `SELECT
       COUNT(*) as total_sales,
       COALESCE(SUM(grand_total),0) as total_revenue,
       COALESCE(AVG(grand_total),0) as average_sale,
       COALESCE(SUM(subtotal),0)    as total_subtotal,
       COALESCE(SUM(tax),0)         as total_tax,
       COALESCE(SUM(discount),0)    as total_discount,
       MIN(grand_total) as min_sale,
       MAX(grand_total) as max_sale
     FROM sales WHERE ${dateFilter}`,
    (err, summary) => {
      if (err) return res.status(500).json({ success: false, error: 'Failed.' });

      db.all(
        `SELECT payment_method, COUNT(*) as count, COALESCE(SUM(grand_total),0) as total
         FROM sales WHERE ${dateFilter} GROUP BY payment_method`,
        (err2, payMethods) => {
          db.all(
            `SELECT p.id, p.name, p.sku,
                    SUM(si.quantity) as units_sold,
                    COALESCE(SUM(si.total),0) as revenue
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             JOIN products p ON si.product_id = p.id
             WHERE ${dateFilter.replace(/created_at/g, 's.created_at')}
             GROUP BY p.id ORDER BY units_sold DESC LIMIT 10`,
            (err3, topProducts) => {
              res.json({
                success: true,
                period: period || 'all_time',
                summary: {
                  ...summary,
                  payment_methods: payMethods || [],
                  top_products: topProducts || []
                }
              });
            }
          );
        }
      );
    }
  );
});

// ============================================
// DAILY REPORT  —  GET /api/sales/reports/daily
// ============================================
router.get('/reports/daily', verifyToken, (req, res) => {
  const targetDate = req.query.date || new Date().toISOString().split('T')[0];

  let query = `
    SELECT strftime('%H:00', created_at) as hour,
           COUNT(*) as sales_count,
           COALESCE(SUM(grand_total),0) as total_revenue
    FROM sales WHERE DATE(created_at) = DATE(?)`;

  if (req.userRole !== 'admin') query += ` AND user_id = ${parseInt(req.userId)}`;
  query += ' GROUP BY hour ORDER BY hour';

  db.all(query, [targetDate], (err, data) => {
    if (err) return res.status(500).json({ success: false, error: 'Failed.' });
    res.json({ success: true, date: targetDate, data: data || [] });
  });
});


// MONTHLY REPORT  —  GET /api/sales/reports/monthly

router.get('/reports/monthly', verifyToken, (req, res) => {
  const now = new Date();
  const year  = req.query.year  || now.getFullYear();
  const month = req.query.month || (now.getMonth() + 1);

  let query = `
    SELECT strftime('%Y-%m-%d', created_at) as date,
           COUNT(*) as sales_count,
           COALESCE(SUM(grand_total),0) as total_revenue
    FROM sales
    WHERE strftime('%Y', created_at) = ?
      AND strftime('%m', created_at) = ?`;

  if (req.userRole !== 'admin') query += ` AND user_id = ${parseInt(req.userId)}`;
  query += ' GROUP BY date ORDER BY date';

  db.all(query, [String(year), String(month).padStart(2, '0')], (err, data) => {
    if (err) return res.status(500).json({ success: false, error: 'Failed.' });
    res.json({ success: true, year, month, data: data || [] });
  });
});

module.exports = router;