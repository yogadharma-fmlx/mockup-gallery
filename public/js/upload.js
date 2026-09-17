const form = document.getElementById('form');
const errorEl = document.getElementById('error');
const successEl = document.getElementById('success');
const submitBtn = document.getElementById('submit');
const progressEl = document.getElementById('progress');
const signedInAs = document.getElementById('signed-in-as');

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

MC.requireUser().then((user) => {
  if (!user) return;
  MC.mountNav(user);
  signedInAs.textContent = `Uploading as ${user.name}.`;
  signedInAs.hidden = false;
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  setError('');

  const name = form.elements.name.value.trim();
  const file = picker.file();

  if (!name) return setError('Please give the project a name.');
  if (!file) return setError('Please choose a file to upload.');
  if (!picker.check(file)) return;

  const data = new FormData();
  data.append('name', name);
  data.append('description', form.elements.description.value.trim());
  data.append('file', file);

  // XHR rather than fetch: upload progress is worth having for 50 MB zips.
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/projects');

  submitBtn.disabled = true;
  progressEl.hidden = false;
  progressEl.textContent = 'Uploading…';

  xhr.upload.addEventListener('progress', (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    progressEl.textContent = percent < 100 ? `Uploading… ${percent}%` : 'Processing…';
  });

  xhr.addEventListener('load', () => {
    submitBtn.disabled = false;
    progressEl.hidden = true;

    let body = {};
    try { body = JSON.parse(xhr.responseText); } catch { /* keep default message */ }

    if (xhr.status === 401) {
      location.href = '/login?next=%2Fupload';
      return;
    }
    if (xhr.status !== 201) {
      setError(body.error ?? 'Upload failed. Please try again.');
      return;
    }

    form.reset();
    document.getElementById('file-picked').hidden = true;
    successEl.replaceChildren(
      document.createTextNode(`“${body.name}” is live — `),
      MC.el('a', { href: `/view/${body.id}/`, target: '_blank', rel: 'noopener', textContent: 'open it' }),
      document.createTextNode(' or '),
      MC.el('a', { href: '/', textContent: 'go to the gallery' }),
      document.createTextNode('.'),
    );
    successEl.hidden = false;
  });

  xhr.addEventListener('error', () => {
    submitBtn.disabled = false;
    progressEl.hidden = true;
    setError('Network error — the upload did not finish.');
  });

  xhr.send(data);
});
