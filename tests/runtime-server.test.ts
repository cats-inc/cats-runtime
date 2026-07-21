import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { cleanupTempDirWithRetriesAsync } from './tempCleanup.js';
import {
  createRuntimeTestEnv,
  createRuntimeTestPaths,
  ensureRuntimeTestDirs,
} from './support/runtimeTestPaths.js';

import { loadConfig } from '../src/core/config.js';
import { getRuntimeManagementService } from '../src/http/app.js';
import * as providerInstallRunner from '../src/core/provider-install/ProviderInstallCheckRunner.js';
import { prepareSessionWorkspace } from '../src/core/workspace/sessionWorkspace.js';
import { createDiscoveryController, createRuntimeServer } from '../src/server.js';
import {
  RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
  RUNTIME_DIAGNOSTICS_PATHS,
  RUNTIME_SHUTDOWN_REASONS,
  RUNTIME_SHUTDOWN_SIGNALS,
  RUNTIME_STARTUP_CONTRACT_VERSION,
  RUNTIME_VERSION,
  createRuntimeStartupState,
} from '../src/startup.js';
import {
  findCuratedCliCatalog,
  loadCuratedModelCatalog,
  resolveCuratedCatalogScope,
} from '../src/core/models/curatedModelCatalog.js';

const RUNTIME_SERVER_INTEGRATION_TIMEOUT_MS = 20_000;

function alignDefaultProviderRuntime(
  config: ReturnType<typeof loadConfig>,
  provider: 'cursor' | 'kiro',
  runtime: { mode: 'native' | 'wsl'; distro?: string },
): void {
  const defaultInstanceId = config.providerDefaultInstances?.[provider] || 'default';
  const instance = config.providerInstances?.[provider]?.[defaultInstanceId];
  if (!instance) {
    return;
  }

  const nextRuntime = {
    ...instance.commandConfig.runtime,
    ...runtime,
  };
  instance.commandConfig = {
    ...instance.commandConfig,
    runtime: nextRuntime,
  };
  config.providerCommands[provider] = {
    ...config.providerCommands[provider],
    runtime: nextRuntime,
  };
}

function nativeExecutionPlatform(): 'windows' | 'macos' | 'linux' {
  if (process.platform === 'win32') {
    return 'windows';
  }
  if (process.platform === 'darwin') {
    return 'macos';
  }
  return 'linux';
}

function expectIdleMeteringSummary() {
  return expect.objectContaining({
    status: 'ok',
    summary: 'No active metering incidents or guardrails.',
    usageRecords: 0,
    incidents: 0,
    activeGuardrails: 0,
    activeCooldowns: 0,
    activeBlocks: 0,
  });
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }

  return result.stdout.trim();
}

function createGitWorkspace(root: string, repoName: string): string {
  const repoDir = join(root, repoName);
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(join(repoDir, 'tracked.txt'), 'initial\n', 'utf8');

  runGit(repoDir, ['init']);
  runGit(repoDir, ['config', 'user.email', 'cats-runtime@example.test']);
  runGit(repoDir, ['config', 'user.name', 'Cats Runtime Test']);
  runGit(repoDir, ['add', '.']);
  runGit(repoDir, ['commit', '-m', 'initial']);

  return repoDir;
}

function resolveEnvRuntimePaths(env: NodeJS.ProcessEnv) {
  return createRuntimeTestPaths(env.HOME || env.USERPROFILE || '');
}

function getBundledCursorStaticModelCount(): number {
  const curated = loadCuratedModelCatalog({
    runtimeConfig: {
      configPath: join(tmpdir(), 'cats-runtime-bundled-curated-example', 'providers.yaml'),
    },
    env: {
      ...process.env,
      CATS_RUNTIME_DIR: join(tmpdir(), 'cats-runtime-bundled-curated-example'),
    },
  });
  const catalog = findCuratedCliCatalog(curated.document, 'cursor');
  const scope = catalog ? resolveCuratedCatalogScope(catalog, 'cursor') : undefined;
  if (!scope) {
    throw new Error('Expected bundled curated cursor catalog to be available.');
  }
  return scope.models.length;
}

