const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const path = require('path');
const Razorpay = require('razorpay');
const pool = require('./db');
 
const app = express(); 
const PORT = 3000; 
 
app.use(cors()); 
app.use(express.json()); 
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'home.html'));
});

// Test API 
app.get('/api/test', (req, res) => { 
    res.json({ 
        success: true, 
        message: 'Technitude Travels backend is working!' 
    }); 
}); 

const razorpay = new Razorpay({
    key_id: 'rzp_test_TqWKiwLDZP5zK2',      
    key_secret: 'U6WBiiowM3NSLrbf9EHWkikR' 
});

// ==========================================
// CORE USER & BOOKING API ROUTES (Placed at top to avoid 404/static conflicts)
// ==========================================

// Save Booking API (Matches payload from payment.html)
app.post(['/api/bookings/create', '/api/bookings'], async (req, res) => {
    try {
        console.log("Received booking payload:", req.body);

        const bus_id = req.body.bus_id || req.body.busId;
        const journey_date = req.body.journey_date || req.body.date;
        const seats_array = req.body.seats;
        const seats_booked = Array.isArray(seats_array) ? seats_array.join(', ') : (req.body.seats_booked || seats_array);
        const total_amount = req.body.total_amount || req.body.total || req.body.price;
        
        // Passenger & Payment info
        const passenger_name = req.body.passenger_name || 'Guest';
        const phone = req.body.phone || '';
        const email = req.body.email || '';
        const payment_id = req.body.payment_id || req.body.razorpay_payment_id || '';

        let user_id = req.body.user_id || req.body.userId || req.headers['x-user-id'];
        
        if (!user_id && email) {
            const [userRows] = await pool.query('SELECT user_id FROM users WHERE email = ? LIMIT 1', [email]);
            if (userRows.length > 0) {
                user_id = userRows[0].user_id;
            }
        }
        if (!user_id) {
            user_id = 1; // Fallback default user ID if none found
        }

        if (!bus_id || !seats_booked || !total_amount) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields', 
                received: req.body 
            });
        }

        const booking_reference = 'TT-' + Math.floor(100000 + Math.random() * 900000);

        const query = `
            INSERT INTO bookings (
                user_id, 
                bus_id, 
                booking_reference, 
                journey_date, 
                seats_booked, 
                total_amount, 
                booking_status, 
                booking_time
            )
            VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED', NOW())
        `;

        const [result] = await pool.query(query, [
            user_id, 
            bus_id, 
            booking_reference, 
            journey_date || null, 
            String(seats_booked), 
            total_amount
        ]);

        return res.status(201).json({ 
            success: true, 
            message: 'Booking saved successfully', 
            bookingId: result.insertId,
            booking_id: result.insertId,
            booking_reference 
        });
    } catch (error) {
        console.error('Error saving booking:', error);
        return res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

// Get Booked Seats for a Specific Bus & Date
app.get('/api/buses/:id/booked-seats', async (req, res) => {
    try {
        const busId = req.params.id;
        const { date } = req.query;

        console.log(`Fetching booked seats for Bus ID: ${busId} on Date: ${date}`);

        if (!date) {
            return res.status(400).json({ success: false, message: 'Journey date is required' });
        }

        const [bookings] = await pool.query(
            `SELECT seats_booked FROM bookings WHERE bus_id = ? AND journey_date = ? AND booking_status = 'CONFIRMED'`,
            [busId, date]
        );

        // Extract and flatten all booked seats into a single array
        const bookedSeats = [];
        bookings.forEach(row => {
            if (row.seats_booked) {
                row.seats_booked.split(',').forEach(seat => {
                    bookedSeats.push(seat.trim());
                });
            }
        });

        return res.json({ success: true, bookedSeats });
    } catch (error) {
        console.error('Error fetching booked seats:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Create Order API with Double-Booking Concurrency Check
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount, bus_id, date, seats } = req.body;

        // 1. Concurrency Check: Verify if requested seats are already taken
        if (bus_id && date && seats && Array.isArray(seats) && seats.length > 0) {
            const [existingBookings] = await pool.query(
                `SELECT seats_booked FROM bookings WHERE bus_id = ? AND journey_date = ? AND booking_status = 'CONFIRMED'`,
                [bus_id, date]
            );

            const bookedSeatsSet = new Set();
            existingBookings.forEach(row => {
                if (row.seats_booked) {
                    row.seats_booked.split(',').forEach(s => bookedSeatsSet.add(s.trim()));
                }
            });

            const conflict = seats.some(seat => bookedSeatsSet.has(String(seat)));
            if (conflict) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'One or more of your selected seats have just been booked by another user. Please go back and select different seats.' 
                });
            }
        }

        // 2. Proceed with Razorpay Order Creation if seats are available
        const options = {
            amount: Math.round(amount * 100), 
            currency: "INR",
            receipt: "receipt_order_" + Date.now()
        };
        const order = await razorpay.orders.create(options);
        res.json({ success: true, order });
    } catch (error) {
        console.error("Razorpay order error:", error);
        res.status(500).json({ success: false, message: "Failed to create order" });
    }
});

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
            'SELECT user_id FROM users WHERE email = ?', 
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
            `SELECT user_id, full_name, email, phone, password_hash, role, is_active 
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
                id: user.user_id, 
                user_id: user.user_id, 
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
                bus_id, 
                operator_id,
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
 
        const mappedResults = await Promise.all(results.map(async (bus) => {
            // Using the exact same query format as your working booked-seats route
            const [bookings] = await pool.query(
                `SELECT seats_booked FROM bookings WHERE bus_id = ? AND journey_date = ? AND booking_status = 'CONFIRMED'`,
                [bus.bus_id, date]
            );

            // Extract and count booked seats using the exact same logic
            const bookedSeats = [];
            bookings.forEach(row => {
                if (row.seats_booked) {
                    row.seats_booked.split(',').forEach(seat => {
                        const trimmed = seat.trim();
                        if (trimmed) {
                            bookedSeats.push(trimmed);
                        }
                    });
                }
            });

            // Use Set to ensure unique seat counts
            const bookedCount = new Set(bookedSeats).size;
            const availableSeats = Math.max(0, bus.total_seats - bookedCount);

            return {
                ...bus,
                id: bus.bus_id,
                seats_available: availableSeats,
                available_seats: availableSeats
            };
        }));

        return res.json(mappedResults); 
    } catch (error) { 
        console.error('Bus search error:', error);
        return res.status(500).json({ 
            message: 'Database error' 
        }); 
    } 
});
// SUPPORT STAFF & CONTACT ENDPOINTS

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

app.get('/api/support/messages', async (req, res) => {
    try {
        const [messages] = await pool.query(
            `SELECT message_id AS id, message_id, parent_id, full_name, email, phone, subject, message, sender_type, status, created_at 
             FROM support_messages 
             WHERE parent_id IS NULL 
             ORDER BY created_at DESC`
        );
        return res.json(messages);
    } catch (error) {
        console.error('Error fetching support messages:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/support/messages/:id/thread', async (req, res) => {
    try {
        const messageId = req.params.id;
        const [thread] = await pool.query(
            `SELECT message_id AS id, message_id, parent_id, full_name, email, phone, subject, message, sender_type, status, created_at 
             FROM support_messages 
             WHERE message_id = ? OR parent_id = ? 
             ORDER BY created_at ASC`,
            [messageId, messageId]
        );
        return res.json(thread);
    } catch (error) {
        console.error('Error fetching thread:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/support/messages/:id/reply', async (req, res) => {
    try {
        const messageId = req.params.id;
        const { reply_text, sender_name, sender_type } = req.body;

        if (!reply_text) {
            return res.status(400).json({ success: false, message: 'Reply text is required' });
        }

        const [parent] = await pool.query(`SELECT email, full_name FROM support_messages WHERE message_id = ?`, [messageId]);
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

app.get('/api/user/inquiries', async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        const [inquiries] = await pool.query(
            `SELECT message_id AS id, message_id, parent_id, full_name, email, phone, subject, message, sender_type, status, created_at 
             FROM support_messages 
             WHERE email = ? AND parent_id IS NULL 
             ORDER BY created_at DESC`,
            [email]
        );
        return res.json(inquiries);
    } catch (error) {
        console.error('Error fetching user inquiries:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.patch('/api/support/messages/:id/resolve', async (req, res) => {
    try {
        const messageId = req.params.id;
        await pool.query(`UPDATE support_messages SET status = 'RESOLVED' WHERE message_id = ? OR parent_id = ?`, [messageId, messageId]);
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

app.get('/api/operator/reports/summary', verifyOperator, async (req, res) => {
    try {
        const operatorId = req.headers['x-user-id'];
        const [summary] = await pool.query(
            `SELECT 
                COUNT(DISTINCT b.bus_id) AS total_buses,
                COUNT(DISTINCT b.bus_id) AS total_schedules,
                COUNT(DISTINCT bk.booking_id) AS total_bookings,
                IFNULL(SUM(bk.total_amount), 0) AS total_revenue
             FROM buses b
             LEFT JOIN bookings bk ON b.bus_id = bk.bus_id
             WHERE b.operator_id = ?`,
            [operatorId]
        );
        res.json(summary[0]);
    } catch (error) {
        console.error('Error fetching operator summary:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/operator/buses', verifyOperator, async (req, res) => {
    try {
        const operatorId = req.headers['x-user-id'];
        const [buses] = await pool.query('SELECT *, bus_id AS id FROM buses WHERE operator_id = ?', [operatorId]);
        res.json(buses);
    } catch (error) {
        console.error('Error fetching operator buses:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

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

app.get('/api/operator/schedules', verifyOperator, async (req, res) => {
    try {
        const operatorId = req.headers['x-user-id'];
        const [schedules] = await pool.query(
            `SELECT bus_id AS id, bus_id, bus_name, bus_number, from_city, to_city, journey_date, departure_time, arrival_time, price 
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

