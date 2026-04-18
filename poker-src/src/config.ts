/**
 * Client-side config — the one place a URL, flag or tunable lives.
 *
 * Every value defaults to something that works in prod (iamjacke.com)
 * but can be overridden by a `localStorage` key so developers can point
 * the client at a local server without rebuilding. Reads are defensive:
 * if `localStorage` is unavailable (SSR, private tab quirks) the value
 * falls through to the default.
 *
 * Used by:
 *   - WebSocketTransport (serverUrl)
 *   - Identity persistence (not strictly config, but same "one knob" feel)
 */

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

/** Runtime-overridable knobs. Mutate via localStorage in devtools. */
export const clientConfig = {
  /**
   * WebSocket URL for the matchmaking + relay server. In prod this points
   * at the Docker deployment; for local dev set
   * `localStorage.setItem('iamjacke-server-url', 'ws://localhost:3001/ws')`
   * and reload.
   */
  get serverUrl(): string {
    return lsGet('iamjacke-server-url') ?? 'wss://iamjacke.com/ws';
  },

  /** Whether to offer "FIND MATCH" UI at all. Hides the button in dev builds
   *  if someone wants the legacy P2P-only experience. */
  get matchmakingEnabled(): boolean {
    return lsGet('iamjacke-matchmaking-disabled') !== '1';
  },
} as const;
