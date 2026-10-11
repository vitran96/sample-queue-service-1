// Fake Service Store (localStorage + storage event + Web Locks)
// Emulates backend API for Clinic Queue demo

const KEY_CONFIG = 'cq:config';
const KEY_STATE = 'cq:state';
const KEY_EVENT = 'cq:event';
const KEY_SIM = 'cq:sim';

const DEFAULT_CONFIG = {
  v: 1,
  clinicName: 'Sample Queue Service',
  servicePoint: 'Counter 1',
  prefix: 'A',
  resetTime: '00:00',
  kioskResetSeconds: 30,
  staffPin: '1234',
  publicBaseUrl: ''
};

const DEFAULT_SIM = {
  v: 1,
  serviceDown: false,
  printer: 'ok', // 'ok' | 'fail'
  latencyMs: 600,
  clockOffsetMs: 0
};

// Memory fallback for environments without browser localStorage (e.g. Node tests)
const memoryStorage = new Map();

function storageGet(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch (e) {}
  return memoryStorage.get(key) || null;
}

function storageSet(key, value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch (e) {}
  memoryStorage.set(key, value);
}

function storageRemove(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
      return;
    }
  } catch (e) {}
  memoryStorage.delete(key);
}

// In-process fallback lock for Node or unsupported browsers
let lockChain = Promise.resolve();
function withLock(name, fn) {
  if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
    return navigator.locks.request(name, fn);
  }
  const nextLock = lockChain.then(() => fn());
  lockChain = nextLock.catch(() => {});
  return nextLock;
}

function generateUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getConfig() {
  const raw = storageGet(KEY_CONFIG);
  if (!raw) {
    const conf = { ...DEFAULT_CONFIG };
    storageSet(KEY_CONFIG, JSON.stringify(conf));
    return conf;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed.v === 1) return parsed;
  } catch (e) {}
  const conf = { ...DEFAULT_CONFIG };
  storageSet(KEY_CONFIG, JSON.stringify(conf));
  return conf;
}

function getSim() {
  const raw = storageGet(KEY_SIM);
  if (!raw) {
    const sim = { ...DEFAULT_SIM };
    storageSet(KEY_SIM, JSON.stringify(sim));
    return sim;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed.v === 1) return parsed;
  } catch (e) {}
  const sim = { ...DEFAULT_SIM };
  storageSet(KEY_SIM, JSON.stringify(sim));
  return sim;
}

function getNowDate(offsetMs = 0) {
  return new Date(Date.now() + (offsetMs || 0));
}

function getServiceDateString(date, resetTime = '00:00') {
  const [resetH, resetM] = (resetTime || '00:00').split(':').map(Number);
  const d = new Date(date);
  const curMinutes = d.getHours() * 60 + d.getMinutes();
  const resetMinutes = (resetH || 0) * 60 + (resetM || 0);
  if (curMinutes < resetMinutes) {
    d.setDate(d.getDate() - 1);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function checkAndApplyDailyReset(state, now, config) {
  const currentDate = getServiceDateString(now, config.resetTime);
  if (!state.serviceDate) {
    state.serviceDate = currentDate;
  }
  if (state.serviceDate !== currentDate) {
    // Day changed
    state.serviceDate = currentDate;
    state.counter = 0;
    state.currentToken = null;
    state.waitingOrder = [];
    state.rev = (state.rev || 0) + 1;

    // Prune history to keep only last 7 service dates
    const allDates = Array.from(new Set(Object.values(state.tickets || {}).map(t => t.serviceDate)))
      .sort()
      .reverse()
      .slice(0, 7);
    const validDates = new Set(allDates);
    const prunedTickets = {};
    for (const [tok, tick] of Object.entries(state.tickets || {})) {
      if (validDates.has(tick.serviceDate)) {
        prunedTickets[tok] = tick;
      }
    }
    state.tickets = prunedTickets;
    return true;
  }
  return false;
}

function loadStateRaw() {
  const raw = storageGet(KEY_STATE);
  if (!raw) {
    const config = getConfig();
    const sim = getSim();
    const now = getNowDate(sim.clockOffsetMs);
    const initial = {
      v: 1,
      rev: 1,
      serviceDate: getServiceDateString(now, config.resetTime),
      counter: 0,
      currentToken: null,
      waitingOrder: [],
      tickets: {}
    };
    storageSet(KEY_STATE, JSON.stringify(initial));
    return initial;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed.v === 1 && typeof parsed.tickets === 'object') {
      return parsed;
    }
  } catch (e) {}
  // Reset if invalid
  const config = getConfig();
  const sim = getSim();
  const now = getNowDate(sim.clockOffsetMs);
  const initial = {
    v: 1,
    rev: 1,
    serviceDate: getServiceDateString(now, config.resetTime),
    counter: 0,
    currentToken: null,
    waitingOrder: [],
    tickets: {}
  };
  storageSet(KEY_STATE, JSON.stringify(initial));
  return initial;
}

const subscribers = new Set();

function notifySubscribers(snapshot, event = null) {
  subscribers.forEach((fn) => {
    try {
      fn(snapshot, event);
    } catch (e) {
      console.error('Subscriber error:', e);
    }
  });
}

function broadcastEvent(event) {
  storageSet(KEY_EVENT, JSON.stringify(event));
}

// In-tab storage listener
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY_STATE || e.key === KEY_EVENT || e.key === KEY_SIM) {
      const snap = getSnapshot();
      let evt = null;
      if (e.key === KEY_EVENT && e.newValue) {
        try { evt = JSON.parse(e.newValue); } catch (err) {}
      }
      notifySubscribers(snap, evt);
    }
  });
}

