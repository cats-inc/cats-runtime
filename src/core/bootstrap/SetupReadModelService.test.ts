import { describe, expect, it } from 'vitest';
import { SetupReadModelService } from './SetupReadModelService.js';
import type { BootstrapScanResult } from './BootstrapService.js';
import type { ProviderSelectionSnapshot } from './ProviderSelectionService.js';

function readModel(selection: ProviderSelectionSnapshot, scan: BootstrapScanResult | null = null) {
  return new SetupReadModelService({
    bootstrapRequired: selection.state === 'missing' || selection.state === 'invalid',
    bootstrapService: {
      getSelection: () => selection,
      getSetupState: async () => ({ status: 'pending', lastScanAt: null, lastManualScanAt: null,
        appliedAt: null, appliedConfigPath: null, error: null }),
      getLatestScan: async () => scan,
      getLatestManualScan: async () => scan?.scanType === 'manual' ? scan : null,
      getProviderUniverse: () => [],
    },
  }).read();
}
const empty = { state: 'empty' as const, revision: 'empty', targets: [], nativeSetupTargets: [], diskChanged: false, error: null };

describe('selection-first setup guidance', () => {
  it('requires selection before detection and permits idle setup', async () => {
    const missing = await readModel({ ...empty, state: 'missing', revision: 'missing', targets: [] });
    expect(missing.repair.status).toBe('selection_required');
    expect(missing.repair.nextAction.kind).toBe('manage_selection');
    expect(missing.repair.actions.some((action) => action.kind === 'run_manual_scan')).toBe(false);
    const idle = await readModel({ ...empty, targets: [] });
    expect(idle.bootstrapRequired).toBe(false);
    expect(idle.repair.status).toBe('ready');
  });

  it('does not derive selection or apply actions from provider availability', async () => {
    const targets = [{ provider: 'claude', backend: 'cli' as const, instance: 'native' }];
    const data = await readModel({ ...empty, state: 'selected', targets }, {
      revision: empty.revision, scannedAt: new Date().toISOString(), scanType: 'manual',
      providers: [{ ...targets[0]!, family: 'Claude', available: false, commandStatus: 'missing_install',
        commandPath: null, version: null, authStatus: 'unknown', install: null, remediation: [] }],
    });
    expect(data.selection.targets).toEqual(targets);
    expect(data.repair.status).toBe('attention_required');
    expect(data.repair.preferredScan.source).toBe('manualScan');
    expect(data.repair.providersReady).toEqual([]);
    expect(data.repair.actions.some((action) => action.path === '/setup-apply')).toBe(false);
    expect(data.repair.actions.find((action) => action.kind === 'generate_setup_report')?.body).toEqual({ refreshScan: false });
  });
});
