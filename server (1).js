const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const path = require('path');
const pool = require('./db');
 
const app = express(); 
const PORT = 3000; 
 
app.use(cors()); 
app.use(express.json()); 
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'home.html'));
});
// Serve frontend files from the frontend folder if present. 
app.use(express.static(path.join(__dirname, '..', 'frontend'))); 
 
// Test API 
app.get('/api/test', (req, res) => { 
    res.json({ 
        success: true, 
        message: 'Technitude Travels backend is working!' 
    }); 
}); 


function allowRoles(...allowedRoles) {
    return (req, res, next) => {
        const role = req.user?.role;

        if (!role || !allowedRoles.includes(role)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied: insufficient permissions'
            });
        }

        next();
    };
}

// Registration API 
app.post('/api/register', async (req, res) => { 
    try { 
        const { full_name, email, phone, password, role } = req.body; 
 
        if (!full_name || !email || !phone || !password) { 
            return res.status(400).json({ 
                success: false, 
                message: 'All fields are required' 
            }); 
        } 
 
        const allowedRoles = ['CUSTOMER', 'AGENT', 'OPERATOR', 'SUPPORT']; 
 
        if (!allowedRoles.includes(role)) { 
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid account type' 
            }); 
        } 
 
        const [existingUser] = await pool.query( 
            'SELECT id FROM users WHERE email = ?', 
            [email] 
        ); 
 
        if (existingUser.length > 0) { 
            return res.status(409).json({ 
                success: false, 
                message: 'Email is already registered' 
            }); 
        } 
 
        const passwordHash = await bcrypt.hash(password, 10); 
 
        const [result] = await pool.query( 
            `INSERT INTO users 
             (full_name, email, phone, password_hash, role) 
             VALUES (?, ?, ?, ?, ?)`, 
            [full_name, email, phone, passwordHash, role] 
        ); 
 
        return res.status(201).json({ 
            success: true, 
            message: 'Registration successful', 
            userId: result.insertId 
        }); 
    } catch (error) { 
        console.error('Registration error:', error); 
 
        if (error.code === 'ER_DUP_ENTRY') { 
            return res.status(409).json({ 
                success: false, 
                message: 'Email or phone number is already registered' 
            }); 
        } 
 
        return res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        }); 
    } 
}); 
 
// Login API 
app.post('/api/login', async (req, res) => { 
    try { 
        const { emailOrMobile, password } = req.body; 
 
        if (!emailOrMobile || !password) { 
            return res.status(400).json({ 
                success: false, 
                message: 'Email/mobile and password are required' 
            }); 
        } 
 
        const [users] = await pool.query( 
            `SELECT id, full_name, email, phone, password_hash, role, is_active 
             FROM users 
             WHERE email = ? OR phone = ? 
             LIMIT 1`, 
            [emailOrMobile, emailOrMobile] 
        ); 
 
        if (users.length === 0) { 
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email/mobile or password' 
            }); 
        } 
 
        const user = users[0]; 
 
        if (!user.is_active) { 
            return res.status(403).json({ 
                success: false, 
                message: 'Your account is inactive' 
            }); 
        } 
 
        const passwordMatch = await bcrypt.compare( 
            password, 
            user.password_hash 
        ); 
 
        if (!passwordMatch) { 
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email/mobile or password' 
            }); 
        } 
 
        return res.json({ 
            success: true, 
            message: 'Login successful', 
            user: { 
                id: user.id, 
                full_name: user.full_name, 
                email: user.email, 
                phone: user.phone, 
                role: user.role 
            } 
        }); 
    } catch (error) { 
        console.error('Login error:', error); 
        return res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        }); 
    } 
}); 
 
// Bus Search API 
app.get('/api/buses', async (req, res) => { 
    try { 
        const { from, to, date } = req.query; 
 
        if (!from || !to || !date) { 
            return res.status(400).json({ 
                message: 'From, To and Journey Date are required' 
            }); 
        } 
 
        const sql = ` 
            SELECT 
                id, 
                bus_name, 
                bus_number, 
                bus_type, 
                from_city, 
                to_city, 
                journey_date, 
                departure_time, 
                arrival_time, 
                price, 
                total_seats 
            FROM buses 
            WHERE LOWER(TRIM(from_city)) = LOWER(TRIM(?)) 
              AND LOWER(TRIM(to_city)) = LOWER(TRIM(?)) 
              AND journey_date = ? 
            ORDER BY departure_time ASC 
        `; 
 
        const [results] = await pool.query(sql, [from, to, date]); 
 
        return res.json(results); 
    } catch (error) { 
        console.error('Bus search error:', error); 
        return res.status(500).json({ 
            message: 'Database error' 
        }); 
    } 
}); 


// ==========================================
// SUPPORT STAFF & CONTACT ENDPOINTS
// ==========================================

