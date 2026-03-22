import type { SkillCatalogService } from './SkillCatalogService.js';
import type { ResolvedSkillRef, SessionSkillState } from './types.js';

/**
 * Resolves requested skill names into session-ready instruction content.
 * Uses the 'instructions' delivery mode: compiles SKILL.md content into
 * a single instructions overlay that is prepended to session instructions.
 */
export class SkillResolver {
  private readonly catalog: SkillCatalogService;

  constructor(catalog: SkillCatalogService) {
    this.catalog = catalog;
  }

  /**
   * Resolve skill names for a session.
   * Returns a SessionSkillState with resolved content and any warnings.
   */
  async resolveForSession(requestedSkills: string[]): Promise<SessionSkillState> {
    if (requestedSkills.length === 0) {
      return {
        requestedSkills: [],
        resolvedSkills: [],
        deliveryMode: 'instructions',
        warnings: [],
      };
    }

    const { resolved, unresolved } = await this.catalog.resolve(requestedSkills);
    const warnings: string[] = [];

    for (const name of unresolved) {
      warnings.push(`Skill not found: ${name}`);
    }

    const resolvedRefs: ResolvedSkillRef[] = resolved.map((pkg) => ({
      name: pkg.name,
      sourcePath: pkg.sourcePath,
      content: pkg.content,
    }));

    return {
      requestedSkills,
      resolvedSkills: resolvedRefs,
      deliveryMode: 'instructions',
      warnings,
    };
  }

  /**
   * Compile resolved skills into a single instructions string.
   * Merge order: skill instructions first, then session instructions.
   */
  compileInstructions(
    skillState: SessionSkillState,
    sessionInstructions?: string,
  ): string {
    const parts: string[] = [];

    for (const skill of skillState.resolvedSkills) {
      parts.push(`<!-- Skill: ${skill.name} -->\n${skill.content}`);
    }

    if (sessionInstructions?.trim()) {
      parts.push(sessionInstructions.trim());
    }

    return parts.join('\n\n---\n\n');
  }
}
