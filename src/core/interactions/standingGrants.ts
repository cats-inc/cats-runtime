import type { GrantCategory, InteractionAnswer, StandingGrant } from './types.js';

type Standing = NonNullable<InteractionAnswer['standingGrant']>;

/**
 * ADR-055: the owner's standing approvals for one Runtime session. Memory-only and kept across
 * worker respawns of that session; a Runtime restart, a revoke or the session's removal ends them.
 * A grant covers one category, so approving computer use never approves a shell command.
 */
export class StandingGrants {
  private readonly grants = new Map<GrantCategory, { until: Standing['until']; grantedAt: number; expiresAt?: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  add(category: GrantCategory, standing: Standing): void {
    const at = this.now();
    this.grants.set(category, standing.until === 'session'
      ? { until: 'session', grantedAt: at }
      : { until: 'time', grantedAt: at, expiresAt: at + standing.durationMs });
  }

  covers(category: GrantCategory): boolean {
    this.prune();
    return this.grants.has(category);
  }

  list(): StandingGrant[] {
    this.prune();
    return [...this.grants.entries()].map(([category, grant]) => ({ category, until: grant.until,
      grantedAt: new Date(grant.grantedAt).toISOString(),
      ...(grant.expiresAt !== undefined ? { expiresAt: new Date(grant.expiresAt).toISOString() } : {}) }));
  }

  /** Ends one category, or every grant. Returns whether anything was in force. */
  revoke(category?: GrantCategory): boolean {
    this.prune();
    if (category) return this.grants.delete(category);
    const had = this.grants.size > 0;
    this.grants.clear();
    return had;
  }

  private prune(): void {
    const at = this.now();
    for (const [category, grant] of this.grants) if (grant.expiresAt !== undefined && grant.expiresAt <= at) this.grants.delete(category);
  }
}
