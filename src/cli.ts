import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { fetchProjectData } from './core/github-fetcher.js';
import { getAdapter, getGlobalInstructions } from './core/adapter-registry.js';
import { generateContent } from './core/ai-generator.js';
import type { UserEnrichment } from './types.js';

function parseGithubUrl(raw: string): { owner: string; repo: string } {
  // Accept https://github.com/owner/repo or owner/repo
  const m = raw.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/) ??
            raw.match(/^([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m?.[1] || !m[2]) {
    throw new Error(`Cannot parse GitHub repo URL: ${raw}`);
  }
  return { owner: m[1], repo: m[2] };
}

function buildPortfolioMarkdown(opts: {
  aiFields: Record<string, unknown>;
  owner: string;
  repo: string;
  homepage: string | null;
  isFeatured: boolean;
}): string {
  const { aiFields, owner, repo, homepage, isFeatured } = opts;
  const tech = (aiFields['tech'] as string[]).map((t) => `  - ${t}`).join('\n');
  const today = new Date().toISOString().split('T')[0];
  const githubUrl = `https://github.com/${owner}/${repo}`;

  if (isFeatured) {
    const lines = [
      '---',
      `date: ${today}`,
      `title: ${aiFields['title']}`,
      'cover: ./cover.png',
      `github: ${githubUrl}`,
      ...(homepage ? [`external: ${homepage}`] : []),
      'tech:',
      tech,
      '---',
    ];
    return `${lines.join('\n')}\n\n${aiFields['description']}\n`;
  } else {
    const lines = [
      '---',
      `date: ${today}`,
      `title: ${aiFields['title']}`,
      `github: ${githubUrl}`,
      ...(homepage ? [`external: ${homepage}`] : []),
      'tech:',
      tech,
      "company: ''",
      'showInProjects: true',
      '---',
    ];
    return `${lines.join('\n')}\n\n${aiFields['description']}\n`;
  }
}

async function promptUserEnrichment(): Promise<UserEnrichment> {
  if (!process.stdin.isTTY) return {};

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ask = async (q: string): Promise<string> => (await rl.question(q)).trim();

  process.stderr.write('\n--- 프로젝트 정보 (Enter로 건너뛰기) ---\n');
  const problemSolved = await ask('만든 이유 / 해결한 문제: ');
  const learnings    = await ask('어려웠던 점 / 배운 것 (구체적일수록 좋음): ');
  rl.close();
  process.stderr.write('\n');

  return {
    ...(problemSolved && { problemSolved }),
    ...(learnings    && { learnings }),
  };
}

async function main(): Promise<void> {
  const rawUrl = process.argv[2];
  if (!rawUrl) {
    process.stderr.write('Usage: pnpm generate <github-repo-url> [adapter-id] [--publish] [--featured]\n');
    process.exit(1);
  }

  const isFeatured = process.argv.includes('--featured');
  const doPublish = process.argv.includes('--publish');
  const adapterId = (process.argv[3] && !process.argv[3].startsWith('--'))
    ? process.argv[3]
    : 'github-readme';

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

  // github-readme일 때만 GitHub fetch와 병렬로 사용자 입력 수집
  const fetchPromise  = fetchProjectData({ owner, repo, token, userInput: {} });
  const globalPromise = getGlobalInstructions();

  let userInput: UserEnrichment = {};
  if (adapterId === 'github-readme') {
    userInput = await promptUserEnrichment();
  }

  const [data, globalInstructions] = await Promise.all([fetchPromise, globalPromise]);
  Object.assign(data.userInput, userInput);

  const typeInstruction = adapterId === 'github-pages-portfolio'
    ? (isFeatured ? 'Output type: featured' : 'Output type: other')
    : '';

  const result = await generateContent({
    promptBase: loaded.promptBase,
    schema: loaded.schema,
    globalInstructions,
    adapterInstructions: typeInstruction
      ? `${loaded.instructions}\n\n${typeInstruction}`
      : loaded.instructions,
    data,
  });

  if (adapterId === 'github-pages-portfolio') {
    const validation = loaded.adapter.validate(result);
    if (!validation.ok) {
      process.stderr.write('Validation errors:\n');
      for (const e of validation.errors) {
        process.stderr.write(`  - ${e}\n`);
      }
      process.exit(1);
    }

    const stripped = result.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const aiFields = JSON.parse(stripped) as Record<string, unknown>;

    const markdown = buildPortfolioMarkdown({
      aiFields,
      owner,
      repo,
      homepage: data.repo.homepage,
      isFeatured,
    });

    const filePath = isFeatured
      ? `content/featured/${repo}/index.md`
      : `content/projects/${repo}.md`;

    const today = new Date().toISOString().split('T')[0];
    const branch = `post-connector/${repo}-${today}`;

    const payload = JSON.stringify({
      filePath,
      markdown,
      branch,
      prTitle: `Add project: ${repo}`,
      prBody: `Generated by Post Connector from https://github.com/${owner}/${repo}`,
    });

    process.stderr.write(`Creating PR for ${filePath}...\n`);
    const publishResult = await loaded.adapter.publish!(payload, { type: 'oauth', token });

    if (!publishResult.ok) {
      process.stderr.write(`Publish failed: ${publishResult.error}\n`);
      process.exit(1);
    }
    process.stdout.write(`PR created: ${publishResult.url}\n`);
  } else if (adapterId === 'github-readme' && doPublish) {
    const validation = loaded.adapter.validate(result);
    if (!validation.ok) {
      process.stderr.write('Validation errors:\n');
      for (const e of validation.errors) {
        process.stderr.write(`  - ${e}\n`);
      }
      process.exit(1);
    }

    const today = new Date().toISOString().split('T')[0];
    const branch = `post-connector/readme-${today}`;

    const payload = JSON.stringify({
      owner,
      repo,
      filePath: 'README.md',
      markdown: result,
      branch,
      prTitle: `Update README: ${repo}`,
      prBody: `Generated by Post Connector from https://github.com/${owner}/${repo}`,
    });

    process.stderr.write(`Creating PR for README.md...\n`);
    const publishResult = await loaded.adapter.publish!(payload, { type: 'oauth', token });

    if (!publishResult.ok) {
      process.stderr.write(`Publish failed: ${publishResult.error}\n`);
      process.exit(1);
    }
    process.stdout.write(`PR created: ${publishResult.url}\n`);
  } else {
    process.stdout.write(result + '\n');
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