export function subscribe(fn) {
  subscribers.add(fn);
  // Initial push
  try {
    fn(getSnapshot(), null);
  } catch (e) {}
  return () => {
    subscribers.delete(fn);
  };
}

export function getSnapshot() {
  const sim = getSim();
  const config = getConfig();
  const now = getNowDate(sim.clockOffsetMs);
  const state = loadStateRaw();
  checkAndApplyDailyReset(state, now, config);

  const curServiceDate = state.serviceDate;
  const currentTicket = (state.currentToken && state.tickets[state.currentToken]) || null;
  const waitingTickets = (state.waitingOrder || [])
    .map((tok) => state.tickets[tok])
    .filter(Boolean);
  const allToday = Object.values(state.tickets || {}).filter((t) => t.serviceDate === curServiceDate);
  const noShows = allToday.filter((t) => t.status === 'noshow');
  const servedCount = allToday.filter((t) => t.status === 'served').length;

  return {
    status: sim.serviceDown ? 'offline' : 'online',
    serviceDate: curServiceDate,
    current: currentTicket,
    waiting: waitingTickets,
    noShows,
    all: allToday,
    counts: {
      waiting: waitingTickets.length,
      served: servedCount,
      noshow: noShows.length,
      total: allToday.length
    }
  };
}

export function getTicket(token) {
  if (!token) return null;
  const sim = getSim();
  const config = getConfig();
  const now = getNowDate(sim.clockOffsetMs);
  const state = loadStateRaw();
  checkAndApplyDailyReset(state, now, config);

  const ticket = state.tickets && state.tickets[token];
  if (!ticket || ticket.serviceDate !== state.serviceDate) {
    return null;
  }

  let ahead = 0;
  if (ticket.status === 'waiting') {
    const idx = (state.waitingOrder || []).indexOf(token);
    ahead = idx >= 0 ? idx : 0;
  }

  let nowServing = '—';
  if (state.currentToken && state.tickets[state.currentToken]) {
    nowServing = state.tickets[state.currentToken].no;
  }

  return {
    ticket,
    ahead,
    nowServing
  };
}

// Issue ticket: takes NO ID argument (privacy rule)
export async function issueTicket() {
  const sim = getSim();
  if (sim.latencyMs > 0) await delay(sim.latencyMs);
  if (sim.serviceDown) throw new Error('ServiceUnavailable');

  return withLock('cq-db', async () => {
    const simNow = getSim();
    if (simNow.serviceDown) throw new Error('ServiceUnavailable');

    const config = getConfig();
    const now = getNowDate(simNow.clockOffsetMs);
    const nowIso = now.toISOString();
    const state = loadStateRaw();
    checkAndApplyDailyReset(state, now, config);

    state.counter = (state.counter || 0) + 1;
    const seq = state.counter;
    const prefix = config.prefix || 'A';
    const no = `${prefix}${String(seq).padStart(3, '0')}`;
    const token = generateUuid();

    const ahead = (state.waitingOrder || []).length;

    const ticket = {
      token,
      no,
      seq,
      serviceDate: state.serviceDate,
      servicePoint: config.servicePoint || 'Counter 1',
      status: 'waiting',
      issuedAt: nowIso,
      firstCalledAt: null,
      lastCalledAt: null,
      calls: 0,
      closedAt: null
    };

    state.tickets[token] = ticket;
    state.waitingOrder.push(token);
    state.rev = (state.rev || 0) + 1;

    storageSet(KEY_STATE, JSON.stringify(state));

    const event = {
      v: 1,
      id: Date.now(),
      type: 'issued',
      token,
      no,
      at: nowIso
    };
    broadcastEvent(event);

    const snapshot = getSnapshot();
    notifySubscribers(snapshot, event);

    return {
      token,
      no,
      ahead,
      issuedAt: nowIso
    };
  });
}

