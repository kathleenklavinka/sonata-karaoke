import { prisma } from './prisma.js';

export const OPEN_HOUR = 10;
export const CLOSE_HOUR = 22; 
export const PAY_WINDOW_MS = 15 * 60 * 1000;
export const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED'];

// Using UTC internally, but the business logic is in WIB (UTC+7).
const toWib = (date) => new Date(date.getTime() + 7 * 60 * 60 * 1000);

// Allow booking only in full hours (e.g. 13:00, not 13:30).
export function getDayRange(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null; // year-month-day format
  const start = new Date(`${dateString}T00:00:00+07:00`);

  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000); // +24 hours
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

// Booking table doesnt have totalPrice and expiresAt, but we want to return them in the API response.
// so we add them here as computed fields.
export function addComputedFields(booking) {
  return {
    ...booking,
    totalPrice: booking.payment?.amount ?? getHours(booking) * booking.room.pricePerHour,
    expiresAt: new Date(booking.createdAt.getTime() + PAY_WINDOW_MS),
  };
}

// Booking past 15 min will be expired, and payment will be marked as failed. 
export async function expireOldBookings() {
  const cutoff = new Date(Date.now() - PAY_WINDOW_MS);
  
  // find all bookings that are still PENDING and created before the cutoff time
  const oldBookings = await prisma.booking.findMany({
    where: { status: 'PENDING', createdAt: { lt: cutoff } },
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