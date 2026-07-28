import { useSyncExternalStore } from 'react';

// ponytail: ~20 lines of History API instead of react-router. Four flat routes,
// one optional param, no loaders/nested layouts/blockers. Swap in react-router
// the day any of those appear.

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

export function usePath(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => '/',
  );
}

export function navigate(to: string): void {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export type Route =
  | { name: 'landing' }
  | { name: 'host' }
  | { name: 'join'; code?: string }
  | { name: 'table' };

export function matchRoute(pathname: string): Route {
  const join = /^\/join(?:\/([^/]+))?\/?$/.exec(pathname);
  if (join) return { name: 'join', code: join[1] };
  if (/^\/host\/?$/.test(pathname)) return { name: 'host' };
  if (/^\/table\/?$/.test(pathname)) return { name: 'table' };
  return { name: 'landing' };
}
