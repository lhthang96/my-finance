// Browser side of Web Push: service worker registration, permission, subscribe/unsubscribe, test sends.

export type PushStatus = 'unsupported' | 'needs-install' | 'denied' | 'subscribed' | 'unsubscribed';

function isIosDevice(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports a desktop Mac user agent, so also check for touch points.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

const RELOAD_GUARD_KEY = 'mf-sw-reloaded-at';
const RELOAD_GUARD_MS = 30_000;

/** Reloads once when a new service worker takes control. The guard stops a reload loop. */
function reloadOnControllerChange(hadController: boolean): void {
  if (!hadController) return; // first install: nothing stale is on screen
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? '0');
      if (Date.now() - last < RELOAD_GUARD_MS) return;
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    } catch {
      // Storage unavailable: reload anyway, the page only reloads on a real controller change.
    }
    window.location.reload();
  });
}

/** Registers /sw.js. A waiting worker is activated at once (SKIP_WAITING), then the page reloads once. */
export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const hadController = navigator.serviceWorker.controller !== null;
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    reloadOnControllerChange(hadController);

    const activate = (worker: ServiceWorker | null) => {
      if (worker && navigator.serviceWorker.controller) worker.postMessage({ type: 'SKIP_WAITING' });
    };
    if (reg.waiting) activate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed') activate(installing);
      });
    });
  } catch (err) {
    console.warn('Service worker registration failed', err);
  }
}

export async function getPushStatus(): Promise<PushStatus> {
  if (isIosDevice() && !isStandalone()) return 'needs-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'subscribed' : 'unsubscribed';
}

/** Base64url (VAPID public key) to the Uint8Array that PushManager.subscribe expects. */
function urlBase64ToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Asks for permission, subscribes with the server's VAPID key and stores the subscription. Returns true on success. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const keyRes = await fetch('/api/push/public-key', { credentials: 'same-origin' });
  if (!keyRes.ok) return false;
  const { publicKey } = (await keyRes.json()) as { publicKey: string };

  const reg = await navigator.serviceWorker.ready;
  // A subscription made with a different key cannot be reused: drop it on both sides first.
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    await postJson('/api/push/unsubscribe', { endpoint: existing.endpoint });
    await existing.unsubscribe();
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToBytes(publicKey),
  });
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
  const res = await postJson('/api/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
  return res.ok;
}

/** Removes the server-side subscription and unsubscribes in the browser. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await postJson('/api/push/unsubscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

/** Asks the server to send a test notification to every subscription. */
export async function sendTestPush(): Promise<void> {
  const res = await postJson('/api/push/test', {});
  if (!res.ok) throw new Error(`Test push failed (${res.status})`);
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
