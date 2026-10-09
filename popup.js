import { extractPageData } from './extract.js';
import { classify } from './classify.js';
import { unwrapPageData } from './archive.js';
import {
  api, getSettings, isReviewer, buildPayload, submitSource, checkDuplicate, describeDuplicates,
  getNewsForm, processArticle, findArchive,
} from './api.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
let pageData = {};

const openOptions = (e) => { e?.preventDefault(); api.runtime.openOptionsPage(); };
$('settingsLink').addEventListener('click', openOptions);
let reviewer = false;
// The reviewer panel's choices (inc/extension-news-processor.php): article types, warnings, per-type details.
let newsForm = null;
const details = {};
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

// The full News Processor shows for reviewers sending an article.
const processorOn = () => reviewer && form.elements.type.value === 'article' && !!newsForm;

function refreshVisibility() {
  const type = form.elements.type.value;
  document.querySelectorAll('[data-for], [data-mode], [data-not-for]').forEach((el) => {
    let show = true;
    if (el.dataset.for) show = show && el.dataset.for.split(' ').includes(type);
    if (el.dataset.mode) show = show && (el.dataset.mode === 'reviewer') === reviewer;
    if (el.dataset.mode === 'reviewer' && el.dataset.for === 'article') show = show && !!newsForm;
    if (el.dataset.notFor === 'article-reviewer') show = show && !processorOn();
    el.hidden = !show;
  });
  const canPublish = processorOn() && newsForm.can_publish;
  $('publish').hidden = !canPublish;
  if (!$('submit').disabled) {
    $('submit').textContent = processorOn() ? 'Add to the review queue' : 'Send to Kids Over Profits';
  }
  $('submit').classList.toggle('quiet', canPublish);
}

function setType(type) {
  form.elements.type.value = type;
  refreshVisibility();
}

async function targetTab() {
  const id = Number(new URLSearchParams(location.search).get('tabId'));
  if (id) return api.tabs.get(id);
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/* ---------- Reviewer panel ---------- */

function buildProcessor() {
  const select = $('articleType');
  for (const t of newsForm.types) select.add(new Option(t.label, t.value));
  const box = $('warnings');
  for (const w of newsForm.warnings) {
    const label = document.createElement('label');
    label.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.value = w; input.dataset.warning = '1';
    label.append(input, ` ${w}`);
    box.append(label);
  }
  select.addEventListener('change', drawDetails);
  drawDetails();
}

// The per-type details (lawsuit parties, arrest charges, closure date...), as the processor's section 4.
function drawDetails() {
  const box = $('typeDetails');
  box.querySelectorAll('input').forEach((i) => { details[i.dataset.key] = i.value; });
  box.replaceChildren();
  const fields = newsForm.details[$('articleType').value] || {};
  for (const [key, label] of Object.entries(fields)) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const input = document.createElement('input');
    input.dataset.key = key;
    input.value = details[key] || '';
    wrap.append(label, input);
    box.append(wrap);
  }
  box.hidden = Object.keys(fields).length === 0;
}

