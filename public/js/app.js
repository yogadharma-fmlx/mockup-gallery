const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const emptyAction = document.getElementById('empty-action');
const countEl = document.getElementById('count');
const errorEl = document.getElementById('error');
const template = document.getElementById('card-template');

let projects = [];
let user = null;
let searchInput = null;

function buildCard(project) {
  const node = template.content.firstElementChild.cloneNode(true);
  const url = `/view/${project.id}/`;

  const preview = node.querySelector('.card-preview');
  preview.href = url;
  preview.querySelector('iframe').src = url;

  node.querySelector('.card-title').textContent = project.name;

  const desc = node.querySelector('.card-desc');
  if (project.description) desc.textContent = project.description;
  else desc.remove();

  node.querySelector('.avatar').textContent = MC.initials(project.uploader);
  node.querySelector('.card-uploader').textContent = project.uploader;
  node.querySelector('.card-date').textContent = project.updatedAt
    ? `Updated ${MC.formatDate(project.updatedAt)}`
    : MC.formatDate(project.uploadedAt);

  const tag = node.querySelector('.tag');
  tag.textContent = project.kind === 'zip' ? `zip · ${project.fileCount} files` : 'html';
  tag.title = `${project.originalName} · ${MC.formatSize(project.sizeBytes)}`;

  node.querySelector('.card-open').href = url;

  // Editing and deleting belong to the owner (and to admins).
  const edit = node.querySelector('.card-edit');
  const del = node.querySelector('.card-delete');
  if (project.canManage) {
    edit.href = `/edit?id=${encodeURIComponent(project.id)}`;
    del.addEventListener('click', () => remove(project, node));
  } else {
    edit.remove();
    del.remove();
  }

  return node;
}

function render() {
  const query = searchInput?.value.trim().toLowerCase() ?? '';
  const visible = query
    ? projects.filter((p) =>
        `${p.name} ${p.uploader} ${p.description ?? ''}`.toLowerCase().includes(query))
    : projects;

  grid.replaceChildren(...visible.map(buildCard));
  grid.hidden = visible.length === 0;

  if (projects.length === 0) {
    empty.hidden = false;
    countEl.textContent = 'No mock-ups yet';
    emptyAction.href = user ? '/upload' : '/login?next=%2Fupload';
    emptyAction.textContent = user ? 'Upload the first mock-up' : 'Sign in to upload';
    return;
  }

  empty.hidden = true;
  if (visible.length === 0) {
    countEl.textContent = `No match for “${searchInput.value.trim()}”`;
    return;
  }

  countEl.textContent = query
    ? `${visible.length} of ${projects.length} mock-ups`
    : `${projects.length} mock-up${projects.length === 1 ? '' : 's'}`;
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

async function remove(project, node) {
  if (!confirm(`Delete “${project.name}”? This removes its files permanently.`)) return;
  const button = node.querySelector('.card-delete');
  button.disabled = true;
  try {
    await MC.api(`/api/projects/${project.id}`, { method: 'DELETE' });
    projects = projects.filter((p) => p.id !== project.id);
    errorEl.hidden = true;
    render();
  } catch (err) {
    button.disabled = false;
    showError(err.message);
  }
}

async function load() {
  user = await MC.me();
  MC.mountNav(user);
  searchInput = document.getElementById('search');
  searchInput?.addEventListener('input', render);

  try {
    projects = await MC.api('/api/projects');
    errorEl.hidden = true;
    render();
  } catch (err) {
    countEl.textContent = '';
    showError(err.message);
  }
}

load();
