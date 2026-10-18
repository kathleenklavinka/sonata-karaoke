import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

// Verify the token, then load the user from the database so the role is always up to date.
export async function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Please log in first' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'Session expired, please log in again' });
  }

  const user = await prisma.user.findUnique({
    where: { id: String(payload.id) },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) return res.status(401).json({ message: 'Account not found, please log in again' });

  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admins only' });
  }
  next();
}