export async function callNext() {
  const sim = getSim();
  if (sim.latencyMs > 0) await delay(sim.latencyMs);
  if (sim.serviceDown) throw new Error('ServiceUnavailable');

  return withLock('cq-db', async () => {
    const simNow = getSim();
    if (simNow.serviceDown) throw new Error('ServiceUnavailable');

    const config = getConfig();
    const now = getNowDate(simNow.clockOffsetMs);
    const nowIso = now.toISOString();
    const state = loadStateRaw();
    checkAndApplyDailyReset(state, now, config);

    // Close existing called ticket
    if (state.currentToken && state.tickets[state.currentToken]) {
      const cur = state.tickets[state.currentToken];
      if (cur.status === 'called') {
        cur.status = 'served';
        cur.closedAt = nowIso;
      }
    }

    if (!state.waitingOrder || state.waitingOrder.length === 0) {
      state.currentToken = null;
      state.rev = (state.rev || 0) + 1;
      storageSet(KEY_STATE, JSON.stringify(state));
      throw new Error('NothingToCall');
    }

    const nextToken = state.waitingOrder.shift();
    state.currentToken = nextToken;
    const ticket = state.tickets[nextToken];
    ticket.status = 'called';
    if (!ticket.firstCalledAt) ticket.firstCalledAt = nowIso;
    ticket.lastCalledAt = nowIso;
    ticket.calls = (ticket.calls || 0) + 1;

    state.rev = (state.rev || 0) + 1;
    storageSet(KEY_STATE, JSON.stringify(state));

    const event = {
      v: 1,
      id: Date.now(),
      type: 'called',
      token: nextToken,
      no: ticket.no,
      at: nowIso
    };
    broadcastEvent(event);

    const snapshot = getSnapshot();
    notifySubscribers(snapshot, event);
    return snapshot;
  });
}

export async function recall() {
  const sim = getSim();
  if (sim.latencyMs > 0) await delay(sim.latencyMs);
  if (sim.serviceDown) throw new Error('ServiceUnavailable');

  return withLock('cq-db', async () => {
    const simNow = getSim();
    if (simNow.serviceDown) throw new Error('ServiceUnavailable');

    const config = getConfig();
    const now = getNowDate(simNow.clockOffsetMs);
    const nowIso = now.toISOString();
    const state = loadStateRaw();
    checkAndApplyDailyReset(state, now, config);

    if (!state.currentToken || !state.tickets[state.currentToken]) {
      return getSnapshot();
    }

    const ticket = state.tickets[state.currentToken];
    ticket.status = 'called';
    ticket.lastCalledAt = nowIso;
    ticket.calls = (ticket.calls || 0) + 1;

    state.rev = (state.rev || 0) + 1;
    storageSet(KEY_STATE, JSON.stringify(state));

    const event = {
      v: 1,
      id: Date.now(),
      type: 'recalled',
      token: state.currentToken,
      no: ticket.no,
      at: nowIso
    };
    broadcastEvent(event);

    const snapshot = getSnapshot();
    notifySubscribers(snapshot, event);
    return snapshot;
  });
}

export async function markNoShow() {
  const sim = getSim();
  if (sim.latencyMs > 0) await delay(sim.latencyMs);
  if (sim.serviceDown) throw new Error('ServiceUnavailable');

  return withLock('cq-db', async () => {
    const simNow = getSim();
    if (simNow.serviceDown) throw new Error('ServiceUnavailable');

    const config = getConfig();
    const now = getNowDate(simNow.clockOffsetMs);
    const nowIso = now.toISOString();
    const state = loadStateRaw();
    checkAndApplyDailyReset(state, now, config);

    if (!state.currentToken || !state.tickets[state.currentToken]) {
      return getSnapshot();
    }

    const token = state.currentToken;
    const ticket = state.tickets[token];
    ticket.status = 'noshow';
    ticket.closedAt = nowIso;
    state.currentToken = null;

    state.rev = (state.rev || 0) + 1;
    storageSet(KEY_STATE, JSON.stringify(state));

    const event = {
      v: 1,
      id: Date.now(),
      type: 'noshow',
      token,
      no: ticket.no,
      at: nowIso
    };
    broadcastEvent(event);

    const snapshot = getSnapshot();
    notifySubscribers(snapshot, event);
    return snapshot;
  });
}

