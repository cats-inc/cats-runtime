import { describe, expect, it } from 'vitest';
import {
  SHARED_TOKENS_CSS,
  PROVIDER_BADGE_CSS,
  SHARED_UI_SCRIPT,
} from '../src/http/ui/shared.js';

describe('shared tokens CSS', () => {
  it('contains core design token custom properties', () => {
    expect(SHARED_TOKENS_CSS).toContain('--bg:');
    expect(SHARED_TOKENS_CSS).toContain('--surface:');
    expect(SHARED_TOKENS_CSS).toContain('--surface2:');
    expect(SHARED_TOKENS_CSS).toContain('--border:');
    expect(SHARED_TOKENS_CSS).toContain('--text:');
    expect(SHARED_TOKENS_CSS).toContain('--text2:');
    expect(SHARED_TOKENS_CSS).toContain('--accent:');
    expect(SHARED_TOKENS_CSS).toContain('--green:');
    expect(SHARED_TOKENS_CSS).toContain('--yellow:');
    expect(SHARED_TOKENS_CSS).toContain('--red:');
    expect(SHARED_TOKENS_CSS).toContain('--orange:');
    expect(SHARED_TOKENS_CSS).toContain('--radius:');
  });

  it('contains all provider color custom properties', () => {
    const providers = [
      'auggie', 'claude', 'codex', 'copilot', 'cursorp',
      'gemini', 'kiro', 'opencode', 'pi', 'goose', 'junie',
    ];
    for (const p of providers) {
      expect(SHARED_TOKENS_CSS).toContain(`--${p}:`);
    }
  });
});

describe('provider badge CSS', () => {
  it('contains badge rules for all known providers', () => {
    const providers = [
      'claude', 'codex', 'copilot', 'cursor', 'gemini',
      'kiro', 'auggie', 'opencode', 'pi', 'goose', 'junie', 'ollama',
    ];
    for (const p of providers) {
      expect(PROVIDER_BADGE_CSS).toContain(`[data-p="${p}"]`);
    }
  });

  it('contains base .provider-badge class', () => {
    expect(PROVIDER_BADGE_CSS).toContain('.provider-badge {');
  });

  it('contains status badge classes', () => {
    expect(PROVIDER_BADGE_CSS).toContain('.status-badge-ok');
    expect(PROVIDER_BADGE_CSS).toContain('.status-badge-ready');
    expect(PROVIDER_BADGE_CSS).toContain('.status-badge-degraded');
    expect(PROVIDER_BADGE_CSS).toContain('.status-badge-bootstrap');
    expect(PROVIDER_BADGE_CSS).toContain('.status-badge-unavailable');
    expect(PROVIDER_BADGE_CSS).toContain('.status-badge-unknown');
  });
});

describe('shared UI script', () => {
  it('registers CatsUI on window', () => {
    expect(SHARED_UI_SCRIPT).toContain('window.CatsUI');
  });

  it('exports expected helper functions', () => {
    expect(SHARED_UI_SCRIPT).toContain('getApiKey');
    expect(SHARED_UI_SCRIPT).toContain('authHeaders');
    expect(SHARED_UI_SCRIPT).toContain('apiFetch');
    expect(SHARED_UI_SCRIPT).toContain('renderProviderBadge');
    expect(SHARED_UI_SCRIPT).toContain('renderStatusBadge');
  });

  it('is an IIFE', () => {
    expect(SHARED_UI_SCRIPT).toMatch(/^\(function\(\)/);
    expect(SHARED_UI_SCRIPT).toMatch(/\}\)\(\);$/);
  });
});
