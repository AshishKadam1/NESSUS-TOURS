const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const pool = require('./db');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Test route
app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'Nessus Tours & Travels backend is working!'
    });
});

// Registration API
app.post('/api/register', async (req, res) => {
    try {
        const { full_name, email, phone, password, role } = req.body;   

        // Check required fields
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

        // Check if email already exists
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

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Insert user
        const [result] = await pool.query(
            `INSERT INTO users
            (full_name, email, phone, password_hash, role)
             VALUES (?, ?, ?, ?, ?)`,
            [full_name, email, phone, passwordHash, role]
        );

        res.status(201).json({
            success: true,
            message: 'Registration successful',
            userId: result.insertId
        });

    } catch (error) {
        console.error('Registration error:', error);

        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});
// Login API
app.post('/api/login', async (req, res) => {
    try {
        const { emailOrMobile, password } = req.body;

        // Check required fields
        if (!emailOrMobile || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email/mobile and password are required'
            });
        }

        // Find user by email OR mobile number
        const [users] = await pool.query(
            `SELECT id, full_name, email, phone, password_hash, role, is_active
             FROM users
             WHERE email = ? OR phone = ?
             LIMIT 1`,
            [emailOrMobile, emailOrMobile]
        );

        // User not found
        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email/mobile or password'
            });
        }

        const user = users[0];

        // Check if account is active
        if (!user.is_active) {
            return res.status(403).json({
                success: false,
                message: 'Your account is inactive'
            });
        }

        // Compare entered password with hashed password
        const passwordMatch = await bcrypt.compare(
            password,
            user.password_hash
        );

        // Wrong password
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email/mobile or password'
            });
        }

        // Login successful
        res.json({
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

        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});
// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});