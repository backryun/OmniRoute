# backryun/OmniRoute 포크 코드 리뷰

검토일: 2026-08-31  
대상: [backryun/OmniRoute](https://github.com/backryun/OmniRoute) (upstream [diegosouzapw/OmniRoute](https://github.com/diegosouzapw/OmniRoute)의 공개 포크)  
기본 브랜치: `release/v3.8.51` @ `b7a0c541394e89c32e30d3d9f1408c2388a89afe`  
리뷰 기준: 포크에만 있는 커밋/파일. upstream 전체 8000+ 커밋은 범위 밖.

이 문서는 실행 가능한 리뷰다. 프로젝트를 다시 쓰지 않았고, 드라이브바이 리팩터도 하지 않았다.

---

## 1. 한 줄 결론

**기본 브랜치는 upstream과 byte-identical이다.** 포크만의 변화는 열린(또는 미제출) 토픽 브랜치 15커밋에 있다. Critical 결함은 확인되지 않았다. 지금 고칠 가치 있는 문제는 **ChatGPT Web Codex의 Pro 자동 승인 확대**와 **clean-room `chatgpt-web` 복원의 헬스 프로브 오탐**이다.

---

## 2. 검증 방법 (가정하지 않음)

직접 확인한 사실만 적는다.

| 확인 | 결과 |
| --- | --- |
| 포크 기본 브랜치 | `release/v3.8.51` |
| upstream 기본 브랜치 | `release/v3.8.51` |
| `origin/release/v3.8.51` vs `upstream/release/v3.8.51` | ahead 0 / behind 0, SHA 동일 |
| 포크 브랜치 10개 | 아래 표 |
| GitHub `author:backryun` on default | 이미 squash-merge된 업스트림 기여 (얕은 clone에서 `--no-mailmap --author=bakryun0718` → **31커밋**, “~35커밋” 관측과 일치) |
| 메일맵 주의 | `Xiangzhe <bakryun0718@proton.me>` 는 메인테이너 세션 오귀속이며 backryun 기여가 아님 (`.mailmap`) |

고유 델타(upstream `release/v3.8.51`에 없는 커밋):

| 브랜치 | unique | upstream PR | 성격 |
| --- | ---: | --- | --- |
| `codex/refresh-chatgpt-web-codex-v4` | 2 | [#12181](https://github.com/diegosouzapw/OmniRoute/pull/12181) open | ChatGPT Web Codex 로컬 툴 왕복 |
| `codex/restore-chatgpt-web-cleanroom` | 3 | **없음** | 폐기된 `chatgpt-web` 복원 |
| `codex/urgent-dev-bundler-phase-2` | 1 | [#12076](https://github.com/diegosouzapw/OmniRoute/pull/12076) open, deferred-v3.8.52 | root layout DB 격리 |
| `codex/urgent-dev-bundler-phase-3` | 2 | [#12078](https://github.com/diegosouzapw/OmniRoute/pull/12078) open, deferred-v3.8.52 | credential refresh 추출 |
| `codex/urgent-dev-bundler-phase-4` | 1 | [#12079](https://github.com/diegosouzapw/OmniRoute/pull/12079) open | logger HMR / shutdown |
| `codex/urgent-dev-bundler-phase-4b` | 1 | [#12081](https://github.com/diegosouzapw/OmniRoute/pull/12081) open | batch dispatch HTTP화 |
| `codex/project-hygiene-cleanup` | 1 | [#11950](https://github.com/diegosouzapw/OmniRoute/pull/11950) open, deferred-v3.8.52 | 도달 불가 코드 삭제 |
| `codex/eliminate-gemini-3-5-flash` | 4 | [#11259](https://github.com/diegosouzapw/OmniRoute/pull/11259) open | ESLint 10 + 런타임 갱신 |
| `chore/bank-ratchet-v3.8.51` | 1 | 없음 | github-actions, **behind 63** — 리뷰 제외 |

게이트웨이 경로(라우팅/폴백, 인증/시크릿, rate limit, 캐시, 프로바이더 어댑터)는 unique diff만 읽었다. 스타일/취향은 적지 않았다.

---

## 3. 포크가 실제로 바꾸는 것

기본 브랜치를 체크아웃하면 **OmniRoute v3.8.51 tip과 같다.** 이미 머지된 backryun 기여(모델 카탈로그 갱신, Electron 패키징, TS7 계약, Z.ai web, xAI 통합 등)는 upstream의 일부이므로 여기서 재리뷰하지 않는다.

포크에만 있는 제품 변화는 두 갈래다.

1. **ChatGPT Web Codex (#12181)** — 이미 upstream에 있는 `chatgpt-web-codex`를 크게 고친다. tunnel-client 0.0.13, 커넥터 이름 `Codex Native2`, headed Chrome, Pro 포함 로컬 툴, `previous_response_id` 보존. vendor `codex-chatgpt-web`에 +13k/−2k.
2. **ChatGPT Web clean-room (PR 없음)** — 의도적으로 폐기된 공통 `chatgpt-web`을 Playwright storage-state + first-party `/f/conversation` 경로로 다시 넣는다. `cgpt-web` 레거시는 계속 410.

나머지는 개발 서버 메모리(#12074 phase 2–4b), 죽은 UI 삭제(#11950), ESLint 10(#11259)이다. 게이트웨이 런타임 의미는 phase 3 credential refresh가 가장 민감하고, 그 추출은 **의미 보존**으로 확인됐다.

---

## 4. 심각도별 이슈

### Critical

없음. 인증 우회, 시크릿 평문 커밋, 공유 폴백/서킷브레이커를 깨는 광역 버그는 unique diff에서 확인되지 않았다.

---

### High

#### H1. Pro 경로까지 로컬 툴 자동 승인 — 업스트림 안전장치를 제거함

- **파일:** `open-sse/executors/chatgpt-web-codex.ts` (브랜치 `codex/refresh-chatgpt-web-codex-v4`, 약 221–226행)
- **무엇이 잘못인가:** upstream tip은 이렇게 제한한다.

```ts
headed: false,
localToolsEnabled: !route.pro && hasTools,
autoApproveToolCalls: !route.pro && hasTools,
```

고유 브랜치는 이렇게 바꾼다.

```ts
headed: CHATGPT_WEB_CODEX_RUNTIME_HEADED, // true
localToolsEnabled: hasTools,
autoApproveToolCalls: hasTools,
```

`autoApproveToolCalls` 는 headed 워커가 ChatGPT의 “Allow once”를 대신 클릭하게 한다. `codex_exec` / `codex_apply_patch` 가 로컬 맥/호스트에서 돈다.

- **왜 중요한가:** 이것은 기능이 아니라 **권한 확대**다. Pro 계정은 더 강한 모델과 더 긴 툴 루프를 쓴다. OmniRoute가 루프백 밖(터널, LAN, VPS)에서 열려 있고 이 커넥션이 살아 있으면, ChatGPT 클라우드 커넥터가 호스트 셸에 닿는다. doctor 엔드포인트만 `LOCAL_ONLY`이고 `/v1/responses` 자체는 아니다. 문서(`docs/providers/CHATGPT_WEB.md`)에 의도라고 적혀 있지만, 업스트림이 두었던 Pro 수동 승인 게이트가 사라졌다.
- **고치는 방법:** 기본값을 업스트림과 같이 `autoApproveToolCalls: hasTools && !route.pro` 로 되돌리거나, `providerSpecificData.autoApproveToolCalls` / env 플래그로 **명시 opt-in** 하라. 기본 on은 위험하다. 게이트웨이를 노출하는 배포라면 이 프로바이더를 local-only로 분류하는 것도 검토.

#### H2. clean-room `chatgpt-web` 이 일반 web-cookie 헬스 스윕에 들어가 자격 증명을 잘못 보낸다

- **파일:**
  - `src/shared/constants/providers/web-cookie.ts` (새 `chatgpt-web` 항목)
  - `src/lib/tokenHealthCheckWebCookie.ts` 45–54, 98–104행
  - `src/lib/providers/validation/webCookie.ts` 115–122, 147–150행
  - `src/lib/providers/validation/transport.ts` `WEB_COOKIE_PROVIDERS_WITHOUT_MODELS_API` (chatgpt-web 없음)
  - `open-sse/config/providers/registry/chatgpt-web/index.ts` (`baseUrl: "https://chatgpt.com"`)
- **무엇이 잘못인가:** 복원된 `chatgpt-web` 은 Playwright **storage-state JSON** 을 받는다. 배경 스윕은 `isWebCookieHealthProbeCandidate()` → `validateWebCookieProvider()` 로 간다. 그 프로브는 `apiKey` 전체를 `Cookie:` 헤더에 넣고 `https://chatgpt.com/models` 를 친다. `chatgpt-web` 은 `WEB_COOKIE_PROVIDERS_WITHOUT_MODELS_API` 에 없어서, 401/403이 아니면 `{ valid: true }` 다. SPA/마케팅 200이면 만료 세션도 healthy로 남는다. `providerSpecificData.storageState` 만 있는 커넥션은 `readCredential()` 이 빈 문자열을 보고 **한 번도 검사하지 않는다.**
- **왜 중요한가:** 잘못된 포맷의 세션 JSON이 주기적으로 업스트림으로 나가고, 대시보드는 죽은 세션을 계속 active로 보여 준다. 실제 요청이 실패하기 전까지 폴백/계정 선택이 그 커넥션을 고른다.
- **고치는 방법:** `chatgpt-web` 을 `WEB_COOKIE_PROVIDERS_WITHOUT_MODELS_API` 에 넣거나, 스윕에서 제외하고 `validateChatGptWebProvider` / 구조 검사만 돌려라. `readCredential()` 이 storage-state를 쿠키 헤더로 쓰지 않게 하라. (참고: 같은 `/models`+Cookie 패턴은 이미 upstream의 `chatgpt-web-codex` 에도 있다. 이번 브랜치는 **새 프로바이더를 그 구멍에 추가**한다.)

---

### Medium

#### M1. MCP invoke 실패가 턴 전체를 revoke 한다

- **파일:** `open-sse/vendor/codex-chatgpt-web/adapters/chatgpt-web/mcp-server.ts` 267–279행 (`codex/refresh-chatgpt-web-codex-v4`)
- **무엇이 잘못인가:** `invoke` 의 catch가 timeout·취소·브로커 블립을 가리지 않고 `release` 를 호출한다. 브로커는 바인딩만이 아니라 **턴 토큰**을 폐기한다.
- **왜 중요한가:** 90초 MCP 한도나 느린 `codex_exec` 한 번이면 같은 ChatGPT 응답의 이후 툴 호출이 전부 “turn already finished”로 죽는다. 멀티툴 턴의 복원력이 떨어진다.
- **고치는 방법:** 클라이언트 disconnect/명시 cancel 에서만 턴을 폐기하고, timeout 에서는 해당 `callId` 만 버려라. 브라우저 턴이 살아 있으면 재-`claim` 을 허용하라.

#### M2. headed Chrome이 기존 `--no-sandbox` 경로를 강제한다

- **파일:** `open-sse/services/browserPool.ts` 255–267행, `open-sse/utils/chatgptWebExecutorAdapter.ts` 326–334행 (`codex/restore-chatgpt-web-cleanroom`)
- **무엇이 잘못인가:** `--no-sandbox` 자체는 upstream browserPool에 이미 있다. unique 변경은 clean-room이 `headless: false` 를 강제해 **로그인한 ChatGPT 탭을 sandbox 없는 headed Chrome** 으로 띄운다는 점이다. Codex v4도 `CHATGPT_WEB_CODEX_RUNTIME_HEADED = true` 로 같은 방향으로 간다.
- **왜 중요한가:** 공유 VPS/멀티테넌트에서 렌더러 타협 시 폭발 반경이 커진다. anti-bot 때문에 headed가 필요하더라도, 그건 로컬 워크스테이션 전제에 가깝다.
- **고치는 방법:** 문서를 local-only로 못 박고, 비루프백 배포에서는 기본 거절하거나 전용 UID/네임스페이스를 요구하라. `--no-sandbox` 를 환경 게이트 뒤로 숨기는 것은 별 PR.

#### M3. clean-room 브라우저 컨텍스트를 반납하지 않는다

- **파일:** `open-sse/utils/chatgptWebExecutorAdapter.ts` 318–345행
- **무엇이 잘못인가:** `acquireBrowserContext()` 만 있고 `releaseBrowserContext()` 가 없다. 키는 `connectionId + storageState` 해시라 계정 간 쿠키 섞임은 없다. 컨텍스트는 TTL(약 10분)까지 headed 프로필+쿠키를 메모리에 둔다.
- **왜 중요한가:** 계정/로테이션이 많으면 headed Chrome이 쌓인다. 유휴 세션 평문이 프로세스에 남는다.
- **고치는 방법:** 턴 종료 후 release 하거나, chatgpt-web 전용 짧은 TTL/최대 컨텍스트 수를 두라.

#### M4. phase-4 `run-next.mjs` 가 SIGHUP cleanup을 놓친다

- **파일:** `scripts/dev/run-next.mjs`, `src/lib/gracefulShutdown.ts` (`codex/urgent-dev-bundler-phase-4`)
- **무엇이 잘못인가:** 러너가 `globalThis.__omnirouteCustomServerOwnsShutdown = true` 를 세워 `initGracefulShutdown()` 이 **시그널 핸들러를 등록하지 않는다.** `run-next.mjs` 는 `SIGINT`/`SIGTERM` 만 받는다. #8045 가 고친 Windows 콘솔 종료(`SIGHUP` → WAL 체크포인트)가 `npm run dev` 경로에서 빠진다.
- **왜 중요한가:** 프로덕션 `next start` 는 기존대로 SIGHUP을 받는다. 깨지는 것은 Windows/dev. 다만 OmniRoute 개발자는 Windows를 쓰고, WAL이 남으면 다음 기동이 고통스럽다.
- **고치는 방법:** `run-next.mjs` 에 `process.on("SIGHUP", () => void shutdown("SIGHUP"))` 를 추가하거나 거기서 `requestGracefulShutdown("SIGHUP")` 를 호출하라. 테스트 `graceful-shutdown-sighup-8045` 에 이 경로를 넣라.

#### M5. phase-4b 배치가 in-process 핸들러 대신 루프백 HTTP에 의존한다

- **파일:** `src/lib/batches/dispatch.ts` (`codex/urgent-dev-bundler-phase-4b`)
- **무엇이 잘못인가:** 인증 우회는 아니다 (`Authorization` 유지, `redirect: "error"`). 하지만 배치는 이제 `http://127.0.0.1:${dashboardPort}${basePath}${endpoint}` 가 살아 있어야 한다. 예전에는 리스너 없이 라우트 `POST` 를 직접 불렀다.
- **왜 중요한가:** 기동 레이스, 잘못된 `DASHBOARD_PORT` / `OMNIROUTE_BASE_PATH` 에서 배치가 통째로 실패한다. 단위 테스트는 `globalThis.fetch` 를 목한다.
- **고치는 방법:** 실제 루프백 포트에 대한 통합 스모크를 추가하고, 리스너가 없으면 명확한 에러를 내라. 의도가 번들 그래프 차단이라면 그 제약을 문서화하라.

#### M6. 폐기된 unofficial ChatGPT Web을 PR 없이 복원함

- **파일:** `src/shared/constants/chatgptWebRetirement.ts`, `src/lib/db/migrations/171_restore_chatgpt-web_cleanroom.sql`, 신규 `open-sse/utils/chatgptWeb*.ts`
- **무엇이 잘못인가:** migration 168은 `chatgpt-web` 과 `cgpt-web` 을 같이 폐기했다. 이 브랜치는 공통 id만 살리고 레거시 `cgpt-web` 은 막는다. upstream에 열린 PR이 없다.
- **왜 중요한가:** 폐기는 provenance/비공식 브라우저 자동화 때문이다. 포크에서 이 브랜치를 기본으로 쓰면, 문서화된 폐기 계약과 다른 게이트웨이가 된다. 코드 버그라기보다 **제품/운영 분기**다.
- **고치는 방법:** 의도가 기여라면 #12181 과 별개 PR로 올리고 폐기 이유를 반박하라. 개인 실험이라면 기본 브랜치에 합치지 말고, H2/M2/M3 를 먼저 고쳐라.

---

### Low

#### L1. `Codex Native2` 강제 — 기존 커넥터는 죽는다

- **파일:** `src/shared/constants/chatgptWebCodex.ts`, `docs/providers/CHATGPT_WEB.md`
- **내용:** `OmniRoute Codex` / `Codex Native` 를 거부한다. ChatGPT가 커넥터 identity로 MCP 계약을 캐시하기 때문이라고 문서화되어 있다.
- **조치:** 대시보드/릴리즈 노트에 “커넥터를 새로 만들 것”을 한 줄로 명시. 동작 자체는 일관되다.

#### L2. `previous_response_id` 텍스트 폴백이 공유 `checkFallbackError` 에 있다

- **파일:** `open-sse/services/accountFallback.ts` 1681–1693행
- **내용:** `structuredError.code === "invalid_previous_response_binding"` 이 주 경로라 안전하다. `status === 409 && /previous_response_id does not belong/i` 는 다른 프로바이더가 같은 문구를 주면 폴백을 끈다. 가능성은 낮다.
- **조치:** 구조화 코드만 매칭하라.

#### L3. clean-room 저장 시 검증과 런타임 자격 증명 경로가 다르다

- **파일:** `src/lib/providers/validation/chatgptWeb.ts` vs `chatgptWebExecutorAdapter.ts` `readStorageState()`
- **내용:** 검증기는 `apiKey` 만 본다. 런타임은 `providerSpecificData.storageState` 도 받는다.
- **조치:** 검증기에 런타임과 같은 resolver를 쓰라.

#### L4. first-party 에셋 `fetch` 에 `pinDns` 가 없다

- **파일:** `open-sse/utils/chatgptWebFirstParty.ts` `requireChatGptAssetUrl` + raw `fetch(url)`
- **내용:** origin을 `https://chatgpt.com/cdn/assets/*.js` 로 제한한다. 첨부 다운로드는 `public-only`+`pinDns` 를 쓴다. 에셋 쪽만 DNS 핀이 없다.
- **조치:** 같은 outbound helper를 쓰라.

#### L5. hygiene이 quota snapshot 테스트를 삭제한다

- **파일:** `src/lib/db/__tests__/quotaSnapshots.test.ts` (약 590행), `src/app/api/settings/__tests__/settings.test.ts`
- **내용:** 이 브랜치에서 삭제된 대시보드/유틸 파일의 **남은 import는 없다** (owner가 #11950에서 요구한 확인). settings 페이지는 이미 탭 라우트로 redirect. `secretMask.ts` 는 `@/mitm/maskSecrets` 재export라 마스킹은 약해지지 않는다. 손실은 테스트 커버리지다.
- **조치:** 가치 있는 assertion을 `tests/unit/` 로 옮긴 뒤 머지하라. 큰 삭제 PR은 지금처럼 dedicated 리뷰가 맞다.

#### L6. Alibaba free-tier `validUntil` 날짜가 그날 UTC 끝까지 유효하다

- **파일:** `open-sse/services/alibabaFreeTierAllowlist.ts` (`codex/eliminate-gemini-3-5-flash`)
- **내용:** `YYYY-MM-DD` 만 있으면 `T23:59:59.999Z` 로 파싱한다. 자정 UTC에 만료되던 팩이 최대 ~24시간 더 산다. 테스트가 있다.
- **조치:** 의도라면 CHANGELOG 한 줄. 아니면 기존 `Date.parse` 를 유지.

---

### Nit

- #12181 PR 본문의 “Made with Cursor” 는 이 저장소 Hard Rule #16 (AI  gener 표기 금지)에 걸린다. 업스트림 PR에서 빼라.
- vendor `browser-worker.ts` 한 파일에 수천 행이 추가된다. 동작 버그는 아니지만 리뷰/백포트가 거의 불가능하다. 다음 갱신 때 모듈을 나눠라.
- `chore/bank-ratchet-v3.8.51` 은 63커밋 뒤처진 actions 커밋이다. 지우거나 리베이스하라.
- ESLint 10 PR(#11259) 제목 `eliminate-gemini-3-5-flash` 는 내용(deps/ESLint)과 다르다. 제목을 고쳐라.

---

## 5. 게이트웨이 경로 — unique diff만

| 경로 | unique에서 본 것 | 판정 |
| --- | --- | --- |
| 라우팅 / 폴백 | `accountFallback` 에 `invalid_previous_response_binding` → no fallback, no cooldown, skip breaker. `responsesStatePolicy` / `chat.ts` 가 `chatgpt-web-codex` 만 `previous_response_id` 보존. | 범위가 좁고 테스트가 있다. **안전.** H1의 툴 라우팅과는 별개. |
| 인증 / 시크릿 | Codex: 쿠키→검증된 storage-state, 로그 해시/redact, 터널 체크섬 핀, 에러는 `sanitizeErrorMessage`/`buildErrorBody`. clean-room: H2. | Codex 쪽 시크릿 처리는 견고. **H2만 실버그.** |
| Rate limit | unique 브랜치가 공유 limiter를 바꾸지 않는다. 429 문자열 → 계정 폴백은 clean-room adapter에 있다. | 새 구멍 없음. |
| 캐시 | hygiene이 쓰이지 않는 `CacheStatsCard` 만 지운다. 시맨틱 캐시 코어는 그대로. | 런타임 캐시 회귀 없음. |
| 프로바이더 어댑터 | Codex vendor 대량 갱신 + clean-room first-party. phase 3 refresh resolver. | H1, M1, M2, M3. phase 3는 의미 보존. |
| Rate-limit / quota UI | `RateLimitStatus` 등 삭제는 죽은 컴포넌트. `/api/rate-limits` 와 `rateLimitManager` 는 남는다. | API는 유지. |

---

## 6. 브랜치별 짧은 판정

### `codex/refresh-chatgpt-web-codex-v4` (#12181) — 가장 중요한 unique 제품 변경

로컬 Codex 툴 왕복을 실제로 복원한다. 공유 폴백/state 정책 패치는 프로바이더 스코프가 맞다. 머지 전에 **H1, M1, L1** 을 커밋하라. vendor 덩어리는 리뷰 비용이 크다. 라이브 검증(`/Users/backryun/OmniRoute` 에서 `pwd`)은 로컬 워크스테이션 전제다.

### `codex/restore-chatgpt-web-cleanroom` — PR 없음

가장 큰 “포크 전용 제품” 브랜치다. first-party URL 가드와 첨부 SSRF 가드는 괜찮다. **H2를 고치기 전에는 쓰지 마라.** M2/M3/M6.

### `codex/urgent-dev-bundler-phase-2` (#12076)

`getRootLayoutSettings()` 는 기존 DB만 읽고 `getDbInstance()` 를 부르지 않는다. 테스트가 경계를 고정한다. **게이트웨이 안전. 머지 가능** (owner가 다른 phase와 묶어 보려 함).

### `codex/urgent-dev-bundler-phase-3` (#12078)

`refreshAndUpdateCredentials` 의미를 유지한 채 resolver 추출. 커스텀 `needsRefresh`/`refreshCredentials` 전 실행기가 레지스트리에 있는지를 테스트가 강제한다. instrumentation이 `open-sse` 배럴 대신 `proxyFetch` 만 로드한다. **게이트웨이 핵심인데 깨끗하다.**

### `codex/urgent-dev-bundler-phase-4` (#12079)

로거 HMR 싱글톤 + redact는 문제 없다. **M4(SIGHUP)만 고치면 된다.**

### `codex/urgent-dev-bundler-phase-4b` (#12081)

인증 스키프 없음. **M5** 는 운영 결합이다.

### `codex/project-hygiene-cleanup` (#11950)

이 브랜치에서 삭제 파일의 잔존 import는 없다. owner가 이미 dedicated 리뷰로 미뤘다. **L5.** 서두르지 마라.

### `codex/eliminate-gemini-3-5-flash` (#11259)

ESLint 10 이관은 `no-explicit-any` 를 약화하지 않는다. **L6** 만 동작 변경. 제목을 고쳐라.

---

## 7. 권장 순서

1. #12181: H1 플래그/기본값 복구, M1 timeout≠turn-revoke, L1 마이그레이션 문구, Cursor 푸터 삭제.
2. clean-room을 살릴 생각이면: H2를 먼저 고치고, 별도 PR로 올려 폐기를 명시적으로 뒤집으라. 아니면 브랜치를 기본에 합치지 마라.
3. #12078(phase 3)은 게이트웨이 관점에서 가장 깨끗한 urgent PR이다. #12076도 안전. #12079는 SIGHUP 한 줄. #12081은 루프백 스모크.
4. #11950, #11259 는 품질/툴링. 런타임 고치기 전에 급하지 않다.

프로덕션 소스에는 손대지 않았다. 여기서 고칠 만큼 작고 확실한 버그는 리뷰 브랜치에 넣는 것보다 해당 PR에 설명하는 편이 안전하다 (H1/H2는 동작 선택이 있고, M4는 다른 브랜치에 있다).
