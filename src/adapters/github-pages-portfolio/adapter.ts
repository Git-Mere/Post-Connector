import type { PlatformAdapter, ValidationResult, Auth, PublishResult } from '../../types.js';
import { createPR } from '../../core/github-publisher.js';

const PORTFOLIO_OWNER = 'Git-Mere';
const PORTFOLIO_REPO = 'Git-Mere.github.io';
const PORTFOLIO_BASE = 'main';

// Content passed to publish() must be JSON matching this shape.
interface PublishPayload {
  filePath: string;
  markdown: string;
  branch: string;
  prTitle: string;
  prBody: string;
}

const adapter: PlatformAdapter = {
  id: 'github-pages-portfolio',
  name: 'GitHub Pages Portfolio',
  category: 'portfolio',
  authType: 'oauth',
  schema: {
    format: 'json',
  },

  validate(content: string): ValidationResult {
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

    for (const key of ['title', 'description'] as const) {
      if (typeof obj[key] !== 'string' || (obj[key] as string).trim() === '') {
        errors.push(`"${key}" must be a non-empty string`);
      }
    }

    if (!Array.isArray(obj['tech'])) {
      errors.push('"tech" must be an array');
    } else if ((obj['tech'] as unknown[]).length === 0) {
      errors.push('"tech" must be a non-empty array');
    } else if (!(obj['tech'] as unknown[]).every((t) => typeof t === 'string')) {
      errors.push('"tech" must be an array of strings');
    }

    return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
  },

  async publish(content: string, auth: Auth): Promise<PublishResult> {
    if (auth.type !== 'oauth') {
      return { ok: false, error: 'github-pages-portfolio requires oauth auth type' };
    }

    let payload: PublishPayload;
    try {
      payload = JSON.parse(content) as PublishPayload;
    } catch {
      return { ok: false, error: 'publish content must be a valid JSON PublishPayload' };
    }

    try {
      const prUrl = await createPR({
        token: auth.token,
        owner: PORTFOLIO_OWNER,
        repo: PORTFOLIO_REPO,
        branch: payload.branch,
        baseBranch: PORTFOLIO_BASE,
        title: payload.prTitle,
        body: payload.prBody,
        files: [{ path: payload.filePath, content: payload.markdown }],
      });
      return { ok: true, url: prUrl };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export default adapter;
