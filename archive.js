// An article's real link and its archived copy. Same rules as the site's
// api/lib-news-archive.php and js/news-archive-links.js.
const ARCHIVE_HOSTS = [
  'archive.today', 'archive.ph', 'archive.is', 'archive.li', 'archive.vn', 'archive.md', 'archive.fo',
  'ghostarchive.org', 'perma.cc', 'webcitation.org', 'archive.org.au', 'webarchive.org.uk',
];

export function isArchiveUrl(url) {
  let u;
  try { u = new URL(url); } catch (_) { return false; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'web.archive.org' || host === 'wayback.archive.org') return true;
  if (host === 'archive.org') return /^\/web\//.test(u.pathname);
  return ARCHIVE_HOSTS.includes(host) || /(^|\.)webarchive\.(nla\.gov\.au|loc\.gov)$/.test(host);
}

// https://web.archive.org/web/20230926152235/https://www.tampabay.com/x -> https://www.tampabay.com/x ('' when none).
export function unwrapArchiveUrl(url) {
  const m = /^https?:\/\/(?:www\.)?(?:web\.|wayback\.)?archive\.org\/web\/[0-9*]{1,16}[a-z_]*\/(.+)$/i.exec(String(url || '').trim());
  if (!m) return '';
  let inner = m[1];
  const s = /^(https?):\/+(.*)$/i.exec(inner);
  if (s) inner = `${s[1].toLowerCase()}://${s[2]}`;
  else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(inner)) inner = `http://${inner}`;
  else return '';
  try { new URL(inner); } catch (_) { return ''; }
  return inner;
}

// Page data read on an archive copy: the article is the page inside it, the tab its archived copy.
export function unwrapPageData(data) {
  const here = data.url || '';
  if (!isArchiveUrl(here)) return data;
  const inner = unwrapArchiveUrl(here) || unwrapArchiveUrl(data.canonical || '');
  if (!inner) return { ...data, archiveUrl: here };
  const u = new URL(inner);
  return { ...data, url: inner, canonical: '', hostname: u.hostname, pathname: u.pathname, archiveUrl: here };
}