app.put('/api/operator/buses/:id', verifyOperator, async (req, res) => {
    try {
        const operatorId = req.headers['x-user-id'];
        const busId = req.params.id;
        const { bus_name, bus_number, bus_type, total_seats, from_city, to_city, journey_date, departure_time, arrival_time, price } = req.body;

        const [existing] = await pool.query('SELECT bus_id FROM buses WHERE bus_id = ? AND operator_id = ?', [busId, operatorId]);
        if (existing.length === 0) {
            return res.status(403).json({ success: false, message: 'Unauthorized or bus not found' });
        }

        await pool.query(
            `UPDATE buses 
             SET bus_name = ?, bus_number = ?, bus_type = ?, total_seats = ?, 
                 from_city = ?, to_city = ?, journey_date = ?, departure_time = ?, arrival_time = ?, price = ? 
             WHERE bus_id = ? AND operator_id = ?`,
            [bus_name, bus_number, bus_type, total_seats, from_city, to_city, journey_date, departure_time, arrival_time, price, busId, operatorId]
        );

        res.json({ success: true, message: 'Bus and route updated successfully' });
    } catch (error) {
        console.error('Error updating bus:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/operator/buses/:id/fleet', verifyOperator, async (req, res) => {
    try {
        const operatorId = req.headers['x-user-id'];
        const busId = req.params.id;
        const { bus_name, bus_number, bus_type, total_seats, price } = req.body;

        await pool.query(
            `UPDATE buses 
             SET bus_name = ?, bus_number = ?, bus_type = ?, total_seats = ?, price = ? 
             WHERE bus_id = ? AND operator_id = ?`,
            [bus_name, bus_number, bus_type, total_seats, price, busId, operatorId]
        );
        res.json({ success: true, message: 'Bus fleet details and price updated successfully' });
    } catch (error) {
        console.error('Error updating bus fleet:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/operator/buses/:id/route', verifyOperator, async (req, res) => {
    try {
        const operatorId = req.headers['x-user-id'];
        const busId = req.params.id;
        const { from_city, to_city, journey_date, departure_time, arrival_time, price } = req.body;

        await pool.query(
            `UPDATE buses 
             SET from_city = ?, to_city = ?, journey_date = ?, departure_time = ?, arrival_time = ?, price = ? 
             WHERE bus_id = ? AND operator_id = ?`,
            [from_city, to_city, journey_date, departure_time, arrival_time, price, busId, operatorId]
        );
        res.json({ success: true, message: 'Route schedule updated successfully' });
    } catch (error) {
        console.error('Error updating route schedule:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/user/bookings', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) {
            return res.status(400).json({ success: false, message: 'User ID is required' });
        }

        const query = `
            SELECT 
                bk.booking_id AS id,
                bk.booking_id,
                bk.booking_reference,
                bk.journey_date,
                bk.seats_booked,
                bk.total_amount,
                bk.booking_status,
                b.bus_name,
                b.bus_type,
                b.from_city,
                b.to_city,
                b.departure_time,
                b.arrival_time
            FROM bookings bk
            JOIN buses b ON bk.bus_id = b.bus_id
            WHERE bk.user_id = ?
            ORDER BY bk.booking_time DESC
        `;

        const [userBookings] = await pool.query(query, [userId]);
        return res.json(userBookings);
    } catch (error) {
        console.error('Error fetching user bookings:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.patch('/api/user/bookings/:id/cancel', async (req, res) => {
    try {
        const bookingId = req.params.id;
        const userId = req.headers['x-user-id'];

        const [existing] = await pool.query(
            'SELECT booking_id FROM bookings WHERE booking_id = ? AND user_id = ?', 
            [bookingId, userId]
        );

        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        await pool.query(
            `UPDATE bookings SET booking_status = 'CANCELLED' WHERE booking_id = ?`, 
            [bookingId]
        );

        return res.json({ success: true, message: 'Booking cancelled successfully' });
    } catch (error) {
        console.error('Error cancelling booking:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Start server 
app.listen(PORT, () => { 
    console.log(`Technitude Travels server running at http://localhost:${PORT}`); 
});
