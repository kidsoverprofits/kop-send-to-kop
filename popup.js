import { extractPageData } from './extract.js';
import { classify } from './classify.js';
import { getSettings, hasSettings, buildPayload, submitSource, checkDuplicate, describeDuplicates } from './api.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
let pageData = {};

const openOptions = (e) => { e?.preventDefault(); chrome.runtime.openOptionsPage(); };
$('settingsLink').addEventListener('click', openOptions);
$('openSettings').addEventListener('click', openOptions);

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
  if (id) return chrome.tabs.get(id);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init() {
  if (!hasSettings(await getSettings())) { $('setup').hidden = false; return; }

  const tab = await targetTab();
  if (!/^https?:/.test(tab?.url || '')) {
    showStatus('Only web pages can be sent. Open the page you want to add, then try again.', 'error');
    return;
  }

  try {
    [{ result: pageData }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageData });
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
    if (dup.duplicate) showStatus(describeDuplicates(dup.duplicates), 'warn', dup.review_url);
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

form.addEventListener('change', (e) => { if (e.target.name === 'type') setType(e.target.value); });

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

  try {
    const res = await submitSource(payload);
    showStatus(`Added. It is waiting in ${res.queue}.`, 'ok', res.review_url);
    button.textContent = 'Added';
  } catch (err) {
    if (err.status === 409) {
      showStatus(describeDuplicates(err.data?.duplicates), 'warn', err.data?.review_url);
      button.textContent = 'Already added';
    } else {
      showStatus(err.message, 'error');
      button.disabled = false;
      button.textContent = 'Add to database';
    }
  }
});

init();
