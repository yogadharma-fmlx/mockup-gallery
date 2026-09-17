/* Shared helpers: API calls, the signed-in state, and the top-bar menu. */
window.MC = (function () {
  let cachedUser;

  async function api(path, { method = 'GET', body, form } = {}) {
    const options = { method, headers: {} };
    if (form) {
      options.body = form;
    } else if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    const res = await fetch(path, options);
    const text = await res.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }
    if (!res.ok) {
      const error = new Error(payload.error ?? 'Something went wrong. Please try again.');
      error.status = res.status;
      throw error;
    }
    return payload;
  }

  async function me({ refresh = false } = {}) {
    if (cachedUser === undefined || refresh) {
      try {
        cachedUser = (await api('/api/auth/me')).user;
      } catch {
        cachedUser = null;
      }
    }
    return cachedUser;
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('') || '?';
  }

  function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  }

  function link(href, text, className = 'menu-item') {
    return el('a', { href, textContent: text, className });
  }

  /** Fill `#nav` with the search box (where asked for), upload button and user menu. */
  function mountNav(user) {
    const nav = document.getElementById('nav');
    if (!nav) return;
    const parts = [];

    if (nav.dataset.search) {
      const label = el('label', { className: 'search' });
      label.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
      label.append(el('input', {
        id: 'search',
        type: 'search',
        placeholder: 'Search projects or uploaders',
        autocomplete: 'off',
      }));
      parts.push(label);
    }

    if (!user) {
      parts.push(link('/login', 'Sign in', 'btn btn-ghost'));
      parts.push(link('/register', 'Create account', 'btn btn-primary'));
    } else {
      parts.push(link('/upload', 'Upload mock-up', 'btn btn-primary'));

      const panel = el('div', { className: 'menu-panel' }, [
        el('div', { className: 'menu-head' }, [
          el('strong', { textContent: user.name }),
          el('span', { className: 'muted', textContent: user.email }),
        ]),
        link('/account', 'Account settings'),
        ...(user.role === 'admin' ? [link('/users', 'Manage users')] : []),
        el('button', {
          type: 'button',
          className: 'menu-item',
          textContent: 'Sign out',
          onclick: async () => {
            await api('/api/auth/logout', { method: 'POST' });
            location.href = '/';
          },
        }),
      ]);

      const summary = el('summary', { className: 'menu-trigger' }, [
        el('span', { className: 'avatar', textContent: initials(user.name) }),
        el('span', { className: 'menu-name', textContent: user.name.split(' ')[0] }),
      ]);
      const menu = el('details', { className: 'menu' }, [summary, panel]);
      document.addEventListener('click', (event) => {
        if (!menu.contains(event.target)) menu.open = false;
      });
      parts.push(menu);
    }

    nav.replaceChildren(...parts);
  }

  /** For pages that only make sense when signed in. */
  async function requireUser() {
    const user = await me();
    if (!user) {
      location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return null;
    }
    return user;
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return { api, me, mountNav, requireUser, initials, formatDate, formatSize, el };
})();