export async function requeue(targetToken = null) {
  const sim = getSim();
  if (sim.latencyMs > 0) await delay(sim.latencyMs);
  if (sim.serviceDown) throw new Error('ServiceUnavailable');

  return withLock('cq-db', async () => {
    const simNow = getSim();
    if (simNow.serviceDown) throw new Error('ServiceUnavailable');

    const config = getConfig();
    const now = getNowDate(simNow.clockOffsetMs);
    const nowIso = now.toISOString();
    const state = loadStateRaw();
    checkAndApplyDailyReset(state, now, config);

    const token = targetToken || state.currentToken;
    if (!token || !state.tickets[token]) {
      return getSnapshot();
    }

    const ticket = state.tickets[token];
    ticket.status = 'waiting';
    ticket.closedAt = null;

    if (state.currentToken === token) {
      state.currentToken = null;
    }

    // Put at front of waitingOrder
    state.waitingOrder = (state.waitingOrder || []).filter((t) => t !== token);
    state.waitingOrder.unshift(token);

    state.rev = (state.rev || 0) + 1;
    storageSet(KEY_STATE, JSON.stringify(state));

    const event = {
      v: 1,
      id: Date.now(),
      type: 'requeued',
      token,
      no: ticket.no,
      at: nowIso
    };
    broadcastEvent(event);

    const snapshot = getSnapshot();
    notifySubscribers(snapshot, event);
    return snapshot;
  });
}

// Print ticket demo helper: resolves or rejects after 1.8s
export async function printTicket() {
  await delay(1800);
  const sim = getSim();
  if (sim.printer === 'fail') {
    throw new Error('PrinterError');
  }
  return { ok: true };
}

