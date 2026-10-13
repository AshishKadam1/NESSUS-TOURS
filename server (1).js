
// ========================================
// TECHNITUDE TOURS & TRAVELS
// Express + MySQL + Wallet Payment
// ========================================

const express = require("express");
const mysql = require("mysql2");
const mysqlPromise = require("mysql2/promise");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ========================================
// MYSQL CONNECTIONS
// ========================================

const dbConfig = {
    host: "localhost",
    user: "root",
    password: process.env.DB_PASSWORD || "kali",
    database: "Technitude"
};

// Existing APIs: bus search, register and login
const db = mysql.createConnection(dbConfig);

// Wallet APIs: async queries and transactions
const walletDb = mysqlPromise.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.connect((err) => {
    if (err) {
        console.error("MySQL connection failed:", err.message);
        return;
    }

    console.log("MySQL connected successfully!");
});

// ========================================
// HOME PAGE
// ========================================

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "home.html"));
});

// ========================================
// SEARCH BUSES
// ========================================

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
            console.error("Bus search error:", err.message);

            return res.status(500).json({
                message: "Database error while searching buses"
            });
        }

        res.json(results);
    });
});

// ========================================
// WALLET BALANCE
// ========================================

app.get("/api/wallet-balance", async (req, res) => {
    try {
        // DEMO ONLY: customer ID 1
        const customerId = 1;

        const [rows] = await walletDb.execute(
            `SELECT balance
             FROM customer_wallets
             WHERE customer_id = ?`,
            [customerId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                message: "Wallet not found. Create a demo wallet first."
            });
        }

        res.json({
            balance: Number(rows[0].balance)
        });

    } catch (error) {
        console.error("Wallet balance error:", error.message);

        res.status(500).json({
            message: "Unable to load wallet balance"
        });
    }
});

// ========================================
// WALLET PAYMENT + BOOKING
// ========================================

