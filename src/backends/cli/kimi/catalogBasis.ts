import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The CLI's own region token, as `kimi login --region` takes it (`global`, `mainland-cn`). */
const REGION_TOKEN = /^[a-z0-9][a-z0-9._-]*$/u;

export type KimiTextReader = (path: string) => string;

const readText: KimiTextReader = path => readFileSync(path, 'utf8');

/**
 * The sign-in region Kimi records in `<KIMI_CODE_HOME>/region`, for SPEC-045 FR-6 basis
 * detection. That one-line marker is the only file read: `credentials/` and `config.toml`
 * are never opened (ADR-038). A missing, unreadable or unrecognized marker detects nothing.
 */
export function detectKimiSignInRegion(kimiHome: string, read: KimiTextReader = readText): string | null {
  let text: string;
  try {
    text = read(join(kimiHome, 'region'));
  } catch {
    return null;
  }
  const region = text.trim();
  return REGION_TOKEN.test(region) ? region : null;
}
