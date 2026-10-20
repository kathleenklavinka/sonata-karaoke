const listEl = document.getElementById('bookingList');
const msgEl = document.getElementById('listMsg');

async function loadBookings() {
  try {
    const { bookings } = await api('/bookings/me');
    listEl.innerHTML = bookings.map((b) => {
      const id = escapeHtml(b.id);
      const canPay = b.status === 'PENDING';
      const canCancel = ['PENDING', 'CONFIRMED'].includes(b.status) && new Date(b.startTime) > new Date();
      return `
        <article class="card booking-item">
          <div>
            <h3>${escapeHtml(b.room.name)}</h3>
            <p>${escapeHtml(fmtRange(b.startTime, b.endTime))}</p>
            <p class="price">${rupiah(b.totalPrice)}</p>
          </div>
          <div class="booking-side">
            ${statusBadge(b.status)}
            <div class="actions">
              ${canPay ? `<a class="btn btn-sm" href="/payment.html?booking=${encodeURIComponent(b.id)}">Pay</a>` : ''}
              ${canCancel ? `<button class="btn btn-outline btn-sm" data-cancel="${id}">Cancel</button>` : ''}
            </div>
          </div>
        </article>`;
    }).join('') || '<p class="muted">No bookings yet. <a href="/index.html#rooms">Browse rooms</a> to get started.</p>';
  } catch (err) {
    if (err.status === 401) return logout();
    msgEl.textContent = err.message;
  }
}

listEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-cancel]');
  if (!btn) return;
  if (!confirm('Cancel this booking?')) return;
  msgEl.textContent = '';
  btn.disabled = true;
  try {
    await api(`/bookings/${encodeURIComponent(btn.dataset.cancel)}/cancel`, { method: 'PATCH' });
  } catch (err) {
    msgEl.textContent = err.message;
  }
  loadBookings();
});

if (!localStorage.getItem('token')) {
  window.location.href = '/index.html';
} else {
  loadBookings();
}