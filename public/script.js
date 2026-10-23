const rupiah = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* api */
async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    const err = new Error('Cannot connect to the server');
    err.status = 0;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Something went wrong');
    err.status = res.status;
    throw err;
  }
  return data;
}

const getUser = () => {
  try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
};

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/index.html';
}

/* status */
const STATUS_LABEL = {
  PENDING: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

const statusBadge = (s) =>
  `<span class="badge status-${escapeHtml(String(s).toLowerCase())}">${escapeHtml(STATUS_LABEL[s] || s)}</span>`;

function fmtRange(startIso, endIso) {
  const zone = { timeZone: 'Asia/Jakarta' };
  const day = new Date(startIso).toLocaleDateString('en-GB', { ...zone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { ...zone, hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time(startIso)} - ${time(endIso)}`;
}

/* modals */
function injectAuthModals() {
  if (document.getElementById('loginModal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal" id="loginModal" role="dialog" aria-modal="true" aria-labelledby="loginTitle" hidden>
      <div class="modal-box">
        <button type="button" class="modal-close" data-close aria-label="Close">&times;</button>
        <h3 id="loginTitle">Log in</h3>
        <form id="loginForm" novalidate>
          <input type="email" name="email" placeholder="Email" autocomplete="email" required />
          <input type="password" name="password" placeholder="Password" autocomplete="current-password" required />
          <p class="error" id="loginMsg" role="alert"></p>
          <button type="submit" class="btn">Log in</button>
        </form>
        <p class="switch">No account yet? <button type="button" data-open="registerModal">Sign up</button></p>
      </div>
    </div>
    <div class="modal" id="registerModal" role="dialog" aria-modal="true" aria-labelledby="registerTitle" hidden>
      <div class="modal-box">
        <button type="button" class="modal-close" data-close aria-label="Close">&times;</button>
        <h3 id="registerTitle">Sign up</h3>
        <form id="registerForm" novalidate>
          <input type="text" name="name" placeholder="Full name" autocomplete="name" required />
          <input type="email" name="email" placeholder="Email" autocomplete="email" required />
          <input type="password" name="password" placeholder="Password (at least 8 characters)" autocomplete="new-password" required />
          <p class="error" id="registerMsg" role="alert"></p>
          <button type="submit" class="btn">Create account</button>
        </form>
        <p class="switch">Already have an account? <button type="button" data-open="loginModal">Log in</button></p>
      </div>
    </div>`);
}

function closeModals() {
  document.querySelectorAll('.modal').forEach((m) => { m.hidden = true; });
}

function openModal(id) {
  closeModals();
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  modal.querySelector('input')?.focus();
}

function afterAuth(user) {
  const next = sessionStorage.getItem('afterLogin');
  sessionStorage.removeItem('afterLogin');
  if (user.role === 'ADMIN') window.location.href = '/admin.html';
  else if (next) window.location.href = next;
  else window.location.reload();
}

async function submitAuth(form, path, msgEl) {
  msgEl.textContent = '';
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const { token, user } = await api(path, { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    afterAuth(user);
  } catch (err) {
    msgEl.textContent = err.message;
    btn.disabled = false;
  }
}

/* navbar */
function renderAuth() {
  const el = document.getElementById('navAuth');
  if (!el) return;
  const user = localStorage.getItem('token') ? getUser() : null;
  el.innerHTML = user
    ? `${user.role === 'ADMIN' ? '<a href="/admin.html">Dashboard</a>' : '<a href="/my-bookings.html">My Bookings</a>'}
       <span class="hello">Hi, ${escapeHtml(user.name.split(' ')[0])}</span>
       <button type="button" class="btn btn-outline btn-sm" data-logout>Log out</button>`
    : `<button type="button" class="btn btn-outline btn-sm" data-open="loginModal">Log in</button>
       <button type="button" class="btn btn-sm" data-open="registerModal">Sign up</button>`;
}

/* rooms */
const ROOM_IMG = {
  'Room Small':  '/images/room-small.png',
  'Room Medium': '/images/room-medium.png',
  'Room VIP':    '/images/room-vip.png',
};

async function loadRooms() {
  const list = document.getElementById('roomList');
  if (!list) return;
  try {
    const { rooms } = await api('/rooms');
    list.innerHTML = rooms.map((r) => {
      const img = r.imageUrl || ROOM_IMG[r.name];
      return `
      <article class="card room-card${img ? ' has-photo' : ''}">
        ${img ? `<img class="room-img" src="${escapeHtml(img)}" alt="${escapeHtml(r.name)}" loading="lazy" />` : ''}
        <h3>${escapeHtml(r.name)}</h3>
        <p class="muted">${escapeHtml(r.description)}</p>
        <ul class="meta">
          <li>Fits ${Number(r.capacity)} people</li>
          <li class="price">${rupiah(r.pricePerHour)}/hour</li>
        </ul>
        <a class="btn" data-book href="/booking.html?room=${encodeURIComponent(r.id)}">Book now</a>
      </article>`;
    }).join('') || '<p class="muted">No rooms available yet.</p>';
  } catch (err) {
    list.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

/* events */
document.addEventListener('click', (e) => {
  const openBtn = e.target.closest('[data-open]');
  if (openBtn) return openModal(openBtn.dataset.open);

  if (e.target.closest('[data-close]') || e.target.classList.contains('modal')) return closeModals();
  if (e.target.closest('[data-logout]')) return logout();

  const book = e.target.closest('[data-book]');
  if (book && !localStorage.getItem('token')) {
    e.preventDefault();
    sessionStorage.setItem('afterLogin', book.getAttribute('href'));
    openModal('loginModal');
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

injectAuthModals();
document.getElementById('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitAuth(e.target, '/auth/login', document.getElementById('loginMsg'));
});
document.getElementById('registerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitAuth(e.target, '/auth/register', document.getElementById('registerMsg'));
});

renderAuth();
loadRooms();