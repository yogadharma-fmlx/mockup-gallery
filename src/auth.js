import crypto from 'node:crypto';
import {
  addSession,
  findSession,
  getUser,
  removeSession,
} from './store.js';

export const COOKIE_NAME = 'mc_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCRYPT_KEYLEN = 64;

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------- passwords */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored ?? '').split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/* --------------------------------------------------------------- cookies */

function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name) jar[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return jar;
}

function setCookie(res, value, maxAgeMs) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  // Only mark Secure behind TLS: a Secure cookie is dropped over plain http.
  if (process.env.SECURE_COOKIES === '1') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

/* -------------------------------------------------------------- sessions */

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await addSession({
    tokenHash: hashToken(token),
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  setCookie(res, token, SESSION_TTL_MS);
  return token;
}

export async function endSession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) await removeSession(hashToken(token));
  setCookie(res, '', 0);
}

/** Strips the password hash before a user record leaves the server. */
export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

/** Attaches `req.user` when the session cookie is valid. Never rejects. */
export async function attachUser(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (token) {
      const session = await findSession(hashToken(token));
      if (session) req.user = await getUser(session.userId);
    }
  } catch (err) {
    return next(err);
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(new AuthError('Please sign in first.', 401));
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return next(new AuthError('Please sign in first.', 401));
  if (req.user.role !== 'admin') return next(new AuthError('Admins only.', 403));
  next();
}

/** A project is editable by its owner, or by any admin. */
export function canManage(user, project) {
  if (!user || !project) return false;
  return user.role === 'admin' || (project.ownerId && project.ownerId === user.id);
}

/* ------------------------------------------------------------ validation */

export function normaliseEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    throw new AuthError('Please enter a valid email address.');
  }
  return email;
}

export function normaliseName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    throw new AuthError('Your name must be between 2 and 80 characters.');
  }
  return name;
}

export function checkPassword(value) {
  const password = String(value ?? '');
  if (password.length < 8 || password.length > 200) {
    throw new AuthError('Passwords must be at least 8 characters.');
  }
  return password;
}
