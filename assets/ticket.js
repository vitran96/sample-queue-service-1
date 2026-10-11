import { getConfig, getSnapshot, getTicket, subscribe } from './store.js';
import { esc, formatTime, formatDate, startClock } from './common.js';

const $ = (id) => document.getElementById(id);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractToken(input) {
  if (!input) return null;
  const str = input.trim();
  if (UUID_REGEX.test(str)) {
    return str;
  }
  // Try extracting from URL
  try {
    const url = new URL(str, window.location.origin);
    const param = url.searchParams.get('token');
    if (param && UUID_REGEX.test(param)) {
      return param;
    }
  } catch (e) {}
  // Try finding a 36-char uuid anywhere in string
  const match = str.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : null;
}

function showCard(which) {
  $('card-entry').classList.toggle('hidden', which !== 'entry');
  $('card-ticket').classList.toggle('hidden', which !== 'ticket');
  $('card-notfound').classList.toggle('hidden', which !== 'notfound');
}

function renderTicketView(token) {
  const snapshot = getSnapshot();
  const isOffline = snapshot.status === 'offline';
  $('patient-offline-banner').classList.toggle('hidden', !isOffline);

  const ticketData = getTicket(token);
  if (!ticketData || !ticketData.ticket) {
    showCard('notfound');
    return;
  }

  showCard('ticket');
  const { ticket, ahead, nowServing } = ticketData;

  $('ticket-num').textContent = ticket.no;
  $('ticket-service-point').textContent = ticket.servicePoint || 'Counter 1';
  $('ticket-issued-time').textContent = formatTime(ticket.issuedAt);
  $('ticket-now-serving').textContent = nowServing || '—';

  // Determine state banner & message
  const statusEl = $('ticket-state-box');
  const msgEl = $('ticket-state-msg');
  statusEl.className = 'card card-center';

  if (ticket.status === 'called') {
    statusEl.classList.add('banner-brand');
    statusEl.style.background = 'var(--brand)';
    statusEl.style.color = '#fff';
    statusEl.innerHTML = `
      <div style="font-size:1.8rem;font-weight:800">It's your turn!</div>
      <div style="font-size:1.1rem;margin-top:4px">Please proceed to ${esc(ticket.servicePoint || 'Counter 1')} now.</div>
    `;
    msgEl.textContent = 'Your number is currently being called at the counter.';
  } else if (ticket.status === 'waiting') {
    if (ahead === 0) {
      statusEl.style.background = 'var(--warn-bg)';
      statusEl.style.border = '1px solid var(--warn)';
      statusEl.innerHTML = `
        <div style="font-size:1.5rem;font-weight:700;color:var(--warn)">You're next in line!</div>
        <div style="font-size:1rem;color:var(--ink);margin-top:4px">Please prepare to approach the counter.</div>
      `;
    } else {
      statusEl.style.background = 'var(--brand-light)';
      statusEl.style.border = '1px solid var(--brand)';
      statusEl.innerHTML = `
        <div style="font-size:1.6rem;font-weight:800;color:var(--brand)">${ahead} ${ahead === 1 ? 'person' : 'people'} ahead of you</div>
        <div style="font-size:1rem;color:var(--ink);margin-top:4px">Estimated wait is progressing.</div>
      `;
    }
    msgEl.textContent = 'Stay nearby: this page updates automatically.';
  } else if (ticket.status === 'noshow') {
    statusEl.style.background = 'var(--err-bg)';
    statusEl.style.border = '1px solid var(--err)';
    statusEl.innerHTML = `
      <div style="font-size:1.5rem;font-weight:700;color:var(--err)">Missed Call</div>
      <div style="font-size:1rem;color:var(--ink);margin-top:4px">Your number was called but you were not present.</div>
    `;
    msgEl.textContent = 'Please see the counter staff to be re-added to the queue.';
  } else if (ticket.status === 'served') {
    statusEl.style.background = 'var(--muted-light)';
    statusEl.style.border = '1px solid var(--border)';
    statusEl.innerHTML = `
      <div style="font-size:1.5rem;font-weight:700;color:var(--muted)">Ticket Closed</div>
      <div style="font-size:1rem;color:var(--ink);margin-top:4px">Thank you. Your visit is complete.</div>
    `;
    msgEl.textContent = 'This ticket has been marked as completed.';
  }
}

export function initPatient() {
  const config = getConfig();
  $('clinic-name').textContent = config.clinicName || 'Clinic Queue';

  startClock('#clock');

  const params = new URLSearchParams(window.location.search);
  let token = params.get('token');

  if (token) {
    token = extractToken(token);
  }

  if (!token) {
    showCard('entry');
  } else {
    renderTicketView(token);
  }

  // Handle entry submit
  $('btn-submit-code').addEventListener('click', () => {
    const raw = $('input-code').value;
    const extracted = extractToken(raw);
    if (!extracted) {
      $('entry-error').classList.remove('hidden');
      return;
    }
    $('entry-error').classList.add('hidden');
    window.location.search = `?token=${encodeURIComponent(extracted)}`;
  });

  $('input-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-submit-code').click();
  });

  // Switch ticket links
  const resetToEntry = (e) => {
    e.preventDefault();
    history.pushState(null, '', window.location.pathname);
    token = null;
    $('input-code').value = '';
    showCard('entry');
  };

  $('link-check-another').addEventListener('click', resetToEntry);
  $('btn-back-entry').addEventListener('click', resetToEntry);

  // Subscribe to live queue changes
  subscribe(() => {
    if (token) {
      renderTicketView(token);
    }
  });
}
