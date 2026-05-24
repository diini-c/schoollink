'use strict';
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');

// ─────────────────────────────────────────────
// GET /timetable?date=YYYY-MM-DD
//
// Returns the authenticated teacher's sessions for the given date.
// Defaults to today if no date provided.
// Each session includes whether the register has been submitted.
//
// This is the teacher's home screen data — one tap per session to open the register.
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { staffId } = req.user;
  const { date } = req.query;
  const sessionDate = date || new Date().toISOString().split('T')[0];

  try {
    // Work out the day of week for this date
    const dayOfWeek = new Date(sessionDate).toLocaleDateString('en-GB', { weekday: 'long' });

    // Get this teacher's sessions for this day
    const sessions = await pool.query(
      `SELECT ca.class_name, ca.subject, ca.session_time, ca.session_day
       FROM class_assignments ca
       WHERE ca.staff_id = $1 AND ca.session_day = $2
       ORDER BY ca.session_time ASC`,
      [staffId, dayOfWeek]
    );

    if (sessions.rows.length === 0) {
      return res.json({
        date:     sessionDate,
        day:      dayOfWeek,
        sessions: [],
        message:  'No sessions scheduled for this day',
      });
    }

    // For each session, check if a register has been submitted
    const enriched = await Promise.all(sessions.rows.map(async (s) => {
      const reg = await pool.query(
        `SELECT id, submitted_at, synced
         FROM registers
         WHERE class_name = $1 AND session_date = $2 AND session_time = $3`,
        [s.class_name, sessionDate, s.session_time]
      );

      const register = reg.rows[0] || null;

      let registerStatus;
      if (register && register.synced)     registerStatus = 'done';
      else if (register && !register.synced) registerStatus = 'offline_pending';
      else                                  registerStatus = 'not_done';

      return {
        class:          s.class_name,
        subject:        s.subject,
        sessionTime:    s.session_time,
        registerStatus,
        submittedAt:    register?.submitted_at || null,
      };
    }));

    // Get teacher name for display
    const staffResult = await pool.query(
      'SELECT full_name FROM staff WHERE id = $1',
      [staffId]
    );

    res.json({
      date:     sessionDate,
      day:      dayOfWeek,
      teacher:  staffResult.rows[0]?.full_name,
      sessions: enriched,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
