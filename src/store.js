import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import {
  DATA_DIR,
  DB_FILE,
  SESSIONS_FILE,
  TMP_DIR,
  UPLOAD_DIR,
  USERS_FILE,
} from './paths.js';

/**
 * Tiny JSON-file backed store. Writes to a given file are serialised through a
 * promise chain, so two concurrent requests can never clobber each other.
 */

const queues = new Map();

export function ensureDirs() {
  for (const dir of [DATA_DIR, TMP_DIR, UPLOAD_DIR]) {
    fssync.mkdirSync(dir, { recursive: true });
  }
  for (const file of [DB_FILE, USERS_FILE, SESSIONS_FILE]) {
    if (!fssync.existsSync(file)) fssync.writeFileSync(file, '[]', 'utf8');
  }
}

async function readJson(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

/** Run `mutator(rows)` exclusively for `file`; its return value goes to the caller. */
function mutate(file, mutator) {
  const previous = queues.get(file) ?? Promise.resolve();
  const run = previous.then(async () => {
    const rows = await readJson(file);
    const result = await mutator(rows);
    await writeJson(file, rows);
    return result;
  });
  // Keep the chain alive even if this mutation rejects.
  queues.set(file, run.catch(() => {}));
  return run;
}

/* ---------------------------------------------------------------- projects */

export function readProjects() {
  return readJson(DB_FILE);
}

export function addProject(project) {
  return mutate(DB_FILE, (projects) => {
    projects.unshift(project);
    return project;
  });
}

export async function getProject(id) {
  const projects = await readProjects();
  return projects.find((p) => p.id === id) ?? null;
}

/** Apply `patch` to one project and return the updated record. */
export function updateProject(id, patch) {
  return mutate(DB_FILE, (projects) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return null;
    Object.assign(project, patch);
    return project;
  });
}

export function removeProject(id) {
  return mutate(DB_FILE, (projects) => {
    const index = projects.findIndex((p) => p.id === id);
    if (index === -1) return null;
    return projects.splice(index, 1)[0];
  });
}

/** Detach every project owned by `userId` (used when an account is deleted). */
export function orphanProjectsOf(userId) {
  return mutate(DB_FILE, (projects) => {
    const touched = projects.filter((p) => p.ownerId === userId);
    for (const project of touched) project.ownerId = null;
    return touched.length;
  });
}

export async function deleteProjectFiles(id) {
  if (!/^[a-z0-9]{8,64}$/.test(id)) throw new Error('unsafe project id');
  await fs.rm(path.join(UPLOAD_DIR, id), { recursive: true, force: true });
}

/* ------------------------------------------------------------------- users */

export function readUsers() {
  return readJson(USERS_FILE);
}

export async function getUser(id) {
  const users = await readUsers();
  return users.find((u) => u.id === id) ?? null;
}

export async function getUserByEmail(email) {
  const users = await readUsers();
  const needle = email.trim().toLowerCase();
  return users.find((u) => u.email === needle) ?? null;
}

/** Insert a user, refusing duplicate emails inside the same exclusive turn. */
export function addUser(user) {
  return mutate(USERS_FILE, (users) => {
    if (users.some((u) => u.email === user.email)) return null;
    // The very first account runs the place, so there is always an admin.
    const row = { ...user, role: users.length === 0 ? 'admin' : user.role };
    users.push(row);
    return row;
  });
}

export function updateUser(id, patch) {
  return mutate(USERS_FILE, (users) => {
    const user = users.find((u) => u.id === id);
    if (!user) return null;
    Object.assign(user, patch);
    return user;
  });
}

export function removeUser(id) {
  return mutate(USERS_FILE, (users) => {
    const index = users.findIndex((u) => u.id === id);
    if (index === -1) return null;
    return users.splice(index, 1)[0];
  });
}

export async function countAdmins() {
  const users = await readUsers();
  return users.filter((u) => u.role === 'admin').length;
}

/* ---------------------------------------------------------------- sessions */

/** Sessions hold a SHA-256 of the cookie token, never the token itself. */
export function addSession(session) {
  return mutate(SESSIONS_FILE, (sessions) => {
    const now = Date.now();
    const live = sessions.filter((s) => s.expiresAt > now);
    sessions.length = 0;
    sessions.push(...live, session);
    return session;
  });
}

export async function findSession(tokenHash) {
  const sessions = await readJson(SESSIONS_FILE);
  const session = sessions.find((s) => s.tokenHash === tokenHash);
  if (!session) return null;
  return session.expiresAt > Date.now() ? session : null;
}

export function removeSession(tokenHash) {
  return mutate(SESSIONS_FILE, (sessions) => {
    const index = sessions.findIndex((s) => s.tokenHash === tokenHash);
    if (index === -1) return null;
    return sessions.splice(index, 1)[0];
  });
}

/** Drop every session for a user — used on password change and account deletion. */
export function removeSessionsOf(userId) {
  return mutate(SESSIONS_FILE, (sessions) => {
    const kept = sessions.filter((s) => s.userId !== userId);
    const dropped = sessions.length - kept.length;
    sessions.length = 0;
    sessions.push(...kept);
    return dropped;
  });
}