function createTestConfig(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-test-'));
  const paths = createRuntimeTestPaths(root);
  const {
    env: envOverrides,
    ...configOverrides
  } = overrides as Record<string, unknown>;
  const env = createRuntimeTestEnv(root, {
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
    CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    AUGGIE_SESSIONS_DIR: join(root, '.augment', 'sessions'),
    CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
    COPILOT_SESSIONS_DIR: join(root, '.copilot', 'session-state'),
    CURSOR_CHATS_DIR: join(root, '.cursor', 'chats'),
    KIRO_DB_PATH: join(root, '.kiro', 'data.sqlite3'),
    PI_SESSIONS_DIR: join(root, '.pi', 'agent', 'sessions'),
    ...(
      envOverrides
      && typeof envOverrides === 'object'
      && !Array.isArray(envOverrides)
        ? envOverrides as Record<string, string>
        : {}
    ),
  });

  ensureRuntimeTestDirs(paths);
  for (const dir of [
    env.AUGGIE_SESSIONS_DIR,
    env.CLAUDE_PROJECTS_DIR,
    env.CODEX_SESSIONS_DIR,
    env.COPILOT_SESSIONS_DIR,
    env.CURSOR_CHATS_DIR,
    env.PI_SESSIONS_DIR,
    join(root, '.junie', 'sessions'),
    join(root, 'data'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  const config = {
    ...loadConfig(env),
    host: '127.0.0.1',
    port: 0,
    ...configOverrides,
  };

  const overrideRecord = configOverrides as Record<string, unknown>;
  const overriddenProviderInstances = (
    overrideRecord.providerInstances
    && typeof overrideRecord.providerInstances === 'object'
    && !Array.isArray(overrideRecord.providerInstances)
  ) ? overrideRecord.providerInstances as Record<string, unknown> : undefined;

  if (overrideRecord.cursorRuntime && !overriddenProviderInstances?.cursor) {
    alignDefaultProviderRuntime(
      config,
      'cursor',
      overrideRecord.cursorRuntime as { mode: 'native' | 'wsl'; distro?: string },
    );
  }

  if (overrideRecord.kiroRuntime && !overriddenProviderInstances?.kiro) {
    alignDefaultProviderRuntime(
      config,
      'kiro',
      overrideRecord.kiroRuntime as { mode: 'native' | 'wsl'; distro?: string },
    );
  }

  return { root, config, cleanup: () => cleanupTempDirWithRetriesAsync(root) };
}

async function withRuntime(
  overrides: Record<string, unknown>,
  options: Parameters<typeof createRuntimeServer>[1],
  run: (runtime: ReturnType<typeof createRuntimeServer>) => Promise<void>,
) {
  const { config, cleanup } = createTestConfig(overrides);
  const runtime = createRuntimeServer(config, options);
  try {
    await run(runtime);
  } finally {
    await runtime.close();
    await cleanup();
  }
}

async function withCuratedCatalogRuntime(
  curatedLines: string[],
  overrides: Record<string, unknown>,
  options: Parameters<typeof createRuntimeServer>[1],
  run: (runtime: ReturnType<typeof createRuntimeServer>) => Promise<void>,
) {
  const { root, config, cleanup } = createTestConfig(overrides);
  const paths = createRuntimeTestPaths(root);
  writeFileSync(paths.curatedModelCatalogPath, `${curatedLines.join('\n')}\n`, 'utf8');
  const runtime = createRuntimeServer(config, options);
  try {
    await run(runtime);
  } finally {
    await runtime.close();
    await cleanup();
  }
}

describe('runtime server', () => {
  it('GET / serves the embedded dashboard', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/');
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Cats Runtime Dashboard');
      expect(html).toContain('Session Dashboard');
      expect(html).toContain('session?.lastInputPreview');
      expect(html).toContain('window.__CATS_RUNTIME_API_BASE__');
      expect(html).toContain('window.__CATS_RUNTIME_PROXY_MODE__');
      expect(html.indexOf('<option value="claude">claude</option>'))
        .toBeLessThan(html.indexOf('<option value="codex">codex</option>'));
      expect(html.indexOf('<option value="codex">codex</option>'))
        .toBeLessThan(html.indexOf('<option value="antigravity">antigravity</option>'));
      expect(html.indexOf('<option value="antigravity">antigravity</option>'))
        .toBeLessThan(html.indexOf('<option value="cursor">cursor</option>'));
      expect(html.indexOf('<option value="cursor">cursor</option>'))
        .toBeLessThan(html.indexOf('<option value="copilot">copilot</option>'));
      expect(html.indexOf('<option value="copilot">copilot</option>'))
        .toBeLessThan(html.indexOf('<option value="opencode">opencode</option>'));
      expect(html).toContain(
        "const PROVIDER_ORDER = ['claude', 'codex', 'antigravity', 'cursor', 'copilot', 'opencode', 'kilo', 'goose', 'pi', 'auggie', 'junie', 'kiro', 'ollama', 'openclaw'];",
      );
      expect(html).toContain('--openclaw: #f87171;');
      expect(html).toContain('.provider-badge[data-p="openclaw"]');

      const openCreateModalMatch = html.match(
        /async function openCreateModal\(\) \{([\s\S]*?)\n\}/,
      );
      expect(openCreateModalMatch?.[1]).toBeTruthy();
      const openCreateModalBody = openCreateModalMatch![1];
      expect(openCreateModalBody.indexOf("classList.add('open')"))
        .toBeLessThan(openCreateModalBody.indexOf('await refreshProviderCatalog()'));
      const syncCreatePresetSelectorMatch = html.match(
        /function syncCreatePresetSelector\(catalog, preserveCurrent = false, allowDefaultPreset = true\) \{([\s\S]*?)\n\}/,
      );
      expect(syncCreatePresetSelectorMatch?.[1]).toBeTruthy();
      expect(syncCreatePresetSelectorMatch![1]).toContain(
        "if (entryId === CUSTOM_CREATE_MODEL_VALUE) {\n"
          + "    renderCreateRoutingSelectOptions(presetEl, [], '');\n"
          + "    presetEl.disabled = true;\n"
          + "    setCreatePresetGroupDisplay('hidden');\n"
          + "    return '';\n"
          + '  }',
      );
      expect(syncCreatePresetSelectorMatch![1]).toContain(
        "if (presets.length === 0) {\n"
          + "    return setCreatePresetStaticLabel('Standard only');\n"
          + '  }',
      );
      const setCreatePresetStaticLabelMatch = html.match(
        /function setCreatePresetStaticLabel\(label\) \{([\s\S]*?)\n\}/,
      );
      expect(setCreatePresetStaticLabelMatch?.[1]).toBeTruthy();
      expect(setCreatePresetStaticLabelMatch![1]).toContain("const optionLabel = label || 'Standard only';");
      expect(setCreatePresetStaticLabelMatch![1]).toContain("setCreatePresetGroupDisplay('visible');");
      const setCreatePresetGroupDisplayMatch = html.match(
        /function setCreatePresetGroupDisplay\(mode\) \{([\s\S]*?)\n\}/,
      );
      expect(setCreatePresetGroupDisplayMatch?.[1]).toBeTruthy();
      expect(setCreatePresetGroupDisplayMatch![1]).toContain("if (mode === 'reserved') {");
      expect(setCreatePresetGroupDisplayMatch![1]).toContain("presetGroup.style.visibility = 'hidden';");
      const renderCreateModelChoiceMatch = html.match(
        /function renderCreateModelChoice\(\) \{([\s\S]*?)\n\}/,
      );
      expect(renderCreateModelChoiceMatch?.[1]).toBeTruthy();
      expect(renderCreateModelChoiceMatch![1]).toContain(
        "if (!entryId || entryId === CUSTOM_CREATE_MODEL_VALUE) {\n"
          + "    hintEl.textContent = 'Manual model id passthrough.';\n"
          + "    setCreatePresetGroupDisplay('hidden');\n"
          + "    setCreateManualModelGroup(true, 'Legacy Model ID');\n"
          + '    return;\n'
          + '  }',
      );
      expect(html).toContain('id="createSessionBtn"');
      expect(html).not.toContain('id="providerCapabilityPreview"');
      expect(html).toContain('id="chatSessionInsights"');
      expect(html).toContain('id="inputWorkspaceKind"');
      expect(html).toContain('id="inputWorkspaceAccess"');
      expect(html).not.toContain("accessEl.value = 'read_write';");
      expect(html).not.toContain('id="inputRoutingMode"');
      expect(html).toContain('id="inputPresetChoice"');
      expect(html).toContain('id="inputEntryChoice"');
      expect(html).toContain('id="inputModelGroup"');
      expect(html).toContain('id="inputModelLabel"');
      expect(html).toContain('grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));');
      expect(html).not.toContain('id="inputModelChoice"');
      expect(html).not.toContain('id="inputWorkspaceMode"');
      expect(html).toContain('data-runtime-surface-switcher');
      expect(html).toContain('data-active-surface="dashboard"');
      expect(html).not.toContain('refreshProviderCapabilityPreview');
      expect(html).toContain('renderSessionInsights');
      expect(html).toContain('setLegacyCreateModelRouting');
      expect(html).toContain('setCreatePresetGroupDisplay');
      expect(html).toContain('setCreateManualModelGroup');
      expect(html).toContain('syncCreatePresetSelector');
      expect(html).toContain('id="inputPresetStaticLabel"');
      expect(html).toContain('setCreatePresetStaticLabel');
      expect(html).toContain("entryMode: 'explicit'");
      expect(html).toContain('Custom legacy model...');
      expect(html).not.toContain('Not available for custom legacy model.');
      expect(html).not.toContain('Standard mode only.');
      expect(html).toContain('configuredProviderNamesRaw');
      expect(html).toContain('rawInstanceTargetValue');
      expect(html).not.toContain("{ id: 'default', runtime: { mode: 'native' } }");
      expect(html).toContain(RUNTIME_DIAGNOSTICS_PATHS.health);
      expect(html).toContain('refreshRuntimeHealthStatus');
      expect(html).not.toContain('const providers = wsl.providers || {};');
      expect(html).not.toContain(
        'for (const [providerName, provider] of Object.entries(providers)',
      );
    });
  });

  it('redirects surface pages to /setup while bootstrap is incomplete', async () => {
    await withRuntime(
      {},
      { startup: createRuntimeStartupState({ bootstrapRequired: true }) },
      async (runtime) => {
        for (const path of ['/', '/dashboard', '/playground']) {
          const response = await runtime.app.request(path);
          expect(response.status).toBe(302);
          expect(response.headers.get('location')).toBe('/setup');
        }
      },
    );
  });

  it('GET /playground serves the embedded playground without auth', async () => {
    await withRuntime({ apiKey: 'runtime-secret' }, {}, async (runtime) => {
      const response = await runtime.app.request('/playground');
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('<title>Cats Runtime Playground</title>');
      expect(html).toContain('Agent Playground');
      expect(html).not.toContain('Playground Shell');
      expect(html).toContain('CATS RUNTIME');
      expect(html).toContain('Set up agents to start');
      expect(html).toContain('Researcher');
      expect(html).toContain('Designer');
      expect(html).toContain('Security');
      expect(html).toContain('Tech Writer');
      expect(html).toContain('id="preset-agents-btn"');
      expect(html).toContain('Use 12-agent preset');
      expect(html).toContain('confirmApplyTwelveAgentPreset()');
      expect(html).toContain("if(!window.confirm('Replace the current agents with the 12-agent preset?')) return;");
      expect(html).toContain('id="starter-agents-btn"');
      expect(html).toContain('Restore default 2-agent preset');
      expect(html).toContain('confirmRestoreStarterAgents()');
      expect(html).toContain("if(!window.confirm('Replace the current agents with the default 2-agent preset?')) return;");
      expect(html).toContain('id="add-agent-btn"');
      expect(html).toContain(
        '<header class="runtime-page-header" style="padding-top:0.75rem;padding-bottom:0.75rem;">',
      );
      expect(html).toContain('runtime-page-content min-h-0 overflow-hidden p-6');
      expect(html).toContain('runtime-empty flex-1');
      expect(html).toContain('id="agent-statuses" class="ml-auto flex min-w-0 flex-wrap justify-end gap-2"');
      expect(html).toContain('#left-panel {');
      expect(html).toContain('width: var(--sidebar-width);');
      expect(html).toContain("const DEFAULT_CHAT_PROMPTS = {\n  en: 'Help me build a calculator website.',");
      expect(html).toContain("'zh-TW': '\\u5e6b\\u6211\\u5beb\\u500b\\u8a08\\u7b97\\u6a5f\\u7db2\\u7ad9\\u3002',");
      expect(html).toContain('syncChatInputDefaultPrompt');
      expect(html).toContain("return document.getElementById('response-lang')?.value || 'en';");
      expect(html).toContain("responseLangSelect?.addEventListener('change', () => {");
      expect(html).toContain('openclaw-preview');
      expect(html).toContain("'openclaw']");
      expect(html).toContain("if (provider === 'ollama') return `${name}-LOCAL`;");
      expect(html).toContain("if (provider === 'openclaw') return `${name}-AGENT`;");
      expect(html).toContain("return `${name}-CLI`;");
      expect(html).toContain('const TWELVE_AGENT_PRESET = [');
      expect(html).toContain('const STARTER_AGENT_PRESET = [');
      expect(html).toContain("{ name:'Agent-1', provider:'claude', model:'', tags:['orchestrator'] },");
      expect(html).toContain("{ name:'Agent-2', provider:'codex', model:'', tags:['coder'] },");
      expect(html).toContain("{ name:'Agent-1', provider:'antigravity', model:getDefaultModel('antigravity'), tags:['orchestrator'] },");
      expect(html).toContain("{ name:'Agent-2', provider:'cursor', model:getDefaultModel('cursor'), tags:['pm'] },");
      expect(html).toContain("{ name:'Agent-12', provider:'openclaw', model:getDefaultModel('openclaw'), tags:['marketer'] },");
      expect(html).toContain('id="agents-loading-state"');
      expect(html).toContain('function ensureStarterAgents(){');
      expect(html).toContain('applyStarterAgentPreset({ allowBeforeProviderReady:true });');
      expect(html).toContain('function applyStarterAgentPreset(options={}){');
      expect(html).toContain("if(status==='ok') return '';");
      expect(html).toContain('const hasAgents=getAgentCount()>0;');
      expect(html).toContain('const providerCatalogPending=!providerOptionsReady&&(providerOptionsLoading||providerOptionsRequestId===0);');
      expect(html).toContain("const basicModels=PROVIDER_MODELS[provider]||[];");
      expect(html).toContain("renderAgentRoutingSelectOptions(select,[{ value:'', label:'Loading models...' }], '');");
      expect(html).toContain("renderAgentRoutingSelectOptions(select,[{ value:'', label:'Models unavailable' }], '');");
      expect(html).toContain("hintEl.textContent='Loading provider models...';");
      expect(html).toContain("const showList=mode==='ready'||(mode!=='loading'&&hasAgents);");
      expect(html).toContain("const showState=mode!=='ready'&&!showList;");
      expect(html).toContain('ensureStarterAgents();');
      expect(html.indexOf('<script data-cats-ui>')).toBeGreaterThan(-1);
      expect(html.indexOf('<script data-cats-ui>')).toBeLessThan(html.indexOf('void initApp();'));
      expect(html).toContain('providerOptionsReady&&!providerOptionsLoading');
      expect(html).toContain('.agent-tag-chip {');
      expect(html).toContain('.agent-tag-toggle input[value="orchestrator"]:checked + .agent-tag-chip {');
      expect(html).toContain('.agent-card-toggle {');
      expect(html).toContain('.agent-card-details {');
      expect(html).toContain('.agent-remove {');
      expect(html).toContain('function getDisplayOrderedAgents(agents) {');
      expect(html).toContain('reorderAgentStatusPills();');
      expect(html).toContain('let SELECTABLE_PROVIDERS = [...PROVIDERS];');
      expect(html).toContain('let expandedAgentId = null;');
      expect(html).toContain('function refreshAllAgentCardSummaries() {');
      expect(html).toContain('function setExpandedAgent(id, expand = true) {');
      expect(html).toContain('function toggleAgentCard(id) {');
      expect(html).toContain('function renderAgentProviderSelectOptions(selectEl,selectedProvider=\'\'){');
      expect(html).toContain('function confirmRestoreStarterAgents(){');
      expect(html).toContain('function resolveAgentInitialRouting(provider,model=\'\',modelSelection=null){');
      expect(html).toContain('function syncAgentPresetField(div,catalog,entryId,preferredPresetId=\'\',allowDefaultPreset=true){');
      expect(html).toContain('function renderAgentModelChoice(div){');
      expect(html).toContain("div.className=`my-1 ${c.bg} border-l-4 ${c.border} rounded-r-lg p-4 max-w-[85%]`;");
      expect(html).toContain("div.className='my-1 flex justify-end';");
      expect(html).toContain('class="agent-card-toggle" aria-expanded="false" onclick="toggleAgentCard(');
      expect(html).toContain('<div class="agent-summary-meta agent-card-summary-row"></div>');
      expect(html).toContain('<div class="agent-summary-tags agent-card-summary-row"></div>');
      expect(html).toContain('class="agent-remove hover:bg-slate-800/70 hover:text-red-400" title="Remove agent" aria-label="Remove agent"');
      expect(html).toContain('<div class="agent-card-details hidden space-y-3">');
      expect(html).toContain('<div class="agent-entry-group"><label class="block text-xs text-slate-400">Model</label><select class="agent-entry-choice');
      expect(html).toContain('<div class="agent-mode-group"><label class="block text-xs text-slate-400">Mode</label><select class="agent-preset-choice');
      expect(html).toContain('title="Browse directory" aria-label="Browse directory"');
      expect(html).toContain('>Stakeholder</span>');
      expect(html).not.toContain('Custom legacy model...');
      expect(html).not.toContain('Legacy Model ID');
      expect(html).not.toContain('Manual model id passthrough.');
      expect(html).not.toContain('agent-model-manual-group');
      expect(html).toContain("if(options.expandOnCreate===false){");
      expect(html).toContain('setExpandedAgent(id, true);');
      expect(html).toContain('window.CatsUI?.listAdvancedCatalogEntries');
      expect(html).toContain('window.CatsUI?.getAdvancedCatalogDefaultEntryId');
      expect(html).toContain('window.CatsUI?.getAdvancedCatalogDefaultPresetId');
      expect(html).toContain('window.CatsUI?.listApplicableAdvancedPresets');
      expect(html).toContain('window.CatsUI?.normalizePlaygroundAgentSelection');
      expect(html).toContain('class RuntimeClient');
      expect(html).toContain('/playground/workspace');
      expect(html).toContain('createPlaygroundWorkspace()');
      expect(html).toContain('deletePlaygroundWorkspace(workspaceId)');
      expect(html).toContain('/providers/config');
      expect(html).toContain('data-runtime-surface-switcher');
      expect(html).toContain('data-active-surface="playground"');
      expect(html).toContain('id="api-key"');
      expect(html).toContain('runtime-auth-status');
      expect(html).toContain('Runtime Health');
      expect(html).toContain('validateRuntimeApiKey');
      expect(html).toContain('getRuntimeAuthHeaders');
      expect(html).toContain("antigravity:[{value:'antigravity-default',label:'Antigravity default'}],");
      expect(html).toContain("junie:[{value:'Gemini 3 Flash',label:'Gemini 3 Flash (default)'},{value:'Claude Opus 4.6',label:'Claude Opus 4.6'},{value:'Claude Opus 4.7',label:'Claude Opus 4.7'},{value:'Claude Sonnet 4.6',label:'Claude Sonnet 4.6'},{value:'Gemini 3.1 Flash Lite',label:'Gemini 3.1 Flash Lite'},{value:'Gemini 3.1 Pro Preview',label:'Gemini 3.1 Pro Preview'},{value:'GPT-5',label:'GPT-5'},{value:'GPT-5.2',label:'GPT-5.2'},{value:'GPT-5.3-codex',label:'GPT-5.3-codex'},{value:'GPT-5.4',label:'GPT-5.4'},{value:'Grok 4.1 Fast Reasoning',label:'Grok 4.1 Fast Reasoning'}],");
      expect(html).not.toContain("junie:[{value:'gpt-5.4',label:'gpt-5.4 (default)'}],");
      expect(html).toContain('/providers/${name}/models/advanced');
      expect(html).toContain('normalizeModelCatalog');
      expect(html).toContain('modelSelection');
      expect(html).toContain('Provider returned no assistant output.');
      expect(html).toContain('function extractResultEventFallbackText(event) {');
      expect(html).toContain('event?.raw?.result?.payloads');
      expect(html).toContain("const fullText = textParts.join('') || resultFallbackText;");
      expect(html).toContain('getAdvancedCatalogChoices');
      expect(html).toContain('workspaceKind');
      expect(html).toContain('workspaceAccess');
      expect(html).not.toContain('workspaceIsolation = workspaceIsolation');
      expect(html).not.toContain("opts.workspaceIsolation = 'shared'");
      expect(html).not.toContain('workspaceMode');
    });
  });

  it('POST /playground/workspace provisions and cleans up a runtime-owned shared workspace', async () => {
    await withRuntime({ apiKey: 'runtime-secret' }, {}, async (runtime) => {
      const createResponse = await runtime.app.request('/playground/workspace', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer runtime-secret',
        },
      });
      expect(createResponse.status).toBe(200);
      const created = await createResponse.json<{
        id: string;
        cwd: string;
      }>();
      expect(created.id).toMatch(/^playground-room-/);
      expect(existsSync(created.cwd)).toBe(true);

      const deleteResponse = await runtime.app.request(`/playground/workspace/${created.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer runtime-secret',
        },
      });
      expect(deleteResponse.status).toBe(200);
      expect(await deleteResponse.json()).toEqual({
        id: created.id,
        deleted: true,
      });
      expect(existsSync(created.cwd)).toBe(false);
    });
  });

  it('GET /setup serves the embedded provider setup page without auth', async () => {
    await withRuntime(
      { apiKey: 'runtime-secret' },
      { startup: createRuntimeStartupState({ bootstrapRequired: false }) },
      async (runtime) => {
        const response = await runtime.app.request('/setup');
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('<title>Cats Runtime Setup</title>');
        expect(html).toContain('data-cats-ui');
        expect(html).toContain('data-runtime-surface-switcher');
        expect(html).toContain('data-active-surface="setup"');
        expect(html).toContain('apiKeyInput');
        expect(html).toContain("window.CatsUI && window.CatsUI.apiFetch");
        expect(html).toContain('validateApiKeyInput');
        expect(html).toContain('Stages');
        expect(html).toContain('Runtime Targets');
        expect(html).toContain('setupRailProviders');
        expect(html).toContain('setupRailConfiguredTargets');
        expect(html).toContain('providersWorkspaceStatus');
        expect(html).toContain('setupTargetList');
        expect(html).toContain('setupTargetListSummary');
        expect(html).toContain('Target Catalog');
        expect(html).toContain('setupCapabilityProvider');
        expect(html).toContain('setupCapabilityInstance');
        expect(html).toContain('loadConfiguredTargetCapabilities');
        expect(html).toContain('/providers/config');
        expect(html).toContain('/providers/${encodeURIComponent(providerName)}/tools?instance=${encodeURIComponent(instanceTarget)}');
        expect(html).toContain('id="selectAllCheckbox"');
        expect(html).toContain('id="selectionStatusBadge"');
        expect(html).toContain('toggleSelectAllProviders()');
        expect(html).toContain("document.addEventListener('DOMContentLoaded'");
        expect(html).toContain('escapeHtml(r.summary)');
        expect(html).toContain('escapeHtml(p.commandPath)');
        expect(html).not.toContain('Bootstrap Mode');
        expect(html).not.toContain('Operator Notes');
        expect(html).not.toContain('localStorage');
        expect(html).toContain("await fetchFn('/setup-scan'");
        expect(html).toContain("await fetchFn('/setup-apply'");
      },
    );
  });

  it('GET /health enforces optional inbound auth', async () => {
    await withRuntime({ apiKey: 'runtime-secret' }, {}, async (runtime) => {
      const unauthenticated = await runtime.app.request('/health');
      expect(unauthenticated.status).toBe(401);

      const authenticated = await runtime.app.request(
        '/health',
        {
          headers: { authorization: 'Bearer runtime-secret' },
        },
      );

      expect(authenticated.status).toBe(200);
      expect(await authenticated.json()).toEqual({
        service: 'cats-runtime',
        status: 'degraded',
        summary: 'Runtime is starting and is not ready yet.',
        version: RUNTIME_VERSION,
        timestamp: expect.any(String),
        contract: {
          startup: RUNTIME_STARTUP_CONTRACT_VERSION,
          diagnostics: RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
          supportedModes: ['standalone', 'app-managed'],
          readinessPath: '/health',
          lifecycleEvents: [
            'runtime.ready',
            'runtime.startup_error',
            'runtime.stopping',
            'runtime.stopped',
          ],
          shutdownSignals: [...RUNTIME_SHUTDOWN_SIGNALS],
          shutdownReasons: [...RUNTIME_SHUTDOWN_REASONS],
          endpoints: {
            health: '/health',
            runtime: RUNTIME_DIAGNOSTICS_PATHS.runtime,
            providers: RUNTIME_DIAGNOSTICS_PATHS.providers,
            summary: RUNTIME_DIAGNOSTICS_PATHS.health,
          },
        },
        readiness: {
          endpoint: '/health',
          authoritative: true,
          readySignal: 'http',
          phase: 'starting',
          ready: false,
        },
        startup: {
          contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
          mode: 'standalone',
          managedBy: undefined,
          phase: 'starting',
          readySignal: 'http',
          ready: false,
          bootstrapRequired: false,
          pid: expect.any(Number),
          startedAt: expect.any(String),
          address: undefined,
          shutdownReason: undefined,
          lastEvent: undefined,
        },
        shutdown: {
          signals: [...RUNTIME_SHUTDOWN_SIGNALS],
          reasons: [...RUNTIME_SHUTDOWN_REASONS],
          stdinCloseEnabled: false,
        },
      });
    });
  });

  it('GET /health exposes app-managed startup metadata after listen', async () => {
    const { config, cleanup } = createTestConfig();
    const runtime = createRuntimeServer(config, {
      startup: createRuntimeStartupState({
        mode: 'app-managed',
        managedBy: 'cats-inc',
        readyOutput: 'json',
      }),
    });

    try {
      const address = await runtime.start();
      const response = await fetch(`http://${address.host}:${address.port}/health`);
      expect(response.status).toBe(200);
      const payload = await response.json() as Record<string, any>;
      expect(payload).toMatchObject({
        service: 'cats-runtime',
        status: 'ok',
        summary: 'Runtime is ready to accept requests.',
        version: RUNTIME_VERSION,
        timestamp: expect.any(String),
        contract: {
          startup: RUNTIME_STARTUP_CONTRACT_VERSION,
          diagnostics: RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
          supportedModes: ['standalone', 'app-managed'],
          readinessPath: '/health',
          lifecycleEvents: [
            'runtime.ready',
            'runtime.startup_error',
            'runtime.stopping',
            'runtime.stopped',
          ],
          shutdownSignals: [...RUNTIME_SHUTDOWN_SIGNALS],
          shutdownReasons: [...RUNTIME_SHUTDOWN_REASONS],
          endpoints: {
            health: '/health',
            runtime: RUNTIME_DIAGNOSTICS_PATHS.runtime,
            providers: RUNTIME_DIAGNOSTICS_PATHS.providers,
            summary: RUNTIME_DIAGNOSTICS_PATHS.health,
          },
        },
        readiness: {
          endpoint: '/health',
          authoritative: true,
          readySignal: 'http',
          phase: 'ready',
          ready: true,
        },
        startup: {
          contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
          mode: 'app-managed',
          managedBy: 'cats-inc',
          phase: 'ready',
          readySignal: 'http',
          ready: true,
          bootstrapRequired: false,
          pid: expect.any(Number),
          startedAt: expect.any(String),
          address: {
            host: address.host,
            port: address.port,
            healthUrl: `http://${address.host}:${address.port}/health`,
          },
        },
        shutdown: {
          signals: [...RUNTIME_SHUTDOWN_SIGNALS],
          reasons: [...RUNTIME_SHUTDOWN_REASONS],
          stdinCloseEnabled: true,
        },
      });
    } finally {
      await runtime.close();
      await cleanup();
    }
  }, RUNTIME_SERVER_INTEGRATION_TIMEOUT_MS);

  it('close waits for an in-flight start to settle before tearing resources down', async () => {
    const { config, cleanup } = createTestConfig();
    const runtime = createRuntimeServer(config, {
      startup: createRuntimeStartupState({
        mode: 'app-managed',
        managedBy: 'cats-inc',
        readyOutput: 'json',
      }),
    });
    const poolKillSpy = vi.spyOn(runtime.context.pool, 'killAll');
    let pendingClose: Promise<void> | undefined;

    runtime.server.once('listening', () => {
      pendingClose = runtime.close();
      expect(poolKillSpy).not.toHaveBeenCalled();
    });

    try {
      await expect(runtime.start()).rejects.toThrow('cats-runtime closed during startup');
      expect(pendingClose).toBeDefined();
      if (!pendingClose) {
        throw new Error('close() was not triggered during startup');
      }

      await pendingClose;
      expect(poolKillSpy).toHaveBeenCalledTimes(1);
      expect(runtime.context.startup.ready).toBe(false);
      expect(runtime.context.startup.phase).toBe('stopped');
    } finally {
      poolKillSpy.mockRestore();
      await runtime.close();
      await cleanup();
    }
  }, RUNTIME_SERVER_INTEGRATION_TIMEOUT_MS);

  it('GET /diagnostics/runtime exposes the frozen startup contract', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/diagnostics/runtime');
      expect(response.status).toBe(200);
      const payload = await response.json() as Record<string, any>;
      expect(payload).toMatchObject({
        service: 'cats-runtime',
        version: RUNTIME_VERSION,
        timestamp: expect.any(String),
        status: 'degraded',
        summary: 'Runtime is starting and is not ready yet.',
        contract: {
          startup: RUNTIME_STARTUP_CONTRACT_VERSION,
          diagnostics: RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
          supportedModes: ['standalone', 'app-managed'],
          readinessPath: '/health',
          lifecycleEvents: [
            'runtime.ready',
            'runtime.startup_error',
            'runtime.stopping',
            'runtime.stopped',
          ],
          shutdownSignals: [...RUNTIME_SHUTDOWN_SIGNALS],
          shutdownReasons: [...RUNTIME_SHUTDOWN_REASONS],
          endpoints: {
            health: '/health',
            runtime: RUNTIME_DIAGNOSTICS_PATHS.runtime,
            providers: RUNTIME_DIAGNOSTICS_PATHS.providers,
            summary: RUNTIME_DIAGNOSTICS_PATHS.health,
          },
        },
        readiness: {
          endpoint: '/health',
          authoritative: true,
          readySignal: 'http',
          phase: 'starting',
          ready: false,
        },
        runtime: {
          startup: expect.objectContaining({
            contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
            mode: 'standalone',
            phase: 'starting',
            readySignal: 'http',
            ready: false,
            pid: expect.any(Number),
            startedAt: expect.any(String),
          }),
          shutdown: {
            signals: [...RUNTIME_SHUTDOWN_SIGNALS],
            reasons: [...RUNTIME_SHUTDOWN_REASONS],
            stdinCloseEnabled: false,
          },
          listener: {
            host: '127.0.0.1',
            port: 0,
          },
          paths: {
            configPath: expect.stringContaining(join('.cats', 'runtime', 'config', 'providers.yaml')),
            dataDir: expect.stringContaining(join('.cats', 'runtime', 'data')),
            sessionBaseDir: expect.stringContaining(join('.cats', 'runtime', 'sessions')),
            compatibilityEvidenceDir: expect.stringContaining(
              join('.cats', 'runtime', 'data', 'compatibility'),
            ),
          },
          maintenance: {
            worktrees: {
              policy: {
                sweepIntervalMs: 60000,
                retainedTtlMs: 86400000,
              },
              retained: {
                totalSessions: 0,
                attachedSessions: 0,
                cleanupEligibleSessions: 0,
                expiredSessions: 0,
                sampleLimit: 25,
                omittedSessionCount: 0,
                sampleSessionIds: [],
                expiredSampleSessionIds: [],
                policyCounts: {
                  discard: 0,
                  merge: 0,
                  preserve: 0,
                },
                reasonCodeCounts: {
                  sourceWorkspaceDirty: 0,
                  worktreeDetachFailed: 0,
                  worktreePreserved: 0,
                  other: 0,
                },
                sessions: [],
              },
            },
            browser: {
              policy: {
                sweepIntervalMs: 60000,
                closedSessionTtlMs: 1800000,
              },
            },
          },
          browser: {
            filters: {},
            sessions: {
              total: 0,
              ready: 0,
              closed: 0,
            },
            pages: {
              total: 0,
              open: 0,
              closed: 0,
            },
            attachedRuntimeSessionCount: 0,
            drivers: [],
            cleanupCandidates: {
              olderThanMs: 1800000,
              sessionCount: 0,
              pageCount: 0,
              sessionIds: [],
            },
          },
          browserDrivers: {
            drivers: [
              {
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
              },
            ],
            summary: {
              totalDrivers: 1,
              readyDrivers: 1,
              degradedDrivers: 0,
              unsupportedDrivers: 0,
              persistentSessionDrivers: 1,
              liveAutomationDrivers: 0,
              manualUrlEntryDrivers: 1,
              summary: '1 browser driver(s) are registered for runtime preview flows.',
            },
          },
          pool: expect.objectContaining({
            active: 0,
            busy: 0,
            idle: 0,
            providers: {},
            backends: expect.objectContaining({
              cli: expect.objectContaining({
                active: 0,
                busy: 0,
                idle: 0,
                providers: {},
              }),
            }),
          }),
          executionStrategies: {
            summary: {
              totalFamilies: 7,
              supportedFamilies: 7,
              fallbackOnlyFamilies: 0,
              compatibilityDefault: 'simple_tool_call',
              runtimeHostedBackends: ['api', 'local'],
              summary: '7 runtime-hosted strategy families are available for api/local loops.',
            },
            strategies: expect.arrayContaining([
              expect.objectContaining({
                id: 'simple_tool_call',
                availability: 'supported',
                executionModel: 'compatibility_loop',
              }),
              expect.objectContaining({
                id: 'tree_of_thoughts',
                availability: 'supported',
                guardrails: expect.objectContaining({
                  branchCount: true,
                }),
              }),
              expect.objectContaining({
                id: 'deps',
                availability: 'supported',
                executionModel: 'phase_loop',
              }),
            ]),
          },
          management: {
            adapters: {
              summary: {
                totalAdapters: 2,
                totalDomains: 2,
                readOnlyActions: 6,
                mutatingActions: 2,
                transports: {
                  cli: 2,
                  api: 0,
                },
                summary: '2 management adapter(s) cover 2 domain(s) with 6 read-only and 2 mutating actions.',
              },
            },
            operations: {
              total: 0,
              polling: 0,
              completed: 0,
              failed: 0,
              oldestStartedAt: null,
              latestUpdatedAt: null,
            },
          },
          delivery: {
            actions: {
              readOnly: ['audit-delivery-target', 'inspect-repo-status'],
              mutating: ['publish-artifacts', 'create-commit', 'push-branch'],
            },
            approval: {
              privilegedActorRoles: ['boss_cat', 'system', 'owner'],
              previewDefault: true,
              summary: expect.stringContaining('defaults every action to preview mode'),
            },
            capabilities: ['artifactPublication', 'repoStatus', 'commit', 'push', 'previewSurfaces'],
            previewSurfaceKinds: ['artifact', 'service'],
            summary: {
              totalActions: 5,
              readOnlyActions: 2,
              mutatingActions: 3,
            },
          },
          tools: expect.objectContaining({
            profiles: expect.objectContaining({
              standard: expect.objectContaining({
                totalTools: expect.any(Number),
              }),
              extended: expect.objectContaining({
                totalTools: expect.any(Number),
              }),
              readOnly: expect.objectContaining({
                totalTools: expect.any(Number),
              }),
            }),
            summary: expect.stringContaining('Runtime tooling exposes'),
          }),
          skills: expect.objectContaining({
            rootPath: expect.stringContaining('skills'),
            state: 'loaded',
            totalSkills: expect.any(Number),
            families: expect.objectContaining({
              code: expect.any(Number),
            }),
            packageKinds: expect.objectContaining({
              role: expect.any(Number),
            }),
            deliveryHints: expect.objectContaining({
              instructions: expect.any(Number),
            }),
            summary: expect.stringContaining('runtime skill'),
          }),
          setup: {
            bootstrapRequired: false,
            latestReport: null,
          },
          wakeups: {
            summary: {
              status: 'ok',
              summary: 'No wakeup requests are tracked.',
              totalRequests: 0,
              openRequests: 0,
              scheduled: 0,
              due: 0,
              triggering: 0,
              recurring: 0,
              terminal: 0,
              triggered: 0,
              cancelled: 0,
              failed: 0,
              sessionsWithPending: 0,
              nextScheduledAt: null,
            },
            timer: {
              active: false,
              processing: false,
              tickIntervalMs: 1000,
              maxDuePerTick: 8,
            },
            retention: {
              maxTerminalRequests: 256,
              maxTerminalRequestsPerSession: 16,
            },
            samples: {
              due: [],
              failed: [],
            },
          },
          process: {
            pid: process.pid,
            ppid: process.ppid,
            platform: process.platform,
            nodeVersion: process.version,
          },
          peers: expect.objectContaining({
            enabled: false,
            status: 'disabled',
            localPeerId: expect.any(String),
            registry: {
              total: 0,
              self: 0,
              remote: 0,
              alive: 0,
              stale: 0,
              trusted: 0,
              unknown: 0,
              rejected: 0,
            },
            adapters: expect.arrayContaining([
              expect.objectContaining({
                id: 'self',
                kind: 'self',
                state: 'idle',
                publishedPeers: 0,
              }),
            ]),
          }),
        },
        metering: {
          summary: {
            status: 'ok',
            summary: 'No active metering incidents or guardrails.',
            usageRecords: 0,
            incidents: 0,
            activeGuardrails: 0,
            activeCooldowns: 0,
            activeBlocks: 0,
          },
          usage: {
            totals: {
              observationCount: 0,
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              confidenceCounts: {
                reported: 0,
                aggregated: 0,
                estimated: 0,
                unknown: 0,
              },
            },
            byProviderInstance: [],
            bySession: [],
          },
          incidents: {
            recent: [],
            active: [],
          },
          guardrails: {
            configured: [
              {
                scope: 'provider_instance',
                metric: 'rate_limit_incidents',
                threshold: 1,
                action: 'cooldown',
                cooldownMs: 60000,
              },
            ],
            active: [],
          },
        },
      });
    });
  });

  it('surfaces current browser aggregate state on runtime and health diagnostics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-browser-diagnostics-test-'));
    const paths = createRuntimeTestPaths(root);
    const configPath = paths.configPath;
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(configPath, 'providers: {}\n', 'utf8');

    const env = createRuntimeTestEnv(root, {
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
      AUGGIE_SESSIONS_DIR: join(root, '.augment', 'sessions'),
      CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
      CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
      COPILOT_SESSIONS_DIR: join(root, '.copilot', 'session-state'),
      CURSOR_CHATS_DIR: join(root, '.cursor', 'chats'),
      KIRO_DB_PATH: join(root, '.kiro', 'data.sqlite3'),
      PI_SESSIONS_DIR: join(root, '.pi', 'agent', 'sessions'),
    });

    ensureRuntimeTestDirs(createRuntimeTestPaths(root));

    for (const dir of [
      resolveEnvRuntimePaths(env).sessionBaseDir,
      resolveEnvRuntimePaths(env).dataDir,
      env.AUGGIE_SESSIONS_DIR,
      env.CLAUDE_PROJECTS_DIR,
      env.CODEX_SESSIONS_DIR,
      env.COPILOT_SESSIONS_DIR,
      env.CURSOR_CHATS_DIR,
      join(root, '.kiro'),
      join(root, '.junie', 'sessions'),
      env.PI_SESSIONS_DIR,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer(loadConfig(env));
    try {
      runtime.context.registry.create({
        id: 'browser-runtime-session',
        providerName: 'codex',
        cwd: '/tmp/browser-runtime-session',
      });

      const attachedBrowser = await runtime.context.browser.createSession({
        runtimeSessionId: 'browser-runtime-session',
        label: 'Attached Browser',
      });
      await runtime.context.browser.createPage(attachedBrowser.id, {
        url: 'http://127.0.0.1:4173',
        binding: {
          kind: 'manual_url',
          runtimeSessionId: 'browser-runtime-session',
        },
      });

      const closedBrowser = await runtime.context.browser.createSession({
        label: 'Closed Browser',
      });
      await runtime.context.browser.createPage(closedBrowser.id, {
        path: '/tmp/browser-report.html',
        binding: {
          kind: 'manual_url',
        },
      });
      await runtime.context.browser.closeSession(closedBrowser.id);

      const runtimeResponse = await runtime.app.request('/diagnostics/runtime');
      expect(runtimeResponse.status).toBe(200);
      expect((await runtimeResponse.json()).runtime.browser).toEqual({
        filters: {},
        sessions: {
          total: 2,
          ready: 1,
          closed: 1,
        },
        pages: {
          total: 2,
          open: 1,
          closed: 1,
        },
        attachedRuntimeSessionCount: 1,
        drivers: [
          {
            driverId: 'manual',
            sessions: {
              total: 2,
              ready: 1,
              closed: 1,
            },
            pages: {
              total: 2,
              open: 1,
              closed: 1,
            },
          },
        ],
        cleanupCandidates: {
          olderThanMs: 1800000,
          sessionCount: 0,
          pageCount: 0,
          sessionIds: [],
        },
      });

      const healthResponse = await runtime.app.request('/diagnostics/health');
      expect(healthResponse.status).toBe(200);
      expect((await healthResponse.json()).browser).toEqual({
        summary: {
          totalSessions: 2,
          readySessions: 1,
          closedSessions: 1,
          totalPages: 2,
          openPages: 1,
          closedPages: 1,
          attachedRuntimeSessionCount: 1,
          cleanupCandidateSessions: 0,
          cleanupCandidatePages: 0,
          cleanupCandidateOlderThanMs: 1800000,
        },
      });
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 10000);

  it('surfaces retained worktree backlog on health diagnostics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-worktree-health-test-'));
    const paths = createRuntimeTestPaths(root);
    const configPath = paths.configPath;
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(configPath, 'providers: {}\n', 'utf8');

    const env = createRuntimeTestEnv(root, {
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
      AUGGIE_SESSIONS_DIR: join(root, '.augment', 'sessions'),
      CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
      CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
      COPILOT_SESSIONS_DIR: join(root, '.copilot', 'session-state'),
      CURSOR_CHATS_DIR: join(root, '.cursor', 'chats'),
      KIRO_DB_PATH: join(root, '.kiro', 'data.sqlite3'),
      PI_SESSIONS_DIR: join(root, '.pi', 'agent', 'sessions'),
    });

    ensureRuntimeTestDirs(createRuntimeTestPaths(root));

    for (const dir of [
      resolveEnvRuntimePaths(env).sessionBaseDir,
      resolveEnvRuntimePaths(env).dataDir,
      env.AUGGIE_SESSIONS_DIR,
      env.CLAUDE_PROJECTS_DIR,
      env.CODEX_SESSIONS_DIR,
      env.COPILOT_SESSIONS_DIR,
      env.CURSOR_CHATS_DIR,
      join(root, '.kiro'),
      join(root, '.junie', 'sessions'),
      env.PI_SESSIONS_DIR,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer(loadConfig(env));
    try {
      const repoDir = createGitWorkspace(root, 'runtime-health-worktree');
      const prepared = await prepareSessionWorkspace({
        sessionId: 'runtime-health-retained-worktree',
        sessionBaseDir: resolveEnvRuntimePaths(env).sessionBaseDir,
        cwd: repoDir,
        workspaceMode: 'shared',
        workspaceIsolationMode: 'worktree',
        now: new Date('2026-03-22T00:00:00.000Z'),
      });

      runtime.context.registry.create({
        id: 'runtime-health-retained-worktree',
        providerName: 'codex',
        cwd: prepared.cwd,
        workspaceMode: prepared.workspaceMode,
        workspaceIsolation: {
          ...prepared.workspaceIsolation,
          worktree: {
            ...prepared.workspaceIsolation.worktree!,
            lastCleanup: {
              policy: 'preserve',
              status: 'retained',
              observedAt: '2026-03-22T00:00:00.000Z',
              reasonCodes: ['worktree_preserved'],
              mergedPathCount: 0,
            },
          },
        },
      });
      runtime.context.registry.updateStatus('runtime-health-retained-worktree', 'closed');

      const response = await runtime.app.request('/diagnostics/health');
      expect(response.status).toBe(200);
      expect((await response.json()).worktrees).toEqual({
        summary: {
          retainedSessions: 1,
          attachedSessions: 0,
          cleanupEligibleSessions: 1,
          expiredSessions: 1,
          retainedTtlMs: 86400000,
          sweepIntervalMs: 60000,
          lastSweepAt: null,
          orphanedWorktrees: 0,
          failedOrphanedWorktrees: 0,
          autoCleanedRetainedSessions: 0,
          failedAutoCleanedRetainedSessions: 0,
        },
      });
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 10000);

  it('background worktree maintenance auto-cleans expired preserved delete sessions', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const repoDir = createGitWorkspace(
        runtime.context.config.dataDir || tmpdir(),
        'runtime-server-worktree-gc',
      );
      const prepared = await prepareSessionWorkspace({
        sessionId: 'runtime-server-worktree-gc',
        sessionBaseDir: runtime.context.config.sessionBaseDir,
        cwd: repoDir,
        workspaceMode: 'shared',
        workspaceIsolationMode: 'worktree',
        now: new Date('2026-03-20T00:00:00.000Z'),
      });
      const session = runtime.context.registry.create({
        id: 'runtime-server-worktree-gc',
        providerName: 'codex',
        cwd: prepared.cwd,
        workspaceMode: prepared.workspaceMode,
        workspaceIsolation: prepared.workspaceIsolation,
      });
      runtime.context.registry.updateStatus(session.id, 'closed');
      writeFileSync(join(prepared.cwd, 'tracked.txt'), 'preserve then gc\n', 'utf8');

      const retainedDelete = await runtime.app.request(`/sessions/${session.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          worktreeCleanupPolicy: 'preserve',
        }),
      });
      expect(retainedDelete.status).toBe(200);
      const retainedSession = runtime.context.registry.get(session.id);
      if (!retainedSession?.workspaceIsolation?.worktree?.lastCleanup) {
        throw new Error('expected retained worktree cleanup state');
      }
      retainedSession.workspaceIsolation.worktree.lastCleanup.observedAt = '2026-03-20T00:00:00.000Z';
      runtime.context.registry.flush();
      expect(runtime.context.registry.get(session.id)).toBeDefined();
      expect(existsSync(prepared.workspaceIsolation.worktree!.worktreePath)).toBe(true);

      const diagnosticsBeforeSweep = await runtime.app.request('/diagnostics/runtime');
      expect(diagnosticsBeforeSweep.status).toBe(200);
      expect((await diagnosticsBeforeSweep.json()).runtime.maintenance.worktrees.retained)
        .toEqual(expect.objectContaining({
          totalSessions: 1,
          attachedSessions: 0,
          cleanupEligibleSessions: 1,
          expiredSessions: 1,
          sampleSessionIds: ['runtime-server-worktree-gc'],
          expiredSampleSessionIds: ['runtime-server-worktree-gc'],
          policyCounts: {
            discard: 0,
            merge: 0,
            preserve: 1,
          },
          reasonCodeCounts: {
            sourceWorkspaceDirty: 0,
            worktreeDetachFailed: 0,
            worktreePreserved: 1,
            other: 0,
          },
          sessions: [
            expect.objectContaining({
              sessionId: 'runtime-server-worktree-gc',
              attached: false,
              cleanupEligible: true,
              policy: 'preserve',
              expired: true,
              reasonCodes: ['worktree_preserved'],
            }),
          ],
        }));

      const sweep = await runtime.context.worktreeMaintenance?.sweep();
      expect(sweep).toEqual(expect.objectContaining({
        expiredRetainedSessionIds: ['runtime-server-worktree-gc'],
        autoCleanedRetainedSessionIds: ['runtime-server-worktree-gc'],
        failedAutoCleanedRetainedSessionIds: [],
      }));
      expect(runtime.context.registry.get(session.id)).toBeUndefined();
      expect(existsSync(prepared.workspaceIsolation.worktree!.worktreePath)).toBe(false);
    });
  });

  it('GET /diagnostics/providers reports provider availability for hosts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-diagnostics-test-'));
    const paths = createRuntimeTestPaths(root);
    const configPath = paths.configPath;
    mkdirSync(paths.configDir, { recursive: true });
    vi.stubEnv('CATS_RUNTIME_TEST_ANTHROPIC_KEY', 'test-secret');

    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
routing:
  providers:
    codex:
      default_target:
        backend: cli
        instance: default
    claude:
      default_target:
        backend: api
        instance: sonnet
backends:
  cli:
    providers:
      codex:
        instances:
          default:
            environment: native
            command: ${JSON.stringify(process.execPath)}
            runner: direct
            sessions_dir: ~/.codex/sessions
  api:
    providers:
      claude:
        transport: anthropic
        api_key_env: CATS_RUNTIME_TEST_ANTHROPIC_KEY
        instances:
          sonnet:
            model: claude-sonnet-4-20250514
`.trimStart());

    const env = createRuntimeTestEnv(root, {
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
      CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
      CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    });

    ensureRuntimeTestDirs(createRuntimeTestPaths(root));

    for (const dir of [
      resolveEnvRuntimePaths(env).dataDir,
      resolveEnvRuntimePaths(env).sessionBaseDir,
      env.CODEX_SESSIONS_DIR,
      env.CLAUDE_PROJECTS_DIR,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer(loadConfig(env));
    try {
      const response = await runtime.app.request('/diagnostics/providers');
      expect(response.status).toBe(200);
      const payload = await response.json() as Record<string, any>;
      expect(payload).toMatchObject({
        service: 'cats-runtime',
        version: RUNTIME_VERSION,
        timestamp: expect.any(String),
        probe: 'light',
        query: {
          hasFilters: false,
          filters: {},
        },
        readiness: {
          endpoint: '/health',
          authoritative: true,
          readySignal: 'http',
          phase: 'starting',
          ready: false,
        },
        summary: {
          status: 'degraded',
          summary: '2 provider target(s) need attention.',
          configuredProviders: 2,
          targets: 2,
          defaultTargets: 2,
          ok: 0,
          degraded: 2,
          unavailable: 0,
        },
        providers: expect.arrayContaining([
          expect.objectContaining({
            provider: 'claude',
            backend: 'api',
            instance: 'sonnet',
            target: 'api/sonnet',
            availability: expect.objectContaining({
              status: 'degraded',
              probe: 'light',
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'api_key_present',
                status: 'ok',
              }),
              expect.objectContaining({
                code: 'live_probe_unimplemented',
                status: 'degraded',
              }),
            ]),
          }),
          expect.objectContaining({
            provider: 'codex',
            backend: 'cli',
            instance: 'default',
            target: 'cli/default',
            defaultTarget: true,
            availability: expect.objectContaining({
              status: 'degraded',
              probe: 'light',
            }),
            setup: expect.objectContaining({
              prerequisites: expect.arrayContaining([
                expect.objectContaining({
                  id: 'node',
                }),
                expect.objectContaining({
                  id: 'npm',
                }),
              ]),
              command: expect.objectContaining({
                status: 'ready',
              }),
              install: expect.objectContaining({
                provider: 'codex',
                installPack: 'npm-global',
              }),
              npm: expect.objectContaining({
                packageName: '@openai/codex',
              }),
            }),
            compatibility: expect.objectContaining({
              classification: 'degraded',
              profile: expect.objectContaining({
                id: 'codex-cli-json-rpc-best-fit',
              }),
              evidence: expect.objectContaining({
                relativePath: expect.stringContaining('codex/'),
              }),
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'command_available',
                status: 'ok',
              }),
              expect.objectContaining({
                code: 'profile_selected',
                status: 'degraded',
              }),
            ]),
          }),
        ]),
      });
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it('GET /diagnostics/health summarizes runtime and default provider readiness for hosts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-health-summary-test-'));
    const paths = createRuntimeTestPaths(root);
    const configPath = paths.configPath;
    mkdirSync(paths.configDir, { recursive: true });
    vi.stubEnv('CATS_RUNTIME_TEST_ANTHROPIC_KEY', 'test-secret');

    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
routing:
  providers:
    codex:
      default_target:
        backend: cli
        instance: default
    claude:
      default_target:
        backend: api
        instance: sonnet
backends:
  cli:
    providers:
      codex:
        instances:
          default:
            environment: native
            command: ${JSON.stringify(process.execPath)}
            runner: direct
            sessions_dir: ~/.codex/sessions
  api:
    providers:
      claude:
        transport: anthropic
        api_key_env: CATS_RUNTIME_TEST_ANTHROPIC_KEY
        instances:
          sonnet:
            model: claude-sonnet-4-20250514
`.trimStart());

    const env = createRuntimeTestEnv(root, {
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
      CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
      CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    });

    ensureRuntimeTestDirs(createRuntimeTestPaths(root));

    for (const dir of [
      resolveEnvRuntimePaths(env).dataDir,
      resolveEnvRuntimePaths(env).sessionBaseDir,
      env.CODEX_SESSIONS_DIR,
      env.CLAUDE_PROJECTS_DIR,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer(loadConfig(env));
    try {
      const response = await runtime.app.request('/diagnostics/health');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        service: 'cats-runtime',
        version: RUNTIME_VERSION,
        timestamp: expect.any(String),
        status: 'degraded',
        contract: {
          startup: RUNTIME_STARTUP_CONTRACT_VERSION,
          diagnostics: RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
          supportedModes: ['standalone', 'app-managed'],
          readinessPath: '/health',
          lifecycleEvents: [
            'runtime.ready',
            'runtime.startup_error',
            'runtime.stopping',
            'runtime.stopped',
          ],
          shutdownSignals: [...RUNTIME_SHUTDOWN_SIGNALS],
          shutdownReasons: [...RUNTIME_SHUTDOWN_REASONS],
          endpoints: {
            health: '/health',
            runtime: RUNTIME_DIAGNOSTICS_PATHS.runtime,
            providers: RUNTIME_DIAGNOSTICS_PATHS.providers,
            summary: RUNTIME_DIAGNOSTICS_PATHS.health,
          },
        },
        readiness: {
          endpoint: '/health',
          authoritative: true,
          readySignal: 'http',
          phase: 'starting',
          ready: false,
        },
        runtime: {
          status: 'degraded',
          summary: 'Runtime is starting and is not ready yet.',
          startup: expect.objectContaining({
            contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
            mode: 'standalone',
            phase: 'starting',
            readySignal: 'http',
            ready: false,
          }),
          shutdown: {
            signals: [...RUNTIME_SHUTDOWN_SIGNALS],
            reasons: [...RUNTIME_SHUTDOWN_REASONS],
            stdinCloseEnabled: false,
          },
          executionStrategies: {
            totalFamilies: 7,
            supportedFamilies: 7,
            fallbackOnlyFamilies: 0,
            compatibilityDefault: 'simple_tool_call',
            runtimeHostedBackends: ['api', 'local'],
            summary: '7 runtime-hosted strategy families are available for api/local loops.',
          },
        },
        providers: {
          probe: 'light',
          summary: {
            status: 'degraded',
            summary: '2 provider target(s) need attention.',
            configuredProviders: 2,
            targets: 2,
            defaultTargets: 2,
            ok: 0,
            degraded: 2,
            unavailable: 0,
          },
          defaults: expect.arrayContaining([
            expect.objectContaining({
              provider: 'claude',
              target: 'api/sonnet',
              status: 'degraded',
            }),
            expect.objectContaining({
              provider: 'codex',
              target: 'cli/default',
              status: 'degraded',
            }),
          ]),
        },
        peers: expect.objectContaining({
          enabled: false,
          status: 'disabled',
          localPeerId: expect.any(String),
          registry: {
            total: 0,
            self: 0,
            remote: 0,
            alive: 0,
            stale: 0,
            trusted: 0,
            unknown: 0,
            rejected: 0,
          },
          adapters: expect.arrayContaining([
            expect.objectContaining({
              id: 'self',
              kind: 'self',
              state: 'idle',
              publishedPeers: 0,
            }),
          ]),
        }),
        worktrees: {
          summary: {
            retainedSessions: 0,
            attachedSessions: 0,
            cleanupEligibleSessions: 0,
            expiredSessions: 0,
            retainedTtlMs: 86400000,
            sweepIntervalMs: 60000,
            lastSweepAt: null,
            orphanedWorktrees: 0,
            failedOrphanedWorktrees: 0,
            autoCleanedRetainedSessions: 0,
            failedAutoCleanedRetainedSessions: 0,
          },
        },
        browser: {
          summary: {
            totalSessions: 0,
            readySessions: 0,
            closedSessions: 0,
            totalPages: 0,
            openPages: 0,
            closedPages: 0,
            attachedRuntimeSessionCount: 0,
            cleanupCandidateSessions: 0,
            cleanupCandidatePages: 0,
            cleanupCandidateOlderThanMs: 1800000,
          },
        },
        browserDrivers: {
          summary: {
            totalDrivers: 1,
            readyDrivers: 1,
            degradedDrivers: 0,
            unsupportedDrivers: 0,
            persistentSessionDrivers: 1,
            liveAutomationDrivers: 0,
            manualUrlEntryDrivers: 1,
            summary: '1 browser driver(s) are registered for runtime preview flows.',
          },
        },
        pool: {
          summary: {
            active: 0,
            busy: 0,
            idle: 0,
            providerCount: 0,
            backends: ['cli', 'api', 'agent'],
            summary: 'Runtime pool tracks 0 active session(s) across 0 provider(s).',
          },
        },
        management: {
          adapters: {
            totalAdapters: 2,
            totalDomains: 2,
            readOnlyActions: 6,
            mutatingActions: 2,
            transports: {
              cli: 2,
              api: 0,
            },
            summary: '2 management adapter(s) cover 2 domain(s) with 6 read-only and 2 mutating actions.',
          },
          summary: {
            total: 0,
            polling: 0,
            completed: 0,
            failed: 0,
            oldestStartedAt: null,
            latestUpdatedAt: null,
          },
        },
        delivery: {
          summary: {
            totalActions: 5,
            readOnlyActions: 2,
            mutatingActions: 3,
          },
        },
        tools: {
          summary: expect.objectContaining({
            profiles: expect.objectContaining({
              standard: expect.objectContaining({
                totalTools: expect.any(Number),
              }),
              extended: expect.objectContaining({
                totalTools: expect.any(Number),
              }),
              readOnly: expect.objectContaining({
                totalTools: expect.any(Number),
              }),
            }),
            summary: expect.stringContaining('Runtime tooling exposes'),
          }),
        },
        skills: {
          summary: expect.objectContaining({
            state: 'loaded',
            totalSkills: expect.any(Number),
            summary: expect.stringContaining('runtime skill'),
          }),
        },
        setup: {
          bootstrapRequired: false,
          latestReport: null,
        },
        wakeups: {
          status: 'ok',
          summary: 'No wakeup requests are tracked.',
          totalRequests: 0,
          openRequests: 0,
          scheduled: 0,
          due: 0,
          triggering: 0,
          recurring: 0,
          terminal: 0,
          triggered: 0,
          cancelled: 0,
          failed: 0,
          sessionsWithPending: 0,
          nextScheduledAt: null,
        },
        metering: {
          status: 'ok',
          summary: 'No active metering incidents or guardrails.',
          usageRecords: 0,
          incidents: 0,
          activeGuardrails: 0,
          activeCooldowns: 0,
          activeBlocks: 0,
        },
      });
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it('surfaces management operation aggregates on runtime and health diagnostics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-management-health-test-'));
    const paths = createRuntimeTestPaths(root);
    const configPath = paths.configPath;
    mkdirSync(paths.configDir, { recursive: true });

    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
routing:
  providers:
    codex:
      default_target:
        backend: cli
        instance: default
backends:
  cli:
    providers:
      codex:
        instances:
          default:
            environment: native
            command: ${JSON.stringify(process.execPath)}
            runner: direct
            sessions_dir: ~/.codex/sessions
`.trimStart());

    const env = createRuntimeTestEnv(root, {
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
      CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
    });

    ensureRuntimeTestDirs(createRuntimeTestPaths(root));

    for (const dir of [
      resolveEnvRuntimePaths(env).dataDir,
      resolveEnvRuntimePaths(env).sessionBaseDir,
      env.CODEX_SESSIONS_DIR,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer(loadConfig(env));
    try {
      const management = getRuntimeManagementService(runtime.context);
      const completed = management.operations.create();
      management.operations.complete(completed.operationId, {
        _requestContext: {
          domain: 'review',
          action: 'wait_review_checks',
          adapter: 'github',
        },
      });

      const polling = management.operations.create(15_000);
      management.operations.update(polling.operationId, 'polling', {
        _requestContext: {
          domain: 'deployment',
          action: 'create_deployment',
          adapter: 'zeabur',
        },
      });

      const runtimeResponse = await runtime.app.request('/diagnostics/runtime');
      expect(runtimeResponse.status).toBe(200);
      const runtimePayload = await runtimeResponse.json() as {
        runtime: {
          management: {
            adapters: {
              summary: string;
            };
            operations: {
              total: number;
              polling: number;
              completed: number;
              failed: number;
              oldestStartedAt: string | null;
              latestUpdatedAt: string | null;
            };
          };
        };
      };
      expect(runtimePayload.runtime.management).toEqual(expect.objectContaining({
        adapters: expect.objectContaining({
          summary: expect.objectContaining({
            summary: expect.stringContaining('management adapter'),
          }),
        }),
        operations: expect.objectContaining({
          total: 2,
          polling: 1,
          completed: 1,
          failed: 0,
          oldestStartedAt: expect.any(String),
          latestUpdatedAt: expect.any(String),
        }),
      }));

      const healthResponse = await runtime.app.request('/diagnostics/health');
      expect(healthResponse.status).toBe(200);
      const healthPayload = await healthResponse.json() as {
        management: {
          adapters: {
            summary: string;
          };
          summary: {
            total: number;
            polling: number;
            completed: number;
            failed: number;
            oldestStartedAt: string | null;
            latestUpdatedAt: string | null;
          };
        };
      };
      expect(healthPayload.management).toEqual(expect.objectContaining({
        adapters: expect.objectContaining({
          summary: expect.stringContaining('management adapter'),
        }),
        summary: expect.objectContaining({
          total: 2,
          polling: 1,
          completed: 1,
          failed: 0,
          oldestStartedAt: expect.any(String),
          latestUpdatedAt: expect.any(String),
        }),
      }));
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('surfaces latest setup diagnostic report summary on runtime and health diagnostics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-setup-diagnostics-health-test-'));
    const paths = createRuntimeTestPaths(root);
    const configPath = paths.configPath;
    mkdirSync(paths.configDir, { recursive: true });

    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
routing:
  providers:
    codex:
      default_target:
        backend: cli
        instance: default
backends:
  cli:
    providers:
      codex:
        instances:
          default:
            environment: native
            command: ${JSON.stringify(process.execPath)}
            runner: direct
            sessions_dir: ~/.codex/sessions
`.trimStart());

    const env = createRuntimeTestEnv(root, {
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
      CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
    });

    ensureRuntimeTestDirs(createRuntimeTestPaths(root));

    for (const dir of [
      resolveEnvRuntimePaths(env).dataDir,
      resolveEnvRuntimePaths(env).sessionBaseDir,
      env.CODEX_SESSIONS_DIR,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer(loadConfig(env), {
      startup: createRuntimeStartupState({ bootstrapRequired: true }),
    });
    try {
      const generateResponse = await runtime.app.request('/diagnostics/setup-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshScan: false }),
      });
      expect(generateResponse.status).toBe(200);
      const generated = await generateResponse.json() as {
        report: {
          artifactId: string;
          generatedAt: string;
          summary: {
            status: 'ok' | 'degraded' | 'unavailable';
            issueCounts: {
              info: number;
              warnings: number;
              errors: number;
            };
            headline: string;
            highlights: string[];
          };
        };
      };

      const runtimeResponse = await runtime.app.request('/diagnostics/runtime');
      expect(runtimeResponse.status).toBe(200);
      const runtimePayload = await runtimeResponse.json() as {
        runtime: {
          setup: {
            bootstrapRequired: boolean;
            latestReport: {
              artifactId: string;
              generatedAt: string;
              status: 'ok' | 'degraded' | 'unavailable';
              issueCounts: {
                info: number;
                warnings: number;
                errors: number;
              };
              headline: string;
              highlights: string[];
            } | null;
          };
        };
      };
      expect(runtimePayload.runtime.setup).toEqual({
        bootstrapRequired: true,
        latestReport: {
          artifactId: generated.report.artifactId,
          generatedAt: generated.report.generatedAt,
          status: generated.report.summary.status,
          issueCounts: generated.report.summary.issueCounts,
          headline: generated.report.summary.headline,
          highlights: generated.report.summary.highlights,
        },
      });

      const healthResponse = await runtime.app.request('/diagnostics/health');
      expect(healthResponse.status).toBe(200);
      const healthPayload = await healthResponse.json() as {
        setup: {
          bootstrapRequired: boolean;
          latestReport: {
            artifactId: string;
            generatedAt: string;
            status: 'ok' | 'degraded' | 'unavailable';
            issueCounts: {
              info: number;
              warnings: number;
              errors: number;
            };
            headline: string;
            highlights: string[];
          } | null;
        };
      };
      expect(healthPayload.setup).toEqual({
        bootstrapRequired: true,
        latestReport: {
          artifactId: generated.report.artifactId,
          generatedAt: generated.report.generatedAt,
          status: generated.report.summary.status,
          issueCounts: generated.report.summary.issueCounts,
          headline: generated.report.summary.headline,
          highlights: generated.report.summary.highlights,
        },
      });
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('GET /diagnostics/health ignores non-default provider targets in the aggregate summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-health-defaults-only-test-'));
    const paths = createRuntimeTestPaths(root);
    const configPath = paths.configPath;
    mkdirSync(paths.configDir, { recursive: true });

    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
routing:
  providers:
    codex:
      default_target:
        backend: cli
        instance: default
backends:
  cli:
    providers:
      codex:
        instances:
          default:
            environment: native
            command: ${JSON.stringify(process.execPath)}
            runner: direct
            sessions_dir: ~/.codex/sessions
  api:
    providers:
      codex:
        transport: openai
        api_key_env: OPENAI_API_KEY
        instances:
          main:
            model: gpt-5.2-codex
`.trimStart());

    const env = createRuntimeTestEnv(root, {
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
      CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
    });

    ensureRuntimeTestDirs(createRuntimeTestPaths(root));

    for (const dir of [
      resolveEnvRuntimePaths(env).dataDir,
      resolveEnvRuntimePaths(env).sessionBaseDir,
      env.CODEX_SESSIONS_DIR,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer(loadConfig(env));
    try {
      const response = await runtime.app.request('/diagnostics/health');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expect.objectContaining({
        status: 'degraded',
        providers: {
          probe: 'light',
          summary: {
            status: 'degraded',
            summary: '1 provider target(s) need attention.',
            configuredProviders: 1,
            targets: 1,
            defaultTargets: 1,
            ok: 0,
            degraded: 1,
            unavailable: 0,
          },
          defaults: [
            expect.objectContaining({
              provider: 'codex',
              target: 'cli/default',
              status: 'degraded',
            }),
          ],
        },
      }));
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('GET /diagnostics/health stays degraded when only some provider targets are unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-health-partial-provider-outage-test-'));
    const paths = createRuntimeTestPaths(root);
    const configPath = paths.configPath;
    mkdirSync(paths.configDir, { recursive: true });
    vi.stubEnv('CATS_RUNTIME_TEST_ANTHROPIC_KEY', 'test-secret');

    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
routing:
  providers:
    codex:
      default_target:
        backend: cli
        instance: missing
    claude:
      default_target:
        backend: api
        instance: sonnet
backends:
  cli:
    providers:
      codex:
        instances:
          missing:
            environment: native
            command: command-that-does-not-exist-for-cats-runtime-tests
            runner: direct
            sessions_dir: ~/.codex/sessions
  api:
    providers:
      claude:
        transport: anthropic
        api_key_env: CATS_RUNTIME_TEST_ANTHROPIC_KEY
        instances:
          sonnet:
            model: claude-sonnet-4-20250514
`.trimStart());

    const env = createRuntimeTestEnv(root, {
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
      CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
      CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    });

    ensureRuntimeTestDirs(createRuntimeTestPaths(root));

    for (const dir of [
      resolveEnvRuntimePaths(env).dataDir,
      resolveEnvRuntimePaths(env).sessionBaseDir,
      env.CODEX_SESSIONS_DIR,
      env.CLAUDE_PROJECTS_DIR,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer({
      ...loadConfig(env),
      port: 0,
    });
    try {
      const address = await runtime.start();
      const response = await fetch(`http://${address.host}:${address.port}/diagnostics/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        service: 'cats-runtime',
        version: RUNTIME_VERSION,
        timestamp: expect.any(String),
        status: 'degraded',
        contract: {
          startup: RUNTIME_STARTUP_CONTRACT_VERSION,
          diagnostics: RUNTIME_DIAGNOSTICS_CONTRACT_VERSION,
          supportedModes: ['standalone', 'app-managed'],
          readinessPath: '/health',
          lifecycleEvents: [
            'runtime.ready',
            'runtime.startup_error',
            'runtime.stopping',
            'runtime.stopped',
          ],
          shutdownSignals: [...RUNTIME_SHUTDOWN_SIGNALS],
          shutdownReasons: [...RUNTIME_SHUTDOWN_REASONS],
          endpoints: {
            health: '/health',
            runtime: RUNTIME_DIAGNOSTICS_PATHS.runtime,
            providers: RUNTIME_DIAGNOSTICS_PATHS.providers,
            summary: RUNTIME_DIAGNOSTICS_PATHS.health,
          },
        },
        readiness: {
          endpoint: '/health',
          authoritative: true,
          readySignal: 'http',
          phase: 'ready',
          ready: true,
        },
        runtime: {
          status: 'ok',
          summary: 'Runtime is ready to accept requests.',
          startup: expect.objectContaining({
            contractVersion: RUNTIME_STARTUP_CONTRACT_VERSION,
            mode: 'standalone',
            phase: 'ready',
            readySignal: 'http',
            ready: true,
            address: {
              host: address.host,
              port: address.port,
              healthUrl: `http://${address.host}:${address.port}/health`,
            },
          }),
          shutdown: {
            signals: [...RUNTIME_SHUTDOWN_SIGNALS],
            reasons: [...RUNTIME_SHUTDOWN_REASONS],
            stdinCloseEnabled: false,
          },
          executionStrategies: {
            totalFamilies: 7,
            supportedFamilies: 7,
            fallbackOnlyFamilies: 0,
            compatibilityDefault: 'simple_tool_call',
            runtimeHostedBackends: ['api', 'local'],
            summary: '7 runtime-hosted strategy families are available for api/local loops.',
          },
        },
        providers: {
          probe: 'light',
          summary: {
            status: 'degraded',
            summary: '2 provider target(s) need attention.',
            configuredProviders: 2,
            targets: 2,
            defaultTargets: 2,
            ok: 0,
            degraded: 1,
            unavailable: 1,
          },
          defaults: expect.arrayContaining([
            expect.objectContaining({
              provider: 'claude',
              target: 'api/sonnet',
              status: 'degraded',
              summary: expect.stringContaining('light diagnostics'),
            }),
            expect.objectContaining({
              provider: 'codex',
              target: 'cli/missing',
              status: 'unavailable',
              summary: expect.stringContaining('Failed to execute compatibility probe'),
            }),
          ]),
        },
        peers: expect.objectContaining({
          enabled: false,
          status: 'disabled',
          localPeerId: expect.any(String),
          registry: {
            total: 0,
            self: 0,
            remote: 0,
            alive: 0,
            stale: 0,
            trusted: 0,
            unknown: 0,
            rejected: 0,
          },
          adapters: expect.arrayContaining([
            expect.objectContaining({
              id: 'self',
              kind: 'self',
              state: 'idle',
              publishedPeers: 0,
            }),
          ]),
        }),
        worktrees: {
          summary: {
            retainedSessions: 0,
            attachedSessions: 0,
            cleanupEligibleSessions: 0,
            expiredSessions: 0,
            retainedTtlMs: 86400000,
            sweepIntervalMs: 60000,
            lastSweepAt: expect.any(String),
            orphanedWorktrees: 0,
            failedOrphanedWorktrees: 0,
            autoCleanedRetainedSessions: 0,
            failedAutoCleanedRetainedSessions: 0,
          },
        },
        browser: {
          summary: {
            totalSessions: 0,
            readySessions: 0,
            closedSessions: 0,
            totalPages: 0,
            openPages: 0,
            closedPages: 0,
            attachedRuntimeSessionCount: 0,
            cleanupCandidateSessions: 0,
            cleanupCandidatePages: 0,
            cleanupCandidateOlderThanMs: 1800000,
          },
        },
        browserDrivers: {
          summary: {
            totalDrivers: 1,
            readyDrivers: 1,
            degradedDrivers: 0,
            unsupportedDrivers: 0,
            persistentSessionDrivers: 1,
            liveAutomationDrivers: 0,
            manualUrlEntryDrivers: 1,
            summary: '1 browser driver(s) are registered for runtime preview flows.',
          },
        },
        pool: {
          summary: {
            active: 0,
            busy: 0,
            idle: 0,
            providerCount: 0,
            backends: ['cli', 'api', 'agent'],
            summary: 'Runtime pool tracks 0 active session(s) across 0 provider(s).',
          },
        },
        management: {
          adapters: {
            totalAdapters: 2,
            totalDomains: 2,
            readOnlyActions: 6,
            mutatingActions: 2,
            transports: {
              cli: 2,
              api: 0,
            },
            summary: '2 management adapter(s) cover 2 domain(s) with 6 read-only and 2 mutating actions.',
          },
          summary: {
            total: 0,
            polling: 0,
            completed: 0,
            failed: 0,
            oldestStartedAt: null,
            latestUpdatedAt: null,
          },
        },
        delivery: {
          summary: {
            totalActions: 5,
            readOnlyActions: 2,
            mutatingActions: 3,
          },
        },
        tools: {
          summary: {
            profiles: {
              standard: {
                totalTools: expect.any(Number),
                mutatingTools: expect.any(Number),
                readOnlyCompatibleTools: expect.any(Number),
                domains: expect.objectContaining({
                  filesystem: expect.any(Number),
                  workspace: expect.any(Number),
                }),
              },
              extended: {
                totalTools: expect.any(Number),
                mutatingTools: expect.any(Number),
                readOnlyCompatibleTools: expect.any(Number),
                domains: expect.objectContaining({
                  filesystem: expect.any(Number),
                  workspace: expect.any(Number),
                }),
              },
              readOnly: {
                totalTools: expect.any(Number),
                mutatingTools: 0,
                readOnlyCompatibleTools: expect.any(Number),
                domains: expect.objectContaining({
                  filesystem: expect.any(Number),
                  workspace: expect.any(Number),
                }),
              },
            },
            summary: expect.stringContaining('Runtime tooling exposes'),
          },
        },
        skills: {
          summary: {
            state: 'loaded',
            totalSkills: expect.any(Number),
            summary: expect.stringMatching(/runtime skill\(s\) across 4 families are available\./),
          },
        },
        setup: {
          bootstrapRequired: false,
          latestReport: null,
        },
        wakeups: {
          status: 'ok',
          summary: 'No wakeup requests are tracked.',
          totalRequests: 0,
          openRequests: 0,
          scheduled: 0,
          due: 0,
          triggering: 0,
          recurring: 0,
          terminal: 0,
          triggered: 0,
          cancelled: 0,
          failed: 0,
          sessionsWithPending: 0,
          nextScheduledAt: null,
        },
        metering: {
          status: 'ok',
          summary: 'No active metering incidents or guardrails.',
          usageRecords: 0,
          incidents: 0,
          activeGuardrails: 0,
          activeCooldowns: 0,
          activeBlocks: 0,
        },
      });
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it('runtime.start rejects when the configured port is already occupied', async () => {
    const occupiedServer = createServer();
    occupiedServer.listen(0, '127.0.0.1');
    await once(occupiedServer, 'listening');
    const address = occupiedServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve occupied test port');
    }
    const port = address.port;

    const { config, cleanup } = createTestConfig();
    const runtime = createRuntimeServer({
      ...config,
      host: '127.0.0.1',
      port,
    }, {
      startup: createRuntimeStartupState({
        mode: 'app-managed',
        managedBy: 'cats-inc',
        readyOutput: 'json',
      }),
    });

    try {
      await expect(runtime.start()).rejects.toThrow(/EADDRINUSE/);
      expect(runtime.context.startup.ready).toBe(false);
      expect(runtime.context.startup.phase).toBe('starting');
    } finally {
      await runtime.close();
      await new Promise<void>((resolveClose, rejectClose) => {
        occupiedServer.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
      await cleanup();
    }
  });

  it('GET /sessions returns the embedded registry state', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/sessions');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        sessions: [],
        count: 0,
      });
    });
  });

  it('GET /sessions/:id/history does not parse Antigravity sources with the legacy Gemini JSON parser', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const transcriptPath = join(runtime.context.config.sessionBaseDir, 'antigravity-provider.json');
      writeFileSync(transcriptPath, JSON.stringify({
        messages: [
          { type: 'user', content: 'legacy Gemini-shaped prompt', timestamp: '2026-05-24T00:00:00.000Z' },
          { type: 'gemini', content: [{ text: 'legacy Gemini-shaped response' }], timestamp: '2026-05-24T00:00:01.000Z' },
        ],
      }), 'utf8');

      const session = runtime.context.registry.create({
        id: 'antigravity-json-history',
        providerName: 'antigravity',
        providerBackend: 'cli',
        cwd: runtime.context.config.sessionBaseDir,
        model: 'antigravity-default',
      });
      session.providerSourcePath = transcriptPath;

      const response = await runtime.app.request(`/sessions/${session.id}/history`);
      expect(response.status).toBe(200);
      const payload = await response.json() as {
        messages: unknown[];
        transcript: {
          ownership: string;
          source: string;
          parser: string;
          sources?: Array<Record<string, unknown>>;
        };
      };
      expect(payload.messages).toEqual([]);
      expect(payload.transcript).toEqual(expect.objectContaining({
        ownership: 'provider',
        source: 'jsonl',
        parser: 'generic_jsonl',
        sources: [
          expect.objectContaining({
            ownership: 'provider',
            source: 'jsonl',
            parser: 'generic_jsonl',
            path: transcriptPath,
            messageCount: 0,
          }),
        ],
      }));
    });
  });

  it('POST /sessions rejects unknown providers before spawning', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'unknown-cli', cwd: 'C:/repo' }),
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toMatch(/Unknown provider 'unknown-cli'/);
    });
  });

  it('GET /kiro/models returns the local catalog without an upstream proxy', async () => {
    await withRuntime({ kiroRuntime: { mode: 'wsl' } }, {}, async (runtime) => {
      const response = await runtime.app.request('/kiro/models');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        instance: 'native',
        runtime: { mode: 'wsl' },
        source: 'static',
        models: ['claude-sonnet-4.5', 'deepseek-3.2', 'minimax-m2.1'],
      });
    });
  });

  it('GET /providers/:provider/tools keeps CLI tooling ownership honest', async () => {
    await withRuntime({
      providerDefaultTargets: {
        cursor: { backend: 'cli', instance: 'ubuntu' },
      },
      providerDefaultInstances: {
        cursor: 'ubuntu',
      },
      providerInstances: {
        auggie: {},
        claude: {},
        codex: {},
        copilot: {},
        cursor: {
          ubuntu: {
            id: 'ubuntu',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'wsl', distro: 'Ubuntu', environmentId: 'ubuntu' },
            },
            cursorChatsDir: '/wsl/ubuntu/.cursor/chats',
          },
        },
        antigravity: {},
        goose: {},
        junie: {},
        kiro: {},
        kilo: {},
        opencode: {},
        pi: {},
      },
    }, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/cursor/tools?instance=cli/ubuntu');
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        provider: 'cursor',
        backend: 'cli',
        instance: 'ubuntu',
        target: 'cli/ubuntu',
        catalogContext: {
          scope: 'catalog',
        },
        continuity: {
          source: 'provider_native',
          summary: expect.stringContaining('CLI provider owns native conversation continuity'),
          resume: true,
          fork: false,
          permissions: false,
          providerManagedSessions: true,
          sessionKey: false,
          providerSessionState: false,
          remoteCancel: false,
        },
        source: 'provider_native',
        discoverable: false,
        sessionScopedOverrides: false,
        summary: expect.stringContaining('provider-native tools'),
        observability: {
          catalog: 'not_enumerated',
          toolCallEvents: false,
          runtimeServices: false,
        },
      }));
    });
  });

  it('GET /providers/:provider/tools exposes runtime-local per-tool catalog truth for API targets', async () => {
    await withRuntime({
      providerDefaultTargets: {
        codex: { backend: 'api', instance: 'main' },
      },
      remoteProviderCatalog: {
        api: {
          codex: {
            main: {
              id: 'main',
              providerName: 'codex',
              backend: 'api',
              transport: 'openai',
              apiKeyEnv: 'OPENAI_API_KEY',
              baseUrl: 'https://example.test',
              model: 'gpt-5.4',
              toolProfile: 'extended',
            },
          },
        },
        local: {},
        agent: {},
      },
    }, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/codex/tools?instance=api/main');
      expect(response.status).toBe(200);
      const payload = await response.json() as Record<string, any>;
      expect(payload).toMatchObject({
        provider: 'codex',
        backend: 'api',
        instance: 'main',
        target: 'api/main',
        source: 'runtime_local',
        discoverable: true,
        sessionScopedOverrides: true,
        catalog: expect.objectContaining({
          source: 'runtime_local',
          toolCount: expect.any(Number),
          summary: expect.stringContaining("Per-tool defaultAccess reflects the 'extended' profile"),
          tools: expect.arrayContaining([
            expect.objectContaining({
              name: 'copy_file',
              defaultAccess: 'full_access',
              profileAccess: {
                standard: 'blocked',
                extended: 'full_access',
                read_only: 'blocked',
              },
            }),
            expect.objectContaining({
              name: 'inspect_paths',
              defaultAccess: 'full_access',
              profileAccess: {
                standard: 'full_access',
                extended: 'full_access',
                read_only: 'full_access',
              },
            }),
          ]),
        }),
        policy: expect.objectContaining({
          profile: 'extended',
          fullAccessTools: expect.arrayContaining(['copy_file', 'inspect_paths']),
        }),
      });
    });
  });

  it('GET /providers/config returns configured provider instances for the dashboard', async () => {
    const cursorStaticModelCount = getBundledCursorStaticModelCount();
    await withRuntime({
      providerDefaultInstances: {
        cursor: 'ubuntu',
      },
      providerInstances: {
        auggie: {},
        claude: {},
        codex: {},
        copilot: {},
        cursor: {
          ubuntu: {
            id: 'ubuntu',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'wsl', distro: 'Ubuntu', environmentId: 'ubuntu' },
            },
            cursorChatsDir: '/wsl/ubuntu/.cursor/chats',
          },
          debian: {
            id: 'debian',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'wsl', distro: 'Debian', environmentId: 'debian' },
            },
            cursorChatsDir: '/wsl/debian/.cursor/chats',
          },
        },
        antigravity: {},
        kiro: {},
        opencode: {},
        pi: {},
        goose: {},
        junie: {},
      },
    }, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/config');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expect.objectContaining({
        providers: expect.objectContaining({
          cursor: expect.objectContaining({
            defaultInstance: 'ubuntu',
            defaultBackend: 'cli',
            instances: [
              expect.objectContaining({
                id: 'ubuntu',
                target: 'cli/ubuntu',
                backend: 'cli',
                command: 'cursor-agent',
                runner: 'auto',
                runtime: { mode: 'wsl', distro: 'Ubuntu', environmentId: 'ubuntu' },
                continuity: expect.objectContaining({
                  source: 'provider_native',
                  summary: expect.stringContaining('CLI provider owns native conversation continuity'),
                  resume: true,
                  fork: false,
                  permissions: false,
                  providerManagedSessions: true,
                  sessionKey: false,
                  providerSessionState: false,
                  remoteCancel: false,
                }),
                metering: expectIdleMeteringSummary(),
                modelCatalog: expect.objectContaining({
                  source: 'static',
                  defaultModel: 'composer-2-fast',
                  modelCount: cursorStaticModelCount,
                  warnings: [
                    'Live model discovery is available for cursor/cli/ubuntu via `cursor-agent --list-models`, but this read is serving the curated static fallback until an explicit refresh populates the cache.',
                  ],
                  statusCounts: {
                    configured: 0,
                    available: 0,
                    running: 0,
                    unknown: cursorStaticModelCount,
                  },
                }),
                tooling: {
                  source: 'provider_native',
                  discoverable: false,
                  sessionScopedOverrides: false,
                  summary: expect.stringContaining('provider-native tools'),
                  observability: {
                    catalog: 'not_enumerated',
                    toolCallEvents: false,
                    runtimeServices: false,
                  },
                },
                install: expect.objectContaining({
                  provider: 'cursor',
                  executionPlatform: 'linux',
                  prerequisites: expect.arrayContaining([
                    expect.objectContaining({
                      id: 'bash',
                    }),
                    expect.objectContaining({
                      id: 'curl',
                    }),
                  ]),
                  path: expect.objectContaining({
                    persistenceEntry: '.local/bin',
                  }),
                  install: expect.objectContaining({
                    installerId: 'cursor-agent',
                  }),
                }),
                compatibility: null,
              }),
              expect.objectContaining({
                id: 'debian',
                target: 'cli/debian',
                backend: 'cli',
                command: 'cursor-agent',
                runner: 'auto',
                runtime: { mode: 'wsl', distro: 'Debian', environmentId: 'debian' },
                continuity: expect.objectContaining({
                  source: 'provider_native',
                  summary: expect.stringContaining('CLI provider owns native conversation continuity'),
                  resume: true,
                  fork: false,
                  permissions: false,
                  providerManagedSessions: true,
                  sessionKey: false,
                  providerSessionState: false,
                  remoteCancel: false,
                }),
                metering: expectIdleMeteringSummary(),
                modelCatalog: expect.objectContaining({
                  source: 'static',
                  defaultModel: 'composer-2-fast',
                  modelCount: cursorStaticModelCount,
                  warnings: [
                    'Live model discovery is available for cursor/cli/debian via `cursor-agent --list-models`, but this read is serving the curated static fallback until an explicit refresh populates the cache.',
                  ],
                  statusCounts: {
                    configured: 0,
                    available: 0,
                    running: 0,
                    unknown: cursorStaticModelCount,
                  },
                }),
                tooling: {
                  source: 'provider_native',
                  discoverable: false,
                  sessionScopedOverrides: false,
                  summary: expect.stringContaining('provider-native tools'),
                  observability: {
                    catalog: 'not_enumerated',
                    toolCallEvents: false,
                    runtimeServices: false,
                  },
                },
                install: expect.objectContaining({
                  provider: 'cursor',
                  executionPlatform: 'linux',
                  prerequisites: expect.arrayContaining([
                    expect.objectContaining({
                      id: 'bash',
                    }),
                    expect.objectContaining({
                      id: 'curl',
                    }),
                  ]),
                  path: expect.objectContaining({
                    persistenceEntry: '.local/bin',
                  }),
                  install: expect.objectContaining({
                    installerId: 'cursor-agent',
                  }),
                }),
                compatibility: null,
              }),
            ],
          }),
        }),
        executionStrategies: expect.objectContaining({
          summary: expect.objectContaining({
            totalFamilies: 7,
            supportedFamilies: 7,
            fallbackOnlyFamilies: 0,
            compatibilityDefault: 'simple_tool_call',
          }),
        }),
      }));
    });
  });

  it('GET /providers/config degrades a single target inspection failure instead of returning 500', async () => {
    await withRuntime({}, {}, async (runtime) => {
      runtime.context.providerModelCatalog.inspectSummary = (() => {
        throw new Error('model catalog unavailable');
      }) as typeof runtime.context.providerModelCatalog.inspectSummary;

      const response = await runtime.app.request('/providers/config');
      expect(response.status).toBe(200);

      const body = await response.json() as {
        providers: Record<string, { instances: Array<Record<string, unknown>> }>;
      };
      const firstProvider = Object.values(body.providers)[0];
      expect(firstProvider).toBeDefined();
      expect(firstProvider.instances[0]).toEqual(expect.objectContaining({
        id: expect.any(String),
        target: expect.any(String),
        backend: expect.any(String),
        inspectionError: 'model catalog unavailable',
      }));
    });
  });

  it('GET /providers/config surfaces additive metering summaries per target', async () => {
    await withRuntime({}, {}, async (runtime) => {
      runtime.context.metering.observeEvent({
        id: 'metering-session-1',
        providerName: 'codex',
        providerBackend: 'cli',
        providerInstanceId: 'native',
        cwd: runtime.context.config.sessionBaseDir,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      } as never, {
        type: 'error',
        text: '429 Too Many Requests. Retry after 2s.',
      }, {
        turnStartedAt: Date.now() - 10,
      });

      const response = await runtime.app.request('/providers/config');
      expect(response.status).toBe(200);
      const payload = await response.json() as {
        providers: Record<string, {
          instances: Array<{
            id: string;
            metering: {
              status: string;
              incidents: number;
              activeGuardrails: number;
              activeCooldowns: number;
              activeBlocks: number;
            };
          }>;
        }>;
      };

      const codexInstance = payload.providers.codex?.instances.find((instance) => instance.id === 'native');
      expect(codexInstance?.metering).toEqual(expect.objectContaining({
        status: 'degraded',
        incidents: 1,
        activeGuardrails: 1,
        activeCooldowns: 1,
        activeBlocks: 0,
      }));

      const claudeInstance = payload.providers.claude?.instances.find((instance) => instance.id === 'native');
      expect(claudeInstance?.metering).toEqual(expect.objectContaining({
        status: 'ok',
        incidents: 0,
        activeGuardrails: 0,
        activeCooldowns: 0,
        activeBlocks: 0,
      }));
    });
  });

  it('surfaces runtime-owned Goose active config in provider metadata and model catalogs', async () => {
    const { root, config, cleanup } = createTestConfig({
      providerDefaultInstances: {
        goose: 'default',
      },
      providerInstances: {
        auggie: {},
        claude: {},
        codex: {},
        copilot: {},
        cursor: {},
        antigravity: {},
        goose: {
          default: {
            id: 'default',
            providerName: 'goose',
            commandConfig: {
              path: process.execPath,
              runner: 'direct',
              runtime: { mode: 'native', environmentId: 'native' },
            },
          },
        },
        junie: {},
        kiro: {},
        kilo: {},
        opencode: {},
        pi: {},
      },
    });
    const gooseConfigPath = join(root, '.config', 'goose', 'config.yaml');
    mkdirSync(join(root, '.config', 'goose'), { recursive: true });
    writeFileSync(gooseConfigPath, [
      'GOOSE_PROVIDER: anthropic',
      'GOOSE_MODEL: claude-sonnet-4-5',
      '',
    ].join('\n'));
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);

    const runtime = createRuntimeServer(config);
    try {
      const providerResponse = await runtime.app.request('/providers/config');
      expect(providerResponse.status).toBe(200);
      const providerPayload = await providerResponse.json() as {
        providers: Record<string, {
          defaultInstance: string;
          defaultBackend: string;
          instances: Array<Record<string, unknown>>;
        }>;
        executionStrategies?: {
          summary: {
            totalFamilies: number;
            supportedFamilies: number;
            fallbackOnlyFamilies: number;
            compatibilityDefault: string;
          };
        };
      };
      expect(providerPayload.executionStrategies).toEqual(expect.objectContaining({
        summary: expect.objectContaining({
          totalFamilies: 7,
          supportedFamilies: 7,
          fallbackOnlyFamilies: 0,
          compatibilityDefault: 'simple_tool_call',
        }),
      }));
      expect(providerPayload.providers.goose).toEqual(expect.objectContaining({
        defaultInstance: 'default',
        defaultBackend: 'cli',
        instances: [expect.objectContaining({
          id: 'default',
          target: 'cli/default',
          backend: 'cli',
          command: process.execPath,
          runner: 'direct',
          runtime: { mode: 'native', environmentId: 'native' },
          continuity: expect.objectContaining({
            source: 'provider_native',
            summary: expect.stringContaining('CLI provider owns native conversation continuity'),
            resume: true,
            fork: false,
            permissions: false,
            providerManagedSessions: true,
            sessionKey: false,
            providerSessionState: false,
            remoteCancel: false,
          }),
          metering: expectIdleMeteringSummary(),
          modelCatalog: expect.objectContaining({
            source: 'static',
            defaultModel: 'anthropic/claude-sonnet-4-5',
            defaultModelStatus: 'configured',
            modelCount: 3,
            warnings: [],
            statusCounts: {
              configured: 1,
              available: 0,
              running: 0,
              unknown: 2,
            },
          }),
          tooling: {
            source: 'provider_native',
            discoverable: false,
            sessionScopedOverrides: false,
            summary: expect.stringContaining('provider-native tools'),
            observability: {
              catalog: 'not_enumerated',
              toolCallEvents: false,
              runtimeServices: false,
            },
          },
          activeConfig: {
            source: 'goose_config',
            state: 'detected',
            configuredPath: '~/.config/goose/config.yaml',
            resolvedPath: gooseConfigPath,
            provider: 'anthropic',
            model: 'anthropic/claude-sonnet-4-5',
          },
          install: expect.objectContaining({
            provider: 'goose',
          }),
          compatibility: null,
        })],
      }));

      const catalogResponse = await runtime.app.request('/providers/goose/models');
      expect(catalogResponse.status).toBe(200);
      expect(await catalogResponse.json()).toEqual({
        provider: 'goose',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'anthropic/claude-sonnet-4-5',
        source: 'static',
        cache: null,
        models: [
          {
            id: 'anthropic/claude-sonnet-4-5',
            label: 'anthropic/claude-sonnet-4-5',
            default: true,
            status: 'configured',
          },
          {
            id: 'openai/gpt-5-codex',
            label: 'openai/gpt-5-codex',
          },
          {
            id: 'openai/gpt-5',
            label: 'openai/gpt-5',
          },
        ],
        warnings: [],
      });

      const diagnosticsResponse = await runtime.app.request('/diagnostics/providers');
      expect(diagnosticsResponse.status).toBe(200);
      const diagnostics = await diagnosticsResponse.json() as {
        providers: Array<{ provider: string; config: Record<string, unknown> }>;
      };
      expect(diagnostics.providers).toEqual(expect.arrayContaining([
        expect.objectContaining({
          provider: 'goose',
          config: expect.objectContaining({
            activeConfig: {
              source: 'goose_config',
              state: 'detected',
              configuredPath: '~/.config/goose/config.yaml',
              resolvedPath: gooseConfigPath,
              provider: 'anthropic',
              model: 'anthropic/claude-sonnet-4-5',
            },
          }),
        }),
      ]));
    } finally {
      vi.unstubAllEnvs();
      await runtime.close();
      await cleanup();
    }
  }, 15_000);

  it('POST /sessions rejects providers omitted by positive-list YAML config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-positive-list-test-'));
    const paths = createRuntimeTestPaths(root);
    const configPath = paths.configPath;
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
providers:
  claude:
    instances:
      default:
        environment: native
        command: claude
        runner: auto
        projects_dir: ~/.claude/projects
