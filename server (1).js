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
// If your HTML files are elsewhere, we can adjust this path later. 
app.use(express.static(path.join(__dirname, '..', 'frontend'))); 
 
// Test API 
app.get('/api/test', (req, res) => { 
    res.json({ 
        success: true, 
        message: 'Technitude Travels backend is working!' 
    }); 
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
 
// Start server 
app.listen(PORT, () => { 
    console.log(`Technitude Travels server running at http://localhost:${PORT}`); 
});
