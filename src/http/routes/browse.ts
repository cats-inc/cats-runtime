import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Hono } from 'hono';

export const browseRoutes = new Hono();

/** GET /browse?path=... — list subdirectories for the directory picker UI */
browseRoutes.get('/browse', (c) => {
  const raw = c.req.query('path') || homedir();

  let entries: { name: string; path: string }[];
  try {
    const items = readdirSync(raw);
    entries = [];
    for (const name of items) {
      if (name.startsWith('.')) continue;
      const full = join(raw, name);
      try {
        if (statSync(full).isDirectory()) {
          entries.push({ name, path: full.replace(/\\/g, '/') });
        }
      } catch {
        // permission denied — skip
      }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return c.json({ error: `Cannot read directory: ${raw}` }, 400);
  }

  return c.json({
    current: raw.replace(/\\/g, '/'),
    parent: join(raw, '..').replace(/\\/g, '/'),
    entries,
  });
});
