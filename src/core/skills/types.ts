/**
 * Skill system types for cats-runtime.
 * Skills are reusable instruction packages following the agentskills.io standard.
 */

export interface SkillPackage {
  /** Skill name from frontmatter */
  name: string;
  /** Short description from frontmatter */
  description: string;
  /** Path to the SKILL.md file on disk */
  sourcePath: string;
  /** The full markdown content (body, excluding frontmatter) */
  content: string;
  /** Raw frontmatter fields */
  frontmatter: Record<string, unknown>;
}

export interface ResolvedSkillRef {
  /** Skill name */
  name: string;
  /** Path to the source SKILL.md */
  sourcePath: string;
  /** Compiled instructions content */
  content: string;
}

export type SkillDeliveryMode = 'instructions' | 'filesystem';

export interface SessionSkillState {
  /** Skills that were requested for this session */
  requestedSkills: string[];
  /** Skills that were successfully resolved */
  resolvedSkills: ResolvedSkillRef[];
  /** Delivery mode used */
  deliveryMode: SkillDeliveryMode;
  /** Any warnings encountered during resolution */
  warnings: string[];
}
