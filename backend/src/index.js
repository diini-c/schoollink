require('dotenv').config();
const express = require('express');
const { initSchema } = require('./db');

const { verifyToken } = require('./middleware/auth');
const authRoutes     = require('./routes/auth');
const registerRoutes = require('./routes/register');
const adminRoutes    = require('./routes/admin');

const app  = express();
const PORT = process.env.API_PORT || 3000;

app.use(express.json());

// ── Routes ──────────────────────────────────
// POST /auth/login              — public, issues JWT
// GET  /register                — teacher fetches their register (was /:staffId)
// POST /register/submit         — teacher submits marks      (was /:staffId/submit)
// GET  /admin/dashboard         — admin overview             (was /dashboard/:adminId)
app.use('/auth',     authRoutes);
app.use('/register', verifyToken, registerRoutes);
app.use('/admin',    verifyToken, adminRoutes);

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── Boot ─────────────────────────────────────
async function start() {
  try {
    await initSchema();
    app.listen(PORT, () => {
      console.log(`SchoolLink API running on port ${PORT}`);
      console.log(`Health: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
