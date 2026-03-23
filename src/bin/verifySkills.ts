import process from 'node:process';

import { listRuntimeSkillCatalog } from '../core/skills/catalog.js';

try {
  const skills = listRuntimeSkillCatalog();
  process.stdout.write(
    `[cats-runtime] verified ${skills.length} runtime skill packages\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[cats-runtime] skill verification failed: ${message}\n`);
  process.exitCode = 1;
}
