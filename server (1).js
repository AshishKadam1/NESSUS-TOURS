
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// MySQL Connection
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "kali",
    database: "Technitude"
});

db.connect((err) => {
    if (err) {
        console.error("Database connection failed:", err.message);
        return;
    }

    console.log("MySQL connected successfully!");
});

// Home Page
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "home.html"));
});

// Search Buses API
app.get("/api/buses", (req, res) => {
    const { from, to, date } = req.query;

    if (!from || !to || !date) {
        return res.status(400).json({
            message: "From, To and Journey Date are required"
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

    db.query(sql, [from, to, date], (err, results) => {
        if (err) {
            console.error("MySQL query error:", err.message);

            return res.status(500).json({
                message: "Database error"
            });
        }

        console.log("Buses found:", results.length);
        return res.json(results);
    });
});

// Start Server
app.listen(3000, () => {
    console.log("Server running at http://localhost:3000");
});

const bcrypt = require("bcryptjs");

// REGISTER API
app.post("/api/register", async (req, res) => {
    const { full_name, email, phone, password, role } = req.body;

    if (!full_name || !email || !phone || !password || !role) {
        return res.status(400).json({
            success: false,
            message: "All fields are required"
        });
    }

    if (!/^\d{10}$/.test(phone) || password.length < 6) {
        return res.status(400).json({
            success: false,
            message: "Enter a valid phone number and password"
        });
    }

    const allowedRoles = ["CUSTOMER", "AGENT", "OPERATOR", "SUPPORT"];

    if (!allowedRoles.includes(role)) {
        return res.status(400).json({
            success: false,
            message: "Invalid account type"
        });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        const sql = `
            INSERT INTO users (full_name, email, phone, password, role)
            VALUES (?, ?, ?, ?, ?)
        `;

        db.query(
            sql,
            [full_name.trim(), email.trim().toLowerCase(),
             phone, hashedPassword, role],
            (err, result) => {
                if (err) {
                    if (err.code === "ER_DUP_ENTRY") {
                        return res.status(409).json({
                            success: false,
                            message: "Email or mobile number already registered"
                        });
                    }

                    console.error("Registration error:", err.message);
                    return res.status(500).json({
                        success: false,
                        message: "Registration failed"
                    });
                }

                return res.status(201).json({
                    success: true,
                    message: "Registration successful"
                });
            }
        );
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});


// LOGIN API
app.post("/api/login", (req, res) => {
    const { emailOrMobile, password } = req.body;

    if (!emailOrMobile || !password) {
        return res.status(400).json({
            success: false,
            message: "Email/mobile and password are required"
        });
    }

    const identifier = emailOrMobile.trim();

    const sql = `
        SELECT id, full_name, email, phone, password, role
        FROM users
        WHERE email = ? OR phone = ?
        LIMIT 1
    `;

    db.query(
        sql,
        [identifier.toLowerCase(), identifier],
        async (err, results) => {
            if (err) {
                console.error("Login error:", err.message);
                return res.status(500).json({
                    success: false,
                    message: "Login failed"
                });
            }

            if (results.length === 0) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid email/mobile or password"
                });
            }

            try {
                const user = results[0];
                const passwordMatches = await bcrypt.compare(
                    password,
                    user.password
                );

                if (!passwordMatches) {
                    return res.status(401).json({
                        success: false,
                        message: "Invalid email/mobile or password"
                    });
                }

                return res.json({
                    success: true,
                    message: "Login successful",
                    user: {
                        id: user.id,
                        full_name: user.full_name,
                        email: user.email,
                        phone: user.phone,
                        role: user.role
                    }
                });
            } catch (error) {
                console.error(error);
                return res.status(500).json({
                    success: false,
                    message: "Server error"
                });
            }
        }
    );
});
