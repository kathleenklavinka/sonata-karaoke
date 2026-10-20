const roomForm = document.getElementById('roomForm');
const formMsg = document.getElementById('formMsg');
const formTitle = document.getElementById('formTitle');
const formSubmit = document.getElementById('formSubmit');
const cancelEdit = document.getElementById('cancelEdit');
const roomsEl = document.getElementById('adminRoomList');
const bookingsEl = document.getElementById('adminBookingList');
const bookingMsg = document.getElementById('bookingMsg');

let adminRooms = [];
let editingId = null;

async function guardAdmin() {
  if (!localStorage.getItem('token')) {
    window.location.href = '/index.html';
    return false;
  }
  try {
    const { user } = await api('/auth/me');
    if (user.role !== 'ADMIN') throw new Error('Not an admin');
    return true;
  } catch {
    window.location.href = '/index.html';
    return false;
  }
}

// rooms
function resetForm() {
  editingId = null;
  roomForm.reset();
  formTitle.textContent = 'Add Room';
  formSubmit.textContent = 'Save Room';
  cancelEdit.hidden = true;
  formMsg.textContent = '';
}

function startEdit(room) {
  const setField = (name, value) => { roomForm.elements.namedItem(name).value = value ?? ''; };
  editingId = room.id;
  setField('name', room.name);
  setField('capacity', room.capacity);
  setField('pricePerHour', room.pricePerHour);
  setField('description', room.description);
  formTitle.textContent = 'Edit Room';
  formSubmit.textContent = 'Save changes';
  cancelEdit.hidden = false;
  formMsg.textContent = '';
  roomForm.scrollIntoView({ behavior: 'smooth' });
}

function roomCard(r) {
  const id = escapeHtml(r.id);
  return `
    <article class="card room-admin ${r.isActive ? '' : 'inactive'}">
      <div class="room-admin-head">
        <h3>${escapeHtml(r.name)}</h3>
        <span class="pill ${r.isActive ? 'pill-on' : 'pill-off'}">${r.isActive ? 'Active' : 'Inactive'}</span>
      </div>
      <p class="muted">${escapeHtml(r.description || '-')}</p>
      <ul class="meta">
        <li>${Number(r.capacity)} people</li>
        <li class="price">${rupiah(r.pricePerHour)}/hr</li>
      </ul>
      <div class="actions">
        <button class="btn btn-outline btn-sm" data-edit="${id}">Edit</button>
        ${r.isActive
          ? `<button class="btn btn-outline btn-sm" data-deactivate="${id}">Deactivate</button>`
          : `<button class="btn btn-sm" data-activate="${id}">Activate</button>`}
      </div>
    </article>`;
}

async function loadAdminRooms() {
  try {
    const { rooms } = await api('/rooms/admin/all');
    adminRooms = rooms;
    roomsEl.innerHTML = rooms.map(roomCard).join('') || '<p class="muted">No rooms yet.</p>';
  } catch (err) {
    roomsEl.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

roomForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formMsg.textContent = '';
  const body = Object.fromEntries(new FormData(roomForm));
  try {
    if (editingId) await api(`/rooms/${encodeURIComponent(editingId)}`, { method: 'PATCH', body });
    else await api('/rooms', { method: 'POST', body });
    resetForm();
    loadAdminRooms();
  } catch (err) {
    formMsg.textContent = err.message;
  }
});

cancelEdit.addEventListener('click', resetForm);

roomsEl.addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) {
    const room = adminRooms.find((r) => r.id === editBtn.dataset.edit);
    if (room) startEdit(room);
    return;
  }

  const onBtn = e.target.closest('[data-activate]');
  if (onBtn) {
    try {
      await api(`/rooms/${encodeURIComponent(onBtn.dataset.activate)}`, {
        method: 'PATCH',
        body: { isActive: true },
      });
      loadAdminRooms();
    } catch (err) {
      formMsg.textContent = err.message;
    }
    return;
  }

  const offBtn = e.target.closest('[data-deactivate]');
  if (!offBtn) return;
  if (!confirm('Deactivate this room? It will disappear from the homepage, but booking history stays intact.')) return;
  try {
    await api(`/rooms/${encodeURIComponent(offBtn.dataset.deactivate)}`, { method: 'DELETE' });
    if (editingId === offBtn.dataset.deactivate) resetForm();
    loadAdminRooms();
  } catch (err) {
    formMsg.textContent = err.message;
  }
});

// bookings
function payBadge(b) {
  return b.status === 'PENDING' && b.payment?.status === 'PAID'
    ? ' <span class="pill pill-on">Paid</span>'
    : '';
}

function adminActions(b) {
  const id = escapeHtml(b.id);
  const paid = b.payment?.status === 'PAID';
  const confirmBtn = b.status === 'PENDING' && paid
    ? `<button class="btn btn-sm" data-status="CONFIRMED" data-id="${id}">Confirm</button>` : '';
  const cancelBtn = ['PENDING', 'CONFIRMED'].includes(b.status)
    ? `<button class="btn btn-outline btn-sm" data-status="CANCELLED" data-id="${id}">Cancel</button>` : '';
  return confirmBtn || cancelBtn ? `<div class="actions">${confirmBtn}${cancelBtn}</div>` : '-';
}

async function loadAdminBookings() {
  try {
    const { bookings } = await api('/bookings');
    bookingsEl.innerHTML = bookings.map((b) => `
      <tr>
        <td>#${escapeHtml(b.id.slice(0, 8))}</td>
        <td>${escapeHtml(b.user.name)}<br /><span class="muted">${escapeHtml(b.user.email)}</span></td>
        <td>${escapeHtml(b.room.name)}</td>
        <td>${escapeHtml(fmtRange(b.startTime, b.endTime))}</td>
        <td>${rupiah(b.totalPrice)}</td>
        <td>${statusBadge(b.status)}${payBadge(b)}</td>
        <td>${adminActions(b)}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">No bookings yet.</td></tr>';
  } catch (err) {
    bookingMsg.textContent = err.message;
  }
}

bookingsEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-status]');
  if (!btn) return;
  const status = btn.dataset.status;
  if (!confirm(status === 'CANCELLED' ? 'Cancel this booking?' : 'Confirm this booking?')) return;
  bookingMsg.textContent = '';
  try {
    await api(`/bookings/${encodeURIComponent(btn.dataset.id)}/status`, { method: 'PATCH', body: { status } });
  } catch (err) {
    bookingMsg.textContent = err.message;
  }
  loadAdminBookings();
});

(async () => {
  if (await guardAdmin()) {
    document.getElementById('adminContent').hidden = false;
    loadAdminRooms();
    loadAdminBookings();
  }
})();