export type RuntimeSurface = 'dashboard' | 'playground' | 'setup';

export interface RuntimeSurfaceDescriptor {
  id: RuntimeSurface;
  label: string;
  subtitle: string;
  href: string;
  swatchStyle: string;
}

interface RuntimeShellStateInput {
  surface: RuntimeSurface;
  bootstrapRequired: boolean;
}

export const RUNTIME_SURFACE_DESCRIPTORS: readonly RuntimeSurfaceDescriptor[] = [
  {
    id: 'setup',
    label: 'Setup',
    subtitle: 'Provider bootstrap, repair, and readiness follow-through',
    href: '/setup',
    swatchStyle: 'background:#facc15;box-shadow:0 0 0 4px rgba(250,204,21,0.12);',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    subtitle: 'Sessions, provider health, and runtime diagnostics',
    href: '/dashboard',
    swatchStyle: 'background:#4ade80;box-shadow:0 0 0 4px rgba(74,222,128,0.12);',
  },
  {
    id: 'playground',
    label: 'Playground',
    subtitle: 'Multi-agent group chat and orchestration demo surface',
    href: '/playground',
    swatchStyle: 'background:#60a5fa;box-shadow:0 0 0 4px rgba(96,165,250,0.12);',
  },
] as const;

export function injectRuntimeShellState(
  html: string,
  input: RuntimeShellStateInput,
): string {
  return html
    .replace(/__CATS_RUNTIME_SURFACE__/g, input.surface)
    .replace(/__CATS_RUNTIME_BOOTSTRAP_REQUIRED__/g, input.bootstrapRequired ? 'true' : 'false')
    .replace('<!-- CATS_RUNTIME_SURFACE_SWITCHER -->', renderRuntimeSurfaceSwitcher(input));
}

function renderRuntimeSurfaceSwitcher(input: RuntimeShellStateInput): string {
  const active = RUNTIME_SURFACE_DESCRIPTORS.find((surface) => surface.id === input.surface)
    ?? RUNTIME_SURFACE_DESCRIPTORS[0];
  const menuItems = RUNTIME_SURFACE_DESCRIPTORS.map((surface) => renderSurfaceItem(surface, input)).join('');

  return `
    <div class="runtime-surface-switcher" data-runtime-surface-switcher data-active-surface="${escapeAttr(active.id)}" data-bootstrap-required="${input.bootstrapRequired ? 'true' : 'false'}" data-open="false">
      <button type="button" class="runtime-surface-trigger" data-runtime-surface-trigger aria-haspopup="menu" aria-expanded="false" aria-label="Switch runtime surface">
        <span class="runtime-surface-trigger-copy">
          <span class="runtime-surface-trigger-label">${escapeHtml(active.label)}</span>
        </span>
        <svg class="runtime-surface-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 6.25 8 10l4-3.75" />
        </svg>
      </button>
      <div class="runtime-surface-menu hidden" data-runtime-surface-menu role="menu" aria-label="Switch runtime surface" style="width:31.5rem;">
        <p class="runtime-surface-menu-heading" style="color:#C4653A;">CATS INC</p>
        <div class="runtime-surface-menu-list">
          ${menuItems}
        </div>
      </div>
    </div>
  `.trim();
}

function renderSurfaceItem(
  surface: RuntimeSurfaceDescriptor,
  input: RuntimeShellStateInput,
): string {
  const isCurrent = surface.id === input.surface;
  const isLocked = input.bootstrapRequired && surface.id !== 'setup';
  const classNames = [
    'runtime-surface-item',
    isCurrent ? 'is-current' : '',
    isLocked ? 'is-locked' : '',
  ].filter(Boolean).join(' ');
  const badge = isLocked
    ? '<span class="runtime-surface-item-badge">Locked</span>'
    : isCurrent
      ? '<span class="runtime-surface-item-badge">Current</span>'
      : '';
  const check = isCurrent
    ? `<span class="runtime-surface-item-check" style="background:rgba(196,101,58,0.12);color:#C4653A;" aria-hidden="true">
         <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
           <path d="m2.4 6.3 2.1 2.1 5.1-5.1" />
         </svg>
       </span>`
    : '';
  const content = `
    <span class="runtime-surface-swatch" style="${escapeAttr(surface.swatchStyle)}" aria-hidden="true"></span>
    <span class="runtime-surface-item-copy">
      <span class="runtime-surface-item-title-row">
        <span class="runtime-surface-item-title">${escapeHtml(surface.label)}</span>
        ${badge}
      </span>
      <span class="runtime-surface-item-subtitle" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(surface.subtitle)}</span>
    </span>
    ${check}
  `.trim();

  if (isLocked || isCurrent) {
    return `
      <button type="button" class="${classNames}" disabled aria-disabled="true" role="menuitemradio" aria-checked="${isCurrent ? 'true' : 'false'}">
        ${content}
      </button>
    `.trim();
  }

  return `
    <a href="${escapeAttr(surface.href)}" class="${classNames}" role="menuitemradio" aria-checked="false">
      ${content}
    </a>
  `.trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
