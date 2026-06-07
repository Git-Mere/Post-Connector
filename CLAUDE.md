# CLAUDE.md

> Guide for Claude Code when working on the Post Connector project.

## Project Overview

**Post Connector** is a tool that takes a single GitHub repository as input and uses AI to generate platform-specific content for multiple destinations (LinkedIn, GitHub Pages blog/portfolio, GitHub README, Handshake), auto-publishing where possible.

**Core value**: Eliminate the repetitive work of writing project posts for multiple platforms after finishing a project.

---

## System Architecture

```
GitHub Repo (SSOT)
      ↓
   Core Engine
   - GitHub data collection
   - User supplemental input
   - AI generation orchestration
      ↓
   Platform Adapters (modular)
      ↓
   ├─ Auto-publish: GitHub README, GitHub Pages (blog/portfolio)
   └─ Copy-paste mode: LinkedIn Post, Handshake Profile
```

---

## Core Design Principles

1. **Modular adapter structure**: Adding a new platform should only require adding one adapter folder.
2. **User customization first**: Format and tone are defined in `instructions.md` / `schema.json`, not in code.
3. **GitHub as Single Source of Truth**: Project data always originates from the GitHub repo. No duplicate storage elsewhere.
4. **Auto-publish only where reliable; copy-paste for the rest**: Do not force automation.
5. **No premature abstraction**: Do not abstract until at least 2 adapters exist.

---

## Target Platforms (5)

| Platform | Publish Mode | Auth |
|----------|-------------|------|
| GitHub README | Auto | GitHub OAuth |
| GitHub Pages Blog | Auto (git push) | GitHub OAuth |
| GitHub Pages Portfolio | Auto (git push) | GitHub OAuth |
| LinkedIn Post | Copy-paste | None |
| Handshake Profile | Copy-paste | None |

---

## Tech Stack

- **Language**: TypeScript (Node.js)
- **Backend**: Fastify or Express
- **Frontend**: Next.js + Tailwind
- **Database**: PostgreSQL (Supabase) — users, publish history, supplemental input
- **AI**: Anthropic Claude API (Sonnet preferred)
- **GitHub Integration**: Octokit (official SDK), GraphQL preferred
- **Job Queue**: BullMQ (Redis) — async publishing, retries

---

## Folder Structure

```
/src
  /core
    - github-fetcher.ts       # GitHub API data collection
    - ai-generator.ts         # Claude API calls, prompt assembly
    - publish-queue.ts        # Publish queue management
    - adapter-registry.ts     # Auto-loads adapters
  
  /adapters
    global-instructions.md    # Shared user instructions across all adapters
    
    /github-readme
      - adapter.ts
      - schema.json
      - instructions.md
      - prompt-base.md
    
    /github-pages-blog
      - adapter.ts
      - schema.json
      - instructions.md
      - prompt-base.md
      - config.json           # repo URL, file path rules
    
    /github-pages-portfolio
      - adapter.ts
      - schema.json
      - instructions.md
      - prompt-base.md
      - config.json
    
    /linkedin-post
      - adapter.ts
      - schema.json
      - instructions.md
      - prompt-base.md
    
    /handshake-profile
      - adapter.ts
      - schema.json
      - instructions.md
      - prompt-base.md
  
  /api                        # REST endpoints
  /web                        # Next.js UI
```

---

## Adapter Interface

```typescript
interface PlatformAdapter {
  id: string;                          // "linkedin-post"
  name: string;                        // "LinkedIn Post"
  category: 'social' | 'blog' | 'portfolio' | 'job' | 'readme';
  authType: 'oauth' | 'api-key' | 'manual';
  
  // Format definition (loaded from schema.json)
  schema: AdapterSchema;
  
  // Prompt assembly
  generatePrompt(data: ProjectData, userInstructions: string): string;
  
  // Output validation
  validate(content: string): ValidationResult;
  
  // Publishing (omit if manual; implement only for auto)
  publish?(content: string, auth: Auth): Promise<PublishResult>;
}
```

**Rule**: If `publish` is not implemented, the UI automatically renders a "Copy to clipboard" mode.

---

## Prompt Assembly Order

