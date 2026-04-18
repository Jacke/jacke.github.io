/**
 * Chat panel — small DOM controller for a floating P2P chat.
 *
 * Mounts to `#chat-panel` (element exists statically in index.html, hidden
 * by default). Shows one row per `ChatMessage` in a scrollable history,
 * with an input at the bottom that calls a `send` callback on Enter.
 *
 * The panel is visibility-toggled by a `.chat-open` class on `<body>` so
 * callers control when it appears — typically on every PvP screen.
 */

import type { ChatMessage } from '../protocol/messages.js';
import { maybe$ } from './dom.js';

export interface ChatPanelHandlers {
  /** Called when the user hits Enter. Return false to keep the text in the input. */
  onSend: (text: string) => boolean;
}

let handlers: ChatPanelHandlers | null = null;
let wired = false;

/** Mount DOM listeners once. Idempotent. */
export function initChatPanel(h: ChatPanelHandlers): void {
  handlers = h;
  if (wired) return;
  wired = true;

  const input = maybe$('chat-input') as HTMLInputElement | null;
  const sendBtn = maybe$('chat-send') as HTMLButtonElement | null;
  const toggleBtn = maybe$('chat-toggle');

  const fireSend = () => {
    if (!input || !handlers) return;
    const text = input.value.trim();
    if (!text || text.length > 500) return;
    const ok = handlers.onSend(text);
    if (ok) {
      input.value = '';
      input.focus();
    }
  };

  input?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      fireSend();
    }
  });
  sendBtn?.addEventListener('click', fireSend);
  toggleBtn?.addEventListener('click', () => {
    document.body.classList.toggle('chat-collapsed');
  });
}

/** Show / hide the chat panel entirely (e.g. only during PvP). */
export function showChatPanel(show: boolean): void {
  if (show) document.body.classList.add('chat-open');
  else document.body.classList.remove('chat-open');
}

/**
 * Toggle the chat panel between live (pvp) and read-only (bot) modes.
 * In read-only mode the input is disabled and shows a placeholder hint
 * but the history stays readable.
 */
export function setChatMode(mode: 'pvp' | 'bot'): void {
  const input = maybe$('chat-input') as HTMLInputElement | null;
  const sendBtn = maybe$('chat-send') as HTMLButtonElement | null;
  const panel = maybe$('chat-panel');
  if (!input || !sendBtn) return;
  if (mode === 'pvp') {
    input.disabled = false;
    sendBtn.disabled = false;
    input.placeholder = 'Type…';
    panel?.classList.remove('chat-readonly');
  } else {
    input.disabled = true;
    sendBtn.disabled = true;
    input.placeholder = 'Chat is multiplayer only';
    panel?.classList.add('chat-readonly');
  }
}

/** Append a single message to the history view. */
export function appendChatMessage(
  msg: ChatMessage,
  opts: { mine?: boolean } = {},
): void {
  const hist = maybe$('chat-history');
  if (!hist) return;
  const row = document.createElement('div');
  row.className = 'chat-row' + (opts.mine ? ' chat-row-mine' : '');
  const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  row.innerHTML = `
    <div class="chat-meta">
      <span class="chat-from">${escapeHtml(msg.from)}</span>
      <span class="chat-ts">${time}</span>
    </div>
    <div class="chat-text">${escapeHtml(msg.text)}</div>
  `;
  hist.appendChild(row);
  hist.scrollTop = hist.scrollHeight;
  // Unread indicator if the panel is collapsed.
  if (document.body.classList.contains('chat-collapsed') && !opts.mine) {
    const dot = maybe$('chat-unread');
    if (dot) dot.classList.add('visible');
  }
}

/** Wipe the history DOM (not the log storage). Used when switching sessions. */
export function clearChatHistory(): void {
  const hist = maybe$('chat-history');
  if (hist) hist.innerHTML = '';
  const dot = maybe$('chat-unread');
  dot?.classList.remove('visible');
}

/** Add a system line (local only, not sent over the wire). */
export function appendChatSystem(text: string): void {
  const hist = maybe$('chat-history');
  if (!hist) return;
  const row = document.createElement('div');
  row.className = 'chat-row chat-row-system';
  row.innerHTML = `<div class="chat-text">${escapeHtml(text)}</div>`;
  hist.appendChild(row);
  hist.scrollTop = hist.scrollHeight;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
