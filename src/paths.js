import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DATA_DIR = path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(ROOT, 'uploads');
export const TMP_DIR = path.join(ROOT, 'data', 'tmp');
export const DB_FILE = path.join(DATA_DIR, 'projects.json');
export const USERS_FILE = path.join(DATA_DIR, 'users.json');
export const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
