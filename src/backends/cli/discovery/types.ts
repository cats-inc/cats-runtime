export interface DiscoveredSession {
  providerSessionId: string;
  projectPath: string;
  sourcePath: string;
  cwd: string;
  summary?: string;
  messageCount?: number;
  lastActivity?: string;
  model?: string;
}

export interface SessionIndexEntry {
  session_id: string;
  summary?: string;
  last_message_at?: string;
  message_count?: number;
  model?: string;
  cwd?: string;
  branches?: string[];
}

export interface SessionsIndex {
  [sessionId: string]: SessionIndexEntry;
}
