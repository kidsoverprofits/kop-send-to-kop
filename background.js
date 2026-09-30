import { extractPageData } from './extract.js';
import { classify } from './classify.js';
import { submitSource, buildPayload, describeDuplicates } from './api.js';

const TYPE_LABELS = { website: 'Website', article: 'Article', lawsuit: 'Lawsuit', legislation: 'Legislation' };

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'kop-review', title: 'Review and send to KOP', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'kop-send-now', title: 'Send this page to KOP now', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'kop-send-link', title: 'Send this link to KOP now', contexts: ['link'] });
  });
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

function notify(title, message) {
  chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title, message: message || '' });
}

async function send(payload) {
  try {
    const res = await submitSource({ ...payload, submitted_via: 'extension-quick' });
    notify(`Added: ${TYPE_LABELS[payload.type]}`, `${payload.title}\nWaiting in ${res.queue}.`);
  } catch (err) {
    if (err.status === 409) return notify('Already in the database', describeDuplicates(err.data?.duplicates));
    if (err.code === 'no_settings') chrome.runtime.openOptionsPage();
    notify('Not sent', err.message);
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'kop-review') {
    try {
      await chrome.action.openPopup();
    } catch (_) {
      chrome.windows.create({
        url: `popup.html?tabId=${tab.id}`, type: 'popup', width: 420, height: 680,
      });
    }
    return;
  }

  if (info.menuItemId === 'kop-send-now') {
    if (!/^https?:/.test(tab?.url || '')) return notify('Not sent', 'Only web pages can be sent.');
    let data;
    try {
      [{ result: data }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageData });
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
