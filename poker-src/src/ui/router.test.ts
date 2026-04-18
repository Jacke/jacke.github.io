/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initRouter, on, onFallback, navigateTo, currentRoute, currentParams } from './router.js';

beforeEach(() => {
  // Reset hash between tests so route state doesn't leak.
  location.hash = '';
});

describe('router', () => {
  it('normalizes trailing slashes', () => {
    location.hash = '#/blackjack/';
    expect(currentRoute()).toBe('/blackjack');
  });

  it('normalizes missing leading slash', () => {
    location.hash = '#blackjack';
    expect(currentRoute()).toBe('/blackjack');
  });

  it('defaults empty hash to root', () => {
    location.hash = '';
    expect(currentRoute()).toBe('/');
  });

  it('strips query string from the path', () => {
    location.hash = '#/blackjack?bet=100';
    expect(currentRoute()).toBe('/blackjack');
  });

  it('parses query parameters', () => {
    location.hash = '#/blackjack?bet=100&auto=1';
    const params = currentParams();
    expect(params.get('bet')).toBe('100');
    expect(params.get('auto')).toBe('1');
  });

  it('fires a handler on navigateTo', async () => {
    const spy = vi.fn();
    on('#/blackjack', spy);
    initRouter();
    navigateTo('#/blackjack');
    // hashchange is async in jsdom — give it a tick
    await new Promise(r => setTimeout(r, 0));
    expect(spy).toHaveBeenCalled();
  });

  it('fires a handler on direct hash edit', async () => {
    const spy = vi.fn();
    on('#/poker', spy);
    initRouter();
    location.hash = '#/poker';
    await new Promise(r => setTimeout(r, 0));
    expect(spy).toHaveBeenCalled();
  });

  it('runs the fallback for unmatched routes', async () => {
    const fb = vi.fn();
    onFallback(fb);
    initRouter();
    location.hash = '#/nonexistent';
    await new Promise(r => setTimeout(r, 0));
    expect(fb).toHaveBeenCalled();
  });
});