```
1. [System] prompt-base.md          (fixed system prompt per adapter)
2. [Constraints] schema.json        (maxLength, format, etc.)
3. [Global] global-instructions.md  (shared user instructions)
4. [Adapter-specific] instructions.md (per-adapter user instructions) ← highest priority
5. [Data] ProjectData               (GitHub data + supplemental input)
```

`instructions.md` must have the strongest influence. Place it near the end of the prompt.

---

## GitHub Data to Collect

- Raw README.md
- `GET /repos/{owner}/{repo}/languages` (language breakdown)
- Repo metadata (topics, description, stars, license, homepage URL)
- Dependency files (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, etc.)
- Commit statistics (development span, activity)
- Release notes (if available)
- File tree (for architecture inference)

**Prefer GraphQL API** to fetch everything in a single request.

---

## User Supplemental Input (Required Step)

GitHub data alone is insufficient. Before generation, prompt the user for the following (all optional):

- Core problem solved
- Impact metrics (users, performance gains, etc.)
- Personal role (for team projects)
- Lessons learned / challenges
- Next steps / hooks

Store supplemental input in the database for reuse on republishing.

---

## Workflow

```
1. User enters a GitHub repo URL
2. GitHub data is auto-collected
3. Supplemental input form is shown (optional)
4. User selects adapters to publish to (checkboxes)
5. AI generates content per adapter (in parallel)
6. User previews / edits results
7. Publish
   - Auto adapters: enqueued and executed
   - Copy-paste adapters: clipboard copy button shown
8. Publish history saved to database
```

---

## Per-Adapter Notes

### GitHub README
- **Do not overwrite** the existing README. Create a PR or a new branch so the user can compare/merge.
- Recommend including badges, demo GIF, install/usage sections.

### GitHub Pages Blog
- File path: `_posts/YYYY-MM-DD-{slug}.md` (Jekyll convention, user-configurable)
- Auto-generate front matter (title, date, tags, categories)
- `config.json` defines repo, branch, and path rules

### GitHub Pages Portfolio
- Default approach: add an entry to a structured data file like `projects.json`.
- Site structures vary — `config.json` must define file path + data schema.
- Also support markdown file addition as an alternative.

### LinkedIn Post
- Recommended length ~1300 chars, max 3000
- First 3 lines appear before the "See more" cutoff → strong hook required
- 3–5 hashtags at the end
- Plain text only (no markdown)

### Handshake Profile
- Structured fields (Title, Description, Skills, Link)
- Short and direct tone
- Optimized for recruiters scanning quickly

---

## Auth / Security

- GitHub: OAuth App to obtain user tokens (required for private repos)
- Tokens must be encrypted at rest in the database
- Claude API key stays in server environment variables, never exposed to clients
- LinkedIn / Handshake require no auth (copy-paste)

---

## Rate Limit / Cost Management

- GitHub: 5,000 req/hour (authenticated) — cache aggressively
- Claude API: enforce per-user daily call limits
- Cache GitHub data for repeat generations on the same repo (5-minute TTL)

---

## Build Priority

**Phase 1 (MVP)**
1. GitHub fetcher
2. Adapter interface definition
3. GitHub README adapter (simplest)
4. LinkedIn Post adapter (copy-paste, no auth)
5. Minimal UI (repo URL input → result display)

**Phase 2**
6. GitHub Pages Blog adapter + git push logic
7. GitHub Pages Portfolio adapter (reuses push logic)
8. Supplemental input UI
9. Publish history / republishing

**Phase 3**
10. Handshake adapter
11. `global-instructions.md` support
12. Adapter management UI (users create/edit adapter folders directly)

---

## Coding Rules

- TypeScript strict mode
- No inter-adapter dependencies (each adapter is self-contained)
- Core calls adapters; adapters never call Core directly
- All AI prompts live in files (no inline prompt strings in code)
- Validate `schema.json` at runtime (e.g., with zod)

---

## Prohibitions

- Do not attempt LinkedIn auto-publishing (API review + ToS risk)
- Do not attempt Handshake auto-publishing (no Public API)
- Do not over-abstract before 2 adapters are built
- Do not hardcode AI prompts in code (always use `.md` files)
- Do not store user GitHub tokens in plaintext
