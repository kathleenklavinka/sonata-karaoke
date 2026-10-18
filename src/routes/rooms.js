import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ACTIVE_STATUSES, getDayRange, expireOldBookings } from '../lib/booking.js';

const router = Router();

// description is required because the Room model has `description String` (not nullable)
const roomSchema = z.object({
  name: z.string().trim().min(2, 'Room name must be at least 2 characters'),
  capacity: z.coerce.number().int('Capacity must be a whole number').positive('Capacity must be greater than 0'),
  pricePerHour: z.coerce.number().int('Price must be a whole number').positive('Price must be greater than 0'),
  description: z.string().trim().min(1, 'Description is required'),
});

router.get('/', async (req, res) => {
  const rooms = await prisma.room.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  res.json({ rooms });
});

router.get('/:id', async (req, res) => {
  const room = await prisma.room.findFirst({ where: { id: req.params.id, isActive: true } });
  if (!room) return res.status(404).json({ message: 'Room not found' });
  res.json({ room });
});

// Hours already taken on one date (public, contains no user data)
router.get('/:id/slots', async (req, res) => {
  const date = String(req.query.date || '');
  const range = getDayRange(date);
  if (!range) return res.status(400).json({ message: 'Invalid date, use YYYY-MM-DD format' });

  const room = await prisma.room.findFirst({ where: { id: req.params.id, isActive: true }, select: { id: true } });
  if (!room) return res.status(404).json({ message: 'Room not found' });

  await expireOldBookings();

  const booked = await prisma.booking.findMany({
    where: {
      roomId: room.id,
      status: { in: ACTIVE_STATUSES },
      startTime: { lt: range.end },
      endTime: { gt: range.start },
    },
    select: { startTime: true, endTime: true },
    orderBy: { startTime: 'asc' },
  });
  res.json({ date, booked });
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const parsed = roomSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
  const room = await prisma.room.create({ data: parsed.data });
  res.status(201).json({ room });
});

router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const parsed = roomSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
  if (Object.keys(parsed.data).length === 0) return res.status(400).json({ message: 'No changes provided' });

  try {
    const room = await prisma.room.update({ where: { id: req.params.id }, data: parsed.data });
    res.json({ room });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ message: 'Room not found' });
    throw err;
  }
});

// "Delete" = deactivate, so old booking history still points to a valid room
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const room = await prisma.room.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ room });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ message: 'Room not found' });
    throw err;
  }
});

export default router;