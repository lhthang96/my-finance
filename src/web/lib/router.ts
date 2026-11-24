// Minimal hash router: the current path is the part of location.hash after '#', e.g. '#/spend' -> '/spend'.
import { useSyncExternalStore } from 'react';

export function currentHashPath(): string {
  const raw = window.location.hash.replace(/^#/, '').split('?')[0];
  if (!raw) return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useHashPath(): string {
  return useSyncExternalStore(subscribe, currentHashPath, () => '/');
}

export function navigate(path: string): void {
  window.location.hash = path;
}
