import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ACTIVE_STATUSES, expireOldBookings, validateTimeRange, addComputedFields } from '../lib/booking.js';

const router = Router();

const createSchema = z.object({
  roomId: z.string().min(1, 'Room ID is required'),
  startTime: z.string().min(1, 'startTime is required'),
  endTime: z.string().min(1, 'endTime is required'),
});

const roomSelect = { id: true, name: true, pricePerHour: true };
const paymentSelect = { status: true, amount: true };

// Customer
router.post('/', requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });

  const start = new Date(parsed.data.startTime);
  const end = new Date(parsed.data.endTime);
  const problem = validateTimeRange(start, end);
  if (problem) return res.status(400).json({ message: problem });

  const room = await prisma.room.findFirst({ where: { id: parsed.data.roomId, isActive: true } });
  if (!room) return res.status(404).json({ message: 'Room not found' });

  await expireOldBookings();

  try {
    const booking = await prisma.$transaction(
      async (tx) => {
        const conflict = await tx.booking.findFirst({
          where: {
            roomId: room.id,
            status: { in: ACTIVE_STATUSES },
            startTime: { lt: end },
            endTime: { gt: start },
          },
        });
        if (conflict) throw new Error('SLOT_CONFLICT');

        return tx.booking.create({
          data: { userId: req.user.id, roomId: room.id, startTime: start, endTime: end },
          include: { room: { select: roomSelect } },
        });
      },
      { isolationLevel: 'Serializable' }
    );
    res.status(201).json({ booking: addComputedFields(booking) });
  } catch (err) {
    const conflict =
      err.message === 'SLOT_CONFLICT' ||
      err.code === 'P2034' ||
      String(err.message).includes('booking_no_overlap');
    if (conflict) return res.status(409).json({ message: 'This time slot overlaps with another booking' });
    throw err;
  }
});

router.get('/me', requireAuth, async (req, res) => {
  await expireOldBookings();
  const bookings = await prisma.booking.findMany({
    where: { userId: req.user.id },
    orderBy: { startTime: 'desc' },
    include: { room: { select: roomSelect }, payment: { select: paymentSelect } },
  });
  res.json({ bookings: bookings.map(addComputedFields) });
});

// customer can only cancel PENDING bookings
router.patch('/:id/cancel', requireAuth, async (req, res) => {
  const { id } = req.params;
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) return res.status(404).json({ message: 'Booking not found' });
  if (booking.userId !== req.user.id) return res.status(403).json({ message: 'This is not your booking' });
  if (booking.startTime <= new Date()) {
    return res.status(409).json({ message: 'A booking that has already started cannot be cancelled' });
  }

  const [{ count }] = await prisma.$transaction([
    prisma.booking.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED' } }),
    prisma.payment.updateMany({ where: { bookingId: id, status: 'PENDING' }, data: { status: 'FAILED' } }),
  ]);
  if (count === 0) return res.status(409).json({ message: 'Only pending bookings can be cancelled' });

  const updated = await prisma.booking.findUnique({ where: { id } });
  res.json({ booking: updated });
});

// Admin
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  await expireOldBookings();
  const bookings = await prisma.booking.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { name: true, email: true } },
      room: { select: roomSelect },
      payment: { select: paymentSelect },
    },
  });
  res.json({ bookings: bookings.map(addComputedFields) });
});

router.patch('/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const parsed = z.object({ status: z.enum(['CONFIRMED', 'CANCELLED']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Status must be CONFIRMED or CANCELLED' });
  const { status } = parsed.data;

  await expireOldBookings();

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) return res.status(404).json({ message: 'Booking not found' });
  if (!ACTIVE_STATUSES.includes(booking.status)) {
    return res.status(400).json({ message: 'This booking is final, its status cannot be changed' });
  }

  if (status === 'CONFIRMED') {
    const payment = await prisma.payment.findUnique({ where: { bookingId: id } });
    if (payment?.status !== 'PAID') {
      return res.status(400).json({ message: 'Booking has not been paid yet' });
    }
  }

  const [updated] = await prisma.$transaction([
    prisma.booking.update({ where: { id }, data: { status } }),
    ...(status === 'CANCELLED'
      ? [prisma.payment.updateMany({ where: { bookingId: id, status: 'PENDING' }, data: { status: 'FAILED' } })]
      : []),
  ]);
  res.json({ booking: updated });
});

export default router;