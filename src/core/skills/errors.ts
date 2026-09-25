export class RuntimeSkillError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unknown_skill'
      | 'invalid_skill_package'
      | 'invalid_skill_manifest'
      | 'strict_skill_delivery_unavailable'
      | 'skill_content_profile_conflict',
  ) {
    super(message);
    this.name = 'RuntimeSkillError';
  }
}
