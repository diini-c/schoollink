'use strict';
const express  = require('express');
const { WorkOS } = require('@workos-inc/node');

const router = express.Router();
const workos = new WorkOS(process.env.WORKOS_API_KEY);

// ─────────────────────────────────────────────
// POST /auth/login
// Body:    { email, password }
// Returns: { accessToken, staff: { id, name, role } }
//
// WorkOS authenticates the credentials and issues a signed JWT.
// staffId is never in the URL — always derived from the token.
// ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const { user, accessToken } = await workos.userManagement.authenticateWithPassword({
      clientId: process.env.WORKOS_CLIENT_ID,
      email:    email.toLowerCase().trim(),
      password,
    });

    // Return the WorkOS access token — client uses this as Bearer token
    res.json({
      accessToken,
      staff: {
        workosId: user.id,
        name:     `${user.firstName} ${user.lastName}`.trim(),
        email:    user.email,
      },
    });

  } catch (err) {
    // WorkOS returns a structured error — don't leak internals
    const status = err.status === 401 ? 401 : 500;
    const message = err.status === 401
      ? 'Invalid email or password'
      : 'Server error';

    if (status === 500) console.error('Login error:', err);
    res.status(status).json({ error: message });
  }
});

module.exports = router;
