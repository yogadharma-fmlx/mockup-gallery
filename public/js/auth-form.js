/* Drives both /login and /register — the form's data-mode says which. */
const form = document.getElementById('form');
const errorEl = document.getElementById('error');
const submitBtn = document.getElementById('submit');
const isRegister = form.dataset.mode === 'register';

/** Only same-site paths are honoured, so `?next=` cannot bounce to another host. */
function nextUrl() {
  const next = new URLSearchParams(location.search).get('next') ?? '/';
  return /^\/(?!\/)/.test(next) ? next : '/';
}

function setError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

// Already signed in? Nothing to do here.
MC.me().then((user) => {
  if (user) location.replace(nextUrl());
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError('');

  const body = {
    email: form.elements.email.value.trim(),
    password: form.elements.password.value,
  };
  if (isRegister) body.name = form.elements.name.value.trim();

  if (isRegister && body.name.length < 2) return setError('Please enter your name.');
  if (!body.email) return setError('Please enter your email address.');
  if (!body.password) return setError('Please enter your password.');
  if (isRegister && body.password.length < 8) {
    return setError('Passwords must be at least 8 characters.');
  }

  submitBtn.disabled = true;
  try {
    await MC.api(isRegister ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body });
    location.href = nextUrl();
  } catch (err) {
    submitBtn.disabled = false;
    setError(err.message);
  }
});
