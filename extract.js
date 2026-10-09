// Runs INSIDE the page via chrome.scripting.executeScript. Must be self-contained.
export function extractPageData() {
  const meta = (name) => {
    const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
    return el?.getAttribute('content')?.trim() || '';
  };

  const ld = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      const d = JSON.parse(s.textContent);
      const items = Array.isArray(d) ? d : d['@graph'] || [d];
      ld.push(...items);
    } catch (_) { /* malformed JSON-LD is common; skip it */ }
  });
  const typesOf = (i) => [].concat(i?.['@type'] || []);
  const ldTypes = ld.flatMap(typesOf);
  const ldArticle = ld.find((i) => typesOf(i).some((t) => /Article|BlogPosting|Report/.test(t)));
  const ldLeg = ld.find((i) => typesOf(i).includes('Legislation'));

  let author = meta('citation_author') || meta('author') || meta('article:author');
  if (!author && ldArticle?.author) {
    const a = [].concat(ldArticle.author)[0];
    author = typeof a === 'string' ? a : a?.name || '';
  }
  // article:author is often a profile URL, which is no use as a byline.
  if (/^https?:\/\//.test(author)) author = '';

  const publisher = [].concat(ldArticle?.publisher || [])[0];

  return {
    url: location.href,
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    hostname: location.hostname,
    pathname: location.pathname,
    title: meta('citation_title') || meta('og:title') || ldArticle?.headline || document.title || '',
    siteName: meta('og:site_name') || (typeof publisher === 'string' ? publisher : publisher?.name) || '',
    description: meta('og:description') || meta('description') || '',
    published:
      meta('citation_date') || meta('citation_publication_date') ||
      meta('article:published_time') || ldArticle?.datePublished || '',
    author,
    ogType: meta('og:type'),
    ldTypes,
    legislationId: ldLeg?.legislationIdentifier || '',
    selection: (window.getSelection()?.toString() || '').trim().slice(0, 2000),
    bodySample: (document.body?.innerText || '').slice(0, 6000),
    // The article's own text for the reviewer panel's AI read (never sent with a plain send).
    articleText: (() => {
      const pick = [...document.querySelectorAll('article, [itemprop="articleBody"], main, [role="main"]')]
        .map((el) => el.innerText || '')
        .sort((x, y) => y.length - x.length)[0] || '';
      return (pick.length >= 600 ? pick : document.body?.innerText || '').slice(0, 30000);
    })(),
  };
}
