import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';

/** Extensions a mock-up is allowed to ship. Anything else in the zip is skipped. */
const ALLOWED_EXT = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.json', '.map',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp4', '.webm', '.mp3', '.wav',
  '.txt', '.md', '.csv', '.xml', '.webmanifest',
]);

const MAX_ENTRIES = 2000;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // guards against zip bombs

export class ExtractError extends Error {}

/** Reject absolute paths, drive letters and any `..` segment (zip-slip). */
function safeEntryPath(entryName) {
  const normalised = entryName.replace(/\\/g, '/');
  if (normalised.startsWith('/') || /^[a-zA-Z]:/.test(normalised)) return null;
  const parts = normalised.split('/').filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  return parts.length ? parts.join('/') : null;
}

/** If every file sits under one common top-level folder, drop that folder. */
function stripCommonRoot(files) {
  const roots = new Set(files.map((f) => f.rel.split('/')[0]));
  if (roots.size !== 1) return files;
  if (files.every((f) => f.rel.split('/').length < 2)) return files;
  return files.map((f) => ({ ...f, rel: f.rel.split('/').slice(1).join('/') }));
}

/** How likely a file name is to be the landing page, lower is better. */
const ENTRY_NAMES = ['index', 'home', 'main', 'start'];

function entryRank(relPath) {
  const base = relPath.split('/').pop().replace(/\.html?$/i, '').toLowerCase();
  const rank = ENTRY_NAMES.indexOf(base);
  return rank === -1 ? ENTRY_NAMES.length : rank;
}

/** Prefer a root index.html, then the shallowest best-named html file. */
function pickEntryFile(relPaths) {
  const htmls = relPaths.filter((p) => /\.html?$/i.test(p));
  if (!htmls.length) return null;
  const rootIndex = htmls.find((p) => /^index\.html?$/i.test(p));
  if (rootIndex) return rootIndex;
  return [...htmls].sort((a, b) =>
    (a.split('/').length - b.split('/').length)
    || (entryRank(a) - entryRank(b))
    || a.localeCompare(b))[0];
}

/**
 * Unpack `zipPath` into `destDir`.
 * Returns { entryFile, fileCount, skipped }.
 */
export async function extractZip(zipPath, destDir) {
  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch {
    throw new ExtractError('That file could not be read as a zip archive.');
  }

  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (!entries.length) throw new ExtractError('The zip archive is empty.');
  if (entries.length > MAX_ENTRIES) {
    throw new ExtractError(`The zip contains too many files (limit ${MAX_ENTRIES}).`);
  }

  const wanted = [];
  const skipped = [];
  let totalBytes = 0;

  for (const entry of entries) {
    const rel = safeEntryPath(entry.entryName);
    if (!rel) {
      skipped.push(entry.entryName);
      continue;
    }
    const base = path.posix.basename(rel);
    if (base.startsWith('.') || rel.split('/').some((p) => p === '__MACOSX')) {
      skipped.push(rel);
      continue;
    }
    if (!ALLOWED_EXT.has(path.posix.extname(rel).toLowerCase())) {
      skipped.push(rel);
      continue;
    }
    totalBytes += entry.header.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new ExtractError('The zip expands to more than 200 MB.');
    }
    wanted.push({ rel, entry });
  }

  if (!wanted.length) {
    throw new ExtractError('The zip contains no usable web files.');
  }

  const files = stripCommonRoot(wanted);
  const entryFile = pickEntryFile(files.map((f) => f.rel));
  if (!entryFile) {
    throw new ExtractError('The zip contains no .html file to open.');
  }

  for (const { rel, entry } of files) {
    const target = path.join(destDir, rel);
    const resolved = path.resolve(target);
    if (resolved !== path.resolve(destDir) && !resolved.startsWith(path.resolve(destDir) + path.sep)) {
      throw new ExtractError('The zip tried to write outside its folder.');
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.getData());
  }

  return { entryFile, fileCount: files.length, skipped };
}

/** Store a bare .html upload as index.html inside its own folder. */
export async function storeSingleHtml(srcPath, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  await fs.copyFile(srcPath, path.join(destDir, 'index.html'));
  return { entryFile: 'index.html', fileCount: 1, skipped: [] };
}
