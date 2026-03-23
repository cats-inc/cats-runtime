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

export interface RuntimeBrowserDriver {
  readonly descriptor: RuntimeBrowserDriverDescriptor;
  createSession(input: {
    browserSessionId: string;
    runtimeSessionId?: string;
    label?: string;
    metadata?: Record<string, unknown>;
  }): Promise<RuntimeBrowserDriverSessionState>;
  openPage(input: {
    browserSessionId: string;
    browserPageId: string;
    target: RuntimeBrowserPageTarget;
  }): Promise<RuntimeBrowserDriverPageState>;
  closeSession(input: {
    browserSessionId: string;
  }): Promise<void>;
}
