import { prisma } from './prisma.js';

export const OPEN_HOUR = 10;
export const CLOSE_HOUR = 22;
export const PAY_WINDOW_MS = 15 * 60 * 1000;
export const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED'];

const toWib = (date) => new Date(date.getTime() + 7 * 60 * 60 * 1000);

export function getDayRange(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  const start = new Date(`${dateString}T00:00:00+07:00`);

  if (Number.isNaN(start.getTime())) return null;
  if (toWib(start).toISOString().slice(0, 10) !== dateString) return null;

  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function validateTimeRange(start, end) {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Invalid time format';
  }

  if (end <= start) return 'End time must be after start time';

  if (start <= new Date()) return 'Start time must be in the future';

  const startWib = toWib(start);
  const endWib = toWib(end);

  const isFullHour = (d) => d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  if (!isFullHour(startWib) || !isFullHour(endWib)) {
    return 'Booking must be in full hours (e.g. 13:00 to 15:00)';
  }

  const startDate = startWib.toISOString().slice(0, 10);
  const endDate = endWib.toISOString().slice(0, 10);
  if (startDate !== endDate) return 'Booking must end on the same day';

  if (startWib.getUTCHours() < OPEN_HOUR || endWib.getUTCHours() > CLOSE_HOUR) {
    return `Opening hours are ${OPEN_HOUR}:00 to ${CLOSE_HOUR}:00 (WIB)`;
  }

  return null;
}

export const getHours = (booking) =>
  (booking.endTime.getTime() - booking.startTime.getTime()) / (60 * 60 * 1000);

export const expiresAtOf = (booking) =>
  new Date(booking.createdAt.getTime() + PAY_WINDOW_MS);

export function addComputedFields(booking) {
  return {
    ...booking,
    totalPrice: booking.payment?.amount ?? getHours(booking) * booking.room.pricePerHour,
    expiresAt: expiresAtOf(booking),
  };
}

export async function expireOldBookings() {
  const cutoff = new Date(Date.now() - PAY_WINDOW_MS);

  const oldBookings = await prisma.booking.findMany({
    where: {
      status: 'PENDING',
      createdAt: { lt: cutoff },
      NOT: { payment: { is: { status: 'PAID' } } },
    },
    select: { id: true },
  });
  if (oldBookings.length === 0) return;

  const ids = oldBookings.map((b) => b.id);

  await prisma.$transaction([
    prisma.booking.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    }),
    prisma.payment.updateMany({
      where: { bookingId: { in: ids }, status: 'PENDING' },
      data: { status: 'FAILED' },
    }),
  ]);
}

export function makeOrderId(bookingId) {
  return `SNT${bookingId.replaceAll('-', '')}${Date.now().toString(36)}`;
}

export function bookingIdFromOrderId(orderId) {
  const m = /^SNT([0-9a-f]{32})[0-9a-z]+$/.exec(String(orderId));
  if (!m) return null;
  const h = m[1];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}