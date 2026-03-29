import process from 'node:process';

import { verifyRuntimeSkillCatalog } from '../core/skills/catalog.js';

try {
  const verification = verifyRuntimeSkillCatalog();
  process.stdout.write(
    `[cats-runtime] verified ${verification.totalSkills} runtime-owned skill packages with ${verification.requiredFields.length} explicit metadata fields\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[cats-runtime] skill verification failed: ${message}\n`);
  process.exitCode = 1;
}