// Simulation controls (for /sim/ and testing)
export const sim = {
  get: getSim,
  set: (patch) => {
    const current = getSim();
    const updated = { ...current, ...patch, v: 1 };
    storageSet(KEY_SIM, JSON.stringify(updated));
    const snapshot = getSnapshot();
    notifySubscribers(snapshot, null);
    return updated;
  },
  seed: (scenarioName) => {
    const config = getConfig();
    const currentSim = getSim();
    const now = getNowDate(currentSim.clockOffsetMs);
    const serviceDate = getServiceDateString(now, config.resetTime);
    const nowIso = now.toISOString();
    const prefix = config.prefix || 'A';

    let counter = 0;
    let currentToken = null;
    let waitingOrder = [];
    const tickets = {};

    if (scenarioName === 'morning') {
      // Seed A001-A018: A001-A007 served, A008-A009 served, A010 no-show, A011 served, A012 serving, A013-A018 waiting
      counter = 18;
      for (let i = 1; i <= 18; i++) {
        const tok = generateUuid();
        const num = `${prefix}${String(i).padStart(3, '0')}`;
        let status = 'served';
        let calls = 1;
        let closedAt = nowIso;
        let firstCalledAt = nowIso;

        if (i === 10) {
          status = 'noshow';
        } else if (i === 12) {
          status = 'called';
          closedAt = null;
          currentToken = tok;
        } else if (i >= 13) {
          status = 'waiting';
          calls = 0;
          closedAt = null;
          firstCalledAt = null;
          waitingOrder.push(tok);
        }

        tickets[tok] = {
          token: tok,
          no: num,
          seq: i,
          serviceDate,
          servicePoint: config.servicePoint || 'Counter 1',
          status,
          issuedAt: nowIso,
          firstCalledAt,
          lastCalledAt: firstCalledAt,
          calls,
          closedAt
        };
      }
    } else if (scenarioName === 'busy') {
      counter = 31;
      for (let i = 1; i <= 31; i++) {
        const tok = generateUuid();
        const num = `${prefix}${String(i).padStart(3, '0')}`;
        let status = 'served';
        let calls = 1;
        let closedAt = nowIso;
        let firstCalledAt = nowIso;

        if (i === 6) {
          status = 'called';
          closedAt = null;
          currentToken = tok;
        } else if (i >= 7) {
          status = 'waiting';
          calls = 0;
          closedAt = null;
          firstCalledAt = null;
          waitingOrder.push(tok);
        }

        tickets[tok] = {
          token: tok,
          no: num,
          seq: i,
          serviceDate,
          servicePoint: config.servicePoint || 'Counter 1',
          status,
          issuedAt: nowIso,
          firstCalledAt,
          lastCalledAt: firstCalledAt,
          calls,
          closedAt
        };
      }
    } else if (scenarioName === 'end_of_day') {
      counter = 20;
      for (let i = 1; i <= 20; i++) {
        const tok = generateUuid();
        const num = `${prefix}${String(i).padStart(3, '0')}`;
        tickets[tok] = {
          token: tok,
          no: num,
          seq: i,
          serviceDate,
          servicePoint: config.servicePoint || 'Counter 1',
          status: 'served',
          issuedAt: nowIso,
          firstCalledAt: nowIso,
          lastCalledAt: nowIso,
          calls: 1,
          closedAt: nowIso
        };
      }
    } else {
      // Empty day
      counter = 0;
      currentToken = null;
      waitingOrder = [];
    }

    const state = {
      v: 1,
      rev: Date.now(),
      serviceDate,
      counter,
      currentToken,
      waitingOrder,
      tickets
    };
    storageSet(KEY_STATE, JSON.stringify(state));

    const event = {
      v: 1,
      id: Date.now(),
      type: 'reset',
      token: null,
      no: null,
      at: nowIso
    };
    broadcastEvent(event);

    const snapshot = getSnapshot();
    notifySubscribers(snapshot, event);
    return snapshot;
  },
  addWaiting: (count = 1) => {
    const config = getConfig();
    const currentSim = getSim();
    const now = getNowDate(currentSim.clockOffsetMs);
    const nowIso = now.toISOString();
    const state = loadStateRaw();
    checkAndApplyDailyReset(state, now, config);
    const prefix = config.prefix || 'A';

    let lastToken = null;
    for (let c = 0; c < count; c++) {
      state.counter = (state.counter || 0) + 1;
      const tok = generateUuid();
      lastToken = tok;
      const num = `${prefix}${String(state.counter).padStart(3, '0')}`;
      state.tickets[tok] = {
        token: tok,
        no: num,
        seq: state.counter,
        serviceDate: state.serviceDate,
        servicePoint: config.servicePoint || 'Counter 1',
        status: 'waiting',
        issuedAt: nowIso,
        firstCalledAt: null,
        lastCalledAt: null,
        calls: 0,
        closedAt: null
      };
      state.waitingOrder.push(tok);
    }

    state.rev = (state.rev || 0) + 1;
    storageSet(KEY_STATE, JSON.stringify(state));

    const event = {
      v: 1,
      id: Date.now(),
      type: 'issued',
      token: lastToken,
      no: state.tickets[lastToken].no,
      at: nowIso
    };
    broadcastEvent(event);

    const snapshot = getSnapshot();
    notifySubscribers(snapshot, event);
    return { lastToken, snapshot };
  },
  resetToday: () => {
    const config = getConfig();
    const currentSim = getSim();
    const now = getNowDate(currentSim.clockOffsetMs);
    const nowIso = now.toISOString();
    const state = loadStateRaw();
    checkAndApplyDailyReset(state, now, config);

    state.counter = 0;
    state.currentToken = null;
    state.waitingOrder = [];
    state.rev = (state.rev || 0) + 1;

    storageSet(KEY_STATE, JSON.stringify(state));

    const event = {
      v: 1,
      id: Date.now(),
      type: 'reset',
      token: null,
      no: null,
      at: nowIso
    };
    broadcastEvent(event);

    const snapshot = getSnapshot();
    notifySubscribers(snapshot, event);
    return snapshot;
  },
  clearAll: () => {
    storageRemove(KEY_CONFIG);
    storageRemove(KEY_STATE);
    storageRemove(KEY_EVENT);
    storageRemove(KEY_SIM);
    const snapshot = getSnapshot();
    notifySubscribers(snapshot, { v: 1, id: Date.now(), type: 'reset', at: new Date().toISOString() });
    return snapshot;
  },
  exportJson: () => {
    return {
      [KEY_CONFIG]: getConfig(),
      [KEY_STATE]: loadStateRaw(),
      [KEY_SIM]: getSim(),
      [KEY_EVENT]: (() => {
        try {
          return JSON.parse(storageGet(KEY_EVENT) || '{}');
        } catch (e) {
          return {};
        }
      })()
    };
  },
  importJson: (input) => {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    if (data[KEY_CONFIG]) storageSet(KEY_CONFIG, JSON.stringify(data[KEY_CONFIG]));
    if (data[KEY_STATE]) storageSet(KEY_STATE, JSON.stringify(data[KEY_STATE]));
    if (data[KEY_SIM]) storageSet(KEY_SIM, JSON.stringify(data[KEY_SIM]));
    if (data[KEY_EVENT]) storageSet(KEY_EVENT, JSON.stringify(data[KEY_EVENT]));
    const snapshot = getSnapshot();
    notifySubscribers(snapshot, { v: 1, id: Date.now(), type: 'reset', at: new Date().toISOString() });
    return snapshot;
  }
};
