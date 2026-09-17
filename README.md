# Mockup Containers

A small self-hosted gallery for HTML mock-up designs. Members upload a single `.html` file
or a `.zip` of HTML/CSS/JS; everyone — signed in or not — can browse and open the results.

## Running it

```bash
npm install
npm start
```

Then open http://localhost:3000. Use `PORT=8080 npm start` to change the port, and
`npm run dev` to restart automatically on file changes. Behind HTTPS, start with
`SECURE_COOKIES=1` so the session cookie is only sent over TLS.

**The first account to register becomes the admin.** Create yours before sharing the URL.

## Who can do what

| | Browse & open | Upload | Edit / delete a mock-up | Manage users |
| --- | --- | --- | --- | --- |
| Anyone (signed out) | ✅ | — | — | — |
| Member | ✅ | ✅ | own mock-ups only | — |
| Admin | ✅ | ✅ | any mock-up | ✅ |

Editing covers the name, the description, and replacing the files with a new `.html`/`.zip`
— the replacement is unpacked alongside the old copy and swapped in, so a failed upload
leaves the published mock-up untouched.

## Pages

| Route | What it does |
| --- | --- |
| `/` | Gallery — public. Cards show name, uploader, date and a live thumbnail, with search |
| `/upload` | Upload form (`.html` or `.zip`, max 50 MB) — sign-in required |
| `/edit?id=…` | Rename, re-describe, replace files, or delete — owner or admin |
| `/login`, `/register` | Sign in / create an account |
| `/account` | Change your display name or password |
| `/users` | Admin only: roles, mock-up counts, account deletion |
| `/view/:id/` | Serves a mock-up from its own folder, starting at its entry HTML file |

## API

| Endpoint | Access |
| --- | --- |
| `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` | public |
| `GET /api/auth/me` | public (returns `{ user: null }` when signed out) |
| `PATCH /api/account` | signed in — `name`, or `currentPassword` + `newPassword` |
| `GET /api/projects`, `GET /api/projects/:id` | public; each row carries `canManage` for the caller |
| `POST /api/projects` | signed in — multipart `name`, `description`, `file` |
| `PATCH /api/projects/:id`, `DELETE /api/projects/:id` | owner or admin |
| `GET /api/users`, `PATCH /api/users/:id`, `DELETE /api/users/:id` | admin |

## Storage

No database. Uploaded files live in `uploads/<project id>/`, and JSON records in `data/`:
`projects.json`, `users.json` and `sessions.json`. Both directories are git-ignored and are
created on first start. Writes to each file are serialised, so concurrent uploads cannot
clobber one another.

Deleting an account keeps its mock-ups in the gallery — they lose their owner and become
admin-managed. Mock-ups uploaded before accounts existed have no owner either, so an admin
manages those too.

### Zip handling

* Extracted with a zip-slip guard: absolute paths, drive letters and `..` segments are refused.
* A single common top-level folder is stripped, so `my-design/index.html` is served at `/`.
* Only web file types are kept (html, css, js, json, images, fonts, media, text). Anything
  else in the archive — `.sh`, `.exe`, dotfiles, `__MACOSX` — is skipped.
* Limits: 2000 entries, 200 MB extracted, 50 MB upload.
* The entry page is the root `index.html` if present, otherwise the shallowest
  `index`/`home`/`main`/`start` HTML file, otherwise the shallowest HTML file.

## Security notes

* Passwords are hashed with scrypt and a per-user salt; session tokens are stored only as
  SHA-256 hashes, so the session file cannot be replayed if it leaks.
* The session cookie is `HttpOnly` and `SameSite=Lax`; changing a password drops every
  session for that account.
* **Mock-ups share the app's origin.** An uploaded mock-up's JavaScript runs on the same
  origin as the gallery, so it could call the API as whoever is viewing it. That is fine for
  a trusted internal team; if you open uploads to a wider group, serve `/view/` from a
  separate hostname or port.
* Anyone who can reach the site can register. If it is exposed beyond your team, put it
  behind a VPN or reverse-proxy auth, or have an admin create accounts and remove the
  `/register` page.

## Layout

```
server.js           routes, upload handling, static serving of mock-ups
src/auth.js         password hashing, sessions, cookies, permission checks
src/extract.js      zip extraction, path safety, entry-file detection
src/store.js        JSON-file stores (projects, users, sessions) with serialised writes
src/paths.js        directory constants
public/             gallery, upload, edit, auth, account and admin pages
public/js/session.js  shared API helper, signed-in state and top-bar menu
```
