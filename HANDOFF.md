# HANDOFF — 세션 인수인계

> 다음 세션에서 바로 이어서 작업하기 위한 현재 상태 기록. 프로젝트 전체 스펙/결정은 [PROJECT.md](./PROJECT.md) 참고.

마지막 업데이트: 2026-06-07

---

## 오늘 한 일

1. **프로젝트 노선 확정** — Post Connector를 멀티유저 제품이 아니라 **혼자 쓰는 로컬 도구**로 진행하기로 결정. 이에 따라 DB / BullMQ 큐 / GitHub OAuth 앱 전부 범위에서 제외.

2. **AI 인증을 구독 기반으로 전환**
   - 기존 `@anthropic-ai/sdk` (API 키) → `@anthropic-ai/claude-agent-sdk` (`query()`, 구독 OAuth)로 교체
   - `claude setup-token`으로 발급한 `CLAUDE_CODE_OAUTH_TOKEN` 사용 (`ANTHROPIC_API_KEY`는 반드시 unset — 우선순위가 더 높아서 설정돼 있으면 구독 토큰이 안 먹힘)
   - `src/core/ai-generator.ts` 전면 재작성 (`query()` 기반 one-shot: `maxTurns:1`, `allowedTools:[]`, `settingSources:[]`)

3. **프롬프트 조립 책임 통일 (A안)** — 조립은 `ai-generator.ts`에 집중. 어댑터 인터페이스에서 `generatePrompt()` 제거 (`src/types.ts`).

4. **실행 트리거 = CLI** — `src/cli.ts` 신규. `pnpm generate <repo-url> [adapter-id]` (기본 `github-readme`). 웹 UI는 나중으로 보류.

5. **github-readme 어댑터** — `validate()` 구현, 프롬프트 파일 검증 완료. **end-to-end 동작 확인됨** (실제 레포로 README 마크다운 콘솔 출력 성공).

6. **github-pages-portfolio 어댑터 (생성 슬라이스)** — 신규 폴더 생성, 항목 생성 + 콘솔에 TS 객체 리터럴 출력까지 완성. 리뷰 통과. (게시는 아직 안 함)
   - 환경 정리: `.env.example`에서 안 쓰는 항목(`GITHUB_CLIENT_ID/SECRET`, `REDIS_URL`) 제거.

---

## 현재 상태 (무엇이 되고 무엇이 안 되나)

| 항목 | 상태 |
|---|---|
| GitHub 데이터 수집 (`github-fetcher.ts`) | ✅ 완성 (이전부터) |
| ai-generator (구독 인증, query 기반) | ✅ 완성 |
| CLI `pnpm generate` | ✅ 동작 |
| github-readme 생성 | ✅ 동작 확인됨 |
| github-readme **게시(PR)** | ❌ 미구현 |
| github-pages-portfolio 생성 | ✅ 완성 (리뷰 통과, **사용자 라이브 확인 전**) |
| github-pages-portfolio **게시(PR)** | ❌ 미구현 (다음 작업) |
| 블로그 / LinkedIn / Handshake 어댑터 | ❌ 미착수 |
| 보충 입력(problemSolved 등) 수집 | ❌ CLI가 빈 `{}` 전달 중 |

---

## ⚠️ 다음 세션 시작 시 주의 — 포트폴리오 구조 변경 예정

사용자가 **포트폴리오 사이트 구성 자체를 바꿀 예정**이라고 함. 현재 어댑터는 아래 구조에 맞춰져 있으니, 구조가 바뀌면 **재조정 필요**:
- 대상: `Git-Mere/Git-Mere.github.io`, 브랜치 `main`
- 파일: `src/data/projects.ts` 의 `projects` 배열에 객체 추가
- 항목 필드: `title, tagline, description, image, imageAlt, tags[]`, 선택 `liveUrl/githubUrl/archiveUrl`
- 이 정보는 `src/adapters/github-pages-portfolio/config.json` + `schema.json` + `prompt-base.md`에 박혀있음 → 구조 바뀌면 이 3개 + CLI의 머지/포맷 로직 점검.

---

## 다음 할 일 (우선순위 순)

1. **(사용자 대기) 포트폴리오 새 구조 확정** → config.json/schema/prompt-base 업데이트
2. **포트폴리오 게시(2단계)** — `projects.ts` 배열에 TS 객체 삽입 + `Git-Mere.github.io`에 **PR 생성** (Octokit). 게시 방식은 PR로 합의됨. 삽입 로직은 JSON이 아니라 TS 소스라 텍스트 삽입 주의 (배열 닫는 `]` 앞에 삽입 등).
3. **README 게시(PR)** — 동일한 Octokit PR 패턴 재사용 (기존 README 덮어쓰기 금지, 새 브랜치+PR).
4. (이후) 블로그 어댑터, 보충 입력 CLI 옵션, 웹 UI.

---

## 실행 방법 (셋업)

```bash
# 1) 구독 OAuth 토큰 발급
claude setup-token            # 출력 토큰을 .env 의 CLAUDE_CODE_OAUTH_TOKEN 에

# 2) .env 설정
#   CLAUDE_CODE_OAUTH_TOKEN=<토큰>
#   GITHUB_TOKEN=<fine-grained PAT: Contents R/W, Pull requests R/W, Metadata R>
#   ANTHROPIC_API_KEY 는 반드시 비워둘 것

pnpm install
pnpm generate https://github.com/<owner>/<repo>                       # README
pnpm generate https://github.com/<owner>/<repo> github-pages-portfolio  # 포트폴리오 항목(콘솔 출력)
pnpm typecheck
```

---

## 작업 방식 (팀)

3역할로 진행 중: **디렉터**(메인, Opus) / **코더**(Sonnet) / **리뷰어**(Sonnet). 코더가 작성 → 디렉터가 리뷰어에 전달 → 이상 시 코더 반려, 통과 시 디렉터 보고.

## 정리 대상 메모 (남은 부채)
- `package.json`에 `bullmq`, `ioredis` 아직 남아있음 (큐 안 쓰기로 했으니 정리 가능). `src/core/publish-queue.ts`는 스텁 — BullMQ 안 쓰는 방향으로 재작성/제거 예정.
- `src/api/server.ts`는 `/health`만 있는 스텁 (웹 UI 보류 상태).
