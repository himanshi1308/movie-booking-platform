const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const LOCK_DURATION_MS = 2 * 60 * 1000; // hold a seat for 2 minutes during checkout

// ---------- helpers ----------

// A lock counts as "expired" if lock_expires_at has passed.
// We lazily auto-release expired locks whenever we touch a seat row,
// instead of relying on a background cron job.
function releaseExpiredLocksForShow(showId) {
  const now = Date.now();
  db.prepare(
    `UPDATE seats
     SET status = 'available', locked_by = NULL, lock_expires_at = NULL
     WHERE show_id = ? AND status = 'locked' AND lock_expires_at < ?`
  ).run(showId, now);
}

// ---------- routes ----------

app.get('/api/shows', (req, res) => {
  const shows = db.prepare('SELECT * FROM shows').all();
  res.json(shows);
});

app.get('/api/shows/:showId/seats', (req, res) => {
  const { showId } = req.params;
  releaseExpiredLocksForShow(showId);
  const seats = db
    .prepare('SELECT id, seat_number, price, status, locked_by FROM seats WHERE show_id = ? ORDER BY seat_number')
    .all(showId);
  res.json(seats);
});

/**
 * LOCK a seat (user selects it, checkout begins).
 *
 * Race condition being solved: two users click the same seat at the ~same
 * millisecond. Only one may successfully transition it from
 * 'available' -> 'locked'. This is done with a SINGLE atomic UPDATE whose
 * WHERE clause re-checks the status server-side — not a read-then-write,
 * which would have a gap where both requests could pass the check.
 */
app.post('/api/seats/:seatId/lock', (req, res) => {
  const { seatId } = req.params;
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const seat = db.prepare('SELECT * FROM seats WHERE id = ?').get(seatId);
  if (!seat) return res.status(404).json({ error: 'Seat not found' });

  releaseExpiredLocksForShow(seat.show_id);

  const now = Date.now();
  const expiresAt = now + LOCK_DURATION_MS;

  const result = db
    .prepare(
      `UPDATE seats
       SET status = 'locked', locked_by = ?, lock_expires_at = ?
       WHERE id = ? AND (status = 'available' OR (status = 'locked' AND lock_expires_at < ?))`
    )
    .run(userId, expiresAt, seatId, now);

  if (result.changes === 0) {
    // Someone else beat us to it (or it's already booked)
    const current = db.prepare('SELECT status FROM seats WHERE id = ?').get(seatId);
    return res.status(409).json({
      error: 'Seat is not available',
      currentStatus: current.status,
    });
  }

  res.json({ success: true, seatId: Number(seatId), lockedBy: userId, expiresAt });
});

/**
 * CONFIRM booking (payment "succeeds").
 *
 * Race condition being solved: the seat must still be locked BY THIS USER
 * and the lock must not have expired (e.g. they took too long on the
 * payment page and someone else grabbed it in the meantime). Again, one
 * atomic UPDATE with all conditions in the WHERE clause — no gap for a
 * second request to sneak through.
 *
 * The bookings table also has a UNIQUE(seat_id) constraint as a last-resort
 * safety net: even in the extremely unlikely case two book requests both
 * pass the UPDATE (e.g. a bug), the second INSERT into bookings will throw
 * a constraint violation and get caught below.
 */
app.post('/api/seats/:seatId/book', (req, res) => {
  const { seatId } = req.params;
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const now = Date.now();

  const bookSeat = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE seats
         SET status = 'booked', locked_by = NULL, lock_expires_at = NULL
         WHERE id = ? AND status = 'locked' AND locked_by = ? AND lock_expires_at >= ?`
      )
      .run(seatId, userId, now);

    if (result.changes === 0) {
      throw { code: 'SEAT_UNAVAILABLE' };
    }

    db.prepare(
      'INSERT INTO bookings (show_id, seat_id, user_id, booked_at) VALUES ((SELECT show_id FROM seats WHERE id = ?), ?, ?, ?)'
    ).run(seatId, seatId, userId, now);
  });

  try {
    bookSeat();
  } catch (err) {
    if (err.code === 'SEAT_UNAVAILABLE') {
      const current = db.prepare('SELECT status, locked_by FROM seats WHERE id = ?').get(seatId);
      return res.status(409).json({
        error: 'Your hold on this seat expired or it was taken by someone else. Please select again.',
        currentStatus: current ? current.status : 'unknown',
      });
    }
    // UNIQUE constraint violation on bookings.seat_id -> double-booking attempt caught here
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'Seat already booked (double-booking prevented).' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.json({ success: true, message: 'Booking confirmed!' });
});

// RELEASE a lock voluntarily (user navigates away / cancels)
app.post('/api/seats/:seatId/release', (req, res) => {
  const { seatId } = req.params;
  const { userId } = req.body;
  db.prepare(
    `UPDATE seats SET status = 'available', locked_by = NULL, lock_expires_at = NULL
     WHERE id = ? AND locked_by = ?`
  ).run(seatId, userId);
  res.json({ success: true });
});

const PORT = 4000;
app.listen(PORT, () => console.log(`Booking API running on http://localhost:${PORT}`));
