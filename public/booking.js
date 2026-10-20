const OPEN_HOUR = 10; // must match src/lib/booking.js
const CLOSE_HOUR = 22;

const roomId = new URLSearchParams(window.location.search).get('room'); // UUID (string)
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const wibToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

let room = null;
let booked = []; // [{ start, end }] in milliseconds
let sel = null;  // selected hours, end hour is exclusive

const slotTime = (date, hour) => new Date(`${date}T${pad(hour)}:00:00+07:00`).getTime();

function isTaken(date, hour) {
  const s = slotTime(date, hour);
  const e = s + 3600000;
  return s <= Date.now() || booked.some((b) => s < b.end && e > b.start);
}

function renderSlots() {
  const date = $('dateInput').value;
  let html = '';
  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
    const active = sel && h >= sel.start && h < sel.end;
    html += `<button type="button" class="slot${active ? ' active' : ''}" data-hour="${h}"${isTaken(date, h) ? ' disabled' : ''}>${pad(h)}:00</button>`;
  }
  $('slotGrid').innerHTML = html;
}

function renderSummary() {
  if (!sel) {
    $('summaryTime').textContent = 'No hours selected';
    $('summaryTotal').textContent = '';
    $('submitBtn').disabled = true;
    return;
  }
  const hours = sel.end - sel.start;
  $('summaryTime').textContent = `${pad(sel.start)}:00 - ${pad(sel.end)}:00 (${hours} hr)`;
  $('summaryTotal').textContent = rupiah(hours * room.pricePerHour);
  $('submitBtn').disabled = false;
}

async function loadSlots() {
  sel = null;
  try {
    const data = await api(`/rooms/${encodeURIComponent(roomId)}/slots?date=${$('dateInput').value}`);
    booked = data.booked.map((b) => ({ start: new Date(b.startTime).getTime(), end: new Date(b.endTime).getTime() }));
    $('formMsg').textContent = '';
  } catch (err) {
    booked = [];
    $('formMsg').textContent = err.message;
  }
  renderSlots();
  renderSummary();
}

$('slotGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('.slot');
  if (!btn || btn.disabled) return;
  const h = Number(btn.dataset.hour);
  if (sel && h === sel.end) sel.end = h + 1;            // extend forward
  else if (sel && h === sel.start - 1) sel.start = h;   // extend backward
  else sel = { start: h, end: h + 1 };                  // start a new selection
  renderSlots();
  renderSummary();
});

$('dateInput').addEventListener('change', loadSlots);

$('submitBtn').addEventListener('click', async () => {
  if (!sel) return;
  $('submitBtn').disabled = true;
  $('formMsg').textContent = '';
  const date = $('dateInput').value;
  try {
    const { booking } = await api('/bookings', {
      method: 'POST',
      body: {
        roomId,
        startTime: `${date}T${pad(sel.start)}:00:00+07:00`,
        endTime: `${date}T${pad(sel.end)}:00:00+07:00`,
      },
    });
    window.location.href = `/payment.html?booking=${encodeURIComponent(booking.id)}`;
  } catch (err) {
    if (err.status === 401) return logout();
    if (err.status === 409) await loadSlots(); // schedule changed, reload
    $('formMsg').textContent = err.message;
    renderSummary();
  }
});

(async () => {
  if (!localStorage.getItem('token')) {
    window.location.href = '/index.html';
    return;
  }
  if (!roomId) {
    $('pageMsg').textContent = 'No room selected. Go back to the homepage and pick a room.';
    return;
  }
  try {
    room = (await api(`/rooms/${encodeURIComponent(roomId)}`)).room;
  } catch (err) {
    $('pageMsg').textContent = err.message;
    return;
  }
  $('roomInfo').innerHTML = `
    <h3>${escapeHtml(room.name)}</h3>
    <p class="muted">${escapeHtml(room.description || 'A comfy private karaoke room for you and your crew.')}</p>
    <ul class="meta">
      <li>${Number(room.capacity)} people</li>
      <li class="price">${rupiah(room.pricePerHour)}/hr</li>
    </ul>
    <p class="muted">Open ${OPEN_HOUR}:00 – ${CLOSE_HOUR}:00 WIB</p>`;
  $('dateInput').min = $('dateInput').value = wibToday();
  $('pageMsg').hidden = true;
  $('bookingContent').hidden = false;
  loadSlots();
})();