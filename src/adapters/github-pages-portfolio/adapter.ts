import type { PlatformAdapter, ValidationResult, Auth, PublishResult } from '../../types.js';

const adapter: PlatformAdapter = {
  id: 'github-pages-portfolio',
  name: 'GitHub Pages Portfolio',
  category: 'portfolio',
  authType: 'oauth',
  schema: {
    format: 'json',
  },

  validate(content: string): ValidationResult {
    // Strip ```json fences defensively before parsing.
    const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      return { ok: false, errors: ['Output is not valid JSON'] };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, errors: ['Output must be a JSON object, not an array or primitive'] };
    }

    const obj = parsed as Record<string, unknown>;
    const errors: string[] = [];

    for (const key of ['title', 'tagline', 'description', 'imageAlt'] as const) {
      if (typeof obj[key] !== 'string' || (obj[key] as string).trim() === '') {
        errors.push(`"${key}" must be a non-empty string`);
      }
    }

    if (!Array.isArray(obj['tags'])) {
      errors.push('"tags" must be an array');
    } else if ((obj['tags'] as unknown[]).length === 0) {
      errors.push('"tags" must be a non-empty array');
    } else if (!(obj['tags'] as unknown[]).every((t) => typeof t === 'string')) {
      errors.push('"tags" must be an array of strings');
    }

    return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
  },

  // Publishing (git push to portfolio repo) is implemented in the next task.
  async publish(_content: string, _auth: Auth): Promise<PublishResult> {
    throw new Error('github-pages-portfolio.publish: not implemented');
  },
};

export default adapter;
