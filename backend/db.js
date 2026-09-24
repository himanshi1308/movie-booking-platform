const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'booking.db'));
db.pragma('journal_mode = WAL'); // better concurrent read/write behavior

db.exec(`
  CREATE TABLE IF NOT EXISTS shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    movie_name TEXT NOT NULL,
    theatre TEXT NOT NULL,
    show_time TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS seats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id INTEGER NOT NULL,
    seat_number TEXT NOT NULL,
    price INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'available', -- available | locked | booked
    locked_by TEXT,
    lock_expires_at INTEGER,
    FOREIGN KEY (show_id) REFERENCES shows(id),
    UNIQUE(show_id, seat_number)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id INTEGER NOT NULL,
    seat_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    booked_at INTEGER NOT NULL,
    UNIQUE(seat_id) -- extra safety net: a seat can only ever have ONE booking row, ever
  );
`);

// Seed once
const showCount = db.prepare('SELECT COUNT(*) AS c FROM shows').get().c;
if (showCount === 0) {
  const insertShow = db.prepare(
    'INSERT INTO shows (movie_name, theatre, show_time) VALUES (?, ?, ?)'
  );
  const insertSeat = db.prepare(
    'INSERT INTO seats (show_id, seat_number, price) VALUES (?, ?, ?)'
  );

  const shows = [
    ['Dune: Part Three', 'PVR Cinemas - Screen 1', '2026-09-24 19:30'],
    ['The Batman Continues', 'INOX - Screen 3', '2026-09-24 21:00'],
  ];

  const seedShow = db.transaction((movie, theatre, time) => {
    const info = insertShow.run(movie, theatre, time);
    const showId = info.lastInsertRowid;
    const rows = 'ABCDE'.split('');
    for (const row of rows) {
      for (let n = 1; n <= 8; n++) {
        const price = row <= 'B' ? 350 : 220; // front rows pricier, arbitrary
        insertSeat.run(showId, `${row}${n}`, price);
      }
    }
  });

  for (const [movie, theatre, time] of shows) {
    seedShow(movie, theatre, time);
  }
  console.log('Seeded database with sample shows and seats.');
}

module.exports = db;
