// Common UI utilities, escaping, clock, QR rendering, and event delegation

export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getSimulatedDate(offsetMs = 0) {
  return new Date(Date.now() + (offsetMs || 0));
}

export function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function startClock(target, getOffsetMs = () => 0) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) return () => {};
  const update = () => {
    const d = getSimulatedDate(getOffsetMs());
    el.textContent = `${formatDate(d)} ${formatTime(d)}`;
  };
  update();
  const timer = setInterval(update, 1000);
  return () => clearInterval(timer);
}

export function renderQr(container, text) {
  if (!container) return;
  if (typeof window.qrcode !== 'function') {
    container.innerHTML = `<div class="badge badge-warn">QR generator unavailable</div>`;
    return;
  }
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    container.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (err) {
    container.innerHTML = `<div class="badge badge-err">QR error: ${esc(err.message)}</div>`;
  }
}

export function delegate(element, eventType, selector, handler) {
  element.addEventListener(eventType, (e) => {
    const match = e.target.closest(selector);
    if (match && element.contains(match)) {
      handler(e, match);
    }
  });
}
