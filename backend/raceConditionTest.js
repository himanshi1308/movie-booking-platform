/**
 * Fires N concurrent "lock this exact seat" requests from N different
 * fake users, then N concurrent "book it" requests. Proves that no matter
 * how many people click at once, exactly one booking succeeds.
 *
 * Run this WHILE the server is running:
 *   node raceConditionTest.js <seatId>
 */

const BASE_URL = 'http://localhost:4000';
const seatId = process.argv[2] || 1;
const NUM_USERS = 20;

async function attemptLockAndBook(userId) {
  const lockRes = await fetch(`${BASE_URL}/api/seats/${seatId}/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const lockData = await lockRes.json();

  if (!lockRes.ok) {
    return { userId, outcome: 'FAILED_TO_LOCK', reason: lockData.error };
  }

  const bookRes = await fetch(`${BASE_URL}/api/seats/${seatId}/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const bookData = await bookRes.json();

  if (!bookRes.ok) {
    return { userId, outcome: 'FAILED_TO_BOOK', reason: bookData.error };
  }

  return { userId, outcome: 'BOOKED' };
}

(async () => {
  console.log(`\nFiring ${NUM_USERS} concurrent booking attempts at seat ${seatId}...\n`);

  const users = Array.from({ length: NUM_USERS }, (_, i) => `user-${i + 1}`);
  const results = await Promise.all(users.map(attemptLockAndBook));

  const booked = results.filter((r) => r.outcome === 'BOOKED');
  const failed = results.filter((r) => r.outcome !== 'BOOKED');

  results.forEach((r) => {
    const line = `${r.userId.padEnd(10)} -> ${r.outcome}${r.reason ? ' (' + r.reason + ')' : ''}`;
    console.log(r.outcome === 'BOOKED' ? `✅ ${line}` : `❌ ${line}`);
  });

  console.log(`\n--- RESULT ---`);
  console.log(`Successful bookings: ${booked.length} (should be exactly 1)`);
  console.log(`Rejected attempts:   ${failed.length} (should be ${NUM_USERS - 1})`);
  console.log(
    booked.length === 1
      ? '\n🎉 PASS: No double-booking occurred despite concurrent requests.\n'
      : '\n🚨 FAIL: Double-booking occurred!\n'
  );
})();
