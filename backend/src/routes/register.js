const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────
// GET /register/:staffId
// Teacher fetches their register for today
// Tokens resolve to names ONLY because this staff member
// has a class assignment — standing access check
// Every resolution is written to the audit log
// ─────────────────────────────────────────────
router.get('/:staffId', async (req, res) => {
  const { staffId } = req.params;
  const { date, class: className } = req.query;
  const sessionDate = date || new Date().toISOString().split('T')[0];

  try {
    // Verify this staff member exists
    const staffResult = await pool.query(
      'SELECT * FROM staff WHERE id = $1',
      [staffId]
    );
    if (staffResult.rows.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    const staff = staffResult.rows[0];

    // Check standing access: does this teacher have a class assignment?
    // Admins can see any class
    let assignmentCheck;
    if (staff.role === 'admin') {
      assignmentCheck = { rows: [{ class_name: className }] };
    } else {
      assignmentCheck = await pool.query(
        'SELECT * FROM class_assignments WHERE staff_id = $1 AND class_name = $2',
        [staffId, className]
      );
    }

    if (assignmentCheck.rows.length === 0) {
      // No standing access — this is where break-glass would slot in later
      return res.status(403).json({
        error: 'No standing access to this class',
        hint: 'Break-glass flow not yet implemented'
      });
    }

    // Resolve tokens to names — this is the vault query
    // This only happens because access check passed above
    const pupils = await pool.query(
      `SELECT p.token, iv.full_name, iv.year_group
       FROM pupils p
       JOIN identity_vault iv ON p.token = iv.token
       WHERE iv.class_name = $1
       ORDER BY iv.full_name ASC`,
      [className]
    );

    // Write every resolution to the audit log
    for (const pupil of pupils.rows) {
      await pool.query(
        `INSERT INTO audit_log (id, staff_id, action, pupil_token, detail)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          uuidv4(),
          staffId,
          'REGISTER_TOKEN_RESOLVED',
          pupil.token,
          JSON.stringify({ class: className, date: sessionDate })
        ]
      );
    }

    // Check if a register record already exists for this session
    const existingRegister = await pool.query(
      `SELECT r.id, rm.pupil_token, rm.status, rm.note
       FROM registers r
       JOIN register_marks rm ON r.id = rm.register_id
       WHERE r.class_name = $1 AND r.session_date = $2 AND r.staff_id = $3`,
      [className, sessionDate, staffId]
    );

    // Build a map of existing marks if register was already started
    const existingMarks = {};
    for (const row of existingRegister.rows) {
      existingMarks[row.pupil_token] = { status: row.status, note: row.note };
    }

    // Return the resolved class list with any existing marks
    const classList = pupils.rows.map(p => ({
      token: p.token,
      name: p.full_name,
      year: p.year_group,
      status: existingMarks[p.token]?.status || 'unmarked',
      note: existingMarks[p.token]?.note || null,
    }));

    res.json({
      class: className,
      date: sessionDate,
      teacher: staff.full_name,
      pupils: classList,
      totalPupils: classList.length,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─────────────────────────────────────────────
// POST /register/:staffId/submit
// Teacher submits completed register
// Accepts online submission and offline sync (synced flag)
// Body: { class, date, sessionTime, marks: [{token, status, note}], synced }
// ─────────────────────────────────────────────
router.post('/:staffId/submit', async (req, res) => {
  const { staffId } = req.params;
  const { class: className, date, sessionTime, marks, synced = true } = req.body;

  if (!className || !date || !sessionTime || !marks || !Array.isArray(marks)) {
    return res.status(400).json({ error: 'Missing required fields: class, date, sessionTime, marks' });
  }

  try {
    // Verify staff exists and has access
    const staffResult = await pool.query(
      'SELECT * FROM staff WHERE id = $1', [staffId]
    );
    if (staffResult.rows.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    const staff = staffResult.rows[0];

    if (staff.role !== 'admin') {
      const assignmentCheck = await pool.query(
        'SELECT * FROM class_assignments WHERE staff_id = $1 AND class_name = $2',
        [staffId, className]
      );
      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ error: 'No standing access to this class' });
      }
    }

    // Upsert the register record
    const registerId = uuidv4();
    const submittedAt = synced ? new Date().toISOString() : null;

    await pool.query(
      `INSERT INTO registers (id, staff_id, class_name, session_date, session_time, submitted_at, synced)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (class_name, session_date, session_time)
       DO UPDATE SET submitted_at = $6, synced = $7`,
      [registerId, staffId, className, date, sessionTime, submittedAt, synced]
    );

    // Get the actual register id (may be existing after upsert)
    const registerResult = await pool.query(
      'SELECT id FROM registers WHERE class_name = $1 AND session_date = $2 AND session_time = $3',
      [className, date, sessionTime]
    );
    const actualRegisterId = registerResult.rows[0].id;

    // Clear old marks and rewrite (idempotent — safe to resubmit)
    await pool.query('DELETE FROM register_marks WHERE register_id = $1', [actualRegisterId]);

    // Insert marks — tokens only, no names in the operational table
    for (const mark of marks) {
      await pool.query(
        `INSERT INTO register_marks (id, register_id, pupil_token, status, note, marked_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [uuidv4(), actualRegisterId, mark.token, mark.status, mark.note || null]
      );
    }

    // Audit log
    await pool.query(
      `INSERT INTO audit_log (id, staff_id, action, pupil_token, detail)
       VALUES ($1, $2, $3, NULL, $4)`,
      [
        uuidv4(),
        staffId,
        synced ? 'REGISTER_SUBMITTED' : 'REGISTER_SYNCED_FROM_OFFLINE',
        JSON.stringify({ class: className, date, sessionTime, markCount: marks.length })
      ]
    );

    const summary = {
      present: marks.filter(m => m.status === 'present').length,
      absent:  marks.filter(m => m.status === 'absent').length,
      late:    marks.filter(m => m.status === 'late').length,
    };

    res.json({
      success: true,
      registerId: actualRegisterId,
      synced,
      summary,
      message: synced
        ? 'Register submitted successfully'
        : 'Offline register synced successfully',
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
