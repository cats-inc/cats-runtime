import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const targets = ['claude', 'codex', 'pi'].map((provider) => ({ provider, backend: 'cli', instance: 'native' }));
const key = (target: typeof targets[number]) => JSON.stringify([target.provider, target.backend, target.instance]);

// The built page's actual script drives these small DOM doubles. Network gates
// let tests observe saving/detecting states without timers or real providers.
class ElementDouble {
  value = '';
  checked = false;
  disabled = false;
  hidden = false;
  indeterminate = false;
  innerHTML = '';
  textContent = '';
  className = '';
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children = new Map<string, ElementDouble>();
  classes = new Set<string>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, on: boolean) => on ? this.classes.add(name) : this.classes.delete(name),
  };
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  addEventListener() {}
  querySelector(selector: string): ElementDouble {
    if (!this.children.has(selector)) this.children.set(selector, new ElementDouble());
    return this.children.get(selector)!;
  }
  closest(selector: string) { return this.querySelector(selector); }
}

function state(selected = targets.slice(0, 1), revision = 'r1', bootstrapRequired = false) {
  return {
    bootstrapRequired,
    selection: { revision, targets: selected, diskChanged: false },
    universe: targets.map((target) => ({ ...target, familyLabel: target.provider, binaryName: target.provider })),
    observations: [] as ReturnType<typeof observation>[],
    state: { status: 'applied' },
    scan: null,
  };
}

