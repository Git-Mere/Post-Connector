import { graphql } from '@octokit/graphql';
import { Octokit } from '@octokit/rest';
import type { ProjectData, UserEnrichment } from '../types.js';

export interface FetchOptions {
  owner: string;
  repo: string;
  token: string;
  userInput: UserEnrichment;
}

// GitHub 에서 가져온 데이터만 캐시한다. userInput 은 매 호출 별로 다르므로 제외.
type GithubData = Omit<ProjectData, 'userInput'>;

interface CacheEntry {
  data: GithubData;
  expires: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;
const FILE_TREE_LIMIT = 500;
const RELEASES_LIMIT = 10;

// GraphQL 한 번에 메타 + README + 의존성 manifest + 릴리즈를 가져온다.
// languages, 파일 트리, 첫 커밋 (오래된 쪽) 은 REST 로 별도 호출.
interface GraphqlResponse {
  repository: {
    description: string | null;
    homepageUrl: string | null;
    stargazerCount: number;
    licenseInfo: { spdxId: string | null; name: string } | null;
    repositoryTopics: { nodes: Array<{ topic: { name: string } }> };
    defaultBranchRef: {
      name: string;
      target: {
        history: {
          totalCount: number;
          nodes: Array<{ committedDate: string }>;
        };
      };
    } | null;
    readmeMd: { text: string } | null;
    readmeRst: { text: string } | null;
    packageJson: { text: string } | null;
    requirementsTxt: { text: string } | null;
    goMod: { text: string } | null;
    cargoToml: { text: string } | null;
    releases: {
      nodes: Array<{
        tagName: string | null;
        name: string | null;
        description: string | null;
        publishedAt: string | null;
      }>;
    };
  } | null;
}

const QUERY = `
  query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      description
      homepageUrl
      stargazerCount
      licenseInfo { spdxId name }
      repositoryTopics(first: 20) { nodes { topic { name } } }
      defaultBranchRef {
        name
        target {
          ... on Commit {
            history(first: 1) {
              totalCount
              nodes { committedDate }
            }
          }
        }
      }
      readmeMd:        object(expression: "HEAD:README.md")        { ... on Blob { text } }
      readmeRst:       object(expression: "HEAD:README.rst")       { ... on Blob { text } }
      packageJson:     object(expression: "HEAD:package.json")     { ... on Blob { text } }
      requirementsTxt: object(expression: "HEAD:requirements.txt") { ... on Blob { text } }
      goMod:           object(expression: "HEAD:go.mod")           { ... on Blob { text } }
      cargoToml:       object(expression: "HEAD:Cargo.toml")       { ... on Blob { text } }
      releases(first: ${RELEASES_LIMIT}, orderBy: {field: CREATED_AT, direction: DESC}) {
        nodes { tagName name description publishedAt }
      }
    }
  }
`;

function parsePackageJson(text: string): Record<string, string> {
  try {
    const parsed = JSON.parse(text) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

function parseRequirementsTxt(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = (rawLine.split('#')[0] ?? '').trim();
    if (!line || line.startsWith('-')) continue;
    const m = line.match(/^([A-Za-z0-9_.\-]+)\s*(?:[<>=!~]+\s*([0-9A-Za-z_.\-+*]+))?/);
    if (m?.[1]) result[m[1]] = m[2] ?? '*';
  }
  return result;
}

function parseGoMod(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  let inBlock = false;
  for (const raw of text.split('\n')) {
    const t = raw.trim();
    if (t.startsWith('require (')) { inBlock = true; continue; }
    if (inBlock && t === ')') { inBlock = false; continue; }
    const m = inBlock
      ? t.match(/^([^\s/]+\/[^\s]+)\s+(\S+)/)
      : t.match(/^require\s+([^\s/]+\/[^\s]+)\s+(\S+)/);
    if (m?.[1]) result[m[1]] = m[2] ?? '*';
  }
  return result;
}

// Cargo.toml 은 TOML 파서가 필요 (smol-toml 등). Phase 1 에서는 미지원.

async function fetchFileTree(rest: Octokit, owner: string, repo: string, branch: string): Promise<string[]> {
  const res = await rest.git.getTree({ owner, repo, tree_sha: branch, recursive: 'true' });
  const out: string[] = [];
  for (const node of res.data.tree) {
    if (node.type === 'blob' && node.path) out.push(node.path);
    if (out.length >= FILE_TREE_LIMIT) break;
  }
  return out;
}

async function fetchOldestCommitDate(rest: Octokit, owner: string, repo: string, totalCommits: number): Promise<string> {
  if (totalCommits <= 1) return '';
  // listCommits 는 기본 브랜치를 최신 → 과거 순으로 페이지네이션. per_page=1, page=totalCommits → 가장 오래된 커밋 1개.
  const res = await rest.repos.listCommits({ owner, repo, per_page: 1, page: totalCommits });
  return res.data[0]?.commit.committer?.date ?? res.data[0]?.commit.author?.date ?? '';
}

export async function fetchProjectData(opts: FetchOptions): Promise<ProjectData> {
  const key = `${opts.owner}/${opts.repo}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return { ...cached.data, userInput: opts.userInput };
  }

  const gql = graphql.defaults({ headers: { authorization: `Bearer ${opts.token}` } });
  const rest = new Octokit({ auth: opts.token });

  const [gqlRes, langRes] = await Promise.all([
    gql<GraphqlResponse>(QUERY, { owner: opts.owner, name: opts.repo }),
    rest.repos.listLanguages({ owner: opts.owner, repo: opts.repo }),
  ]);

  const r = gqlRes.repository;
  if (!r) throw new Error(`Repository not found: ${opts.owner}/${opts.repo}`);

  let fileTree: string[] = [];
  let firstCommit = '';
  let lastCommit = '';
  let totalCommits = 0;
  if (r.defaultBranchRef) {
    const branch = r.defaultBranchRef.name;
    totalCommits = r.defaultBranchRef.target.history.totalCount;
    lastCommit = r.defaultBranchRef.target.history.nodes[0]?.committedDate ?? '';
    [fileTree, firstCommit] = await Promise.all([
      fetchFileTree(rest, opts.owner, opts.repo, branch),
      fetchOldestCommitDate(rest, opts.owner, opts.repo, totalCommits),
    ]);
  }

  const dependencies: Record<string, string> = {
    ...(r.packageJson?.text ? parsePackageJson(r.packageJson.text) : {}),
    ...(r.requirementsTxt?.text ? parseRequirementsTxt(r.requirementsTxt.text) : {}),
    ...(r.goMod?.text ? parseGoMod(r.goMod.text) : {}),
  };

  const releases = r.releases.nodes
    .map((n) => {
      if (!n.tagName || !n.publishedAt) return null;
      return {
        tag: n.tagName,
        name: n.name ?? n.tagName,
        body: n.description ?? '',
        publishedAt: n.publishedAt,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const data: GithubData = {
    repo: {
      owner: opts.owner,
      name: opts.repo,
      description: r.description,
      topics: r.repositoryTopics.nodes.map((t) => t.topic.name),
      stars: r.stargazerCount,
      license: r.licenseInfo?.spdxId ?? r.licenseInfo?.name ?? null,
      homepage: r.homepageUrl ?? null,
    },
    readme: r.readmeMd?.text ?? r.readmeRst?.text ?? null,
    languages: langRes.data as Record<string, number>,
    dependencies,
    commitStats: { firstCommit, lastCommit, totalCommits },
    releases,
    fileTree,
  };

  cache.set(key, { data, expires: Date.now() + TTL_MS });
  return { ...data, userInput: opts.userInput };
}

// 테스트 / 재발행 흐름에서 강제 무효화 가능하도록 노출.
export function clearCache(): void {
  cache.clear();
}