const lines = (v) => String(v || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const setIfEmpty = (name, value) => {
  const el = form.elements[name];
  if (el && value && !el.value.trim()) el.value = value;
};
const mergeLines = (name, values) => {
  const el = form.elements[name];
  const have = lines(el.value);
  const seen = new Set(have.map((s) => s.toLowerCase()));
  for (const v of values || []) if (!seen.has(v.toLowerCase())) { have.push(v); seen.add(v.toLowerCase()); }
  el.value = have.join('\n');
};

async function aiFill() {
  const button = $('aiFill');
  const status = $('aiStatus');
  button.disabled = true;
  status.textContent = 'Reading the article. This takes up to a minute...';
  try {
    const { fields: f } = await processArticle({
      url: form.elements.url.value,
      text: pageData.articleText || pageData.bodySample || '',
      instructions: form.elements.ai_instructions.value,
    });
    setIfEmpty('title', f.title);
    setIfEmpty('author', f.author);
    if (/^\d{4}-\d{2}-\d{2}$/.test(f.published || '')) setIfEmpty('published', f.published);
    setIfEmpty('site_name', f.site_name);
    setIfEmpty('location', f.location);
    setIfEmpty('alternate_title', f.alternate_title);
    setIfEmpty('summary', f.summary);
    const facility = form.elements.facility.value.trim();
    mergeLines('facilities', [...(facility ? [facility] : []), ...(f.facilities || [])]);
    mergeLines('staff', f.staff);
    mergeLines('survivors', f.survivors);
    const tags = form.elements.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
    for (const t of f.tags || []) if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
    form.elements.tags.value = tags.join(', ');
    document.querySelectorAll('[data-warning]').forEach((box) => {
      if ((f.content_warnings || []).includes(box.value)) box.checked = true;
    });
    if (f.article_type) $('articleType').value = f.article_type;
    Object.assign(details, Object.fromEntries(Object.entries(f.details || {}).filter(([k]) => !details[k])));
    drawDetails();
    status.textContent = 'Filled in. Check each field before saving.';
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

/* ---------- Archived copy ---------- */

async function lookUpArchive(quiet) {
  const status = $('archiveStatus');
  const url = form.elements.url.value;
  if (!url || form.elements.archive_url.value.trim()) return;
  if (!quiet) status.textContent = 'Looking for a Wayback Machine copy...';
  try {
    const res = await findArchive(url);
    if (res.archive_url) {
      form.elements.archive_url.value = res.archive_url;
      const t = res.timestamp || '';
      status.textContent = t ? `Wayback Machine copy from ${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}.` : 'Wayback Machine copy found.';
    } else if (!quiet) {
      status.textContent = 'No Wayback Machine copy yet. "Archive now" makes one.';
    }
  } catch (err) {
    if (!quiet) status.textContent = err.message;
  }
}

$('findArchive').addEventListener('click', () => lookUpArchive(false));
$('archiveNow').addEventListener('click', () => {
  const url = form.elements.url.value;
  if (!url) return;
  api.tabs.create({ url: `https://web.archive.org/save/${url}`, active: true });
  $('archiveStatus').textContent = 'The Wayback Machine is saving it in a new tab. When it finishes, copy that address here'
    + (reviewer ? ' or press Find.' : '.');
});
$('aiFill').addEventListener('click', aiFill);

/* ---------- Start ---------- */

async function init() {
  reviewer = isReviewer(await getSettings());
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
  pageData = unwrapPageData(pageData);

  if (reviewer) {
    try {
      newsForm = await getNewsForm();
      buildProcessor();
    } catch (_) {
      newsForm = null; // an older site without the panel: plain reviewer sends still work
    }
  }

  const classification = classify(pageData);
  const payload = buildPayload(pageData, classification);
  for (const [key, value] of Object.entries(payload)) {
    if (form.elements[key] && key !== 'type') form.elements[key].value = value;
  }
  if (pageData.selection) form.elements.notes.value = `"${pageData.selection}"`;
  if (newsForm && payload.description) form.elements.summary.placeholder = payload.description;
  setType(classification.type);
  form.hidden = false;
  form.elements.title.focus();

  try {
    const dup = await checkDuplicate(payload);
    if (dup.duplicate) showStatus(describeDuplicates(dup.duplicates), 'warn', reviewer ? dup.review_url : undefined);
  } catch (err) {
    showStatus(err.message, 'error');
  }
  if (reviewer && newsForm && classification.type === 'article') lookUpArchive(true);
}

form.addEventListener('change', (e) => { if (e.target.name === 'type') setType(e.target.value); });
form.elements.notify_email.addEventListener('input', syncNewsletter);

function collect(publish) {
  const payload = Object.fromEntries(new FormData(form));
  payload.tags = (payload.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  payload.description = pageData.description || '';
  // The note already quotes the highlight when it was left in; send it once.
  payload.selection = (payload.notes || '').includes(pageData.selection || '\u0000') ? '' : pageData.selection || '';
  payload.submitted_via = 'extension';
  delete payload.ai_instructions;
  const panelFields = ['alternate_title', 'article_type', 'location', 'facilities', 'staff', 'survivors', 'summary'];
  if (processorOn()) {
    payload.full = 1;
    payload.publish = publish ? 1 : 0;
    payload.facilities = lines(payload.facilities);
    payload.staff = lines(payload.staff);
    payload.survivors = lines(payload.survivors);
    payload.content_warnings = [...document.querySelectorAll('[data-warning]:checked')].map((b) => b.value);
    $('typeDetails').querySelectorAll('input').forEach((i) => { details[i.dataset.key] = i.value; });
    const shown = Object.keys(newsForm.details[payload.article_type] || {});
    payload.details = Object.fromEntries(shown.filter((k) => (details[k] || '').trim()).map((k) => [k, details[k].trim()]));
    delete payload.facility;
  } else {
    for (const k of panelFields) delete payload[k];
  }
  if (payload.type !== 'article') delete payload.archive_url;
  return payload;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const publish = e.submitter?.value === 'publish';
  const buttons = [$('submit'), $('publish')];
  const button = publish ? $('publish') : $('submit');
  const idleText = button.textContent;
  buttons.forEach((b) => { b.disabled = true; });
  button.textContent = publish ? 'Publishing...' : 'Adding...';

  const payload = collect(publish);
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
    if (res.published) showStatus('Published. It is on the site now; Undo is under Recently done.', 'ok', res.review_url, 'Open the review page');
    else if (reviewer) showStatus(`Added. It is waiting in ${res.queue}.`, 'ok', res.review_url);
    else showStatus('Thank you. A person will review this before anything appears on the site.', 'ok');
    button.textContent = res.published ? 'Published' : 'Added';
  } catch (err) {
    if (err.status === 409) {
      showStatus(describeDuplicates(err.data?.duplicates), 'warn', reviewer ? err.data?.review_url : undefined);
      button.textContent = 'Already on file';
    } else {
      showStatus(err.message, 'error');
      buttons.forEach((b) => { b.disabled = false; });
      button.textContent = idleText;
    }
  }
});

init();
