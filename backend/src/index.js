require('dotenv').config();
const express = require('express');
const { initSchema } = require('./db');

const registerRoutes = require('./routes/register');
const adminRoutes    = require('./routes/admin');

const app  = express();
const PORT = process.env.API_PORT || 3000;

app.use(express.json());

// ── Routes ──────────────────────────────────
// /register/:staffId          GET  — fetch register (resolves tokens to names)
// /register/:staffId/submit   POST — submit or sync register
// /admin/dashboard/:adminId   GET  — admin overview of all registers
app.use('/register', registerRoutes);
app.use('/admin',    adminRoutes);

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
