import { win32 as pathWin32 } from 'node:path';

/** Updater controls apply only to processes started by Cats, never the user's environment. */
export function getProviderProcessPolicy(providerName: string, args: string[], command: string): {
  args: string[];
  env?: Record<string, string>;
} {
  switch (providerName) {
    case 'claude':
      // https://code.claude.com/docs/en/setup#auto-updates
      return { args, env: { DISABLE_AUTOUPDATER: '1' } };
    case 'opencode':
      // https://opencode.ai/docs/cli/#environment-variables
      return { args, env: { OPENCODE_DISABLE_AUTOUPDATE: 'true' } };
    case 'muse':
      // Muse's installed launcher documents this per-process opt-out.
      return { args, env: { MUSE_NO_AUTO_UPDATE: '1' } };
    case 'junie':
      // https://junie.jetbrains.com/docs/parameters.html
      // The documented flag belongs to Junie, not node/npx or an ACP bridge.
      if (pathWin32.basename(command).replace(/\.(?:exe|com|cmd|bat|ps1)$/i, '').toLowerCase() !== 'junie') {
        return { args };
      }
      return { args: args.includes('--skip-update-check') ? args : ['--skip-update-check', ...args] };
    default:
      return { args };
  }
}
