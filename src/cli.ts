import 'dotenv/config';
import { fetchProjectData } from './core/github-fetcher.js';
import { getAdapter, getGlobalInstructions } from './core/adapter-registry.js';
import { generateContent } from './core/ai-generator.js';

function parseGithubUrl(raw: string): { owner: string; repo: string } {
  // Accept https://github.com/owner/repo or owner/repo
  const m = raw.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/) ??
            raw.match(/^([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m?.[1] || !m[2]) {
    throw new Error(`Cannot parse GitHub repo URL: ${raw}`);
  }
  return { owner: m[1], repo: m[2] };
}

// Format a merged portfolio entry object as a TypeScript object literal (2-space indent,
// double-quoted strings). Optional fields absent from `obj` are simply omitted.
function escapeTsString(value: unknown): string {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function formatTsObjectLiteral(obj: Record<string, unknown>): string {
  const lines: string[] = ['{'];
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      const items = (value as string[]).map((v) => `"${escapeTsString(v)}"`).join(', ');
      lines.push(`  ${key}: [${items}],`);
    } else {
      lines.push(`  ${key}: "${escapeTsString(value)}",`);
    }
  }
  lines.push('}');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const rawUrl = process.argv[2];
  if (!rawUrl) {
    process.stderr.write('Usage: pnpm generate <github-repo-url> [adapter-id]\n');
    process.exit(1);
  }

  const adapterId = process.argv[3] ?? 'github-readme';

  const token = process.env['GITHUB_TOKEN'];
  if (!token) {
    process.stderr.write('Error: GITHUB_TOKEN env var is required\n');
    process.exit(1);
  }

  const { owner, repo } = parseGithubUrl(rawUrl);

  const loaded = await getAdapter(adapterId);
  if (!loaded) {
    throw new Error(`adapter not found: ${adapterId}`);
  }

  const [data, globalInstructions] = await Promise.all([
    fetchProjectData({ owner, repo, token, userInput: {} }),
    getGlobalInstructions(),
  ]);

  const result = await generateContent({
    promptBase: loaded.promptBase,
    schema: loaded.schema,
    globalInstructions,
    adapterInstructions: loaded.instructions,
    data,
  });

  if (adapterId === 'github-pages-portfolio') {
    // 1. Validate the raw AI output.
    const validation = loaded.adapter.validate(result);
    if (!validation.ok) {
      process.stderr.write('Validation errors:\n');
      for (const e of validation.errors) {
        process.stderr.write(`  - ${e}\n`);
      }
      process.exit(1);
    }

    // 2. Parse (strip fences defensively, same logic as validate).
    const stripped = result.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const aiFields = JSON.parse(stripped) as Record<string, unknown>;

    // 3. Merge in code-filled fields per the field responsibility split.
    const merged: Record<string, unknown> = {
      title: aiFields['title'],
      tagline: aiFields['tagline'],
      description: aiFields['description'],
      image: '/projects/placeholder.png',
      imageAlt: aiFields['imageAlt'],
      tags: aiFields['tags'],
      githubUrl: `https://github.com/${owner}/${repo}`,
    };

    // liveUrl only if homepage is present.
    if (data.repo.homepage) {
      merged['liveUrl'] = data.repo.homepage;
    }

    // 4. Print the TypeScript object literal.
    process.stdout.write(formatTsObjectLiteral(merged) + '\n');
  } else {
    process.stdout.write(result + '\n');
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
