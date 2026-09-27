(() => {
  'use strict';

  // ====== SETTINGS ======
  const TRIGGER_PHRASE = 'Om Kream Kutti Chatha';
  const REQUIRED_TRIGGERS = 1;
  // 0..1. Higher = stricter. 0.78 allows about 3 wrong letters out of ~14.
  const MATCH_THRESHOLD = 0.78;
  // The 3 repetitions must happen within this time, otherwise the counter resets.
  const EXPIRY_MS = 30000;
  const VIDEO_FILE = 'character.webm';
  const LANGUAGE = 'ml-IN'; // Malayalam
  const LOG = '[Character]';

  // ====== ELEMENTS ======
  const micBtn = document.getElementById('micBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusEl = document.getElementById('status');
  const counterEl = document.getElementById('counter');
  const messageEl = document.getElementById('message');

  // ====== STATE ======
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let wantListening = false;
  let count = 0;
  let lastTriggerAt = 0;
  let summoning = false;
  let netRetry = false;
  let restartStamps = [];

  // ====== UI HELPERS ======
  function setStatus(text) { statusEl.textContent = text; }
  function setCounter(n) { counterEl.textContent = `${n} / ${REQUIRED_TRIGGERS}`; }
  function showMessage(text, kind) {
    messageEl.textContent = text;
    messageEl.className = 'message' + (kind === 'info' ? ' info' : '');
    messageEl.hidden = false;
  }
  function clearMessage() { messageEl.hidden = true; messageEl.textContent = ''; }
  function setListeningUI(on) {
    micBtn.disabled = on;
    micBtn.classList.toggle('listening', on);
    stopBtn.disabled = !on;
  }

  // ====== PHRASE NORMALIZATION / FUZZY MATCHING ======
  // Minimal Malayalam-script -> Latin transliteration, so ml-IN output can be matched too.
  const ML_INDEP = {
    '\u0D05': 'a', '\u0D06': 'a', '\u0D07': 'i', '\u0D08': 'i', '\u0D09': 'u', '\u0D0A': 'u',
    '\u0D0E': 'e', '\u0D0F': 'e', '\u0D10': 'ai', '\u0D12': 'o', '\u0D13': 'o', '\u0D14': 'au'
  };
  const ML_MATRA = {
    '\u0D3E': 'a', '\u0D3F': 'i', '\u0D40': 'i', '\u0D41': 'u', '\u0D42': 'u',
    '\u0D46': 'e', '\u0D47': 'e', '\u0D48': 'ai', '\u0D4A': 'o', '\u0D4B': 'o', '\u0D4C': 'au',
    '\u0D4D': '' // virama: suppresses the inherent "a"
  };
  const ML_MISC = { '\u0D02': 'm', '\u0D03': 'h' };
  const ML_CONS = {
    '\u0D15': 'k', '\u0D16': 'k', '\u0D17': 'g', '\u0D18': 'g', '\u0D19': 'n',
    '\u0D1A': 'ch', '\u0D1B': 'ch', '\u0D1C': 'j', '\u0D1D': 'j', '\u0D1E': 'n',
    '\u0D1F': 't', '\u0D20': 't', '\u0D21': 'd', '\u0D22': 'd', '\u0D23': 'n',
    '\u0D24': 't', '\u0D25': 't', '\u0D26': 'd', '\u0D27': 'd', '\u0D28': 'n',
    '\u0D2A': 'p', '\u0D2B': 'p', '\u0D2C': 'b', '\u0D2D': 'b', '\u0D2E': 'm',
    '\u0D2F': 'y', '\u0D30': 'r', '\u0D31': 'r', '\u0D32': 'l', '\u0D33': 'l', '\u0D34': 'l',
    '\u0D35': 'v', '\u0D36': 's', '\u0D37': 's', '\u0D38': 's', '\u0D39': 'h'
  };

  function transliterateMalayalam(str) {
    const chars = Array.from(str);
    let out = '';
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (ML_INDEP[c] !== undefined) out += ML_INDEP[c];
      else if (ML_MATRA[c] !== undefined) out += ML_MATRA[c];
      else if (ML_MISC[c] !== undefined) out += ML_MISC[c];
      else if (ML_CONS[c] !== undefined) {
        out += ML_CONS[c];
        const next = chars[i + 1];
        if (!(next && ML_MATRA[next] !== undefined)) out += 'a'; // inherent vowel
      } else out += c;
    }
    return out;
  }

  // Turns "Om Cream Kuttichatha" and "om kreem kutti chatha" into the same rough sound-alike string.
  function normalizePhonetic(raw) {
    let s = transliterateMalayalam(String(raw).normalize('NFC').toLowerCase());
    s = s.replace(/[^a-z\s]/g, ' ');
    s = s.replace(/\b(ohm|aum|oum|omm|ome)\b/g, 'om');
    s = s.replace(/\s+/g, '');
    s = s.replace(/ch/g, 'x')       // "ch" sound
         .replace(/th/g, 't')
         .replace(/ck/g, 'k')
         .replace(/c/g, 'k')        // cream -> kream
         .replace(/ee|ea|ie|ii/g, 'i')
         .replace(/oo/g, 'u')
         .replace(/(.)\1+/g, '$1'); // collapse doubled letters (tt -> t)
    s = s.replace(/[ae]/g, 'a').replace(/[ou]/g, 'u'); // merge similar vowels
    return s;
  }

  const TARGET = normalizePhonetic(TRIGGER_PHRASE);

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1);
    let cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }

  function bestWindow(text) {
    let best = null;
    const minLen = Math.max(6, TARGET.length - 3);
    const maxLen = TARGET.length + 3;
    for (let len = minLen; len <= maxLen; len++) {
      for (let start = 0; start + len <= text.length; start++) {
        const win = text.slice(start, start + len);
        const score = 1 - levenshtein(win, TARGET) / Math.max(len, TARGET.length);
        if (!best || score > best.score) best = { score, start, end: start + len };
      }
    }
    return best;
  }

  // Counts how many separate times the whole phrase appears in one transcript.
  function countPhraseMatches(transcript) {
    let text = normalizePhonetic(transcript);
    let found = 0;
    while (text.length >= TARGET.length - 3) {
      const m = bestWindow(text);
      if (!m || m.score < MATCH_THRESHOLD) break;
      found++;
      text = text.slice(0, m.start) + '|' + text.slice(m.end);
    }
    return found;
  }

  // ====== VIDEO CHECK ======
  async function videoExists() {
    try {
      const res = await fetch(chrome.runtime.getURL(VIDEO_FILE), { method: 'HEAD' });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  // ====== FINDING THE WEBPAGE TO SUMMON ONTO ======
  function isRestrictedUrl(url) {
    if (!url) return true;
    return /^(chrome|chrome-search|chrome-error|edge|about|chrome-extension|chrome-untrusted|devtools|view-source|moz-extension):/i.test(url) ||
      url.startsWith('https://chromewebstore.google.com') ||
      url.startsWith('https://chrome.google.com/webstore');
  }

  // The active tab of the browser window you used most recently (not this small window).
  async function getTargetTab() {
    try {
      const win = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
      return (win.tabs || []).find(t => t.active) || null;
    } catch (e) {
      return null;
    }
  }

  // ====== SUMMON ======
  async function summonCharacter() {
    console.log(`${LOG} Summoning character`);
    if (!(await videoExists())) {
      showMessage(`${VIDEO_FILE} was not found in the extension folder. Put it next to manifest.json, then reload the extension.`);
      return false;
    }
    const tab = await getTargetTab();
    if (!tab || isRestrictedUrl(tab.url)) {
      showMessage(`Chrome does not let extensions run on that page (${tab && tab.url ? tab.url : 'unknown page'}). Open a normal website and say the phrase again.`);
      return false;
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, {
        type: 'CHARACTER_SUMMON',
        videoUrl: chrome.runtime.getURL(VIDEO_FILE)
      });
      return true;
    } catch (err) {
      console.error(`${LOG} Summon failed`, err);
      showMessage('Could not show the character on that page: ' + (err && err.message ? err.message : err));
      return false;
    }
  }

  // ====== TRIGGER COUNTING ======
  function resetCount() {
    count = 0;
    setCounter(0);
  }

  function handleTriggers(n) {
    const now = Date.now();
    if (summoning) {
      console.log(`${LOG} Ignored (already summoning)`);
      return;
    }
    if (count > 0 && now - lastTriggerAt > EXPIRY_MS) resetCount();
    for (let i = 0; i < n; i++) {
      count++;
      lastTriggerAt = now;
      console.log(`${LOG} Trigger detected: ${count}/${REQUIRED_TRIGGERS}`);
      setCounter(count);
      if (count >= REQUIRED_TRIGGERS) {
        onThirdTrigger();
        return;
      }
    }
  }

  async function onThirdTrigger() {
    summoning = true;
    setStatus('Summoning...');
    const ok = await summonCharacter();
    resetCount();
    summoning = false;
    if (ok) {
      clearMessage();
      setStatus('Character summoned!');
      setTimeout(() => { if (wantListening) setStatus('Listening...'); }, 3000);
    } else {
      setStatus(wantListening ? 'Listening...' : 'Ready');
    }
  }

  // Counter expires if you stop part-way (e.g. said it twice, then nothing for 30s).
  setInterval(() => {
    if (count > 0 && !summoning && Date.now() - lastTriggerAt > EXPIRY_MS) {
      console.log(`${LOG} Trigger counter expired, resetting`);
      resetCount();
    }
  }, 1000);

  // ====== LISTENING ======
  function createRecognition() {
    const r = new SpeechRecognitionCtor();
    r.lang = LANGUAGE;
    r.continuous = true;
    r.interimResults = false;
    r.maxAlternatives = 5;

    r.onstart = () => {
      console.log(`${LOG} Microphone started`);
      if (netRetry) { netRetry = false; clearMessage(); }
      if (!summoning) setStatus('Listening...');
    };

    r.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        let best = 0;
        console.log(`${LOG} Heard: ${result[0].transcript}`);
        for (let a = 0; a < result.length; a++) {
          if (a > 0) console.log(`${LOG}   alt ${a}: ${result[a].transcript}`);
          best = Math.max(best, countPhraseMatches(result[a].transcript));
        }
        if (best > 0) handleTriggers(best);
        if (!wantListening) return;
      }
    };

    r.onerror = (e) => {
      console.warn(`${LOG} Recognition error: ${e.error}`);
      switch (e.error) {
        case 'no-speech':
        case 'aborted':
          break; // harmless; onend will restart
        case 'network':
          netRetry = true;
          showMessage("Chrome's speech service could not be reached. Retrying...");
          break; // onend will retry
        case 'not-allowed':
        case 'service-not-allowed':
          showMessage('Microphone or speech service is blocked. Open chrome://settings/content/microphone, make sure this extension is not in the Block list, then click 🎤 again.');
          stopListening();
          break;
        case 'audio-capture':
          showMessage('No working microphone was found.');
          stopListening();
          break;
        case 'language-not-supported':
          showMessage('Malayalam speech recognition is not supported by this version of Chrome.');
          stopListening();
          break;
        default:
          showMessage('Speech recognition error: ' + e.error);
          stopListening();
      }
    };

    r.onend = () => {
      if (!wantListening) return;
      // Chrome ends sessions on its own. Restart, but not in a tight loop.
      const now = Date.now();
      if (!netRetry) {
        restartStamps = restartStamps.filter(t => now - t < 10000);
        restartStamps.push(now);
        if (restartStamps.length > 10) {
          showMessage('Speech recognition keeps stopping. Check your microphone, then click 🎤 to start again.');
          stopListening();
          return;
        }
      }
      console.log(`${LOG} Recognition ended, restarting`);
      setTimeout(() => {
        if (!wantListening) return;
        try { r.start(); } catch (err) { console.warn(`${LOG} Restart failed`, err); }
      }, netRetry ? 3000 : 250);
    };

    return r;
  }

  async function startListening() {
    clearMessage();

    if (!SpeechRecognitionCtor) {
      showMessage('Speech recognition is not available in this browser. Use Google Chrome.');
      return;
    }

    // Ask for mic access only now (this window is opened by the user's click).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch (err) {
      console.warn(`${LOG} Microphone permission problem`, err);
      if (err && err.name === 'NotFoundError') {
        showMessage('No microphone was found.');
      } else {
        showMessage('Microphone permission was denied. Click 🎤 and choose Allow. If no prompt appears, open chrome://settings/content/microphone and remove this extension from the Block list.');
      }
      return;
    }

    resetCount();
    restartStamps = [];
    netRetry = false;
    wantListening = true;
    setListeningUI(true);
    setStatus('Listening...');
    recognition = createRecognition();
    try {
      recognition.start();
    } catch (err) {
      showMessage('Could not start speech recognition: ' + err.message);
      stopListening();
    }
  }

  function stopListening() {
    wantListening = false;
    if (recognition) {
      try { recognition.abort(); } catch (e) { /* ignore */ }
      recognition = null;
    }
    setListeningUI(false);
    resetCount();
    setStatus('Ready');
    console.log(`${LOG} Microphone stopped`);
  }

  // ====== WIRING ======
  micBtn.addEventListener('click', startListening);
  stopBtn.addEventListener('click', stopListening);
  window.addEventListener('pagehide', () => stopListening());

  // ====== INIT ======
  setStatus('Ready');
  setCounter(0);
  // The user already clicked the microphone in the popup to open this window, so start right away.
  startListening();
})();
