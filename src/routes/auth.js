import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const email = z.string().trim().toLowerCase().email('Invalid email format');

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  email,
  password: z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password must be at most 72 characters'),
});

const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const signToken = (u) => jwt.sign({ id: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message });
  }
  const { name, email, password } = parsed.data;

  if (await prisma.user.findUnique({ where: { email } })) {
    return res.status(409).json({ message: 'Email is already registered, please log in' });
  }

  try {
    // role is never taken from the request, it defaults to CUSTOMER from the schema
    const user = await prisma.user.create({
      data: { name, email, password: await bcrypt.hash(password, 10) },
    });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ message: 'Email is already registered, please log in' });
    throw err;
  }
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  // same message for wrong email and wrong password on purpose
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: 'Incorrect email or password' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;