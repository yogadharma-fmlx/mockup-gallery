const profileForm = document.getElementById('profile-form');
const passwordForm = document.getElementById('password-form');
const profileError = document.getElementById('profile-error');
const profileSuccess = document.getElementById('profile-success');
const passwordError = document.getElementById('password-error');
const whoami = document.getElementById('whoami');

function flag(el, message) {
  el.textContent = message;
  el.hidden = !message;
}

MC.requireUser().then((user) => {
  if (!user) return;
  MC.mountNav(user);
  profileForm.elements.name.value = user.name;
  whoami.textContent = user.role === 'admin'
    ? `${user.email} · admin`
    : user.email;
});

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  flag(profileError, '');
  flag(profileSuccess, '');

  const button = document.getElementById('profile-submit');
  button.disabled = true;
  try {
    const { user } = await MC.api('/api/account', {
      method: 'PATCH',
      body: { name: profileForm.elements.name.value.trim() },
    });
    await MC.me({ refresh: true });
    MC.mountNav(user);
    flag(profileSuccess, 'Profile saved.');
  } catch (err) {
    flag(profileError, err.message);
  } finally {
    button.disabled = false;
  }
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  flag(passwordError, '');

  const currentPassword = passwordForm.elements.currentPassword.value;
  const newPassword = passwordForm.elements.newPassword.value;
  if (newPassword.length < 8) return flag(passwordError, 'Passwords must be at least 8 characters.');

  const button = document.getElementById('password-submit');
  button.disabled = true;
  try {
    await MC.api('/api/account', { method: 'PATCH', body: { currentPassword, newPassword } });
    // The server dropped every session, so this browser has to sign in again.
    location.href = '/login?next=%2Faccount';
  } catch (err) {
    button.disabled = false;
    flag(passwordError, err.message);
  }
});
