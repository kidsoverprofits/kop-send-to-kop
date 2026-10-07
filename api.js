// Talks to the Kids Over Profits theme: public routes (inc/mobile-submit.php, no account) by default,
// reviewer routes (inc/source-submissions.php) when an application password is saved.
// Firefox offers both `browser` and `chrome`; Chrome and Safari offer `chrome`.
export const api = globalThis.browser ?? globalThis.chrome;

export const PUBLIC_SITE = 'https://kidsoverprofits.org';

export async function getSettings() {
  return api.storage.local.get(['siteUrl', 'username', 'appPassword']);
}

// Reviewer mode needs a saved username and application password; everyone else sends publicly.
export function isReviewer(s) {
  return !!(s.siteUrl && s.username && s.appPassword);
}

function toDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

export function buildPayload(data, classification) {
  return {
    url: data.canonical || data.url,
    title: data.title || data.url,
    type: classification.type,
    published: toDate(data.published),
    author: data.author || '',
    site_name: data.siteName || '',
    description: data.description || '',
    selection: data.selection || '',
    ...classification.fields,
  };
}

async function publicRequest(path, options = {}) {
  let res;
  try {
    res = await fetch(`${PUBLIC_SITE}/wp-json/kop/v1/mobile${path}`, {
      ...options,
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  } catch (_) {
    throw new Error('Could not reach kidsoverprofits.org. Check your connection.');
  }
  let body = {};
  try { body = await res.json(); } catch (_) { /* non-JSON error page */ }
  if (!res.ok) {
    let msg = body.message || `The site returned an error (${res.status}).`;
    if (res.status === 403 && !body.code) msg = "The site's firewall blocked the request (403).";
    const err = new Error(msg);
    err.status = res.status;
    err.data = body;
    throw err;
  }
  return body;
}

async function request(path, options = {}) {
  const s = await getSettings();
  if (!isReviewer(s)) return publicRequest(path, options);
  const base = s.siteUrl.replace(/\/+$/, '');
  const auth = 'Basic ' + btoa(unescape(encodeURIComponent(`${s.username}:${s.appPassword.replace(/\s+/g, '')}`)));
  let res;
  try {
    res = await fetch(`${base}/wp-json/kop/v1/extension${path}`, {
      ...options,
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
        // Some hosts drop Authorization before PHP sees it; the site reads this copy instead.
        'X-KOP-Authorization': auth,
        ...(options.headers || {}),
      },
    });
  } catch (_) {
    throw new Error(`Could not reach ${base}. Check the site address and your connection.`);
  }
  let body = {};
  try { body = await res.json(); } catch (_) { /* non-JSON error page */ }
  if (!res.ok) {
    let msg = body.message || `The site returned an error (${res.status}).`;
    if (res.status === 401) {
      msg = 'WordPress rejected the login. Check the username and app password in settings.';
    } else if (res.status === 403 && body.code === 'rest_forbidden') {
      msg = 'Signed in, but this account is not allowed to add records.';
    } else if (res.status === 403 && !body.code) {
      msg = "The site's firewall blocked the request (403).";
    } else if (res.status === 404 && body.code === 'rest_no_route') {
      msg = 'Signed in, but the site does not have the extension endpoint yet.';
    }
    const err = new Error(msg);
    err.status = res.status;
    err.data = body;
    throw err;
  }
  return body;
}

const PUBLIC_KEYS = [
  'type', 'url', 'title', 'site_name', 'author', 'published', 'case_number', 'court', 'bill_number',
  'jurisdiction', 'session', 'facility', 'notes', 'selection', 'submitter_name', 'notify_email', 'newsletter_email',
];

export async function submitSource(payload) {
  const s = await getSettings();
  if (isReviewer(s)) return request('/submit', { method: 'POST', body: JSON.stringify(payload) });
  const body = {};
  for (const k of PUBLIC_KEYS) if (payload[k]) body[k] = payload[k];
  return publicRequest('/submit', {
    method: 'POST',
    body: JSON.stringify({ ...body, website_hp: '', via: 'extension' }),
  });
}

export function checkDuplicate(payload) {
  const q = new URLSearchParams();
  for (const k of ['url', 'title', 'site_name', 'type', 'bill_number', 'jurisdiction']) {
    if (payload[k]) q.set(k, payload[k]);
  }
  return request(`/check?${q}`);
}

// One line naming what is already on file. Public answers carry only a status; reviewers also get an id and title.
export function describeDuplicates(duplicates = []) {
  const names = { news: 'article', lawsuit: 'lawsuit', legislation: 'bill', website: 'website' };
  const first = duplicates[0];
  if (!first) return 'Already on file.';
  if (first.id === undefined) return `Already on file (${first.status || 'in review'}).`;
  const what = names[first.type] || first.type;
  const status = first.status ? `, ${first.status}` : '';
  return `Already in the database as ${what} #${first.id}${status}: ${first.title || 'untitled'}.`;
}
