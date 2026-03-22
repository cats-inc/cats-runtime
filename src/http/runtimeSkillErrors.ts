import { RuntimeSkillError } from '../core/skills/catalog.js';

export function toRuntimeSkillErrorResponse(error: unknown) {
  if (!(error instanceof RuntimeSkillError)) {
    return undefined;
  }

  return {
    status: error.code === 'strict_skill_delivery_unavailable' ? 409 as const : 400 as const,
    body: { error: error.message },
  };
}
