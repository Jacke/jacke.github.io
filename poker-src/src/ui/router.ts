/**
 * Hash-based router for the iamjacke casino app.
 *
 * Why hash routing:
 *   - Works against any static file server (python -m http.server, Hugo,
 *     GitHub Pages). No server-side rewrite rules needed.
 *   - URLs are bookmarkable and update the browser history, so back/
 *     forward navigation works naturally.
 *   - Adding a new game kind is a one-line entry in ROUTES + a handler.
 *
 * Route structure:
 *   #/                → casino landing (default game picker)
 *   #/poker           → poker landing (currently the default screen)
 *   #/blackjack       → blackjack table
 *   #/blackjack/help  → blackjack help overlay (language follows getLang())
 *
 * Adding a new game (e.g. roulette):
 *   1. Add `'#/roulette'` to the Route type union below.
 *   2. Register a handler via `router.on('#/roulette', () => startRoulette())`.
 *   3. Wire a UI button with `navigateTo('#/roulette')`.
 */

export type Route =
  | '#/'
  | '#/poker'
  | '#/blackjack'
  | '#/blackjack/help';

/** The shape of a route handler. Called every time the route matches. */
export type RouteHandler = (params: URLSearchParams) => void;

interface RouterState {
  handlers: Map<string, RouteHandler>;
  /** Called for any unmatched route — typically redirects to '#/'. */
  fallback: RouteHandler | null;
}

const state: RouterState = {
  handlers: new Map(),
  fallback: null,
};

/** Register a handler for a route. Replaces any existing handler. */
export function on(route: Route | string, handler: RouteHandler): void {
  state.handlers.set(normalize(route), handler);
}

/** Register a fallback handler for unmatched routes. */
export function onFallback(handler: RouteHandler): void {
  state.fallback = handler;
}

/** Programmatically navigate to a route. Updates location.hash, which
 *  fires `hashchange` → dispatch() runs the handler. */
export function navigateTo(route: Route | string, opts: { replace?: boolean } = {}): void {
  const next = normalize(route);
  // Encode the hash directly — browsers split location.hash on '?' cleanly.
  if (opts.replace && 'replaceState' in history) {
    history.replaceState(null, '', `#${next}`);
    dispatch();
  } else {
    // Setting location.hash triggers the hashchange event listener.
    const current = location.hash.replace(/^#/, '') || '/';
    if (normalize(current) === next) {
      // Same route — force a dispatch so callers don't silently drop.
      dispatch();
    } else {
      location.hash = next;
    }
  }
}

/** Read the current route from location.hash. Defaults to '/'. */
export function currentRoute(): string {
  const raw = location.hash.replace(/^#/, '') || '/';
  return normalize(raw);
}

/** Parse query parameters from the current hash. */
export function currentParams(): URLSearchParams {
  const raw = location.hash.replace(/^#/, '');
  const qIdx = raw.indexOf('?');
  if (qIdx < 0) return new URLSearchParams();
  return new URLSearchParams(raw.slice(qIdx + 1));
}

/** Install the hashchange listener + run the initial dispatch. */
export function initRouter(): void {
  window.addEventListener('hashchange', dispatch);
  dispatch();
}

// ═══════════════════════════════════════════════════════════════════════
// Internals
// ═══════════════════════════════════════════════════════════════════════

function normalize(route: string): string {
  // Strip leading '#', trailing slash (except root), fold double slashes.
  let r = route.replace(/^#/, '').replace(/\/+/g, '/');
  // Strip query string for the path part — params are handled separately.
  const qIdx = r.indexOf('?');
  if (qIdx >= 0) r = r.slice(0, qIdx);
  if (!r.startsWith('/')) r = '/' + r;
  // Strip trailing slash unless it's the root.
  if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r;
}

function dispatch(): void {
  const route = currentRoute();
  const params = currentParams();
  const handler = state.handlers.get(route);
  if (handler) {
    handler(params);
    return;
  }
  if (state.fallback) {
    state.fallback(params);
  }
}
