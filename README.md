# Post Connector

Turn one GitHub repo into ready-to-post content for every platform — and publish it where automation is safe.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue) ![License](https://img.shields.io/badge/license-MIT-green)

A local CLI that reads a GitHub repository, uses Claude to write platform-specific content (GitHub README, GitHub Pages portfolio entry, LinkedIn post), and opens a pull request where publishing can be automated. Built to kill the repetitive chore of rewriting the same project announcement for every platform after finishing a project.

## Features

- **Modular adapters** — each platform is one folder. Adding a platform means adding a directory, not editing the core.
- **User-owned formatting** — tone and structure live in per-adapter `instructions.md` / `schema.json`, not in code.
- **GitHub as the single source of truth** — data is always pulled live from the repo (README, languages, repo metadata, dependency manifests, commit stats, releases, file tree). No database, no stored state.
- **Automate only where it's trustworthy** — README and portfolio entries are published as pull requests (never overwriting). LinkedIn is copy-paste only (no ToS-violating auto-posting).
- **Runtime-validated output** — every adapter's output is checked against its `schema.json` with Zod before it can be published.

## Demo

```bash
# Generate a README to stdout
$ pnpm generate https://github.com/owner/repo

# Generate and open a PR with the new README (never overwrites the existing one)
$ pnpm generate https://github.com/owner/repo --publish
Creating PR for README.md...
PR created: https://github.com/owner/repo/pull/1
```

## Built With

- **TypeScript (strict)** — the core/adapter contract and Zod schemas rely on static types to keep adapters decoupled.
- **@anthropic-ai/claude-agent-sdk** — calls Claude through a Claude subscription (OAuth), so generation runs without a metered API key.
- **@octokit/rest + @octokit/graphql** — one GraphQL query gathers repo metadata, README, manifests and releases; REST fills in languages, file tree and the oldest commit.
- **Zod** — runtime validation of adapter output against `schema.json`, so malformed content can't be published.
- **dotenv** — keeps the OAuth and GitHub tokens out of the code.

## Getting Started

### Prerequisites

- Node.js + pnpm
- A Claude subscription token (`claude setup-token`)
- A GitHub fine-grained PAT scoped to the target repos, with **Contents R/W, Pull requests R/W, Metadata R**

### Installation

```bash
git clone https://github.com/Git-Mere/Post-Connector.git
cd Post-Connector
pnpm install
```

Set up credentials. **`ANTHROPIC_API_KEY` must stay unset** — it takes priority over the subscription token and would override it.

```bash
claude setup-token            # copy the token into CLAUDE_CODE_OAUTH_TOKEN
cp .env.example .env
# .env:
#   CLAUDE_CODE_OAUTH_TOKEN=<token from claude setup-token>
#   GITHUB_TOKEN=<fine-grained PAT>
#   (leave ANTHROPIC_API_KEY empty)
```

### Usage

```bash
# README to stdout
pnpm generate https://github.com/<owner>/<repo>

# README as a PR
pnpm generate https://github.com/<owner>/<repo> --publish

# GitHub Pages portfolio entry (Other Projects) as a PR
pnpm generate https://github.com/<owner>/<repo> github-pages-portfolio

# ...as a Featured project entry
pnpm generate https://github.com/<owner>/<repo> github-pages-portfolio --featured

# LinkedIn post (copy-paste, no publishing)
pnpm generate https://github.com/<owner>/<repo> linkedin-post

# Batch several repos into a single portfolio PR
pnpm batch-portfolio batch.json
```

When run in a TTY, the README adapter asks two optional questions (why you built it, what was hard / what you learned) and folds the answers into the output. Piped or non-interactive runs skip the prompts and generate from GitHub data alone.

## What I Learned

**Designing a core/adapter contract that stays clean as platforms multiply.**
The core calls adapters; adapters never call the core and never depend on each other. Each adapter exposes only `id, name, category, authType, schema, validate()` and an optional `publish()`. Prompt assembly was deliberately pulled *out* of the adapters and centralized in `ai-generator.ts`, so an adapter is just data (three markdown/JSON files) plus a thin validator. Adding LinkedIn support was a new folder — zero changes to the generation pipeline.

**Choosing a subscription token over an API key changed the whole architecture.**
The project started as a multi-user SaaS sketch (API key, Postgres, a Redis publish queue). Re-scoping it to a single-user local tool collapsed all of that: GitHub became the only source of truth, persistence disappeared, and the queue became unnecessary. The one sharp edge was authentication — `ANTHROPIC_API_KEY` silently overrides the subscription OAuth token, so getting subscription-based generation to work meant guaranteeing that variable is never set.

**Making AI output safe to publish automatically.**
Generation is one-shot (`maxTurns: 1`, no tools) and the result is validated against a per-adapter Zod schema before any PR is opened. Publishing always targets a new branch and never overwrites an existing README, so a bad generation can only ever produce a reviewable PR — never a destructive commit.

## License

[MIT](./LICENSE)
