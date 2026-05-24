# SchoolLink

Register/attendance + parent-connect system for schools. Built for markets running on spreadsheets — London tuition centres first, then East Africa and Gulf schools. The selling point is the security: children's data is tokenised throughout the operational layer so a breach yields gibberish, not names.

**Stack:** Node.js 22 / Express / PostgreSQL 16 / Docker  
**Spec:** `SPEC.md` — read this before touching the data model  
**Status:** Auth complete. Teacher register flow complete. Parent flow and admin dashboard next.

---

## How to run

```bash
git clone https://github.com/diini-c/schoollink.git
cd schoollink

# Add .env (see .env.example or ask founder — never committed)
# Must include: DB_USER, DB_PASSWORD, DB_NAME, DB_HOST, DB_PORT, API_PORT, WORKOS_API_KEY, WORKOS_CLIENT_ID
# Copy .env.example → .env and fill in values. Never commit .env.

docker compose up --build -d

# Seed dev data (pupils, staff, class assignments, hashed passwords)
docker exec -it schoollink_api node src/seed.js
```

API runs on `http://localhost:3000`. Import `schoollink.postman_collection.json` to test.

---

## Authentication

Staff authenticate via JWT. **staffId is never in a URL** — it lives inside the signed token.

### Login

```
POST /auth/login
Content-Type: application/json

{ "email": "smith@schoollink.dev", "password": "Sl#Smith2026dev" }
```

```json
{
  "token": "<jwt>",
  "staff": { "id": "...", "name": "Mrs Smith", "role": "teacher" }
}
```

Token lifetime: **8 hours** (one school day). All other endpoints require:

```
Authorization: Bearer <token>
```

### Dev credentials (seed data only)

| Name        | Email                     | Password   | Role    |
|-------------|---------------------------|------------|---------|
| Mrs Smith   | smith@schoollink.dev      | Sl#Smith2026dev  | teacher |
| Mr Okafor   | okafor@schoollink.dev     | Sl#Okafor2026dev | teacher |
| Ms Johnson  | johnson@schoollink.dev    | Sl#Admin2026dev  | admin   |

---

## API endpoints

All routes below require `Authorization: Bearer <token>`.

### Teacher — register

```
GET  /register?class=7A&date=YYYY-MM-DD
POST /register/submit
```

`GET /register` — fetches the class list with resolved names (vault query, every resolution logged to audit_log). Returns `403` if the authenticated teacher has no class assignment for the requested class.

`POST /register/submit` body:
```json
{
  "class": "7A",
  "date": "2026-05-21",
  "sessionTime": "09:00:00",
  "synced": true,
  "marks": [
    { "token": "<pupil-token>", "status": "present", "note": null }
  ]
}
```

Status values: `present` | `absent` | `late` | `unmarked`

### Admin — dashboard

```
GET /admin/dashboard?date=YYYY-MM-DD
```

Returns all class registers for the day with status: `done` | `not_done` | `overdue` | `offline_pending` | `upcoming`. Overdue = session started more than 10 minutes ago with no submission.

### Health check

```
GET /health   →  { "status": "ok" }   (no auth required)
```

---

## Security model (summary — full detail in SPEC.md)

- A pupil is an **opaque random token** everywhere in the operational system. The token resolves to a name only through the identity vault, only when an access check passes, and every resolution is logged.
- **Authentication** (JWT) proves who the staff member is.
- **Authorisation** (class_assignments table) proves they may access the requested class.
- Both checks must pass before any name is resolved. A breach of the operational DB yields tokens — no names.
- The audit log is append-only. Every token resolution, every register submission, every permission change is logged.

---

## What is built

- [x] Full schema (pupils, identity_vault, staff, class_assignments, registers, register_marks, audit_log)
- [x] JWT authentication — login, verifyToken middleware, staffId from token not URL
- [x] Teacher register flow — fetch class (with vault resolution + audit), submit marks
- [x] Admin dashboard — all registers for a day with status flags
- [x] Seed data — 15 pupils across 7A and 8B, 2 teachers, 1 admin, hashed passwords

## What is not built yet (priority order)

- [ ] Hash-chained audit log — entries exist but are not yet fingerprinted/chained
- [ ] Vault separation — same Postgres instance for now; needs separate schema + credentials before pilot
- [ ] Client / admin dashboard (Slice 2) — ABAC relationship management, staff provisioning
- [ ] Parent / pupil auth — separate auth path from staff; pupils and parents log in to view timetable and join video sessions
- [ ] Offline-ready — `synced` boolean is wired; local tamper-evident store and reconciliation not built
- [ ] Encryption at rest — column-level encryption on vault before pilot
- [ ] Break-glass — deferred pending teacher consultation
- [ ] Video schools (deferred) — see design decisions below

---

## Design decisions (deferred features)

### Video schools

**Decision: deferred until core register flow is in pilot.**

SchoolLink targets schools running video natively — no fallback to non-video. Schools without video capability are out of scope for this tier. The toggle for video-enabled schools lives at the client level (one column on a future `clients` table: `video_enabled BOOLEAN DEFAULT FALSE`).

**Flow (decided, not yet built):**
- The authenticated teacher (or client admin as fallback for subs / technical issues) creates a video link for a specific timetable slot. Admin can do it but teachers own it day-to-day — admin can't scale to 30 classes 4 times a day.
- Link is stored on the `registers` row (`video_url TEXT` column, one schema change).
- Pupils and parents see the link on their timetable view and tap to join on their Zoom-enabled device.
- MVP: teacher pastes any video URL (Zoom, Meet, Teams — provider-agnostic). Auto-generation via Zoom API is a later layer on the same schema.

**Dependency:** pupil and parent auth must exist first — they need to be authenticated to see the timetable and the link.

**Substitute teachers** are handled through the client admin dashboard (Slice 2), not break-glass. Admin removes the absent teacher from the class assignment and adds the substitute — the sub then has standing access and can drop a video link or take the register through the normal flow. This is a routine admin operation, not an edge case. Break-glass is reserved for genuinely unplanned emergency access with no admin available (e.g. a teacher dealing with an unknown pupil in a corridor).

---

## Project structure

```
backend/
  src/
    db.js                  — schema + pool
    index.js               — Express app, route mounting
    seed.js                — dev seed data
    middleware/
      auth.js              — verifyToken, requireRole
    routes/
      auth.js              — POST /auth/login
      register.js          — GET /register, POST /register/submit
      admin.js             — GET /admin/dashboard
  Dockerfile
  package.json
docker-compose.yml
schoollink.postman_collection.json
```
