import { extractPageData } from './extract.js';
import { classify } from './classify.js';
import { api, isReviewer, getSettings, submitSource, buildPayload, describeDuplicates } from './api.js';

const TYPE_LABELS = { website: 'Website', article: 'Article', lawsuit: 'Lawsuit', legislation: 'Legislation' };

api.runtime.onInstalled.addListener(async () => {
  await api.contextMenus.removeAll();
  api.contextMenus.create({ id: 'kop-review', title: 'Review and send to KOP', contexts: ['page'] });
  api.contextMenus.create({ id: 'kop-send-now', title: 'Send this page to KOP now', contexts: ['page'] });
  api.contextMenus.create({ id: 'kop-send-link', title: 'Send this link to KOP now', contexts: ['link'] });
});

// Safari has no notifications API: fall back to a short badge on the toolbar button.
function notify(title, message) {
  if (api.notifications?.create) {
    api.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title, message: message || '' });
    return;
  }
  try {
    api.action.setBadgeText({ text: /^Added/.test(title) ? 'OK' : '!' });
    setTimeout(() => api.action.setBadgeText({ text: '' }), 6000);
  } catch (_) { /* nothing else to show */ }
}

async function send(payload) {
  try {
    const res = await submitSource({ ...payload, submitted_via: 'extension-quick' });
    const reviewer = isReviewer(await getSettings());
    notify(`Added: ${TYPE_LABELS[payload.type]}`, `${payload.title}\n${reviewer ? `Waiting in ${res.queue}.` : 'Thank you. A person will review it.'}`);
  } catch (err) {
    if (err.status === 409) return notify('Already on file', describeDuplicates(err.data?.duplicates));
    notify('Not sent', err.message);
  }
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'kop-review') {
    try {
      await api.action.openPopup();
    } catch (_) {
      api.windows.create({
        url: `popup.html?tabId=${tab.id}`, type: 'popup', width: 420, height: 680,
      });
    }
    return;
  }

  if (info.menuItemId === 'kop-send-now') {
    if (!/^https?:/.test(tab?.url || '')) return notify('Not sent', 'Only web pages can be sent.');
    let data;
    try {
      [{ result: data }] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageData });
    } catch (_) {
      const u = new URL(tab.url);
      data = { url: tab.url, title: tab.title, hostname: u.hostname, pathname: u.pathname };
    }
    return send(buildPayload(data, classify(data)));
  }

  if (info.menuItemId === 'kop-send-link') {
    if (!/^https?:/.test(info.linkUrl || '')) return notify('Not sent', 'Only web links can be sent.');
    const u = new URL(info.linkUrl);
    const data = { url: info.linkUrl, title: info.selectionText || info.linkUrl, hostname: u.hostname, pathname: u.pathname };
    return send(buildPayload(data, classify(data)));
  }
});
