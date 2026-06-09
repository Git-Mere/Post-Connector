# PROJECT — Post Connector (현행 통합 가이드)

> 프로젝트 스펙 + 설계 결정 + 세션 진행 상황을 담은 **단일 프로젝트 문서**입니다.
> Claude의 작업 방식(디렉터/코더/리뷰어 팀)은 **[CLAUDE.md](./CLAUDE.md)** 참고.
> 마지막 업데이트: 2026-06-07

---

## 1. 프로젝트 개요

**Post Connector**는 GitHub 레포 하나를 입력받아, AI로 여러 플랫폼용 콘텐츠(GitHub README, GitHub Pages 블로그/포트폴리오, LinkedIn, Handshake)를 생성하고 가능한 곳은 자동 게시하는 도구.

**핵심 가치:** 프로젝트 끝낸 뒤 플랫폼마다 홍보글 반복 작성하는 수고 제거.

---

## 2. ⭐ 확정된 설계 결정 (초기 CLAUDE.md에서 변경된 부분)

초기 구상(멀티유저 SaaS)에서 **혼자 쓰는 로컬 도구**로 노선을 변경. 그 결과:

| 항목 | 초기 CLAUDE.md 구상 | **현행 결정** |
|---|---|---|
| 사용 형태 | 멀티유저 웹 제품 | **혼자 쓰는 로컬 도구** |
| AI 인증 | Anthropic API 키 (`@anthropic-ai/sdk`) | **구독 OAuth** (`@anthropic-ai/claude-agent-sdk` + `CLAUDE_CODE_OAUTH_TOKEN`) |
| DB (Postgres/Supabase) | users/history/입력 저장 | **사용 안 함** (영속성 불필요, GitHub가 SSOT) |
| 큐 (BullMQ/Redis) | 비동기 게시 | **사용 안 함** (Octokit 동기 게시) |
| GitHub 인증 | OAuth App | **개인 PAT** (`GITHUB_TOKEN`) |
| 실행 트리거 | Next.js 웹 UI | **CLI 우선**, 웹은 나중에 |
| 프롬프트 조립 | 어댑터 `generatePrompt()` | **`ai-generator.ts`에 집중 (A안)**, `generatePrompt()` 인터페이스에서 제거 |

> 참고: 구독 플랜의 Agent SDK 사용량은 **2026-06-15부터** 인터랙티브 사용량과 분리된 별도 버킷에서 차감됨 (구독 범위 내 유지, 제거 아님). 한도는 대시보드에서 확인.

---

## 3. 인증 / 보안

- **AI:** `claude setup-token`으로 발급한 `CLAUDE_CODE_OAUTH_TOKEN`을 환경변수로. **`ANTHROPIC_API_KEY`는 반드시 unset** (우선순위가 높아 구독 토큰을 무력화함).
- **GitHub:** fine-grained PAT (`GITHUB_TOKEN`). 권한: **Contents R/W, Pull requests R/W, Metadata R**. 대상 레포만 스코프.
- 토큰은 `.env`에만, 절대 커밋 금지. `.env.example`은 키 이름만.

---

## 4. 시스템 아키텍처

```
GitHub Repo (Single Source of Truth)
      ↓
   Core Engine
   - github-fetcher : GitHub 데이터 수집 (GraphQL + REST, 5분 캐시)
   - ai-generator   : 프롬프트 조립 + Claude 호출 (구독 query())
   - adapter-registry : 어댑터 자동 로드 + schema.json 런타임 검증(zod)
      ↓
   Platform Adapters (모듈식)
      ↓
   ├─ 자동 게시(PR/push): GitHub README, GitHub Pages 블로그/포트폴리오
   └─ 복붙: LinkedIn, Handshake
```

### 핵심 설계 원칙
1. **모듈식 어댑터** — 새 플랫폼 = 어댑터 폴더 하나 추가.
2. **사용자 커스터마이징 우선** — 포맷/톤은 코드가 아니라 `instructions.md` / `schema.json`에서.
3. **GitHub가 SSOT** — 데이터는 항상 레포에서. 별도 저장 없음.
4. **신뢰 가능한 곳만 자동화**, 나머지는 복붙.
5. **조기 추상화 금지** — 어댑터 2개 생기기 전엔 추상화 안 함.

