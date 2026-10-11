import { getConfig, getSnapshot, callNext, recall, markNoShow, requeue, subscribe } from './store.js';
import { esc, formatTime, formatDate, startClock } from './common.js';

const $ = (id) => document.getElementById(id);

let isBusy = false;
let currentTab = 'waiting'; // 'waiting' | 'called' | 'all'
let confirmNoShow = false;

function checkPin() {
  const config = getConfig();
  const savedPin = sessionStorage.getItem('cq_staff_pin');
  const valid = savedPin === (config.staffPin || '1234');
  $('view-pin').classList.toggle('hidden', valid);
  $('view-panel').classList.toggle('hidden', !valid);
  return valid;
}

function render(snapshot) {
  if (!checkPin()) return;

  const isOffline = snapshot.status === 'offline';
  $('staff-offline-banner').classList.toggle('hidden', !isOffline);

  // Now serving card
  const cur = snapshot.current;
  if (cur) {
    $('cur-no').textContent = cur.no;
    $('cur-status').innerHTML = `<span class="badge badge-brand">Called</span> (Calls: <b>${cur.calls}</b>)`;
    $('cur-time').textContent = `Called at: ${formatTime(cur.lastCalledAt || cur.firstCalledAt)}`;
    $('btn-recall').disabled = isOffline || isBusy;
    $('btn-noshow-trigger').disabled = isOffline || isBusy;
    $('btn-requeue').disabled = isOffline || isBusy;
  } else {
    $('cur-no').textContent = '—';
    $('cur-status').innerHTML = `<span class="badge">No active ticket</span>`;
    $('cur-time').textContent = '—';
    $('btn-recall').disabled = true;
    $('btn-noshow-trigger').disabled = true;
    $('btn-requeue').disabled = true;
  }

  // Call next button state
  $('btn-call-next').disabled = isOffline || isBusy || snapshot.counts.waiting === 0;

  // Reset inline confirm state
  if (!cur) {
    confirmNoShow = false;
    $('noshow-inline-confirm').classList.add('hidden');
    $('btn-noshow-trigger').classList.remove('hidden');
  }

  // Waiting summary
  $('count-waiting').textContent = snapshot.counts.waiting;
  const nextTicket = snapshot.waiting.length > 0 ? snapshot.waiting[0].no : '—';
  $('next-ticket-label').textContent = nextTicket;

  // Waiting chips
  $('waiting-chips').innerHTML = snapshot.waiting.length > 0
    ? snapshot.waiting.map((t) => `<span class="badge badge-brand" style="font-size:0.95rem">${esc(t.no)}</span>`).join(' ')
    : '<span class="text-muted">No patients waiting</span>';

  // Counts badges in tabs
  $('tab-badge-waiting').textContent = snapshot.counts.waiting;
  $('tab-badge-called').textContent = snapshot.noShows.length;
  $('tab-badge-all').textContent = snapshot.counts.total;

  renderTable(snapshot);
}

