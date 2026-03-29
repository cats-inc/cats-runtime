export type RuntimeSurface = 'dashboard' | 'playground' | 'setup';

interface RuntimeSurfaceDescriptor {
  id: RuntimeSurface;
  label: string;
  subtitle: string;
  href: string;
  swatchClass: string;
}

interface RuntimeShellStateInput {
  surface: RuntimeSurface;
  bootstrapRequired: boolean;
}

const SURFACES: readonly RuntimeSurfaceDescriptor[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    subtitle: 'Sessions, provider health, and runtime diagnostics',
    href: '/dashboard',
    swatchClass: 'runtime-surface-swatch-dashboard',
  },
  {
    id: 'playground',
    label: 'Playground',
    subtitle: 'Multi-agent group chat and orchestration demo surface',
    href: '/playground',
    swatchClass: 'runtime-surface-swatch-playground',
  },
  {
    id: 'setup',
    label: 'Setup',
    subtitle: 'Provider bootstrap, repair, and readiness follow-through',
    href: '/setup',
    swatchClass: 'runtime-surface-swatch-setup',
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
  const active = SURFACES.find((surface) => surface.id === input.surface) ?? SURFACES[0];
  const menuItems = SURFACES.map((surface) => renderSurfaceItem(surface, input)).join('');

  return `
    <div class="runtime-surface-switcher" data-runtime-surface-switcher data-active-surface="${escapeAttr(active.id)}" data-bootstrap-required="${input.bootstrapRequired ? 'true' : 'false'}" data-open="false">
      <button type="button" class="runtime-surface-trigger" data-runtime-surface-trigger aria-haspopup="menu" aria-expanded="false">
        <span class="runtime-surface-trigger-copy">
          <span class="runtime-surface-trigger-eyebrow">Cats Runtime</span>
          <span class="runtime-surface-trigger-label">${escapeHtml(active.label)}</span>
        </span>
        <svg class="runtime-surface-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 6.25 8 10l4-3.75" />
        </svg>
      </button>
      <div class="runtime-surface-menu hidden" data-runtime-surface-menu role="menu" aria-label="Switch runtime surface">
        <p class="runtime-surface-menu-heading">Runtime Surfaces</p>
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
    ? `<span class="runtime-surface-item-check" aria-hidden="true">
         <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
           <path d="m2.4 6.3 2.1 2.1 5.1-5.1" />
         </svg>
       </span>`
    : '';
  const content = `
    <span class="runtime-surface-swatch ${surface.swatchClass}" aria-hidden="true"></span>
    <span class="runtime-surface-item-copy">
      <span class="runtime-surface-item-title-row">
        <span class="runtime-surface-item-title">${escapeHtml(surface.label)}</span>
        ${badge}
      </span>
      <span class="runtime-surface-item-subtitle">${escapeHtml(surface.subtitle)}</span>
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
