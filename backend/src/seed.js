require('dotenv').config();
const { pool, initSchema } = require('./db');
const { v4: uuidv4 } = require('uuid');

const DUMMY_PUPILS = [
  { name: 'Tyrique Johnson',   year: 7, class: '7A' },
  { name: 'Aisha Mohammed',    year: 7, class: '7A' },
  { name: 'Marcus Williams',   year: 7, class: '7A' },
  { name: 'Priya Patel',       year: 7, class: '7A' },
  { name: 'Sadiq Omar',        year: 7, class: '7A' },
  { name: 'Chloe Bennett',     year: 7, class: '7A' },
  { name: 'Jamal Clarke',      year: 7, class: '7A' },
  { name: 'Fatima Hassan',     year: 7, class: '7A' },
  { name: 'Ryan O\'Sullivan',  year: 7, class: '7A' },
  { name: 'Zara Khan',         year: 7, class: '7A' },
  { name: 'Leon Baptiste',     year: 8, class: '8B' },
  { name: 'Amara Diallo',      year: 8, class: '8B' },
  { name: 'Josh Thornton',     year: 8, class: '8B' },
  { name: 'Nadia Okonkwo',     year: 8, class: '8B' },
  { name: 'Elliot Fraser',     year: 8, class: '8B' },
];

const DUMMY_STAFF = [
  { name: 'Mrs Smith',   role: 'teacher' },
  { name: 'Mr Okafor',   role: 'teacher' },
  { name: 'Ms Johnson',  role: 'admin'   },
];

// Class assignments: Mrs Smith teaches 7A, Mr Okafor teaches 8B
const CLASS_ASSIGNMENTS = [
  { staff_name: 'Mrs Smith',  class: '7A', subject: 'English',  day: 'Thursday', time: '09:00' },
  { staff_name: 'Mrs Smith',  class: '7A', subject: 'English',  day: 'Monday',   time: '11:00' },
  { staff_name: 'Mr Okafor',  class: '8B', subject: 'Maths',    day: 'Thursday', time: '09:00' },
  { staff_name: 'Mr Okafor',  class: '8B', subject: 'Maths',    day: 'Tuesday',  time: '14:00' },
];

async function seed() {
  try {
    await initSchema();

    console.log('Clearing existing seed data...');
    await pool.query('DELETE FROM audit_log');
    await pool.query('DELETE FROM register_marks');
    await pool.query('DELETE FROM registers');
    await pool.query('DELETE FROM class_assignments');
    await pool.query('DELETE FROM identity_vault');
    await pool.query('DELETE FROM pupils');
    await pool.query('DELETE FROM staff');

    // Seed staff
    console.log('Seeding staff...');
    const staffMap = {};
    for (const s of DUMMY_STAFF) {
      const id = uuidv4();
      staffMap[s.name] = id;
      await pool.query(
        'INSERT INTO staff (id, full_name, role) VALUES ($1, $2, $3)',
        [id, s.name, s.role]
      );
    }

    // Seed pupils: token goes into pupils table, identity into the vault
    console.log('Seeding pupils (tokens into operational store, names into vault)...');
    for (const p of DUMMY_PUPILS) {
      const token = uuidv4();

      // Operational store: token only
      await pool.query(
        'INSERT INTO pupils (token) VALUES ($1)',
        [token]
      );

      // Identity vault: the ONLY place the name lives
      await pool.query(
        'INSERT INTO identity_vault (token, full_name, year_group, class_name) VALUES ($1, $2, $3, $4)',
        [token, p.name, p.year, p.class]
      );
    }

    // Seed class assignments
    console.log('Seeding class assignments...');
    for (const a of CLASS_ASSIGNMENTS) {
      await pool.query(
        'INSERT INTO class_assignments (id, staff_id, class_name, subject, session_day, session_time) VALUES ($1, $2, $3, $4, $5, $6)',
        [uuidv4(), staffMap[a.staff_name], a.class, a.subject, a.day, a.time]
      );
    }

    console.log('\nSeed complete.');
    console.log('Staff IDs (use these to test the API):');
    for (const [name, id] of Object.entries(staffMap)) {
      console.log(`  ${name}: ${id}`);
    }

  } catch (err) {
    console.error('Seed failed:', err);
  } finally {
    await pool.end();
  }
}

seed();
