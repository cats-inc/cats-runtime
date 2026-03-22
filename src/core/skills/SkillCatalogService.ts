import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { SkillPackage } from './types.js';

/**
 * Discovers and validates skill packages from the skills/ directory.
 * Each skill lives in skills/<name>/SKILL.md with YAML frontmatter.
 */
export class SkillCatalogService {
  private readonly skillsDir: string;
  private cache: Map<string, SkillPackage> | null = null;

  constructor(skillsDir: string) {
    this.skillsDir = resolve(skillsDir);
  }

  /**
   * Discover all valid skills in the skills directory.
   * Results are cached until invalidate() is called.
   */
  async discover(): Promise<SkillPackage[]> {
    if (this.cache) {
      return Array.from(this.cache.values());
    }

    const packages: SkillPackage[] = [];
    const cache = new Map<string, SkillPackage>();

    let entries: string[];
    try {
      entries = await readdir(this.skillsDir);
    } catch {
      return [];
    }

    for (const entry of entries) {
      const skillPath = join(this.skillsDir, entry, 'SKILL.md');
      try {
        const raw = await readFile(skillPath, 'utf-8');
        const parsed = parseSkillMd(raw, skillPath);
        if (parsed) {
          packages.push(parsed);
          cache.set(parsed.name, parsed);
        }
      } catch {
        // Skip directories without SKILL.md or unreadable files
      }
    }

    this.cache = cache;
    return packages;
  }

  /**
   * Get a specific skill by name.
   */
  async get(name: string): Promise<SkillPackage | null> {
    await this.discover();
    return this.cache?.get(name) ?? null;
  }

  /**
   * Resolve multiple skill names to their packages.
   * Returns resolved skills and any names that couldn't be found.
   */
  async resolve(names: string[]): Promise<{
    resolved: SkillPackage[];
    unresolved: string[];
  }> {
    await this.discover();
    const resolved: SkillPackage[] = [];
    const unresolved: string[] = [];

    for (const name of names) {
      const pkg = this.cache?.get(name);
      if (pkg) {
        resolved.push(pkg);
      } else {
        unresolved.push(name);
      }
    }

    return { resolved, unresolved };
  }

  /**
   * Clear the cache to force re-discovery on next access.
   */
  invalidate(): void {
    this.cache = null;
  }
}

/**
 * Parse a SKILL.md file into a SkillPackage.
 * Returns null if the file is malformed.
 */
function parseSkillMd(raw: string, sourcePath: string): SkillPackage | null {
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    return null;
  }

  const frontmatterRaw = frontmatterMatch[1];
  const content = frontmatterMatch[2].trim();

  const frontmatter: Record<string, unknown> = {};
  for (const line of frontmatterRaw.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    frontmatter[key] = value;
  }

  const name = typeof frontmatter.name === 'string' ? frontmatter.name : null;
  const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';

  if (!name) {
    return null;
  }

  if (!content) {
    return null;
  }

  return {
    name,
    description,
    sourcePath,
    content,
    frontmatter,
  };
}