function observation(target = targets[0]) {
  return { ...target, family: target.provider, commandStatus: 'ready', available: true,
    authStatus: 'unknown', remediation: [], observedAt: '2026-09-16T01:00:00.000Z',
    scanType: 'manual', configurationStatus: 'unchanged' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function page(initial: ReturnType<typeof state>, fetcher: (path: string, init?: RequestInit) => Promise<Response>) {
  const elements = new Map<string, ElementDouble>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, new ElementDouble());
    return elements.get(id)!;
  };
  element('resultPanel').hidden = true;
  const checks = targets.map((target) => {
    const checkbox = new ElementDouble();
    checkbox.value = key(target);
    checkbox.closest('.provider-selection-row').dataset.backend = 'cli';
    return checkbox;
  });
  const apiFetch = vi.fn(fetcher);
  const context = vm.createContext({
    window: { CatsUI: { apiFetch, syncRuntimeBootstrapState: vi.fn() } },
    document: {
      getElementById: element,
      querySelectorAll: (selector: string) => selector === '.provider-check:checked'
        ? checks.filter((checkbox) => checkbox.checked) : selector === '.provider-check' ? checks : [],
      addEventListener() {},
      body: { dataset: { bootstrapRequired: String(initial.bootstrapRequired) } },
    },
    URL, console,
    setTimeout: (callback: () => void) => queueMicrotask(callback),
    initial,
  });
  const html = readFileSync(new URL('../public/provider-setup.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  vm.runInContext(script, context);
  vm.runInContext('loadConfiguredTargetCapabilities = async () => true; applySetupStateReadModel(initial);', context);
  const evaluate = <T = unknown>(code: string): T => vm.runInContext(code, context) as T;
  return { element, checks, apiFetch, context, evaluate,
    update(data: unknown) { context.nextState = data; evaluate('applySetupStateReadModel(nextState)'); } };
}

describe('provider setup interactions', () => {
  it('applies without scanning and retains previous results for unchanged targets', async () => {
    const retained = observation();
    const initial = { ...state(), observations: [retained] };
    const updated = { ...state(targets.slice(0, 2), 'r2'), observations: [retained] };
    const ui = page(initial, async () => Response.json(updated));
    expect(ui.element('detectAfterApplyCheckbox').checked).toBe(false);
    ui.checks[1].checked = true;
    await ui.evaluate<Promise<void>>('applyConfig()');
    expect(ui.apiFetch.mock.calls.map(([path]) => path)).toEqual(['/setup-selection']);
    expect(ui.evaluate('providerDetectionSummary()')).toMatchObject({ installedCount: 1, notDetectedCount: 1 });
    expect(ui.element('providerListItems').innerHTML).toContain('Last detected:');
    expect(ui.element('resultBody').textContent).toContain('No detection was run');
    expect(ui.element('scanBtn').hidden).toBe(false);
    expect(ui.element('openRuntimeLink').hidden).toBe(false);
    expect(ui.checks.every((checkbox) => !checkbox.disabled)).toBe(true);
  });

  it('keeps progress visible through save and detection, then unlocks the completion actions', async () => {
    const save = deferred<Response>();
    const scan = deferred<Response>();
    const updated = state([targets[0]], 'r2');
    const ui = page(state([], 'missing', true), async (path) => path === '/setup-selection'
      ? save.promise : path === '/setup-scan' ? Response.json({}, { status: 202 }) : scan.promise);
    expect(ui.element('detectAfterApplyCheckbox').checked).toBe(true);
    ui.checks[0].checked = true;
    const applying = ui.evaluate<Promise<void>>('applyConfig()');
    expect(ui.element('resultPanel').dataset.variant).toBe('progress');
    expect(ui.element('applyBtn').innerHTML).toContain('Applying');
    save.resolve(Response.json(updated));
    await vi.waitFor(() => expect(ui.element('applyBtn').innerHTML).toContain('Detecting'));
    expect(ui.element('resultPanel').dataset.variant).toBe('progress');
    expect(ui.element('resultSpinner').hidden).toBe(false);
    expect(ui.element('openRuntimeLink').hidden).toBe(true);
    expect(ui.checks[0]).toMatchObject({ checked: true, disabled: true });
    scan.resolve(Response.json({ ...updated, observations: [observation()],
      state: { status: 'ready' }, scan: { revision: 'r2' } }));
    await applying;
    expect(ui.element('resultPanel').dataset.variant).toBe('success');
    expect(ui.element('resultSpinner').hidden).toBe(true);
    expect(ui.element('scanBtn').hidden).toBe(false);
    expect(ui.element('openRuntimeLink').getAttribute('href')).toBe('/dashboard');
    expect(ui.checks.every((checkbox) => !checkbox.disabled)).toBe(true);
  });

  it('retains both completion controls during Detect Again and synchronizes externally changed selection', async () => {
    const scan = deferred<Response>();
    const ui = page(state(targets.slice(0, 2)), async (path) => path === '/setup-scan'
      ? Response.json({}, { status: 202 }) : scan.promise);
    const detecting = ui.evaluate<Promise<void>>('runScan()');
    expect(ui.element('scanBtn').hidden).toBe(false);
    expect(ui.element('scanBtn').innerHTML).toContain('Detecting');
    expect(ui.element('openRuntimeLink').hidden).toBe(false);
    expect(ui.element('openRuntimeLink').getAttribute('aria-disabled')).toBe('true');
    expect(ui.element('openRuntimeLink').getAttribute('href')).toBeNull();
    scan.resolve(Response.json(state([targets[0]], 'r2')));
    await detecting;
    expect(ui.evaluate('currentSelectedProviders()')).toEqual([key(targets[0])]);
    expect(ui.evaluate('providerSelectionSummary().dirty')).toBe(false);
    expect(ui.element('resultPanel').dataset.variant).toBe('attention');
    expect(ui.element('resultTitle').textContent).toBe('Selection changed elsewhere');
    expect(ui.element('openRuntimeLink').getAttribute('href')).toBe('/dashboard');
  });

  it('preserves same-revision drafts but never rebases them silently onto another selection', () => {
    const ui = page(state(targets.slice(0, 2)), async () => { throw new Error('No request expected'); });
    ui.checks[1].checked = false;
    ui.update(state(targets.slice(0, 2)));
    expect(ui.evaluate('currentSelectedProviders()')).toEqual([key(targets[0])]);
    ui.update(state(targets, 'r2'));
    expect(ui.evaluate('currentSelectedProviders()')).toEqual(targets.map(key));
    expect(ui.evaluate('providerSelectionSummary().dirty')).toBe(false);
    expect(ui.element('resultTitle').textContent).toBe('Selection changed elsewhere');
  });

  it.each(['save', 'detect'])('unlocks after a %s failure without claiming detection succeeded', async (failure) => {
    const ui = page(state([], 'missing', true), async (path) => path === '/setup-selection' && failure !== 'save'
      ? Response.json(state([targets[0]], 'r2')) : Response.json({ error: 'fixture failure' }, { status: 500 }));
    ui.checks[0].checked = true;
    await ui.evaluate<Promise<void>>('applyConfig()');
    expect(ui.element('resultPanel').dataset.variant).toBe('error');
    expect(ui.checks[0]).toMatchObject({ checked: true, disabled: false });
    expect(ui.evaluate('selectionOperation')).toBeNull();
    expect(ui.evaluate('latestSetupState.selection.revision')).toBe(failure === 'save' ? 'missing' : 'r2');
    expect(ui.element('resultTitle').textContent).toBe(failure === 'save' ? 'Could not apply choices' : 'Choices applied; detection failed');
  });

  it('discards edits without network access and skips initial setup with an explicit empty save', async () => {
    const ui = page(state(), async () => Response.json(state([], 'r2')));
    ui.checks[1].checked = true;
    ui.evaluate('discardProviderSelection()');
    expect(ui.evaluate('currentSelectedProviders()')).toEqual([key(targets[0])]);
    expect(ui.apiFetch).not.toHaveBeenCalled();
    ui.update(state([], 'missing', true));
    await ui.evaluate<Promise<void>>('skipProviderSelection()');
    expect(ui.apiFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(ui.apiFetch.mock.calls[0][1]?.body)).targets).toEqual([]);
    expect(ui.element('resultTitle').textContent).toBe('Runtime is idle');
    expect(ui.element('openRuntimeLink').hidden).toBe(false);
  });
});
