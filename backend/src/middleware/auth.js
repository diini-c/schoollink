'use strict';
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { WorkOS } = require('@workos-inc/node');
const { pool } = require('../db');

const workos = new WorkOS(process.env.WORKOS_API_KEY);

// WorkOS JWKS — fetched once, cached automatically by jose
const JWKS = createRemoteJWKSet(
  new URL(workos.userManagement.getJwksUrl(process.env.WORKOS_CLIENT_ID))
);

// ─────────────────────────────────────────────
// verifyToken
// 1. Verifies the WorkOS access token (JWT) against their JWKS
// 2. Looks up the staff record by workos_user_id
// 3. Attaches req.user = { staffId, role }
// ─────────────────────────────────────────────
async function verifyToken(req, res, next) {
  const header = req.headers['authorization'];
  const token  = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    const workosUserId = payload.sub;

    const result = await pool.query(
      'SELECT id, role FROM staff WHERE workos_user_id = $1',
      [workosUserId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'No staff record linked to this account' });
    }

    req.user = { staffId: result.rows[0].id, role: result.rows[0].role };
    next();

  } catch (err) {
    if (err.code === 'ERR_JWT_EXPIRED') {
      return res.status(401).json({ error: 'Token expired — please log in again' });
    }
    console.error('Token verification error:', err.message);
    return res.status(403).json({ error: 'Invalid token' });
  }
}

// ─────────────────────────────────────────────
// requireRole(...roles)
// Use after verifyToken to gate a route by role.
// ─────────────────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `This action requires one of: ${roles.join(', ')}`,
      });
    }
    next();
  };
}

module.exports = { verifyToken, requireRole };
