# CineBook — Movie Ticket Booking Platform

A minimal BookMyShow-style movie ticket booking app, built to demonstrate how to
correctly handle **concurrency / race conditions** in a seat-booking system —
not just the happy path.

## Tech Stack

| Layer     | Choice                              | Why |
|-----------|--------------------------------------|-----|
| Frontend  | Vanilla HTML/CSS/JS                  | No build step, fastest to run/demo, keeps focus on the backend logic |
| Backend   | Node.js + Express                    | Minimal boilerplate, easy to read/explain the concurrency logic |
| Database  | SQLite (via `better-sqlite3`)        | Zero setup (no server to install), but the concurrency strategy used is standard SQL and works identically on Postgres/MySQL in production |

No deployment, Docker, or auth system — those were deliberately out of scope
given the time constraint. Auth is mocked with a random `userId` per browser tab.

## How Race Conditions Are Handled

This is the core of the project. Three problems, three fixes:

### 1. Two users trying to book the same seat at the same instant
**Fix: atomic conditional `UPDATE`, not read-then-write.**

A naive implementation does:
```
SELECT status FROM seats WHERE id = ?      -- "it's available!"
UPDATE seats SET status = 'booked' ...     -- both requests get here
```
There's a gap between the read and the write where two concurrent requests can
both pass the check. Instead, every state change here is a **single atomic
statement** that re-checks the condition in the same query:
```sql
UPDATE seats
SET status = 'locked', locked_by = ?, lock_expires_at = ?
WHERE id = ? AND status = 'available'
```
The database guarantees only one of two simultaneous requests can match this
`WHERE` clause and update the row. The loser gets `changes = 0` and is told
the seat is gone — instantly, no polling or retry needed.
(See `backend/server.js`, the `/lock` and `/book` routes.)

### 2. Belt-and-suspenders: the `bookings` table itself
Even if application logic somehow had a bug, `bookings.seat_id` has a
`UNIQUE` constraint. A second `INSERT` for the same seat throws a DB-level
constraint violation, which is caught and turned into a friendly error. Two
independent layers both prevent a double-booking.

### 3. Abandoned checkouts (user selects a seat, then closes the tab)
**Fix: time-boxed holds with lazy expiry.**

Selecting a seat doesn't book it — it puts it in a `locked` state for 2
minutes (`LOCK_DURATION_MS` in `server.js`) tied to that user's ID. If they
don't confirm in time:
- The seat is automatically eligible to be re-locked by anyone else
  (checked via `lock_expires_at < now` in the same atomic `UPDATE`).
- No cron job or background worker needed — expiry is checked lazily,
  right when the row is next touched (either by another user trying to grab
  it, or by the seat-map `GET` endpoint cleaning up on read).

### 4. Proof, not just claims
`backend/raceConditionTest.js` fires **20 concurrent "lock + book" requests
from 20 fake users at the exact same seat** using `Promise.all`. Run it
against the live server and you'll see exactly 1 success and 19 clean
rejections — every time. This is the best thing to show on-camera in the demo
video.

## Running It

**Terminal 1 — backend:**
```bash
cd backend
npm install
npm start
# -> Booking API running on http://localhost:4000
```

**Terminal 2 — frontend** (any static server works, e.g.):
```bash
cd frontend
python3 -m http.server 5500
# -> open http://localhost:5500 in your browser
```

**Terminal 3 — prove the race condition is handled:**
```bash
cd backend
node raceConditionTest.js 1     # 1 = seat ID to attack; try any seat id 1-40
```

## Demo Video Suggestions
1. Show the seat map, select a seat — point out the "held for 120s" countdown.
2. Open the same show in a second browser tab (different random `userId`) —
   try to select the same seat -> show the instant rejection.
3. Let a hold expire on camera (or shorten `LOCK_DURATION_MS` to 10s for the
   demo) -> show the seat becoming available again automatically.
4. Run `raceConditionTest.js` in a terminal -> narrate the 20-concurrent-user
   output showing exactly 1 booking succeeds.
5. Briefly show the `UPDATE ... WHERE status = 'available'` line in
   `server.js` and explain why it's atomic vs. read-then-write.

## Project Structure
```
movie-booking-platform/
├── backend/
│   ├── server.js              # Express API + all concurrency-safe logic
│   ├── db.js                  # SQLite schema + seed data
│   ├── raceConditionTest.js   # Concurrent load test proving correctness
│   └── package.json
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js                 # Seat map, lock/hold timer, checkout flow
└── README.md
```
