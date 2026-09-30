import { checkDuplicate } from './api.js';

const form = document.getElementById('form');
const status = document.getElementById('status');

function show(message, kind) {
  status.className = `status ${kind}`;
  status.textContent = message;
  status.hidden = false;
}

chrome.storage.local.get(['siteUrl', 'username', 'appPassword']).then((s) => {
  for (const k of ['siteUrl', 'username', 'appPassword']) if (s[k]) form.elements[k].value = s[k];
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  values.username = values.username.trim();
  let origin;
  try {
    origin = new URL(values.siteUrl.trim()).origin;
    if (!origin.startsWith('https://')) throw new Error();
  } catch (_) {
    return show('Use the full https:// address of the site. Application passwords only work over HTTPS.', 'error');
  }

  // Must run before any other await: Chrome only shows the prompt during the click.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) return show('The extension needs permission to reach your site. Save again and choose Allow.', 'error');

  await chrome.storage.local.set({ ...values, siteUrl: origin });
  show('Testing the connection...', 'warn');
  try {
    const res = await checkDuplicate({ url: 'https://example.com/kop-connection-test' });
    show(`Connected${res.user ? ` as ${res.user}` : ''}. Send pages from the toolbar button (Alt+Shift+K) or the right-click menu.`, 'ok');
  } catch (err) {
    show(err.message, 'error');
  }
});
