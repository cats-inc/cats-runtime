import catalog from '../../catalogs/media-profiles.json' with { type: 'json' };
import { IMAGE_PROVIDERS, type ImageProfile } from './contracts.js';

/** Validated execution profiles. A malformed catalog fails startup instead of exposing a guessed route. */
export function loadImageProfiles(value: unknown = catalog): ImageProfile[] {
  const input = value as { schemaVersion?: unknown; profiles?: unknown };
  if (input?.schemaVersion !== 2 || !Array.isArray(input.profiles)) throw new Error('Invalid media profile catalog');
  const seen = new Set<string>();
  return input.profiles.map((entry) => {
    const profile = entry as ImageProfile;
    const ratio = profile?.aspectRatio as { mode?: unknown; options?: unknown } | undefined;
    if (!profile || typeof profile.id !== 'string' || seen.has(profile.id) || !Number.isInteger(profile.revision) || profile.revision < 1
      || !IMAGE_PROVIDERS.includes(profile.provider) || profile.operation !== 'image.generate' || typeof profile.enabled !== 'boolean'
      || typeof profile.agentConfig?.id !== 'string' || typeof profile.agentConfig.model !== 'string' || typeof profile.agentConfig.effort !== 'string'
      || !(ratio?.mode === 'service' || (ratio?.mode === 'native' && Array.isArray(ratio.options) && ratio.options.length === 1
        && typeof ratio.options[0] === 'string' && /^\d+:\d+$/.test(ratio.options[0])))
      || typeof profile.evidence !== 'string') throw new Error('Invalid media profile catalog');
    seen.add(profile.id);
    return profile;
  });
}

export function imageProfile(profiles: ImageProfile[], provider: ImageProfile['provider']) {
  return profiles.find((profile) => profile.provider === provider && profile.operation === 'image.generate') ?? null;
}
