import { AuggieSessionService } from '../auggie/AuggieSessionService.js';
import type { DiscoveredSession } from './types.js';

export class AuggieSessionScanner {
  constructor(private readonly sessions: AuggieSessionService) {}

  async scan(): Promise<DiscoveredSession[]> {
    const discovered = await this.sessions.listAllSessions();
    return discovered.map((session) => ({
      providerSessionId: session.providerSessionId,
      projectPath: session.cwd,
      sourcePath: session.sourcePath,
      cwd: session.cwd,
      summary: session.summary,
      messageCount: session.messageCount,
      lastActivity: session.lastActivity,
      model: session.model,
    }));
  }
}
