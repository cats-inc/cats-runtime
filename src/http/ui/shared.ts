// ---------------------------------------------------------------------------
// Shared Runtime UI Foundation
//
// Canonical source for design tokens, provider badge styles, and thin
// browser-side helpers shared across dashboard, playground, and
// provider-setup.  Consumed by the server-side injector
// (src/http/uiInjector.ts) which inlines the CSS and JS into each
// page before serving.
// ---------------------------------------------------------------------------

import { GENERATED_RUNTIME_TAILWIND_CSS } from './generated/runtimeTailwind.js';
import { RUNTIME_SURFACE_DESCRIPTORS } from './runtimeShell.js';

// ---------------------------------------------------------------------------
// CSS: Design Tokens
// ---------------------------------------------------------------------------

export const SHARED_TOKENS_CSS = GENERATED_RUNTIME_TAILWIND_CSS;

// ---------------------------------------------------------------------------
// CSS: Provider Badge Styles
// ---------------------------------------------------------------------------

export const PROVIDER_BADGE_CSS = `
.provider-badge {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 5px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  display: inline-block;
}
.provider-badge[data-p="claude"]   { background: rgba(251,146,60,0.18);  color: var(--claude, #fb923c); }
.provider-badge[data-p="codex"]    { background: rgba(52,211,153,0.18);  color: var(--codex, #34d399); }
.provider-badge[data-p="gemini"]   { background: rgba(96,165,250,0.18);  color: var(--gemini, #60a5fa); }
.provider-badge[data-p="cursor"]   { background: rgba(244,114,182,0.18); color: var(--cursorp, #f472b6); }
.provider-badge[data-p="copilot"]  { background: rgba(129,140,248,0.18); color: var(--copilot, #818cf8); }
.provider-badge[data-p="opencode"] { background: rgba(192,132,252,0.18); color: var(--opencode, #c084fc); }
.provider-badge[data-p="kilo"]     { background: rgba(251,113,133,0.18); color: var(--kilo, #fb7185); }
.provider-badge[data-p="goose"]    { background: rgba(163,230,53,0.18);  color: var(--goose, #a3e635); }
.provider-badge[data-p="pi"]       { background: rgba(168,162,158,0.18); color: var(--pi, #a8a29e); }
.provider-badge[data-p="auggie"]   { background: rgba(34,211,238,0.18);  color: var(--auggie, #22d3ee); }
.provider-badge[data-p="junie"]    { background: rgba(251,191,36,0.18);  color: var(--junie, #fbbf24); }
.provider-badge[data-p="kiro"]     { background: rgba(45,212,191,0.18);  color: var(--kiro, #2dd4bf); }
.provider-badge[data-p="ollama"]   { background: rgba(148,163,184,0.18); color: var(--ollama, #94a3b8); }
.provider-badge[data-p="openclaw"] { background: rgba(248,113,113,0.18); color: var(--openclaw, #f87171); }
.status-badge {
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  display: inline-block;
}
.status-badge-ok         { background: var(--green, #4ade80);  color: #000; }
.status-badge-ready      { background: var(--green, #4ade80);  color: #000; }
.status-badge-degraded   { background: var(--yellow, #facc15); color: #000; }
.status-badge-bootstrap  { background: var(--orange, #fb923c); color: #000; }
.status-badge-unavailable { background: var(--red, #f87171);   color: #fff; }
.status-badge-unknown    { background: var(--text2, #8b90a0);  color: #000; }
`.trim();

// ---------------------------------------------------------------------------
// JS: Shared Browser Helpers (IIFE — attaches to window.CatsUI)
// ---------------------------------------------------------------------------

