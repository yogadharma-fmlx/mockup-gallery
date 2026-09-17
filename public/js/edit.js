const form = document.getElementById('form');
const loadError = document.getElementById('load-error');
const errorEl = document.getElementById('error');
const successEl = document.getElementById('success');
const submitBtn = document.getElementById('submit');
const deleteBtn = document.getElementById('delete');
const progressEl = document.getElementById('progress');
const viewLink = document.getElementById('view-link');
const currentFiles = document.getElementById('current-files');
const ownerNote = document.getElementById('owner-note');

const projectId = new URLSearchParams(location.search).get('id') ?? '';

function setError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
  if (message) successEl.hidden = true;
}

const picker = MC.mountFilePicker({
  dropzone: document.getElementById('dropzone'),
  input: document.getElementById('file'),
  picked: document.getElementById('file-picked'),
  onError: setError,
});

function describeFiles(project) {
  const kind = project.kind === 'zip'
    ? `zip · ${project.fileCount} file${project.fileCount === 1 ? '' : 's'}`
    : 'single html file';
  return `Currently ${kind}, entry page ${project.entryFile} (${MC.formatSize(project.sizeBytes)}).`;
}

async function load() {
  const user = await MC.requireUser();
  if (!user) return;
  MC.mountNav(user);

  let project;
  try {
    project = await MC.api(`/api/projects/${encodeURIComponent(projectId)}`);
  } catch (err) {
    loadError.textContent = err.message;
    loadError.hidden = false;
    return;
  }

  if (!project.canManage) {
    loadError.textContent = 'This mock-up belongs to someone else, so you cannot edit it.';
    loadError.hidden = false;
    return;
  }

  form.elements.name.value = project.name;
  form.elements.description.value = project.description ?? '';
  currentFiles.textContent = describeFiles(project);
  viewLink.href = `/view/${project.id}/`;
  viewLink.hidden = false;
  form.hidden = false;

  if (user.role === 'admin' && project.ownerId !== user.id) {
    ownerNote.textContent = project.ownerId
      ? `Uploaded by ${project.uploader} — you are editing this as an admin.`
      : 'The uploader’s account was deleted, so this mock-up is admin-managed.';
    ownerNote.hidden = false;
  }

  deleteBtn.addEventListener('click', () => remove(project));
  form.addEventListener('submit', (event) => save(event, project));
}

function save(event, project) {
  event.preventDefault();
  setError('');

  const name = form.elements.name.value.trim();
  if (!name) return setError('Please give the project a name.');

  const file = picker.file();
  if (file && !picker.check(file)) return;

  const data = new FormData();
  data.append('name', name);
  data.append('description', form.elements.description.value.trim());
  if (file) data.append('file', file);

  const xhr = new XMLHttpRequest();
  xhr.open('PATCH', `/api/projects/${project.id}`);

  submitBtn.disabled = true;
  progressEl.hidden = false;
  progressEl.textContent = file ? 'Uploading…' : 'Saving…';

  xhr.upload.addEventListener('progress', (event) => {
    if (!file || !event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    progressEl.textContent = percent < 100 ? `Uploading… ${percent}%` : 'Processing…';
  });

  xhr.addEventListener('load', () => {
    submitBtn.disabled = false;
    progressEl.hidden = true;

    let body = {};
    try { body = JSON.parse(xhr.responseText); } catch { /* keep default message */ }

    if (xhr.status === 401) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    if (xhr.status !== 200) {
      setError(body.error ?? 'Could not save those changes.');
      return;
    }

    Object.assign(project, body);
    currentFiles.textContent = describeFiles(project);
    document.getElementById('file').value = '';
    document.getElementById('file-picked').hidden = true;

    successEl.replaceChildren(
      document.createTextNode('Changes saved — '),
      MC.el('a', { href: `/view/${project.id}/`, target: '_blank', rel: 'noopener', textContent: 'open the mock-up' }),
      document.createTextNode(' or '),
      MC.el('a', { href: '/', textContent: 'back to the gallery' }),
      document.createTextNode('.'),
    );
    successEl.hidden = false;
  });

  xhr.addEventListener('error', () => {
    submitBtn.disabled = false;
    progressEl.hidden = true;
    setError('Network error — nothing was saved.');
  });

  xhr.send(data);
}

async function remove(project) {
  if (!confirm(`Delete “${project.name}”? This removes its files permanently.`)) return;
  deleteBtn.disabled = true;
  try {
    await MC.api(`/api/projects/${project.id}`, { method: 'DELETE' });
    location.href = '/';
  } catch (err) {
    deleteBtn.disabled = false;
    setError(err.message);
  }
}

load();
