import { Hono } from 'hono';
import { listRuntimeSkillCatalog } from '../../core/skills/catalog.js';

export const skillRoutes = new Hono();

skillRoutes.get('/skills/catalog', (c) => {
  try {
    const skills = listRuntimeSkillCatalog();
    return c.json({
      count: skills.length,
      skills,
    });
  } catch (err) {
    return c.json(
      { error: `Failed to read runtime skill catalog: ${err}` },
      500,
    );
  }
});