export const SHARED_UI_SCRIPT = `
(function() {
  'use strict';

  function getApiKey() {
    var el = document.getElementById('apiKeyInput')
          || document.getElementById('api-key');
    if (el && typeof el.value === 'string') {
      return el.value.trim();
    }
    return '';
  }

  function authHeaders(extra) {
    var h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    var key = getApiKey();
    if (key) h['Authorization'] = 'Bearer ' + key;
    return h;
  }

  function apiFetch(path, init) {
    init = init || {};
    if (!init.headers) {
      init.headers = authHeaders();
    } else {
      var ah = authHeaders();
      for (var k in ah) {
        if (!init.headers[k]) init.headers[k] = ah[k];
      }
    }
    return fetch(path, init);
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  var runtimeSurfaceDescriptors = ${JSON.stringify(RUNTIME_SURFACE_DESCRIPTORS)};

  function findRuntimeSurfaceDescriptor(surfaceId) {
    for (var i = 0; i < runtimeSurfaceDescriptors.length; i++) {
      if (runtimeSurfaceDescriptors[i] && runtimeSurfaceDescriptors[i].id === surfaceId) {
        return runtimeSurfaceDescriptors[i];
      }
    }
    return runtimeSurfaceDescriptors[0] || null;
  }

  function renderRuntimeSurfaceMenuItem(surface, activeSurface, bootstrapRequired) {
    if (!surface || !surface.id) {
      return '';
    }

    var isCurrent = surface.id === activeSurface;
    var isLocked = bootstrapRequired && surface.id !== 'setup';
    var classNames = ['runtime-surface-item'];
    if (isCurrent) classNames.push('is-current');
    if (isLocked) classNames.push('is-locked');

    var badge = isLocked
      ? '<span class="runtime-surface-item-badge">Locked</span>'
      : isCurrent
        ? '<span class="runtime-surface-item-badge">Current</span>'
        : '';
    var check = isCurrent
      ? '<span class="runtime-surface-item-check" style="background:rgba(196,101,58,0.12);color:#C4653A;" aria-hidden="true">'
        + '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="m2.4 6.3 2.1 2.1 5.1-5.1" />'
        + '</svg>'
        + '</span>'
      : '';
    var content = ''
      + '<span class="runtime-surface-swatch" style="' + escapeAttr(surface.swatchStyle || '') + '" aria-hidden="true"></span>'
      + '<span class="runtime-surface-item-copy">'
      + '<span class="runtime-surface-item-title-row">'
      + '<span class="runtime-surface-item-title">' + escapeAttr(surface.label || '') + '</span>'
      + badge
      + '</span>'
      + '<span class="runtime-surface-item-subtitle" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
      + escapeAttr(surface.subtitle || '')
      + '</span>'
      + '</span>'
      + check;

    if (isLocked || isCurrent) {
      return '<button type="button" class="' + escapeAttr(classNames.join(' ')) + '" disabled aria-disabled="true" role="menuitemradio" aria-checked="' + (isCurrent ? 'true' : 'false') + '">'
        + content
        + '</button>';
    }

    return '<a href="' + escapeAttr(surface.href || '#') + '" class="' + escapeAttr(classNames.join(' ')) + '" role="menuitemradio" aria-checked="false">'
      + content
      + '</a>';
  }

  function syncRuntimeSurfaceSwitcher(root, options) {
    if (!(root instanceof Element)) return;
    var activeSurface = options && options.activeSurface
      ? options.activeSurface
      : root.getAttribute('data-active-surface')
        || document.body.getAttribute('data-runtime-surface')
        || 'dashboard';
    var bootstrapRequired = options && typeof options.bootstrapRequired === 'boolean'
      ? options.bootstrapRequired
      : root.getAttribute('data-bootstrap-required') === 'true';
    var activeDescriptor = findRuntimeSurfaceDescriptor(activeSurface);
    root.setAttribute('data-active-surface', activeSurface);
    root.setAttribute('data-bootstrap-required', bootstrapRequired ? 'true' : 'false');
    var triggerLabel = root.querySelector('.runtime-surface-trigger-label');
    if (triggerLabel && activeDescriptor) {
      triggerLabel.textContent = activeDescriptor.label || '';
    }
    var menuList = root.querySelector('.runtime-surface-menu-list');
    if (menuList) {
      menuList.innerHTML = runtimeSurfaceDescriptors.map(function(surface) {
        return renderRuntimeSurfaceMenuItem(surface, activeSurface, bootstrapRequired);
      }).join('');
    }
  }

  function syncRuntimeBootstrapState(bootstrapRequired) {
    var nextBootstrapRequired = bootstrapRequired === true;
    if (document.body) {
      document.body.setAttribute('data-bootstrap-required', nextBootstrapRequired ? 'true' : 'false');
    }
    var roots = document.querySelectorAll('[data-runtime-surface-switcher]');
    for (var i = 0; i < roots.length; i++) {
      syncRuntimeSurfaceSwitcher(roots[i], { bootstrapRequired: nextBootstrapRequired });
    }
    closeRuntimeSurfaceMenus();
  }

  function renderProviderBadge(provider, label) {
    var p = String(provider || '').toLowerCase();
    var text = label || p.toUpperCase();
    return '<span class="provider-badge" data-p="' + escapeAttr(p) + '">' + escapeAttr(text) + '</span>';
  }

  function renderStatusBadge(status, label) {
    var cls = 'status-badge status-badge-' + String(status || 'unknown').toLowerCase();
    return '<span class="' + escapeAttr(cls) + '">' + escapeAttr(label || status || 'Unknown') + '</span>';
  }

  function cloneJson(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeAdvancedCatalog(catalog) {
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
      return null;
    }
    return {
      provider: typeof catalog.provider === 'string' ? catalog.provider : '',
      backend: typeof catalog.backend === 'string' ? catalog.backend : '',
      instance: typeof catalog.instance === 'string' ? catalog.instance : '',
      defaultModel: typeof catalog.defaultModel === 'string' ? catalog.defaultModel : null,
      source: typeof catalog.source === 'string' ? catalog.source : 'static',
      cache: catalog.cache && typeof catalog.cache === 'object' ? cloneJson(catalog.cache) : null,
      entries: Array.isArray(catalog.entries) ? cloneJson(catalog.entries) : [],
      presets: Array.isArray(catalog.presets) ? cloneJson(catalog.presets) : [],
      controls: Array.isArray(catalog.controls) ? cloneJson(catalog.controls) : [],
      defaultSelection: catalog.defaultSelection && typeof catalog.defaultSelection === 'object'
        ? cloneJson(catalog.defaultSelection)
        : null,
      support: catalog.support && typeof catalog.support === 'object'
        ? cloneJson(catalog.support)
        : { tier: 'read_only' },
      warnings: Array.isArray(catalog.warnings) ? cloneJson(catalog.warnings) : [],
    };
  }

  function findAdvancedCatalogEntry(catalog, entryId) {
    var entries = catalog && Array.isArray(catalog.entries) ? catalog.entries : [];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i] && entries[i].id === entryId) {
        return entries[i];
      }
    }
    return null;
  }

  function findAdvancedCatalogPreset(catalog, presetId) {
    var presets = catalog && Array.isArray(catalog.presets) ? catalog.presets : [];
    for (var i = 0; i < presets.length; i++) {
      if (presets[i] && presets[i].id === presetId) {
        return presets[i];
      }
    }
    return null;
  }

  function getDefaultAdvancedEntryId(catalog) {
    if (!catalog) return null;
    var selection = catalog.defaultSelection;
    if (selection && typeof selection.entryId === 'string' && selection.entryId) {
      return selection.entryId;
    }
    var entries = Array.isArray(catalog.entries) ? catalog.entries : [];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i] && entries[i]['default'] === true && entries[i].id) {
        return entries[i].id;
      }
    }
    return entries[0] && entries[0].id ? entries[0].id : null;
  }

  function resolveAdvancedChoiceEntryId(catalog, choiceId) {
    if (!catalog || !choiceId || choiceId === 'custom') return null;
    if (choiceId === 'default') {
      var selection = catalog.defaultSelection;
      if (selection && selection.entryMode === 'explicit' && selection.entryId) {
        return selection.entryId;
      }
      if (selection && selection.presetId) {
        var defaultPreset = findAdvancedCatalogPreset(catalog, selection.presetId);
        if (defaultPreset && defaultPreset.preferredEntryId) {
          return defaultPreset.preferredEntryId;
        }
      }
      return getDefaultAdvancedEntryId(catalog);
    }
    if (choiceId.indexOf('preset:') === 0) {
      var preset = findAdvancedCatalogPreset(catalog, choiceId.slice('preset:'.length));
      return preset && preset.preferredEntryId ? preset.preferredEntryId : getDefaultAdvancedEntryId(catalog);
    }
    if (choiceId.indexOf('entry:') === 0) {
      return choiceId.slice('entry:'.length) || null;
    }
    return null;
  }

  function getAdvancedCatalogChoices(catalog) {
    var normalized = normalizeAdvancedCatalog(catalog);
    if (!normalized) return [];
    var choices = [];
    var defaultSelection = normalized.defaultSelection;
    var defaultEntryId = resolveAdvancedChoiceEntryId(normalized, 'default');
    var defaultEntry = defaultEntryId ? findAdvancedCatalogEntry(normalized, defaultEntryId) : null;
    var defaultPreset = defaultSelection && defaultSelection.presetId
      ? findAdvancedCatalogPreset(normalized, defaultSelection.presetId)
      : null;
    if (defaultSelection) {
      choices.push({
        id: 'default',
        kind: 'default',
        label: defaultPreset
          ? ('Recommended · ' + (defaultPreset.label || defaultPreset.id))
          : ('Recommended · ' + ((defaultEntry && (defaultEntry.label || defaultEntry.id)) || 'Default')),
        description: defaultPreset
          ? 'Default preset'
          : ((defaultEntry && (defaultEntry.label || defaultEntry.id)) || 'Default entry'),
      });
    }

    var presets = Array.isArray(normalized.presets) ? normalized.presets : [];
    for (var i = 0; i < presets.length; i++) {
      var preset = presets[i];
      if (!preset || preset.availability === 'unavailable' || !preset.id) continue;
      choices.push({
        id: 'preset:' + preset.id,
        kind: 'preset',
        label: 'Preset · ' + (preset.label || preset.id),
        description: preset.description || preset.id,
      });
    }

    var entries = Array.isArray(normalized.entries) ? normalized.entries : [];
    for (var j = 0; j < entries.length; j++) {
      var entry = entries[j];
      if (!entry || !entry.id) continue;
      choices.push({
        id: 'entry:' + entry.id,
        kind: 'entry',
        label: 'Model · ' + (entry.label || entry.id),
        description: entry.id,
      });
    }

    choices.push({
      id: 'custom',
      kind: 'custom',
      label: 'Custom legacy model',
      description: 'Manual override',
    });
    return choices;
  }

  function getAdvancedCatalogDefaultChoice(catalog) {
    var choices = getAdvancedCatalogChoices(catalog);
    return choices.length > 0 ? choices[0].id : 'custom';
  }

  function resolveAdvancedCatalogChoice(catalog, choiceId) {
    var normalized = normalizeAdvancedCatalog(catalog);
    if (!normalized || !choiceId) return null;
    if (choiceId === 'custom') {
      return {
        kind: 'legacy',
        entryId: null,
        modelSelection: null,
      };
    }
    if (choiceId === 'default') {
      var defaultSelection = normalized.defaultSelection
        ? cloneJson(normalized.defaultSelection)
        : null;
      if (!defaultSelection) {
        var fallbackEntryId = getDefaultAdvancedEntryId(normalized);
        if (!fallbackEntryId) return null;
        defaultSelection = {
          entryMode: 'explicit',
          entryId: fallbackEntryId,
        };
      }
      return {
        kind: 'structured',
        entryId: resolveAdvancedChoiceEntryId(normalized, choiceId),
        modelSelection: defaultSelection,
      };
    }
    if (choiceId.indexOf('preset:') === 0) {
      var presetId = choiceId.slice('preset:'.length);
      return {
        kind: 'structured',
        entryId: resolveAdvancedChoiceEntryId(normalized, choiceId),
        modelSelection: {
          entryMode: 'auto',
          presetId: presetId,
        },
      };
    }
    if (choiceId.indexOf('entry:') === 0) {
      var entryId = choiceId.slice('entry:'.length);
      return {
        kind: 'structured',
        entryId: entryId || null,
        modelSelection: {
          entryMode: 'explicit',
          entryId: entryId,
        },
      };
    }
    return null;
  }

  function getAdvancedChoiceControlDefaults(catalog, choiceId) {
    var normalized = normalizeAdvancedCatalog(catalog);
    var resolved = resolveAdvancedCatalogChoice(normalized, choiceId);
    if (!normalized || !resolved || resolved.kind !== 'structured') {
      return {};
    }
    var defaults = {};
    var presetId = resolved.modelSelection && resolved.modelSelection.presetId;
    var preset = presetId ? findAdvancedCatalogPreset(normalized, presetId) : null;
    if (preset && preset.controlDefaults && typeof preset.controlDefaults === 'object') {
      for (var presetKey in preset.controlDefaults) {
        defaults[presetKey] = preset.controlDefaults[presetKey];
      }
    }
    var controls = resolved.modelSelection && resolved.modelSelection.controls;
    if (controls && typeof controls === 'object') {
      for (var controlKey in controls) {
        defaults[controlKey] = controls[controlKey];
      }
    }
    return defaults;
  }

  function listStoredAdvancedControls(catalog, choiceId) {
    var normalized = normalizeAdvancedCatalog(catalog);
    if (!normalized) return [];
    var entryId = resolveAdvancedChoiceEntryId(normalized, choiceId);
    var controls = Array.isArray(normalized.controls) ? normalized.controls : [];
    var visible = [];
    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      if (!control || control.scope === 'request') continue;
      if (
        entryId
        && Array.isArray(control.applicableEntryIds)
        && control.applicableEntryIds.length > 0
        && control.applicableEntryIds.indexOf(entryId) < 0
      ) {
        continue;
      }
      visible.push(control);
    }
    return visible;
  }

  function listAdvancedCatalogEntries(catalog) {
    var normalized = normalizeAdvancedCatalog(catalog);
    var entries = Array.isArray(normalized && normalized.entries) ? normalized.entries : [];
    var visible = [];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i] && entries[i].id) visible.push(entries[i]);
    }
    return visible;
  }

  function listAdvancedCatalogPresets(catalog) {
    var normalized = normalizeAdvancedCatalog(catalog);
    var presets = Array.isArray(normalized && normalized.presets) ? normalized.presets : [];
    var visible = [];
    for (var i = 0; i < presets.length; i++) {
      if (presets[i] && presets[i].id && presets[i].availability !== 'unavailable') {
        visible.push(presets[i]);
      }
    }
    return visible;
  }

  function advancedPresetAppliesToEntry(preset, entryId) {
    return !Array.isArray(preset && preset.applicableEntryIds)
      || preset.applicableEntryIds.length === 0
      || preset.applicableEntryIds.indexOf(entryId) >= 0;
  }

  function listApplicableAdvancedPresets(catalog, entryId) {
    var presets = listAdvancedCatalogPresets(catalog);
    if (!entryId) return [];
    var applicable = [];
    for (var i = 0; i < presets.length; i++) {
      if (advancedPresetAppliesToEntry(presets[i], entryId)) applicable.push(presets[i]);
    }
    return applicable;
  }

  function findApplicableAdvancedPreset(catalog, entryId, presetId) {
    var presets = listApplicableAdvancedPresets(catalog, entryId);
    for (var i = 0; i < presets.length; i++) {
      if (presets[i] && presets[i].id === presetId) return presets[i];
    }
    return null;
  }

  function advancedControlAppliesToEntry(control, entryId) {
    return !Array.isArray(control && control.applicableEntryIds)
      || control.applicableEntryIds.length === 0
      || control.applicableEntryIds.indexOf(entryId) >= 0;
  }

  function advancedControlValueAppliesToEntry(option, entryId) {
    return !Array.isArray(option && option.applicableEntryIds)
      || option.applicableEntryIds.length === 0
      || option.applicableEntryIds.indexOf(entryId) >= 0;
  }

  function normalizeEnumControlOption(option) {
    if (
      option
      && typeof option === 'object'
      && !Array.isArray(option)
      && Object.prototype.hasOwnProperty.call(option, 'value')
    ) {
      return option;
    }
    return {
      value: option,
      label: String(option),
    };
  }

  function enumControlValueKey(value) {
    return typeof value + ':' + String(value);
  }

  function listApplicableEnumControlOptions(control, entryId) {
    if (!control || control.kind !== 'enum') return [];
    var values = Array.isArray(control.values) ? control.values : [];
    var orderedKeys = [];
    var applicableOptionsByKey = {};
    for (var i = 0; i < values.length; i++) {
      var option = normalizeEnumControlOption(values[i]);
      var optionKey = enumControlValueKey(option.value);
      if (orderedKeys.indexOf(optionKey) < 0) {
        orderedKeys.push(optionKey);
      }
      if (!advancedControlValueAppliesToEntry(option, entryId)) {
        continue;
      }
      applicableOptionsByKey[optionKey] = option;
    }
    var merged = [];
    for (var j = 0; j < orderedKeys.length; j++) {
      var orderedKey = orderedKeys[j];
      if (Object.prototype.hasOwnProperty.call(applicableOptionsByKey, orderedKey)) {
        merged.push(applicableOptionsByKey[orderedKey]);
      }
    }
    return merged;
  }

  function findExplicitDefaultEnumOption(control, entryId) {
    var options = listApplicableEnumControlOptions(control, entryId);
    for (var i = 0; i < options.length; i++) {
      var option = options[i];
      if (
        option
        && typeof option.label === 'string'
        && /\(default\)/iu.test(option.label)
      ) {
        return option;
      }
    }
    return null;
  }

  function getAdvancedCatalogDefaultSelection(catalog) {
    return resolveAdvancedCatalogChoice(catalog, 'default');
  }

  function getAdvancedCatalogDefaultEntryId(catalog) {
    var entries = listAdvancedCatalogEntries(catalog);
    var resolved = getAdvancedCatalogDefaultSelection(catalog);
    if (resolved && resolved.entryId) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].id === resolved.entryId) return resolved.entryId;
      }
    }
    for (var j = 0; j < entries.length; j++) {
      if (entries[j] && entries[j]['default'] === true && entries[j].id) return entries[j].id;
    }
    return entries[0] && entries[0].id ? entries[0].id : '';
  }

  function getAdvancedCatalogDefaultPresetId(catalog, entryId) {
    if (!entryId) return '';
    var presets = listApplicableAdvancedPresets(catalog, entryId);
    if (!presets.length) return '';
    var resolved = getAdvancedCatalogDefaultSelection(catalog);
    var normalized = normalizeAdvancedCatalog(catalog);
    var defaultPresetId = resolved && resolved.modelSelection && resolved.modelSelection.presetId
      ? resolved.modelSelection.presetId
      : (normalized && normalized.defaultSelection && normalized.defaultSelection.presetId
        ? normalized.defaultSelection.presetId
        : '');
    if (!defaultPresetId) return '';
    if (entryId !== getAdvancedCatalogDefaultEntryId(catalog)) return '';
    for (var i = 0; i < presets.length; i++) {
      if (presets[i] && presets[i].id === defaultPresetId) return defaultPresetId;
    }
    return '';
  }

  function listConfiguredRuntimeProviders(providerCatalog, allowedProviders) {
    var providers = providerCatalog && providerCatalog.providers && typeof providerCatalog.providers === 'object'
      ? providerCatalog.providers
      : null;
    if (!providers) return [];

    var configured = [];
    var seen = {};
    var preferredOrder = Array.isArray(allowedProviders) ? allowedProviders : [];
    for (var i = 0; i < preferredOrder.length; i++) {
      var providerId = preferredOrder[i];
      if (!providerId || seen[providerId]) continue;
      var providerMeta = providers[providerId];
      var instances = Array.isArray(providerMeta && providerMeta.instances) ? providerMeta.instances : [];
      if (!instances.length) continue;
      seen[providerId] = true;
      configured.push(providerId);
    }

    var providerNames = Object.keys(providers);
    for (var j = 0; j < providerNames.length; j++) {
      var extraProviderId = providerNames[j];
      if (!extraProviderId || seen[extraProviderId]) continue;
      if (preferredOrder.length && preferredOrder.indexOf(extraProviderId) < 0) continue;
      var extraMeta = providers[extraProviderId];
      var extraInstances = Array.isArray(extraMeta && extraMeta.instances) ? extraMeta.instances : [];
      if (!extraInstances.length) continue;
      seen[extraProviderId] = true;
      configured.push(extraProviderId);
    }

    return configured;
  }

  function normalizeRuntimeProviderAvailability(payload, allowedProviders) {
    var availability = {};
    var allowed = Array.isArray(allowedProviders) ? allowedProviders : null;
    var providers = Array.isArray(payload && payload.providers) ? payload.providers : [];
    for (var i = 0; i < providers.length; i++) {
      var entry = providers[i];
      var providerId = entry && typeof entry.provider === 'string' ? entry.provider : '';
      if (!providerId) continue;
      if (allowed && allowed.indexOf(providerId) < 0) continue;
      var status = entry && entry.availability && typeof entry.availability.status === 'string'
        ? entry.availability.status.trim().toLowerCase()
        : '';
      if (!status) continue;
      availability[providerId] = status;
    }
    return availability;
  }

  async function readRuntimeProviderCatalogState(options) {
    options = options && typeof options === 'object' ? options : {};
    var apiBase = typeof options.apiBase === 'string' ? options.apiBase : '';
    var allowedProviders = Array.isArray(options.allowedProviders) ? options.allowedProviders : null;
    var requestHeaders = options.headers && typeof options.headers === 'object' ? options.headers : undefined;
    var requestInit = requestHeaders ? { headers: requestHeaders } : undefined;
    var diagnosticsTask = apiFetch(apiBase + '/diagnostics/providers?defaultOnly=true', requestInit)
      .then(async function(response) {
        if (!response.ok) {
          return null;
        }
        return response.json();
      })
      .catch(function() {
        return null;
      });
    var providerCatalogResponse = await apiFetch(apiBase + '/providers/config', requestInit);
    if (!providerCatalogResponse.ok) {
      return null;
    }

    var providerCatalog = await providerCatalogResponse.json();
    var diagnostics = await diagnosticsTask;
    return {
      providerCatalog: providerCatalog,
      configuredProviders: listConfiguredRuntimeProviders(providerCatalog, allowedProviders),
      providerAvailability: normalizeRuntimeProviderAvailability(diagnostics, allowedProviders),
    };
  }

  function listSelectablePlaygroundProviders(selectableProviders, providerOrder, providerAvailability) {
    var available = Array.isArray(selectableProviders) ? selectableProviders : [];
    var preferredOrder = Array.isArray(providerOrder) ? providerOrder : [];
    var seen = {};
    var ordered = [];
    for (var i = 0; i < preferredOrder.length; i++) {
      var providerId = preferredOrder[i];
      if (!providerId || seen[providerId] || available.indexOf(providerId) < 0) continue;
      seen[providerId] = true;
      ordered.push(providerId);
    }
    for (var j = 0; j < available.length; j++) {
      var extraProviderId = available[j];
      if (!extraProviderId || seen[extraProviderId]) continue;
      seen[extraProviderId] = true;
      ordered.push(extraProviderId);
    }
    ordered.sort(function(left, right) {
      var leftRank = getPlaygroundProviderAvailabilityRank(
        getPlaygroundProviderAvailabilityStatus(providerAvailability, left),
      );
      var rightRank = getPlaygroundProviderAvailabilityRank(
        getPlaygroundProviderAvailabilityStatus(providerAvailability, right),
      );
      return leftRank - rightRank;
    });
    return ordered;
  }

  function getPlaygroundProviderAvailabilityStatus(providerAvailability, providerId) {
    if (
      !providerId
      || !providerAvailability
      || typeof providerAvailability !== 'object'
      || Array.isArray(providerAvailability)
    ) {
      return 'unknown';
    }
    var rawStatus = providerAvailability[providerId];
    return typeof rawStatus === 'string' && rawStatus.trim()
      ? rawStatus.trim().toLowerCase()
      : 'unknown';
  }

  function getPlaygroundProviderAvailabilityRank(status) {
    switch (status) {
      case 'ok':
        return 0;
      case 'degraded':
        return 1;
      case 'unknown':
        return 2;
      default:
        return 3;
    }
  }

  function normalizePlaygroundCatalogText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function tokenizePlaygroundCatalogText(value) {
    var normalized = normalizePlaygroundCatalogText(value);
    if (!normalized) return [];
    var parts = normalized.split(/\s+/);
    var seen = {};
    var tokens = [];
    for (var i = 0; i < parts.length; i++) {
      var token = parts[i];
      if (!token || seen[token]) continue;
      seen[token] = true;
      tokens.push(token);
    }
    return tokens;
  }

  function getAdvancedEntryAvailabilityRank(entry) {
    var status = typeof (entry && entry.status) === 'string'
      ? entry.status.toLowerCase()
      : 'available';
    switch (status) {
      case 'running':
      case 'available':
      case 'supported':
      case 'ready':
        return 0;
      case 'unknown':
        return 1;
      case 'degraded':
      case 'limited':
        return 2;
      default:
        return 3;
    }
  }

  function collectPlaygroundSelectionReferenceTexts(catalog, model, incomingSelection) {
    var refs = [];
    function pushRef(value) {
      if (typeof value !== 'string' || !value.trim()) return;
      refs.push(value.trim());
    }
    pushRef(model);
    if (incomingSelection && typeof incomingSelection === 'object') {
      pushRef(incomingSelection.entryId);
      if (typeof incomingSelection.presetId === 'string' && incomingSelection.presetId) {
        pushRef(incomingSelection.presetId);
        var preset = findAdvancedCatalogPreset(catalog, incomingSelection.presetId);
        if (preset) {
          pushRef(preset.label);
          pushRef(preset.preferredEntryId);
          var preferredEntry = preset.preferredEntryId
            ? findAdvancedCatalogEntry(catalog, preset.preferredEntryId)
            : null;
          if (preferredEntry) {
            pushRef(preferredEntry.label);
          }
        }
      }
    }
    return refs;
  }

  function scorePlaygroundAdvancedEntry(entry, referenceTexts) {
    if (!entry || !entry.id) return Number.NEGATIVE_INFINITY;
    var candidateTexts = [entry.id, entry.label];
    if (Array.isArray(entry.notes)) {
      for (var noteIndex = 0; noteIndex < entry.notes.length; noteIndex++) {
        candidateTexts.push(entry.notes[noteIndex]);
      }
    }
    var candidateTokens = tokenizePlaygroundCatalogText(candidateTexts.join(' '));
    var candidateNormalized = candidateTexts
      .map(normalizePlaygroundCatalogText)
      .filter(Boolean);
    var score = entry['default'] === true ? 5 : 0;
    score += Math.max(0, 3 - getAdvancedEntryAvailabilityRank(entry));

    for (var i = 0; i < referenceTexts.length; i++) {
      var reference = referenceTexts[i];
      var normalizedReference = normalizePlaygroundCatalogText(reference);
      var referenceTokens = tokenizePlaygroundCatalogText(reference);
      if (!normalizedReference || !referenceTokens.length) continue;
      if (candidateNormalized.indexOf(normalizedReference) >= 0) {
        score += 240;
        continue;
      }
      var overlap = 0;
      for (var tokenIndex = 0; tokenIndex < referenceTokens.length; tokenIndex++) {
        if (candidateTokens.indexOf(referenceTokens[tokenIndex]) >= 0) {
          overlap += 1;
        }
      }
      if (overlap === 0) continue;
      if (overlap === referenceTokens.length) {
        score += 90;
      }
      score += overlap * 18;
    }

    return score;
  }

  function findClosestPlaygroundAdvancedEntry(catalog, model, incomingSelection) {
    var entries = listAdvancedCatalogEntries(catalog);
    if (!entries.length) return '';
    var references = collectPlaygroundSelectionReferenceTexts(catalog, model, incomingSelection);
    if (!references.length) return '';
    var bestEntryId = '';
    var bestScore = Number.NEGATIVE_INFINITY;
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var score = scorePlaygroundAdvancedEntry(entry, references);
      if (score > bestScore) {
        bestScore = score;
        bestEntryId = entry.id;
      }
    }
    return bestScore > 0 ? bestEntryId : '';
  }

  function listApplicableEnumControlValues(control, entryId) {
    var options = listApplicableEnumControlOptions(control, entryId);
    var allowed = [];
    for (var i = 0; i < options.length; i++) {
      var value = options[i] && options[i].value;
      if (typeof value === 'string' && allowed.indexOf(value) < 0) {
        allowed.push(value);
      }
    }
    return allowed;
  }

  function normalizePlaygroundNumericControlValue(control, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    var normalized = value;
    if (control.minimum !== undefined && normalized < control.minimum) {
      normalized = control.minimum;
    }
    if (control.maximum !== undefined && normalized > control.maximum) {
      normalized = control.maximum;
    }
    return normalized;
  }

  function chooseSemanticEnumFallback(control, allowedValues, requestedValue) {
    if (
      !control
      || !Array.isArray(control.semanticTags)
      || control.semanticTags.indexOf('reasoning_intensity') < 0
      || typeof requestedValue !== 'string'
    ) {
      return undefined;
    }
    var reasoningOrder = ['low', 'medium', 'high', 'max'];
    var requestedIndex = reasoningOrder.indexOf(requestedValue);
    if (requestedIndex < 0) return undefined;
    for (var cursor = requestedIndex - 1; cursor >= 0; cursor--) {
      if (allowedValues.indexOf(reasoningOrder[cursor]) >= 0) {
        return reasoningOrder[cursor];
      }
    }
    for (var forward = requestedIndex + 1; forward < reasoningOrder.length; forward++) {
      if (allowedValues.indexOf(reasoningOrder[forward]) >= 0) {
        return reasoningOrder[forward];
      }
    }
    return undefined;
  }

  function normalizePlaygroundControlValue(control, requestedValue, entryId, defaultValue) {
    if (!control) return undefined;
    if (!advancedControlAppliesToEntry(control, entryId)) {
      return undefined;
    }
    if (control.kind === 'boolean') {
      if (typeof requestedValue === 'boolean') return requestedValue;
      return typeof defaultValue === 'boolean' ? defaultValue : undefined;
    }
    if (control.kind === 'string') {
      if (typeof requestedValue === 'string' && requestedValue.trim()) return requestedValue;
      return typeof defaultValue === 'string' && defaultValue.trim() ? defaultValue : undefined;
    }
    if (control.kind === 'number') {
      var requestedNumber = normalizePlaygroundNumericControlValue(control, requestedValue);
      if (requestedNumber !== undefined) return requestedNumber;
      return normalizePlaygroundNumericControlValue(control, defaultValue);
    }
    if (control.kind === 'enum') {
      var allowedValues = listApplicableEnumControlValues(control, entryId);
      if (typeof requestedValue === 'string' && allowedValues.indexOf(requestedValue) >= 0) {
        return requestedValue;
      }
      if (typeof defaultValue === 'string' && allowedValues.indexOf(defaultValue) >= 0) {
        return defaultValue;
      }
      var semanticFallback = chooseSemanticEnumFallback(control, allowedValues, requestedValue);
      if (semanticFallback) {
        return semanticFallback;
      }
      return allowedValues[0];
    }
    return undefined;
  }

  function normalizePlaygroundSelectionControls(catalog, entryId, presetId, controls) {
    if (!controls || typeof controls !== 'object' || Array.isArray(controls)) {
      return undefined;
    }
    var normalized = normalizeAdvancedCatalog(catalog);
    if (!normalized || !entryId) return undefined;
    var defaults = getAdvancedEntryControlDefaults(normalized, entryId, presetId || '');
    var catalogControls = Array.isArray(normalized.controls) ? normalized.controls : [];
    var nextControls = {};
    for (var i = 0; i < catalogControls.length; i++) {
      var control = catalogControls[i];
      if (!control || !control.key || !Object.prototype.hasOwnProperty.call(controls, control.key)) {
        continue;
      }
      var nextValue = normalizePlaygroundControlValue(
        control,
        controls[control.key],
        entryId,
        defaults[control.key],
      );
      if (nextValue !== undefined) {
        nextControls[control.key] = nextValue;
      }
    }
    return Object.keys(nextControls).length > 0 ? nextControls : undefined;
  }

  function normalizePlaygroundAgentSelection(input) {
    var options = input && typeof input === 'object' ? input : {};
    var requestedProvider = typeof options.provider === 'string' ? options.provider : '';
    var selectableProviders = listSelectablePlaygroundProviders(
      options.selectableProviders,
      options.providerOrder,
      options.providerAvailability,
    );
    var requestedProviderSelectable = selectableProviders.indexOf(requestedProvider) >= 0;
    var requestedProviderStatus = getPlaygroundProviderAvailabilityStatus(
      options.providerAvailability,
      requestedProvider,
    );
    var preserveRequestedProvider = options.preserveRequestedProvider === true;
    var preferAvailableProvider = options.preferAvailableProvider === true;
    var provider = requestedProviderSelectable
      ? requestedProvider
      : (selectableProviders[0] || requestedProvider || '');
    if (
      requestedProviderSelectable
      && preferAvailableProvider
      && !preserveRequestedProvider
      && requestedProviderStatus === 'unavailable'
    ) {
      provider = selectableProviders[0] || requestedProvider || '';
    }
    var providerChanged = provider !== requestedProvider;
    var advancedCatalogs = options.advancedCatalogs && typeof options.advancedCatalogs === 'object'
      ? options.advancedCatalogs
      : {};
    var catalog = normalizeAdvancedCatalog(advancedCatalogs[provider]);
    var model = providerChanged
      ? ''
      : (typeof options.model === 'string' ? options.model : '');
    var incomingSelection = providerChanged
      ? null
      : (options.modelSelection && typeof options.modelSelection === 'object'
        ? cloneJson(options.modelSelection)
        : null);
    if (!catalog) {
      return {
        provider: provider,
        model: model,
        modelSelection: incomingSelection,
      };
    }

    var entries = listAdvancedCatalogEntries(catalog);
    var entryIds = [];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i] && entries[i].id) entryIds.push(entries[i].id);
    }
    var entryId = '';
    var presetId = '';
    if (incomingSelection) {
      if (
        incomingSelection.entryMode === 'explicit'
        && typeof incomingSelection.entryId === 'string'
        && entryIds.indexOf(incomingSelection.entryId) >= 0
      ) {
        entryId = incomingSelection.entryId;
        presetId = typeof incomingSelection.presetId === 'string' ? incomingSelection.presetId : '';
      } else if (typeof incomingSelection.presetId === 'string' && incomingSelection.presetId) {
        var resolvedPreset = resolveAdvancedCatalogChoice(catalog, 'preset:' + incomingSelection.presetId);
        if (resolvedPreset && resolvedPreset.entryId && entryIds.indexOf(resolvedPreset.entryId) >= 0) {
          entryId = resolvedPreset.entryId;
          presetId = incomingSelection.presetId;
        }
      }
    }
    if (!entryId && model && entryIds.indexOf(model) >= 0) {
      entryId = model;
    }
    if (!entryId) {
      entryId = findClosestPlaygroundAdvancedEntry(catalog, model, incomingSelection);
    }

    var allowLegacyModel = options.allowLegacyModel === true;
    if (!entryId) {
      if (allowLegacyModel && model) {
        return {
          provider: provider,
          model: model,
          modelSelection: null,
        };
      }
      entryId = getAdvancedCatalogDefaultEntryId(catalog);
    }

    if (!entryId) {
      return {
        provider: provider,
        model: allowLegacyModel ? model : '',
        modelSelection: null,
      };
    }

    var applicablePreset = presetId
      ? findApplicableAdvancedPreset(catalog, entryId, presetId)
      : null;
    if (!applicablePreset) {
      presetId = getAdvancedCatalogDefaultPresetId(catalog, entryId) || '';
    }

    var nextSelection = {
      entryMode: 'explicit',
      entryId: entryId,
    };
    if (presetId) {
      nextSelection.presetId = presetId;
    }
    var normalizedControls = normalizePlaygroundSelectionControls(
      catalog,
      entryId,
      presetId,
      incomingSelection && incomingSelection.controls,
    );
    if (normalizedControls) {
      nextSelection.controls = normalizedControls;
    }

    return {
      provider: provider,
      model: '',
      modelSelection: nextSelection,
    };
  }

  function getAdvancedEntryControlDefaults(catalog, entryId, presetId) {
    var normalized = normalizeAdvancedCatalog(catalog);
    if (!normalized || !entryId) return {};
    var defaults = {};
    var preset = presetId ? findApplicableAdvancedPreset(normalized, entryId, presetId) : null;
    if (preset && preset.controlDefaults && typeof preset.controlDefaults === 'object') {
      for (var presetKey in preset.controlDefaults) {
        defaults[presetKey] = preset.controlDefaults[presetKey];
      }
    }
    var resolved = getAdvancedCatalogDefaultSelection(normalized);
    if (
      resolved
      && resolved.entryId === entryId
      && ((resolved.modelSelection && resolved.modelSelection.presetId) || '') === (presetId || '')
      && resolved.modelSelection
      && resolved.modelSelection.controls
      && typeof resolved.modelSelection.controls === 'object'
    ) {
      for (var controlKey in resolved.modelSelection.controls) {
        defaults[controlKey] = resolved.modelSelection.controls[controlKey];
      }
    }
    var filtered = {};
    var controls = Array.isArray(normalized.controls) ? normalized.controls : [];
    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      if (!control || !control.key || control.scope === 'request' || !advancedControlAppliesToEntry(control, entryId)) {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(defaults, control.key)) {
        filtered[control.key] = defaults[control.key];
        continue;
      }
      var explicitDefault = findExplicitDefaultEnumOption(control, entryId);
      if (explicitDefault) {
        filtered[control.key] = explicitDefault.value;
      }
    }
    return filtered;
  }

  function closeRuntimeSurfaceMenus() {
    var roots = document.querySelectorAll('[data-runtime-surface-switcher]');
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      root.setAttribute('data-open', 'false');
      var trigger = root.querySelector('[data-runtime-surface-trigger]');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      var menu = root.querySelector('[data-runtime-surface-menu]');
      if (menu) {
        menu.classList.add('hidden');
        menu.style.position = '';
        menu.style.left = '';
        menu.style.top = '';
      }
    }
  }

  function positionRuntimeSurfaceMenu(root) {
    if (!(root instanceof Element)) return;
    var trigger = root.querySelector('[data-runtime-surface-trigger]');
    var menu = root.querySelector('[data-runtime-surface-menu]');
    if (!(trigger instanceof Element) || !(menu instanceof HTMLElement)) return;
    menu.style.position = 'fixed';
    var triggerRect = trigger.getBoundingClientRect();
    var menuRect = menu.getBoundingClientRect();
    var gap = 12;
    var left = triggerRect.left;
    var maxLeft = window.innerWidth - menuRect.width - 12;
    left = Math.min(Math.max(12, left), Math.max(12, maxLeft));
    var top = triggerRect.bottom + gap;
    var maxTop = window.innerHeight - menuRect.height - 12;
    if (top > maxTop) {
      top = Math.max(12, triggerRect.top - menuRect.height - gap);
    }
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  var runtimeTooltip = null;
  var runtimeTooltipTarget = null;

  function ensureRuntimeTooltip() {
    if (runtimeTooltip) return runtimeTooltip;
    var el = document.createElement('div');
    el.className = 'runtime-tooltip hidden';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
    runtimeTooltip = el;
    return el;
  }

  function getRuntimeTooltipContent(target) {
    if (!(target instanceof Element)) return '';
    return (target.getAttribute('data-runtime-tooltip') || '').trim();
  }

  function setRuntimeTooltip(target, text) {
    if (!(target instanceof Element)) return;
    var value = String(text || '').trim();
    if (value) {
      target.setAttribute('data-runtime-tooltip', value);
    } else {
      target.removeAttribute('data-runtime-tooltip');
    }
    target.removeAttribute('title');
    if (runtimeTooltipTarget === target) {
      if (value) {
        showRuntimeTooltip(target);
      } else {
        hideRuntimeTooltip();
      }
    }
  }

  function findRuntimeTooltipTarget(node) {
    if (!node) return null;
    var element = node instanceof Element
      ? node
      : (node.parentElement || null);
    if (!(element instanceof Element)) return null;
    return element.closest('[data-runtime-tooltip]');
  }

  function positionRuntimeTooltip(target) {
    if (!runtimeTooltip || !target) return;
    var rect = target.getBoundingClientRect();
    var tooltipRect = runtimeTooltip.getBoundingClientRect();
    var gap = 10;
    var top = rect.top - tooltipRect.height - gap;
    if (top < 12) {
      top = rect.bottom + gap;
    }
    var left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    var maxLeft = window.innerWidth - tooltipRect.width - 12;
    left = Math.min(Math.max(12, left), Math.max(12, maxLeft));
    var maxTop = window.innerHeight - tooltipRect.height - 12;
    top = Math.min(Math.max(12, top), Math.max(12, maxTop));
    runtimeTooltip.style.left = left + 'px';
    runtimeTooltip.style.top = top + 'px';
  }

  function showRuntimeTooltip(target) {
    var content = getRuntimeTooltipContent(target);
    if (!content) {
      hideRuntimeTooltip();
      return;
    }
    var tooltip = ensureRuntimeTooltip();
    runtimeTooltipTarget = target;
    tooltip.textContent = content;
    tooltip.classList.remove('hidden');
    positionRuntimeTooltip(target);
  }

  function hideRuntimeTooltip() {
    if (runtimeTooltip) {
      runtimeTooltip.classList.add('hidden');
    }
    runtimeTooltipTarget = null;
  }

  function initRuntimeTooltips() {
    if (document.documentElement.getAttribute('data-runtime-tooltips-ready') === 'true') {
      return;
    }
    document.documentElement.setAttribute('data-runtime-tooltips-ready', 'true');

    document.addEventListener('mouseover', function(event) {
      var target = findRuntimeTooltipTarget(event.target);
      if (!target) {
        hideRuntimeTooltip();
        return;
      }
      if (runtimeTooltipTarget !== target) {
        showRuntimeTooltip(target);
      }
    });

    document.addEventListener('mouseout', function(event) {
      if (!runtimeTooltipTarget) return;
      var related = event.relatedTarget;
      if (related instanceof Node && runtimeTooltipTarget.contains(related)) {
        return;
      }
      var nextTarget = findRuntimeTooltipTarget(related);
      if (nextTarget === runtimeTooltipTarget) {
        return;
      }
      hideRuntimeTooltip();
    });

    document.addEventListener('focusin', function(event) {
      var target = findRuntimeTooltipTarget(event.target);
      if (target) {
        showRuntimeTooltip(target);
      }
    });

    document.addEventListener('focusout', function(event) {
      if (!runtimeTooltipTarget) return;
      var related = event.relatedTarget;
      if (related instanceof Node && runtimeTooltipTarget.contains(related)) {
        return;
      }
      hideRuntimeTooltip();
    });

    window.addEventListener('scroll', function() {
      if (runtimeTooltipTarget) {
        positionRuntimeTooltip(runtimeTooltipTarget);
      }
    }, true);

    window.addEventListener('resize', function() {
      if (runtimeTooltipTarget) {
        positionRuntimeTooltip(runtimeTooltipTarget);
      }
    });
  }

  function initRuntimeSurfaceSwitchers() {
    var roots = document.querySelectorAll('[data-runtime-surface-switcher]');
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      if (root.getAttribute('data-bound') === 'true') continue;
      root.setAttribute('data-bound', 'true');
      var sidebar = root.closest('.runtime-sidebar');
      if (sidebar instanceof HTMLElement) {
        sidebar.style.overflow = 'visible';
      }
      var trigger = root.querySelector('[data-runtime-surface-trigger]');
      var menu = root.querySelector('[data-runtime-surface-menu]');
      if (!trigger || !menu) continue;

      trigger.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        var currentRoot = this.closest('[data-runtime-surface-switcher]');
        if (!currentRoot) return;
        var currentMenu = currentRoot.querySelector('[data-runtime-surface-menu]');
        var isOpen = currentRoot.getAttribute('data-open') === 'true';
        closeRuntimeSurfaceMenus();
        if (!isOpen) {
          currentRoot.setAttribute('data-open', 'true');
          this.setAttribute('aria-expanded', 'true');
          if (currentMenu) {
            currentMenu.classList.remove('hidden');
            positionRuntimeSurfaceMenu(currentRoot);
          }
        }
      });

      var links = root.querySelectorAll('[data-runtime-surface-menu] a');
      for (var j = 0; j < links.length; j++) {
        links[j].addEventListener('click', function() {
          closeRuntimeSurfaceMenus();
        });
      }
    }

    if (document.documentElement.getAttribute('data-runtime-surface-switchers-ready') === 'true') {
      return;
    }
    document.documentElement.setAttribute('data-runtime-surface-switchers-ready', 'true');
    document.addEventListener('click', function(event) {
      var target = event.target;
      if (!(target instanceof Node)) {
        closeRuntimeSurfaceMenus();
        return;
      }
      var roots = document.querySelectorAll('[data-runtime-surface-switcher]');
      for (var i = 0; i < roots.length; i++) {
        if (roots[i].contains(target)) {
          return;
        }
      }
      closeRuntimeSurfaceMenus();
    });
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        closeRuntimeSurfaceMenus();
      }
    });
    window.addEventListener('resize', function() {
      var roots = document.querySelectorAll('[data-runtime-surface-switcher][data-open="true"]');
      for (var i = 0; i < roots.length; i++) {
        positionRuntimeSurfaceMenu(roots[i]);
      }
    });
    window.addEventListener('scroll', function() {
      var roots = document.querySelectorAll('[data-runtime-surface-switcher][data-open="true"]');
      for (var i = 0; i < roots.length; i++) {
        positionRuntimeSurfaceMenu(roots[i]);
      }
    }, true);
  }

  window.CatsUI = {
    getApiKey: getApiKey,
    authHeaders: authHeaders,
    apiFetch: apiFetch,
    renderProviderBadge: renderProviderBadge,
    renderStatusBadge: renderStatusBadge,
    normalizeAdvancedCatalog: normalizeAdvancedCatalog,
    getAdvancedCatalogChoices: getAdvancedCatalogChoices,
    getAdvancedCatalogDefaultChoice: getAdvancedCatalogDefaultChoice,
    listAdvancedCatalogEntries: listAdvancedCatalogEntries,
    listAdvancedCatalogPresets: listAdvancedCatalogPresets,
    listApplicableAdvancedPresets: listApplicableAdvancedPresets,
    findApplicableAdvancedPreset: findApplicableAdvancedPreset,
    getAdvancedCatalogDefaultSelection: getAdvancedCatalogDefaultSelection,
    getAdvancedCatalogDefaultEntryId: getAdvancedCatalogDefaultEntryId,
    getAdvancedCatalogDefaultPresetId: getAdvancedCatalogDefaultPresetId,
    listConfiguredRuntimeProviders: listConfiguredRuntimeProviders,
    readRuntimeProviderCatalogState: readRuntimeProviderCatalogState,
    listSelectablePlaygroundProviders: listSelectablePlaygroundProviders,
    normalizePlaygroundAgentSelection: normalizePlaygroundAgentSelection,
    resolveAdvancedCatalogChoice: resolveAdvancedCatalogChoice,
    getAdvancedChoiceControlDefaults: getAdvancedChoiceControlDefaults,
    getAdvancedEntryControlDefaults: getAdvancedEntryControlDefaults,
    listApplicableEnumControlOptions: listApplicableEnumControlOptions,
    listStoredAdvancedControls: listStoredAdvancedControls,
    setRuntimeTooltip: setRuntimeTooltip,
    hideRuntimeTooltip: hideRuntimeTooltip,
    initRuntimeTooltips: initRuntimeTooltips,
    initRuntimeSurfaceSwitchers: initRuntimeSurfaceSwitchers,
    syncRuntimeBootstrapState: syncRuntimeBootstrapState,
    syncRuntimeSurfaceSwitcher: syncRuntimeSurfaceSwitcher,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      initRuntimeTooltips();
      initRuntimeSurfaceSwitchers();
    }, { once: true });
  } else {
    queueMicrotask(function() {
      initRuntimeTooltips();
      initRuntimeSurfaceSwitchers();
    });
  }
})();
`.trim();
