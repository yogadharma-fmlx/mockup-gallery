import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { PUBLIC_DIR, TMP_DIR, UPLOAD_DIR } from './src/paths.js';
import { ExtractError, extractZip, storeSingleHtml } from './src/extract.js';
import {
  AuthError,
  attachUser,
  canManage,
  checkPassword,
  endSession,
  hashPassword,
  normaliseEmail,
  normaliseName,
  publicUser,
  requireAdmin,
  requireAuth,
  startSession,
  verifyPassword,
} from './src/auth.js';
import {
  addProject,
  addUser,
  countAdmins,
  deleteProjectFiles,
  ensureDirs,
  getProject,
  getUser,
  getUserByEmail,
  orphanProjectsOf,
  readProjects,
  readUsers,
  removeProject,
  removeSessionsOf,
  removeUser,
  updateProject,
  updateUser,
} from './src/store.js';

const PORT = Number(process.env.PORT) || 3000;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

ensureDirs();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomBytes(8).toString('hex')}.upload`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.html', '.htm', '.zip'].includes(ext)) return cb(null, true);
    cb(new ExtractError('Only .html and .zip files are accepted.'));
  },
});

const app = express();
app.disable('x-powered-by');

/* ---------------------------------------------------------------- mock-ups */

const staticCache = new Map();

function serveMockup(req, res, next) {
  const match = /^\/([a-z0-9]{8,64})(\/.*)?$/.exec(req.path);
  if (!match) return next();
  const [, id, rest] = match;
  const dir = path.join(UPLOAD_DIR, id);

  // `/view/<id>` with no trailing slash breaks relative asset URLs.
  if (!rest) return res.redirect(301, `/view/${id}/`);

  let handler = staticCache.get(id);
  if (!handler) {
    handler = express.static(dir, { index: false, dotfiles: 'ignore', fallthrough: true });
    staticCache.set(id, handler);
  }

  const queryAt = req.url.indexOf('?');
  const query = queryAt === -1 ? '' : req.url.slice(queryAt);

  if (rest === '/') {
    // Root of a mock-up: hand over its entry file.
    getProject(id)
      .then((project) => {
        if (!project) return next();
        req.url = `/${project.entryFile}${query}`;
        handler(req, res, next);
      })
      .catch(next);
    return;
  }

  req.url = rest + query;
  handler(req, res, next);
}

app.use('/view', serveMockup);

/* -------------------------------------------------------------- api setup */

const api = express.Router();
api.use(express.json({ limit: '32kb' }));
api.use(attachUser);
app.use('/api', api);

/* --------------------------------------------------------------- accounts */

api.post('/auth/register', async (req, res, next) => {
  try {
    const name = normaliseName(req.body.name);
    const email = normaliseEmail(req.body.email);
    const password = checkPassword(req.body.password);

    const user = await addUser({
      id: crypto.randomBytes(12).toString('hex'),
      name,
      email,
      role: 'member',
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    });
    if (!user) throw new AuthError('That email address is already registered.', 409);

    await startSession(res, user.id);
    res.status(201).json(publicUser(user));
  } catch (err) {
    next(err);
  }
});

api.post('/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');
    const user = await getUserByEmail(email);
    // Same message either way, so the form cannot be used to probe for accounts.
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new AuthError('Wrong email or password.', 401);
    }
    await startSession(res, user.id);
    res.json(publicUser(user));
  } catch (err) {
    next(err);
  }
});

api.post('/auth/logout', async (req, res, next) => {
  try {
    await endSession(req, res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

api.get('/auth/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

api.patch('/account', requireAuth, async (req, res, next) => {
  try {
    const patch = {};
    if (req.body.name !== undefined) patch.name = normaliseName(req.body.name);

    if (req.body.newPassword !== undefined) {
      if (!verifyPassword(String(req.body.currentPassword ?? ''), req.user.passwordHash)) {
        throw new AuthError('Your current password is not correct.', 403);
      }
      patch.passwordHash = hashPassword(checkPassword(req.body.newPassword));
    }

    if (!Object.keys(patch).length) throw new AuthError('Nothing to update.');
    const user = await updateUser(req.user.id, patch);

    if (patch.passwordHash) {
      // A new password invalidates everything, including this browser.
      await removeSessionsOf(user.id);
      await endSession(req, res);
    }
    res.json({ user: publicUser(user), signedOut: Boolean(patch.passwordHash) });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------- user administration */

api.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const [users, projects] = await Promise.all([readUsers(), readProjects()]);
    res.json(users.map((user) => ({
      ...publicUser(user),
      projectCount: projects.filter((p) => p.ownerId === user.id).length,
    })));
  } catch (err) {
    next(err);
  }
});

api.patch('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const target = await getUser(req.params.id);
    if (!target) throw new AuthError('User not found.', 404);

    const patch = {};
    if (req.body.name !== undefined) patch.name = normaliseName(req.body.name);
    if (req.body.role !== undefined) {
      if (!['admin', 'member'].includes(req.body.role)) throw new AuthError('Unknown role.');
      if (target.role === 'admin' && req.body.role !== 'admin' && (await countAdmins()) <= 1) {
        throw new AuthError('This is the last admin — promote someone else first.', 409);
      }
      patch.role = req.body.role;
    }
    if (!Object.keys(patch).length) throw new AuthError('Nothing to update.');

    res.json(publicUser(await updateUser(target.id, patch)));
  } catch (err) {
    next(err);
  }
});

api.delete('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      throw new AuthError('You cannot delete your own account here.', 409);
    }
    const target = await getUser(req.params.id);
    if (!target) throw new AuthError('User not found.', 404);
    if (target.role === 'admin' && (await countAdmins()) <= 1) {
      throw new AuthError('This is the last admin — promote someone else first.', 409);
    }

    // Mock-ups outlive their uploader; they become admin-managed instead.
    const orphaned = await orphanProjectsOf(target.id);
    await removeSessionsOf(target.id);
    await removeUser(target.id);
    res.json({ ok: true, orphanedProjects: orphaned });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------------------------------------- projects */

/** Show the owner's current name, falling back to the name captured at upload. */
function decorate(project, usersById, viewer) {
  const owner = project.ownerId ? usersById.get(project.ownerId) : null;
  return {
    ...project,
    uploader: owner?.name ?? project.uploader,
    ownerEmail: viewer?.role === 'admin' ? owner?.email ?? null : undefined,
    canManage: canManage(viewer, project),
  };
}

api.get('/projects', async (req, res, next) => {
  try {
    const [projects, users] = await Promise.all([readProjects(), readUsers()]);
    const usersById = new Map(users.map((u) => [u.id, u]));
    res.json(projects.map((p) => decorate(p, usersById, req.user)));
  } catch (err) {
    next(err);
  }
});

api.get('/projects/:id', async (req, res, next) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) throw new AuthError('Mock-up not found.', 404);
    const users = await readUsers();
    res.json(decorate(project, new Map(users.map((u) => [u.id, u])), req.user));
  } catch (err) {
    next(err);
  }
});

/** Unpack an upload into `destDir`, choosing the handler by extension. */
function ingest(file, destDir) {
  const ext = path.extname(file.originalname).toLowerCase();
  return ext === '.zip'
    ? extractZip(file.path, destDir).then((r) => ({ ...r, kind: 'zip' }))
    : storeSingleHtml(file.path, destDir).then((r) => ({ ...r, kind: 'html' }));
}

api.post('/projects', requireAuth, upload.single('file'), async (req, res, next) => {
  const tmpPath = req.file?.path;
  const id = crypto.randomBytes(12).toString('hex');
  const dir = path.join(UPLOAD_DIR, id);

  try {
    if (!req.file) throw new ExtractError('Please choose an .html or .zip file to upload.');

    const name = String(req.body.name ?? '').trim().slice(0, 120);
    const description = String(req.body.description ?? '').trim().slice(0, 500);
    if (!name) throw new ExtractError('Project name is required.');

    await fs.mkdir(dir, { recursive: true });
    const result = await ingest(req.file, dir);

    const project = {
      id,
      name,
      description,
      ownerId: req.user.id,
      uploader: req.user.name,
      entryFile: result.entryFile,
      fileCount: result.fileCount,
      originalName: req.file.originalname,
      kind: result.kind,
      sizeBytes: req.file.size,
      uploadedAt: new Date().toISOString(),
      updatedAt: null,
    };

    await addProject(project);
    res.status(201).json({ ...project, canManage: true });
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    next(err);
  } finally {
    if (tmpPath) await fs.rm(tmpPath, { force: true }).catch(() => {});
  }
});

api.patch('/projects/:id', requireAuth, upload.single('file'), async (req, res, next) => {
  const tmpPath = req.file?.path;
  const staging = path.join(UPLOAD_DIR, `.staging-${crypto.randomBytes(8).toString('hex')}`);

  try {
    const project = await getProject(req.params.id);
    if (!project) throw new AuthError('Mock-up not found.', 404);
    if (!canManage(req.user, project)) {
      throw new AuthError('You can only edit your own mock-ups.', 403);
    }

    const patch = { updatedAt: new Date().toISOString() };

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 120);
      if (!name) throw new ExtractError('Project name is required.');
      patch.name = name;
    }
    if (req.body.description !== undefined) {
      patch.description = String(req.body.description).trim().slice(0, 500);
    }

    if (req.file) {
      // Build the replacement alongside the old files, then swap it in.
      await fs.mkdir(staging, { recursive: true });
      const result = await ingest(req.file, staging);
      const dir = path.join(UPLOAD_DIR, project.id);
      await fs.rm(dir, { recursive: true, force: true });
      await fs.rename(staging, dir);
      staticCache.delete(project.id);

      Object.assign(patch, {
        entryFile: result.entryFile,
        fileCount: result.fileCount,
        originalName: req.file.originalname,
        kind: result.kind,
        sizeBytes: req.file.size,
      });
    }

    const updated = await updateProject(project.id, patch);
    res.json({ ...updated, canManage: true });
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    next(err);
  } finally {
    if (tmpPath) await fs.rm(tmpPath, { force: true }).catch(() => {});
  }
});

api.delete('/projects/:id', requireAuth, async (req, res, next) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) throw new AuthError('Mock-up not found.', 404);
    if (!canManage(req.user, project)) {
      throw new AuthError('You can only delete your own mock-ups.', 403);
    }

    await removeProject(project.id);
    staticCache.delete(project.id);
    await deleteProjectFiles(project.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------- pages */

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

app.use((err, req, res, next) => {
  if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });

  const isClientError = err instanceof ExtractError || err instanceof multer.MulterError;
  if (!isClientError) console.error(err);
  const message = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
    ? 'That file is larger than the 50 MB limit.'
    : isClientError
      ? err.message
      : 'Something went wrong on the server.';
  res.status(isClientError ? 400 : 500).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`Mockup Containers running at http://localhost:${PORT}`);
});
