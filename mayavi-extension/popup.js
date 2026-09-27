(() => {
  'use strict';

  const VIDEO_FILE = 'character.webm';
  const LOG = '[Character]';

  const micBtn = document.getElementById('micBtn');
  const statusEl = document.getElementById('status');
  const messageEl = document.getElementById('message');
  const testBtn = document.getElementById('testBtn');

  function showMessage(text, kind) {
    messageEl.textContent = text;
    messageEl.className = 'message' + (kind === 'info' ? ' info' : '');
    messageEl.hidden = false;
  }
  function clearMessage() { messageEl.hidden = true; messageEl.textContent = ''; }

  function isRestrictedUrl(url) {
    if (!url) return true;
    return /^(chrome|chrome-search|chrome-error|edge|about|chrome-extension|chrome-untrusted|devtools|view-source|moz-extension):/i.test(url) ||
      url.startsWith('https://chromewebstore.google.com') ||
      url.startsWith('https://chrome.google.com/webstore');
  }

  function restrictedMessage(tab) {
    const where = tab && tab.url ? tab.url : 'unknown page';
    return `Chrome does not let extensions run on this page (${where}). If this is Chrome's New Tab page, search for something on google.com or open any website first, then try again.`;
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0] ? tabs[0] : null;
  }

  async function videoExists() {
    try {
      const res = await fetch(chrome.runtime.getURL(VIDEO_FILE), { method: 'HEAD' });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  // Start hands-free mode: open the listening window (or focus it if it is already open).
  micBtn.addEventListener('click', async () => {
    clearMessage();
    const listenerUrl = chrome.runtime.getURL('listener.html');
    try {
      if (chrome.runtime.getContexts) {
        const ctxs = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
        const existing = ctxs.find(c => c.documentUrl && c.documentUrl.startsWith(listenerUrl));
        if (existing) {
          await chrome.windows.update(existing.windowId, { focused: true });
          window.close();
          return;
        }
      }
    } catch (e) {
      console.warn(`${LOG} Could not check for an existing listener window`, e);
    }
    chrome.windows.create({ url: listenerUrl, type: 'popup', width: 340, height: 520 });
    window.close();
  });

  testBtn.addEventListener('click', async () => {
    clearMessage();
    const tab = await getActiveTab();
    if (!tab || isRestrictedUrl(tab.url)) {
      showMessage(restrictedMessage(tab));
      return;
    }
    if (!(await videoExists())) {
      showMessage(`${VIDEO_FILE} was not found in the extension folder. Put it next to manifest.json, then reload the extension.`);
      return;
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, {
        type: 'CHARACTER_SUMMON',
        videoUrl: chrome.runtime.getURL(VIDEO_FILE)
      });
      statusEl.textContent = 'Character summoned!';
    } catch (err) {
      showMessage('Could not show the character: ' + (err && err.message ? err.message : err));
    }
  });

  (async function init() {
    const tab = await getActiveTab();
    if (!tab || isRestrictedUrl(tab.url)) {
      testBtn.disabled = true;
    }
  })();
})();
