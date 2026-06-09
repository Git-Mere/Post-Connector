import { Octokit } from '@octokit/rest';

export interface FileChange {
  path: string;
  content: string;
}

export interface CreatePROptions {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  baseBranch?: string;
  title: string;
  body: string;
  files: FileChange[];
}

// All files go into a single commit via the git tree API.
export async function createPR(opts: CreatePROptions): Promise<string> {
  const octokit = new Octokit({ auth: opts.token });
  const base = opts.baseBranch ?? 'main';

  const { data: baseRef } = await octokit.git.getRef({
    owner: opts.owner,
    repo: opts.repo,
    ref: `heads/${base}`,
  });
  const baseSha = baseRef.object.sha;

  const { data: baseCommit } = await octokit.git.getCommit({
    owner: opts.owner,
    repo: opts.repo,
    commit_sha: baseSha,
  });

  const treeItems = await Promise.all(
    opts.files.map(async (file) => {
      const { data: blob } = await octokit.git.createBlob({
        owner: opts.owner,
        repo: opts.repo,
        content: Buffer.from(file.content).toString('base64'),
        encoding: 'base64',
      });
      return {
        path: file.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blob.sha,
      };
    }),
  );

  const { data: newTree } = await octokit.git.createTree({
    owner: opts.owner,
    repo: opts.repo,
    base_tree: baseCommit.tree.sha,
    tree: treeItems,
  });

  const { data: newCommit } = await octokit.git.createCommit({
    owner: opts.owner,
    repo: opts.repo,
    message: `post-connector: ${opts.title}`,
    tree: newTree.sha,
    parents: [baseSha],
  });

  await octokit.git.createRef({
    owner: opts.owner,
    repo: opts.repo,
    ref: `refs/heads/${opts.branch}`,
    sha: newCommit.sha,
  });

  const { data: pr } = await octokit.pulls.create({
    owner: opts.owner,
    repo: opts.repo,
    title: opts.title,
    body: opts.body,
    head: opts.branch,
    base,
  });

  return pr.html_url;
}
