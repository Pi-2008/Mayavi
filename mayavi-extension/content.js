(() => {
  'use strict';

  // Guard: the popup may inject this file more than once.
  if (window.__characterSummonerInstalled) return;
  window.__characterSummonerInstalled = true;

  // =====================================================
  //  EASY-TO-EDIT CSS SETTINGS  (any valid CSS length)
  //  After editing: reload the extension AND reload the webpage.
  // =====================================================
  const CHARACTER_WIDTH  = '100vw';
  const CHARACTER_HEIGHT = '100vh';
  const CHARACTER_RIGHT  = '0px';
  const CHARACTER_BOTTOM = '0px';
  // =====================================================

  const LOG = '[Character]';
  let host = null;
  let video = null;
  let safetyTimer = null;

  function removeOverlay() {
    if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
    if (video) {
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) { /* ignore */ }
      video.remove();
      video = null;
    }
    if (host) {
      host.remove();
      host = null;
      console.log(`${LOG} Overlay removed`);
    }
  }

  function summon(videoUrl) {
    if (host) {
      // A summon is already playing - ignore this one instead of cutting it off and restarting.
      console.log(`${LOG} Already playing, ignoring new summon`);
      return;
    }

    // A custom element tag is very unlikely to be styled by the page.
    host = document.createElement('character-summoner-overlay');
    const important = {
      all: 'initial',
      display: 'block',
      position: 'fixed',
      right: CHARACTER_RIGHT,
      bottom: CHARACTER_BOTTOM,
      width: CHARACTER_WIDTH,
      height: CHARACTER_HEIGHT,
      'z-index': '2147483647',
      'pointer-events': 'none',
      background: 'transparent',
      margin: '0',
      padding: '0',
      border: '0',
      overflow: 'hidden'
    };
    for (const [prop, val] of Object.entries(important)) {
      host.style.setProperty(prop, val, 'important');
    }

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      video {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;            /* keeps the aspect ratio */
        object-position: center bottom;
        background: transparent;        /* never add a background */
        pointer-events: none;
      }
      .unmute-badge {
        position: absolute;
        top: 16px;
        right: 16px;
        pointer-events: auto;
        cursor: pointer;
        background: rgba(20, 18, 31, 0.85);
        color: #fff;
        border: 1px solid rgba(255,255,255,0.25);
        border-radius: 20px;
        padding: 8px 14px;
        font: 13px system-ui, sans-serif;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .unmute-badge:hover { background: rgba(20, 18, 31, 1); }
      .close-badge {
        position: absolute;
        top: 16px;
        left: 16px;
        pointer-events: auto;
        cursor: pointer;
        background: rgba(20, 18, 31, 0.85);
        color: #fff;
        border: 1px solid rgba(255,255,255,0.25);
        border-radius: 50%;
        width: 32px;
        height: 32px;
        font: 16px/1 system-ui, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .close-badge:hover { background: rgba(20, 18, 31, 1); }
    `;

    video = document.createElement('video');
    video.autoplay = true;
    video.muted = false;   // try with sound first
    video.volume = 1;
    video.playsInline = true;
    video.loop = false;
    video.controls = false;
    video.preload = 'auto';
    video.disablePictureInPicture = true;

    video.addEventListener('playing', () => console.log(`${LOG} Video started`), { once: true });
    video.addEventListener('loadedmetadata', () => {
      // Safety net in case "ended" never fires.
      if (isFinite(video.duration)) {
        safetyTimer = setTimeout(removeOverlay, video.duration * 1000 + 4000);
      }
    });
    video.addEventListener('ended', () => {
      console.log(`${LOG} Video finished`);
      removeOverlay();
    });
    video.addEventListener('error', () => {
      const code = video && video.error ? video.error.code : '?';
      console.error(`${LOG} Video failed to load/play (error code ${code}). Is character.webm present and valid?`);
      removeOverlay();
    });

    video.src = videoUrl;
    shadow.appendChild(style);
    shadow.appendChild(video);
    // documentElement (not body) so page transforms on <body> can't affect position: fixed.
    document.documentElement.appendChild(host);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-badge';
    closeBtn.type = 'button';
    closeBtn.title = 'Stop animation';
    closeBtn.setAttribute('aria-label', 'Stop animation');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => {
      console.log(`${LOG} Closed by user`);
      removeOverlay();
    });
    shadow.appendChild(closeBtn);

    function showUnmuteBadge() {
      const badge = document.createElement('button');
      badge.className = 'unmute-badge';
      badge.type = 'button';
      badge.textContent = '🔇 Tap for sound';
      badge.addEventListener('click', () => {
        video.muted = false;
        video.volume = 1;
        const p = video.play();
        if (p && p.catch) p.catch((e) => console.error(`${LOG} Unmute play failed`, e));
        badge.remove();
        console.log(`${LOG} Sound enabled by user click`);
      });
      shadow.appendChild(badge);
    }

    // Try with sound. Chrome may block sound autoplay on a page you have not
    // clicked into yet (a browser rule, not something this extension controls).
    // If that happens, play muted instead of failing, and show a button that
    // turns sound on with one click - so the animation always appears.
    video.play().catch((err) => {
      if (err && err.name === 'NotAllowedError' && video) {
        console.warn(`${LOG} Chrome blocked audio autoplay on this page, playing muted with an on-screen sound button.`);
        video.muted = true;
        const p = video.play();
        if (p && p.catch) {
          p.catch((err2) => {
            console.error(`${LOG} Video playback failed`, err2);
            removeOverlay();
          });
        }
        showUnmuteBadge();
      } else {
        console.error(`${LOG} Video playback failed`, err);
        removeOverlay();
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'CHARACTER_SUMMON') {
      const alreadyPlaying = !!host;
      summon(msg.videoUrl);
      sendResponse({ ok: true, ignored: alreadyPlaying });
    }
  });
})();
