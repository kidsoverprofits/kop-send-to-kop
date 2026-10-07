import { extractPageData } from './extract.js';
import { classify } from './classify.js';
import { api, getSettings, isReviewer, buildPayload, submitSource, checkDuplicate, describeDuplicates } from './api.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
let pageData = {};

const openOptions = (e) => { e?.preventDefault(); api.runtime.openOptionsPage(); };
$('settingsLink').addEventListener('click', openOptions);
let reviewer = false;
const emailBox = () => form.elements.notify_email;
function syncNewsletter() {
  const box = $('newsletter');
  const has = emailBox().value.trim() !== '';
  box.disabled = !has;
  if (!has) box.checked = false;
}

function showStatus(message, kind, link, linkText = 'Open review queue') {
  const s = $('status');
  s.className = `status ${kind}`;
  s.textContent = message;
  if (link) {
    const a = document.createElement('a');
    a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = linkText;
    s.append(' ', a);
  }
  s.hidden = false;
}

function setType(type) {
  form.elements.type.value = type;
  document.querySelectorAll('[data-for]').forEach((el) => {
    el.hidden = !el.dataset.for.split(' ').includes(type);
  });
}

async function targetTab() {
  const id = Number(new URLSearchParams(location.search).get('tabId'));
  if (id) return api.tabs.get(id);
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init() {
  reviewer = isReviewer(await getSettings());
  document.querySelectorAll('[data-mode]').forEach((el) => { el.hidden = (el.dataset.mode === 'reviewer') !== reviewer; });
  if (!reviewer) {
    const saved = await api.storage.local.get(['rememberMe', 'submitterName', 'submitterEmail']);
    if (saved.rememberMe) {
      $('remember').checked = true;
      form.elements.submitter_name.value = saved.submitterName || '';
      emailBox().value = saved.submitterEmail || '';
    }
    syncNewsletter();
  }

  const tab = await targetTab();
  if (!/^https?:/.test(tab?.url || '')) {
    showStatus('Only web pages can be sent. Open the page you want to add, then try again.', 'error');
    return;
  }

  try {
    [{ result: pageData }] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageData });
  } catch (_) {
    const u = new URL(tab.url);
    pageData = { url: tab.url, title: tab.title, hostname: u.hostname, pathname: u.pathname };
  }

  const classification = classify(pageData);
  const payload = buildPayload(pageData, classification);
  for (const [key, value] of Object.entries(payload)) {
    if (form.elements[key] && key !== 'type') form.elements[key].value = value;
  }
  if (pageData.selection) form.elements.notes.value = `"${pageData.selection}"`;
  setType(classification.type);
  form.hidden = false;
  form.elements.title.focus();

  try {
    const dup = await checkDuplicate(payload);
    if (dup.duplicate) showStatus(describeDuplicates(dup.duplicates), 'warn', reviewer ? dup.review_url : undefined);
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

form.addEventListener('change', (e) => { if (e.target.name === 'type') setType(e.target.value); });
form.elements.notify_email.addEventListener('input', syncNewsletter);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('submit');
  button.disabled = true;
  button.textContent = 'Adding...';

  const payload = Object.fromEntries(new FormData(form));
  payload.tags = (payload.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  payload.description = pageData.description || '';
  // The note already quotes the highlight when it was left in; send it once.
  payload.selection = (payload.notes || '').includes(pageData.selection || '\u0000') ? '' : pageData.selection || '';
  payload.submitted_via = 'extension';
  if (!reviewer) {
    payload.newsletter_email = $('newsletter').checked ? (payload.notify_email || '').trim() : '';
    delete payload.tags;
    delete payload.newsletter;
    const remember = $('remember').checked;
    try {
      if (remember) {
        await api.storage.local.set({ rememberMe: true, submitterName: payload.submitter_name || '', submitterEmail: payload.notify_email || '' });
      } else {
        await api.storage.local.remove(['rememberMe', 'submitterName', 'submitterEmail']);
      }
    } catch (_) { /* storage is a convenience only */ }
  }

  try {
    const res = await submitSource(payload);
    if (reviewer) showStatus(`Added. It is waiting in ${res.queue}.`, 'ok', res.review_url);
    else showStatus('Thank you. A person will review this before anything appears on the site.', 'ok');
    button.textContent = 'Added';
  } catch (err) {
    if (err.status === 409) {
      showStatus(describeDuplicates(err.data?.duplicates), 'warn', reviewer ? err.data?.review_url : undefined);
      button.textContent = 'Already on file';
    } else {
      showStatus(err.message, 'error');
      button.disabled = false;
      button.textContent = 'Send to Kids Over Profits';
    }
  }
});

init();
