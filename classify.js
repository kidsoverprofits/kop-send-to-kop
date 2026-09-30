// Guesses the source type and pulls case/bill details from page data.
const LAWSUIT_HOSTS = [
  /courtlistener\.com$/, /pacermonitor\.com$/, /uscourts\.gov$/, /dockets\.justia\.com$/,
  /law\.justia\.com$/, /unicourt\.com$/, /casetext\.com$/, /trellis\.law$/, /casemine\.com$/,
];
const LEG_HOSTS = [
  /congress\.gov$/, /legiscan\.com$/, /govtrack\.us$/, /openstates\.org$/,
  /legislature/, /(^|\.)legis\./, /(^|\.)leg\.state\./, /[a-z]{2}leg\.gov$/, /capitol\./,
];

const CASE_RE = /\b(\d{1,2}:\d{2}-[a-z]{2,4}-\d{3,6}(?:-[A-Z]{2,4})*)\b/i;
const CASE_LABEL_RE = /\b(?:Case|Docket|Civil Action)\s*(?:No\.?|Number|#)\s*:?\s*([A-Z0-9][\w:.\-\/]{3,30})/i;
const COURT_RE = /\b((?:United States|U\.S\.)\s+(?:District Court|Court of Appeals|Bankruptcy Court)[^\n.;]{0,60}|(?:Superior|Circuit|District|Supreme|Chancery)\s+Court\s+(?:of|for)\s+[^\n.;]{3,50})/;
const BILL_RE = /\b(H\.?\s?R\.?|H\.?\s?B\.?|S\.?\s?B\.?|A\.?\s?B\.?|L\.?\s?D\.?|H\.?\s?F\.?|S\.?\s?F\.?|S\.)\s?(\d{1,5})\b/;

const matches = (host, list) => list.some((r) => r.test(host));
const cleanBill = (m) => `${m[1].replace(/[.\s]/g, '').toUpperCase()} ${m[2]}`;

const CONGRESS_PREFIX = {
  'house-bill': 'HR', 'senate-bill': 'S',
  'house-joint-resolution': 'HJRES', 'senate-joint-resolution': 'SJRES',
  'house-resolution': 'HRES', 'senate-resolution': 'SRES',
  'house-concurrent-resolution': 'HCONRES', 'senate-concurrent-resolution': 'SCONRES',
};

function fromUrl(host, path) {
  let m;
  if (host.endsWith('legiscan.com') && (m = path.match(/^\/([A-Z]{2})\/bill\/([A-Z]+)(\d+)\/(\d{4})/i)))
    return { jurisdiction: m[1].toUpperCase(), bill_number: `${m[2].toUpperCase()} ${m[3]}`, session: m[4] };
  if (host.endsWith('congress.gov') && (m = path.match(/\/bill\/(\d+(?:st|nd|rd|th))-congress\/([a-z-]+)\/(\d+)/)))
    return { jurisdiction: 'US', bill_number: `${CONGRESS_PREFIX[m[2]] || m[2]} ${m[3]}`, session: `${m[1]} Congress` };
  if (host.endsWith('govtrack.us') && (m = path.match(/\/congress\/bills\/(\d+)\/([a-z]+)(\d+)/)))
    return { jurisdiction: 'US', bill_number: `${m[2].toUpperCase()} ${m[3]}`, session: `Congress ${m[1]}` };
  if (host.endsWith('openstates.org') && (m = path.match(/^\/([a-z]{2})\/bills\/([^/]+)\/([A-Z]+)(\d+)/i)))
    return { jurisdiction: m[1].toUpperCase(), bill_number: `${m[3].toUpperCase()} ${m[4]}`, session: m[2] };
  if ((m = host.match(/\.leg\.state\.([a-z]{2})\.us$/) || host.match(/^legis\.([a-z]{2})\.gov$/) || host.match(/^([a-z]{2})leg\.gov$/)))
    return { jurisdiction: m[1].toUpperCase() };
  return {};
}

export function classify(data) {
  const host = (data.hostname || '').replace(/^www\./, '');
  const title = data.title || '';
  const text = `${title}\n${data.bodySample || ''}`;
  const urlInfo = fromUrl(host, data.pathname || '');
  const fields = {};
  if (urlInfo.jurisdiction) fields.jurisdiction = urlInfo.jurisdiction;

  if (matches(host, LAWSUIT_HOSTS) || CASE_RE.test(title)) {
    const m = CASE_RE.exec(text) || CASE_LABEL_RE.exec(text);
    fields.case_number = m?.[1] || '';
    fields.court = (COURT_RE.exec(text)?.[1] || '').trim();
    return { type: 'lawsuit', fields };
  }

  if (matches(host, LEG_HOSTS) || data.legislationId || urlInfo.bill_number) {
    const m = BILL_RE.exec(title) || BILL_RE.exec(text);
    fields.bill_number = urlInfo.bill_number || data.legislationId || (m ? cleanBill(m) : '');
    if (urlInfo.session) fields.session = urlInfo.session;
    return { type: 'legislation', fields };
  }

  const articleish =
    /article/i.test(data.ogType || '') ||
    (data.ldTypes || []).some((t) => /Article|BlogPosting|Report/.test(t)) ||
    !!data.published;
  return { type: articleish ? 'article' : 'website', fields };
}
