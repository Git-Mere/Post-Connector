# PROJECT — Post Connector (현행 통합 가이드)

> 프로젝트 스펙 + 설계 결정 + 세션 진행 상황을 담은 **단일 프로젝트 문서**입니다.
> Claude의 작업 방식(디렉터/코더/리뷰어 팀)은 **[CLAUDE.md](./CLAUDE.md)** 참고.
> 마지막 업데이트: 2026-06-16

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
| GitHub Pages 블로그 | — | ❌ 범위 밖 — 사용자가 직접 운용 |
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

**B. 1회성 개인 설정 (Post Connector 범위 밖 — 대상 레포에서 직접 Claude로 작업)**

> ⚠️ 방침(2026-06-08): hero/about/jobs 등 개인 프로필 섹션 수정은 **Post Connector가 하지 않는다.** 프로젝트별로 일반화하기 어렵고 1회성이라, 대상 레포(`git-mere.github.io`)에서 직접 Claude를 열어 작업하는 게 낫다고 판단. 지난 세션에 만든 `pnpm profile` 기능은 이 세션에서 **제거함**. (그 기능이 만든 PR #1 "Update profile sections"는 이미 main에 merge된 상태 — 머지된 내용은 추후 레포에서 직접 검토·수정.)


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

## 12. 마지막 세션에서 한 일

### 2026-06-16 세션

1. **개인 레포 7개 README PR 생성** — `pnpm generate <url> --publish`로 7건 게시. 기존 README + 파일 트리 참고해 B 구조로 생성, 새 브랜치 PR(덮어쓰기 없음).
   - 최종(모두 영어): `Garam`#2, `simple-graphic-project`#2, `Solar_system`#2, `Amidar-Master-Copy`#3, `simple-graphic-project2`#1, `Mori-s-library`#1, `Ladder-chess`#1
   - **언어 일관성 수정**: 1차 생성 시 일부가 한국어로 나옴(원인: `global-instructions.md`의 "## 언어"가 "기존 README 언어 기준"으로 작성하게 함). → `github-readme/instructions.md`에 "## 언어" override 추가(**항상 영어**, global보다 우선) + `prompt-base.md`에도 영어 규칙. 한국어로 나온 4개는 브랜치 삭제 후 영어로 재게시(이전 한국어 PR은 자동 close).
   - ⚠️ **포트폴리오 PR #10은 사용자가 이미 검토·적용 완료** (이번 세션에서 머지 확인 불필요).
2. **Post-Connector 자체 README 작성(직접) + main 커밋(`6a41e0c`)** — 루트에 README 없었음. 툴 자동 생성은 부정확(아래 부채 원인)해서 PROJECT.md 기반으로 직접 작성, 모든 주장 코드로 검증. 영어.
3. **죽은 코드/의존성 정리(`a1428bd`)** — §17 부채 해소. `src/core/publish-queue.ts`(BullMQ 스텁)·`src/api/server.ts`(Fastify `/health` 스텁)·`src/api/` 삭제, `bullmq`/`ioredis`/`fastify` deps + `dev`/`start` 스크립트 + `main` 필드 + `.env.example`의 `PORT` 제거. `tsc --noEmit` 통과. 코더→리뷰어 APPROVED.
   - ⚠️ `pnpm-lock.yaml`은 아직 제거된 deps 참조 — 이 환경에 pnpm 없어 재생성 불가. **pnpm 가능 시 `pnpm install`로 동기화 필요.**

### 2026-06-10 세션

1. **README 게시(PR) 구현** — `github-readme` 어댑터 `publish()` + CLI `--publish` 플래그. `github-publisher.ts` 재활용.
2. **batch-cli 구현** — `src/batch-cli.ts` + `pnpm batch-portfolio <config.json>`. 여러 레포를 단일 PR로 묶어 게시.
3. **9개 프로젝트 배치 PR 생성** — `batch.json`으로 `git-mere.github.io` 대상 PR #10 생성 (단일 PR에 9파일).
   - Featured(3): `Settle_Up`, `Where_is_the_question`, `Mori-s-library`
   - Other(6): `Solar_system`, `Amidar-Master-Copy`, `Ladder-chess`, `simple-graphic-project2`, `simple-graphic-project`, `Garam`
   - ⚠️ Featured 3개는 머지 전 커버 이미지 필요 (`content/featured/{repo}/cover.png`)
4. **README B 구조 + 인터랙티브 입력 구현** — 리서치(유명 개발자 패턴 + 리크루터 관점) 기반으로 구조 확정.
   - 구조: Features / Demo / Built With(이유 포함) / Getting Started / What I Learned / License
   - CLI가 TTY일 때 2개 질문 프롬프트 (`만든 이유`, `어려웠던 점·배운 것`)
   - 비-TTY(파이프/스크립트)에서는 프롬프트 건너뜀 → GitHub 데이터만으로 생성
5. **Bet-Game README PR #2 생성** — 새 B 구조 적용, 사용자 입력 없이도 코드 구조에서 What I Learned 추론 확인.

### 2026-06-09 세션

1. **프로필 수정 기능(`pnpm profile`) 제거** — 스코프를 "포트폴리오 프로젝트 항목 생성·게시"로 환원 (커밋 `d89f25a`).
   - 삭제: `src/cli-profile.ts`, `profile.example.json`
   - 수정: `package.json` profile 스크립트 제거, `ai-generator.ts`의 `generateRaw()` 제거(해당 기능 전용 함수)
   - 이유: 개인 프로필 섹션(hero/about/jobs)은 일반화 어렵고 1회성 → 대상 레포에서 직접 Claude로 작업하는 방침 (섹션 8-B). 리뷰어 APPROVED, typecheck 통과.
   - 지난 세션 `pnpm profile`이 만든 PR #1 "Update profile sections"는 이미 main에 merge돼 있었음(닫을 것 없음). 머지된 내용은 추후 레포에서 직접 검토·수정.
2. **7개 프로젝트 포트폴리오 PR 실제 생성** — `pnpm generate ... github-pages-portfolio`로 `Git-Mere/git-mere.github.io` main 대상 PR 7건. 각 브랜치 `post-connector/{repo}-2026-06-09`.
   - Other(4): `Solar_system`→PR#2, `Ladder-chess`→#3, `simple-graphic-project2`→#4, `Garam`→#5
   - Featured(4 → `--featured`): `Settle_Up`→#6, `Where_is_the_question`→#7, `Mori-s-library`→#8
   - 생성 품질 양호(tech 추출·설명 정확). **PR들은 아직 미머지 — 사용자 검토 대기.**
   - ⚠️ **Featured(#6–#8) 머지 전 커버 이미지 필요**: frontmatter가 `cover: ./cover.png`(어댑터 하드코딩, `cli.ts:33`)를 참조하나 PR엔 이미지 없음. 각 `content/featured/{repo}/`에 이미지 추가 필요. 파일명은 **`cover.png`일 필요 없음** — frontmatter `cover:` 값이 실존 이미지 파일을 가리키기만 하면 됨(기존 항목 예: `./halcyon.png`, `./demo.png`). 현재 출력에 맞추려면 `cover.png`로 두는 게 간단. Other(#2–#5)는 커버 없어 그대로 머지 가능.

### 2026-06-08 세션

1. **포트폴리오 어댑터 전면 재작성** — Gatsby(Brittany Chiang v4) 구조 대응.
   - AI 출력: `{ title, tech[], description }` JSON
   - CLI가 frontmatter+md 파일로 조립 (`content/featured/{name}/index.md` or `content/projects/{name}.md`)
   - `--featured` 플래그로 타입 선택. Featured: 커버 이미지·긴 설명 / Other: 1-2문장·showInProjects
2. **포트폴리오 게시(PR) 구현** — `src/core/github-publisher.ts` 신규. git tree API로 단일 커밋 PR 생성. `adapter.ts`의 `publish()` 구현 완료.

## 13. 현재 상태

| 항목 | 상태 |
|---|---|
| GitHub 수집 (`github-fetcher.ts`) | ✅ |
| ai-generator (구독 query) | ✅ |
| CLI `pnpm generate` | ✅ |
| github-readme 생성 (B 구조) | ✅ |
| github-readme **게시(PR)** | ✅ (`--publish` 플래그) |
| github-pages-portfolio 생성 (Featured/Other) | ✅ |
| github-pages-portfolio **게시(PR)** | ✅ |
| batch-portfolio (단일 PR에 여러 프로젝트) | ✅ |
| 포트폴리오 PR #10 (9개 프로젝트) | ✅ 생성 완료 (**미머지 — Featured 3개 커버 이미지 필요**) |
| 보충 입력 수집 (인터랙티브 프롬프트) | ✅ TTY에서 2개 질문 |
| 프로필 섹션(hero/about/jobs) 수정 | ❌ 범위 밖 — 레포에서 직접 작업 |
| linkedin-post 생성 (복붙 모드) | ✅ 어댑터 구현 (커밋 `8c03152`) |
| 블로그 / Handshake | ❌ 미착수 (블로그는 범위 밖) |
| 웹 UI | ❌ 미착수 (server 스텁 제거됨) |

## 14. ✅ 포트폴리오 새 구조 확정됨 (2026-06-07)
사이트가 Gatsby 구조(Brittany Chiang v4 템플릿 기반)로 교체됨. 상세 구조는 **섹션 8의 "github-pages-portfolio 대상 사이트 구조"** 참조.

## 15. 다음 할 일 (우선순위)
1. ✅ (완료) 포트폴리오 PR #10 — 사용자가 검토·적용 완료.
2. ✅ (완료) 개인 레포 7개 README PR 생성·게시 (모두 영어). 사용자 검토·머지 대기.
3. **`pnpm install` 1회** — 정리된 deps로 `pnpm-lock.yaml` 동기화 (§17).
4. (이후) LinkedIn 게시 흐름(복붙 UI), Handshake 어댑터, 웹 UI

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
pnpm typecheck
```

## 17. 남은 부채
- ✅ (2026-06-16 해소) `bullmq`/`ioredis`/`fastify` deps, `publish-queue.ts`·`api/server.ts` 스텁 제거. 단 `pnpm-lock.yaml`은 아직 미동기화 → **`pnpm install` 1회 필요**.
