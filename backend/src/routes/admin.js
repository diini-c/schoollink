const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// ─────────────────────────────────────────────
// GET /admin/dashboard/:adminId
// Admin sees all registers for a given date
// Status: done / not_done / offline_pending / overdue
// ─────────────────────────────────────────────
router.get('/dashboard/:adminId', async (req, res) => {
  const { adminId } = req.params;
  const { date } = req.query;
  const sessionDate = date || new Date().toISOString().split('T')[0];
  const OVERDUE_MINUTES = 10;

  try {
    // Verify admin role
    const adminResult = await pool.query(
      'SELECT * FROM staff WHERE id = $1 AND role = $2',
      [adminId, 'admin']
    );
    if (adminResult.rows.length === 0) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get all class assignments for the day of the week matching the date
    const dayOfWeek = new Date(sessionDate).toLocaleDateString('en-GB', { weekday: 'long' });

    const assignments = await pool.query(
      `SELECT ca.class_name, ca.subject, ca.session_time, ca.session_day,
              s.id as staff_id, s.full_name as teacher_name
       FROM class_assignments ca
       JOIN staff s ON ca.staff_id = s.id
       WHERE ca.session_day = $1
       ORDER BY ca.session_time ASC`,
      [dayOfWeek]
    );

    // Get all submitted registers for this date
    const submitted = await pool.query(
      `SELECT r.class_name, r.session_time, r.submitted_at, r.synced, r.staff_id,
              COUNT(rm.id) as total_marks,
              COUNT(CASE WHEN rm.status = 'present' THEN 1 END) as present_count,
              COUNT(CASE WHEN rm.status = 'absent'  THEN 1 END) as absent_count,
              COUNT(CASE WHEN rm.status = 'late'    THEN 1 END) as late_count
       FROM registers r
       JOIN register_marks rm ON r.id = rm.register_id
       WHERE r.session_date = $1
       GROUP BY r.id`,
      [sessionDate]
    );

    // Build a lookup map for submitted registers
    const submittedMap = {};
    for (const r of submitted.rows) {
      submittedMap[`${r.class_name}_${r.session_time}`] = r;
    }

    const now = new Date();

    // Build the dashboard report
    const report = assignments.rows.map(a => {
      const key = `${a.class_name}_${a.session_time}`;
      const reg = submittedMap[key];

      // Work out if this session is overdue
      const sessionDateTime = new Date(`${sessionDate}T${a.session_time}`);
      const minutesSinceStart = (now - sessionDateTime) / 60000;
      const isOverdue = minutesSinceStart > OVERDUE_MINUTES && !reg;
      const sessionInFuture = minutesSinceStart < 0;

      let status;
      if (reg && reg.synced)     status = 'done';
      else if (reg && !reg.synced) status = 'offline_pending';
      else if (sessionInFuture)  status = 'upcoming';
      else if (isOverdue)        status = 'overdue';
      else                       status = 'not_done';

      return {
        class: a.class_name,
        subject: a.subject,
        teacher: a.teacher_name,
        sessionTime: a.session_time,
        status,
        overdue: isOverdue,
        submittedAt: reg?.submitted_at || null,
        synced: reg?.synced ?? null,
        summary: reg ? {
          total:   parseInt(reg.total_marks),
          present: parseInt(reg.present_count),
          absent:  parseInt(reg.absent_count),
          late:    parseInt(reg.late_count),
        } : null,
      };
    });

    // Headline counts
    const counts = {
      total:           report.length,
      done:            report.filter(r => r.status === 'done').length,
      overdue:         report.filter(r => r.status === 'overdue').length,
      offline_pending: report.filter(r => r.status === 'offline_pending').length,
      upcoming:        report.filter(r => r.status === 'upcoming').length,
      not_done:        report.filter(r => r.status === 'not_done').length,
    };

    res.json({
      date: sessionDate,
      day: dayOfWeek,
      overdueLimitMinutes: OVERDUE_MINUTES,
      counts,
      registers: report,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
