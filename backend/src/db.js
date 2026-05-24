const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
});

// Build the schema on first run
async function initSchema() {
  await pool.query(`

    -- The operational layer: tokens only, never a name
    CREATE TABLE IF NOT EXISTS pupils (
      token UUID PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- The identity vault: the ONLY place tokens map to real identity
    -- In production this would be a hardened separate store
    -- For now it lives in the same DB but is treated as a separate access tier
    CREATE TABLE IF NOT EXISTS identity_vault (
      token UUID PRIMARY KEY REFERENCES pupils(token),
      full_name TEXT NOT NULL,
      year_group INTEGER NOT NULL,
      class_name TEXT NOT NULL,
      photo_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Staff accounts
    CREATE TABLE IF NOT EXISTS staff (
      id UUID PRIMARY KEY,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('teacher', 'admin', 'head_of_year', 'ta')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Which teacher is assigned to which class
    -- This is the relationship that grants standing access
    CREATE TABLE IF NOT EXISTS class_assignments (
      id UUID PRIMARY KEY,
      staff_id UUID REFERENCES staff(id),
      class_name TEXT NOT NULL,
      subject TEXT,
      session_day TEXT NOT NULL,
      session_time TIME NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- The register: tokens only in the operational columns
    -- resolution to names happens at the API layer under access control
    CREATE TABLE IF NOT EXISTS registers (
      id UUID PRIMARY KEY,
      staff_id UUID REFERENCES staff(id),
      class_name TEXT NOT NULL,
      session_date DATE NOT NULL,
      session_time TIME NOT NULL,
      submitted_at TIMESTAMPTZ,
      synced BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(class_name, session_date, session_time)
    );

    -- Individual pupil marks within a register
    CREATE TABLE IF NOT EXISTS register_marks (
      id UUID PRIMARY KEY,
      register_id UUID REFERENCES registers(id),
      pupil_token UUID REFERENCES pupils(token),
      status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'unmarked')),
      note TEXT,
      marked_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Audit log: every token resolution and every sensitive action
    -- Append-only: nothing is ever deleted or updated here
    CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY,
      staff_id UUID REFERENCES staff(id),
      action TEXT NOT NULL,
      pupil_token UUID,
      detail JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

  `);

  console.log('Schema ready.');
}

module.exports = { pool, initSchema };
