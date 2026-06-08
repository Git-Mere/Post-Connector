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
| GitHub Pages 포트폴리오 | 자동 (PR) | 생성 ✅ / 게시 ❌ |
| GitHub Pages 블로그 | 자동 (push) — Jekyll `_posts/YYYY-MM-DD-slug.md` | 미착수 |
| LinkedIn | 복붙 (~1300자, 해시태그, 플레인텍스트) | 미착수 |
| Handshake | 복붙 (제목/설명/스킬/링크) | 미착수 |

### github-pages-portfolio 현행 사양
- 대상: `Git-Mere/Git-Mere.github.io` `main`, 파일 `src/data/projects.ts`의 `projects` 배열에 객체 추가 (`config.json`에 정의).
- AI 생성 필드: `title, tagline, description, tags[], imageAlt`. 코드가 채움: `githubUrl`(소스 레포), `liveUrl`(repo homepage 있으면), `image`(`/projects/placeholder.png`).
- 게시는 TS 소스 배열 텍스트 삽입 + PR.

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

## 12. 마지막 세션에서 한 일 (2026-06-07)

1. 노선 확정(로컬 도구) + AI 구독 인증 전환 + `ai-generator.ts` 재작성.
2. 프롬프트 조립 A안 통일, `generatePrompt()` 제거.
3. CLI 신규(`pnpm generate <repo-url> [adapter-id]`).
4. **github-readme 생성 end-to-end 동작 확인됨** (실제 레포로 README 출력 성공).
5. **github-pages-portfolio 생성 슬라이스 완성** (리뷰 통과, TS 객체 리터럴 콘솔 출력). 이스케이프 버그 2건 수정.
6. `.env.example` 정리(OAuth앱/Redis 변수 제거).

## 13. 현재 상태

| 항목 | 상태 |
|---|---|
| GitHub 수집 (`github-fetcher.ts`) | ✅ |
| ai-generator (구독 query) | ✅ |
| CLI `pnpm generate` | ✅ |
| github-readme 생성 | ✅ 동작 확인 |
| github-readme **게시(PR)** | ❌ 미구현 |
| github-pages-portfolio 생성 | ✅ (리뷰 통과, **사용자 라이브 확인 전**) |
| github-pages-portfolio **게시(PR)** | ❌ 미구현 |
| 블로그 / LinkedIn / Handshake | ❌ 미착수 |
| 보충 입력 수집 | ❌ CLI가 빈 `{}` 전달 |

## 14. ⚠️ 다음 세션 주의 — 포트폴리오 구조 변경 예정
사용자가 **포트폴리오 사이트 구성 자체를 변경할 예정**. 구조가 바뀌면 아래를 점검:
`github-pages-portfolio/config.json` + `schema.json` + `prompt-base.md` + `src/cli.ts`의 머지·포맷 로직.

## 15. 다음 할 일 (우선순위)
1. **(사용자 대기) 포트폴리오 새 구조 확정** → config.json/schema/prompt-base 업데이트
2. **포트폴리오 게시(2단계)** — `projects.ts` 배열에 TS 객체 삽입 + `Git-Mere.github.io`에 **PR**. (JSON 아닌 TS 소스라 텍스트 삽입 주의: 배열 닫는 `]` 앞 삽입 등)
3. **README 게시(PR)** — 동일 Octokit PR 패턴 (덮어쓰기 금지, 새 브랜치+PR)
4. (이후) 블로그 어댑터, 보충 입력 CLI 옵션, 웹 UI

## 16. 실행 방법 (셋업)
```bash
claude setup-token            # 출력 토큰 → .env 의 CLAUDE_CODE_OAUTH_TOKEN
# .env:
#   CLAUDE_CODE_OAUTH_TOKEN=<토큰>
#   GITHUB_TOKEN=<fine-grained PAT: Contents R/W, Pull requests R/W, Metadata R>
#   ANTHROPIC_API_KEY 는 반드시 비워둘 것
pnpm install
pnpm generate https://github.com/<owner>/<repo>                        # README
pnpm generate https://github.com/<owner>/<repo> github-pages-portfolio  # 포트폴리오(콘솔 출력)
pnpm typecheck
```

## 17. 남은 부채
- `package.json`에 `bullmq`, `ioredis` 잔존(큐 안 씀 → 정리 가능). `src/core/publish-queue.ts`는 스텁 — BullMQ 안 쓰는 방향으로 재작성/제거 예정.
- `src/api/server.ts`는 `/health`만 있는 스텁 (웹 UI 보류).
