import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Octokit } from '@octokit/rest';
import { generateRaw } from './core/ai-generator.js';
import { createPR, type FileChange } from './core/github-publisher.js';

interface Experience {
  company: string;
  title: string;
  location: string;
  range: string;
  url: string;
  date: string;
  bullets: string[];
}

interface ProfileData {
  name: string;
  tagline: string;
  currentCompany: { name: string; url: string } | null;
  aboutPoints: string[];
  skills: string[];
  ctaText: string;
  ctaUrl: string;
  experience: Experience[];
}

const PORTFOLIO_OWNER = 'Git-Mere';
const PORTFOLIO_REPO = 'Git-Mere.github.io';
const PORTFOLIO_BASE = 'main';

async function fetchFile(octokit: Octokit, path: string): Promise<string> {
  const response = await octokit.repos.getContent({
    owner: PORTFOLIO_OWNER,
    repo: PORTFOLIO_REPO,
    path,
  });
  const data = response.data;
  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error(`${path} is not a file`);
  }
  return Buffer.from((data as { content: string }).content.replace(/\n/g, ''), 'base64').toString('utf8');
}

// Generate only the plain-text content for the hero intro paragraph.
async function generateHeroIntro(profile: ProfileData): Promise<string> {
  const companyHint = profile.currentCompany
    ? `Currently working at ${profile.currentCompany.name}.`
    : '';

  return generateRaw({
    system: 'You write short professional bios for software developer portfolio sites. Output only the requested text — no labels, no explanation, no quotes.',
    user: `Write a 2-sentence first-person intro for a developer portfolio hero section.
Background info:
${profile.aboutPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}
${companyHint}

Requirements: professional but approachable tone, first person, no filler phrases like "I am passionate about". Output only the 2 sentences.`,
  });
}

// Generate only the plain-text about paragraphs (no JSX).
async function generateAboutParagraphs(profile: ProfileData): Promise<string[]> {
  const raw = await generateRaw({
    system: 'You write About Me sections for software developer portfolio sites. Output only the requested text — no labels, no explanation, no markdown.',
    user: `Write 3 short paragraphs for an About Me section. Each paragraph should be 1-3 sentences.
Background info:
${profile.aboutPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Requirements: first person, professional and genuine, varied sentence structure. Separate each paragraph with a blank line. Output only the paragraphs.`,
  });

  return raw.trim().split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

// Inject new content into hero.js using string replacement on known anchor strings.
function patchHeroJs(source: string, opts: {
  name: string;
  tagline: string;
  intro: string;
  currentCompany: { name: string; url: string } | null;
  ctaText: string;
  ctaUrl: string;
}): string {
  let out = source;

  // h2: name
  out = out.replace(
    /(<h2 className="big-heading">)[^<]+(\.?<\/h2>)/,
    `$1${opts.name}.$2`,
  );

  // h3: tagline
  out = out.replace(
    /(<h3 className="big-heading">)[^<]+(<\/h3>)/,
    `$1${opts.tagline}$2`,
  );

  // CTA href and text
  out = out.replace(
    /(className="email-link"\s*\n?\s*href=")[^"]+(")/,
    `$1${opts.ctaUrl}$2`,
  );
  // CTA button text (text between > and </a> inside const five)
  out = out.replace(
    /(className="email-link"[\s\S]*?>\s*)([^<]+?)(\s*<\/a>)/,
    `$1${opts.ctaText}$3`,
  );

  // intro paragraph inside const four: replace everything between <p> and </p>
  const introJsx = opts.currentCompany
    ? `\n        I'm ${opts.intro}{' '}\n        <a href="${opts.currentCompany.url}" target="_blank" rel="noreferrer">\n          ${opts.currentCompany.name}\n        </a>\n        .`
    : `\n        ${opts.intro}`;

  out = out.replace(
    /(<p>\s*)[\s\S]*?(\s*<\/p>\s*<\/>)/,
    `$1${introJsx}\n      $2`,
  );

  return out;
}

// Inject skills and about paragraphs into about.js.
function patchAboutJs(source: string, opts: {
  skills: string[];
  paragraphs: string[];
}): string {
  let out = source;

  // Replace skills array
  const skillsLiteral = `[${opts.skills.map((s) => `'${s}'`).join(', ')}]`;
  out = out.replace(
    /const skills = \[[\s\S]*?\];/,
    `const skills = ${skillsLiteral};`,
  );

  // Replace <p> elements inside StyledText <div>
  const pTags = opts.paragraphs.map((p) => `            <p>\n              ${p}\n            </p>`).join('\n\n');
  out = out.replace(
    /(<div>\s*\n)([\s\S]*?)(\n\s*<\/div>\s*\n\s*<ul)/,
    `$1${pTags}\n          $3`,
  );

  return out;
}

function buildJobMarkdown(exp: Experience): string {
  const bullets = exp.bullets.map((b) => `- ${b}`).join('\n');
  return `---
date: '${exp.date}'
title: '${exp.title}'
company: '${exp.company}'
location: '${exp.location}'
range: '${exp.range}'
url: '${exp.url}'
---

${bullets}
`;
}

async function main(): Promise<void> {
  const profilePath = process.argv[2];
  if (!profilePath) {
    process.stderr.write('Usage: pnpm profile <profile.json>\n');
    process.exit(1);
  }

  const token = process.env['GITHUB_TOKEN'];
  if (!token) {
    process.stderr.write('Error: GITHUB_TOKEN env var is required\n');
    process.exit(1);
  }

  const profile: ProfileData = JSON.parse(await readFile(profilePath, 'utf8'));
  const octokit = new Octokit({ auth: token });

  process.stderr.write('Fetching current portfolio files...\n');
  const [heroJs, aboutJs] = await Promise.all([
    fetchFile(octokit, 'src/components/sections/hero.js'),
    fetchFile(octokit, 'src/components/sections/about.js'),
  ]);

  process.stderr.write('Generating hero intro...\n');
  const heroIntro = await generateHeroIntro(profile);

  process.stderr.write('Generating about paragraphs...\n');
  const aboutParagraphs = await generateAboutParagraphs(profile);

  const newHero = patchHeroJs(heroJs, {
    name: profile.name,
    tagline: profile.tagline,
    intro: heroIntro,
    currentCompany: profile.currentCompany,
    ctaText: profile.ctaText,
    ctaUrl: profile.ctaUrl,
  });

  const newAbout = patchAboutJs(aboutJs, {
    skills: profile.skills,
    paragraphs: aboutParagraphs,
  });

  const changes: FileChange[] = [
    { path: 'src/components/sections/hero.js', content: newHero },
    { path: 'src/components/sections/about.js', content: newAbout },
    ...profile.experience.map((exp) => ({
      path: `content/jobs/${exp.company}/index.md`,
      content: buildJobMarkdown(exp),
    })),
  ];

  const today = new Date().toISOString().split('T')[0];
  const branch = `post-connector/profile-update-${today}`;

  const changedPaths = changes.map((c) => `- ${c.path}`).join('\n');
  process.stderr.write('Creating PR...\n');

  const prUrl = await createPR({
    token,
    owner: PORTFOLIO_OWNER,
    repo: PORTFOLIO_REPO,
    branch,
    baseBranch: PORTFOLIO_BASE,
    title: 'Update profile sections',
    body: `Generated by Post Connector.\n\nChanged files:\n${changedPaths}`,
    files: changes,
  });

  process.stdout.write(`PR created: ${prUrl}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
