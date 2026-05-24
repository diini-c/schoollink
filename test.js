/**
 * SchoolLink API — end-to-end test runner
 * Run with: node test.js
 * Requires: docker compose up + seed already done
 */

const BASE = 'http://localhost:3000';

let passed = 0;
let failed = 0;

function pass(name) {
  console.log(`  ✓  ${name}`);
  passed++;
}

function fail(name, detail) {
  console.error(`  ✗  ${name}`);
  console.error(`     → ${detail}`);
  failed++;
}

async function expect(name, fn) {
  try {
    await fn();
  } catch (err) {
    fail(name, err.message);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  console.log('\nSchoolLink API Tests\n' + '─'.repeat(40));

  // ── 1. Health check ─────────────────────────
  await expect('Health check returns ok', async () => {
    const res  = await fetch(`${BASE}/health`);
    const body = await res.json();
    assert(res.status === 200,     `Expected 200, got ${res.status}`);
    assert(body.status === 'ok',   `Expected {status:'ok'}, got ${JSON.stringify(body)}`);
    pass('Health check returns ok');
  });

  // ── 2. No token → 401 ───────────────────────
  await expect('No token returns 401', async () => {
    const res = await fetch(`${BASE}/register?class=7A`);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
    pass('No token returns 401');
  });

  // ── 3. Bad token → 403 ──────────────────────
  await expect('Bad token returns 403', async () => {
    const res = await fetch(`${BASE}/register?class=7A`, {
      headers: { Authorization: 'Bearer thisisnotavalidtoken' }
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
    pass('Bad token returns 403');
  });

  // ── 4. Login as Mrs Smith ───────────────────
  let teacherToken;
  await expect('Teacher login succeeds', async () => {
    const res  = await fetch(`${BASE}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: 'smith@schoollink.dev', password: 'Sl#Smith2026dev' }),
    });
    const body = await res.json();
    assert(res.status === 200,   `Expected 200, got ${res.status} — ${JSON.stringify(body)}`);
    assert(body.accessToken,     `No accessToken in response: ${JSON.stringify(body)}`);
    teacherToken = body.accessToken;
    pass('Teacher login succeeds');
  });

  if (!teacherToken) {
    fail('Skipping remaining tests', 'No teacher token — login failed');
    return summary();
  }

  const authHeader = { Authorization: `Bearer ${teacherToken}` };

  // ── 5. Fetch register — names resolved ──────
  let pupilToken;
  await expect('GET /register returns 10 pupils with names', async () => {
    const res  = await fetch(`${BASE}/register?class=7A&date=2026-05-21`, { headers: authHeader });
    const body = await res.json();
    assert(res.status === 200,          `Expected 200, got ${res.status} — ${JSON.stringify(body)}`);
    assert(body.pupils?.length === 10,  `Expected 10 pupils, got ${body.pupils?.length}`);
    assert(body.pupils[0].name,         `Pupil has no name — vault resolution failed`);
    pupilToken = body.pupils[0].token;
    pass('GET /register returns 10 pupils with names');
  });

  // ── 6. Wrong class → 403 ────────────────────
  await expect('Teacher cannot access another class (403)', async () => {
    const res = await fetch(`${BASE}/register?class=8B&date=2026-05-21`, { headers: authHeader });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
    pass('Teacher cannot access another class (403)');
  });

  // ── 7. Missing class param → 400 ────────────
  await expect('Missing class param returns 400', async () => {
    const res = await fetch(`${BASE}/register?date=2026-05-21`, { headers: authHeader });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    pass('Missing class param returns 400');
  });

  // ── 8. Submit register ───────────────────────
  await expect('POST /register/submit succeeds', async () => {
    const res  = await fetch(`${BASE}/register/submit`, {
      method:  'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        class:       '7A',
        date:        '2026-05-21',
        sessionTime: '09:00:00',
        synced:      true,
        marks: [{ token: pupilToken, status: 'present', note: null }],
      }),
    });
    const body = await res.json();
    assert(res.status === 200,  `Expected 200, got ${res.status} — ${JSON.stringify(body)}`);
    assert(body.success,        `Expected success:true — ${JSON.stringify(body)}`);
    pass('POST /register/submit succeeds');
  });

  // ── 9. Login as admin ────────────────────────
  let adminToken;
  await expect('Admin login succeeds', async () => {
    const res  = await fetch(`${BASE}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: 'johnson@schoollink.dev', password: 'Sl#Admin2026dev' }),
    });
    const body = await res.json();
    assert(res.status === 200, `Expected 200, got ${res.status} — ${JSON.stringify(body)}`);
    assert(body.accessToken,   `No accessToken in response`);
    adminToken = body.accessToken;
    pass('Admin login succeeds');
  });

  // ── 10. Admin dashboard — register is "done" ─
  await expect('Admin dashboard shows 7A register as done', async () => {
    const res  = await fetch(`${BASE}/admin/dashboard?date=2026-05-21`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const body = await res.json();
    assert(res.status === 200, `Expected 200, got ${res.status} — ${JSON.stringify(body)}`);
    const entry = body.registers?.find(r => r.register?.class === '7A');
    assert(entry,                              `7A register not found in dashboard`);
    assert(entry.register.status === 'done',   `Expected status 'done', got '${entry.register.status}'`);
    pass('Admin dashboard shows 7A register as done');
  });

  // ── 12. Timetable — teacher sees their day ───
  await expect('GET /timetable returns sessions for Thursday', async () => {
    const res  = await fetch(`${BASE}/timetable?date=2026-05-21`, { headers: authHeader });
    const body = await res.json();
    assert(res.status === 200,          `Expected 200, got ${res.status} — ${JSON.stringify(body)}`);
    assert(body.sessions?.length > 0,   `Expected at least 1 session, got ${body.sessions?.length}`);
    assert(body.sessions[0].class,      `Session missing class name`);
    assert(body.sessions[0].registerStatus, `Session missing registerStatus`);
    pass('GET /timetable returns sessions for Thursday');
  });

  // ── 11. Teacher cannot hit admin route ───────
  await expect('Teacher cannot access admin dashboard (403)', async () => {
    const res = await fetch(`${BASE}/admin/dashboard?date=2026-05-21`, { headers: authHeader });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
    pass('Teacher cannot access admin dashboard (403)');
  });

  summary();
}

function summary() {
  console.log('\n' + '─'.repeat(40));
  console.log(`  ${passed} passed, ${failed} failed\n`);
  if (failed === 0) console.log('  All tests passed. Ready for Figma.\n');
}

run().catch(err => {
  console.error('\nTest runner crashed:', err.message);
});
