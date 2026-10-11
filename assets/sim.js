import { sim, getConfig, getSnapshot, subscribe, issueTicket } from './store.js';
import { esc, formatTime, formatDate, getSimulatedDate, startClock } from './common.js';

const $ = (id) => document.getElementById(id);

let currentSimConfig = sim.get();
let recentEvents = [];

function updateFaultUI() {
  currentSimConfig = sim.get();
  $('btn-service-down').textContent = currentSimConfig.serviceDown ? 'Service Down: ON (Broken)' : 'Service Down: OFF (Normal)';
  $('btn-service-down').className = currentSimConfig.serviceDown ? 'btn btn-danger' : 'btn btn-outline';

  $('sel-printer').value = currentSimConfig.printer || 'ok';
  $('sel-latency').value = String(currentSimConfig.latencyMs || 0);

  const offsetHrs = Math.round((currentSimConfig.clockOffsetMs || 0) / 3600000);
  $('clock-offset-info').textContent = offsetHrs === 0 ? 'Clock: Real time' : `Clock: +${offsetHrs} hours offset`;
}

function updateRawJson() {
  const allData = sim.exportJson();
  $('json-viewer').textContent = JSON.stringify(allData, null, 2);
  $('json-editor').value = JSON.stringify(allData, null, 2);
}

function updateEventsLog(event) {
  if (event) {
    recentEvents.unshift({
      time: formatTime(new Date(event.at || Date.now())),
      type: event.type,
      no: event.no || '—',
      token: event.token || '—'
    });
    if (recentEvents.length > 20) recentEvents.pop();
  }
  const el = $('event-log');
  if (!el) return;
  if (recentEvents.length === 0) {
    el.innerHTML = '<span class="text-muted">No events yet</span>';
    return;
  }
  el.innerHTML = recentEvents.map((e) => `
    <div style="font-family:monospace;font-size:0.85rem;padding:4px 0;border-bottom:1px solid var(--border)">
      <b>${esc(e.time)}</b> [${esc(e.type.toUpperCase())}] Ticket: <b>${esc(e.no)}</b> <span class="text-muted">${esc(e.token.slice(0, 8))}…</span>
    </div>
  `).join('');
}

export function initSimulation() {
  const config = getConfig();
  $('clinic-name').textContent = config.clinicName || 'Clinic Queue';

  startClock('#sim-clock', () => sim.get().clockOffsetMs);

  updateFaultUI();
  updateRawJson();

  subscribe((snapshot, event) => {
    updateFaultUI();
    updateRawJson();
    updateEventsLog(event);
  });

  // Data section
  $('btn-clear-all').addEventListener('click', () => {
    if (confirm('Clear ALL demo data (removes all cq:* keys)?')) {
      sim.clearAll();
      recentEvents = [];
      updateEventsLog(null);
    }
  });

  $('btn-reset-today').addEventListener('click', () => {
    if (confirm("Reset today's queue (counter back to 0, keeps history)?")) {
      sim.resetToday();
    }
  });

  $('btn-seed-morning').addEventListener('click', () => {
    sim.seed('morning');
  });

  $('btn-seed-empty').addEventListener('click', () => {
    sim.seed('empty');
  });

  $('btn-seed-busy').addEventListener('click', () => {
    sim.seed('busy');
  });

  $('btn-seed-end').addEventListener('click', () => {
    sim.seed('end_of_day');
  });

  // Tickets section
  $('btn-add-1').addEventListener('click', () => sim.addWaiting(1));
  $('btn-add-5').addEventListener('click', () => sim.addWaiting(5));
  $('btn-add-10').addEventListener('click', () => sim.addWaiting(10));

  $('btn-issue-one').addEventListener('click', async () => {
    try {
      const result = await issueTicket();
      $('issued-ticket-info').classList.remove('hidden');
      $('issued-ticket-no').textContent = result.no;
      $('issued-ticket-token').textContent = result.token;
      $('link-open-patient').href = `../t/?token=${encodeURIComponent(result.token)}`;
    } catch (err) {
      alert(`Issue failed: ${err.message}`);
    }
  });

  $('btn-copy-token').addEventListener('click', () => {
    const tok = $('issued-ticket-token').textContent;
    if (tok) {
      navigator.clipboard.writeText(tok).then(() => {
        $('btn-copy-token').textContent = 'Copied!';
        setTimeout(() => { $('btn-copy-token').textContent = 'Copy Code'; }, 1500);
      });
    }
  });

  // Faults
  $('btn-service-down').addEventListener('click', () => {
    const cur = sim.get().serviceDown;
    sim.set({ serviceDown: !cur });
    updateFaultUI();
  });

  $('sel-printer').addEventListener('change', (e) => {
    sim.set({ printer: e.target.value });
  });

  $('sel-latency').addEventListener('change', (e) => {
    sim.set({ latencyMs: Number(e.target.value) });
  });

  // Time
  $('btn-next-day').addEventListener('click', () => {
    const cur = sim.get().clockOffsetMs || 0;
    // Advance 25 hours to ensure crossing midnight reset
    sim.set({ clockOffsetMs: cur + 25 * 3600 * 1000 });
    updateFaultUI();
  });

  $('btn-real-time').addEventListener('click', () => {
    sim.set({ clockOffsetMs: 0 });
    updateFaultUI();
  });

  // Export / Import
  $('btn-export').addEventListener('click', () => {
    const data = sim.exportJson();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clinic-queue-backup-${formatDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('file-import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        sim.importJson(evt.target.result);
        alert('Data imported successfully');
      } catch (err) {
        alert(`Invalid JSON file: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('btn-save-json').addEventListener('click', () => {
    try {
      const val = $('json-editor').value;
      sim.importJson(val);
      alert('Saved custom state successfully');
    } catch (err) {
      alert(`Invalid JSON format: ${err.message}`);
    }
  });
}
