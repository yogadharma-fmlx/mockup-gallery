/* Dropzone + file input wiring, shared by the upload and edit pages. */
MC.mountFilePicker = function mountFilePicker({ dropzone, input, picked, onError }) {
  const ACCEPTED = /\.(html?|zip)$/i;
  const MAX_BYTES = 50 * 1024 * 1024;

  function show() {
    const file = input.files[0];
    if (!file) {
      picked.hidden = true;
      return;
    }
    picked.replaceChildren(
      MC.el('strong', { textContent: file.name }),
      MC.el('span', { className: 'muted', textContent: MC.formatSize(file.size) }),
    );
    picked.hidden = false;
  }

  function check(file) {
    if (!file) return false;
    if (!ACCEPTED.test(file.name)) {
      onError('Only .html and .zip files are accepted.');
      return false;
    }
    if (file.size > MAX_BYTES) {
      onError(`That file is ${MC.formatSize(file.size)} — the limit is 50 MB.`);
      return false;
    }
    onError('');
    return true;
  }

  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });

  ['dragenter', 'dragover'].forEach((type) =>
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-dragging');
    }));

  ['dragleave', 'drop'].forEach((type) =>
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-dragging');
    }));

  dropzone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!check(file)) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    show();
  });

  input.addEventListener('change', () => {
    if (!check(input.files[0])) {
      input.value = '';
      picked.hidden = true;
      return;
    }
    show();
  });

  return { file: () => input.files[0], check };
};
