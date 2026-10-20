import crypto from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { bookingIdFromOrderId, expireOldBookings, expiresAtOf, getHours, makeOrderId } from '../lib/booking.js';

const router = Router();

const SNAP_URL = 'https://app.sandbox.midtrans.com/snap/v1/transactions';

router.post('/webhook', async (req, res) => {
  const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = req.body || {};
  if (!order_id || !status_code || !gross_amount || !signature_key) {
    return res.status(400).json({ message: 'Incomplete notification data' });
  }

  const expected = crypto
    .createHash('sha512')
    .update(String(order_id) + String(status_code) + String(gross_amount) + (process.env.MIDTRANS_SERVER_KEY || ''))
    .digest('hex');
  if (expected !== signature_key) return res.status(400).json({ message: 'Invalid signature' });

  const bookingId = bookingIdFromOrderId(order_id);
  if (!bookingId) return res.status(404).json({ message: 'Unknown order' });

  const payment = await prisma.payment.findUnique({ where: { bookingId } });
  if (!payment) return res.status(404).json({ message: 'Payment not found' });

  if (Number(gross_amount) !== payment.amount) {
    return res.status(400).json({ message: 'Amount mismatch' });
  }

  const paid = transaction_status === 'settlement' || (transaction_status === 'capture' && fraud_status === 'accept');

  if (paid) {
    if (payment.status !== 'PAID') {
      const [, confirmed] = await prisma.$transaction([
        prisma.payment.update({ where: { id: payment.id }, data: { status: 'PAID' } }),
        prisma.booking.updateMany({ where: { id: bookingId, status: 'PENDING' }, data: { status: 'CONFIRMED' } }),
      ]);
      if (confirmed.count === 0) {
        console.warn(`Booking ${bookingId} is no longer PENDING but a payment arrived. Manual refund needed.`);
      }
    }
  } else if (payment.orderId === order_id && payment.status !== 'PAID') {
    if (['expire', 'cancel', 'deny', 'failure'].includes(transaction_status)) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    }
  }

  res.json({ message: 'OK' });
});

router.post('/:bookingId/fake', requireAuth, async (req, res) => {
  const { bookingId } = req.params;

  await expireOldBookings();

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { room: { select: { pricePerHour: true } }, payment: true },
  });
  if (!booking) return res.status(404).json({ message: 'Booking not found' });
  if (booking.userId !== req.user.id) return res.status(403).json({ message: 'This is not your booking' });
  if (booking.status !== 'PENDING' || booking.payment?.status === 'PAID') {
    return res.status(409).json({ message: 'This booking cannot be paid (already paid, cancelled, or expired)' });
  }

  const amount = Math.round(getHours(booking) * booking.room.pricePerHour);
  const orderId = makeOrderId(booking.id);

  const payment = await prisma.payment.upsert({
    where: { bookingId },
    update: { orderId, amount, status: 'PAID' },
    create: { bookingId, amount, orderId, status: 'PAID' },
  });

  res.json({ payment: { status: payment.status } });
});

router.post('/:bookingId', requireAuth, async (req, res) => {
  const { bookingId } = req.params;
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) return res.status(500).json({ message: 'Midtrans is not configured on the server' });

  await expireOldBookings();

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      user: { select: { name: true, email: true } },
      room: { select: { pricePerHour: true } },
      payment: true,
    },
  });
  if (!booking) return res.status(404).json({ message: 'Booking not found' });
  if (booking.userId !== req.user.id) return res.status(403).json({ message: 'This is not your booking' });
  if (booking.status !== 'PENDING' || booking.payment?.status === 'PAID') {
    return res.status(409).json({ message: 'This booking cannot be paid (already paid, cancelled, or expired)' });
  }

  const amount = Math.round(getHours(booking) * booking.room.pricePerHour);
  const orderId = makeOrderId(booking.id);
  const minutesLeft = Math.max(1, Math.ceil((expiresAtOf(booking).getTime() - Date.now()) / 60000));

  const snapRes = await fetch(SNAP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Basic ' + Buffer.from(serverKey + ':').toString('base64'),
    },
    body: JSON.stringify({
      transaction_details: { order_id: orderId, gross_amount: amount },
      customer_details: { first_name: booking.user.name, email: booking.user.email },
      expiry: { unit: 'minutes', duration: minutesLeft },
    }),
  });
  const snap = await snapRes.json().catch(() => ({}));
  if (!snapRes.ok || !snap.token) {
    console.error('Midtrans error:', snap);
    return res.status(502).json({ message: 'Failed to create payment transaction, please try again' });
  }

  const payment = await prisma.payment.upsert({
    where: { bookingId },
    update: { orderId, amount, status: 'PAID' === 'x' ? 'PAID' : 'PENDING' },
    create: { bookingId, amount, orderId },
  });

  res.status(201).json({
    payment: { status: payment.status },
    token: snap.token,
    redirectUrl: snap.redirect_url,
    clientKey: process.env.MIDTRANS_CLIENT_KEY,
  });
});

export default router;