// 1. Public API: Save contact form submission (Main Inquiry)
app.post('/api/contact', async (req, res) => {
    try {
        const { full_name, email, phone, subject, message } = req.body;

        if (!full_name || !email || !message) {
            return res.status(400).json({ success: false, message: 'Name, email, and message are required' });
        }

        const query = `
            INSERT INTO support_messages (parent_id, full_name, email, phone, subject, message, sender_type, status) 
            VALUES (NULL, ?, ?, ?, ?, ?, 'CUSTOMER', 'PENDING')
        `;
        await pool.query(query, [full_name, email, phone || null, subject || 'General Inquiry', message]);

        return res.status(201).json({ success: true, message: 'Message sent successfully' });
    } catch (error) {
        console.error('Contact submission error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// 2. API: Get all main contact inquiries for Support Inbox (where parent_id IS NULL)
app.get('/api/support/messages', async (req, res) => {
    try {
        const [messages] = await pool.query(
            `SELECT * FROM support_messages WHERE parent_id IS NULL ORDER BY created_at DESC`
        );
        return res.json(messages);
    } catch (error) {
        console.error('Error fetching support messages:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// 3. API: Get full conversation thread (Initial message + all replies) for a specific ID
app.get('/api/support/messages/:id/thread', async (req, res) => {
    try {
        const messageId = req.params.id;
        const [thread] = await pool.query(
            `SELECT * FROM support_messages WHERE id = ? OR parent_id = ? ORDER BY created_at ASC`,
            [messageId, messageId]
        );
        return res.json(thread);
    } catch (error) {
        console.error('Error fetching thread:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// 4. API: Send a reply (Supports both Support Staff and Customer replies)
app.post('/api/support/messages/:id/reply', async (req, res) => {
    try {
        const messageId = req.params.id;
        const { reply_text, sender_name, sender_type } = req.body;

        if (!reply_text) {
            return res.status(400).json({ success: false, message: 'Reply text is required' });
        }

        const [parent] = await pool.query(`SELECT email, full_name FROM support_messages WHERE id = ?`, [messageId]);
        if (parent.length === 0) {
            return res.status(404).json({ success: false, message: 'Message thread not found' });
        }

        const type = sender_type || 'SUPPORT';
        const name = sender_name || (type === 'SUPPORT' ? 'Support Team' : parent[0].full_name);

        const query = `
            INSERT INTO support_messages (parent_id, full_name, email, message, sender_type) 
            VALUES (?, ?, ?, ?, ?)
        `;
        await pool.query(query, [messageId, name, parent[0].email, reply_text, type]);

        return res.status(201).json({ success: true, message: 'Reply sent successfully' });
    } catch (error) {
        console.error('Error sending reply:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// 5. API: Get customer inquiries by email so they can view their tickets
app.get('/api/user/inquiries', async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        const [inquiries] = await pool.query(
            `SELECT * FROM support_messages WHERE email = ? AND parent_id IS NULL ORDER BY created_at DESC`,
            [email]
        );
        return res.json(inquiries);
    } catch (error) {
        console.error('Error fetching user inquiries:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// 5. API: Mark a contact message as resolved
app.patch('/api/support/messages/:id/resolve', async (req, res) => {
    try {
        const messageId = req.params.id;
        await pool.query(`UPDATE support_messages SET status = 'RESOLVED' WHERE id = ? OR parent_id = ?`, [messageId, messageId]);
        return res.json({ success: true, message: 'Message marked as resolved' });
    } catch (error) {
        console.error('Error updating message status:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ==========================================
// OPERATOR MODULE APIS
// ==========================================

function verifyOperator(req, res, next) {
    const userRole = req.headers['x-user-role'];
    if (userRole === 'OPERATOR' || userRole === 'ADMIN') {
        return next();
    }
    return res.status(403).json({ success: false, message: 'Access denied. Operators only.' });
}

// 1. Get Operator Dashboard Summary & Reports
app.get('/api/operator/reports/summary', verifyOperator, async (req, res) => {
    try {
        const operatorId = req.headers['x-user-id'];
        const [summary] = await pool.query(
            `SELECT 
                COUNT(DISTINCT b.id) AS total_buses,
                COUNT(DISTINCT b.id) AS total_schedules,
                COUNT(DISTINCT bk.id) AS total_bookings,
                IFNULL(SUM(bk.total_amount), 0) AS total_revenue
             FROM buses b
             LEFT JOIN bookings bk ON b.id = bk.bus_id
             WHERE b.operator_id = ?`,
            [operatorId]
        );
        res.json(summary[0]);
    } catch (error) {
        console.error('Error fetching operator summary:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// 2. Get Buses for the Logged-in Operator
app.get('/api/operator/buses', verifyOperator, async (req, res) => {
    try {
        const operatorId = req.headers['x-user-id'];
        const [buses] = await pool.query('SELECT * FROM buses WHERE operator_id = ?', [operatorId]);
        res.json(buses);
    } catch (error) {
        console.error('Error fetching operator buses:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// 3. Add a New Bus / Schedule Entry for the Operator
app.post('/api/operator/buses', verifyOperator, async (req, res) => {
    try {
        const operatorId = req.headers['x-user-id'];
        const { bus_name, bus_number, bus_type, total_seats, from_city, to_city, journey_date, departure_time, arrival_time, price } = req.body;

        if (!bus_name || !bus_number || !total_seats) {
            return res.status(400).json({ success: false, message: 'Bus name, number, and total seats are required' });
        }

        await pool.query(
            `INSERT INTO buses (operator_id, bus_name, bus_number, bus_type, total_seats, from_city, to_city, journey_date, departure_time, arrival_time, price) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [operatorId, bus_name, bus_number, bus_type || 'AC Sleeper', total_seats, from_city || 'Kolhapur', to_city || 'Pune', journey_date || '2026-10-20', departure_time || '08:00:00', arrival_time || '14:00:00', price || 500.00]
        );

        res.status(201).json({ success: true, message: 'Bus added successfully' });
    } catch (error) {
        console.error('Error adding bus:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// 4. Get Schedules / Routes for the Operator's Fleet
app.get('/api/operator/schedules', verifyOperator, async (req, res) => {
    try {
        const operatorId = req.headers['x-user-id'];
        const [schedules] = await pool.query(
            `SELECT id, bus_name, bus_number, from_city, to_city, journey_date, departure_time, arrival_time, price 
             FROM buses 
             WHERE operator_id = ? 
             ORDER BY journey_date DESC`,
            [operatorId]
        );
        res.json(schedules);
    } catch (error) {
        console.error('Error fetching operator schedules:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// 5. Update Bus, Route, and Pricing Details for the Operator
app.put('/api/operator/buses/:id', verifyOperator, async (req, res) => {
    try {
        const operatorId = req.headers['x-user-id'];
        const busId = req.params.id;
        const { bus_name, bus_number, bus_type, total_seats, from_city, to_city, journey_date, departure_time, arrival_time, price } = req.body;

        // Verify that this bus belongs to the logged-in operator
        const [existing] = await pool.query('SELECT id FROM buses WHERE id = ? AND operator_id = ?', [busId, operatorId]);
        if (existing.length === 0) {
            return res.status(403).json({ success: false, message: 'Unauthorized or bus not found' });
        }

        await pool.query(
            `UPDATE buses 
             SET bus_name = ?, bus_number = ?, bus_type = ?, total_seats = ?, 
                 from_city = ?, to_city = ?, journey_date = ?, departure_time = ?, arrival_time = ?, price = ? 
             WHERE id = ? AND operator_id = ?`,
            [bus_name, bus_number, bus_type, total_seats, from_city, to_city, journey_date, departure_time, arrival_time, price, busId, operatorId]
        );

        res.json({ success: true, message: 'Bus and route updated successfully' });
    } catch (error) {
        console.error('Error updating bus:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update Bus Fleet Details & Price (Bus Management)
app.put('/api/operator/buses/:id/fleet', verifyOperator, async (req, res) => {
    try {
        const operatorId = req.headers['x-user-id'];
        const busId = req.params.id;
        const { bus_name, bus_number, bus_type, total_seats, price } = req.body;

        await pool.query(
            `UPDATE buses 
             SET bus_name = ?, bus_number = ?, bus_type = ?, total_seats = ?, price = ? 
             WHERE id = ? AND operator_id = ?`,
            [bus_name, bus_number, bus_type, total_seats, price, busId, operatorId]
        );
        res.json({ success: true, message: 'Bus fleet details and price updated successfully' });
    } catch (error) {
        console.error('Error updating bus fleet:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update Route & Schedule Details Only (Routes & Schedules)
app.put('/api/operator/buses/:id/route', verifyOperator, async (req, res) => {
    try {
        const operatorId = req.headers['x-user-id'];
        const busId = req.params.id;
        const { from_city, to_city, journey_date, departure_time, arrival_time, price } = req.body;

        await pool.query(
            `UPDATE buses 
             SET from_city = ?, to_city = ?, journey_date = ?, departure_time = ?, arrival_time = ?, price = ? 
             WHERE id = ? AND operator_id = ?`,
            [from_city, to_city, journey_date, departure_time, arrival_time, price, busId, operatorId]
        );
        res.json({ success: true, message: 'Route schedule updated successfully' });
    } catch (error) {
        console.error('Error updating route schedule:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Start server 
app.listen(PORT, () => { 
    console.log(`Technitude Travels server running at http://localhost:${PORT}`); 
});
