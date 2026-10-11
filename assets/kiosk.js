import { getConfig, getSnapshot, issueTicket, printTicket, subscribe } from './store.js';
import { esc, startClock, renderQr } from './common.js';

const $ = (id) => document.getElementById(id);

let state = 'idle'; // 'idle' | 'getting' | 'ticket' | 'printing' | 'printer-error' | 'offline'
let lastTicket = null;
let resetTimer = null;
let secondsLeft = 30;
let isPrinting = false;
let enteredId = '';

function setScreen(newState) {
  state = newState;
  $('view-idle').classList.toggle('hidden', state !== 'idle' && state !== 'getting');
  $('view-ticket').classList.toggle('hidden', state !== 'ticket' && state !== 'printing' && state !== 'printer-error');
  $('view-offline').classList.toggle('hidden', state !== 'offline');

  if (state === 'idle') {
    enteredId = '';
    $('input-id').value = '';
    $('btn-get-ticket').disabled = false;
    $('btn-get-ticket').textContent = 'Get queue number';
    clearInterval(resetTimer);
  }
}

function startAutoReset(seconds) {
  clearInterval(resetTimer);
  secondsLeft = seconds;
  $('btn-done').textContent = `Done (${secondsLeft}s)`;

  resetTimer = setInterval(() => {
    if (isPrinting) return; // Pause countdown while printing
    secondsLeft -= 1;
    $('btn-done').textContent = `Done (${secondsLeft}s)`;
    if (secondsLeft <= 0) {
      clearInterval(resetTimer);
      setScreen('idle');
    }
  }, 1000);
}

function getPatientUrl(token) {
  const config = getConfig();
  let base = config.publicBaseUrl;
  if (!base) {
    base = window.location.origin + window.location.pathname.replace(/\/kiosk\/?$/, '');
  }
  // Ensure base ends cleanly before /t/
  base = base.replace(/\/+$/, '');
  return `${base}/t/?token=${encodeURIComponent(token)}`;
}

export function initKiosk() {
  const config = getConfig();
  $('clinic-name').textContent = config.clinicName || 'Clinic Queue';
  $('service-point').textContent = config.servicePoint || 'Counter 1';

  startClock('#clock');

  // Initial status check
  const initialSnap = getSnapshot();
  if (initialSnap.status === 'offline') {
    setScreen('offline');
  } else {
    setScreen('idle');
  }

  // Subscribe to offline/online changes
  subscribe((snap) => {
    if (snap.status === 'offline') {
      setScreen('offline');
    } else if (state === 'offline') {
      setScreen('idle');
    }
  });

  // Simulated scan button
  $('btn-sim-scan').addEventListener('click', () => {
    // Generate simulated 9-character ID
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    enteredId = `S*****${randomSuffix}`;
    $('input-id').value = enteredId;
  });

  // Manual typing
  $('input-id').addEventListener('input', (e) => {
    enteredId = e.target.value.trim();
  });

  // Get Ticket action
  $('btn-get-ticket').addEventListener('click', async () => {
    if (state === 'getting') return;
    setScreen('getting');
    $('btn-get-ticket').disabled = true;
    $('btn-get-ticket').textContent = 'Getting number…';

    // Privacy rule: Clear ID variable BEFORE calling issueTicket()
    enteredId = '';
    $('input-id').value = '';

    try {
      const ticket = await issueTicket();
      lastTicket = ticket;

      // Populate ticket view
      $('ticket-number').textContent = ticket.no;
      $('ticket-ahead').textContent = ticket.ahead === 0
        ? 'You are next in line'
        : `${ticket.ahead} ${ticket.ahead === 1 ? 'person' : 'people'} ahead of you`;

      const targetUrl = getPatientUrl(ticket.token);
      renderQr($('ticket-qr'), targetUrl);

      $('ticket-token-code').textContent = ticket.token;
      $('printer-error-box').classList.add('hidden');
      $('btn-print').disabled = false;
      $('btn-print').textContent = 'Print Ticket';

      setScreen('ticket');
      const resetSec = config.kioskResetSeconds || 30;
      startAutoReset(resetSec);
    } catch (err) {
      if (err.message === 'ServiceUnavailable') {
        setScreen('offline');
      } else {
        alert(`Error getting queue number: ${err.message}`);
        setScreen('idle');
      }
    }
  });

  // Copy token button
  $('btn-copy-token').addEventListener('click', () => {
    if (lastTicket && lastTicket.token) {
      navigator.clipboard.writeText(lastTicket.token).then(() => {
        $('btn-copy-token').textContent = 'Copied!';
        setTimeout(() => { $('btn-copy-token').textContent = 'Copy Code'; }, 1500);
      });
    }
  });

  // Print button
  const doPrint = async () => {
    isPrinting = true;
    $('btn-print').disabled = true;
    $('btn-print').textContent = 'Printing…';
    $('printer-error-box').classList.add('hidden');

    try {
      await printTicket();
      $('btn-print').textContent = 'Printed ✓';
      setTimeout(() => {
        isPrinting = false;
        $('btn-print').textContent = 'Print Again';
        $('btn-print').disabled = false;
      }, 1500);
    } catch (err) {
      isPrinting = false;
      $('printer-error-box').classList.remove('hidden');
      $('btn-print').textContent = 'Retry Print';
      $('btn-print').disabled = false;
    }
  };

  $('btn-print').addEventListener('click', doPrint);
  $('btn-retry-print').addEventListener('click', doPrint);

  // Done button
  $('btn-done').addEventListener('click', () => {
    clearInterval(resetTimer);
    setScreen('idle');
  });
}
