import { KiroNativeSessionService } from '../kiro/KiroNativeSessionService.js';
import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
} from './types.js';

const ANSI_RE = /\x1b(?:\[[0-9;?]*[A-Za-z]|][^\u0007]*(?:\u0007|\x1b\\)|[()][AB012])/g;
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

export class KiroProvider implements Provider {
  name = 'kiro';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: true };

  private pendingPrompt: string | null = null;
  private sawText = false;
  private readonly native: KiroNativeSessionService;

  constructor(native: KiroNativeSessionService) {
    this.native = native;
  }

  prepareEphemeralTurn(content: string): void {
    this.pendingPrompt = content;
    this.sawText = false;
  }

  async beforeTurn(opts: ProviderSpawnOptions): Promise<void> {
    if (!opts.resumeSessionId) return;

    const canResume = await this.native.canResumeSession(opts.cwd, opts.resumeSessionId);
    if (!canResume) {
      throw new Error(
        'Kiro can only resume the most recent session in a workspace. '
        + 'This session is no longer the latest one for its directory.',
      );
    }
  }

  async afterTurn(opts: ProviderSpawnOptions): Promise<StreamEvent | null> {
    const latest = await this.native.getLatestSession(opts.cwd);
    if (!latest) return null;

    return {
      type: 'result',
      sessionId: latest.providerSessionId,
    };
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = [
      'chat',
      '--no-interactive',
      '--wrap',
      'never',
    ];

    if (opts.model) {
      args.push('--model', opts.model);
    }

    if (opts.permissionMode === 'skip') {
      args.push('--trust-all-tools');
    } else if (opts.permissionMode === 'whitelist') {
      args.push(`--trust-tools=${(opts.allowedTools || []).join(',')}`);
    }

    if (opts.resumeSessionId) {
      args.push('--resume');
    }

    if (this.pendingPrompt) {
      args.push(this.pendingPrompt);
      this.pendingPrompt = null;
    }

    return args;
  }

  buildStdinMessage(_content: string): string {
    return '';
  }

  parseStreamLine(line: string): StreamEvent | null {
    const clean = sanitizeOutput(line);
    if (!clean) return null;

    let text = clean;
    if (!this.sawText) {
      text = text.replace(/^>\s*/, '');
      this.sawText = true;
    }

    if (!text.trim()) return null;
    return { type: 'text', text: `${text}\n` };
  }
}

function sanitizeOutput(text: string): string {
  return text
    .replace(ANSI_RE, '')
    .replace(CONTROL_RE, '')
    .trimEnd();
}
