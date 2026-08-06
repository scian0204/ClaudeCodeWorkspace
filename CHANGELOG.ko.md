<div align="center">

[English](CHANGELOG.md) · **한국어**

# 업데이트 노트

[DESIGN.md](DESIGN.md) 스펙 확정(2026-07-20)부터 **v1.11.0**(2026-08-06)까지 — 커밋 **236개** 전수 기록.
각 항목 끝의 해시로 원 커밋을 찾을 수 있다.

</div>

---

## 목차

- [타임라인](#타임라인)
- [v1.11.0](#v1110--2026-08-06-cdc60ff) · [v1.10.0](#v1100--2026-08-05-b245db9) · [v1.9.1](#v191--2026-08-05-1984531) · [v1.9.0](#v190--2026-08-05-6b9b4ca)
- [v1.8.0](#v180--2026-08-04-1c9a70c) · [v1.7.0](#v170--2026-08-04-94f9791) · [v1.6.0](#v160--2026-08-04-d7af8ef) · [v1.5.0](#v150--2026-08-04-17a1e3a) · [v1.4.0](#v140--2026-08-03-5e7a59b)
- [v1.3.1](#v131--2026-08-03-0f736c0) · [v1.3.0](#v130--2026-07-31-68e920c) · [v1.2.0](#v120--2026-07-31-de73205) · [v1.1.1](#v111--2026-07-31-6d2d8c5) · [v1.1.0](#v110--2026-07-31-8d01636)
- [초기 개발 (2026-07-20 → 07-31)](#초기-개발--2026-07-20--07-31)
- [설계 원본과의 차이](#설계-원본과의-차이)

---

## 타임라인

| 버전 | 날짜 | 커밋 | 요약 |
|---|---|---|---|
| [v1.11.0](#v1110--2026-08-06-cdc60ff) | 2026-08-06 | 3 | 실시간 thinking/토큰 미터, 마크다운 지원 확장형 입력창, 클립보드 폴백 |
| [v1.10.0](#v1100--2026-08-05-b245db9) | 2026-08-05 | 3 | 작업(Tasks) 패널 — 서브에이전트·백그라운드 셸·워크플로 |
| [v1.9.1](#v191--2026-08-05-1984531) | 2026-08-05 | 3 | root에서 bypass 모드 사망, resume id 유실 수정 |
| [v1.9.0](#v190--2026-08-05-6b9b4ca) | 2026-08-05 | 12 | 관리자 셀프 업데이트, Git diff·히스토리 그래프, pull, Docker 상태 진단, 마이페이지 탭 |
| [v1.8.0](#v180--2026-08-04-1c9a70c) | 2026-08-04 | 3 | 설명 + 실행까지 하는 플로팅 가이드 에이전트 |
| [v1.7.0](#v170--2026-08-04-94f9791) | 2026-08-04 | 11 | 시그니처 대기 애니메이션, 프로젝트별 대화 묶음, 자가 구성 우클릭 메뉴, 웹훅 PR 리뷰, 커스텀 브랜딩, 스킬 사용량 |
| [v1.6.0](#v160--2026-08-04-d7af8ef) | 2026-08-04 | 12 | 가져오기 중복 처리, git init & 원격 게시, remote 관리, 수동 이름 짓기 |
| [v1.5.0](#v150--2026-08-04-17a1e3a) | 2026-08-04 | 4 | 모델 목록 자동 수집, 5시간 한도 자동 재개, 창 선점 |
| [v1.4.0](#v140--2026-08-03-5e7a59b) | 2026-08-03 | 17 | 통합 검색(Ctrl/Cmd+K), 단축키, 전용 우클릭 메뉴, 세션 이름 자동 생성, 사이드바 접기 |
| [v1.3.1](#v131--2026-08-03-0f736c0) | 2026-08-03 | 2 | 프라이버시 마스터 스위치가 하위 토글을 덮어쓰고 잠금 |
| [v1.3.0](#v130--2026-07-31-68e920c) | 2026-07-31 | 2 | 비필수 전송 채널별 토글(9개) |
| [v1.2.0](#v120--2026-07-31-de73205) | 2026-07-31 | 12 | 비필수 Anthropic 전송 기본 차단, README 대폭 개편(완전 로컬 스택·권장 사양·TOC) |
| [v1.1.1](#v111--2026-07-31-6d2d8c5) | 2026-07-31 | 3 | 멀티아치(amd64/arm64) buildx, Docker Hub 개요 페이지 |
| [v1.1.0](#v110--2026-07-31-8d01636) | 2026-07-31 | 4 | 릴리스 파이프라인 + Docker Hub 배포, 단독 compose, 네트워크 자동 생성 |
| [초기 개발](#초기-개발--2026-07-20--07-31) | 07-20 → 07-31 | 144 | P0–P5 골격 · LLM Wiki · 유저별 토큰 · git · PR 리뷰 자동화 · 관리자 설정 · 세션 가져오기 · DM |

---

## v1.11.0 — 2026-08-06 (`cdc60ff`)

- **실시간 thinking / 토큰 미터 + 확장형 입력창 + 작업 사본 (`d0aaf40`)** — 한 커밋에 네 갈래:
  - fix(copy): **모든 복사 버튼이 secure context 밖에서 죽어 있었음.** LAN IP의 평문 `http://`에는 `navigator.clipboard` 자체가 없음. `lib/clipboard.ts` 신설 — API 있으면 그걸 쓰고 없으면 selection + `execCommand('copy')` 폴백. 답변 복사·코드블록·우클릭 메뉴·웹훅 필드 전부 이 경로로, 실패 시 조용히 넘어가지 않고 실패를 알림
  - fix(chat): 메시지 편집이 **내용 변경을 요구하지 않도록** — 같은 텍스트로 재전송해도 그 지점부터 잘라내고 재생성
  - feat(chat): 턴이 지금 뭘 하는지 보고함 — extended-thinking 델타가 흐르는 동안 "Thinking…", 출력 토큰 미터가 실시간으로 오르고(문자 추정) `turn:usage`에서 SDK의 정확한 수치로 스냅
  - feat(chat): 입력창과 메시지 편집 박스가 내용에 맞춰 커지다 상한에서 스크롤. **라이브 마크다운** — 투명 textarea 뒤에 하이라이트 미러를 깔아 캐럿·IME 조합·`/`·`@` 메뉴를 건드리지 않음. 폭이 변하지 않는 스타일(색·배경·text-stroke 가짜 볼드)만 사용(안 그러면 캐럿이 글자에서 어긋남), `md.test.ts`가 "하이라이팅은 순수 가산" 불변식을 고정
- **턴별 slot / TTFT / total 타이밍 로깅 (`acc2336`)** — 전역 `maxConcurrentTurns` 캡에 막힌 턴과 CLI/모델 자체가 느린 턴을 구분할 수 없었음. 턴당 한 줄: slot(세마포어 대기), ttft(spawn+첫 출력), total, 토큰, 캡 사용률. 더불어 `finally`의 `endRunningTasks`를 가드 — 여기서 throw 나면 턴 자체 결과를 덮고 아래 샌드박스 teardown을 건너뜀

## v1.10.0 — 2026-08-05 (`b245db9`)

- **작업(Tasks) 패널 (`f1051b3`)** — 턴의 Task 툴 서브에이전트·백그라운드 셸·로컬 워크플로·MCP 모니터가 UI 어디에도 안 보였음. CLI는 이들을 `system` 메시지(`task_started`/`task_progress`/`task_updated`/`task_notification`/`background_tasks_changed`)로 보내는데 턴 스트림이 버리고 있었고, 정작 그들의 중첩 도구 호출은 메인 스레드 것과 구분 없이 표시됨.
  - `server/src/claude/tasks.ts`가 이벤트를 채팅 세션당 정렬된 목록으로 접고 변경마다 전체 목록을 broadcast(`tasks:update`, replace 시맨틱이라 엣지 하나 놓쳐도 stale running 행이 끼지 않음). `session:join`이 재생하고, `runTurn`의 finally가 남은 running을 정리(CLI 서브프로세스가 턴과 함께 죽으므로 그것이 띄운 것도 살아남을 수 없음)
  - 웹: 헤더의 "작업" pill(실시간 카운트, 작업 중 광택) → 크기 조절 가능한 우측 패널. 종류별 필터 탭, 상태, 경과 시간, 토큰/도구 호출 수, 지금 쓰는 도구, 요약/오류. 폰에서는 전체화면 오버레이. 서브에이전트 도구 호출에 `parentId`가 붙어 트랜스크립트에서 배지로 구분
  - 관리자: `taskPanelEnabled` / `taskHistoryMax` / `taskSessionsMax`
- merge: `feat/task-panel` 브랜치 병합 (`bf5598d`)

## v1.9.1 — 2026-08-05 (`1984531`)

- **fix(claude): root에서 bypass 모드가 턴을 죽이던 문제 (`67b4ff8`)** — `bypassPermissions`는 CLI의 `--dangerously-skip-permissions`로 매핑되는데, CLI가 root 프로세스에서 이를 거부함("cannot be used with root/sudo privileges"). 앱 컨테이너는 uid 0이라 bypass 모드의 모든 턴과 해당 세션의 `probeCommands`/`probeUsage`가 "process exited with code 1"로 사망. `buildOptions`가 root면 SDK 모드를 `acceptEdits`로 낮추고 `makeCanUseTool`이 bypass 모드에서 전 도구를 자동 허용 — never-prompt 동작은 유지(클래스1 경로 펜스는 그대로). 위키 컴파일 경로가 이미 쓰던 방식
- **fix(claude): 스트리밍 중 죽은 턴의 resume id 유지 (`2b8b24b`)** — `claude_session_id`를 성공 경로에서만 기록해서, 에러·인터럽트·컨테이너 재빌드로 죽은 턴은 컬럼이 null로 남음. CLI 트랜스크립트는 세션 HOME에 남아 있는데 resume할 id가 없어 다음 메시지가 새 대화로 시작 — UI는 DB의 전체 히스토리를 그리고 있어 **손실이 눈에 안 보임**. `runReal`이 CLI가 session_id를 내는 즉시 보고하고 `runTurn`이 바로 저장, session_id 캡처를 abort 체크보다 앞으로 옮겨 첫 메시지에서 멈춘 턴도 트랜스크립트를 지킴

## v1.9.0 — 2026-08-05 (`6b9b4ca`)

- **관리자 셀프 업데이트 (`e2506cd`)** — Update 탭이 실행 중 버전과 Docker Hub에 올라온 최신 semver 태그를 비교하고, 워크스페이스 안에서 워크스페이스를 갱신. 컨테이너는 자기 자신을 재생성할 수 없으므로 **새로 pull한 이미지로 띄운 일회용 헬퍼 컨테이너**가 교체를 수행:
  1. 임시 이름으로 교체본 create — 옛 컨테이너가 서비스 중일 때 create spec 전체를 검증(스펙이 틀리면 무중단)
  2. 옛 컨테이너 graceful stop + remove (SQLite 체크포인트 보장, SIGKILL 안 함)
  3. temp → 실제 이름으로 rename 후 start
  4. `selfUpdateHealthWaitMs` 동안 감시 — 죽거나 크래시 루프면 제거하고 이전 이미지로 복구
  - create spec은 자기 inspect 결과에서 재구성해 포트·마운트·env·라벨·네트워크·재시작 정책을 승계. 두 필드는 일부러 그대로 복사하지 않음: 자동 생성된 Hostname(옛 컨테이너 short id — 새 인스턴스의 self-lookup이 깨짐)과 옛 이미지 기본값을 그대로 비추는 Cmd/Entrypoint(복사하면 새 이미지가 옛 시작 명령에 고정됨). 롤백은 이미지 id가 아니라 전용 `:ccw-previous` 태그를 겨냥
  - 결과는 다음 부팅에 자기 이미지 id를 교체 전 기록과 비교해 확정 — 메모리에 아무것도 남길 필요 없음. 실패 시 헬퍼 로그를 남겨 패널이 보여줌. 패널은 다운타임 동안 폴링하다 새 버전이 응답하면 스스로 리로드
  - `GET /api/admin/update`, `POST /api/admin/update/check|apply`(관리자 전용, `selfUpdateEnabled` 게이트, pull은 앱 자기 저장소로 제한). 설정 그룹 update: `selfUpdateEnabled`·`selfUpdateAutoCheckMs`·`selfUpdateCheckTimeoutMs`·`selfUpdateHealthWaitMs`·`selfUpdateContainer`. 주기 체크는 캐시만 갱신하며 스스로 적용하지 않음. 실제 Docker로 검증(교체·롤백)
- merge: `feat/self-update` 브랜치 병합 (`80db2c6`)
- **fix(deps): vitest 미설치로 typecheck 실패 (`68b2906`)** — `images.test.ts`·`self-update.test.ts`가 `vitest`를 import 하는데 의존성에 없어 변경 내용과 무관하게 `npm run typecheck`가 "Cannot find module 'vitest'"로 실패. 루트 devDependency로 추가(런타임 이미지는 `-w server`만 설치하므로 vitest는 배포되지 않음). `test` 스크립트는 안 만듦 — 나머지 `*.test.ts`는 `npx tsx` 단독 스크립트라 repo 전체 `vitest run`이 깨짐
- **feat(docker): 데몬을 미리 probe해서 상태로 노출 (`29422de`)** — code-server·PR 리뷰 샌드박스·셀프 업데이트 세 기능이 Docker 데몬에 의존하는데 전부 **사용 시점에** raw dockerode 에러로만 실패. 기존 체크는 `DATA_VOLUME`/`CODE_SERVER_NETWORK` 설정 여부만 봐서 소켓이 없거나 데몬이 죽은 배포도 통과.
  - `lib/docker-status.ts`가 부팅 시와 `dockerProbeMs`마다 ping하고 판정을 캐시, 실패를 운영자가 조치 가능한 형태로 분류: socket-missing / denied / unreachable / unconfigured
  - 부팅 로그가 이유와 비활성 기능을 명시, `GET /api/admin/overview`에 `docker` 포함(+`POST /api/admin/docker/probe` 재검사), 관리자 Overview에 배너(이유·중단되는 기능·해결법·원문 에러·재확인 버튼), `GET /api/config`에 `dockerReady`/`dockerReason`을 실어 채팅 헤더가 split/editor 뷰를 이유 툴팁과 함께 비활성화하고 기억된 'editor' 뷰를 chat으로 되돌림, 에디터 엔드포인트 501이 이유를 명시
  - 채팅·프로젝트·위키·검색·DM은 영향 없음(배너가 명시). 이유 우선순위는 서버에만 — ping 실패가 "env 미설정"보다 우선
- **feat(web): 마이페이지를 관리자 패널처럼 탭 분할 (`c240899`)** — 9개 섹션 한 줄 스크롤 → profile / session / requests / credentials / projects. 자동화 토글 3개가 모두 꺼져 있으면 session 탭이, approvals가 꺼져 있으면 requests 탭이 숨음
- **fix(web): 입력창이 죽은 공간을 잡아먹던 문제 + 가이드 입력 정렬 (`cd0df76`)** — 플로팅 가이드 버튼이 Send를 가리지 않게 모든 입력창이 무조건 `pr-14`를 깔아, 760px 중앙 카드가 이미 런처를 비껴가는 넓은 화면에서도 56px가 낭비. `useGuideInset`이 실제로 겹치는 만큼만 측정(안 겹치면 0), 매 commit + ResizeObserver + window resize로 재측정. 가이드 패널 textarea가 20px 한 줄 박스로 32px 전송 버튼 아래에 붙던 것도 `py-1.5`로 정렬
- **feat(git): origin에서 pull + 마이페이지에서 Git 패널 열기 (`dcf5013`)** — 커밋·푸시는 되는데 fetch가 없어 원격이 앞서면 터미널 말고는 방법이 없었음. `POST /api/projects/:id/git/pull` — 기본 fast-forward 전용(남의 워크스페이스에 머지 커밋을 만들지 않음), `{ rebase: true }`면 갈라진 로컬 커밋을 위로 replay(`--autostash`로 더러운 트리도 통과). 패널에 Pull 버튼 + 리베이스 토글. 채팅에 붙이지 않은 프로젝트도 열 수 있도록 마이페이지 프로젝트 목록에 Git 버튼
- **feat(git): pull에 `--all` (`56ec8ac`)** — 평범한 pull은 현재 브랜치 upstream만 갱신해서 원격에 새로 생긴 브랜치가 안 보임. 모든 remote를 한 번에 fetch하고, `--single-branch` 클론이면 refspec을 먼저 넓힘(안 그러면 `--all`도 다른 브랜치를 못 봄). git이 refspec 옆의 `--all`을 거부하므로("fetch --all does not make sense with refspecs") upstream 없는 경우엔 전체 fetch를 별도 단계로 하고 명시적 `origin <branch>`를 유지. 패널이 마지막 줄만이 아니라 출력 꼬리를 보여줌 — `--all`에서는 `* [new branch] …` 줄이 핵심
- **feat(git): 파일별 diff + 레인으로 그린 커밋 히스토리 그래프 (`ab118bc`)** — 스테이징·푸시는 되는데 정작 변경 내용을 못 봄. 변경 목록의 파일 이름이 버튼이 되어 patch를 열고, History 섹션이 `git log --topo-order`에서 브랜치·머지·ref를 개발 라인별 색 레인으로 그림(커밋 클릭 → stat + patch). 읽기 전용 엔드포인트 `GET /git/log`·`/git/diff` 2개. 이스케이프가 아니라 **검증**으로 방어(execFile은 셸을 안 거침): 커밋은 sha 형태여야 하고(플래그나 임의 ref 불가), 경로는 절대경로·`..` 불가 — untracked는 git이 비교 대상을 못 가지므로 디스크에서 직접 읽음. 레인 배치는 plain tsx로 돌도록 `web/src/lib/gitgraph.ts`에 분리: 두 레인에서 도달한 커밋은 레인을 합침(안 그러면 끝나지 않는 선 때문에 그래프가 무한히 오른쪽으로 밀림). `gitLogMaxCount`/`gitDiffMaxKB`는 상수가 아니라 관리자 설정
- **feat(web): Git 다이얼로그 전체화면 토글 (`dea68b3`)** — 560px는 스테이징·푸시엔 충분하지만 그래프와 patch는 정확히 그게 잘리는 콘텐츠. 제목줄 버튼 하나로 96vw×94vh, 내부 박스도 함께 성장(patch 18rem→58vh, 그래프 16rem→40vh, 변경 목록 13rem→30vh). `fullscreen`/`titleExtra`는 Modal의 선택 prop이라 나머지 9개 다이얼로그는 그대로
- merge: `feat/git-diff-graph` 브랜치 병합 (`534d2db`)

## v1.8.0 — 2026-08-04 (`1c9a70c`)

- **플로팅 제품 가이드 + 실행 어시스턴트 (`ff4cd1f`)** — 우측 하단 원형 버튼이 작은 채팅 패널을 열어 설명도 하고 요청을 실행도 함. 에이전트의 도구 표면은 인프로세스 MCP 툴 **딱 2개**:
  - `api` — `app.inject()`로 이 Fastify 앱에 **호출자 자신의 세션 쿠키로** 재진입. 각 라우트가 평소의 `requireAuth`/`requireAdmin`/소유권 검사를 그대로 수행하므로 권한 규칙 사본이 존재하지 않음(UI 클릭과 동일). 여기에 allowlist(`server/src/guide/api-map`)로 더 좁힘 — **DELETE 전면 금지**, 자격증명·시크릿 라우트 금지, 관리자 인프라 동작 금지. 같은 테이블이 에이전트의 API 레퍼런스로도 렌더되며 멤버에게는 관리자 라우트가 필터링됨
  - `ui` — API가 없는 것(언어·테마·내비게이션·다이얼로그)은 그 유저의 모든 탭에 `guide:action`을 push
  - 내장 도구(Bash/Read/Write/…)는 **이중 차단**: `disallowedTools` + 위 두 툴만 허용하는 `canUseTool`
  - 스레드 상태는 `chat_sessions`가 아니라 전용 테이블(`guide_threads`/`guide_messages`)에 — `chat_sessions`의 viewer 검사는 알 수 없는 kind에서 true로 떨어지기 때문. 스트리밍은 기존 `user:<id>` 소켓 룸을 탐
  - 관리자 설정: `guideEnabled`, `guideWriteEnabled`(읽기 전용 모드), `guideModel`, `guideMaxTurns`, `guideHistoryMax`, `guideMaxInputChars`, `guideMaxToolChars`
  - ko/en 문자열, 정적 데모 패리티(제안 칩용 canned 턴 — 실제 언어 전환·세션 생성 포함), 채팅·DM 입력창에 `pr-14`로 런처가 Send를 안 가리게
- merge: `feat/guide-agent` 브랜치 병합 (`8e170e2`)

## v1.7.0 — 2026-08-04 (`94f9791`)

- **feat(ui): 모든 모델 대기에 시그니처 애니메이션(이름 생성 포함) (`f8b645b`)** — 범용 깜빡이는 점 대신 한 가지 마크로 통일: 브랜드 마크(favicon.svg)의 점 3개가 자기 clay 색조 계단을 따라 물결처럼 내려가고, 옆 라벨에 clay 광택이 흐르고, 이름 생성 호출에는 sparkle 주위로 clay 링이 회전.
  - `ClayDots`/`ClaySpark`/`ClayWait`(lib/ui.tsx) + keyframes(styles/index.css), `--clay-mid`/`--clay-pale` 토큰, reduced-motion은 정지 배지로 고정
  - 스트리밍 답변·위키 컴파일 줄·입력창 힌트·대기 턴 배너·헤더/사이드바 retitle 버튼에 적용
  - **세션 이름 짓기는 지금까지 아예 안 보였음**: auto-title/retitle/import가 호출 전후로 `session:titling {on}`을 emit해 행 제목·헤더 제목·모든 이름 버튼이 함께 대기(`store.titling` 단일 소스, finally에서 해제해 마크가 눌어붙을 수 없음)
  - 데모도 titling 이벤트 쌍을 흉내내고, `route()`가 늦게 답할 수 있어 canned 모델 호출도 대기를 보여줌
- **feat(ui): 사이드바 대화를 프로젝트별로 묶고 헤더 접기 (`5567ec4`)** — 평평한 한 목록 대신 프로젝트별(공통 → 개인 → 미지정)로 편철, 헤더로 접기(localStorage 유지). `setProject`가 세션 목록도 패치해 행이 즉시 이동
- **feat(plugins): 스킬별·유저별 사용 횟수 (`4861dae`)** — 턴이 어떤 스킬을 호출했는지 유저별로 집계해 스킬이 이미 사는 곳(플러그인 상세 모달에서 스킬 펼치기)에 노출: 워크스페이스 총합, 본인 카운트, (관리자만) 유저별 분해.
  - `skill_usage` 테이블 — (유저, 스킬 키)당 한 행 upsert. 키는 원문 그대로 기록하고 읽을 때 플러그인의 스킬과 매칭(`skillKey`가 `plugin:skill`·`plugin/skill`·맨 `skill`을 하나로 접음)
  - 호출 경로 둘 다 집계: 프롬프트 자체가 슬래시 커맨드인 경우(입력창 팔레트가 보내는 형태)와 턴 도중의 Skill/SlashCommand 도구 호출
  - `skillUsageEnabled`(기본 on)가 집계와 UI를 동시에 게이트. 삭제된 유저의 orphan 행은 리소스 정리 스윕에 합류
- **feat(ui): 우클릭 메뉴가 클릭한 요소에서 스스로 구성 (`366a986`)** — 이전엔 화면마다 손으로 배선해 4곳에만 있었음. 이제 우클릭한 대상에서 조립:
  - `mirrorRows()` — 클릭한 행/카드가 가진 컨트롤을 aria-label/title/텍스트로 DOM에서 읽어와 아이콘을 복제하고 danger 스타일을 추론. 선택하면 실제 버튼을 클릭하므로 핸들러 소유권은 화면에 남음. 형제 행은 제외 — 프로젝트 헤더가 그 아래 대화들을 삭제 제안하면 안 되므로
  - `dataRows()` — 선택 영역·입력창·링크·이미지·코드 블록·트리 행의 전체 경로 복사
  - `appRows()` — 앱 공통 동작
  - 그룹은 라벨 기준 dedup(화면 자체 행이 우선) + 구분선 축약으로 병합. 그 결과 손으로 쓴 메뉴 대부분이 죽은 코드가 됨: 채팅 메시지는 전용 메뉴를 완전히 잃고, 사이드바 행은 "열기"만 남고(뒤에 버튼이 없는 항목), 위키 주제의 관리자 전용 삭제는 중복 `isAdmin` 검사 대신 **버튼의 존재 자체**로 게이트됨
  - 길면 메뉴가 스크롤(Shift+우클릭 힌트는 고정), 메뉴 안 스크롤이 메뉴를 닫지 않음. `GroupHeader`에 빠져 있던 aria-label 추가. main에서 빨갛던 `turnSkillKeys` 블록 타입도 넓힘
- **feat(wiki): 기존 주제에 raw 소스 추가 + 편집 (`0cfb7bf`)** — 컴파일된 주제를 다시 만들지 않고 최신화. 파일 탐색기 raw/ 탭에 드롭 존(파일 또는 폴더 통째)과 기존 텍스트 소스 인라인 편집기.
  - 서버: `PUT /api/wiki/topics/:id/file`이 raw/ 텍스트 파일 하나를 제자리 저장(경로 소독, 텍스트 전용, `wikiEditMaxKB` 상한). 기존 add-sources POST는 **자동 재컴파일을 중단** — 업로드가 파일당 1요청이라 N번 컴파일이 경합해 inflight 가드가 나중 파일을 든 것들을 떨어뜨림. 클라이언트가 한 번만 재컴파일
  - 설정: `wikiSourceEditEnabled`(엔드포인트 403 + UI 숨김), `wikiEditMaxKB`
  - 웹: `FileExplorer`에 선택적 `uploadDir`/`onUpload`·`editDir`/`onSave`를 추가해 두 번째 모달 대신 기존 트리/미리보기 재사용, `WikiExplorer`가 관리자에게 배선하고 "재컴파일 필요" 바 표시. 드래그-드롭 수집을 `lib/dropfiles`로 분리(Sidebar·ImportSessionModal에 중복돼 있었고 세 번째 사본이 될 뻔)
- **feat(wiki): 사이드바 주제 행에서 소스 관리자 열기 (`675711f`)** — 탐색기가 주제의 채팅 배너에서만 열려 소스 관리하려면 스레드부터 옮겨야 했음. 이제 모든 사이드바 주제 행의 주제 삭제 옆에 폴더 버튼(관리자). 우클릭 메뉴가 자동 반영(`ctxrows`가 행의 버튼을 읽으므로)돼 터치 유저는 롱프레스로 도달
- **feat(brand): 관리자 지정 로고 + 워크스페이스 제목 (`ba7ebb6`)** — 이름과 마크가 세 군데 하드코딩돼 있었음. 관리자가 Admin → Config → Branding에서 한 번 올리면 사이드바·로그인 카드·랜딩 화면·브라우저 탭에 전원 실시간 반영.
  - `brandTitle`/`brandLogoMaxMB` 설정 키, 로고는 `<dataDir>/brand/logo.<ext>`에 저장하고 **mtime을 캐시버스트 토큰으로**(DB 컬럼 없음)
  - `GET /api/brand`·`/api/brand/logo`는 공개 — 로그인 전에도 카드가 브랜딩됨. 로고 응답에 nosniff + 잠근 CSP를 실어 **업로드된 SVG가 이 오리진에서 스크립트를 못 돌리게** 함
  - 이미지 mime/매직바이트 검증을 `lib/images.ts`로 분리해 아바타 업로드와 공유(아바타는 래스터 전용 유지 — SVG는 호출부별 opt-in)
- **feat(review): 웹훅 기반 PR 리뷰(저장소별 시크릿) (`2130a27`)** — 폴링 간격을 기다리는 대신 제공자가 PR 이벤트를 밀어 넣음. `POST /api/review/hooks/<repoId>`, 저장소별 인증은 GitHub HMAC(`X-Hub-Signature-256`) / GitLab secret-token 헤더 / Bitbucket은 `?token=`(자체 시크릿 필드가 없음). PR 이벤트만 폴링을 돌리고 댓글·push 노이즈는 200으로 무시. 관리자가 저장소 편집 다이얼로그에서 발급/회전/삭제(URL + 시크릿 복사 + 제공자별 설정 힌트). **폴 병합**도 추가: 폴 도중 도착한 요청을 버리지 않고 끝난 뒤 한 번 다시 실행 — `REVIEW_POLL_MS=0`인 웹훅 전용 배포에서는 이 구멍이 치명적
- **feat(review): 저장소별 폴링 토글 (`226aef7`)** — `REVIEW_POLL_MS=0`은 전부 아니면 전무였음. `review_repos.poll_enabled`로 개별 저장소만 인터벌 폴러가 건너뜀 — 웹훅을 건 저장소는 폴링을 멈추고, 못 건 저장소는 계속 폴링. 웹훅 수신과 수동 "지금 새로고침"은 `pollRepo`를 직접 부르므로 무관, 인터벌 틱만 플래그를 존중. 사이드바가 건너뛴 저장소를 "webhook only"로 표시
- **feat(review): 등록 시점에 웹훅+폴링 결정 (`716a1f7`)** — 웹훅이 편집 다이얼로그 전용이라 새 저장소는 항상 웹훅 없이 시작. 추가 다이얼로그에 스위치 두 개(폴링 on, 웹훅 off 기본), `createRepo`가 요청 시 시크릿 발급, 생성 직후 URL/시크릿 표시 — 호스트 설정이 필요한 바로 그 시점. `reviewWebhook`이 꺼진 상태에서 웹훅을 요청하면 조용한 다운그레이드 대신 403 거부. 공유 URL+시크릿 블록과 체크박스 행은 각각 한 컴포넌트로 통합

## v1.6.0 — 2026-08-04 (`d7af8ef`)

- **feat: 가져온 로컬 세션을 그 대화 내용으로 이름 짓기 (`cb9cb5e`)** — CLI가 이름을 안 붙인 트랜스크립트가 가져오기 피커와 결과 채팅 행에 raw uuid로 나옴. 두 층으로 해결: `listSessions`가 첫 유저 메시지의 정제된 스니펫으로 폴백(그리고 `custom`을 보고해 CLI가 지은 제목은 절대 덮지 않음), 가져오기 응답이 나간 뒤 스니펫 이름 채팅마다 새 채팅과 같은 모델 titling 패스(가져온 트랜스크립트의 앞쪽 유저 턴 몇 개를 읽음)를 돌려 `session:title`로 전달. `auto-title.ts`에 공유 `titleFor` 코어 기반 `autoTitleImported` 추가, 제목 소독기는 `lib/session-import.ts`로 이동해 양쪽이 공유. 새 설정: `importAutoTitleEnabled`, `importAutoTitleMessages`
- **feat(import): 가져온 세션 이름 짓기를 가져오기 화면의 선택으로 (`b93c07d`)** — 트랜스크립트마다 모델 호출 1회 비용이므로 그냥 일어나면 안 됨. 화면에 체크박스(유저 본인의 자동 이름 설정에서 시드), 서버는 요청이 명시할 때만 titling 패스 수행, 관리자 플래그는 선택지 제공 여부 자체를 게이트. 끄면 첫 메시지 스니펫이 이름으로 남음 — 어쨌든 raw uuid는 아님
- **fix(import): 트랜스크립트에서 CLI 배관 라인 제거 (`d105d33`)** — 가져온 세션이 raw `<local-command-caveat>` 블록으로 끝났음. CLI는 자기가 주입한 줄을 `type:"user"`로 적는데 `jsonlToMessages`가 `isSidechain`과 meta *타입*만 걸러 `isMeta` 줄이 실제 채팅 메시지로 통과. 슬래시 커맨드 래퍼와 캡처된 로컬 커맨드 stdout도 같은 경로. 모든 호출자가 지나는 한 곳에서 제거해 메시지 행과 생성 제목이 깨끗해짐. 태그 말고 남는 게 없을 때만 버리므로 그걸 인용한 진짜 메시지는 살아남음
- **fix(import): 가져온 `/clear`·`/compact`가 위 히스토리를 접도록 (`0c06e3f`)** — Chat.tsx는 유저 메시지가 `/clear`·`/compact`로 시작할 때(우리 입력창이 보내는 평범한 형태) 접는데, CLI는 같은 동작을 `<command-name>/clear</command-name><command-args>…</command-args>`로 적어 매칭 실패 — 가져온 세션엔 태그 뭉치(배관 필터 후엔 아무것도)만 남고 접힘도 없었음. 가져오기 시 슬래시 커맨드 줄을 `/name args`로 재작성. `userTexts`가 이를 건너뛰므로 커맨드가 생성 제목이 되는 일도 없음
- **feat(import): 이미 가져온 세션 표시 + 세션별 덮어쓰기/복제 (`b74f044`)** — `claude_session_id`로 `chat_sessions`를 키잉하는 곳이 없어 같은 폴더를 재가져오면 이미 가진 세션이 조용히 하나 더 복제됨. 스테이징 목록이 이 유저 소유 트랜스크립트에 `dup`을 보고하고, 피커가 배지 + 행마다 덮어쓰기/복사 추가 select를 붙임. 덮어쓰기는 기존 채팅 id를 재사용(메시지를 교체하고 새로 올린 프로젝트를 다시 가리킴)해 링크와 히스토리가 보존됨. select는 행 라벨 밖에 — 안에 있으면 모든 상호작용이 체크박스를 토글. 데모 라우터도 중복 2개 포함 목록을 시드
- **feat(import): 프로젝트도 덮어쓰기/복제 선택 (`1376bd7`)** — 프로젝트 쪽은 늘 복제라 이름 충돌이 조용히 `myproj-2` + 두 번째 projects 행이 됐고, 재가져오기하면 같은 작업 디렉터리가 두 벌. 피커가 이미 소유한 이름을 표시하고 세션 행과 같은 선택지를 제공. 덮어쓰기는 그 projects 행과 경로를 재사용하며 업로드를 **그 위에 복사** — 같은 경로 파일은 교체되고 나머지는 생존. 일부러 wipe가 아님(.git·미추적 작업·에디터 상태가 그 디렉터리에 삶). 함께 가져온 세션은 slug가 경로에서 파생되므로 기존 경로에 대해 resume
- **fix(import): 프로젝트를 업로드하는 단계에서 확정 (`fc6b082`)** — 프로젝트 이름과 덮어쓰기 선택이 `~/.claude` 폴더 고르기 뒤 마지막 단계에 있었는데 프로젝트는 트리 단계가 끝날 때 이미 업로드됨. 세션 폴더를 건너뛰면 더 나빠서, 이미 디스크에 올라간 프로젝트의 이름을 손으로 묻는 꼴. 이제 트리 단계에서 유저가 실제로 고른 폴더 이름을 프리필해서 물음(`stripRoot`가 알고도 버리던 값). 마지막 단계는 "프로젝트: x · 덮어쓰기"만 요약. 루트 폴더 이름이 없는 평면 다중 파일 드롭에서는 트랜스크립트 cwd 꼬리를 폴백으로 유지
- **feat(git): 저장소가 아닌 프로젝트 git init + 게시 (`9519395`)** — 가져온 프로젝트는 파일 뭉치라 Git 패널이 "not a git repository"로 막다른 길. 이제 두 갈래: init만, 또는 publish(init → 첫 커밋 → 등록된 자격증명으로 제공자에 저장소 생성 → push). 붙여넣은 URL은 생성을 건너뛰며, API를 모르는 제공자로 가는 유일한 경로. 저장소 생성은 `lib/git-publish.ts`(GitHub Enterprise 포함, GitLab, Bitbucket), `git-ops`에 `gitInit`/`gitHasCommits`/`gitSetOrigin` 추가 — 전부 이미 된 부분엔 no-op이라 이미 추적 중인 프로젝트를 publish 해도 히스토리를 다시 쓰지 않음. remote는 생성 성공 후에만 연결하므로 실패해도 origin이 그대로. body의 credential id는 호출자 기준으로 재검사(유저 스코프 자격증명은 소유자에게만 해석). 설정: `gitPublishEnabled`(버튼이 아니라 엔드포인트를 게이트), `gitInitBranch`
- **feat(git): 프로젝트별 remote 수동 관리 (`7dd4e90`)** — 클론이 우연히 가진 origin하고만 대화할 수 있었음. 이제 remote 목록·추가·주소 변경·삭제(기본 접힘 — 대부분 origin 하나를 아무도 안 건드림). 모든 변경이 갱신된 목록을 반환하고 패널 상태를 리로드 — origin 재지정은 push가 어떤 자격증명으로 해석되는지도 바꾸기 때문. `git remote add`는 `--` 구분자를 안 받으므로 이스케이프가 아니라 **검증**: 앞의 `-`는 플래그로 읽힘. URL은 http(s)/ssh/git과 scp 형식 `user@host:path`로 제한 — 맨 로컬 경로나 `file://`은 **일부러 거부**(remote로 쓰면 한 유저가 다른 유저의 프로젝트 디렉터리에서 fetch할 수 있고, git의 `ext::` 전송은 명령을 실행). `lib/git-ops.test.ts`가 그 케이스들을 커버하고 publish 라우트의 붙여넣은 URL도 같은 함수로 검증. 375px에서 브랜치 행이 다이얼로그를 넘치던 것과 remote URL 필드가 85px로 눌리던 것도 수정
- **feat(import): 프로젝트 덮어쓸 때 기존 파일 유지/삭제 선택 (`335fa6b`)** — 덮어쓰기가 항상 병합이라(업로드를 위에 복사) 옮겨진 프로젝트를 재가져오면 낡은 파일이 영원히 남음. 피커가 덮어쓰기 선택 옆에서 물음: 유지(병합, 기존 동작) 또는 삭제(폴더를 먼저 비우고 업로드만 남김). 삭제는 절대 기본값이 아니고, 되돌릴 파일이 있을 때만 동작하며, 힌트가 경고색으로 바뀌어 사라지는 것(.git 히스토리·미커밋 작업)을 명시. 디렉터리 자체는 재생성하지 않고 유지 — code-server 컨테이너가 마운트 중일 수 있고 경로가 projects 행에 기록돼 있음. `emptyProjectDir`은 호출자 자신의 projects 루트 아래가 아닌 경로를 거부 — 경로는 우리 행에서 오지만 되돌릴 수 없는 작업이라 신뢰 대신 검사
- **feat: 수동 "이 대화 이름 짓기" 버튼 (`67ee010`)** — 자동 이름은 플레이스홀더를 단 채팅의 첫 턴에 한 번만 발동해서, 그 시점을 지난 채팅(과 이름 기능 이전에 가져온 모든 채팅)은 받은 이름에 갇혔음. 채팅 헤더와 사이드바 각 행에 ✨ 버튼, 우클릭 메뉴에도 이름 변경 옆에 추가. `retitleSession`은 `maybeAutoTitle`이 필요로 하는 가드를 일부러 버림 — **버튼을 누른 것 자체가 요청**이라 플레이스홀더 제목도 유저의 자동 이름 설정도 게이트가 아니고 기존 이름을 덮어씀. 이미 진행된 대화는 첫 메시지로 설명되지 않으므로 여러 턴을 읽고, 실패 사유(인증 없음·아직 말한 게 없음·개인 대화가 아님)를 던져 UI가 표시(자동 경로는 조용히 실패해야 하는 것과 반대). 헤더 버튼이 폰에서 동작하는 쪽 — 사이드바 행 동작은 hover/우클릭 전용이며 그건 이전부터 그러함

## v1.5.0 — 2026-08-04 (`17a1e3a`)

- **feat: 제공자 `/v1/models`에서 모델 목록 자동 수집 (`c5c5f5d`)** — 프론티어 모델 id가 자주 바뀌어 하드코딩된 `models` 맵이 상함. 서버가 설정된 제공자(api.anthropic.com 또는 커스텀 base URL)에서 최신순 목록을 `modelsMax`까지 받아 모든 소비자가 이미 읽는 그 `models` 설정에 되씀. 부팅 시 + `modelsRefreshMs`마다, 또는 관리자 패널 [지금 가져오기]. `defaultModel`의 select 옵션도 고정 배열이 아니라 그 맵을 따라가므로 갓 받아온 id를 바로 선택 가능
- **feat: claude.ai 5시간 창이 리셋되면 턴 자동 재개 (`7bc5495`)** — 플랜 한도(5시간·주간)로 죽은 턴은 일시적 429가 아니라 `withRateLimitRetry`로 어쩔 수 없고 프롬프트가 그냥 사라졌음. 이제 새 `pending_resumes` 테이블에 보관하고 입력창이 재시도 예정 시각을 표시(취소 가능), 창이 열리면 서버가 다시 enqueue. 타이머는 부팅 시 재무장해 대기 중 재시작에도 프롬프트가 안 날아가고, `autoResumeStaleMs`를 넘겨 밀린 행은 재생 대신 폐기. **구조적으로 Claude 구독 전용** — 자격 요건이 해석된 provider env의 `CLAUDE_CODE_OAUTH_TOKEN`이라 API 키·bedrock/vertex/커스텀(그런 창이 없음)은 절대 보관되지 않음. 리뷰 세션도 제외(관리자 인증으로 무인 실행되며 자체 워치독 보유). 마이페이지에서 유저별 opt-in(`users.auto_resume`, 기본 off — 몇 시간 뒤 무인 실행되므로), 관리자 `autoResume*` 키가 워크스페이스 전체 게이트 + grace/시도/대기/stale 한도 조정. 데모는 `!limit` 프리픽스로 전체 루프를 흉내
- **feat: 프라이머 질의로 claude.ai 5시간 창 열어 두기 (`7db52ae`)** — 5시간 창은 벽시계가 아니라 **첫 과금 메시지에 열려** 5시간 뒤 닫힘. 리셋 후 놀면 그 시간은 그냥 사라짐 — 1시간 쉬면 5시간이 아니라 4시간. opt-in 유저에 대해 유저별 스케줄러가 실제 창을 probe하고, 열린 게 없으면 아주 작은 일회용 질의(저렴한 모델, 도구 차단, 하드 타임아웃)로 창을 연 뒤 그 창의 실제 `resets_at`까지 잠듦. 채팅 세션이 아님 — `chat_sessions` 행도 메시지도 사이드바 항목도 없고, 유저 프로젝트 디렉터리의 단명 CLI 서브프로세스일 뿐이며 `usage` 행 1개로 과금돼 비용은 보임. auto-resume과 동일한 Claude 구독 게이트. probe를 못 읽으면 추측하지 않고 `windowPrimerRetryMs`로 재시도해 잘못된 추측으로 메시지를 낭비하지 않음. 마이페이지 opt-in(`users.prime_window`, 기본 off — 쿼터를 씀)이며 마지막 선점 시각이 `user:primed` 소켓 이벤트로 실시간 표시. 관리자 `windowPrimer*`가 모델/프롬프트/grace/재시도 조정

## v1.4.0 — 2026-08-03 (`5e7a59b`)

- **feat(web): 데스크톱 좌측 사이드바 접기 (`607e460`)** — 컬럼을 숨길 수 있고 localStorage에 유지. 기존 헤더 햄버거가 펼침 컨트롤을 겸함 — `<md`에서는 드로어용으로 항상 보이고, `≥md`에서는 접힌 동안만 보임
- **feat(search): 워크스페이스 통합 검색 `Ctrl/Cmd+K` (`37033e9`)** — 엔드포인트 1개 + 팔레트 1개로 모든 내부 표면: 개인 대화, 공유 방 대화, DM/그룹 메시지, 프로젝트, LLM Wiki 주제와 컴파일/원본 문서, PR 리뷰 세션, 유저 디렉터리.
  - 가시성은 재유도하지 않고 각 기능 자체의 게이트를 재사용(`canViewChat` 시맨틱, `rooms.isMember`, projects `canAccess`, `listReviewSessionsForUser`, dm 멤버십) — DM은 관리자에게도 멤버십 전용
  - 메시지 매칭은 저장된 content JSON을 평탄화해 산문·도구 이름·도구 입력·도구 출력까지 전부 검색 대상
  - 결과를 누르면 사이드바가 하듯 착지: 스레드가 열리고 해당 메시지로 스크롤 + 링 강조(접힌 `/clear`·`/compact` 블록은 자동 펼침), 프로젝트·위키 파일은 FileExplorer가 그 파일로 바로 열림
  - 설정: `searchEnabled`(API를 하드 404 + UI 숨김), `searchMaxPerType`, `searchFileMaxKB`, `searchScanMaxFiles`
- **feat(search): 타입별(기본) 또는 최신/오래된 단일 타임라인 정렬 (`0b71232`)** — 그룹이 기본(표면당 섹션, 내부는 최신순), 시간 모드 둘은 전 표면을 한 목록으로 평탄화하고 각 행이 타입 배지를 지님. 날짜 없는 항목(사람·위키 문서)은 양방향 모두 목록 끝으로 — 가장 오래된 척하지 않음. **오래된순은 서버도 반대쪽 끝에서 후보를 골라야 함**: 안 그러면 타입별 상한이 각 표면의 최신 행만 돌려주고 클라이언트가 뒤집으므로 진짜 오래된 것은 DB를 못 떠남. `?sort=newest|oldest` 추가, 시간 정렬 수집기 전부가 상한 적용 전에 이를 존중. 선택은 브라우저별 유지(localStorage `searchSort`). 행 스니펫을 행 폭으로 제한(items-start가 긴 경로/CJK를 콘텐츠 크기로 늘려 폰에서 팔레트를 넘침)
- **docs: 검색 정렬 옵션 문서화 (`b5ca545`)**
- **feat(search): 시간 전용 정렬 + 기능별 필터 탭 (`e5f86ed`)** — 타입 그룹 모드 제거. 결과는 항상 최신/오래된 타임라인 하나이고, 좁히기는 정렬 아래 필터 칩으로: 전체 · 개인 · 대화방 · DM · 프로젝트 · LLM Wiki · PR 리뷰 · 사람, 각각 히트 수를 달고 실제로 매칭된 표면만 칩이 생김. 탭은 히트 **타입이 아니라 기능** 기준 — 방 안의 메시지는 "대화방", 같은 모양이 위키 스레드 안이면 "LLM Wiki"로 편철되며, 채팅 히트가 어느 표면에서 왔는지 이미 기록하는 `nav.kind`에서 해석. 섹션 헤더가 없어졌으므로 모든 행이 타입 배지를 유지. 정렬 전환은 재조회(서버가 선택한 끝에서 후보를 고르므로)하고, 새 질의에 없는 필터는 빈 팔레트 대신 "전체"로 폴백
- **fix(search): 타입별 상한 적용 전에 호출자 기준으로 후보를 좁힘 (`1a976f9`)** — 가시성 자체는 이미 옳았고(인메모리 `chats` 맵이 게이트, 일회용 멤버 계정 감사로 교차 유출 없음 확인) 문제는 개인 제목 수집기가 LIKE + LIMIT을 **모든 유저의** `chat_sessions`에 돌린 뒤 안 보이는 행을 나중에 버린 것 — 바쁜 워크스페이스에서는 자기 대화가 볼 수 없는 행들에 밀려 상한 밖으로 떨어질 수 있음. 멤버는 SQL에서 소유자 스코프(관리자는 `canViewChat`으로 이미 가진 교차 뷰 유지). 메시지 프리필터도 가시 세션 목록이 IN 리스트로 바인딩하기엔 너무 클 때 같은 탈출구를 가져 SQLite 파라미터 에러 대신 넓은 스캔으로 degrade
- **fix(search)!: 관리자도 타인의 개인 공간은 검색 불가 (`87ccb9b`)** — `canViewChat`/`canAccess`는 관리자가 개별 개인 스레드나 유저 스코프 프로젝트를 직접 열게 해주고 검색이 그걸 물려받았음. **요청받아 스레드 하나를 여는 것과 모든 유저의 개인 대화를 한 번에 grep 하는 것은 같은 권한이 아님**:
  - 개인 대화·위키 질의 스레드: 관리자 포함 소유자만(`visibleChats`가 isAdmin 분기를 잃고 제목 질의도 SQL에서 소유자 스코프)
  - 유저 스코프 프로젝트: 소유자만
  - 메시지: 항상 호출자 자신의 가시 세션으로 프리필터 — 관리자 질의가 타인의 개인 메시지를 디스크에서 **읽지조차 않음**
  - DM은 이미 멤버십 전용
  - 공유 표면(내가 속한 방, 방 스코프 프로젝트, PR 리뷰, LLM Wiki 지식 기반, 유저 디렉터리)은 그대로. 단건 엔드포인트의 기존 게이트도 그대로 — 이 변경은 검색만 좁힘. 실행 중 컨테이너에서 일회용 멤버 계정으로 검증: 멤버 본인 세션·프로젝트는 본인에게 2건, 관리자에게 0건(`types=` 강제해도 동일)
- **feat(web): 로고를 누르면 검색이 중앙에 있는 랜딩 화면으로 (`a943777`)**
- **fix(web): 사이드바 헤더가 제목 뒤로 언어 토글을 숨기지 않도록 (`f2fb154`)**
- **fix(web): 언어 스위치를 사이드바 푸터로 옮겨 제목이 들어가게 (`a35a08d`)**
- **refactor(web): 언어를 2방향 토글이 아니라 목록에서 선택 (`965f4be`)** — 토글은 언어가 정확히 둘일 때만 성립하므로 언어가 늘어날 UI엔 잘못된 컨트롤. `LANGS`로 구동: `LangSelect`(네이티브 select, 옵션은 LANGS)가 `LangToggle`을 대체(사이드바 푸터 + 로그인), `Lang` 타입도 LANGS에서 파생하고 `detect()`가 저장/브라우저 값을 `'ko'`/`'en'` 분기 대신 LANGS로 검증, `toggleLang` 제거, `lang.toggleTitle` → `lang.pickTitle`(ko+en)로 번역 문자열에 언어 목록을 굽는 것도 중단. 이제 언어 추가 = LANGS 항목 1 + 라벨 + 사전(DICT가 Lang별 타입이라 tsc가 빠진 걸 짚어 줌)
- **feat(web): 핵심 동작 단축키, 플랫폼별 표기 (`bd9b76a`)** — 테이블 하나(`SHORTCUT_GROUPS`)가 전역 핸들러와 `?` 치트시트를 동시에 구동하므로 목록에 있는 바인딩은 반드시 동작. 키 표기는 플랫폼대로(맥 ⇧⌘O, 윈도우/리눅스 Ctrl+Shift+O). Mod+K / Mod+/ 검색(기존), Mod+Shift+O 새 대화, Mod+B 사이드바(`<md` 드로어 / `≥md` 컬럼), Mod+Shift+H 홈, Mod+Shift+L 테마. `?`는 텍스트 필드 밖에서만 열려 메시지에 물음표를 쳐도 안 뜨고, 열린 다이얼로그가 키보드를 소유. 입력창의 `Esc`는 메뉴가 없을 때 실행 중 턴을 중단. 버튼 툴팁에 단축키 표기, 사이드바 푸터에 Shortcuts 행. 하드코딩 `search.shortcut`('Ctrl+K')은 `fmtKeys`로 대체
- **feat(web): 앱이 우클릭을 소유 — 전용 컨텍스트 메뉴, Shift는 브라우저 것 (`733c583`)** — 윈도우 리스너 하나가 `contextmenu`를 가져가 어디서 우클릭해도 워크스페이스 동작이 나옴: 새 대화·검색·사이드바·테마·새로고침, 그리고 클릭 지점이 입력·선택·링크면 클립보드 행. 더 나은 항목이 있는 화면은 자체 메뉴를 붙이고(사이드바 행 열기/이름변경/삭제, 채팅 메시지 복사/편집/삭제) 전역 핸들러는 이미 default-prevented된 것에서 물러남. 탈출구: **Shift+우클릭** — 그때는 preventDefault를 안 하므로 브라우저 메뉴가 그대로 나옴(Firefox/VS Code 관례). 단축키 시트와 메뉴 자체 푸터에 안내, 관리자는 `customContextMenu`로 전체 차단. Mod+B 사이드바 로직은 공유 `toggleSidebar()`로, 사이드바의 rename/delete 프롬프트는 명명 핸들러로 빼서 hover 버튼과 메뉴 행이 사본 둘이 아니라 같은 코드를 실행
- **chore: 로컬 compose 재빌드가 스스로 정리 (`94ce165`)** — `docker compose up -d --build`는 매번 이전 이미지를 dangling으로 남김(:latest 태그를 잃고 레이어는 유지). 빌드 + `docker image prune -f`를 한 스크립트로 묶고 CLAUDE.md 릴리스 워크플로가 이를 가리키게 해 세션마다 정리를 기억할 필요 없음. prune은 dangling만 건드림 — 태그된 버전·실행 컨테이너·볼륨·빌드 캐시는 그대로
- **feat: 새 대화를 주제로 이름 짓기, 유저별 토글 (`663b859`)** — 새 개인 대화가 손으로 바꾸기 전까지 플레이스홀더 제목을 유지했음. 첫 턴이 끝나면 서버가 저렴한 모델에 한 줄 제목을 요청해 `session:title`로 모든 클라이언트에 push. 아직 플레이스홀더인 대화만 건드리므로 유저가 고른 이름이 항상 이김. 인증이 없거나 호출이 실패/타임아웃하면 첫 메시지 절단으로 폴백. 끄기는 마이페이지 체크박스 하나(`users.auto_title`), 관리자는 `autoTitleEnabled`로 통째 제거 — 모델·길이 상한·타임아웃도 레지스트리 키. 정적 데모는 canned 제목으로 흐름을 미러
- merge: `feat/auto-session-title` 브랜치 병합 (`bca1272`)

## v1.3.1 — 2026-08-03 (`0f736c0`)

- **fix(privacy): 마스터 스위치가 채널별 토글을 덮어쓰고 잠금 (`f1cfd57`)** — 출시된 패널의 두 문제: "사용량 텔레메트리" 옆의 맨 체크박스는 체크가 **보낸다**는 건지 **막는다**는 건지 말하지 않고, 마스터는 "전부 차단"처럼 읽히면서 실제로는 AND 게이트라 켜 놓아도 아래 9개가 살아 보이며 각각 그걸 되돌리는 것처럼 보임. 이제 마스터는 **OR 오버라이드**: 켜면 전 채널 차단, 채널 키는 무시되고 그 행들은 잠긴 상태(회색·비활성·유효 상태 표시)로 렌더되며 어떤 스위치가 잡고 있는지 한 줄로 명시. 끄면 채널별로 선택, 마스터와 전 채널이 꺼지면 아무것도 차단되지 않고 상속 env는 손대지 않음(기존대로). 잠금은 뷰가 privacy 그룹을 특수 처리하는 대신 `ConfigDef`의 새 `disabledWhen` 필드가 구동해 레지스트리가 단일 진실원으로 남음. 모든 라벨이 "… 차단"으로 바뀌고 그룹에 "체크 = 차단" 힌트 — 체크의 의미가 하나뿐이 되도록

## v1.3.0 — 2026-07-31 (`68e920c`)

- **feat(privacy): 비필수 Anthropic 전송의 채널별 토글 (`1e62f66`)** — 마스터 스위치는 남기되, 딱 한 채널만 되살리고 싶은 운영자(예: 자기 OTel 수집기로 메트릭)가 전부를 포기해야 했음. `privacy.ts`가 각 채널을 **데이터로** 기술(키, 고정할 env, 벗겨낼 상속 변수, 병합할 settings, 우산 변수가 커버하는지 여부)하고 `privacyPlan()`이 마스터 + 채널 9개를 두 spawn 지점이 적용할 계획 하나로 해석. `on`을 import가 아니라 인자로 받아 모듈이 DB 프리로 남고 self-check가 직접 구동 가능. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`은 그것이 커버하는 모든 채널이 아직 켜져 있을 때만 방출 — 텔레메트리·에러 리포트·설문·업데이터를 통째로 막으므로 일부러 되살린 채널 옆에 세우면 운영자를 조용히 덮어씀. 마스터 off는 여전히 상속 env를 전혀 안 건드림. 설명은 i18n(`cfgDesc.<key>`, ko+en)에 살고 각각 env 변수 이름이 아니라 **무엇이 기기를 떠나는지**를 말함

## v1.2.0 — 2026-07-31 (`de73205`)

- **docs(readme): 권장 사양(CPU/RAM/디스크/아키텍처/네트워크) (`7d123d5`)**
- **docs(readme): 완전 로컬 셋업(커스텀 provider) 강조 + 사양 정리 (`b39d856`)** — "완전 로컬" 섹션(`ANTHROPIC_BASE_URL` → LiteLLM/로컬 모델, api.anthropic.com 미사용) 추가, 로컬 LLM의 GPU/VRAM은 앱 사양과 별개임을 명시
- **docs(readme): 완전 로컬 실행 스택(Ollama + LiteLLM + 앱) (`1adfd4b`)** — 오프라인 운용용 복붙 compose, 앱은 LLM Provider(custom)로 로컬 Anthropic 호환 게이트웨이를 가리킴
- **docs(readme): 완전 로컬 스택의 docker run 변형 (`fcb675c`)**
- **docs(readme): 로컬 LLM 설정 정정 — 네이티브 Anthropic 엔드포인트 직결 (`8e84bff`)** — Ollama ≥0.14, vLLM, LM Studio, llama.cpp가 `/v1/messages`를 네이티브로 노출하므로 Claude Code가 `ANTHROPIC_BASE_URL`로 직접 연결. 기본 로컬 스택에서 LiteLLM 프록시 제거(폴백으로만 유지)
- **feat(release): 기본 amd64, 가끔 쓰는 `--arm` (`0a97718`)** — arm64 에뮬 빌드가 이 호스트에서 20–30분이라 릴리스는 amd64 기본, `-- --arm`으로 linux/arm64도 게시
- **fix(docs): 물결 숫자 범위가 GFM에서 취소선으로 렌더 (`fe74580`)** — `4~8`/`~20~30`이 GitHub에서 `~취소선~`으로 파싱됨. en dash로 교체
- **docs(readme): 현재 UI로 데모 GIF 재촬영 (`c24608c`)** — 기존 히어로 GIF는 초기 빌드 것. 현재 VITE_DEMO 앱에서 재캡처: 팀 방 + 프레즌스, 스트리밍 턴, 브라우저 내 툴 승인, 툴 실행, code-server로 Split. 영문 UI, 1200px
- **docs(readme): 섹션 목차 추가 (`b0ec001`)** — 두 README 히어로 아래에 최상위 TOC, 앵커는 GitHub 렌더 슬러그로 검증
- **docs(readme): 헤더에 Docker ≥26 배지 (`2d3526a`)**
- **feat(privacy): 비필수 Anthropic 전송 기본 전면 차단 (`1e8f69f`)** — 모든 에이전트 턴이 Claude Code CLI를 spawn 하는데, CLI는 기본적으로 추론 요청 **밖에서도** Anthropic과 통신함: 사용량 텔레메트리, 에러 리포트, `/feedback`·`/bug`·`/share`(코드 포함 트랜스크립트 전체 업로드), 세션 품질 설문과 그 트랜스크립트 업로드 후속, 비필수 모델 호출, 자동 업데이터 핑, WebFetch 도메인 preflight(호스트명을 api.anthropic.com으로 전송), Artifact 게시, 공식 마켓플레이스 자동 설치, OpenTelemetry export. 새 `server/src/claude/privacy.ts`가 모든 opt-out을 한곳에 모으고 두 spawn 지점에 적용 — `buildOptions()`(env를 **마지막에** 고정해 상류가 채널을 다시 열 수 없게, 그리고 env가 아니라 설정인 `skipWebFetchPreflight`는 SDK flag-settings 층으로)와 code-server 컨테이너 스펙(에디터 터미널의 `claude` 실행도 커버). 상속된 OTel/트레이싱 엔드포인트·헤더는 덮어쓰는 게 아니라 벗겨냄. `blockNonessentialTraffic`(기본 on, `BLOCK_NONESSENTIAL_TRAFFIC`)로 게이트하며 끄면 상속 env를 그대로 둬 의도적 OTel 수집기가 동작. 추론 요청 자체는 영향 없음 — 그것까지 없애려면 LLM Provider = custom

## v1.1.1 — 2026-07-31 (`6d2d8c5`)

- **docs(dockerhub): 저장소 개요 페이지 + 셸별 실행 커맨드 (`5ea9258`)** — `DOCKERHUB.md`(GitHub 링크, bash/PowerShell/CMD 실행 블록), `scripts/hub-description.mjs` + `npm run hub:desc`로 Hub API에 개요 push, README의 docker run도 bash/zsh·PowerShell·CMD 변형으로 분리
- **feat(release): buildx 멀티아치 빌드(linux/amd64, linux/arm64) (`d5b1956`)** — `release.mjs`가 `docker buildx build --platform … --push`를 쓰고 docker-container 빌더(`ccw-multi`)가 없으면 자동 생성. `PLATFORMS`로 아키텍처 오버라이드

## v1.1.0 — 2026-07-31 (`8d01636`)

- **feat(release): 버전 + Docker Hub 이미지 배포 파이프라인 (`8102e6a`)** — `scripts/release.mjs`가 `:버전` / `:latest` / `:sha-<short>` 3개 태그로 build & push, `npm run release[:patch|:minor|:major]`(npm version이 버전 올리고 git 태그), compose의 `APP_IMAGE` 파라미터로 게시된 이미지 pull, CLAUDE.md 규칙 3 + README에 릴리스 단계 문서화
- **feat(deploy): 클론 없이 실행하는 단독 `docker-compose.hub.yml` (`ecfe492`)** — `build:` 없는 pull 전용 compose라 파일 하나만 받으면 게시된 이미지로 실행. README에 curl + up 흐름
- **feat(codeserver): 네트워크 자동 생성으로 단일 `docker run` 성립 (`7ee811c`)** — `ensureNetwork()`가 부팅 시 code-server 네트워크를 만들고 앱 컨테이너를 연결. compose 아래서는 no-op

---

## 초기 개발 — 2026-07-20 → 07-31

버전 태그 이전 144커밋. [DESIGN.md](DESIGN.md) 14절의 **P0–P5 빌드 단계**로 시작해, 설계 문서에 없던 축들이 순차로 붙었다.

### 07-20 — P0–P5 골격 (설계 스펙 그대로)

- **chore: 모노레포 스캐폴드, Docker 배포, 빌드 설정 (P0) (`b536aac`)** — compose·단일 이미지·소켓 마운트·네임드 볼륨
- **feat(db): SQLite/Drizzle 스키마, DDL 초기화, path/settings/id 유틸 (P0) (`f043752`)**
- **feat(auth): scrypt 인증, 폐기 가능한 DB 세션, 계정 발급 (P0) (`6c155d3`)**
- **feat(claude): 세션당 SDK 러너, 스트리밍, `canUseTool` 웹 권한 브리지, 전역 스로틀 + 429 백오프, 사용량 추적 (P1) (`545efb6`)**
- **feat(rooms): 공유 대화방(방장/위임), FIFO 큐 + 취소, Socket.IO 팬아웃/프레즌스 (P4) (`47153ef`)**
- **feat(codeserver): dockerode spawn/reap, 볼륨 서브패스 마운트, 인앱 http+ws 프록시 (P2) (`6d8dcdf`)**
- **feat(plugins): 2클래스 플러그인 매니저 (P3) (`f7c1a44`)** — 공통/개인, git + tarball, 강제/선호
- **feat(api): REST 라우트(sessions/rooms/projects/plugins/admin) + Fastify 엔트리포인트 (P0–P5) (`6e6e220`)**
- **feat(web): React SPA (P0–P5) (`4fc95f4`)** — 채팅/툴 카드/권한 프롬프트, 방, 에디터 분할, 관리자 + 플러그인 패널
- **feat(codeserver): 로그아웃 시 그 유저의 에디터 컨테이너 제거 (P2) (`b611365`)**
- **fix(codeserver): code-server가 `:8080`에 바인딩된 뒤 URL 반환 (`f6a0e5c`)** — iframe 502 경쟁 회피
- **fix(web): 에디터 전용 뷰가 0폭 그리드 컬럼에 렌더돼 빈 화면 (`de41ba9`)**
- **fix(codeserver): 부팅 시 orphan 에디터 컨테이너 제거 (`0dcc963`)** — 추적 안 되는 생존자가 영영 reap되지 않던 문제
- **docs: 다듬은 OSS README(강점/아키텍처 mermaid/배지) + MIT LICENSE (`219f1d1`)**
- **docs: README에 라이브 데모 GIF (`85207d9`)** — 채팅 · 웹 툴 승인 · code-server 분할
- **feat(web): 앱 아이콘(clay spark favicon.svg) + PWA manifest + theme-color (`5642b85`)**
- **feat(brand): 오리지널 앱 아이콘(split-workspace 마크)을 favicon·인앱 로고·README에 (`bfb51ba`)**
- **docs: README i18n — 영어(기본) + 한국어(README.ko.md) + 언어 스위처 (`96a98c6`)**

### 07-21 — LLM Wiki (설계에 없던 4번째 엔티티의 시작)

- **feat(server): OAuth 토큰 vs API 키 라우팅, 로컬 플러그인 래핑, 권한 응답 채널 (`2b7d42a`)** — `sk-ant-oat*`는 `CLAUDE_CODE_OAUTH_TOKEN`, `sk-ant-api*`는 `ANTHROPIC_API_KEY`로. 플러그인을 `{type:'local',path}`로 래핑, 격리 루트/`additionalDirectories`. AskUserQuestion 선택을 deny+message(응답 채널)로 Claude에 되돌려주고 `permission:resolved`/`answered` emit. `.env.example`에 부트스트랩 admin + 키 주석
- **fix(web): 채팅 pane 스크롤 + 그리드 레이아웃 `minmax(0,1fr)` (`8519167`)**
- **feat(projects): git clone으로 프로젝트 생성 (`8f5324e`)** — `POST /api/projects`가 선택적 `gitUrl`을 받아 mkdir 대신 클론(execFile, 셸 없음). http(s)/git/ssh 스킴 검증(`file://` 차단), URL에서 이름 유도, `GIT_TERMINAL_PROMPT=0`로 비공개 저장소는 즉시 실패, 실패 시 부분 디렉터리 정리
- **feat(wiki): LLM Wiki 탭 — 관리자 주제, 유저별 질의 스레드, 대량 + 폴더 업로드 (`af18dd4`)** — `wiki_topics` 테이블 + `chat_sessions.wiki_topic_id` + 컴파일 상태 컬럼(가드된 ALTER 마이그레이션), 주제 디렉터리와 위키 cwd 해석(세션 목록은 위키 스레드 제외), `routes/wiki.ts`(주제 CRUD — 생성/삭제는 관리자 전용, 유저별 스레드 get-or-create, 스테이징 업로드 = 업로드 → 삭제 가능 목록 → 확정/취소, 폴더 드래그&드롭 전 깊이 재귀 경로, CLAUDE.md 그라운딩), multipart `fieldNameSize` 상향, 부팅 시 스테이징 reap, 컴파일 중 질의 차단, 웹 Wiki 사이드바 섹션 + `WikiCreateModal`(드롭존·진행바·스테이징 목록) + `WikiBanner` + store/socket + `api.uploadProgress`
- **feat(wiki): 전체 컴파일 파이프라인 — 원본 → 합성 문서 + `_index` (`9bc2159`)** — `compileTopic()`이 `./raw/` 위에서 Claude를 실행(acceptEdits + 항상 허용 `canUseTool`)해 상호 링크된 `./wiki/` 문서와 confidence, 계층형 `_index.md` 생성. 생성/파일 추가 시 자동 실행 + 수동 재컴파일 버튼, single-flight 가드, 빈/mock은 즉시 done. 상태(idle|compiling|done|error) + 단계별 하트비트를 `wiki:status`/`wiki:progress`로 방송해 멈춘 것처럼 보이지 않음
- **feat(wiki): 컴파일의 `raw/` 불변 펜스 + 파일 트리·단일 파일 엔드포인트 (`3c742b7`)** — 컴파일 `canUseTool`이 `raw/` 아래 Write/Edit을 거부(에이전트가 오작동해도 원본 불변), 출력은 `wiki/`만. `GET …/tree` → `{raw, wiki}` 경로+크기(내용 없음), `GET …/file?dir=raw|wiki&path=` → 파일 하나의 텍스트
- **feat(wiki): 주제 파일(원본 + 컴파일본) 트리 탐색기 (`1367783`)** — `WikiBanner`의 파일 탐색기 버튼이 모달을 열어 raw/wiki 토글, 상대 경로로 만든 접이식 폴더 트리, 파일별 지연 로드 뷰어. 업로드한 원본 전부(중첩·바이너리 포함)를 보여 컴파일 후 사라진 것처럼 보이지 않게
- **fix(wiki): 업로드 시 유니코드(한글/NFD) 폴더 이름 보존 (`14a8a1f`)** — `safeFile`의 `[가-힣]` 화이트리스트가 조합형(NFC) 음절만 매칭해서 macOS 분해형(NFD) 자모가 통째로 제거됨 — 순한글 폴더는 `''`가 되고(내부 파일이 부모로 떨어짐) 한글+영숫자는 한글 부분만 소실. `safeSeg`로 교체: NFC 정규화 + 경로 구분자/제어 문자만 제거하고 나머지 유니코드는 유지. 중첩 한글/혼합 경로 생존 검증
- **feat(wiki): 주제 삭제 시 디스크 파일까지 삭제 + 부팅 시 orphan 정리 (`91460d1`)** — 삭제가 DB 행만이 아니라 주제 디렉터리(raw/ + wiki/)를 rm. `reapWikiOrphans()`가 DB 행 없는 `/data/wiki/<id>`를 부팅 시 제거(기존 파일 유지 동작이 남긴 잔재도 청소). 확인 대화가 파일이 영구 삭제됨을 경고
- **feat(wiki): 컴파일에 이미지 포함(멀티모달) + 질의 그라운딩 (`2e315ce`)** — 이미지가 코드 제외 대상은 아니었지만 프롬프트가 언급을 안 해 사실상 무시됐고, 질의 시 그라운딩이 텍스트 `wiki/`를 가리켜 `raw/` 이미지에 도달 불가. 이제 컴파일이 멀티모달 Read로 이미지(.png/.jpg/.gif/.webp)를 읽어 다이어그램·스크린샷을 출처와 함께 문서에 전사/기술하고, 그라운딩이 시각 질문에는 `raw/` 이미지를 직접 열라고 지시. 빨강/파랑 테스트 이미지가 읽혀 문서에 기술됨(confidence high) 검증
- **feat(wiki): 파일 탐색기의 이미지 미리보기 + 마크다운 렌더 토글 (`a89e08e`)** — `GET …/blob`이 원본 바이트를 이미지 content-type으로 스트리밍(동일 오리진 쿠키 인증)해 `<img>` 미리보기, 마크다운 렌더러를 `lib/md.ts`로 분리(채팅 + 탐색기 공유), 이미지 파일은 `<img>`로 `.md`는 렌더/원문 토글, 나머지 텍스트는 원문 유지
- **fix(md): 제대로 된 블록 수준 마크다운 렌더러(채팅 + 위키 미리보기) (`03bae9a`)** — 기존 렌더러가 모든 개행을 `<br/>`로 바꿔 블록 사이가 크게 벌어졌고 hr/표/h4-6/취소선/태스크 리스트 지원이 없었음. 블록 파서로 재작성: 제목 1–6, hr(`---`/`***`/`___`), 인용, 펜스드+인라인 코드, ul/ol(순서 전환 시 분할) + 태스크 항목, GFM 표, 이미지, 소프트 브레이크 단락(`<br/>` 남발 대신 블록 마진). 이스케이프 우선이라 여전히 XSS 안전, NUL 센티널 플레이스홀더로 텍스트의 숫자/공백이 절대 훼손되지 않음. 인용/리스트 판정은 이스케이프 후 수행(`&gt;` 매칭). 전 문법 렌더 테스트로 검증
- **feat(chat): 답변·코드 블록 복사 버튼 (`1e143de`)** — 메시지 hover 컨트롤로 답변 복사(어시스턴트 텍스트 블록 결합, 툴 카드 제외 / 유저 메시지는 본문), 마크다운 코드 블록마다 복사 버튼을 위임 클릭 리스너 하나로(내용이 `dangerouslySetInnerHTML`이라 React onClick 불가) — `pre code`의 textContent를 읽어 디코드된 원본 복사. 렌더 안 되는 ⧉ 글리프를 📋로 교체
- **feat(chat): 채팅 헤더의 프로젝트 파일 탐색기 (`dfb89f1`)** — 프로젝트 채팅에 파일 버튼 추가, 위키 탐색기의 트리/미리보기를 범용 `FileExplorer`로 추출하고 `WikiExplorer`가 그걸 감쌈. 새 엔드포인트 `GET /api/projects/:id/tree|file|blob`(부풀린 디렉터리 스킵, 5000파일 상한, 경로 탈출 가드, 바이너리/대용량은 미리보기 안 함)

### 07-22 — 유저별 토큰 · i18n · 정적 데모 · git 커밋/푸시

- **docs: 작업 규칙을 담은 CLAUDE.md 신설 (`aed6b6e`)**
- **feat(token): 암호화 토큰 저장 + 작성자별 해석 레이어 (`d06bde9`)** — `secret-box`(AES-256-GCM 저장 암호화), `users.claude_token_enc`/`_set_at` 컬럼 + 멱등 마이그레이션, `claude-token`(유저/관리자 공통 토큰 set/clear/meta, `resolveClaudeAuth`), 설정에 `forceMock`·`tokenEncSecret` — `anthropicApiKey`는 레거시 폴백으로 강등
- **feat(token): 각 턴을 작성자 토큰으로 실행 + 토큰 API (`8310b93`)** — `buildOptions`가 해석된 작성자 토큰을 주입하고 떠도는 호스트 키를 제거, `runTurn`/`probeCommands`/wiki-compile이 작성자·생성자별로 토큰 해석, 토큰이 없으면 전역 `mockClaude` 대신 턴 단위 mock. `PUT/DELETE /api/auth/me/claude-token`, `/me`·`/login`이 토큰 상태 노출, `POST /api/users`가 `claudeToken` 수용, 관리자 공통 토큰 엔드포인트
- **feat(web): 토큰 등록 UI, 로그인 알림, 관리자 공통 토큰 (`37cddf9`)** — `MyTokenModal`(셀프 등록/수정/삭제 + nag 변형), 사이드바 '내 토큰' 항목과 미등록 배지, 토큰 등록 전까지 로그인마다 nag 모달, AdminPanel의 공통 토큰 섹션 + 유저 생성 시 선택적 토큰, `.env.example`에 `TOKEN_ENC_SECRET` + 토큰 우선순위
- merge: 유저별 Claude Code 토큰(개인 + 공유방 작성자별) (`ee0a3d8`)
- **feat(plugins): 상세(매니페스트+스킬), 파일 트리 & 업데이트 API (`bb43660`)** — `lib/filetree.ts`로 `walkFiles`/`resolveUnder`/`IMG_CT`를 projects·plugins 공유로 추출, `GET …/detail`(plugin.json + `skills/*/SKILL.md` 프론트매터), `GET …/{tree,file,blob}`, `POST …/update`(git fetch+reset to remote HEAD, 마켓플레이스만), `canViewPlugin`(공통은 전원, 유저 스코프는 소유자/관리자)
- **feat(web): 플러그인 상세 모달 — 스킬 목록, 파일 트리, 업데이트 (`4cc47f7`)**
- **feat(wiki): 주제 생성 시 이미 컴파일된 위키 임포트(컴파일 생략) (`432ec46`)** — "precompiled" 옵션. 켜면 업로드 폴더를 원본이 아니라 완성된 위키로 취급 — 스테이징 파일을 `wiki/` 아래 배치(주제 export 폴더가 둘 다 가지면 `raw/`도), `compileStatus=done` 표시, Claude 컴파일 단계 전면 생략. `mapPrecompiled()`가 스테이징 트리를 정규화(래퍼 폴더 제거, 주제 export면 `wiki/*`+`raw/*` 라우팅, 아니면 전부 → `wiki/`)
- **feat(web): i18n(한국어 + 영어) (`a42a7b1`)** — 자립형 i18n 모듈(`web/src/lib/i18n.ts`): lang 상태 + localStorage 유지 + `useSyncExternalStore` 구독, `t()`/`useT()`, ko/en 사전(~230키). 기본 언어는 localStorage → `navigator.language` → ko. 채팅 헤더(테마 토글 옆)와 로그인 페이지에 `LangToggle`, 12개 컴포넌트 + App/store/ui의 한글 문자열 전부 외부화, `{name}` 토큰 보간, `timeAgo`와 store 에러는 모듈 `t()` 사용
- **feat(web): 언어 토글을 사이드바 상단(전역, 모든 페이지)으로 (`fbf6c2d`)** — 채팅·플러그인·관리자 패널 어디서나 보이게. 채팅 헤더의 중복 토글 제거(로그인은 자체 유지)
- **fix(web): 영어에서 사이드바 제목 한 줄 유지 (`23476b6`)** — `LangToggle`을 절대 위치 우상단으로 띄워 264px 고정 사이드바 제목이 EN에서 줄바꿈되지 않게
- merge: `origin/feat/i18n` 병합 (`c057788`) — Sidebar.tsx 충돌 해소
- **docs: i18n + README 유지 규칙 상설화, LLM Wiki·i18n 문서화 (`b05471d`)** — CLAUDE.md 규칙 6(모든 사용자 노출 문자열은 i18n을 거칠 것 — ko+en 양쪽 키)과 규칙 7(의미 있는 새 기능은 두 README 모두에)
- **docs(readme): 유저별 토큰·플러그인 상세·LLM Wiki·i18n 반영 (`7c3b6b1`)** — 토큰 우선순위(개인 → 관리자 공통 → env → MOCK)를 강점·기능·`.env`·로드맵 체크에 반영, 구조 섹션에 `src/wiki`·`src/auth`·`src/usage`·웹 i18n 추가
- **feat(web): `/clear`·`/compact` 지점의 히스토리를 접이식 스택으로 (`d075c12`)** — 각 `/clear`·`/compact` 유저 메시지가 구간을 닫고, 그 위 대화가 타임스탬프 달린 커맨드별 토글(기본 접힘)로 축약돼 두 커맨드가 쌓이는 만큼 접힘도 쌓임. 영속 메시지 목록 위의 순수 렌더 패스라 히스토리는 절대 사라지지 않음
- **feat(web): LLM Wiki 답변에 인용 출처 패널 (`0e6d4e7`)** — 스레드별 우측 패널이 각 답변이 참고한 파일을 나열(wiki/raw 그룹). 출처는 그 턴의 Read 툴 호출 + 모델이 산문에서 언급한 `wiki/`·`raw/` 경로. 답변 속 언급은 `<mark>` 인용으로 감싸 출처에 hover하면 본문 언급이 강조되고 그 반대도 성립, 클릭하면 파일을 제자리 미리보기. 모델이 공백을 접으므로 기록된 경로는 근사치 — 미리보기가 정규화된 basename으로 실제 트리 항목에 해석한 뒤 fetch하고, 진짜 못 찾으면 인라인으로 우아하게 실패
- **feat(web): 실제 앱을 그대로 비추는 정적 GitHub Pages 데모 (`d300b00`)** — 백엔드 없는 데모 빌드(`VITE_DEMO`)가 실제 컴포넌트·스토어·스타일을 전부 재사용하고 네트워크 층만 교체해, 데모가 동일하게 보이고 새 UI가 자동으로 나타남. `web/src/demo`(fetch + XHR + socket.io 목: 라우터, 시드 인메모리 db, 웹 권한 프롬프트가 포함된 스트리밍 턴 시뮬레이션)를 `main.tsx`에서 `import.meta.env.VITE_DEMO` 뒤로 설치(일반 빌드에선 트리셰이킹), `build:demo` 스크립트 + Pages 배포 워크플로, favicon 참조를 `BASE_URL` 기준으로, README 데모 배지 + CLAUDE.md 규칙 8 + `web/src/demo/README.md`
- **feat(web): LLM Wiki 출처 패널 크기 조절 (`b0f9a4b`)** — 고정 폭에서 인라인 미리보기가 갑갑했음. 왼쪽 가장자리 드래그 핸들(300–1000px 클램프, localStorage 유지), 기본 360px로 확대. 미리보기가 넓어진 패널을 채우며 팝업 대신 나란한 hover 강조 레이아웃 유지
- **fix(web): 위키 마크다운의 `<aside>` 블록과 상대 경로 이미지 렌더 (`30fb4c3`)** — Notion export가 콜아웃을 `<aside>`로 감싸고 이미지를 상대·URL 인코딩 href로 링크하는데, `md()`가 태그를 이스케이프(리터럴 "<aside>" 텍스트)하고 http(s) 이미지만 렌더해 둘 다 깨졌음. `md()`가 `<aside>` 래퍼를 풀고 선택적 `opts.img` 해석기를 받아 비-http 이미지 src를 그리로 라우팅, 파일 미리보기(출처 패널 + 탐색기)가 상대 href를 주제/프로젝트 blob 엔드포인트로 매핑하는 해석기를 전달(파일 자기 디렉터리 기준 해석, 서버가 떠도는 세그먼트 공백 정리)
- merge: `feat/wiki-sources-panel` 병합 (`fac5d3f`)
- **feat(demo): 인용 출처 패널이 데모에서 보이도록 위키 스레드 시드 (`e5aed82`)** — 데모의 Payments Domain 스레드가 툴 호출 없는 평범한 답변이라 새 패널이 비어 보임. `wiki/_index.md`·`refunds.md`·`overview.md`에 대한 Read 호출과 인라인 인용을 시드하고 `_index.md` 문서 추가 — 목 데모에서 wiki 3 + raw 1 출처, hover 강조, 클릭 미리보기까지 동작
- **docs: git 커밋/푸시 + 원격 자격증명 관리 설계 스펙 (`304bbad`)**
- **feat(git): 채팅에서 커밋/푸시 + 암호화된 원격 자격증명 (`a7418b8`)** — `git_credentials` 테이블(유저별 + 관리자 공통, AES-GCM, 호스트 키잉), remote 호스트로 유저 → 공통 해석, HTTPS PAT는 정적 `GIT_ASKPASS` 헬퍼로(시크릿은 자식 env에만, URL·reflog에 절대 안 남음), 프로젝트 git 엔드포인트(status/commit(파일 스테이징)/push)와 클론의 자격증명 피커, Claude 서브프로세스에 git author identity + push 자격증명을 줘 스스로 커밋/푸시 가능, UI(유저 자격증명 관리 모달 + 관리자 섹션, 클론 피커, 헤더 Git 패널), i18n ko/en, 데모 목, README
- **fix(git): 클론 자격증명을 URL 호스트에 바인딩, 리네임 통째 커밋 (`2abdd2c`)** — 명시된 `credentialId`의 호스트가 저장소 URL 호스트와 다르면 클론 거부(**저장된 PAT를 공격자 URL로 유출하는 것 방지** — 리뷰 high), `gitCommit`이 선택된 스테이징 리네임을 원본 경로까지 확장해 `commit -- <new>`가 옛 경로의 스테이징된 삭제를 떨어뜨리지 않게(리뷰 medium), `parsePorcelainZ`가 R/C 원본 토큰을 `GitFile.orig`로 보존
- merge: `feat/git-commit-push` 병합 (`7053eca`)

### 07-23 — Git 워크플로 다듬기

- **fix(git): 자격증명 힌트가 Bitbucket 사용자명을 명확히(ATATT API 토큰은 이메일) (`d4749fc`)**
- **feat(git): Git 패널의 브랜치 목록(로컬/원격) + 전환 (`f6a5b99`)** — `gitBranches`(현재 + 로컬 + 원격, `origin/HEAD` 필터), `gitCheckout`(DWIM: 로컬 전환 또는 원격 전용 브랜치 자동 추적), `GET /git/branches`·`POST /git/checkout`, 정적 배지를 대체한 브랜치 select(로컬/원격 optgroup), 데모 목 + i18n
- **docs: git 기능에 브랜치 전환 언급(README ko/en) (`4fccdee`)**
- **fix(git): 원격 브랜치 전체 나열(shallow 클론이 단일 브랜치였음) (`4a0cd5f`)** — `--no-single-branch`로 클론해 depth 1에서도 모든 브랜치 팁을 가져옴(`--depth`만 주면 `--single-branch`가 함의돼 기본 브랜치만), `gitFetchRemotes()`가 origin refspec을 `*`로 넓혀 fetch해 기존 단일 브랜치 클론도 전 원격 브랜치 노출(브랜치 조회 전에 best-effort 호출), 패널은 status 뷰를 막지 않고 브랜치를 로드. 실제 네트워크(octocat/Hello-World) 검증: 전 master만 → 후 master+test+octocat-patch-1
- **feat(git): 프로젝트 메뉴에서 프로젝트 삭제(파일까지) (`f47160e`)** — `DELETE /api/projects/:id`가 작업 디렉터리도 제거하되 스코프의 projects 루트 **안쪽으로 엄격히 해석될 때만**(경로 탈출 가드), `canAccess`로 접근 강화. 남은 파일 때문에 같은 이름 재클론이 충돌하던 문제 해결. store가 인덱스 해제 + 선택 중이면 현재 프로젝트 해제 + 갱신, 프로젝트별 🗑 + 확인(pointerdown stopPropagation으로 선택 트리거 방지)
- **fix(git): 프로젝트 메뉴에서 선택과 삭제 분리 (`f13a849`)** — Radix DM.Item의 `onSelect`가 휴지통 아이콘 클릭에도 발화해(stopPropagation으로 못 막음) 삭제가 프로젝트 전환도 시킴. 메뉴를 controlled(open 상태)로 만들고 각 행을 평범한 select + delete 버튼으로 렌더 — 삭제가 전환을 유발하지 않고 메뉴도 열린 채 유지
- **feat(session): 사이드바에서 개인 세션 이름 변경 (`532fba8`)** — `store.renameSession` → `PATCH /api/sessions/:id { title }`, 목록과 현재 제목을 제자리 갱신, 각 개인 세션에 ✎ 버튼
- **feat(server): 선택적 TLS로 localhost 밖에서도 PWA 설치 (`64e4d0e`)** — PWA 설치는 secure context가 필요한데 브라우저는 localhost만 예외로 둬 `http://<ip>`에서는 불가. `TLS_KEY`/`TLS_CERT`가 브라우저 신뢰 인증서를 가리키면 HTTPS로 서비스(socket.io와 `/cs` 프록시가 같은 서버를 타므로 리스너 하나로 전부 커버), 비면 기존대로 평문. compose env 통과 + 읽기 전용 `./certs` 마운트, README + `.env.example`, certs gitignore
- **feat(git): 저장소의 push/commit이 어떤 자격증명으로 해석되는지 표시 (`8a159b1`)** — 기존엔 자격증명 유무만 체크/경고 마크로 신호. 실제 해석된 자격증명(출처: 내 것 vs 공유, 제공자, 호스트, 사용자명)과 커밋 identity를 노출해 거부·만료된 PAT 같은 인증 실패를 한눈에 진단. `resolveGitCredMeta()`는 메타만 반환(토큰은 전송 안 함)
- **feat(git): shallow(depth 1) 대신 full clone (`895ac7d`)** — 전체 히스토리 + 모든 브랜치를 받아 `git log`/`blame`이 동작. ref 갱신 fetch의 `--depth 1`도 제거 — 안 그러면 브랜치 조회마다 full clone을 다시 shallow로 만듦
- **feat(git): 클론 시 선택적 브랜치 입력 (`bf2d2aa`)** — 폼이 브랜치를 받고 백엔드가 ref 이름을 검증(안전 문자, 선행 대시 금지로 `--arg` 주입 차단) 후 `git clone --branch`에 전달. 비우면 저장소 기본 브랜치

### 07-24 — PR 리뷰 세션 (설계 16절)

- **feat(review): PR 리뷰 세션 백엔드 — 클론·폴링·로컬 머지 (`b6a84fb`)** — private/room/wiki와 나란한 관리자 생성 세션 타입: `review_repos`(감시 원격) + `review_sessions`(열린 PR당 1개) 스키마, GitHub/GitLab/Bitbucket Cloud PR/MR 조회 어댑터, 매니저(full clone, 호스트 폴링, PR별 git 워크트리, 로컬 `--no-ff` 머지 — 충돌은 리뷰용으로 트리에 남김, 작성자→로컬 유저 매칭), `/api/review/{repos,sessions}`(관리자 생성/폴/삭제, 작성자 읽기 전용), 리뷰 턴은 PR 워크트리 cwd에서 실행(비동기 `cwdFor`), io의 관리자 쓰기/작성자 읽기 게이팅 + `review:changed` 방송, `REVIEW_POLL_MS` 인터벌 + 수동 새로고침, 부팅 orphan 리퍼
- **feat(review): PR 리뷰 UI — 사이드바 섹션, 헤더 컨트롤, 읽기 전용 (`6572ba3`)** — store(리뷰 저장소/세션 상태, `openReview`, 저장소 추가/삭제/폴, 로컬 머지, `review:changed` 실시간 갱신), 사이드바 "코드리뷰" 섹션(관리자는 감시 저장소 + 중첩 PR 세션 + 폴/삭제/추가 모달, 멤버는 자기 읽기 전용 PR), 채팅 리뷰 헤더(PR 링크, base←head, 머지 상태, 관리자 로컬 머지 버튼, 읽기 전용 배지)와 읽기 전용 작성자를 위한 입력창/모델/모드 잠금
- **feat(demo): 정적 데모에 PR 리뷰 섹션 반영 (`88630ac`)** — 감시 저장소(acme/webapp) + 머지/빌드/리뷰 대화가 담긴 PR 리뷰 세션 2개 시드, `/api/review/*` 목
- **docs(review): PR 리뷰 세션 문서화(README ko/en, DESIGN, .env) (`48e061e`)** — DESIGN 16절(폴링 모델, 호스트 어댑터, 워크트리 로컬 머지, 관리자/작성자 읽기 전용 가시성, 확장 seam), `REVIEW_POLL_MS`
- **fix(review): PR 폴링 HTTP 타임아웃, 작성자 매칭 한계 문서화 (`80b802c`)** — 호스트 API fetch에 `AbortSignal.timeout(20s)`를 걸어 멈춘 호스트가 `createRepo`를 막거나 저장소 폴 락을 물고 늘어지지 않게(`finally`가 항상 실행 → 폴링 락 항상 해제), `matchAuthor`에 신뢰 팀 사용자명 매칭이라는 전제와 업그레이드 경로(관리자 호스트 로그인→유저 매핑 / 검증된 이메일) 주석. 적대적 리뷰의 MEDIUM 2건 반영(CRITICAL/HIGH 0)

### 07-27 — PR 리뷰 전자동 파이프라인 · 샌드박스 · 사용량 미터 · 모바일

- **feat(review): 전자동 파이프라인 — 머지→빌드/실행→리뷰→verdict (`96c38b9`)** — PR 감지 시(`REVIEW_AUTO` 기본 on) 채팅 없이 전 과정 실행: 로컬 머지 후 **무인 에이전트 턴**(리뷰 세션은 `makeAutoAllow`로 도구 자동 허용, 클래스1 펜스는 유지)이 빌드/실행·버그 감지·diff 리뷰를 하고 `VERDICT: MERGE_SAFE|DO_NOT_MERGE`를 출력, `runTurn`의 `onDone`(FIFO 큐로 전달)이 verdict + summary를 파싱해 저장. 머지 충돌이면 verdict=conflict로 빌드/리뷰 생략. `approvePr()`은 관리자 명시 동작으로 호스트 API를 통해 **원격에서 실제 병합**. `POST /sessions/:id/auto|approve`, `REVIEW_AUTO` 토글
- **feat(review): 자동 파이프라인 UI — verdict + 재실행 + 원격 머지 (`c91e30e`)** — store에 verdict/요약 + `autoReviewRun`/`approveReview`, 헤더의 VERDICT 배지(running/merge-safe/hold/conflict)와 요약 툴팁, 관리자 "자동 리뷰 실행"·"PR 병합(원격)"(확인 대화), 사이드바 배지, i18n, 데모 목
- **docs(review): 자동 파이프라인 + 원격 머지 문서화 (`eca05ec`)**
- **fix(review): 자동 턴에서 git PAT 배제 + 재진입 가드 (`1aa4d54`)** — 적대적 리뷰 결과(CRITICAL 1, HIGH 1, MEDIUM 1) 반영:
  - **CRITICAL**: 리뷰 턴은 Bash 자동 허용 상태로 PR이 통제하는 코드를 빌드/실행하므로 병합 권한 git 자격증명을 더 이상 주입하지 않음(`kind=review`는 `buildGitEnv` 생략). 리뷰는 절대 push하지 않고 원격 머지는 호스트 API를 씀
  - **HIGH**: `autoReview()`가 로컬 머지부터 턴의 `onDone`까지 리뷰별 in-flight 가드를 유지 — 재실행이 살아 있는 턴 아래에서 워크트리를 `git reset`/머지 하거나 verdict를 경합할 수 없음. verdict=running 동안 재실행 버튼 비활성
  - **MEDIUM**: verdict는 PR 내용에 유도될 수 있는 **자문 성격의 LLM 의견** — approve 확인 대화가 관리자에게 diff를 먼저 읽으라고 안내
  - 잔여 한계(자동 실행이 PR 코드를 실행, env의 Claude 토큰, 신뢰 못 할 저장소는 `REVIEW_AUTO=0`, 샌드박스가 업그레이드 경로)를 `makeAutoAllow`와 README 보안 posture에 문서화
- **fix(review): 새 PR 커밋에 재리뷰 + 비-라이브 클라이언트에 턴 전달 (`78c7f2c`)** — (1) `pollRepo`가 기존 리뷰 세션의 head SHA 변경을 감지해 verdict를 리셋하고 노트를 남기고 파이프라인을 재실행(재진입 가드로 중첩 방지). (2) "안 보고 있으면 히스토리가 없어진다" — 메시지는 항상 서버에 저장되고 있었고(무인 자동 리뷰 대화가 DB에서 리로드됨 검증) 구멍은 턴 도중 구독하지 않은 클라이언트로의 라이브 전달: 서버가 진행 중 턴의 부분 블록을 추적해 `session:join` ack에서 재생하고, 클라이언트는 소켓 (재)연결 시 열린 세션에 재조인 + 메시지 재조회
- merge: PR #2 `feat/pr-review-auto` (`fbd2d10`)
- **fix(review): 재접속 시 stale live 제거 + 실행 중 push는 재리뷰 예약 (`308c676`)** — (A) `applyJoinState`가 항상 `live`를 설정(진행 중 턴이 없으면 null)해 턴 종료 후 재접속이 유령/중복 LiveView를 남기지 않음. (B) 파이프라인 실행 중 도착한 push의 head를 재진입 가드가 조용히 버리지 않고 `rerunPending`에 기록해 진행 중 실행이 끝나면 재리뷰 — 새 커밋이 실제로 새 verdict를 받고 "다시 리뷰합니다" 노트가 실제 동작과 일치
- **fix(review): 자동 리뷰는 항상 새로 실행, 이전 리뷰를 resume 하지 않음 (`1601682`)** — "재리뷰가 새 커밋을 안 봤다"의 근본 원인: `autoReview`가 세션에 저장된 `claudeSessionId`로 턴을 enqueue 해 재리뷰가 첫 리뷰의 대화를 **resume**. 모델이 자기 이전 verdict를 보고 "같은 작업"이라 판단해 typecheck/빌드만 슬쩍 하고 낡은 결과를 재제출 — 갱신된 워크트리를 다시 읽지 않음(DB head_sha == 푸시된 SHA 확인). 자동 리뷰 턴마다 `chat_sessions.claude_session_id`를 비워 매 실행이 현재 머지된 워크트리를 처음부터 보는 새 대화가 되게 수정
- **fix(review): 멈춘 자동 리뷰가 스스로 회복하는 워치독 (`3c630de`)** — 재리뷰 턴이 멈춰(claude 서브프로세스 없음, 출력 0) verdict가 'running'에 박히고 `autoRunning` 가드가 해제되지 않아 재시작 없이는 재실행 불가. 원인이 일시적 SDK/턴 정지라 해법은 경계값: `REVIEW_TURN_TIMEOUT_MS`(기본 10분) 워치독이 타임아웃 시 턴을 중단하고 verdict=error, 노트 게시, 가드 해제. `settled` 플래그로 `done()`/`onDone`/워치독을 멱등하게(먼저 발화한 것이 이김)
- **fix(review): 워치독이 워크트리 가드를 조기 해제하지 않도록 (`8028893`)** — PR #3 코드 리뷰 지적: 타임아웃 시 `interruptTurn`(비동기 abort) 직후 가드를 해제해 대기 중 재리뷰의 `git reset --hard`/머지가 아직 종료 중인 턴과 같은 PR 워크트리에서 경합 가능. 이제 워치독은 턴 중단과 verdict 기록만 하고, 가드 해제와 대기 재리뷰는 오직 턴의 `onDone`(abort teardown이 서브프로세스 종료 후 발화)이나 턴 이전 조기 종료에서만. `setFinal()`이 verdict 기록을 멱등하게, `done()`의 Set.delete 가드가 재실행을 최대 1회로
- **feat(review): PR 빌드/테스트를 격리 샌드박스 컨테이너에서 (`768121e`)** — 리뷰 턴이 신뢰할 수 없는 PR 빌드/테스트 코드를 앱 컨테이너(Docker 소켓 마운트 ≈ 호스트 root)에서 실행하지 않도록:
  - `review/sandbox.ts` — PR별 잠근 형제 컨테이너(워크트리만 볼륨 서브패스 마운트, **Docker 소켓 없음**, CapDrop ALL, no-new-privileges, 메모리/pid 제한, 이미지 온디맨드 pull). 그 안에서 exec 하는 인프로세스 MCP 툴 `mcp__sandbox__run` 노출
  - 리뷰 턴은 호스트 `Bash`를 `disallowedTools`로 막고 샌드박스 `run`만 받음 — PR 코드는 격리 안에서만 실행. Docker 부재 시 호스트 실행 폴백(신뢰 팀 한계). 샌드박스는 턴 종료 시 제거, orphan은 부팅 시 reap
  - `config-layering`이 `mcpServers`/`disallowedTools`를 SDK 옵션으로 전달, `autoPrompt`가 샌드박스 툴로 빌드/실행하되 이미지가 빌드 못 하는 스택(.NET Framework/Windows 전용, 툴체인 부재)은 정적 리뷰만 하고 verdict에 "빌드 미실행" 명시. `REVIEW_SANDBOX_IMAGE`/`_MEM_MB`/`_EXEC_TIMEOUT_MS`
- **fix(review): 샌드박스가 저장소 디렉터리를 실제 경로에 마운트해 git이 동작하게 (`033afd6`)** — git 워크트리의 `.git` 파일이 메인 클론의 gitdir을 절대 경로로 참조하므로 워크트리만 마운트하면 샌드박스 안 `git diff`/`git log`가 깨짐(호스트 Bash가 막혀 리뷰 에이전트가 거기서 git을 씀). `reviews/<id>` 디렉터리 전체를 실제 절대 경로에 마운트(서브패스 스코프)하고 cwd는 워크트리로 — git 메타데이터가 해석됨
- merge: PR #3 `fix/review-repoll-and-live-delivery` (`c876330`)
- **fix(review): 자동 리뷰는 환경을 추측하지 말고 주입된 샌드박스 툴로 빌드 (`0dedf93`)** — 프롬프트가 에이전트에게 호스트 점검(`docker` CLI 존재 여부 등)으로 빌드 가능성을 판단하게 둬 성급히 "빌드 미실행(환경 제약)"을 선언. 샌드박스는 dockerode로 소켓 위에 `mcp__sandbox__run` 툴로 노출되므로 **툴 목록에서의 존재 여부가 유일한 신호**. 툴이 있으면 항상 그 안에서 빌드하고, 실제로 시도한 뒤에만 환경 제약을 주장하도록 1단계 재작성
- **feat(review): 완료된 자동 리뷰를 PR 코멘트로 게시 (`60df2ce`)** — verdict가 나오면 판정 라벨 + 요약 + 리뷰 본문을 PR 자체에 게시(GitHub issue comment / GitLab MR note / Bitbucket PR comment, 같은 병합 권한 자격증명). `postComment()`를 세 호스트에 구현, `postReviewComment()`는 enqueueTurn의 `onDone`에서 호출되되 **이번 턴이 verdict를 산출한 경우에만**(`setFinal`이 boolean 반환) — 워치독 타임아웃된 부분 리뷰는 게시하지 않음. best-effort라 실패는 시스템 노트로만 기록하고 파이프라인을 깨지 않음. `REVIEW_COMMENT`(기본 on)로 내부에만 두는 것도 가능
- merge: PR #4 `feat/review-pr-comment` (`0b183e0`)
- **feat(usage): 채팅 헤더에 세션 컨텍스트 윈도우 + claude.ai 플랜 한도 (`123312f`)** — CLI의 `/usage`를 비추는 팝오버: 세션별 컨텍스트 윈도우 사용률(`getContextUsage`), claude.ai 플랜 레이트 리밋(5시간/주간/모델별)과 리셋 카운트다운(`usage_EXPERIMENTAL` SDK 컨트롤 호출, API 키 세션은 불가). 서버 `probeUsage()`가 `probeCommands`의 단명 질의 트릭(세션 resume → CLI 컨트롤 채널 질의 → abort)을 15초 TTL 캐시와 함께 재사용, `GET /api/sessions/:id/usage`. 프론트 `UsagePill`(Radix popover) + i18n + 데모 목
- **fix(usage): 요청자별 사용량 캐시 키 + 세션 전환 시 stale pill 제거 (`e40b0ce`)**
- merge: PR #5 `feat/session-usage-meter` (`7f5f6ed`)
- **feat(mobile): 웹 UI 전면 반응형 레이아웃 (`b6e8e22`)** — 사이드바가 `<md`(768px)에서 오프캔버스 드로어가 되고 모든 상단바의 햄버거로 토글(백드롭 + 닫기, 내비게이션·패널 전환 시 자동 닫힘, store `sidebarOpen`), Shell 그리드는 `≥md` 2컬럼 / `<md` 단일 + 드로어, 폰에서는 채팅 전용 강제(분할 뷰와 code-server iframe이 그 폭에서 무용, 위키 출처 패널 숨김 — 인라인 인용은 유지)하고 헤더가 pill을 wrap 하며 뷰 모드 세그먼트를 숨김, `FileExplorer` 모달은 `<md`에서 트리/미리보기 세로 스택, 로그인·플러그인 설치 폼·git 자격증명·관리자 유저 그리드·사용량 표를 좁은 화면에서 유동/스크롤 가능하게, 채팅 스트림/입력창/배너 좌우 패딩 축소, `useIsMobile` 훅 + `MobileMenuButton` 신설
- merge: `feat/mobile-ui` 병합 (`b6a06e6`)
- **docs(claude): 모든 프론트 UI 변경에 반응형/모바일 필수 규칙 (`6ed6f9d`)** — 작업 규칙 9: 가로 body 스크롤 금지, 고정 그리드 대신 `md:` 분기, 드로어 + `MobileMenuButton` + `useIsMobile` 패턴, 폰에서 무의미한 뷰 숨김, 모바일 뷰포트에서 실제 검증

### 07-28 — 방 채팅 분리 · 인터럽트 · `@` 자동완성 · 관리자 설정 레지스트리

- **docs(spec): 방 채팅 vs Claude 지시 구분 설계 (`83bba34`)**
- **feat(rooms): 팀 채팅과 Claude 지시 분리 (`422ef8c`)** — 입력창 모드 토글(채팅 / Claude, 기본 채팅, 방별 유지). 채팅 메시지는 방송 + 저장만 하고 Claude 턴을 만들지 않음. `@claude`/`@클로드`를 치면 지시 모드로 전환. 선택적 '채팅 포함'이 마지막 턴 이후 쌓인 팀 채팅을 프롬프트 컨텍스트로 주입. Claude 지시 메시지엔 배지. `messages.chat` 컬럼(멱등 마이그레이션), `chat:send`에 chat/includeChat 확장, 턴 없는 방송용 `postChat()`
- **fix(rooms): 채팅 메시지는 삭제 전용 + 같은 ms 채팅도 컨텍스트에 포함 (`f7f5368`)** — 리뷰 후속: `chat=1` 메시지의 편집 어포던스를 숨김 — 편집이 chat 플래그 없이 `chat:send`를 재발행해 **의도치 않은 Claude 턴**을 쏘고 `/edit`으로 이후 방 히스토리를 전부 잘라냈음. 채팅은 가벼운 것이니 삭제 전용, 재생성 없음. `includeChat` 경계를 `gt` → `gte`로 바꿔 마지막 지시와 같은 밀리초에 쓰인 팀 채팅이 컨텍스트에서 영구 누락되지 않게(경계 행은 `chat=0`이라 `chat=1` 필터에 걸려 재주입되지 않음)
- **fix(session): 중단/인터럽트가 실제로 실행 중 턴을 멈추게 (`6ec7012`)** — 인터럽트가 배선은 끝까지 돼 있었지만 `abortController`에만 의존했고, 그건 CLI stdin을 닫고 graceful 경로를 ~2초 기다릴 뿐이라 모델이 계속 스트리밍돼 "중단"이 죽은 것처럼 느껴짐. `runReal`의 루프도 abort 신호를 확인하지 않았고(`runMock`과 달리), 레이트 리밋 백오프 중 중단은 타이머를 끝까지 잤음. `interruptTurn`이 SDK 컨트롤 채널의 `query.interrupt()`를 즉시 발화(abort는 서브프로세스 teardown 폴백으로 유지), `runReal`이 Query 핸들을 노출(`onQuery`)하고 abort 신호 즉시 스트림 루프를 탈출, 루프 후 가드가 깨끗한 interrupt 종료를 aborted 턴 경로로 보내 부분 결과를 interrupted로 저장, `withRateLimitRetry`가 AbortSignal을 받아 백오프 수면을 단축. 실제 SDK 검증: `q.interrupt()`가 ~11ms에 resolve, 이후 토큰 0, 제너레이터는 ~0.6초에 완전 정지
- **feat(chat): 입력창의 `@` 파일/폴더 참조 자동완성 (`6bc9a74`)** — 프로젝트가 붙은 채팅에서 `@`를 치면 파일·폴더 퍼지 검색 미리보기 메뉴(폴더는 평면 트리 엔드포인트에서 유도), `/` 커맨드 팔레트와 동일한 조작. 선택하면 `@경로` 참조를 삽입, Enter/Tab/방향키 + Escape. 문장 중간에서도 동작하고 방의 `@claude` 멘션과 공존. 기존 `GET /api/projects/:id/tree` 재사용, i18n, 데스크톱 + 375px 검증
- **fix(chat): 키보드 이동 시 강조된 커맨드/`@` 행을 뷰로 스크롤 (`c3e950c`)** — 방향키가 선택만 옮기고 목록을 스크롤하지 않아 강조가 화면 밖으로 사라짐. 모듈 스코프 콜백 ref(`scrollIntoView block:'nearest'`)를 강조 행에 적용(슬래시 팔레트와 `@` 피커 양쪽). 메뉴가 실제로 스크롤될 만큼 데모 프로젝트 트리도 보강
- **fix(session): stop/cancel이 죽어 있던 이유 — `ack?.()` 단락 (`daf99ab`)** — `chat:interrupt`/`chat:cancel` 핸들러가 부작용 호출을 옵셔널 체이닝 ack **안에** 뒀음: `ack?.({ ok: interruptTurn(p.sessionId) })`. 클라이언트는 ack 콜백 없이 emit 하므로 `ack`는 undefined이고, 옵셔널 체이닝은 단락해 **인자를 평가하지 않음** — `interruptTurn()`/`cancelQueued()`가 아예 호출된 적이 없음. 앞선 인터럽트 로직이 맞아 보이는데도 프로덕션에서 아무 일도 안 한 이유. 호출을 별도 문장으로 끌어올리고 결과를 따로 ack
- **feat(review): 문서만 바뀐 PR은 머지/빌드/실행 생략 (`0010237`)** — 파이프라인 전에 PR 변경 파일을 읽어 전부 비-소스(마크다운/텍스트/이미지/LICENSE)면 로컬 머지와 샌드박스 빌드/실행을 건너뛰고 노트와 함께 MERGE_SAFE. 모르는 파일은 소스로 세므로 진짜 코드 PR은 항상 전체 파이프라인
- **feat(config): 모든 런타임 설정을 위한 관리자 설정 레지스트리 (`b56e82b`)** — `server/src/lib/config-registry.ts` 하나가 모든 운영 노브의 단일 진실원. 해석 순서 DB 오버라이드 → env → 기본값. 런타임 소비자가 `cfg.int/str/bool`로 **라이브** 읽기라 관리자 편집이 재시작 없이 적용(턴 캡 세마포어, 리뷰 폴러, code-server 리퍼가 `applyLive` 훅으로 재무장). env는 이제 기본값 시드일 뿐. `GET/PUT/DELETE /api/admin/config`(그룹·타입·시크릿 마스킹), 공개 `GET /api/config`가 모델 드롭다운 구동, AdminPanel의 그룹별 라이브 편집 UI(재시작 배지, 리셋), env + 하드코딩 상수(git/provider 타임아웃, 샌드박스 한도, 세션 TTL, 재시도/백오프, 사용량 probe, 기본 모델) 이관, 인프라(포트/dataDir/TLS/docker) + 시크릿은 읽기 전용 표시
- merge: `feat/admin-config-registry` (`a4dd6f7`)
- **feat(config): 친절한 라벨/설명, 객체 편집기, 이미지 pull, 재시작 (`0ed0ba8`)** — (1) 키별 표시명 + 설명을 i18n(`cfg.<key>`/`cfgDesc.<key>`, ko+en, 없으면 raw 키 폴백)에서, (2) object/array JSON 설정(모델 맵)용 구조 편집기 — 키/값 행 추가·삭제 + 배열·raw JSON 폴백, (3) Docker 이미지 설정(code-server / 리뷰 샌드박스)에 존재 확인 + pull/업데이트(레지스트리 이미지 값으로 allowlist, `POST /api/admin/image/inspect|pull`), (4) 재시작 버튼 + "재시작 필요" 배너(`POST /api/admin/restart`가 `process.exit`, docker 재시작 정책이 되살림). `lib/docker-images.ts` 추가
- merge: `feat/admin-config-ux` (`a19c330`)
- **feat(admin): 설정 그룹을 드롭다운으로 접기 (`bea431f`)** — 각 카테고리(Claude/턴, 리뷰, git, code-server, 인증, 서버, 인프라, 시크릿)를 항상 펼쳐진 카드 대신 캐럿 + 항목 수를 단 접힌 `<details>`로. JS 0줄, 접근성 유지, 모바일 대응

### 07-29 — 로컬 세션 가져오기 + 워크스페이스 확장 10종

- **docs(import): 로컬 세션 가져오기 설계 스펙 (`0eae20a`)** — 프로젝트 + `~/.claude` 세션 파일
- **docs(import): 구현 계획 (`eb335df`)**
- **feat(import): 순수 세션 임포트 모듈(encode/rewrite/backfill) + 스테이징 경로 (`c83b85e`)**
- **feat(import): 스테이징 + 확정 엔드포인트 (`b793f40`)** — `POST/DELETE /api/import/staging/:sid`(파일 + 슬롯 화이트리스트 + 취소), `GET …/sessions`(로컬 세션 탐색), `POST /api/import/sessions`(프로젝트 배치 + cwd 재작성된 jsonl + 백필), 부팅 시 `reapImportStaging()`. 목적지 slug는 서버가 `encodeSlug(path.resolve(dest))`로 계산 — **클라이언트 경로는 신뢰하지 않음**. 전 라우트 `requireAuth`, `validSid`, `safeRelPath`
- **feat(import): store `importSessions` 액션 + i18n ko/en (`f8a3a86`)**
- **feat(import): `ImportSessionModal`(gitignore 트리 + `.claude` 가이드 + 세션 피커) (`c1c93cb`)** — 다단계 모달: project(폴더 선택/드롭, 업로드는 아직 안 함 — 루트 `.gitignore`가 기본 체크를 시드), tree(gitignore/.git 인지 체크박스 트리 + 디렉터리 캐스케이드, `CLAUDE.md`와 `.claude/*`는 강제 체크 + 잠금, 체크된 파일을 slot=project로 업로드), claude(`.claude` 폴더 피커 자동 열기 + slug 인코딩 가이드, 건너뛰기 가능, slot=claude 업로드 후 세션 목록), sessions(전체 선택 체크박스 목록 + 프로젝트 이름 → 확정). 취소/닫기는 스테이징 폐기
- **feat(import): 데모 목 (`68e217a`)**
- **docs(import): README 기능 항목(en/ko) (`e08436c`)**
- merge: `feat/local-session-import` (`35e5497`)
- **feat(import): 업로드 파일 트리의 디렉터리 행 접기 (`f18bef8`)**
- **feat(tree): `FileExplorer` + 가져오기 트리에 전체 펼치기/접기 (`0f899dc`)**
- **fix(import): 파일별 업로드 + 2단 진행바, 자동 피커 제거, macOS 숨김 폴더 힌트 (`f44daa8`)** — 하나의 거대한 multipart 대신 요청당 파일 하나로 업로드 — 큰 `~/.claude` 폴더의 'Payload Too Large' 해결(트랜스크립트 하나가 20MB+, slug 디렉터리 전체는 수십 MB). 공유 `<UploadProgress>`(바이트 기준 전체 바 + 파일 카운터 + 현재 파일 바), 세션 가져오기와 위키 스테이징 업로드에 적용. `.claude` 폴더 피커 자동 열기 제거(macOS에서 가이드 팝업을 가림), 가이드에 macOS 숨김 폴더 단축키(Cmd+Shift+.) 표시, `uploadMaxMB` 기본 50 → 200
- **feat(admin): 세션 가져오기 기능 플래그 + 설정 추출 가이드라인 (`c675112`)** — `sessionImportEnabled`(config-registry, 그룹 'features', 라이브 토글), `publicConfig`가 노출하고 import 라우트가 게이트(꺼지면 403), 사이드바가 버튼 숨김. i18n `cfg`/`cfgDesc`/`cfgGroup.features`. **CLAUDE.md 규칙 10**: 새 기능의 튜닝 상수·기능 플래그는 config-registry `DEFS`에 등록하고 `cfg.*`로 라이브 읽기, 서버 측도 반드시 게이트
- **docs(claude): 브랜치 작업은 명시적 지시 없으면 main 자동 병합 금지 (`9a27d4c`)**
- **feat(review): 저장소별 샌드박스 빌드 이미지 + 전역 폴백 (`1aba1cd`)** — 모든 프로젝트를 전역 이미지 하나(node:20-bookworm)로 돌려 Python/Rust 등은 맞는 툴체인이 없었음. 저장소 등록 시 선택적 `sandbox_image`(nullable)를 고르고 `ensureSandbox`가 비어 있으면 전역 `reviewSandboxImage`로 폴백. 기존 저장소는 동작 변화 없음(null → 전역 기본)
- **feat(review): 등록된 리뷰 저장소 편집(이름/base/이미지/자격증명) (`2dbfb3a`)** — `PATCH /api/review/repos/:id` + `updateRepo()`로 비파괴 필드 제자리 수정. `gitUrl`/provider/host는 불변(다른 저장소 = 삭제 후 재등록), `credentialId`는 `createRepo`와 동일하게 호스트 바인딩 + 스코프 재검증, base/이미지를 비우면 null로 초기화. 저장소 행의 연필 아이콘이 편집 모달(자격증명 기본값은 "현재 유지")
- merge: PR #6 `feat/per-repo-review-image` (`5e6455e`)
- **fix(review): 중단된 자동 리뷰 자가 회복(타임아웃 재시도 + 부팅 복구) (`0eeba85`)** — 리뷰가 중간에 멈추는 근본 원인: 워치독이 10분 기본값에서 **아직 작동 중인** 턴을 죽이고 verdict=error로 표시했는데 돌아올 길이 없음(폴링은 새 PR/head 이동에만 반응) — 시간이 더 필요했을 뿐인 정상 빌드+실행+리뷰가 좌초.
  - `reviewTurnTimeoutMs` 기본 10분 → 30분(빌드+실행+리뷰는 10분 이상 필요, 샌드박스 exec만 명령당 5분 허용). 관리자가 최대 2시간까지 조정 가능
  - 새 `reviewMaxRetries`(기본 2): 워치독 타임아웃 시 리뷰를 'running'으로 두고 최대 N회 자동 재시도(실제 턴 teardown 시 `done()`에서 발화) 후 종료 에러
  - 부팅 복구: `recoverInterruptedReviews()`가 프로세스 재시작으로 verdict='running'에 남은 모든 열린 리뷰를 재큐잉(인메모리 가드·워치독·서브프로세스가 옛 프로세스와 함께 죽었고 폴링은 되살리지 않음). `reviewAuto`가 꺼져 있으면 대신 interrupted로 표시해 상태가 오해를 부르지 않게
  - `onDone` 전에 샌드박스 teardown을 await: `removeSandbox`가 바인드 마운트된 워크트리에 아직 쓰고 있을 빌드 컨테이너를 강제 제거한 **뒤에** 재실행의 `git reset --hard`/머지가 그 워크트리를 건드리게 — 재시도 경로의 경합 차단
  - `forgetReview()`: 리뷰/저장소가 파이프라인 도중 삭제되면 `autoRunning`/`rerunPending`/attempts를 정리해 인메모리 집합에 죽은 id가 새지 않게
  - 적대적 동시성 검증 패스로 발견된 항목들
- **chore: `bash.exe.stackdump` 크래시 덤프 무시 (`698d18b`)**
- **feat(admin): 관리자 패널 탭 분할(개요/유저/제공자/사용량/설정) (`063e0eb`)** — 한 줄 스크롤을 탭 레이아웃으로. `TABS` 배열이라 이후 탭(cleanup, approvals, processes, providers) 추가가 한 줄. 순수 프론트 재구성 — 동작/API 변경 없음
- **feat(mypage): 마이페이지 신설(아바타/토큰/git 자격증명/프로젝트) (`9b00a83`)** — 프로필 이미지 업로드·Claude 토큰·git 자격증명·개인 프로젝트 관리를 'me' 패널로 통합, 토큰·git 자격증명 진입점을 사이드바 푸터에서 클릭 가능한 프로필 행으로 이동, users에 아바타 컬럼 + 인증 라우트로 스트리밍. **보안**: 스트리밍 층 크기 상한(413), mime + 매직바이트 검증, mime 유래 디스크 파일명(경로 탈출 안전), `safeName`이 전부 점인 프로젝트명 거부, nosniff 헤더
- **feat(effort): 세션별 모델 추론 effort 선택 (`b36bc11`)** — 모델 선택기 옆 effort pill(low/medium/high/xhigh/max)이 SDK `Options.effort`에 연결. `chat_sessions.effort` 컬럼, `defaultEffort` 관리자 설정, PATCH 검증, 데모 목. 미지원 모델은 조용히 강등
- **feat(chat): 프롬프트에 파일 첨부 + 클립보드 스크린샷 붙여넣기 (`d8301b3`)** — 허용된 루트 안 세션별 `.attachments` 디렉터리에 업로드하고 절대 경로를 턴 프롬프트 앞에 붙여 에이전트가 Read(이미지는 시각적으로)하게 함. 입력창의 첨부 버튼·붙여넣기 핸들러·드래그드롭·썸네일 칩, 트랜스크립트의 첨부 칩. **보안**: 스트리밍 층 크기·개수 상한, 원자적 배타 쓰기, basename 소독기(경로 탈출/RLO/ADS/윈도우 예약어), 방 GET 멤버십 게이트, nosniff. 설정 `attachmentMaxMB`/`Count`
- **feat(admin): 호스트 Docker 리소스 정리(스캔/개별/전체 초기화) (`6cd1ddd`)** — Resources 탭: 읽기 전용 인벤토리 스캔(ccw 컨테이너, 참조된 + dangling 이미지, orphan 리뷰/첨부 디렉터리, orphan DB 행)과 정리 동작. 전체 초기화는 spawn된 컨테이너 + dangling 이미지 + 진짜 orphan만 제거하고 **유저 데이터는 절대 건드리지 않음**(모듈 로드 시 assertion으로 강제). 안전장치: `rmSync`는 데이터 루트 아래로 경로 봉쇄, dangling 전용 prune, orphan은 동작마다 서버가 재유도, 10분 클론 유예 가드, 관리자 + `resourceCleanupEnabled` 게이트, 전체 초기화는 이중 확인
- **feat(provider): LLM provider 오버라이드(bedrock/vertex/커스텀 base URL) (`11cec38`)** — 유저별 + 관리자 공통 provider 프로필이 턴 서브프로세스 env를 구성(Anthropic/Bedrock/Vertex/커스텀 base URL). 커스텀 base URL이 Anthropic 호환 변환 프록시를 통한 OpenAI/ChatGPT/로컬 LLM 경로. provider 미설정 시 기본 Claude 토큰 경로 그대로. 시크릿은 AES-GCM 암호화, 반환·로깅 안 함. `buildOptions`가 적용 전에 **모든** provider env를 비워 호스트 전역 변수가 기본/mock 턴에 새지 않게. `requireAdmin`/`requireAuth` + `llmProvidersEnabled` 게이트
- **feat(requests): 멤버 요청 → 관리자 승인 워크플로 (`b962d99`)** — 액션 레지스트리를 가진 범용 승인 프레임워크(요청 가능한 관리자 동작을 한 곳에서 추가). 멤버가 사유와 함께 타입별 요청(common_project / wiki_topic / role_upgrade)을 제출하고 관리자가 새 탭에서 승인/거부, 승인 시 재사용된 create 함수로 실제 실행. **인가**: 결정은 관리자 전용, `role_upgrade`는 요청자 본인만 승격(payload 대상 없음), `WHERE status='pending'` 원자적 claim으로 최대 1회 실행, 멤버는 자기 요청만 조회. `approvalsEnabled` 게이트
- **feat(admin): 실시간 활동/프로세스 관리 탭 (`561e470`)** — 실행 중 Claude 턴, 대기 메시지, code-server 에디터 + 리뷰 샌드박스 컨테이너, 실행 중 리뷰 파이프라인을 행별 컨트롤(인터럽트/취소/kill)과 함께 보여주는 라이브 작업 관리자. Docker 없이도 읽기 전용 스캔은 degrade, 열려 있는 동안 자동 폴링(`processPollMs`). 기존 `interruptTurn`/`cancelQueued`/`killEditor`/`killSandbox` 재사용
- **feat(dm): 간단한 DM + 그룹 채팅 채널(방으로 승격) (`74bb92b`)** — Claude 없는 사람 전용 경량 메시징: Socket.IO 위의 1:1 DM과 그룹 채널, 전 유저 사용 가능. 사이드바 Messages 섹션 + `DmView`(안 읽음 배지), 관리자는 그룹 채널을 공통 프로젝트 방으로 승격. 모든 읽기/쓰기/소켓 경로가 멤버십 게이트, 승격은 관리자 전용, 소켓 페이로드 문자열 강제 변환(크래시 DoS 방지), 메시지 길이 상한, `dmEnabled` 게이트
- **feat(ui): 손으로 만든 통일 SVG 아이콘 세트, 단독 크롬 이모지 교체 (`ec5d444`)** — `web/src/lib/icons.tsx`: Svg 래퍼 하나에서 나오는 Feather/Lucide 스타일 아웃라인 아이콘 43개(currentColor, 1.75 stroke, size prop, title/aria). 16개 컴포넌트의 단독 크롬 글리프(메뉴/뒤로/닫기/셰브런/새로고침/휴지통/편집/첨부/상태 점/Claude sparkle 등) 교체. 콘텐츠·문서·데모 이모지는 유지
- **feat(ui): i18n 라벨 탈이모지화, 호출부에서 SVG 아이콘 렌더 (`21dc2af`)** — i18n 문자열 값에 박혀 있던 장식 이모지(관리자/플러그인/마이페이지 제목, 모드·verdict·툴 상태 라벨 등)를 제거하고 그대로인 텍스트 옆에 대응 아이콘 컴포넌트를 렌더. `MODES`/`VERDICT_UI`/`ToolCard` 맵이 Icon을 지니고 Modal 제목이 ReactNode로 확대. 아이콘 5개(user/crown/shield/bolt/link) 추가. 진짜 콘텐츠 기호(→, ＋, ⌘⇧)만 남김 — 이모지→통일 SVG 전환 완료

### 07-30 — 요청 흐름 마감

- **feat(requests): 공통 프로젝트 생성을 실제 폼과 동일한 입력으로 요청-게이트 (`dfbc5ae`)** — 멤버는 공통(공유) 프로젝트를 직접 만들 수 없고, 공유 `ProjectCreateForm`이 멤버+공통 제출을 `POST /api/projects`(비관리자의 scope=common은 여전히 403) 대신 승인 흐름으로 라우팅. 요청이 **실제 생성 UI와 같은 필드**(이름 + git 클론 URL + 브랜치 + 자격증명 피커)를 실어 나르고, 승인 시 `common_project` 액션이 요청자로서 실제 클론을 수행. `createProject`/`validateProjectInput`을 추출해 라우트와 액션이 공유하되 제출·실행 양쪽에서 자격증명 소유권 + 호스트 매칭 검사 보존. 폼은 채팅 프로젝트 메뉴(개인/공통 토글)와 마이페이지에서 재사용
- merge: 워크스페이스 확장 — 10개 기능 그룹 + 공통 프로젝트 요청 흐름 (`9397a48`)
- **docs(readme): 캡처 기반 기능 투어 갤러리 23장 (`c4c2f0f`)** — 정적 데모(MOCK 모드, 실제 UI)에서 캡처한 `docs/screenshots/*.png`로 전 기능 커버(채팅/툴 카드, 웹 권한 프롬프트, 사용량 미터, 슬래시 + `@` 메뉴, 방 + 위임, DM/그룹, git 패널, 분할 에디터, LLM Wiki + 출처, PR 리뷰 verdict, 마이페이지, 관리자 전 탭, 플러그인, i18n(ko), 모바일/PWA). 두 README에 "기능 둘러보기" 섹션 삽입. `main.tsx`가 데모 빌드에서만 zustand store를 window에 노출(프로덕션은 트리셰이킹)해 스크린샷/e2e 도구가 뷰를 결정적으로 조작

### 07-31 — 첫 릴리스 직전 마감

- **fix(login): Enter 제출 시 언어 토글이 눌리던 문제 (`f182546`)** — `LangToggle` 버튼에 type이 없어 submit이 기본값. 로그인 폼의 첫 submit 버튼이라 입력에서 Enter를 치면 로그인 버튼 대신 그게 눌려 언어가 바뀜. `type="button"` 추가
- **feat(chat): 이미지 첨부 클릭 시 원본 크기 라이트박스 (`fe30ac2`)** — Radix Dialog 오버레이(Esc + 포커스 트랩 무료), 배경/이미지 클릭으로 닫힘. 입력창과 트랜스크립트 썸네일 양쪽에 적용
- **fix(chat): IME 조합 중 Enter 전송 무시(한글 마지막 글자 중복) (`90954fd`)** — 한글 음절이 아직 조합 중일 때 Enter를 누르면 제출 + textarea 비우기가 발화하고, 열려 있던 조합이 빈 필드에 마지막 글자를 다시 커밋해 중복. submit/edit/DM 전송 Enter 핸들러를 `!e.nativeEvent.isComposing`으로 가드

---

## 설계 원본과의 차이

[DESIGN.md](DESIGN.md)는 P0–P5 + PR 리뷰까지를 규정한다. 그 뒤 실제로 붙은, 원설계에 없던 축은 다음과 같다.

| 축 | 상태 |
|---|---|
| 유저별 API 키 (15절 "확장 seam") | **구현됨** — 유저별 암호화 토큰 + 작성자별 해석 (07-22) |
| 웹훅 수신 (16절 "미구현") | **구현됨** — 저장소별 시크릿 + 폴링 on/off (v1.7.0) |
| 풀 git GUI (15절 "범위 밖") | **부분 구현** — 커밋·푸시·pull·브랜치·remote·init/publish·diff·히스토리 그래프 (v1.9.0까지) |
| LLM Wiki | 설계 문서 이후 추가된 **4번째 워크스페이스 엔티티** (07-21) |
| DM · 그룹 채팅 | 설계 문서 이후 추가 (07-29) |
| 관리자 설정 레지스트리 | 설계의 "전역설정 튜닝"(P5)을 런타임 편집 가능한 레지스트리로 확장 (07-28) |
| 로컬 세션 가져오기 | 설계 문서 이후 추가 (07-29) |
| 통합 검색 · 단축키 · 우클릭 메뉴 | 설계 문서 이후 추가 (v1.4.0) |
| 가이드 에이전트 | 설계 문서 이후 추가 — 워크스페이스 자체 API를 본인 권한으로 호출 (v1.8.0) |
| 셀프 업데이트 | 설계 문서 이후 추가 (v1.9.0) |
| 비필수 전송 차단 | 설계 문서 이후 추가 — 9채널 개별 제어 (v1.2.0–v1.3.1) |
| SSO / 프록시 헤더 인증 (15절) | 미구현 |
| Postgres · Redis 승격 (15절) | 미구현 |
| CRDT 실시간 협업 편집 (15절) | 범위 밖 유지 |