`.trimStart());

    const env = createRuntimeTestEnv(root, {
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    });

    ensureRuntimeTestDirs(createRuntimeTestPaths(root));

    for (const dir of [
      resolveEnvRuntimePaths(env).dataDir,
      resolveEnvRuntimePaths(env).sessionBaseDir,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer(loadConfig(env));
    try {
      const catalogResponse = await runtime.app.request('/providers/config');
      expect(catalogResponse.status).toBe(200);
      const catalogPayload = await catalogResponse.json() as Record<string, any>;
      expect(catalogPayload).toMatchObject({
        providers: expect.objectContaining({
          claude: expect.objectContaining({
            defaultInstance: 'default',
            defaultBackend: 'cli',
            instances: [
              expect.objectContaining({
                id: 'default',
                target: 'cli/default',
                backend: 'cli',
                command: 'claude',
                runner: 'auto',
                runtime: { mode: 'native', environmentId: 'native' },
                continuity: expect.objectContaining({
                  source: 'provider_native',
                  summary: expect.stringContaining('CLI provider owns native conversation continuity'),
                  resume: true,
                  fork: true,
                  permissions: true,
                  providerManagedSessions: true,
                  sessionKey: false,
                  providerSessionState: false,
                  remoteCancel: false,
                }),
                metering: expectIdleMeteringSummary(),
                modelCatalog: expect.objectContaining({
                  source: 'static',
                  defaultModel: expect.any(String),
                  modelCount: 3,
                  warnings: [],
                  statusCounts: {
                    configured: 0,
                    available: 0,
                    running: 0,
                    unknown: 3,
                  },
                }),
                tooling: expect.objectContaining({
                  source: 'provider_native',
                  discoverable: false,
                  sessionScopedOverrides: false,
                  summary: expect.stringContaining('provider-native tools'),
                  observability: {
                    catalog: 'not_enumerated',
                    toolCallEvents: false,
                    runtimeServices: false,
                  },
                }),
                install: expect.objectContaining({
                  provider: 'claude',
                  executionPlatform: nativeExecutionPlatform(),
                  install: expect.objectContaining({
                    installerId: 'claude-code',
                  }),
                }),
                compatibility: null,
              }),
            ],
          }),
        }),
        executionStrategies: expect.objectContaining({
          summary: expect.objectContaining({
            totalFamilies: 7,
            supportedFamilies: 7,
            fallbackOnlyFamilies: 0,
            compatibilityDefault: 'simple_tool_call',
          }),
        }),
      });

      const response = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'codex' }),
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toMatch(/Unknown provider 'codex'\. Valid: claude/);
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('GET /sessions treats instance=default as the provider default alias in YAML mode', async () => {
    await withRuntime({
      providerDefaultTargets: {
        cursor: { backend: 'cli', instance: 'ubuntu' },
      },
      providerDefaultInstances: {
        cursor: 'ubuntu',
      },
      providerInstances: {
        cursor: {
          ubuntu: {
            id: 'ubuntu',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'wsl', distro: 'Ubuntu', environmentId: 'ubuntu' },
            },
            cursorChatsDir: '/wsl/ubuntu/.cursor/chats',
          },
          native: {
            id: 'native',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'native', environmentId: 'native' },
            },
            cursorChatsDir: 'C:/Users/test/.cursor/chats',
          },
        },
      },
    }, {}, async (runtime) => {
      runtime.context.registry.create({
        providerName: 'cursor',
        providerInstanceId: 'ubuntu',
        cwd: 'C:/repo',
      });
      runtime.context.registry.create({
        providerName: 'cursor',
        providerInstanceId: 'native',
        cwd: 'C:/repo-native',
      });

      const response = await runtime.app.request('/sessions?provider=cursor&instance=default');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        sessions: [
          expect.objectContaining({
            providerName: 'cursor',
            providerInstanceId: 'ubuntu',
            cwd: 'C:/repo',
            providerTarget: {
              provider: 'cursor',
              backend: 'cli',
              instance: 'ubuntu',
              target: 'cli/ubuntu',
              resolved: true,
              continuity: {
                source: 'provider_native',
                summary: expect.stringContaining('CLI provider owns native conversation continuity'),
                resume: true,
                fork: false,
                permissions: false,
                providerManagedSessions: true,
                sessionKey: false,
                providerSessionState: false,
                remoteCancel: false,
              },
              tooling: {
                source: 'provider_native',
                discoverable: false,
                sessionScopedOverrides: false,
                summary: expect.stringContaining('provider-native tools'),
                observability: {
                  catalog: 'not_enumerated',
                  toolCallEvents: false,
                  runtimeServices: false,
                },
              },
            },
          }),
        ],
        count: 1,
      });
    });
  });

  it('GET /discovery/status reports WSL discovery policy state for dashboard polling', async () => {
    await withRuntime({
      cursorRuntime: { mode: 'wsl', distro: 'Ubuntu' },
      kiroRuntime: { mode: 'wsl', distro: 'Ubuntu' },
      wslDiscoveryPolicy: 'manual_only',
      nativeDiscoveryIntervalMs: 5000,
    }, {}, async (runtime) => {
      const response = await runtime.app.request('/discovery/status');
      expect(response.status).toBe(200);

      const payload = await response.json() as {
        wsl: {
          policy: string;
          summary: { state: string; message: string };
          providers: Record<string, {
            state: string;
            runtimeMode: string;
            distro?: string;
            message: string;
          }>;
        };
        docker: {
          policy: string;
          summary: { state: string; message: string };
          configuredTargets: number;
        };
        lan: {
          enabled: boolean;
          status: string;
          registry: {
            total: number;
            alive: number;
          };
        };
      };

      expect(payload.wsl.policy).toBe('manual_only');
      expect(payload.wsl.summary).toEqual({
        state: 'disabled',
        message: 'Background WSL discovery is disabled by policy',
      });
      expect(payload.wsl.providers.cursor).toEqual(expect.objectContaining({
        state: 'disabled',
        runtimeMode: 'wsl',
        distro: 'Ubuntu',
      }));
      expect(payload.wsl.providers.kiro).toEqual(expect.objectContaining({
        state: 'disabled',
        runtimeMode: 'wsl',
        distro: 'Ubuntu',
      }));
      expect(payload.docker).toEqual(expect.objectContaining({
        policy: 'if_running',
        configuredTargets: 0,
        summary: {
          state: 'not_applicable',
          message: 'No Docker-backed native discovery targets configured',
        },
      }));
      expect(payload.lan).toEqual(expect.objectContaining({
        enabled: false,
        status: 'disabled',
        registry: expect.objectContaining({
          total: 0,
          alive: 0,
        }),
      }));
    });
  });

  it('starts peer discovery with runtime lifecycle and exposes peer read surfaces', async () => {
    const { config, cleanup } = createTestConfig({
      env: {
        CATS_RUNTIME_PEERS_ENABLED: 'true',
        CATS_RUNTIME_PEER_NAME: 'local-runtime',
        CATS_RUNTIME_PEER_STATIC_PEERS: JSON.stringify([{
          displayName: 'lab-peer',
          baseUrl: 'http://10.0.0.8:3110',
          secret: 'discard-me',
          targets: [{
            provider: 'codex',
            backend: 'cli',
            instance: 'default',
            default: true,
          }],
        }]),
      },
    });
    const runtime = createRuntimeServer(config);

    try {
      expect(runtime.context.peerDiscovery?.snapshot().status).toBe('stopped');

      const address = await runtime.start();
      expect(runtime.context.peerDiscovery?.snapshot().status).toBe('running');

      const peersResponse = await runtime.app.request('/peers');
      expect(peersResponse.status).toBe(200);
      const peersPayload = await peersResponse.json() as {
        count: number;
        discovery: { status: string };
        peers: Array<Record<string, unknown>>;
      };
      expect(peersPayload.count).toBe(2);
      expect(peersPayload.discovery.status).toBe('running');
      expect(peersPayload.peers).toEqual(expect.arrayContaining([
        expect.objectContaining({
          identity: expect.objectContaining({
            displayName: 'lab-peer',
          }),
        }),
        expect.objectContaining({
          identity: expect.objectContaining({
            displayName: 'local-runtime',
            advertisedUrl: `http://${address.host}:${address.port}`,
          }),
        }),
      ]));
      for (const peer of peersPayload.peers) {
        expect(peer).not.toHaveProperty('secret');
      }

      const localPeerId = runtime.context.peerCapabilities?.getLocalPeerId();
      if (!localPeerId) {
        throw new Error('missing local peer id');
      }
      const localPeerGuardrails = runtime.context.peerExecutionAdmission?.getInboundExecutionStatus(localPeerId);
      if (!localPeerGuardrails) {
        throw new Error('missing peer execution admission service');
      }
      const peerGuardrailSummary = runtime.context.peerExecutionAdmission?.getSummary();
      if (!peerGuardrailSummary) {
        throw new Error('missing peer execution admission summary');
      }
      const peerReplaySummary = runtime.context.peerExecutionReplay?.getSummary();
      if (!peerReplaySummary) {
        throw new Error('missing peer execution replay summary');
      }

      const peerDetail = await runtime.app.request(`/peers/${localPeerId}`);
      expect(peerDetail.status).toBe(200);
      expect(await peerDetail.json()).toEqual({
        discovery: expect.objectContaining({
          enabled: true,
          status: 'running',
        }),
        guardrails: {
          inboundExecutions: {
            peerId: localPeerId,
            activeExecutions: 0,
            maxPerPeer: localPeerGuardrails.maxPerPeer,
            overrideApplied: localPeerGuardrails.overrideApplied,
            saturated: false,
          },
          replay: {
            callerKey: `peer:${localPeerId}`,
            trackedNonces: 0,
            maxNoncesPerCaller: peerReplaySummary.maxNoncesPerCaller,
            overrideApplied: false,
          },
        },
        network: {
          summary: {
            summary: 'Peer execution auth is not configured; inbound peer execution will stay unavailable even if endpoints are advertised.',
            auth: {
              sharedSecretConfigured: false,
              sharedSecretCount: 0,
            },
            local: {
              endpoint: `http://${address.host}:${address.port}/`,
              host: address.host,
              port: address.port,
              scheme: 'http',
              scope: 'loopback',
              classification: 'trusted_lan_plaintext',
              level: 'attention',
              attention: 'lan_only_plaintext',
              summary: 'Peer endpoint is plaintext HTTP on a loopback/private/LAN address; keep it behind a tightly trusted network or add TLS.',
            },
            peers: {
              total: 2,
              tls: 0,
              trustedLanPlaintext: 2,
              externalPlaintext: 0,
              unresolved: 0,
              attention: 2,
              warning: 0,
            },
          },
          peer: {
            peerId: localPeerId,
            displayName: 'local-runtime',
            trustState: 'self',
            trustReason: 'local_runtime',
            posture: {
              endpoint: `http://${address.host}:${address.port}/`,
              host: address.host,
              port: address.port,
              scheme: 'http',
              scope: 'loopback',
              classification: 'trusted_lan_plaintext',
              level: 'attention',
              attention: 'lan_only_plaintext',
              summary: 'Peer endpoint is plaintext HTTP on a loopback/private/LAN address; keep it behind a tightly trusted network or add TLS.',
            },
          },
        },
        peer: expect.objectContaining({
          identity: expect.objectContaining({
            peerId: localPeerId,
            advertisedUrl: `http://${address.host}:${address.port}`,
          }),
          trust: {
            state: 'self',
            reason: 'local_runtime',
          },
        }),
      });

      const diagnosticsResponse = await runtime.app.request('/diagnostics/peers');
      expect(diagnosticsResponse.status).toBe(200);
      expect(await diagnosticsResponse.json()).toEqual(expect.objectContaining({
        discovery: expect.objectContaining({
          enabled: true,
          status: 'running',
          registry: expect.objectContaining({
            total: 2,
            alive: 2,
          }),
        }),
        guardrails: expect.objectContaining({
          authFailures: expect.objectContaining({
            trackedCallers: 0,
            limitedCallers: 0,
          }),
          inboundExecutions: expect.objectContaining({
            activeGlobal: 0,
            maxGlobal: peerGuardrailSummary.inboundExecutions.maxGlobal,
          }),
          replay: expect.objectContaining({
            trackedCallers: 0,
            trackedNonces: 0,
            maxNoncesPerCaller: peerReplaySummary.maxNoncesPerCaller,
          }),
        }),
        summary: expect.objectContaining({
          total: 2,
          self: 1,
          remote: 1,
        }),
        peers: expect.arrayContaining([
          expect.objectContaining({
            identity: expect.objectContaining({
              displayName: 'lab-peer',
            }),
          }),
        ]),
      }));

      const discoveryResponse = await runtime.app.request('/discovery/status');
      expect(discoveryResponse.status).toBe(200);
      expect(await discoveryResponse.json()).toEqual(expect.objectContaining({
        lan: expect.objectContaining({
          enabled: true,
          status: 'running',
          registry: expect.objectContaining({
            total: 2,
            alive: 2,
          }),
        }),
      }));
    } finally {
      await runtime.close();
      expect(runtime.context.peerDiscovery?.snapshot().status).toBe('stopped');
      await cleanup();
    }
  }, RUNTIME_SERVER_INTEGRATION_TIMEOUT_MS);

  it('boots with Docker-backed file providers without trying to host-resolve their container paths', async () => {
    const { config, cleanup } = createTestConfig({
      providerDefaultInstances: {
        auggie: 'docker-dev',
        copilot: 'docker-dev',
      },
      providerInstances: {
        auggie: {
          'docker-dev': {
            id: 'docker-dev',
            providerName: 'auggie',
            commandConfig: {
              path: 'auggie',
              runner: 'auto',
              runtime: { mode: 'docker', container: 'cats-cli-test', environmentId: 'docker-dev' },
            },
            auggieSessionsDir: '~/.augment/sessions',
          },
        },
        copilot: {
          'docker-dev': {
            id: 'docker-dev',
            providerName: 'copilot',
            commandConfig: {
              path: 'copilot',
              runner: 'auto',
              runtime: { mode: 'docker', container: 'cats-cli-test', environmentId: 'docker-dev' },
            },
            copilotSessionsDir: '~/.copilot/session-state',
          },
        },
      },
    });

    const runtime = createRuntimeServer(config);
    try {
      await runtime.start();
      const response = await runtime.app.request('/health');
      expect(response.status).toBe(200);
    } finally {
      await runtime.close();
      await cleanup();
    }
  }, RUNTIME_SERVER_INTEGRATION_TIMEOUT_MS);

  it('deduplicates overlapping file discovery watchers even when one path uses ~', async () => {
    const { root, config, cleanup } = createTestConfig();
    const sharedDir = join(root, '.augment', 'sessions');
    writeFileSync(
      join(sharedDir, 'session-1.json'),
      JSON.stringify({
        sessionId: 'auggie-1',
        created: '2026-03-10T00:00:00.000Z',
        modified: '2026-03-10T00:01:00.000Z',
        name: 'Repo review',
        agentState: {
          modelId: 'gpt-5-4',
        },
        chatHistory: [
          {
            exchange: {
              request_message: 'Review this repo',
              request_nodes: [
                {
                  ide_state_node: {
                    workspace_folders: [
                      {
                        folder_root: 'C:/Users/kenne/Source/SK2/one-man-digital-company',
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      }, null, 2),
      'utf-8',
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    config.auggieSessionsDir = sharedDir;
    config.providerDefaultInstances = {
      ...config.providerDefaultInstances,
      auggie: 'native',
    };
    config.providerInstances = {
      ...config.providerInstances,
      auggie: {
        native: {
          id: 'native',
          providerName: 'auggie',
          commandConfig: config.providerCommands.auggie,
          auggieSessionsDir: sharedDir,
        },
        mirror: {
          id: 'mirror',
          providerName: 'auggie',
          commandConfig: {
            ...config.providerCommands.auggie,
            runtime: { ...config.providerCommands.auggie.runtime },
          },
          auggieSessionsDir: '~/.augment/sessions',
        },
      },
    };

    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = root;
    process.env.USERPROFILE = root;

    const runtime = createRuntimeServer(config);
    const discovery = createDiscoveryController(runtime.context);
    try {
      discovery.start();

      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (runtime.context.registry.list({ provider: 'auggie' }).length > 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      const sessions = runtime.context.registry.list({ provider: 'auggie' });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].providerInstanceId).toBe('native');
      expect(
        warnSpy.mock.calls.some(([message]) =>
          String(message).includes("share watch dir")
          && String(message).includes("'auggie'")
          && String(message).includes("'auggie@mirror'")),
      ).toBe(true);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
      discovery.stop();
      warnSpy.mockRestore();
      await runtime.close();
      await cleanup();
    }
  });

  it('GET /providers/:provider/models returns structured static fallback for CLI providers', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/codex/models');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        provider: 'codex',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'gpt-5.4',
        source: 'static',
        cache: null,
        models: expect.arrayContaining([
          { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
          { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', default: false },
          { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex', default: false },
          { id: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark', default: false },
          { id: 'gpt-5.2', label: 'gpt-5.2', default: false },
        ]),
        warnings: [],
      });
    });
  });

  it('GET /providers/antigravity/models omits bundled models until agy model ids are verified', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/antigravity/models');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        provider: 'antigravity',
        backend: 'cli',
        instance: 'native',
        defaultModel: null,
        source: 'static',
        cache: null,
        models: [],
        warnings: [
          'Antigravity CLI model ids are not verified by a live agy model-list probe yet; '
          + 'serving no bundled static model ids until that contract is proven.',
        ],
      });
    });
  });

  it('GET /providers/junie/models returns the curated picker snapshot with an honesty warning', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/junie/models');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        provider: 'junie',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'Gemini 3 Flash',
        source: 'static',
        cache: null,
        models: [
          { id: 'Gemini 3 Flash', label: 'Gemini 3 Flash', default: true },
          { id: 'Claude Opus 4.6', label: 'Claude Opus 4.6' },
          { id: 'Claude Opus 4.7', label: 'Claude Opus 4.7' },
          { id: 'Claude Sonnet 4.6', label: 'Claude Sonnet 4.6' },
          { id: 'Gemini 3.1 Flash Lite', label: 'Gemini 3.1 Flash Lite' },
          { id: 'Gemini 3.1 Pro Preview', label: 'Gemini 3.1 Pro Preview' },
          { id: 'GPT-5', label: 'GPT-5' },
          { id: 'GPT-5.2', label: 'GPT-5.2' },
          { id: 'GPT-5.3-codex', label: 'GPT-5.3-codex' },
          { id: 'GPT-5.4', label: 'GPT-5.4' },
          { id: 'Grok 4.1 Fast Reasoning', label: 'Grok 4.1 Fast Reasoning' },
        ],
        warnings: [
          'Junie CLI does not expose a live model list; serving the curated picker snapshot as a static fallback. '
          + "Junie's dynamic Default, BYOK, and custom models are not enumerated here.",
        ],
      });
    });
  });

  it('GET /providers/junie/models/advanced returns curated advanced metadata with an honesty warning', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/junie/models/advanced');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        provider: 'junie',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'Gemini 3 Flash',
        source: 'static',
        cache: null,
        entries: [
          {
            id: 'Gemini 3 Flash',
            label: 'Gemini 3 Flash',
            default: true,
            capabilityTags: ['latency_optimized'],
          },
          {
            id: 'Claude Opus 4.6',
            label: 'Claude Opus 4.6',
            default: false,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'Claude Opus 4.7',
            label: 'Claude Opus 4.7',
            default: false,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'Claude Sonnet 4.6',
            label: 'Claude Sonnet 4.6',
            default: false,
          },
          {
            id: 'Gemini 3.1 Flash Lite',
            label: 'Gemini 3.1 Flash Lite',
            default: false,
            capabilityTags: ['latency_optimized'],
          },
          {
            id: 'Gemini 3.1 Pro Preview',
            label: 'Gemini 3.1 Pro Preview',
            default: false,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'GPT-5',
            label: 'GPT-5',
            default: false,
          },
          {
            id: 'GPT-5.2',
            label: 'GPT-5.2',
            default: false,
          },
          {
            id: 'GPT-5.3-codex',
            label: 'GPT-5.3-codex',
            default: false,
          },
          {
            id: 'GPT-5.4',
            label: 'GPT-5.4',
            default: false,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'Grok 4.1 Fast Reasoning',
            label: 'Grok 4.1 Fast Reasoning',
            default: false,
            capabilityTags: ['reasoning'],
          },
        ],
        presets: [],
        controls: [],
        defaultSelection: null,
        support: {
          tier: 'entry_only',
          advancedMetadataStatus: 'unverified_omitted',
          discoveryMode: 'manual_refresh',
          provenance: {
            status: 'unverified_omitted',
          },
        },
        warnings: [
          'Junie CLI does not expose a live model list; serving the curated picker snapshot as a static fallback. '
          + "Junie's dynamic Default, BYOK, and custom models are not enumerated here.",
        ],
      });
    });
  });

  it('GET /providers/models returns default-target catalogs for configured providers', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/models');
      expect(response.status).toBe(200);

      const payload = await response.json() as {
        providers: Record<string, {
          provider: string;
          backend: string;
          instance: string;
          source: string;
          models: Array<{ id: string }>;
        }>;
      };
      expect(payload.providers.codex).toMatchObject({
        provider: 'codex',
        backend: 'cli',
        instance: 'native',
        source: 'static',
      });
      expect(payload.providers.codex.models[0]?.id).toBe('gpt-5.4');
      expect(payload.providers.claude).toMatchObject({
        provider: 'claude',
        backend: 'cli',
        instance: 'native',
      });
    });
  });

  it('GET /providers/models returns 400 for invalid refresh query values', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/models?refresh=maybe');
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Invalid refresh query value 'maybe'. Use true/false or 1/0.",
      });
    });
  });

  it('GET /providers/:provider/models/advanced adds a runtime-owned advanced catalog without changing v1', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/codex/models/advanced');
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        provider: 'codex',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'gpt-5.4',
        source: 'static',
        cache: null,
        presets: [],
        defaultSelection: {
          entryId: 'gpt-5.4',
          entryMode: 'explicit',
          controls: {
            'codex.reasoning_effort': 'medium',
          },
        },
        support: {
          tier: 'full',
        },
        warnings: [],
      });
      expect(payload.entries.map((entry: { id: string }) => entry.id)).toEqual([
        'gpt-5.4',
        'gpt-5.2-codex',
        'gpt-5.1-codex-max',
        'gpt-5.4-mini',
        'gpt-5.3-codex',
        'gpt-5.3-codex-spark',
        'gpt-5.2',
        'gpt-5.1-codex-mini',
      ]);
      expect(payload.controls).toMatchObject([
        {
          key: 'codex.reasoning_effort',
          applicableEntryIds: [
            'gpt-5.4',
            'gpt-5.2-codex',
            'gpt-5.1-codex-max',
            'gpt-5.4-mini',
            'gpt-5.3-codex',
            'gpt-5.3-codex-spark',
            'gpt-5.2',
            'gpt-5.1-codex-mini',
          ],
        },
      ]);
    });
  });

  it('GET /providers/:provider/models/advanced publishes Claude native aliases and entry-specific effort options', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/claude/models/advanced');
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        provider: 'claude',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'opus',
        source: 'static',
        cache: null,
        presets: [],
        defaultSelection: {
          entryId: 'opus',
          entryMode: 'explicit',
          controls: {
            'claude.reasoning_effort': 'xhigh',
          },
        },
        support: {
          tier: 'full',
        },
        warnings: [],
      });
      expect(payload.entries.map((entry: { id: string }) => entry.id)).toEqual([
        'opus',
        'sonnet',
        'haiku',
      ]);
      const reasoningControl = payload.controls.find(
        (control: { key: string }) => control.key === 'claude.reasoning_effort',
      );
      expect(reasoningControl).toMatchObject({
        key: 'claude.reasoning_effort',
        applicableEntryIds: ['opus', 'sonnet'],
      });
      expect(reasoningControl?.values).toEqual(expect.arrayContaining([
        expect.objectContaining({ value: 'low', applicableEntryIds: ['opus'] }),
        expect.objectContaining({ value: 'low', applicableEntryIds: ['sonnet'] }),
        expect.objectContaining({ value: 'medium', applicableEntryIds: ['opus'] }),
        expect.objectContaining({ value: 'medium', applicableEntryIds: ['sonnet'] }),
        expect.objectContaining({ value: 'high', applicableEntryIds: ['opus'] }),
        expect.objectContaining({ value: 'high', applicableEntryIds: ['sonnet'] }),
        expect.objectContaining({ value: 'xhigh', applicableEntryIds: ['opus'] }),
        expect.objectContaining({ value: 'max', applicableEntryIds: ['opus'] }),
        expect.objectContaining({ value: 'max', applicableEntryIds: ['sonnet'] }),
      ]));
    });
  });

  it('GET /providers/claude/models and /advanced honor curated Claude CLI YAML', async () => {
    await withCuratedCatalogRuntime([
      'schema_version: 1',
      'catalogs:',
      '  - cli: Claude',
      '    version: 2.1.96',
      '    last_updated: 2026-04-08',
      '    models:',
      '      - name: Opus',
      '        label: Opus 4.6 with 1M context',
      '        default: true',
      '        context: 1000000',
      '        options:',
      '          - name: Effort',
      '            values: [Low, Medium, High, Max]',
      '            default: Medium',
      '      - name: Sonnet',
      '        label: Sonnet 4.6',
      '        options:',
      '          - name: Effort',
      '            values: [Low, Medium, High]',
      '            default: Medium',
      '      - name: Haiku',
      '        label: Haiku 4.5',
      '        options: []',
    ], {}, {}, async (runtime) => {
      const modelsResponse = await runtime.app.request('/providers/claude/models');
      expect(modelsResponse.status).toBe(200);
      expect(await modelsResponse.json()).toEqual({
        provider: 'claude',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'opus',
        source: 'static',
        cache: null,
        models: [
          { id: 'opus', label: 'Opus 4.6 with 1M context', default: true },
          { id: 'sonnet', label: 'Sonnet 4.6', default: false },
          { id: 'haiku', label: 'Haiku 4.5', default: false },
        ],
        warnings: [],
      });

      const advancedResponse = await runtime.app.request('/providers/claude/models/advanced');
      expect(advancedResponse.status).toBe(200);
      const advancedPayload = await advancedResponse.json();
      expect(advancedPayload).toMatchObject({
        provider: 'claude',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'opus',
        source: 'static',
        cache: null,
        entries: [
          {
            id: 'opus',
            label: 'Opus 4.6 with 1M context',
            default: true,
            limits: {
              contextWindowTokens: 1000000,
            },
          },
          {
            id: 'sonnet',
            label: 'Sonnet 4.6',
            default: false,
          },
          {
            id: 'haiku',
            label: 'Haiku 4.5',
            default: false,
          },
        ],
        defaultSelection: {
          entryId: 'opus',
          entryMode: 'explicit',
          controls: {
            'claude.reasoning_effort': 'medium',
          },
        },
        warnings: [],
      });
      expect(advancedPayload.controls).toMatchObject([
        {
          key: 'claude.reasoning_effort',
          applicableEntryIds: ['opus', 'sonnet'],
        },
      ]);
    });
  });

  it('GET /providers/codex/models and /advanced honor curated Codex CLI YAML', async () => {
    await withCuratedCatalogRuntime([
      'schema_version: 1',
      'catalogs:',
      '  - cli: Codex',
      '    version: 0.118.0',
      '    last_updated: 2026-04-08',
      '    shared_options:',
      '      - name: Reasoning Level',
      '        values: [Low, Medium, High, Extra High]',
      '        default: Medium',
      '    models:',
      '      - name: gpt-5.4',
      '        default: true',
      '      - name: gpt-5.2-codex',
      '      - name: gpt-5.1-codex-max',
      '      - name: gpt-5.4-mini',
      '      - name: gpt-5.3-codex',
      '      - name: gpt-5.3-codex-spark',
      '        options:',
      '          - name: Reasoning Level',
      '            default: High',
      '      - name: gpt-5.2',
      '      - name: gpt-5.1-codex-mini',
      '        options:',
      '          - name: Reasoning Level',
      '            values: [Medium, High]',
      '            default: Medium',
    ], {}, {}, async (runtime) => {
      const modelsResponse = await runtime.app.request('/providers/codex/models');
      expect(modelsResponse.status).toBe(200);
      expect(await modelsResponse.json()).toEqual({
        provider: 'codex',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'gpt-5.4',
        source: 'static',
        cache: null,
        models: [
          { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
          { id: 'gpt-5.2-codex', label: 'gpt-5.2-codex', default: false },
          { id: 'gpt-5.1-codex-max', label: 'gpt-5.1-codex-max', default: false },
          { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', default: false },
          { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex', default: false },
          { id: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark', default: false },
          { id: 'gpt-5.2', label: 'gpt-5.2', default: false },
          { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini', default: false },
        ],
        warnings: [],
      });

      const advancedResponse = await runtime.app.request('/providers/codex/models/advanced');
      expect(advancedResponse.status).toBe(200);
      const advancedPayload = await advancedResponse.json();
      expect(advancedPayload.entries.map((entry: { id: string }) => entry.id)).toEqual([
        'gpt-5.4',
        'gpt-5.2-codex',
        'gpt-5.1-codex-max',
        'gpt-5.4-mini',
        'gpt-5.3-codex',
        'gpt-5.3-codex-spark',
        'gpt-5.2',
        'gpt-5.1-codex-mini',
      ]);
      expect(advancedPayload.defaultSelection).toEqual({
        entryId: 'gpt-5.4',
        entryMode: 'explicit',
        controls: {
          'codex.reasoning_effort': 'medium',
        },
      });
      expect(advancedPayload.controls).toMatchObject([
        {
          key: 'codex.reasoning_effort',
          applicableEntryIds: [
            'gpt-5.4',
            'gpt-5.2-codex',
            'gpt-5.1-codex-max',
            'gpt-5.4-mini',
            'gpt-5.3-codex',
            'gpt-5.3-codex-spark',
            'gpt-5.2',
            'gpt-5.1-codex-mini',
          ],
        },
      ]);
      expect(advancedPayload.controls[0]?.values).toEqual(expect.arrayContaining([
        expect.objectContaining({
          value: 'medium',
          label: 'Medium (default)',
          applicableEntryIds: [
            'gpt-5.4',
            'gpt-5.2-codex',
            'gpt-5.1-codex-max',
            'gpt-5.4-mini',
            'gpt-5.3-codex',
            'gpt-5.2',
            'gpt-5.1-codex-mini',
          ],
        }),
        expect.objectContaining({
          value: 'high',
          label: 'High',
          applicableEntryIds: [
            'gpt-5.4',
            'gpt-5.2-codex',
            'gpt-5.1-codex-max',
            'gpt-5.4-mini',
            'gpt-5.3-codex',
            'gpt-5.2',
            'gpt-5.1-codex-mini',
          ],
        }),
        expect.objectContaining({
          value: 'low',
          applicableEntryIds: [
            'gpt-5.4',
            'gpt-5.2-codex',
            'gpt-5.1-codex-max',
            'gpt-5.4-mini',
            'gpt-5.3-codex',
            'gpt-5.3-codex-spark',
            'gpt-5.2',
          ],
        }),
        expect.objectContaining({
          value: 'xhigh',
          applicableEntryIds: [
            'gpt-5.4',
            'gpt-5.2-codex',
            'gpt-5.1-codex-max',
            'gpt-5.4-mini',
            'gpt-5.3-codex',
            'gpt-5.3-codex-spark',
            'gpt-5.2',
          ],
        }),
      ]));
      expect(advancedPayload.warnings).toEqual([]);
    });
  });

  it('GET /providers/antigravity/models and /advanced honor user-curated Antigravity CLI YAML', async () => {
    await withCuratedCatalogRuntime([
      'schema_version: 1',
      'catalogs:',
      '  - cli: Antigravity',
      '    version: probe-required',
      '    last_updated: 2026-05-24',
      '    models:',
      '      - name: antigravity-fixture-high',
      '        label: Antigravity fixture high',
      '        default: true',
      '        tags: [reasoning]',
      '        notes:',
      '          - User supplied model entry.',
      '      - name: antigravity-fixture-low',
      '        label: Antigravity fixture low',
      '        tags: [reasoning]',
      '      - name: antigravity-fixture-fast',
      '        label: Antigravity fixture fast',
      '        tags: [latency_optimized]',
    ], {}, {}, async (runtime) => {
      const modelsResponse = await runtime.app.request('/providers/antigravity/models');
      expect(modelsResponse.status).toBe(200);
      expect(await modelsResponse.json()).toEqual({
        provider: 'antigravity',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'antigravity-fixture-high',
        source: 'static',
        cache: null,
        models: [
          {
            id: 'antigravity-fixture-high',
            label: 'Antigravity fixture high',
            default: true,
          },
          {
            id: 'antigravity-fixture-low',
            label: 'Antigravity fixture low',
          },
          {
            id: 'antigravity-fixture-fast',
            label: 'Antigravity fixture fast',
          },
        ],
        warnings: [],
      });

      const advancedResponse = await runtime.app.request('/providers/antigravity/models/advanced');
      expect(advancedResponse.status).toBe(200);
      expect(await advancedResponse.json()).toEqual({
        provider: 'antigravity',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'antigravity-fixture-high',
        source: 'static',
        cache: null,
        entries: [
          {
            id: 'antigravity-fixture-high',
            label: 'Antigravity fixture high',
            default: true,
            capabilityTags: ['tool_use', 'reasoning'],
            notes: ['User supplied model entry.'],
          },
          {
            id: 'antigravity-fixture-low',
            label: 'Antigravity fixture low',
            default: false,
            capabilityTags: ['tool_use', 'reasoning'],
          },
          {
            id: 'antigravity-fixture-fast',
            label: 'Antigravity fixture fast',
            default: false,
            capabilityTags: ['tool_use', 'latency_optimized'],
          },
        ],
        presets: [],
        controls: [],
        defaultSelection: null,
        support: {
          tier: 'entry_only',
          advancedMetadataStatus: 'unverified_omitted',
          discoveryMode: 'manual_refresh',
          provenance: {
            status: 'unverified_omitted',
          },
        },
        warnings: [],
      });
    });
  });

  it('GET /providers/cursor/models and /advanced honor curated Cursor raw-label YAML', async () => {
    await withCuratedCatalogRuntime([
      'schema_version: 1',
      'catalogs:',
      '  - cli: Cursor',
      '    version: 2026.04.13-a9d7fb5',
      '    last_updated: 2026-04-14',
      '    models:',
      '      - name: Auto',
      '      - name: Composer 2 Fast',
      '        default: true',
      '      - name: Codex 5.3 Extra High',
      '      - name: GPT-5.4 1M',
      '      - name: Opus 4.5 Thinking',
      '      - name: Gemini 3 Flash',
    ], {}, {}, async (runtime) => {
      const modelsResponse = await runtime.app.request('/providers/cursor/models');
      expect(modelsResponse.status).toBe(200);
      expect(await modelsResponse.json()).toEqual({
        provider: 'cursor',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'composer-2-fast',
        source: 'static',
        cache: null,
        models: [
          { id: 'auto', label: 'Auto' },
          { id: 'composer-2-fast', label: 'Composer 2 Fast', default: true },
          { id: 'gpt-5.3-codex-xhigh', label: 'Codex 5.3 Extra High' },
          { id: 'gpt-5.4-medium', label: 'GPT-5.4 1M' },
          { id: 'claude-4.5-opus-thinking', label: 'Opus 4.5 Thinking' },
          { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
        ],
        warnings: [
          'Live model discovery is available for cursor/cli/native via `cursor-agent --list-models`, but this read is serving the curated static fallback until an explicit refresh populates the cache.',
        ],
      });

      const advancedResponse = await runtime.app.request('/providers/cursor/models/advanced');
      expect(advancedResponse.status).toBe(200);
      expect(await advancedResponse.json()).toEqual({
        provider: 'cursor',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'composer-2-fast',
        source: 'static',
        cache: null,
        entries: [
          { id: 'auto', label: 'Auto', default: false },
          { id: 'composer-2-fast', label: 'Composer 2 Fast', default: true },
          { id: 'gpt-5.3-codex-xhigh', label: 'Codex 5.3 Extra High', default: false },
          {
            id: 'gpt-5.4-medium',
            label: 'GPT-5.4 1M',
            default: false,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'claude-4.5-opus-thinking',
            label: 'Opus 4.5 Thinking',
            default: false,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'gemini-3-flash',
            label: 'Gemini 3 Flash',
            default: false,
            capabilityTags: ['latency_optimized'],
          },
        ],
        presets: [],
        controls: [],
        defaultSelection: null,
        support: {
          tier: 'entry_only',
          advancedMetadataStatus: 'unverified_omitted',
          discoveryMode: 'manual_refresh',
          provenance: {
            status: 'unverified_omitted',
          },
        },
        warnings: [
          'Live model discovery is available for cursor/cli/native via `cursor-agent --list-models`, but this read is serving the curated static fallback until an explicit refresh populates the cache.',
        ],
      });
    });
  });

  it('GET /providers/copilot/models and /advanced honor curated Copilot YAML', async () => {
    await withCuratedCatalogRuntime([
      'schema_version: 1',
      'catalogs:',
      '  - cli: Copilot',
      '    version: v1.0.26',
      '    last_updated: 2026-04-15',
      '    providers:',
      '      - name: OpenAI',
      '        shared_options:',
      '          - name: Reasoning Effort',
      '            values: [Low, Medium, High]',
      '            default: Medium',
      '        models:',
      '          - name: GPT-5.4',
      '            default: true',
      '          - name: GPT-5.4 mini',
      '          - name: GPT-5.2-Codex',
      '            options:',
      '              - name: Reasoning Effort',
      '                default: High',
      '      - name: Anthropic',
      '        shared_options:',
      '          - name: Effort Level',
      '            values: [Low, Medium, High]',
      '            default: Medium',
      '        models:',
      '          - name: Claude Opus 4.6',
      '            options:',
      '              - name: Effort Level',
      '                default: High',
      '          - name: Claude Sonnet 4',
    ], {}, {}, async (runtime) => {
      const modelsResponse = await runtime.app.request('/providers/copilot/models');
      expect(modelsResponse.status).toBe(200);
      expect(await modelsResponse.json()).toEqual({
        provider: 'copilot',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'gpt-5.4',
        source: 'static',
        cache: null,
        models: [
          { id: 'gpt-5.4', label: 'GPT-5.4', default: true },
          { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', default: false },
          { id: 'gpt-5.2-codex', label: 'GPT-5.2-Codex', default: false },
          { id: 'claude-opus-4.6', label: 'Claude Opus 4.6', default: false },
          { id: 'claude-sonnet-4', label: 'Claude Sonnet 4', default: false },
        ],
        warnings: [],
      });

      const advancedResponse = await runtime.app.request('/providers/copilot/models/advanced');
      expect(advancedResponse.status).toBe(200);
      expect(await advancedResponse.json()).toEqual({
        provider: 'copilot',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'gpt-5.4',
        source: 'static',
        cache: null,
        entries: [
          {
            id: 'gpt-5.4',
            label: 'GPT-5.4',
            default: true,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'gpt-5.4-mini',
            label: 'GPT-5.4 mini',
            default: false,
            capabilityTags: ['reasoning', 'latency_optimized'],
          },
          {
            id: 'gpt-5.2-codex',
            label: 'GPT-5.2-Codex',
            default: false,
          },
          {
            id: 'claude-opus-4.6',
            label: 'Claude Opus 4.6',
            default: false,
            capabilityTags: ['reasoning'],
          },
          {
            id: 'claude-sonnet-4',
            label: 'Claude Sonnet 4',
            default: false,
          },
        ],
        presets: [],
        controls: [
          expect.objectContaining({
            key: 'copilot.reasoning_effort',
            label: 'Reasoning effort',
            description: 'Controls GitHub Copilot CLI reasoning effort for supported models.',
            kind: 'enum',
            scope: 'both',
            values: expect.arrayContaining([
              expect.objectContaining({
                value: 'low',
                label: 'Low',
                applicableEntryIds: [
                  'gpt-5.4',
                  'gpt-5.4-mini',
                  'gpt-5.2-codex',
                  'claude-opus-4.6',
                  'claude-sonnet-4',
                ],
              }),
              expect.objectContaining({
                value: 'medium',
                label: 'Medium (default)',
                applicableEntryIds: ['gpt-5.4', 'gpt-5.4-mini', 'claude-sonnet-4'],
              }),
              expect.objectContaining({
                value: 'high',
                label: 'High (default)',
                applicableEntryIds: ['gpt-5.2-codex', 'claude-opus-4.6'],
              }),
              expect.objectContaining({
                value: 'medium',
                label: 'Medium',
                applicableEntryIds: ['gpt-5.2-codex', 'claude-opus-4.6'],
              }),
              expect.objectContaining({
                value: 'high',
                label: 'High',
                applicableEntryIds: ['gpt-5.4', 'gpt-5.4-mini', 'claude-sonnet-4'],
              }),
              expect.objectContaining({
                value: 'high',
                label: 'High (default)',
                applicableEntryIds: ['gpt-5.2-codex', 'claude-opus-4.6'],
              }),
            ]),
            applicableEntryIds: [
              'gpt-5.4',
              'gpt-5.4-mini',
              'gpt-5.2-codex',
              'claude-opus-4.6',
              'claude-sonnet-4',
            ],
            semanticTags: ['reasoning_intensity'],
          }),
        ],
        defaultSelection: {
          entryId: 'gpt-5.4',
          entryMode: 'explicit',
          controls: {
            'copilot.reasoning_effort': 'medium',
          },
        },
        support: {
          tier: 'full',
          advancedMetadataStatus: 'unverified_omitted',
          discoveryMode: 'manual_refresh',
          provenance: {
            status: 'unverified_omitted',
          },
        },
        warnings: [],
      });
    });
  });

  it('GET /providers/kilo/models and /advanced honor curated Kilo YAML', async () => {
    await withCuratedCatalogRuntime([
      'schema_version: 1',
      'catalogs:',
      '  - cli: Kilo',
      '    version: v7.2.0',
      '    last_updated: 2026-04-14',
      '    models:',
      '      - name: Kilo Auto Frontier',
      '      - name: Elephant (new)',
      '      - name: "OpenAI: GPT-5.4"',
      '        default: true',
      '      - name: "MoonshotAI: Kimi K2.5"',
    ], {}, {}, async (runtime) => {
      const modelsResponse = await runtime.app.request('/providers/kilo/models');
      expect(modelsResponse.status).toBe(200);
      expect(await modelsResponse.json()).toEqual({
        provider: 'kilo',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'kilo/openai/gpt-5.4',
        source: 'static',
        cache: null,
        models: [
          { id: 'kilo/kilo-auto/frontier', label: 'Kilo Auto Frontier', default: false },
          { id: 'kilo/openrouter/elephant-alpha', label: 'Elephant (new)', default: false },
          { id: 'kilo/openai/gpt-5.4', label: 'OpenAI: GPT-5.4', default: true },
          { id: 'kilo/moonshotai/kimi-k2.5', label: 'MoonshotAI: Kimi K2.5', default: false },
        ],
        warnings: [],
      });

      const advancedResponse = await runtime.app.request('/providers/kilo/models/advanced');
      expect(advancedResponse.status).toBe(200);
      expect(await advancedResponse.json()).toEqual({
        provider: 'kilo',
        backend: 'cli',
        instance: 'native',
        defaultModel: 'kilo/openai/gpt-5.4',
        source: 'static',
        cache: null,
        entries: [
          { id: 'kilo/kilo-auto/frontier', label: 'Kilo Auto Frontier', default: false },
          { id: 'kilo/openrouter/elephant-alpha', label: 'Elephant (new)', default: false },
          {
            id: 'kilo/openai/gpt-5.4',
            label: 'OpenAI: GPT-5.4',
            default: true,
            capabilityTags: ['reasoning'],
          },
          { id: 'kilo/moonshotai/kimi-k2.5', label: 'MoonshotAI: Kimi K2.5', default: false },
        ],
        presets: [],
        controls: [],
        defaultSelection: null,
        support: {
          tier: 'entry_only',
          advancedMetadataStatus: 'unverified_omitted',
          discoveryMode: 'manual_refresh',
          provenance: {
            status: 'unverified_omitted',
          },
        },
        warnings: [],
      });
    });
  });

  it('GET /providers/:provider/models/advanced only probes verified providers on explicit refresh', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: 'gpt-5.4' },
        { id: 'gpt-5.4-mini' },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await withRuntime({
      providerDefaultTargets: {
        codex: { backend: 'api', instance: 'main' },
      },
      remoteProviderCatalog: {
        api: {
          codex: {
            main: {
              id: 'main',
              providerName: 'codex',
              backend: 'api',
              transport: 'openai',
              apiKeyEnv: 'OPENAI_API_KEY',
              baseUrl: 'https://api.openai.test',
              model: 'gpt-5.4',
            },
          },
        },
        local: {},
        agent: {},
      },
    }, {
      apiBackend: {
        fetch: fetchMock,
        env: {
          OPENAI_API_KEY: 'route-openai-key',
        },
      },
    }, async (runtime) => {
      const immediate = await runtime.app.request('/providers/codex/models/advanced?instance=api/main');
      expect(immediate.status).toBe(200);
      expect(await immediate.json()).toMatchObject({
        provider: 'codex',
        backend: 'api',
        instance: 'main',
        defaultModel: 'gpt-5.4',
        source: 'config',
        cache: null,
        entries: [
          {
            id: 'gpt-5.4',
            label: 'gpt-5.4',
            default: true,
            status: 'configured',
            capabilityTags: ['tool_use', 'reasoning'],
          },
        ],
        presets: [
          {
            id: 'balanced',
            label: 'Balanced',
            availability: 'supported',
            applicableEntryIds: ['gpt-5.4'],
            preferredEntryId: 'gpt-5.4',
            controlDefaults: {
              'openai.reasoning_effort': 'medium',
            },
          },
          {
            id: 'fast',
            label: 'Fast',
            availability: 'supported',
            applicableEntryIds: ['gpt-5.4'],
            preferredEntryId: 'gpt-5.4',
            controlDefaults: {
              'openai.reasoning_effort': 'low',
            },
          },
          {
            id: 'deep_reasoning',
            label: 'Deep reasoning',
            availability: 'supported',
            applicableEntryIds: ['gpt-5.4'],
            preferredEntryId: 'gpt-5.4',
            controlDefaults: {
              'openai.reasoning_effort': 'high',
            },
          },
        ],
        controls: [
          {
            key: 'openai.reasoning_effort',
            label: 'Reasoning effort',
            description: 'Controls OpenAI reasoning effort for supported GPT-5 entries.',
            kind: 'enum',
            scope: 'both',
            values: [
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ],
            applicableEntryIds: ['gpt-5.4'],
            semanticTags: ['reasoning_intensity'],
          },
        ],
        defaultSelection: {
          entryId: 'gpt-5.4',
          entryMode: 'auto',
          presetId: 'balanced',
          controls: {
            'openai.reasoning_effort': 'medium',
          },
        },
        support: {
          tier: 'full',
        },
        warnings: [],
      });
      expect(fetchMock).not.toHaveBeenCalled();

      const refreshed = await runtime.app.request('/providers/codex/models/advanced?instance=api/main&refresh=1');
      expect(refreshed.status).toBe(200);
      expect(await refreshed.json()).toMatchObject({
        provider: 'codex',
        backend: 'api',
        instance: 'main',
        defaultModel: 'gpt-5.4',
        source: 'dynamic',
        cache: {
          servedFromCache: false,
          cachedAt: expect.any(String),
          ttlSec: 60,
        },
        entries: [
          {
            id: 'gpt-5.4',
            label: 'gpt-5.4',
            default: true,
            status: 'available',
            capabilityTags: ['tool_use', 'reasoning'],
          },
          {
            id: 'gpt-5.4-mini',
            label: 'gpt-5.4-mini',
            default: false,
            status: 'available',
            capabilityTags: ['tool_use', 'reasoning', 'latency_optimized'],
          },
        ],
        presets: [
          {
            id: 'balanced',
            label: 'Balanced',
            availability: 'supported',
            applicableEntryIds: ['gpt-5.4'],
            preferredEntryId: 'gpt-5.4',
            controlDefaults: {
              'openai.reasoning_effort': 'medium',
            },
          },
          {
            id: 'fast',
            label: 'Fast',
            availability: 'supported',
            applicableEntryIds: ['gpt-5.4'],
            preferredEntryId: 'gpt-5.4',
            controlDefaults: {
              'openai.reasoning_effort': 'low',
            },
          },
          {
            id: 'deep_reasoning',
            label: 'Deep reasoning',
            availability: 'supported',
            applicableEntryIds: ['gpt-5.4'],
            preferredEntryId: 'gpt-5.4',
            controlDefaults: {
              'openai.reasoning_effort': 'high',
            },
          },
        ],
        controls: [
          {
            key: 'openai.reasoning_effort',
            label: 'Reasoning effort',
            description: 'Controls OpenAI reasoning effort for supported GPT-5 entries.',
            kind: 'enum',
            scope: 'both',
            values: [
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ],
            applicableEntryIds: ['gpt-5.4', 'gpt-5.4-mini'],
            semanticTags: ['reasoning_intensity'],
          },
        ],
        defaultSelection: {
          entryId: 'gpt-5.4',
          entryMode: 'auto',
          presetId: 'balanced',
          controls: {
            'openai.reasoning_effort': 'medium',
          },
        },
        support: {
          tier: 'full',
        },
        warnings: [],
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('POST /sessions accepts structured model selection additively and preserves legacy model snapshot', async () => {
    await withRuntime({
      providerDefaultTargets: {
        codex: { backend: 'api', instance: 'main' },
      },
      remoteProviderCatalog: {
        api: {
          codex: {
            main: {
              id: 'main',
              providerName: 'codex',
              backend: 'api',
              transport: 'openai',
              apiKeyEnv: 'OPENAI_API_KEY',
              baseUrl: 'https://example.test',
              model: 'gpt-5.4',
            },
          },
        },
        local: {},
        agent: {},
      },
    }, {}, async (runtime) => {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'codex',
          cwd: '/tmp/cats-runtime-repo',
          modelSelection: {
            entryMode: 'auto',
            presetId: 'deep_reasoning',
            controls: {
              'openai.reasoning_effort': 'high',
            },
          },
        }),
      });

      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as Record<string, unknown>;
      expect(created.model).toBe('gpt-5.4');
      expect(created.modelSelection).toEqual({
        entryMode: 'auto',
        presetId: 'deep_reasoning',
        controls: {
          'openai.reasoning_effort': 'high',
        },
      });
      expect(created.modelResolution).toEqual({
        entryId: 'gpt-5.4',
        model: 'gpt-5.4',
        entryMode: 'auto',
        presetId: 'deep_reasoning',
        controls: {
          'openai.reasoning_effort': 'high',
        },
        supportTier: 'full',
        warnings: [],
      });

      const detailResponse = await runtime.app.request(`/sessions/${created.id}`);
      expect(detailResponse.status).toBe(200);
      expect(await detailResponse.json()).toMatchObject({
        model: 'gpt-5.4',
        modelSelection: {
          entryMode: 'auto',
          presetId: 'deep_reasoning',
          controls: {
            'openai.reasoning_effort': 'high',
          },
        },
        modelResolution: {
          entryId: 'gpt-5.4',
          model: 'gpt-5.4',
          entryMode: 'auto',
          presetId: 'deep_reasoning',
          controls: {
            'openai.reasoning_effort': 'high',
          },
          supportTier: 'full',
        },
      });
    });
  });

  it('surfaces resolved local tool policy for API-backed sessions in session inspection', async () => {
    await withRuntime({
      providerDefaultTargets: {
        codex: { backend: 'api', instance: 'main' },
      },
      remoteProviderCatalog: {
        api: {
          codex: {
            main: {
              id: 'main',
              providerName: 'codex',
              backend: 'api',
              transport: 'openai',
              apiKeyEnv: 'OPENAI_API_KEY',
              baseUrl: 'https://example.test',
              model: 'gpt-5.4',
              toolProfile: 'extended',
            },
          },
        },
        local: {},
        agent: {},
      },
    }, {}, async (runtime) => {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'codex',
          cwd: '/tmp/cats-runtime-repo',
          permissionMode: 'default',
        }),
      });

      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as Record<string, unknown>;
      expect(created.inspection).toEqual(expect.objectContaining({
        tools: expect.objectContaining({
          profile: 'extended',
          permissionMode: 'default',
          whitelistActive: false,
          fullAccessTools: expect.arrayContaining([
            'list_files',
            'inspect_path',
            'inspect_paths',
            'read_file',
            'grep',
            'audit-workspace',
          ]),
          previewOnlyTools: expect.arrayContaining([
            'init-workspace',
            'publish-artifacts',
            'create-commit',
          ]),
          blockedTools: expect.arrayContaining([
            'write_file',
            'create_directory',
            'edit_file',
            'delete_file',
            'copy_file',
          ]),
          capabilities: expect.arrayContaining([
            expect.objectContaining({
              name: 'read_files',
              domain: 'filesystem',
              access: 'full_access',
              readOnlyCompatible: true,
              mutating: false,
            }),
            expect.objectContaining({
              name: 'publish-artifacts',
              domain: 'delivery',
              access: 'preview_only',
              readOnlyCompatible: true,
              mutating: true,
            }),
            expect.objectContaining({
              name: 'write_file',
              domain: 'filesystem',
              access: 'blocked',
              readOnlyCompatible: false,
              mutating: true,
            }),
          ]),
        }),
      }));
      expect(created.providerTarget).toEqual(expect.objectContaining({
        provider: 'codex',
        backend: 'api',
        instance: 'main',
        target: 'api/main',
        resolved: true,
        transport: 'openai',
        model: 'gpt-5.4',
        apiRuntime: expect.objectContaining({
          family: 'api_runtime',
          transport: 'openai',
          continuation: expect.objectContaining({
            strategy: 'previous_response_id',
            summary: expect.stringContaining('previous_response_id'),
          }),
          caching: expect.objectContaining({
            strategy: 'none',
            active: false,
            summary: expect.stringContaining('No separate cache layer'),
          }),
          providerNativeTools: expect.objectContaining({
            state: 'deferred',
            summary: expect.stringContaining('Runtime-local tools remain primary'),
          }),
        }),
        continuity: expect.objectContaining({
          source: 'runtime_stateful',
          summary: expect.stringContaining('cats-runtime owns the host-visible session lifecycle'),
          resume: true,
          fork: true,
          permissions: true,
          providerManagedSessions: false,
          sessionKey: false,
          providerSessionState: true,
          remoteCancel: false,
        }),
        tooling: expect.objectContaining({
          source: 'runtime_local',
          discoverable: true,
          sessionScopedOverrides: true,
          summary: expect.stringContaining(`'extended' profile`),
          profiles: expect.objectContaining({
            defaultProfile: 'extended',
            availableProfiles: expect.arrayContaining([
              expect.objectContaining({ profile: 'standard' }),
              expect.objectContaining({ profile: 'extended' }),
              expect.objectContaining({ profile: 'read_only' }),
            ]),
            summary: "Runtime-local tooling currently exposes 3 selectable profiles; the default target uses 'extended'.",
          }),
          catalog: expect.objectContaining({
            source: 'runtime_local',
            summary: expect.stringContaining("Per-tool defaultAccess reflects the 'extended' profile"),
            tools: expect.arrayContaining([
              expect.objectContaining({
                name: 'copy_file',
                defaultAccess: 'full_access',
                profileAccess: {
                  standard: 'blocked',
                  extended: 'full_access',
                  read_only: 'blocked',
                },
              }),
            ]),
          }),
          policy: expect.objectContaining({
            profile: 'extended',
          }),
          observability: {
            catalog: 'runtime_enumerated',
            toolCallEvents: true,
            runtimeServices: false,
          },
        }),
      }));

      const detailResponse = await runtime.app.request(`/sessions/${created.id}`);
      expect(detailResponse.status).toBe(200);
      expect(await detailResponse.json()).toEqual(expect.objectContaining({
        providerTarget: expect.objectContaining({
          provider: 'codex',
          backend: 'api',
          instance: 'main',
          target: 'api/main',
          resolved: true,
          transport: 'openai',
          model: 'gpt-5.4',
          apiRuntime: expect.objectContaining({
            family: 'api_runtime',
            transport: 'openai',
          }),
        }),
        inspection: expect.objectContaining({
          tools: expect.objectContaining({
            profile: 'extended',
            permissionMode: 'default',
            previewOnlyTools: expect.arrayContaining(['push-branch']),
          }),
        }),
      }));

      const historyResponse = await runtime.app.request(`/sessions/${created.id}/history`);
      expect(historyResponse.status).toBe(200);
      expect(await historyResponse.json()).toEqual(expect.objectContaining({
        providerTarget: expect.objectContaining({
          provider: 'codex',
          backend: 'api',
          instance: 'main',
          target: 'api/main',
          resolved: true,
          transport: 'openai',
          model: 'gpt-5.4',
          apiRuntime: expect.objectContaining({
            family: 'api_runtime',
            transport: 'openai',
          }),
        }),
      }));

      const observeResponse = await runtime.app.request(`/sessions/${created.id}/observe`);
      expect(observeResponse.status).toBe(200);
      expect(await observeResponse.json()).toEqual(expect.objectContaining({
        session: expect.objectContaining({
          providerTarget: expect.objectContaining({
            provider: 'codex',
            backend: 'api',
            instance: 'main',
            target: 'api/main',
            resolved: true,
            transport: 'openai',
            model: 'gpt-5.4',
            apiRuntime: expect.objectContaining({
              family: 'api_runtime',
              transport: 'openai',
            }),
          }),
        }),
      }));
    });
  });

  it('POST /sessions keeps legacy model-only requests accepted during migration', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const spawnSpy = vi.spyOn(runtime.context.runtime, 'spawn').mockReturnValue(undefined);
      try {
        const response = await runtime.app.request('/sessions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            provider: 'codex',
            cwd: '/tmp',
            model: 'custom-preview-model',
          }),
        });

        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({
          providerName: 'codex',
          model: 'custom-preview-model',
          modelSelection: {
            entryId: 'custom-preview-model',
            entryMode: 'explicit',
          },
          modelResolution: {
            entryId: 'custom-preview-model',
            model: 'custom-preview-model',
            entryMode: 'explicit',
            warnings: [
              "Legacy model 'custom-preview-model' is not present in the advanced catalog; preserving it as a compatibility passthrough.",
            ],
          },
        });
        expect(spawnSpy).toHaveBeenCalledWith(
          expect.any(String),
          'codex',
          expect.objectContaining({
            model: 'custom-preview-model',
          }),
          'native',
          'cli',
        );
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  it('surfaces read-only workspace overlays in API-backed session inspection', async () => {
    await withRuntime({
      providerDefaultTargets: {
        codex: { backend: 'api', instance: 'main' },
      },
      remoteProviderCatalog: {
        api: {
          codex: {
            main: {
              id: 'main',
              providerName: 'codex',
              backend: 'api',
              transport: 'openai',
              apiKeyEnv: 'OPENAI_API_KEY',
              baseUrl: 'https://example.test',
              model: 'gpt-5.4',
              toolProfile: 'extended',
            },
          },
        },
        local: {},
        agent: {},
      },
    }, {}, async (runtime) => {
      const createResponse = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'codex',
          cwd: '/tmp/cats-runtime-repo',
          workspaceMode: 'read_only',
        }),
      });

      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as Record<string, unknown>;
      expect(created.inspection).toEqual(expect.objectContaining({
        tools: expect.objectContaining({
          profile: 'extended',
          permissionMode: 'default',
          workspaceMode: 'read_only',
          workspaceOverlayActive: true,
          whitelistActive: false,
          previewOnlyTools: expect.arrayContaining([
            'init-workspace',
            'publish-artifacts',
            'create-commit',
          ]),
          blockedTools: expect.arrayContaining([
            'write_file',
            'edit_file',
            'copy_file',
          ]),
        }),
      }));
    });
  });

  it('POST /sessions/:id/resume falls back to the legacy model when stored structured selection goes stale', async () => {
    await withRuntime({
      providerDefaultTargets: {
        codex: { backend: 'api', instance: 'main' },
      },
      remoteProviderCatalog: {
        api: {
          codex: {
            main: {
              id: 'main',
              providerName: 'codex',
              backend: 'api',
              transport: 'openai',
              apiKeyEnv: 'OPENAI_API_KEY',
              baseUrl: 'https://example.test',
              model: 'gpt-5.4',
            },
          },
        },
        local: {},
        agent: {},
      },
    }, {}, async (runtime) => {
      const session = runtime.context.registry.create({
        id: 'stale-selection-session',
        providerName: 'codex',
        providerBackend: 'api',
        providerInstanceId: 'main',
        cwd: '/tmp/cats-runtime-stale-selection',
        model: 'gpt-5.4',
        modelSelection: {
          entryMode: 'auto',
          presetId: 'sunset_preview',
        },
        modelResolution: {
          entryId: 'gpt-5.4',
          model: 'gpt-5.4',
          entryMode: 'auto',
          presetId: 'sunset_preview',
          supportTier: 'full',
          warnings: [],
        },
      });
      runtime.context.registry.updateStatus(session.id, 'closed');

      const response = await runtime.app.request(`/sessions/${session.id}/resume`, {
        method: 'POST',
      });

      expect(response.status).toBe(200);
      const payload = await response.json() as Record<string, unknown>;
      expect(payload).toMatchObject({
        id: session.id,
        model: 'gpt-5.4',
        modelSelection: {
          entryMode: 'auto',
        },
        modelResolution: {
          entryId: 'gpt-5.4',
          model: 'gpt-5.4',
          entryMode: 'auto',
          supportTier: 'full',
          warnings: [
            "Preset 'sunset_preview' is no longer available for codex/api/main; continuing without it.",
          ],
        },
      });
      expect((payload.modelSelection as Record<string, unknown>).presetId).toBeUndefined();
    });
  });

  it('POST /sessions/:id/resume normalizes legacy Copilot model ids without requiring modelSelection', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const spawnSpy = vi.spyOn(runtime.context.pool, 'spawn');
      const session = runtime.context.registry.create({
        id: 'legacy-copilot-model-session',
        providerName: 'copilot',
        providerBackend: 'cli',
        providerInstanceId: 'default',
        cwd: '/tmp/cats-runtime-copilot-legacy',
        model: 'claude-opus-4-6',
      });
      runtime.context.registry.setProviderSessionId(session.id, 'copilot-legacy-provider-session');
      runtime.context.registry.updateStatus(session.id, 'closed');

      const response = await runtime.app.request(`/sessions/${session.id}/resume`, {
        method: 'POST',
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        id: session.id,
        model: 'claude-opus-4.6',
        providerSessionId: 'copilot-legacy-provider-session',
      }));
      expect(runtime.context.registry.get(session.id)?.model).toBe('claude-opus-4.6');
      expect(spawnSpy).toHaveBeenCalled();
      expect(spawnSpy.mock.calls.at(-1)?.[2]).toEqual(expect.objectContaining({
        model: 'claude-opus-4.6',
        resumeSessionId: 'copilot-legacy-provider-session',
      }));
    });
  });

  it('POST /sessions rejects conflicting legacy model and structured selection payloads', async () => {
    await withRuntime({
      providerDefaultTargets: {
        codex: { backend: 'api', instance: 'main' },
      },
      remoteProviderCatalog: {
        api: {
          codex: {
            main: {
              id: 'main',
              providerName: 'codex',
              backend: 'api',
              transport: 'openai',
              apiKeyEnv: 'OPENAI_API_KEY',
              baseUrl: 'https://example.test',
              model: 'gpt-5.4',
            },
          },
        },
        local: {},
        agent: {},
      },
    }, {}, async (runtime) => {
      const response = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'codex',
          cwd: '/tmp/cats-runtime-repo',
          model: 'gpt-5.3-codex',
          modelSelection: {
            entryMode: 'auto',
            presetId: 'deep_reasoning',
            controls: {
              'openai.reasoning_effort': 'high',
            },
          },
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Legacy model 'gpt-5.3-codex' does not match resolved structured selection 'gpt-5.4'",
      });
    });
  });

  it('POST /sessions rejects controls that do not belong to the selected provider target', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'codex',
          cwd: '/tmp/cats-runtime-repo',
          modelSelection: {
            entryMode: 'explicit',
            entryId: 'gpt-5.4',
            controls: {
              'openai.reasoning_effort': 'high',
            },
          },
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Control 'openai.reasoning_effort' is not supported for codex/cli/native",
      });
    });
  });

  it('POST /sessions rejects explicit Codex entries that are no longer in the catalog', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'codex',
          cwd: '/tmp/cats-runtime-repo',
          modelSelection: {
            entryMode: 'explicit',
            entryId: 'retired-codex-model',
          },
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Unknown catalog entry 'retired-codex-model'",
      });
    });
  });

  it('GET /providers/:provider/models only probes Ollama on explicit refresh and then serves cached dynamic results', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({
          models: [
            { name: 'deepseek-r1:14b' },
            { name: 'qwen2.5-coder:7b' },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.endsWith('/api/ps')) {
        return new Response(JSON.stringify({
          models: [
            { name: 'qwen2.5-coder:7b' },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await withRuntime({
      providerDefaultTargets: {
        ollama: { backend: 'local', instance: 'local' },
      },
      remoteProviderCatalog: {
        api: {},
        local: {
          ollama: {
            local: {
              id: 'local',
              providerName: 'ollama',
              backend: 'local',
              transport: 'ollama',
              baseUrl: 'http://127.0.0.1:11434',
              model: 'qwen2.5-coder:7b',
            },
          },
        },
        agent: {},
      },
    }, { apiBackend: { fetch: fetchMock } }, async (runtime) => {
      const first = await runtime.app.request('/providers/ollama/models');
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({
        provider: 'ollama',
        backend: 'local',
        instance: 'local',
        defaultModel: 'qwen2.5-coder:7b',
        source: 'config',
        cache: null,
        models: [
          {
            id: 'qwen2.5-coder:7b',
            label: 'qwen2.5-coder:7b',
            default: true,
            status: 'configured',
          },
        ],
        warnings: [],
      });
      expect(fetchMock).not.toHaveBeenCalled();

      const refreshed = await runtime.app.request('/providers/ollama/models?refresh=1');
      expect(refreshed.status).toBe(200);
      expect(await refreshed.json()).toEqual({
        provider: 'ollama',
        backend: 'local',
        instance: 'local',
        defaultModel: 'qwen2.5-coder:7b',
        source: 'dynamic',
        cache: {
          servedFromCache: false,
          cachedAt: expect.any(String),
          ttlSec: 60,
        },
        models: [
          {
            id: 'deepseek-r1:14b',
            label: 'deepseek-r1:14b',
            default: false,
            status: 'available',
          },
          {
            id: 'qwen2.5-coder:7b',
            label: 'qwen2.5-coder:7b',
            default: true,
            status: 'running',
          },
        ],
        warnings: [],
      });

      const second = await runtime.app.request('/providers/ollama/models');
      expect(second.status).toBe(200);
      expect((await second.json()).cache).toEqual({
        servedFromCache: true,
        cachedAt: expect.any(String),
        ttlSec: 60,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('GET /providers/:provider/models loads a dynamic OpenAI catalog only when refresh is requested', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe('https://api.openai.test/v1/models');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer route-openai-key');
      expect(headers.get('OpenAI-Organization')).toBe('route-openai-org');
      expect(headers.get('OpenAI-Project')).toBe('route-openai-project');
      return new Response(JSON.stringify({
        data: [
          { id: 'gpt-5.4' },
          { id: 'gpt-5.4-mini' },
          { id: 'text-embedding-3-small' },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await withRuntime({
      providerDefaultTargets: {
        codex: { backend: 'api', instance: 'main' },
      },
      remoteProviderCatalog: {
        api: {
          codex: {
            main: {
              id: 'main',
              providerName: 'codex',
              backend: 'api',
              transport: 'openai',
              apiKeyEnv: 'OPENAI_API_KEY',
              organizationEnv: 'OPENAI_ORG_ID',
              projectEnv: 'OPENAI_PROJECT_ID',
              baseUrl: 'https://api.openai.test',
              model: 'gpt-5.4',
            },
          },
        },
        local: {},
        agent: {},
      },
    }, {
      apiBackend: {
        fetch: fetchMock,
        env: {
          OPENAI_API_KEY: 'route-openai-key',
          OPENAI_ORG_ID: 'route-openai-org',
          OPENAI_PROJECT_ID: 'route-openai-project',
        },
      },
    }, async (runtime) => {
      const immediate = await runtime.app.request('/providers/codex/models?instance=api/main');
      expect(immediate.status).toBe(200);
      expect(await immediate.json()).toEqual({
        provider: 'codex',
        backend: 'api',
        instance: 'main',
        defaultModel: 'gpt-5.4',
        source: 'config',
        cache: null,
        models: [
          { id: 'gpt-5.4', label: 'gpt-5.4', default: true, status: 'configured' },
        ],
        warnings: [],
      });
      expect(fetchMock).not.toHaveBeenCalled();

      const response = await runtime.app.request('/providers/codex/models?instance=api/main&refresh=1');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        provider: 'codex',
        backend: 'api',
        instance: 'main',
        defaultModel: 'gpt-5.4',
        source: 'dynamic',
        cache: {
          servedFromCache: false,
          cachedAt: expect.any(String),
          ttlSec: 60,
        },
        models: [
          { id: 'gpt-5.4', label: 'gpt-5.4', default: true, status: 'available' },
          { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', default: false, status: 'available' },
        ],
        warnings: [],
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('GET /providers/:provider/models surfaces auth-skip warnings when remote discovery credentials are missing', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('fetch should not run when auth is missing');
    });

    await withRuntime({
      providerDefaultTargets: {
        claude: { backend: 'api', instance: 'sonnet' },
      },
      remoteProviderCatalog: {
        api: {
          claude: {
            sonnet: {
              id: 'sonnet',
              providerName: 'claude',
              backend: 'api',
              transport: 'anthropic',
              apiKeyEnv: 'ANTHROPIC_API_KEY',
              baseUrl: 'https://api.anthropic.test',
              model: 'claude-sonnet-4-6',
            },
          },
        },
        local: {},
        agent: {},
      },
    }, {
      apiBackend: {
        fetch: fetchMock,
        env: {},
      },
    }, async (runtime) => {
      const response = await runtime.app.request('/providers/claude/models?instance=api/sonnet');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        provider: 'claude',
        backend: 'api',
        instance: 'sonnet',
        defaultModel: 'claude-sonnet-4-6',
        source: 'config',
        cache: null,
        models: [
          {
            id: 'claude-sonnet-4-6',
            label: 'claude-sonnet-4-6',
            default: true,
            status: 'configured',
          },
        ],
        warnings: [
          "Dynamic model discovery skipped for claude/api/sonnet: required x-api-key credentials are not configured via 'ANTHROPIC_API_KEY'.",
        ],
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('GET /providers/:provider/models uses agent adapter model discovery only on refresh', async () => {
    const bridgeFetch = vi.fn(async () => new Response(JSON.stringify({
      providers: [
        { name: 'openai', models: ['gpt-5.4', 'gpt-5.3-codex'] },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await withRuntime({
      providerDefaultTargets: {
        codex: { backend: 'agent', instance: 'bridge' },
      },
      remoteProviderCatalog: {
        api: {},
        local: {},
        agent: {
          codex: {
            bridge: {
              id: 'bridge',
              providerName: 'codex',
              backend: 'agent',
              transport: 'agent_sdk_bridge',
              baseUrl: 'http://127.0.0.1:8082',
              model: 'gpt-5.4',
            },
          },
        },
      },
    }, { agentBackend: { fetch: bridgeFetch } }, async (runtime) => {
      const immediate = await runtime.app.request('/providers/codex/models?instance=agent/bridge');
      expect(immediate.status).toBe(200);
      expect(await immediate.json()).toEqual({
        provider: 'codex',
        backend: 'agent',
        instance: 'bridge',
        defaultModel: 'gpt-5.4',
        source: 'config',
        cache: null,
        models: [
          { id: 'gpt-5.4', label: 'gpt-5.4', default: true, status: 'configured' },
        ],
        warnings: [],
      });
      expect(bridgeFetch).not.toHaveBeenCalled();

      const response = await runtime.app.request('/providers/codex/models?instance=agent/bridge&refresh=1');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        provider: 'codex',
        backend: 'agent',
        instance: 'bridge',
        defaultModel: 'gpt-5.4',
        source: 'dynamic',
        cache: {
          servedFromCache: false,
          cachedAt: expect.any(String),
          ttlSec: 60,
        },
        models: [
          { id: 'gpt-5.4', label: 'gpt-5.4', default: true, status: 'available' },
          { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex', default: false, status: 'available' },
        ],
        warnings: [],
      });
      expect(bridgeFetch).toHaveBeenCalledTimes(1);
    });
  });

  it('GET /providers/:provider/models loads a dynamic Pi catalog through the CLI runtime helper only on refresh', async () => {
    const spawnMock = vi.spyOn(providerInstallRunner, 'runSpawnedCommand').mockResolvedValueOnce({
      exitCode: 0,
      stdout: [
        'provider    model',
        'openai-codex  gpt-5.4',
        'anthropic     claude-sonnet-4-5',
        '',
      ].join('\n'),
      stderr: '',
      timedOut: false,
      durationMs: 3,
    });

    try {
      await withRuntime({}, {}, async (runtime) => {
        const immediate = await runtime.app.request('/providers/pi/models');
        expect(immediate.status).toBe(200);
        expect(await immediate.json()).toEqual({
          provider: 'pi',
          backend: 'cli',
          instance: 'native',
          defaultModel: 'openai-codex/gpt-5.4',
          source: 'static',
          cache: null,
          models: [
            {
              id: 'openai-codex/gpt-5.4',
              label: 'openai-codex/gpt-5.4',
              default: true,
            },
          ],
          warnings: [],
        });
        expect(spawnMock).not.toHaveBeenCalled();

        const response = await runtime.app.request('/providers/pi/models?refresh=1');
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload).toEqual(expect.objectContaining({
          provider: 'pi',
          backend: 'cli',
          instance: 'native',
          defaultModel: 'openai-codex/gpt-5.4',
          source: 'dynamic',
          cache: {
            servedFromCache: false,
            cachedAt: expect.any(String),
            ttlSec: 60,
          },
          warnings: [],
        }));
        expect(payload.models).toEqual([
          {
            id: 'anthropic/claude-sonnet-4-5',
            label: 'anthropic/claude-sonnet-4-5',
            default: false,
            status: 'available',
          },
          {
            id: 'openai-codex/gpt-5.4',
            label: 'openai-codex/gpt-5.4',
            default: true,
            status: 'available',
          },
        ]);
      });
      expect(spawnMock).toHaveBeenCalledTimes(1);
    } finally {
      spawnMock.mockRestore();
    }
  });

  it('GET /providers/:provider/models loads a dynamic OpenCode catalog through the CLI runtime helper only on refresh', async () => {
    const spawnMock = vi.spyOn(providerInstallRunner, 'runSpawnedCommand')
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: [
          'anthropic/claude-sonnet-4-5',
          'opencode-go/glm-5',
        ].join('\n'),
        stderr: '',
        timedOut: false,
        durationMs: 3,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: [
          'anthropic/claude-sonnet-4-5',
          'opencode-go/glm-5',
          'openai/gpt-5.4',
        ].join('\n'),
        stderr: '',
        timedOut: false,
        durationMs: 3,
      });

    try {
      await withRuntime({}, {}, async (runtime) => {
        const first = await runtime.app.request('/providers/opencode/models');
        expect(first.status).toBe(200);
        expect(await first.json()).toEqual({
          provider: 'opencode',
          backend: 'cli',
          instance: 'native',
          defaultModel: 'opencode-go/glm-5',
          source: 'static',
          cache: null,
          models: [
            {
              id: 'opencode-go/glm-5',
              label: 'glm-5',
              default: true,
            },
            {
              id: 'opencode-go/kimi-k2.5',
              label: 'kimi k2.5',
              default: false,
            },
            {
              id: 'opencode-go/minimax-m2.5',
              label: 'minimax m2.5',
              default: false,
            },
          ],
          warnings: [],
        });

        const refreshed = await runtime.app.request('/providers/opencode/models?refresh=1');
        expect(refreshed.status).toBe(200);
        expect(await refreshed.json()).toEqual({
          provider: 'opencode',
          backend: 'cli',
          instance: 'native',
          defaultModel: 'opencode-go/glm-5',
          source: 'dynamic',
          cache: {
            servedFromCache: false,
            cachedAt: expect.any(String),
            ttlSec: 60,
          },
          models: [
            {
              id: 'anthropic/claude-sonnet-4-5',
              label: 'anthropic/claude-sonnet-4-5',
              default: false,
              status: 'available',
            },
            {
              id: 'opencode-go/glm-5',
              label: 'opencode-go/glm-5',
              default: true,
              status: 'available',
            },
          ],
          warnings: [],
        });

        const refreshedAgain = await runtime.app.request('/providers/opencode/models?refresh=1');
        expect(refreshedAgain.status).toBe(200);
        expect(await refreshedAgain.json()).toEqual({
          provider: 'opencode',
          backend: 'cli',
          instance: 'native',
          defaultModel: 'opencode-go/glm-5',
          source: 'dynamic',
          cache: {
            servedFromCache: false,
            cachedAt: expect.any(String),
            ttlSec: 60,
          },
          models: [
            {
              id: 'anthropic/claude-sonnet-4-5',
              label: 'anthropic/claude-sonnet-4-5',
              default: false,
              status: 'available',
            },
            {
              id: 'openai/gpt-5.4',
              label: 'openai/gpt-5.4',
              default: false,
              status: 'available',
            },
            {
              id: 'opencode-go/glm-5',
              label: 'opencode-go/glm-5',
              default: true,
              status: 'available',
            },
          ],
          warnings: [],
        });
      });

      const expectDynamicModelRefreshSpawn = (callIndex: number) => {
        const [, args, options] = spawnMock.mock.calls[callIndex - 1] as [
          string,
          string[],
          { timeoutMs: number; env?: Record<string, string> },
        ];
        expect(options).toEqual(expect.objectContaining({
          timeoutMs: 20_000,
        }));

        if (process.platform === 'win32') {
          const payloadBase64 = options.env?.CATS_RUNTIME_PWSH_EXEC_B64;
          if (payloadBase64) {
            expect(args).toEqual(expect.arrayContaining([
              '-NoLogo',
              '-NoProfile',
              '-Command',
            ]));
            const payload = JSON.parse(
              Buffer.from(payloadBase64, 'base64').toString('utf8'),
            ) as { command: string; args: string[] };
            expect(payload.command).toEqual(expect.any(String));
            expect(payload.args).toEqual(expect.arrayContaining(['models', '--refresh']));
            return;
          }

          expect(args).toHaveLength(5);
          expect(args.slice(0, 4)).toEqual(['/d', '/v:off', '/s', '/c']);
          expect(args[4]).toContain('.cmd');
          expect(args[4]).toContain('"models"');
          expect(args[4]).toContain('"--refresh"');
          return;
        }

        expect(args).toEqual(expect.arrayContaining(['models', '--refresh']));
      };

      expectDynamicModelRefreshSpawn(1);
      expectDynamicModelRefreshSpawn(2);
    } finally {
      spawnMock.mockRestore();
    }
  });

  it('GET /providers/:provider/models falls back to config/static when an explicit refresh fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused');
    });

    await withRuntime({
      providerDefaultTargets: {
        ollama: { backend: 'local', instance: 'local' },
      },
      remoteProviderCatalog: {
        api: {},
        local: {
          ollama: {
            local: {
              id: 'local',
              providerName: 'ollama',
              backend: 'local',
              transport: 'ollama',
              baseUrl: 'http://127.0.0.1:11434',
              model: 'qwen2.5-coder:7b',
            },
          },
        },
        agent: {},
      },
    }, { apiBackend: { fetch: fetchMock } }, async (runtime) => {
      const response = await runtime.app.request('/providers/ollama/models?refresh=1');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        provider: 'ollama',
        backend: 'local',
        instance: 'local',
        defaultModel: 'qwen2.5-coder:7b',
        source: 'config',
        cache: null,
        models: [
          {
            id: 'qwen2.5-coder:7b',
            label: 'qwen2.5-coder:7b',
            default: true,
            status: 'configured',
          },
        ],
        warnings: [
          expect.stringContaining(
            'Dynamic model discovery failed for ollama/local/local: connection refused',
          ),
          expect.stringContaining(
            'Dynamic model discovery backoff is active for ollama/local/local until ',
          ),
        ],
      });
    });
  });

  it('GET /providers/:provider/models reuses stale dynamic cache when an explicit refresh fails after TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T00:00:00.000Z'));

    try {
      let refreshFailed = false;
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (refreshFailed) {
          throw new Error('connection refused');
        }

        if (url.endsWith('/api/tags')) {
          return new Response(JSON.stringify({
            models: [
              { name: 'deepseek-r1:14b' },
              { name: 'qwen2.5-coder:7b' },
            ],
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (url.endsWith('/api/ps')) {
          return new Response(JSON.stringify({
            models: [
              { name: 'qwen2.5-coder:7b' },
            ],
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      await withRuntime({
        providerDefaultTargets: {
          ollama: { backend: 'local', instance: 'local' },
        },
        remoteProviderCatalog: {
          api: {},
          local: {
            ollama: {
              local: {
                id: 'local',
                providerName: 'ollama',
                backend: 'local',
                transport: 'ollama',
                baseUrl: 'http://127.0.0.1:11434',
                model: 'qwen2.5-coder:7b',
              },
            },
          },
          agent: {},
        },
      }, { apiBackend: { fetch: fetchMock } }, async (runtime) => {
        const first = await runtime.app.request('/providers/ollama/models?refresh=1');
        expect(first.status).toBe(200);
        expect(await first.json()).toEqual({
          provider: 'ollama',
          backend: 'local',
          instance: 'local',
          defaultModel: 'qwen2.5-coder:7b',
          source: 'dynamic',
          cache: {
            servedFromCache: false,
            cachedAt: '2026-03-27T00:00:00.000Z',
            ttlSec: 60,
          },
          models: [
            {
              id: 'deepseek-r1:14b',
              label: 'deepseek-r1:14b',
              default: false,
              status: 'available',
            },
            {
              id: 'qwen2.5-coder:7b',
              label: 'qwen2.5-coder:7b',
              default: true,
              status: 'running',
            },
          ],
          warnings: [],
        });

        refreshFailed = true;
        vi.setSystemTime(new Date('2026-03-27T00:01:01.000Z'));

        const second = await runtime.app.request('/providers/ollama/models?refresh=1');
        expect(second.status).toBe(200);
        expect(await second.json()).toEqual({
          provider: 'ollama',
          backend: 'local',
          instance: 'local',
          defaultModel: 'qwen2.5-coder:7b',
          source: 'dynamic',
          cache: {
            servedFromCache: true,
            cachedAt: '2026-03-27T00:00:00.000Z',
            ttlSec: 60,
            stale: true,
            backoff: {
              active: true,
              consecutiveFailures: 1,
              lastFailureAt: '2026-03-27T00:01:01.000Z',
              nextRefreshAllowedAt: '2026-03-27T00:02:01.000Z',
              reason: 'Dynamic model discovery failed for ollama/local/local: connection refused',
            },
          },
          models: [
            {
              id: 'deepseek-r1:14b',
              label: 'deepseek-r1:14b',
              default: false,
              status: 'available',
            },
            {
              id: 'qwen2.5-coder:7b',
              label: 'qwen2.5-coder:7b',
              default: true,
              status: 'running',
            },
          ],
          warnings: [
            'Dynamic model discovery failed for ollama/local/local: connection refused Serving stale cached catalog from 2026-03-27T00:00:00.000Z.',
            'Dynamic model discovery backoff is active for ollama/local/local until 2026-03-27T00:02:01.000Z after 1 failure(s): Dynamic model discovery failed for ollama/local/local: connection refused',
          ],
        });

        const third = await runtime.app.request('/providers/ollama/models?refresh=1');
        expect(third.status).toBe(200);
        expect(await third.json()).toEqual({
          provider: 'ollama',
          backend: 'local',
          instance: 'local',
          defaultModel: 'qwen2.5-coder:7b',
          source: 'dynamic',
          cache: {
            servedFromCache: true,
            cachedAt: '2026-03-27T00:00:00.000Z',
            ttlSec: 60,
            stale: true,
            backoff: {
              active: true,
              consecutiveFailures: 1,
              lastFailureAt: '2026-03-27T00:01:01.000Z',
              nextRefreshAllowedAt: '2026-03-27T00:02:01.000Z',
              reason: 'Dynamic model discovery failed for ollama/local/local: connection refused',
            },
          },
          models: [
            {
              id: 'deepseek-r1:14b',
              label: 'deepseek-r1:14b',
              default: false,
              status: 'available',
            },
            {
              id: 'qwen2.5-coder:7b',
              label: 'qwen2.5-coder:7b',
              default: true,
              status: 'running',
            },
          ],
          warnings: [
            'Dynamic model discovery backoff is active for ollama/local/local until 2026-03-27T00:02:01.000Z after 1 failure(s): Dynamic model discovery failed for ollama/local/local: connection refused',
          ],
        });
        expect(fetchMock).toHaveBeenCalledTimes(3);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('GET /providers/:provider/models refreshes a cached dynamic catalog when requested', async () => {
    let revision = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({
          models: [
            { name: revision === 0 ? 'deepseek-r1:14b' : 'qwen2.5-coder:7b' },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.endsWith('/api/ps')) {
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await withRuntime({
      providerDefaultTargets: {
        ollama: { backend: 'local', instance: 'local' },
      },
      remoteProviderCatalog: {
        api: {},
        local: {
          ollama: {
            local: {
              id: 'local',
              providerName: 'ollama',
              backend: 'local',
              transport: 'ollama',
              baseUrl: 'http://127.0.0.1:11434',
              model: 'qwen2.5-coder:7b',
            },
          },
        },
        agent: {},
      },
    }, { apiBackend: { fetch: fetchMock } }, async (runtime) => {
      const first = await runtime.app.request('/providers/ollama/models?refresh=1');
      expect(first.status).toBe(200);
      await expect(first.json()).resolves.toEqual(expect.objectContaining({
        source: 'dynamic',
        cache: expect.objectContaining({
          servedFromCache: false,
        }),
        models: expect.arrayContaining([
          expect.objectContaining({
            id: 'deepseek-r1:14b',
          }),
        ]),
      }));

      revision = 1;

      const refreshed = await runtime.app.request('/providers/ollama/models?refresh=1');
      expect(refreshed.status).toBe(200);
      await expect(refreshed.json()).resolves.toEqual(expect.objectContaining({
        source: 'dynamic',
        cache: expect.objectContaining({
          servedFromCache: false,
        }),
        models: expect.arrayContaining([
          expect.objectContaining({
            id: 'qwen2.5-coder:7b',
            default: true,
          }),
        ]),
      }));
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  it('GET /providers/:provider/models returns 400 for unknown providers', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/missing/models');
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Failed to inspect provider models: Error: Provider 'missing' is not configured",
        code: 'provider_not_configured',
      });
    });
  });

  it('GET /providers/:provider/models returns a stable resolution code for invalid instances', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/codex/models?instance=api/missing');
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Failed to inspect provider models: Error: Unknown codex target 'api/missing'. Valid: cli/native",
        code: 'unknown_target',
      });
    });
  });

  it('GET /providers/:provider/models returns 400 for invalid refresh query values', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/codex/models?refresh=maybe');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Invalid refresh query value 'maybe'. Use true/false or 1/0.",
      });
    });
  });

  it('createDiscoveryController falls back to default services when instance resolvers are absent', async () => {
    const { config, cleanup } = createTestConfig();
    const runtime = createRuntimeServer(config);

    try {
      expect(() => createDiscoveryController({
        ...runtime.context,
        resolveCursorNative: undefined,
        resolveKiroNative: undefined,
        resolveAuggieSessions: undefined,
        resolveOpencodeNative: undefined,
        wslDiscoveryStatus: undefined,
      })).not.toThrow();
    } finally {
      await runtime.close();
      await cleanup();
    }
  });
});