app.post("/api/wallet-pay", async (req, res) => {
    let connection;
    let transactionStarted = false;

    try {
        const {
            bus_id,
            date,
            seats,
            passenger_name,
            age,
            gender,
            phone,
            email
        } = req.body;

        const busId = Number(bus_id);
        const passengerAge = Number(age);
        const seatNumbers = Array.isArray(seats)
            ? seats.map(Number)
            : [];

        const name = String(passenger_name || "").trim();
        const mobile = String(phone || "").trim();
        const mail = String(email || "").trim();

        const validGenders = [
            "Male",
            "Female",
            "Other",
            "Prefer not to say"
        ];

        // Validate bus ID
        if (!Number.isInteger(busId) || busId < 1) {
            return res.status(400).json({
                message: "Invalid bus ID"
            });
        }

        // Validate date format
        
        // Validate and normalize journey date
        const journeyDate = String(date || "").slice(0, 10);

        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(journeyDate) ||
            Number.isNaN(Date.parse(journeyDate)) ||
            new Date(journeyDate).toISOString().slice(0, 10) !== journeyDate
        ) {
            return res.status(400).json({
                message: "Invalid journey date"
            });
        }


        const parsedDate = new Date(date + "T00:00:00Z");

        if (
            Number.isNaN(parsedDate.getTime()) ||
            parsedDate.toISOString().slice(0, 10) !== date
        ) {
            return res.status(400).json({
                message: "Invalid journey date"
            });
        }

        // Validate seats
        if (
            seatNumbers.length === 0 ||
            seatNumbers.some(
                seat => !Number.isInteger(seat) || seat < 1
            ) ||
            new Set(seatNumbers).size !== seatNumbers.length
        ) {
            return res.status(400).json({
                message: "Invalid seat selection"
            });
        }

        // Validate passenger
        if (
            !name ||
            name.length > 100 ||
            !Number.isInteger(passengerAge) ||
            passengerAge < 1 ||
            passengerAge > 120
        ) {
            return res.status(400).json({
                message: "Invalid passenger details"
            });
        }

        if (!validGenders.includes(gender)) {
            return res.status(400).json({
                message: "Invalid gender"
            });
        }

        if (!/^[6-9]\d{9}$/.test(mobile)) {
            return res.status(400).json({
                message: "Enter a valid 10-digit mobile number"
            });
        }

        if (
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) ||
            mail.length > 150
        ) {
            return res.status(400).json({
                message: "Enter a valid email address"
            });
        }

        // DEMO ONLY. Replace with authenticated customer ID.
        const customerId = 1;

        connection = await walletDb.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        // Lock wallet to prevent concurrent overspending
        const [walletRows] = await connection.execute(
            `SELECT balance
             FROM customer_wallets
             WHERE customer_id = ?
             FOR UPDATE`,
            [customerId]
        );

        if (walletRows.length === 0) {
            const error = new Error("Wallet not found");
            error.statusCode = 404;
            throw error;
        }

        // Get the actual fare and seat count from MySQL
        const [busRows] = await connection.execute(
            `SELECT id, price, total_seats
             FROM buses
             WHERE id = ? AND journey_date = ?
             LIMIT 1`,
            
[busId, journeyDate]

        );

        if (busRows.length === 0) {
            const error = new Error(
                "Bus not found for the selected journey date"
            );
            error.statusCode = 404;
            throw error;
        }

        const price = Number(busRows[0].price);
        const totalSeats = Number(busRows[0].total_seats);

        if (
            !Number.isFinite(price) ||
            price <= 0 ||
            !Number.isInteger(totalSeats) ||
            totalSeats < 1
        ) {
            const error = new Error("Invalid bus fare or seat count");
            error.statusCode = 400;
            throw error;
        }

        if (seatNumbers.some(seat => seat > totalSeats)) {
            const error = new Error("Selected seat number is invalid");
            error.statusCode = 400;
            throw error;
        }

        // DEMO: Coupon discount is not applied.
        // Fare is calculated on the server, not trusted from the browser.
        const baseFare = Number(
            (price * seatNumbers.length).toFixed(2)
        );

        const discount = 0;
        const total = baseFare;

        const balanceBefore = Number(walletRows[0].balance);

        if (balanceBefore < total) {
            const error = new Error("Insufficient wallet balance");
            error.statusCode = 400;
            error.walletBalance = balanceBefore;
            error.requiredAmount = total;
            throw error;
        }

        // Create booking
        const [bookingResult] = await connection.execute(
            `INSERT INTO bookings
            (
                customer_id,
                bus_id,
                passenger_name,
                age,
                gender,
                phone,
                email,
                journey_date,
                seats_count,
                base_fare,
                discount,
                total_amount,
                payment_method,
                payment_status,
                booking_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    'WALLET', 'PAID', 'CONFIRMED')`,
            [
                customerId,
                busId,
                name,
                passengerAge,
                gender,
                mobile,
                mail,
                date,
                seatNumbers.length,
                baseFare,
                discount,
                total
            ]
        );

        const bookingId = bookingResult.insertId;

        // Insert selected seats.
        // A unique key should prevent double-booking.
        for (const seatNumber of seatNumbers) {
            await connection.execute(
                `INSERT INTO booking_seats
                (booking_id, bus_id, journey_date, seat_number)
                VALUES (?, ?, ?, ?)`,
                [bookingId, 
busId, journeyDate]
, seatNumber);
        }

        // Deduct wallet balance
        const [walletUpdate] = await connection.execute(
            `UPDATE customer_wallets
             SET balance = balance - ?
             WHERE customer_id = ? AND balance >= ?`,
            [total, customerId, total]
        );

        if (walletUpdate.affectedRows !== 1) {
            throw new Error(
                "Wallet balance changed. Please try again."
            );
        }

        const balanceAfter = Number(
            (balanceBefore - total).toFixed(2)
        );

        // Save wallet transaction history
        await connection.execute(
            `INSERT INTO wallet_transactions
            (
                customer_id,
                booking_id,
                transaction_type,
                amount,
                balance_before,
                balance_after,
                description
            )
            VALUES (?, ?, 'DEBIT', ?, ?, ?, ?)`,
            [
                customerId,
                bookingId,
                total,
                balanceBefore,
                balanceAfter,
                `Bus booking #${bookingId}`
            ]
        );

        await connection.commit();
        transactionStarted = false;

        return res.status(201).json({
            success: true,
            message: "Wallet payment successful",
            bookingId,
            busId,
            journeyDate: date,
            seats: seatNumbers,
            amountDeducted: total,
            walletBalance: balanceAfter
        });

    } catch (error) {
        if (connection && transactionStarted) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error(
                    "Rollback error:",
                    rollbackError.message
                );
            }
        }

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                message:
                    "A selected seat is already booked. Please choose another seat."
            });
        }

        if (error.walletBalance !== undefined) {
            return res.status(400).json({
                message: error.message,
                walletBalance: error.walletBalance,
                requiredAmount: error.requiredAmount
            });
        }

        console.error("Wallet payment error:", error.message);

        return res.status(error.statusCode || 500).json({
            message: error.statusCode
                ? error.message
                : "Wallet payment failed"
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// ========================================
// REGISTER API
// ========================================

app.post("/api/register", (req, res) => {
    const {
        full_name,
        email,
        phone,
        password,
        role
    } = req.body;

    if (!full_name || !email || !phone || !password || !role) {
        return res.status(400).json({
            success: false,
            message: "All fields are required"
        });
    }

    if (
        !/^[6-9]\d{9}$/.test(String(phone)) ||
        String(password).length < 6
    ) {
        return res.status(400).json({
            success: false,
            message: "Enter a valid phone number and password"
        });
    }

    const allowedRoles = [
        "CUSTOMER",
        "AGENT",
        "OPERATOR",
        "SUPPORT"
    ];

    if (!allowedRoles.includes(role)) {
        return res.status(400).json({
            success: false,
            message: "Invalid account type"
        });
    }

    bcrypt.hash(password, 10)
        .then(hashedPassword => {
            const sql = `
                INSERT INTO users
                (full_name, email, phone, password, role)
                VALUES (?, ?, ?, ?, ?)
            `;

            db.query(
                sql,
                [
                    String(full_name).trim(),
                    String(email).trim().toLowerCase(),
                    phone,
                    hashedPassword,
                    role
                ],
                (err) => {
                    if (err) {
                        if (err.code === "ER_DUP_ENTRY") {
                            return res.status(409).json({
                                success: false,
                                message:
                                    "Email or mobile number already registered"
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
        })
        .catch(error => {
            console.error("Password hashing error:", error.message);

            res.status(500).json({
                success: false,
                message: "Registration failed"
            });
        });
});

// ========================================
// LOGIN API
// ========================================

app.post("/api/login", (req, res) => {
    const { emailOrMobile, password } = req.body;

    if (!emailOrMobile || !password) {
        return res.status(400).json({
            success: false,
            message: "Email/mobile and password are required"
        });
    }

    const identifier = String(emailOrMobile).trim();

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

                // This endpoint verifies credentials only.
                // Session/authentication setup is not implemented here.
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
                console.error("Login error:", error.message);

                return res.status(500).json({
                    success: false,
                    message: "Server error"
                });
            }
        }
    );
});

// ========================================
// START SERVER - KEEP AT THE END
// ========================================

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