function renderTable(snapshot) {
  const tbody = $('table-body');
  let list = [];
  if (currentTab === 'waiting') {
    list = snapshot.waiting;
  } else if (currentTab === 'called') {
    list = snapshot.noShows;
  } else {
    list = snapshot.all;
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:20px">No tickets in this category</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((t) => {
    let statusBadge = '<span class="badge">Waiting</span>';
    if (t.status === 'called') statusBadge = '<span class="badge badge-brand">Called</span>';
    if (t.status === 'served') statusBadge = '<span class="badge">Served</span>';
    if (t.status === 'noshow') statusBadge = '<span class="badge badge-err">No-Show</span>';

    const canRequeue = (t.status === 'noshow' || t.status === 'served');
    const actionBtn = canRequeue
      ? `<button class="btn btn-outline btn-table-requeue" data-token="${esc(t.token)}" style="padding:4px 8px;font-size:0.8rem">Requeue</button>`
      : '—';

    return `
      <tr>
        <td><b>${esc(t.no)}</b></td>
        <td>${esc(t.status)}</td>
        <td>${esc(statusBadge)}</td>
        <td>${formatTime(t.issuedAt)}</td>
        <td>${t.calls || 0}</td>
        <td>${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

export function initStaff() {
  const config = getConfig();
  $('clinic-name').textContent = config.clinicName || 'Clinic Queue';
  $('service-point').textContent = config.servicePoint || 'Counter 1';
  $('pin-hint').textContent = `Demo PIN: ${config.staffPin || '1234'}`;

  startClock('#clock');

  // PIN login
  $('btn-submit-pin').addEventListener('click', () => {
    const input = $('input-pin').value.trim();
    if (input === (config.staffPin || '1234')) {
      sessionStorage.setItem('cq_staff_pin', input);
      $('pin-error').classList.add('hidden');
      $('input-pin').value = '';
      checkPin();
      render(getSnapshot());
    } else {
      $('pin-error').classList.remove('hidden');
    }
  });

  $('input-pin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-submit-pin').click();
  });

  $('btn-lock').addEventListener('click', () => {
    sessionStorage.removeItem('cq_staff_pin');
    checkPin();
  });

  // Call Next action: locks while in flight + 1s
  $('btn-call-next').addEventListener('click', async () => {
    if (isBusy) return;
    isBusy = true;
    $('btn-call-next').disabled = true;
    $('btn-call-next').textContent = 'Calling…';

    try {
      await callNext();
    } catch (err) {
      if (err.message !== 'NothingToCall') {
        alert(`Error: ${err.message}`);
      }
    } finally {
      // Keep lock for 1 additional second per spec
      setTimeout(() => {
        isBusy = false;
        $('btn-call-next').textContent = 'Call Next';
        render(getSnapshot());
      }, 1000);
    }
  });

  // Recall action
  $('btn-recall').addEventListener('click', async () => {
    if (isBusy) return;
    isBusy = true;
    $('btn-recall').disabled = true;
    try {
      await recall();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      isBusy = false;
      render(getSnapshot());
    }
  });

  // No-show inline confirm flow
  $('btn-noshow-trigger').addEventListener('click', () => {
    confirmNoShow = true;
    $('btn-noshow-trigger').classList.add('hidden');
    $('noshow-inline-confirm').classList.remove('hidden');
  });

  $('btn-noshow-cancel').addEventListener('click', () => {
    confirmNoShow = false;
    $('noshow-inline-confirm').classList.add('hidden');
    $('btn-noshow-trigger').classList.remove('hidden');
  });

  $('btn-noshow-confirm').addEventListener('click', async () => {
    if (isBusy) return;
    isBusy = true;
    try {
      await markNoShow();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      isBusy = false;
      confirmNoShow = false;
      $('noshow-inline-confirm').classList.add('hidden');
      $('btn-noshow-trigger').classList.remove('hidden');
      render(getSnapshot());
    }
  });

  // Back to queue (requeue current)
  $('btn-requeue').addEventListener('click', async () => {
    if (isBusy) return;
    isBusy = true;
    try {
      await requeue();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      isBusy = false;
      render(getSnapshot());
    }
  });

  // Tab switching
  ['waiting', 'called', 'all'].forEach((tabName) => {
    $(`tab-${tabName}`).addEventListener('click', () => {
      currentTab = tabName;
      ['waiting', 'called', 'all'].forEach((t) => {
        $(`tab-${t}`).className = t === currentTab ? 'btn btn-primary' : 'btn btn-outline';
      });
      renderTable(getSnapshot());
    });
  });

  // Table requeue delegate
  $('table-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-table-requeue');
    if (!btn) return;
    const tok = btn.dataset.token;
    if (!tok || isBusy) return;
    isBusy = true;
    btn.disabled = true;
    try {
      await requeue(tok);
    } catch (err) {
      alert(`Error requeuing ticket: ${err.message}`);
    } finally {
      isBusy = false;
      render(getSnapshot());
    }
  });

  // Subscribe to storage updates
  subscribe((snapshot) => {
    render(snapshot);
  });
}
