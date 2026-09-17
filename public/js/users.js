const rows = document.getElementById('rows');
const tableWrap = document.getElementById('table-wrap');
const countEl = document.getElementById('count');
const errorEl = document.getElementById('error');

let me = null;
let users = [];

function setError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function cell(children, className) {
  return MC.el('td', className ? { className } : {}, [].concat(children));
}

function buildRow(user) {
  const isSelf = user.id === me.id;

  const roleSelect = MC.el('select', { className: 'select', disabled: isSelf }, [
    MC.el('option', { value: 'member', textContent: 'Member', selected: user.role === 'member' }),
    MC.el('option', { value: 'admin', textContent: 'Admin', selected: user.role === 'admin' }),
  ]);
  roleSelect.addEventListener('change', () => changeRole(user, roleSelect));

  const del = MC.el('button', {
    type: 'button',
    className: 'btn btn-ghost btn-danger',
    textContent: 'Delete',
    disabled: isSelf,
    title: isSelf ? 'You cannot delete your own account here.' : '',
  });
  del.addEventListener('click', () => remove(user));

  const name = MC.el('div', { className: 'user-cell' }, [
    MC.el('span', { className: 'avatar', textContent: MC.initials(user.name) }),
    MC.el('span', {}, [
      MC.el('strong', { textContent: user.name }),
      ...(isSelf ? [MC.el('span', { className: 'muted', textContent: ' (you)' })] : []),
    ]),
  ]);

  return MC.el('tr', {}, [
    cell(name),
    cell(MC.el('span', { className: 'muted', textContent: user.email })),
    cell(roleSelect),
    cell(String(user.projectCount), 'num'),
    cell(MC.el('span', { className: 'muted', textContent: MC.formatDate(user.createdAt) })),
    cell(del, 'row-actions'),
  ]);
}

function render() {
  rows.replaceChildren(...users.map(buildRow));
  tableWrap.hidden = false;
  countEl.textContent = `${users.length} account${users.length === 1 ? '' : 's'}`;
}

async function changeRole(user, select) {
  setError('');
  select.disabled = true;
  try {
    const updated = await MC.api(`/api/users/${user.id}`, {
      method: 'PATCH',
      body: { role: select.value },
    });
    user.role = updated.role;
  } catch (err) {
    select.value = user.role; // put the dropdown back where it was
    setError(err.message);
  } finally {
    select.disabled = false;
  }
}

async function remove(user) {
  if (!confirm(`Delete ${user.name}? Their mock-ups stay in the gallery as admin-managed.`)) return;
  setError('');
  try {
    await MC.api(`/api/users/${user.id}`, { method: 'DELETE' });
    users = users.filter((u) => u.id !== user.id);
    render();
  } catch (err) {
    setError(err.message);
  }
}

async function load() {
  me = await MC.requireUser();
  if (!me) return;
  MC.mountNav(me);

  if (me.role !== 'admin') {
    countEl.textContent = '';
    setError('Only admins can manage users.');
    return;
  }

  try {
    users = await MC.api('/api/users');
    render();
  } catch (err) {
    countEl.textContent = '';
    setError(err.message);
  }
}

load();
