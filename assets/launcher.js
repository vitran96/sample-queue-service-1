import { getConfig, getSnapshot, subscribe } from './store.js';
import { esc, startClock } from './common.js';

const $ = (id) => document.getElementById(id);

const WINDOWS = {
  kiosk: { url: 'kiosk/', name: 'cq-kiosk', width: 620, height: 960 },
  staff: { url: 'staff/', name: 'cq-staff', width: 1200, height: 800 },
  display: { url: 'display/', name: 'cq-display', width: 1280, height: 760 },
  patient: { url: 't/', name: 'cq-patient', width: 400, height: 860 }
};

let latestTicketToken = null;

function openScreen(key) {
  const win = WINDOWS[key];
  if (!win) return null;
  const sized = $('chk-sized').checked;
  const features = sized
    ? `width=${win.width},height=${win.height},menubar=no,toolbar=no,location=no,status=no`
    : undefined;
  return window.open(win.url, win.name, features);
}

function updateLiveStatus(snapshot, event) {
  $('live-date').textContent = snapshot.serviceDate || '—';
  $('live-serving').textContent = snapshot.current ? snapshot.current.no : '—';
  $('live-waiting').textContent = snapshot.counts.waiting;

  // Track latest ticket
  if (snapshot.waiting.length > 0) {
    latestTicketToken = snapshot.waiting[snapshot.waiting.length - 1].token;
  } else if (snapshot.current) {
    latestTicketToken = snapshot.current.token;
  }
  if (event && event.type === 'issued' && event.token) {
    latestTicketToken = event.token;
  }

  const latestLink = $('link-latest-ticket');
  if (latestTicketToken) {
    latestLink.classList.remove('hidden');
    latestLink.onclick = (e) => {
      e.preventDefault();
      const sized = $('chk-sized').checked;
      const features = sized
        ? `width=${WINDOWS.patient.width},height=${WINDOWS.patient.height}`
        : undefined;
      window.open(`t/?token=${encodeURIComponent(latestTicketToken)}`, WINDOWS.patient.name, features);
    };
  }
}

export function initLauncher() {
  const config = getConfig();
  $('clinic-name').textContent = config.clinicName || 'Clinic Queue';

  startClock('#clock');

  // Wire individual buttons
  ['kiosk', 'staff', 'display', 'patient'].forEach((key) => {
    $(`btn-open-${key}`).addEventListener('click', () => {
      const w = openScreen(key);
      if (!w) {
        $('popup-hint').classList.remove('hidden');
      }
    });
  });

  // Open all four
  $('btn-open-all').addEventListener('click', () => {
    let blocked = false;
    ['kiosk', 'staff', 'display', 'patient'].forEach((key) => {
      const w = openScreen(key);
      if (!w) blocked = true;
    });
    $('popup-hint').classList.toggle('hidden', !blocked);
  });

  // Initial and reactive live status
  subscribe((snapshot, event) => {
    updateLiveStatus(snapshot, event);
  });
}
