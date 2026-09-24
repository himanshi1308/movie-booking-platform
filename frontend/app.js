const API = 'http://localhost:4000/api';

// Simulate a logged-in user. Open this page in two different browser
// tabs/windows to see two DIFFERENT random user IDs try to book the same
// seat — that's how you demo the race-condition handling visually.
const userId = 'user-' + Math.floor(Math.random() * 100000);
document.getElementById('userBadge').textContent = `Logged in as ${userId}`;

const showListScreen = document.getElementById('showListScreen');
const seatScreen = document.getElementById('seatScreen');
const confirmScreen = document.getElementById('confirmScreen');

let currentShowId = null;
let selectedSeat = null; // { id, seat_number }
let holdInterval = null;
let seatsPollInterval = null;

// ---------- toast ----------
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ---------- screen 1: show list ----------
async function loadShows() {
  const res = await fetch(`${API}/shows`);
  const shows = await res.json();
  const list = document.getElementById('showList');
  list.innerHTML = '';
  shows.forEach((show) => {
    const card = document.createElement('div');
    card.className = 'show-card';
    card.innerHTML = `
      <div>
        <h3>${show.movie_name}</h3>
        <p>${show.theatre} · ${show.show_time}</p>
      </div>
      <div class="go">›</div>
    `;
    card.onclick = () => openShow(show);
    list.appendChild(card);
  });
}

// ---------- screen 2: seat map ----------
async function openShow(show) {
  currentShowId = show.id;
  selectedSeat = null;
  document.getElementById('seatScreenTitle').textContent = show.movie_name;
  document.getElementById('seatScreenSubtitle').textContent = `${show.theatre} · ${show.show_time}`;
  showListScreen.classList.add('hidden');
  seatScreen.classList.remove('hidden');
  await renderSeats();
  clearInterval(seatsPollInterval);
  // Poll every 2s so a seat someone else locks/books shows up live in your UI too
  seatsPollInterval = setInterval(renderSeats, 2000);
}

async function renderSeats() {
  const res = await fetch(`${API}/shows/${currentShowId}/seats`);
  const seats = await res.json();

  const rows = {};
  seats.forEach((s) => {
    const row = s.seat_number[0];
    (rows[row] = rows[row] || []).push(s);
  });

  const map = document.getElementById('seatMap');
  map.innerHTML = '';
  Object.keys(rows).sort().forEach((rowLabel) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'seat-row';
    rowEl.innerHTML = `<div class="row-label">${rowLabel}</div>`;
    rows[rowLabel]
      .sort((a, b) => a.seat_number.localeCompare(b.seat_number, undefined, { numeric: true }))
      .forEach((seat) => {
        const btn = document.createElement('div');
        let cls = seat.status; // available | locked | booked
        if (selectedSeat && selectedSeat.id === seat.id && seat.locked_by === userId) {
          cls = 'selected';
        }
        btn.className = `seat ${cls}`;
        btn.textContent = seat.seat_number;
        btn.title = `₹${seat.price}`;
        if (seat.status === 'available' || cls === 'selected') {
          btn.onclick = () => selectSeat(seat);
        }
        rowEl.appendChild(btn);
      });
    map.appendChild(rowEl);
  });
}

async function selectSeat(seat) {
  // If clicking the already-selected seat again, do nothing
  if (selectedSeat && selectedSeat.id === seat.id) return;

  // Release previous hold, if any
  if (selectedSeat) {
    await fetch(`${API}/seats/${selectedSeat.id}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
  }

  const res = await fetch(`${API}/seats/${seat.id}/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const data = await res.json();

  if (!res.ok) {
    toast(`⚠️ ${data.error} — someone else may have just grabbed it.`);
    selectedSeat = null;
    await renderSeats();
    return;
  }

  selectedSeat = { id: seat.id, seat_number: seat.seat_number, expiresAt: data.expiresAt };
  document.getElementById('confirmBtn').disabled = false;
  document.getElementById('checkoutInfo').textContent = `Seat ${seat.seat_number} selected — ₹${seat.price}`;
  startHoldTimer(data.expiresAt);
  await renderSeats();
}

function startHoldTimer(expiresAt) {
  clearInterval(holdInterval);
  const timerEl = document.getElementById('holdTimer');
  timerEl.classList.remove('hidden');

  holdInterval = setInterval(() => {
    const msLeft = expiresAt - Date.now();
    if (msLeft <= 0) {
      clearInterval(holdInterval);
      timerEl.classList.add('hidden');
      toast('⏰ Your seat hold expired. Please select again.');
      selectedSeat = null;
      document.getElementById('confirmBtn').disabled = true;
      document.getElementById('checkoutInfo').textContent = 'Select a seat to continue';
      renderSeats();
      return;
    }
    const secs = Math.ceil(msLeft / 1000);
    timerEl.textContent = `Held for ${secs}s — complete checkout before it releases`;
  }, 500);
}

document.getElementById('confirmBtn').onclick = async () => {
  if (!selectedSeat) return;
  const btn = document.getElementById('confirmBtn');
  btn.disabled = true;
  btn.textContent = 'Booking...';

  const res = await fetch(`${API}/seats/${selectedSeat.id}/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const data = await res.json();

  if (!res.ok) {
    toast(`❌ ${data.error}`);
    btn.textContent = 'Confirm Booking';
    selectedSeat = null;
    await renderSeats();
    return;
  }

  clearInterval(holdInterval);
  clearInterval(seatsPollInterval);
  document.getElementById('confirmDetails').textContent =
    `Seat ${selectedSeat.seat_number} is booked for ${userId}. Enjoy the show!`;
  seatScreen.classList.add('hidden');
  confirmScreen.classList.remove('hidden');
  btn.textContent = 'Confirm Booking';
  btn.disabled = false;
};

document.getElementById('backToShows').onclick = async () => {
  if (selectedSeat) {
    await fetch(`${API}/seats/${selectedSeat.id}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
  }
  clearInterval(holdInterval);
  clearInterval(seatsPollInterval);
  document.getElementById('holdTimer').classList.add('hidden');
  document.getElementById('confirmBtn').disabled = true;
  document.getElementById('checkoutInfo').textContent = 'Select a seat to continue';
  seatScreen.classList.add('hidden');
  showListScreen.classList.remove('hidden');
  loadShows();
};

document.getElementById('bookAnotherBtn').onclick = () => {
  confirmScreen.classList.add('hidden');
  showListScreen.classList.remove('hidden');
  loadShows();
};

loadShows();
