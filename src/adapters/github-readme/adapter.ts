import type { PlatformAdapter, ValidationResult, Auth, PublishResult } from '../../types.js';
import { createPR } from '../../core/github-publisher.js';

// Content passed to publish() must be JSON matching this shape.
interface PublishPayload {
  owner: string;
  repo: string;
  filePath: string;
  markdown: string;
  branch: string;
  prTitle: string;
  prBody: string;
}

const adapter: PlatformAdapter = {
  id: 'github-readme',
  name: 'GitHub README',
  category: 'readme',
  authType: 'oauth',
  schema: {
    format: 'markdown',
  },

  validate(content: string): ValidationResult {
    if (content.trim().length === 0) {
      return { ok: false, errors: ['Generated README is empty'] };
    }
    return { ok: true, errors: [] };
  },

  async publish(content: string, auth: Auth): Promise<PublishResult> {
    if (auth.type !== 'oauth') {
      return { ok: false, error: 'github-readme requires oauth auth type' };
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
        owner: payload.owner,
        repo: payload.repo,
        branch: payload.branch,
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
