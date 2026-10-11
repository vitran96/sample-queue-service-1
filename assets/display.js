import { getConfig, getSnapshot, subscribe } from './store.js';
import { esc, startClock } from './common.js';
import { getAudioContext, playChime } from './chime.js';

const $ = (id) => document.getElementById(id);

let lastEventId = 0;
let pageLoadTime = Date.now();
let audioContext = null;

function flashServingNumber() {
  const el = $('display-serving-no');
  if (!el) return;
  el.classList.remove('flash-serving');
  void el.offsetWidth; // trigger reflow
  el.classList.add('flash-serving');
}

function handleEventAudio(event) {
  if (!event || !event.id) return;
  const isCallEvent = (event.type === 'called' || event.type === 'recalled');
  const isNew = event.id > lastEventId;
  const isRecent = (Date.now() - (event.at ? new Date(event.at).getTime() : event.id)) < 10000;

  if (isCallEvent && isNew && isRecent) {
    if (audioContext) {
      playChime(audioContext);
    }
    flashServingNumber();
  }
  if (event.id > lastEventId) {
    lastEventId = event.id;
  }
}

function render(snapshot) {
  const isOffline = snapshot.status === 'offline';
  $('display-offline-bar').classList.toggle('hidden', !isOffline);
  $('display-main').style.opacity = isOffline ? '0.5' : '1';

  // Now serving
  const cur = snapshot.current;
  if (cur) {
    $('display-serving-no').textContent = cur.no;
    $('display-prompt').textContent = `Please proceed to ${cur.servicePoint || 'Counter 1'}`;
  } else {
    $('display-serving-no').textContent = '—';
    $('display-prompt').textContent = 'Please wait for your number';
  }

  // Up next (next 4 tickets in waitingOrder)
  const upNextList = snapshot.waiting.slice(0, 4);
  const upNextContainer = $('display-up-next');
  if (upNextList.length > 0) {
    upNextContainer.innerHTML = upNextList
      .map((t) => `<div class="badge badge-brand" style="font-size:clamp(1.2rem, 3.5cqi, 2.5rem);padding:8px 18px">${esc(t.no)}</div>`)
      .join('');
  } else {
    upNextContainer.innerHTML = `<span class="text-muted" style="font-size:1.2rem">None</span>`;
  }

  // Called not present (no-shows)
  const noShows = snapshot.noShows;
  const noShowsContainer = $('display-noshows');
  if (noShows.length > 0) {
    noShowsContainer.innerHTML = noShows
      .map((t) => `<div class="badge badge-err" style="font-size:clamp(1.1rem, 3cqi, 2rem);padding:6px 14px">${esc(t.no)}</div>`)
      .join('');
  } else {
    noShowsContainer.innerHTML = `<span class="text-muted" style="font-size:1.2rem">None</span>`;
  }

  // Waiting count
  $('display-waiting-count').textContent = snapshot.counts.waiting;
}

export function initDisplay() {
  const config = getConfig();
  $('clinic-name').textContent = config.clinicName || 'Clinic Queue';
  $('service-point').textContent = config.servicePoint || 'Counter 1';

  startClock('#clock');

  // Record initial lastEventId from storage so reload doesn't trigger old chime
  try {
    const rawEvt = localStorage.getItem('cq:event');
    if (rawEvt) {
      const parsed = JSON.parse(rawEvt);
      if (parsed && parsed.id) lastEventId = parsed.id;
    }
  } catch (e) {}

  render(getSnapshot());

  subscribe((snapshot, event) => {
    render(snapshot);
    if (event) {
      handleEventAudio(event);
    }
  });

  // Start Overlay (User gesture required for AudioContext & Fullscreen)
  $('start-overlay').addEventListener('click', () => {
    audioContext = getAudioContext();
    $('start-overlay').classList.add('hidden');

    // Request fullscreen
    const docEl = document.documentElement;
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch(() => {});
    }
  });

  // Manual fullscreen button
  $('btn-fullscreen').addEventListener('click', () => {
    const docEl = document.documentElement;
    if (!document.fullscreenElement && docEl.requestFullscreen) {
      docEl.requestFullscreen().then(() => {
        $('btn-fullscreen').classList.add('hidden');
      }).catch(() => {});
    }
  });

  document.addEventListener('fullscreenchange', () => {
    $('btn-fullscreen').classList.toggle('hidden', !!document.fullscreenElement);
  });
}
