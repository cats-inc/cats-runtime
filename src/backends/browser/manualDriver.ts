import type {
  RuntimeBrowserDriver,
  RuntimeBrowserDriverClosePageInput,
  RuntimeBrowserDriverNavigatePageInput,
  RuntimeBrowserDriverOpenPageInput,
} from '../../core/browser/driver.js';
import type { RuntimeBrowserDriverDescriptor } from '../../core/types.js';

export class ManualBrowserDriver implements RuntimeBrowserDriver {
  readonly descriptor: RuntimeBrowserDriverDescriptor = {
    id: 'manual',
    kind: 'manual',
    status: 'ready',
    title: 'Manual Browser Driver',
    summary: 'Registers previewable pages and URLs without owning a real browser process.',
    capabilities: {
      persistentSessions: true,
      manualUrlEntry: true,
      serviceBindings: true,
      artifactBindings: true,
      liveAutomation: false,
    },
    warnings: [
      'This driver does not launch or automate a browser. It only records runtime-owned page metadata.',
    ],
  };

  async createSession(): Promise<{ metadata: Record<string, unknown> }> {
    return {
      metadata: {
        mode: 'manual',
      },
    };
  }

  async openPage(
    input: RuntimeBrowserDriverOpenPageInput,
  ): Promise<{ title?: string; metadata: Record<string, unknown> }> {
    return {
      ...(input.target.title ? { title: input.target.title } : {}),
      metadata: {
        mode: 'manual',
        bindingKind: input.target.binding.kind,
        ...(input.target.metadata ? { targetMetadata: input.target.metadata } : {}),
      },
    };
  }

  async closeSession(): Promise<void> {
    // Manual sessions do not own external resources yet.
  }

  async closePage(_input: RuntimeBrowserDriverClosePageInput): Promise<void> {
    // Manual pages do not own external resources yet.
  }

  async navigatePage(
    input: RuntimeBrowserDriverNavigatePageInput,
  ): Promise<{ title?: string; metadata: Record<string, unknown> }> {
    return {
      ...(input.target.title ? { title: input.target.title } : {}),
      metadata: {
        mode: 'manual',
        bindingKind: input.target.binding.kind,
        ...(input.target.metadata ? { targetMetadata: input.target.metadata } : {}),
      },
    };
  }
}