### 코어 ↔ 어댑터 계약 (`src/types.ts`)
- `PlatformAdapter`: `id, name, category, authType, schema, validate(content), publish?(content, auth)`.
  - **`generatePrompt()`는 제거됨** (조립은 ai-generator 담당).
  - `publish`가 없으면 복붙 모드(나중에 UI에서 클립보드 복사).
- 코어가 어댑터를 호출. 어댑터는 코어를 직접 호출하지 않음. 어댑터 간 의존성 없음.

---

## 5. 폴더 구조

```
/src
  /core
    - github-fetcher.ts     # GitHub 수집 (GraphQL 1회 + REST 보조)
    - ai-generator.ts       # 프롬프트 조립 + claude-agent-sdk query()
    - adapter-registry.ts   # 어댑터 자동 로드 + zod 검증
    - publish-queue.ts      # (스텁) BullMQ 안 씀 → Octokit 동기 게시로 재작성 예정
  /adapters
    global-instructions.md  # 전 어댑터 공통 사용자 지시
    /github-readme          # adapter.ts, schema.json, instructions.md, prompt-base.md
    /github-pages-portfolio # + config.json (대상 레포/파일/배열 정의)
    /linkedin-post          # (스텁)
  /api
    - server.ts             # (스텁) /health 만. 웹 UI 보류
  - cli.ts                  # pnpm generate <repo-url> [adapter-id]
  - types.ts
```

---

## 6. 프롬프트 조립 순서 (`ai-generator.ts`에서 구현)

```
[System] prompt-base.md  +  schema.json(제약)        → query() 의 systemPrompt
[User]   global-instructions.md  +  instructions.md  +  ProjectData(JSON)  → query() 의 prompt
```
- `instructions.md`가 가장 강한 영향력을 갖도록 끝부분(user)에 배치.
- one-shot 설정: `maxTurns:1`, `allowedTools:[]`, `settingSources:[]` (프로젝트 CLAUDE.md/.claude 로딩 차단).
- 모델 기본값 `claude-sonnet-4-6` (`ANTHROPIC_MODEL`로 오버라이드).

---

## 7. 수집하는 GitHub 데이터
README(.md/.rst), 언어 분포, 레포 메타(설명/토픽/스타/라이선스/홈페이지), 의존성 manifest(package.json/requirements.txt/go.mod 파싱; Cargo.toml은 미지원), 커밋 통계(첫/마지막/총수), 릴리스(최근 10), 파일 트리(최대 500). GraphQL 1회 + REST(languages/tree/oldest-commit).

---

## 8. 대상 플랫폼 & 어댑터별 노트

| 플랫폼 | 게시 | 상태 |
|---|---|---|
| GitHub README | 자동 (PR/새 브랜치, **덮어쓰기 금지**) | 생성 ✅ / 게시 ❌ |
| GitHub Pages 포트폴리오 | 자동 (PR) | ⚠️ 사이트 구조 교체됨 → 어댑터 재작성 필요 (아래 참조) |
| GitHub Pages 블로그 | 자동 (push) — Jekyll `_posts/YYYY-MM-DD-slug.md` | 미착수 |
| LinkedIn | 복붙 (~1300자, 해시태그, 플레인텍스트) | 미착수 |
| Handshake | 복붙 (제목/설명/스킬/링크) | 미착수 |

### github-pages-portfolio 대상 사이트 구조 (2026-06-07 변경됨)

> ⚠️ 포트폴리오 사이트가 **Gatsby 기반 구조**(Brittany Chiang v4 템플릿 기반)로 교체됨. 기존 `src/data/projects.ts` 배열 방식은 **무효** — 어댑터를 이 구조에 맞게 재작성해야 함. 대상 레포: `Git-Mere/Git-Mere.github.io` `main`.

