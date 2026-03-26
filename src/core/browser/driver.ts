import type { RuntimeBrowserDriverDescriptor, RuntimeBrowserPageBinding } from '../types.js';

export interface RuntimeBrowserPageTarget {
  label?: string;
  title?: string;
  url?: string;
  path?: string;
  mediaType?: string;
  binding: RuntimeBrowserPageBinding;
  metadata?: Record<string, unknown>;
}

export interface RuntimeBrowserDriverSessionState {
  driverSessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeBrowserDriverPageState {
  driverPageId?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeBrowserDriverCreateSessionInput {
  browserSessionId: string;
  runtimeSessionId?: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeBrowserDriverOpenPageInput {
  browserSessionId: string;
  browserPageId: string;
  target: RuntimeBrowserPageTarget;
}

export interface RuntimeBrowserDriverClosePageInput {
  browserSessionId: string;
  browserPageId: string;
}

export interface RuntimeBrowserDriverCloseSessionInput {
  browserSessionId: string;
}

export interface RuntimeBrowserDriver {
  readonly descriptor: RuntimeBrowserDriverDescriptor;
  createSession(input: RuntimeBrowserDriverCreateSessionInput): Promise<RuntimeBrowserDriverSessionState>;
  openPage(input: RuntimeBrowserDriverOpenPageInput): Promise<RuntimeBrowserDriverPageState>;
  closePage?(input: RuntimeBrowserDriverClosePageInput): Promise<void>;
  closeSession(input: RuntimeBrowserDriverCloseSessionInput): Promise<void>;
}