아래는 새 포트폴리오에서 콘텐츠를 갈아끼우는 위치 전체 맵.

**A. Post Connector가 자동 생성할 대상 (프로젝트별 — 어댑터의 실제 출력)**

| 영역 | 파일 | frontmatter | 본문 |
|---|---|---|---|
| Featured Projects (상단 강조 3개) | `content/featured/{프로젝트명}/index.md` | `date`(순서), `title`, `cover`(이미지파일), `github`, `external`, `tech[]` | 프로젝트 설명 |
| Other Projects (그리드 목록) | `content/projects/{프로젝트명}.md` | `date`, `title`, `github`, `external`, `tech[]`, `company`, `showInProjects`(true/false) | 한두 줄 설명 |

→ Post Connector는 레포 데이터로 **Featured 또는 Other Projects용 마크다운 1개**(frontmatter + 본문)를 생성해 PR로 추가하는 게 핵심 작업. (둘 중 어느 타입을 기본으로 할지는 다음 세션에서 결정.)

**B. 1회성 개인 설정 (수동 — 자동 생성 대상 아님, 참고용 기록)**

| 영역 | 파일 | 수정 대상 |
|---|---|---|
| Hero | `src/components/sections/hero.js` | 이름(h2), 한 줄 소개(h3), 소개 본문(p), CTA 버튼 텍스트/링크 |
| About | `src/components/sections/about.js` | 소개 단락들, `skills` 배열 |
| Experience | `content/jobs/{회사명}/index.md` (회사마다 하나) | frontmatter: `date,title,company,location,range,url` / 본문: 담당 업무 bullets. 현재 `Apple/Mullen/Scout/Starry/Upstatement` 전부 교체 대상 |
| Contact | `src/components/sections/contact.js` | 본문 텍스트만(이메일은 `config.js`에서 자동 참조). 선택사항 |
| 이미지 | `src/images/me.jpg`(프로필), `src/images/logo.png`(로고), `static/resume.pdf`, `static/og.png`(SNS 썸네일), `content/featured/{프로젝트명}/`(Featured 커버) | 파일 교체 |

---

## 9. 워크플로우 (CLI 기준)

```
1. pnpm generate <repo-url> [adapter-id]
2. github-fetcher가 데이터 수집
3. ai-generator가 어댑터별 프롬프트 조립 → 구독 query() 호출
4. README: 마크다운 출력 / 포트폴리오: 삽입용 TS 객체 리터럴 출력
5. (예정) 게시: Octokit으로 PR 생성
```
> 보충 입력(해결한 문제/임팩트/역할/배운 점/다음 단계)은 현재 CLI가 빈 `{}` 전달. 추후 옵션 추가 예정.

---

## 10. 코딩 규칙 / 금지
- TypeScript strict. 어댑터 간 의존성 금지. AI 프롬프트는 코드 인라인 금지 — 항상 `.md` 파일.
- `schema.json`은 런타임 zod 검증.
- 토큰 평문 저장 금지. LinkedIn/Handshake 자동 게시 시도 금지(ToS).
- 변경은 surgical하게, 요청 범위만. 과한 추상화 금지.

---

## 11. 개발 팀 운영
디렉터/코더/리뷰어 3역할로 작업. 상세는 **[CLAUDE.md](./CLAUDE.md)** 참고.

---

# === 세션 인수인계 (다음 세션 시작점) ===

## 12. 마지막 세션에서 한 일 (2026-06-08)

1. **포트폴리오 어댑터 전면 재작성** — Gatsby(Brittany Chiang v4) 구조 대응.
   - AI 출력: `{ title, tech[], description }` JSON
   - CLI가 frontmatter+md 파일로 조립 (`content/featured/{name}/index.md` or `content/projects/{name}.md`)
   - `--featured` 플래그로 타입 선택. Featured: 커버 이미지·긴 설명 / Other: 1-2문장·showInProjects
2. **포트폴리오 게시(PR) 구현** — `src/core/github-publisher.ts` 신규. git tree API로 단일 커밋 PR 생성. `adapter.ts`의 `publish()` 구현 완료.
3. **`pnpm profile` 커맨드 신규** (`src/cli-profile.ts`) — `profile.json` 기반으로 hero.js·about.js·jobs 수정 PR 자동 생성.
   - hero.js/about.js: string replacement(이름·tagline·CTA·skills) + AI 생성(intro단락·about단락)
   - `profile.example.json` 루트에 생성
   - **실제 PR 생성 확인**: `Git-Mere/git-mere.github.io` PR #1
4. **`generateRaw()`** `ai-generator.ts`에 추가 — 짧은 서술 텍스트 생성용 (system/user 직접 전달).

## 13. 현재 상태

| 항목 | 상태 |
|---|---|
| GitHub 수집 (`github-fetcher.ts`) | ✅ |
| ai-generator (구독 query) | ✅ |
| CLI `pnpm generate` | ✅ |
| github-readme 생성 | ✅ 동작 확인 |
| github-readme **게시(PR)** | ❌ 미구현 |
| github-pages-portfolio 생성 (Featured/Other) | ✅ |
| github-pages-portfolio **게시(PR)** | ✅ 구현 완료 |
| `pnpm profile` (hero/about/jobs PR) | ✅ 구현·테스트 완료 |
| 블로그 / LinkedIn / Handshake | ❌ 미착수 |
| 보충 입력 수집 | ❌ CLI가 빈 `{}` 전달 |

## 14. ✅ 포트폴리오 새 구조 확정됨 (2026-06-07)
사이트가 Gatsby 구조(Brittany Chiang v4 템플릿 기반)로 교체됨. 상세 구조는 **섹션 8의 "github-pages-portfolio 대상 사이트 구조"** 참조.

## 15. 다음 할 일 (우선순위)
1. **PR #1 검토 및 string replacement 패턴 검증** — hero.js·about.js 패치가 실제 파일에 올바르게 적용됐는지 확인. 문제 있으면 `patchHeroJs` / `patchAboutJs` 수정.
2. **7개 프로젝트 실제 실행** — `pnpm generate`로 각 레포 포트폴리오 항목 생성·PR
   - Featured (--featured): `Settle-Up`, `Where-is-the-question`, `Moris-library` (레포명 확인 필요)
   - Other: `ladder-chess`, `solar-system`, `simple-graphic-project2`, `garam` (레포명 확인 필요)
3. **README 게시(PR)** — `github-readme` 어댑터에 `publish()` 추가 (Octokit, 덮어쓰기 금지, 새 브랜치+PR)
4. (이후) 블로그 어댑터, 보충 입력 CLI 옵션, 웹 UI

## 16. 실행 방법 (셋업)
```bash
claude setup-token            # 출력 토큰 → .env 의 CLAUDE_CODE_OAUTH_TOKEN
# .env:
#   CLAUDE_CODE_OAUTH_TOKEN=<토큰>
#   GITHUB_TOKEN=<fine-grained PAT: Contents R/W, Pull requests R/W, Metadata R>
#   ANTHROPIC_API_KEY 는 반드시 비워둘 것
pnpm install
pnpm generate https://github.com/<owner>/<repo>                          # README (stdout)
pnpm generate https://github.com/<owner>/<repo> github-pages-portfolio   # Other 포트폴리오 PR
pnpm generate https://github.com/<owner>/<repo> github-pages-portfolio --featured  # Featured PR
pnpm profile profile.example.json                                        # 프로필 섹션 PR
pnpm typecheck
```

## 17. 남은 부채
- `package.json`에 `bullmq`, `ioredis` 잔존(큐 안 씀 → 정리 가능). `src/core/publish-queue.ts`는 스텁 — 제거 예정.
- `src/api/server.ts`는 `/health`만 있는 스텁 (웹 UI 보류).
- `patchHeroJs` / `patchAboutJs` string replacement 패턴이 hero.js·about.js 실제 현재 내용에 의존 — PR #1 검토 후 패턴 안정성 확인 필요.
