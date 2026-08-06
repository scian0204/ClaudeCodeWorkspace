<div align="center">

[English](CHANGELOG.md) · **한국어**

# 업데이트 노트

[DESIGN.md](DESIGN.md) 스펙 확정(2026-07-20)부터 **v1.11.0**(2026-08-06)까지 — 커밋 **236개** 전수 기록.

각 줄은 **제목 · 커밋 해시**만 보이고, 삼각형을 누르면 상세(원인·구현·설정 키)가 펼쳐진다.

</div>

---

## 목차

- [타임라인](#타임라인)
- [Unreleased](#unreleased) — 아직 릴리스되지 않은 커밋
- **1.x 릴리스** — [v1.11.0](#v1110--2026-08-06) · [v1.10.0](#v1100--2026-08-05) · [v1.9.1](#v191--2026-08-05) · [v1.9.0](#v190--2026-08-05) · [v1.8.0](#v180--2026-08-04) · [v1.7.0](#v170--2026-08-04) · [v1.6.0](#v160--2026-08-04) · [v1.5.0](#v150--2026-08-04) · [v1.4.0](#v140--2026-08-03) · [v1.3.1](#v131--2026-08-03) · [v1.3.0](#v130--2026-07-31) · [v1.2.0](#v120--2026-07-31) · [v1.1.1](#v111--2026-07-31) · [v1.1.0](#v110--2026-07-31)
- [초기 개발 (2026-07-20 → 07-31)](#초기-개발--2026-07-20--07-31)
- [설계 원본과의 차이](#설계-원본과의-차이)

---

## 타임라인

| 버전 | 날짜 | 커밋 | 요약 |
|---|---|---|---|
| [v1.11.0](#v1110--2026-08-06) | 2026-08-06 | 3 | 실시간 thinking/토큰 미터, 마크다운 확장형 입력창 |
| [v1.10.0](#v1100--2026-08-05) | 2026-08-05 | 3 | 작업(Tasks) 패널 |
| [v1.9.1](#v191--2026-08-05) | 2026-08-05 | 3 | root bypass 모드·resume id 수정 |
| [v1.9.0](#v190--2026-08-05) | 2026-08-05 | 12 | 셀프 업데이트, Git diff·그래프·pull, Docker 진단 |
| [v1.8.0](#v180--2026-08-04) | 2026-08-04 | 3 | 가이드 에이전트 |
| [v1.7.0](#v170--2026-08-04) | 2026-08-04 | 11 | 대기 애니메이션, 프로젝트별 묶음, 웹훅 리뷰, 브랜딩 |
| [v1.6.0](#v160--2026-08-04) | 2026-08-04 | 12 | 가져오기 중복 처리, git init/게시, remote 관리 |
| [v1.5.0](#v150--2026-08-04) | 2026-08-04 | 4 | 모델 목록 자동 수집, 5시간 창 자동화 |
| [v1.4.0](#v140--2026-08-03) | 2026-08-03 | 17 | 통합 검색, 단축키, 우클릭 메뉴, 세션 이름 자동 생성 |
| [v1.3.1](#v131--2026-08-03) | 2026-08-03 | 2 | 프라이버시 마스터 스위치 잠금 |
| [v1.3.0](#v130--2026-07-31) | 2026-07-31 | 2 | 비필수 전송 채널별 토글 |
| [v1.2.0](#v120--2026-07-31) | 2026-07-31 | 12 | 비필수 전송 기본 차단, README 개편 |
| [v1.1.1](#v111--2026-07-31) | 2026-07-31 | 3 | 멀티아치 빌드, Docker Hub 개요 |
| [v1.1.0](#v110--2026-07-31) | 2026-07-31 | 4 | 릴리스 파이프라인 + Hub 배포 |
| [초기 개발](#초기-개발--2026-07-20--07-31) | 07-20 → 07-31 | 144 | P0–P5 골격 · LLM Wiki · 토큰 · git · PR 리뷰 · 설정 · 가져오기 · DM |

---

## Unreleased

<details>
<summary><b>feat(usage): 플랜 한도가 없는 세션에는 실사용량 집계 표시</b> — API 키에서 사용량 팝오버가 막다른 길이었음 · <code>eada33a</code></summary>

API 키(또는 Bedrock·Vertex·커스텀) 계정은 claude.ai 플랜 창 자체가 없어서 CLI가 `rate_limits_available=false`를 돌려주고, 팝오버는 "API 키 세션은 플랜 한도가 표시되지 않습니다" 한 줄만 남았음. API 키로 돌리는 워크스페이스에서는 미터 전체가 무용지물.

이제 그런 세션은 워크스페이스 자체 집계를 대신 본다 — **이 세션** · **내 최근 5시간** · **내 최근 7일**, 각각 턴 수 · 입출력 토큰 · 비용. `spendSummary()`(`server/src/usage/tracker.ts`)는 기존 `usage` 테이블을 합산할 뿐이라(`recordUsage`가 이미 턴마다 행을 남김) CLI 프로브가 필요 없고, 프로브가 타임아웃해도 그대로 나온다. 세션 합계는 작성자 무관(대화방 턴은 여러 멤버가 만듦), 롤링 창은 대체 대상인 플랜 창과 맞춰 유저별. 한도 없음 안내도 실패처럼 읽히지 않게 *이유*(플랜 창 없음, 토큰 단위 과금)를 설명하도록 교체.

`GET /api/sessions/:id/usage`에 `spend` 필드 추가(기존 필드 불변). 팝오버는 내용이 길어진 만큼 최대 높이·너비를 걸어 폰 화면을 넘지 않게 했다. 실행 가능한 검증: `server/src/usage/spend.test.ts` (better-sqlite3 바인딩 필요 — 앱 컨테이너에서 실행).

</details>

<details>
<summary><b>docs: 업데이트 노트 도입</b> — 최초 설계부터 전 커밋 기록 · <code>2671942</code> <code>5011c73</code> <code>4a4e0b7</code></summary>

- `2671942` `CHANGELOG.md`/`CHANGELOG.ko.md` 신설(DESIGN.md 스펙 확정 ~ v1.11.0) + 두 README의 목차 · 로드맵에서 링크
- `5011c73` 요약 묶음을 커밋 단위로 전개 — 236개 전부에 근본 원인 · 설정 키 · 보안 판단 반영
- `4a4e0b7` 상세를 `<details>` 토글로 접고 주제별 `####` 소제목으로 그룹핑 — 접힌 상태에서는 제목 + 해시만 보임
- CLAUDE.md 규칙 11 추가: 앞으로 모든 커밋은 이 문서 양쪽에 항목을 남긴다(형식 · 위치 · 검증 명령 포함)

</details>

---

## v1.11.0 — 2026-08-06

<sub>릴리스 커밋 `cdc60ff`</sub>

<details>
<summary><b>실시간 thinking / 토큰 미터 · 확장형 입력창 · 작업 사본</b> — <code>d0aaf40</code></summary>

한 커밋에 네 갈래:

- **fix(copy)** — 모든 복사 버튼이 secure context 밖에서 죽어 있었음. LAN IP의 평문 `http://`에는 `navigator.clipboard` 자체가 없음. `lib/clipboard.ts` 신설: API가 있으면 그걸 쓰고 없으면 selection + `execCommand('copy')` 폴백. 답변 복사·코드블록·우클릭 메뉴·웹훅 필드 전부 이 경로로, 실패 시 조용히 넘어가지 않고 실패를 알림
- **fix(chat)** — 메시지 편집이 내용 변경을 요구하지 않도록. 같은 텍스트로 재전송해도 그 지점부터 잘라내고 재생성
- **feat(chat)** — 턴이 지금 뭘 하는지 보고. extended-thinking 델타가 흐르는 동안 "Thinking…", 출력 토큰 미터가 실시간으로 오르고(문자 추정) `turn:usage`에서 SDK의 정확한 수치로 스냅
- **feat(chat)** — 입력창과 메시지 편집 박스가 내용에 맞춰 커지다 상한에서 스크롤. 라이브 마크다운은 투명 textarea 뒤에 하이라이트 미러를 깔아 캐럿·IME 조합·`/`·`@` 메뉴를 건드리지 않음. 폭이 변하지 않는 스타일(색·배경·text-stroke 가짜 볼드)만 사용 — 안 그러면 캐럿이 글자에서 어긋남. `md.test.ts`가 "하이라이팅은 순수 가산" 불변식을 고정

</details>

<details>
<summary><b>턴별 slot / TTFT / total 타이밍 로깅</b> — <code>acc2336</code></summary>

전역 `maxConcurrentTurns` 캡에 막힌 턴과 CLI/모델 자체가 느린 턴을 구분할 수 없었음. 턴당 한 줄로 slot(세마포어 대기) · ttft(spawn + 첫 출력) · total · 토큰 · 캡 사용률 기록.

더불어 `finally`의 `endRunningTasks`를 가드 — 여기서 throw 나면 턴 자체 결과를 덮고 아래 샌드박스 teardown을 건너뜀.

</details>

---

## v1.10.0 — 2026-08-05

<sub>릴리스 커밋 `b245db9`</sub>

<details>
<summary><b>작업(Tasks) 패널</b> — 서브에이전트·백그라운드 셸·워크플로를 대화 옆에 · <code>f1051b3</code></summary>

턴의 Task 툴 서브에이전트·백그라운드 셸·로컬 워크플로·MCP 모니터가 UI 어디에도 안 보였음. CLI는 이들을 `system` 메시지(`task_started`/`task_progress`/`task_updated`/`task_notification`/`background_tasks_changed`)로 보내는데 턴 스트림이 버리고 있었고, 정작 그들의 중첩 도구 호출은 메인 스레드 것과 구분 없이 표시됨.

- `server/src/claude/tasks.ts`가 이벤트를 채팅 세션당 정렬된 목록으로 접고 변경마다 전체 목록을 broadcast(`tasks:update`, replace 시맨틱이라 엣지 하나 놓쳐도 stale running 행이 끼지 않음). `session:join`이 재생하고, `runTurn`의 finally가 남은 running을 정리 — CLI 서브프로세스가 턴과 함께 죽으므로 그것이 띄운 것도 살아남을 수 없음
- 웹: 헤더의 "작업" pill(실시간 카운트, 작업 중 광택) → 크기 조절 가능한 우측 패널. 종류별 필터 탭, 상태, 경과 시간, 토큰/도구 호출 수, 지금 쓰는 도구, 요약/오류. 폰에서는 전체화면 오버레이. 서브에이전트 도구 호출에 `parentId`가 붙어 트랜스크립트에서 배지로 구분
- 관리자: `taskPanelEnabled` / `taskHistoryMax` / `taskSessionsMax`

</details>

- merge: `feat/task-panel` — `bf5598d`

---

## v1.9.1 — 2026-08-05

<sub>릴리스 커밋 `1984531`</sub>

<details>
<summary><b>fix(claude): root에서 bypass 모드가 턴을 죽이던 문제</b> — <code>67b4ff8</code></summary>

`bypassPermissions`는 CLI의 `--dangerously-skip-permissions`로 매핑되는데, CLI가 root 프로세스에서 이를 거부함("cannot be used with root/sudo privileges"). 앱 컨테이너는 uid 0이라 bypass 모드의 모든 턴과 해당 세션의 `probeCommands`/`probeUsage`가 "process exited with code 1"로 사망.

`buildOptions`가 root면 SDK 모드를 `acceptEdits`로 낮추고 `makeCanUseTool`이 bypass 모드에서 전 도구를 자동 허용 — never-prompt 동작은 유지(클래스1 경로 펜스는 그대로). 위키 컴파일 경로가 이미 쓰던 방식.

</details>

<details>
<summary><b>fix(claude): 스트리밍 중 죽은 턴의 resume id 유지</b> — <code>2b8b24b</code></summary>

`claude_session_id`를 성공 경로에서만 기록해서, 에러·인터럽트·컨테이너 재빌드로 죽은 턴은 컬럼이 null로 남음. CLI 트랜스크립트는 세션 HOME에 남아 있는데 resume할 id가 없어 다음 메시지가 새 대화로 시작 — UI는 DB의 전체 히스토리를 그리고 있어 **손실이 눈에 안 보임**.

`runReal`이 CLI가 session_id를 내는 즉시 보고하고 `runTurn`이 바로 저장. session_id 캡처를 abort 체크보다 앞으로 옮겨 첫 메시지에서 멈춘 턴도 트랜스크립트를 지킴.

</details>

---

## v1.9.0 — 2026-08-05

<sub>릴리스 커밋 `6b9b4ca`</sub>

#### 셀프 업데이트

<details>
<summary><b>관리자 셀프 업데이트</b> — 게시된 이미지 확인 후 이 컨테이너를 교체 · <code>e2506cd</code></summary>

Update 탭이 실행 중 버전과 Docker Hub에 올라온 최신 semver 태그를 비교하고, 워크스페이스 안에서 워크스페이스를 갱신. 컨테이너는 자기 자신을 재생성할 수 없으므로 **새로 pull한 이미지로 띄운 일회용 헬퍼 컨테이너**가 교체를 수행:

1. 임시 이름으로 교체본 create — 옛 컨테이너가 서비스 중일 때 create spec 전체를 검증(스펙이 틀리면 무중단)
2. 옛 컨테이너 graceful stop + remove (SQLite 체크포인트 보장, SIGKILL 안 함)
3. temp → 실제 이름으로 rename 후 start
4. `selfUpdateHealthWaitMs` 동안 감시 — 죽거나 크래시 루프면 제거하고 이전 이미지로 복구

create spec은 자기 inspect 결과에서 재구성해 포트·마운트·env·라벨·네트워크·재시작 정책을 승계. 두 필드는 일부러 그대로 복사하지 않음: 자동 생성된 Hostname(옛 컨테이너 short id — 새 인스턴스의 self-lookup이 깨짐)과 옛 이미지 기본값을 그대로 비추는 Cmd/Entrypoint(복사하면 새 이미지가 옛 시작 명령에 고정됨). 롤백은 이미지 id가 아니라 전용 `:ccw-previous` 태그를 겨냥.

결과는 다음 부팅에 자기 이미지 id를 교체 전 기록과 비교해 확정 — 메모리에 아무것도 남길 필요 없음. 실패 시 헬퍼 로그를 남겨 패널이 보여줌. 패널은 다운타임 동안 폴링하다 새 버전이 응답하면 스스로 리로드.

`GET /api/admin/update`, `POST /api/admin/update/check|apply`(관리자 전용, `selfUpdateEnabled` 게이트, pull은 앱 자기 저장소로 제한). 설정 그룹 update: `selfUpdateEnabled` · `selfUpdateAutoCheckMs` · `selfUpdateCheckTimeoutMs` · `selfUpdateHealthWaitMs` · `selfUpdateContainer`. 주기 체크는 캐시만 갱신하며 스스로 적용하지 않음. 실제 Docker로 교체·롤백 검증.

</details>

- merge: `feat/self-update` — `80db2c6`

<details>
<summary><b>feat(docker): 데몬을 미리 probe해서 상태로 노출</b> — <code>29422de</code></summary>

code-server · PR 리뷰 샌드박스 · 셀프 업데이트 세 기능이 Docker 데몬에 의존하는데 전부 **사용 시점에** raw dockerode 에러로만 실패. 기존 체크는 `DATA_VOLUME`/`CODE_SERVER_NETWORK` 설정 여부만 봐서 소켓이 없거나 데몬이 죽은 배포도 통과.

- `lib/docker-status.ts`가 부팅 시와 `dockerProbeMs`마다 ping하고 판정을 캐시, 실패를 운영자가 조치 가능한 형태로 분류: socket-missing / denied / unreachable / unconfigured
- 부팅 로그가 이유와 비활성 기능을 명시, `GET /api/admin/overview`에 `docker` 포함(+ `POST /api/admin/docker/probe` 재검사), 관리자 Overview에 배너(이유·중단되는 기능·해결법·원문 에러·재확인 버튼)
- `GET /api/config`에 `dockerReady`/`dockerReason`을 실어 채팅 헤더가 split/editor 뷰를 이유 툴팁과 함께 비활성화하고 기억된 'editor' 뷰를 chat으로 되돌림, 에디터 엔드포인트 501이 이유를 명시
- 채팅·프로젝트·위키·검색·DM은 영향 없음(배너가 명시). 이유 우선순위는 서버에만 — ping 실패가 "env 미설정"보다 우선

</details>

<details>
<summary><b>fix(deps): vitest 미설치로 typecheck 실패</b> — <code>68b2906</code></summary>

`images.test.ts`·`self-update.test.ts`가 `vitest`를 import 하는데 의존성에 없어 변경 내용과 무관하게 `npm run typecheck`가 "Cannot find module 'vitest'"로 실패.

루트 devDependency로 추가(런타임 이미지는 `-w server`만 설치하므로 vitest는 배포되지 않음). `test` 스크립트는 안 만듦 — 나머지 `*.test.ts`는 `npx tsx` 단독 스크립트라 repo 전체 `vitest run`이 깨짐.

</details>

#### Git 패널

<details>
<summary><b>feat(git): origin에서 pull + 마이페이지에서 Git 패널 열기</b> — <code>dcf5013</code></summary>

커밋·푸시는 되는데 fetch가 없어 원격이 앞서면 터미널 말고는 방법이 없었음. `POST /api/projects/:id/git/pull` — 기본 fast-forward 전용(남의 워크스페이스에 머지 커밋을 만들지 않음), `{ rebase: true }`면 갈라진 로컬 커밋을 위로 replay(`--autostash`로 더러운 트리도 통과). 패널에 Pull 버튼 + 리베이스 토글.

채팅에 붙이지 않은 프로젝트도 열 수 있도록 마이페이지 프로젝트 목록에 Git 버튼 추가.

</details>

<details>
<summary><b>feat(git): pull에 <code>--all</code></b> — 원격에 새로 생긴 브랜치까지 · <code>56ec8ac</code></summary>

평범한 pull은 현재 브랜치 upstream만 갱신해서 원격에 새로 생긴 브랜치가 안 보임. 모든 remote를 한 번에 fetch하고, `--single-branch` 클론이면 refspec을 먼저 넓힘(안 그러면 `--all`도 다른 브랜치를 못 봄).

git이 refspec 옆의 `--all`을 거부하므로("fetch --all does not make sense with refspecs") upstream 없는 경우엔 전체 fetch를 별도 단계로 하고 명시적 `origin <branch>`를 유지. 패널이 마지막 줄만이 아니라 출력 꼬리를 보여줌 — `--all`에서는 `* [new branch] …` 줄이 핵심.

</details>

<details>
<summary><b>feat(git): 파일별 diff + 레인으로 그린 커밋 히스토리 그래프</b> — <code>ab118bc</code></summary>

스테이징·푸시는 되는데 정작 변경 내용을 못 봄. 변경 목록의 파일 이름이 버튼이 되어 patch를 열고, History 섹션이 `git log --topo-order`에서 브랜치·머지·ref를 개발 라인별 색 레인으로 그림(커밋 클릭 → stat + patch).

읽기 전용 엔드포인트 `GET /git/log`·`/git/diff` 2개. 이스케이프가 아니라 **검증**으로 방어(execFile은 셸을 안 거침): 커밋은 sha 형태여야 하고(플래그나 임의 ref 불가), 경로는 절대경로·`..` 불가 — untracked는 git이 비교 대상을 못 가지므로 디스크에서 직접 읽음.

레인 배치는 plain tsx로 돌도록 `web/src/lib/gitgraph.ts`에 분리: 두 레인에서 도달한 커밋은 레인을 합침(안 그러면 끝나지 않는 선 때문에 그래프가 무한히 오른쪽으로 밀림). `gitLogMaxCount`/`gitDiffMaxKB`는 상수가 아니라 관리자 설정.

</details>

<details>
<summary><b>feat(web): Git 다이얼로그 전체화면 토글</b> — <code>dea68b3</code></summary>

560px는 스테이징·푸시엔 충분하지만 그래프와 patch는 정확히 그게 잘리는 콘텐츠. 제목줄 버튼 하나로 96vw × 94vh, 내부 박스도 함께 성장(patch 18rem → 58vh, 그래프 16rem → 40vh, 변경 목록 13rem → 30vh).

`fullscreen`/`titleExtra`는 Modal의 선택 prop이라 나머지 9개 다이얼로그는 그대로.

</details>

- merge: `feat/git-diff-graph` — `534d2db`

#### UI 정리

<details>
<summary><b>feat(web): 마이페이지를 관리자 패널처럼 탭 분할</b> — <code>c240899</code></summary>

9개 섹션 한 줄 스크롤 → profile / session / requests / credentials / projects. 자동화 토글 3개가 모두 꺼져 있으면 session 탭이, approvals가 꺼져 있으면 requests 탭이 숨음.

</details>

<details>
<summary><b>fix(web): 입력창이 죽은 공간을 잡아먹던 문제 + 가이드 입력 정렬</b> — <code>cd0df76</code></summary>

플로팅 가이드 버튼이 Send를 가리지 않게 모든 입력창이 무조건 `pr-14`를 깔아, 760px 중앙 카드가 이미 런처를 비껴가는 넓은 화면에서도 56px가 낭비. `useGuideInset`이 실제로 겹치는 만큼만 측정(안 겹치면 0), 매 commit + ResizeObserver + window resize로 재측정.

가이드 패널 textarea가 20px 한 줄 박스로 32px 전송 버튼 아래에 붙던 것도 `py-1.5`로 정렬.

</details>

---

## v1.8.0 — 2026-08-04

<sub>릴리스 커밋 `1c9a70c`</sub>

<details>
<summary><b>플로팅 제품 가이드 + 실행 어시스턴트</b> — 설명도 하고 직접 실행도 · <code>ff4cd1f</code></summary>

우측 하단 원형 버튼이 작은 채팅 패널을 열어 설명도 하고 요청을 실행도 함. 에이전트의 도구 표면은 인프로세스 MCP 툴 **딱 2개**:

- **`api`** — `app.inject()`로 이 Fastify 앱에 **호출자 자신의 세션 쿠키로** 재진입. 각 라우트가 평소의 `requireAuth`/`requireAdmin`/소유권 검사를 그대로 수행하므로 권한 규칙 사본이 존재하지 않음(UI 클릭과 동일). 여기에 allowlist(`server/src/guide/api-map`)로 더 좁힘 — **DELETE 전면 금지**, 자격증명·시크릿 라우트 금지, 관리자 인프라 동작 금지. 같은 테이블이 에이전트의 API 레퍼런스로도 렌더되며 멤버에게는 관리자 라우트가 필터링됨
- **`ui`** — API가 없는 것(언어·테마·내비게이션·다이얼로그)은 그 유저의 모든 탭에 `guide:action`을 push

내장 도구(Bash/Read/Write/…)는 **이중 차단**: `disallowedTools` + 위 두 툴만 허용하는 `canUseTool`.

스레드 상태는 `chat_sessions`가 아니라 전용 테이블(`guide_threads`/`guide_messages`)에 — `chat_sessions`의 viewer 검사는 알 수 없는 kind에서 true로 떨어지기 때문. 스트리밍은 기존 `user:<id>` 소켓 룸을 탐.

관리자 설정: `guideEnabled`, `guideWriteEnabled`(읽기 전용 모드), `guideModel`, `guideMaxTurns`, `guideHistoryMax`, `guideMaxInputChars`, `guideMaxToolChars`. ko/en 문자열, 정적 데모 패리티(제안 칩용 canned 턴 — 실제 언어 전환·세션 생성 포함), 채팅·DM 입력창에 `pr-14`로 런처가 Send를 안 가리게.

</details>

- merge: `feat/guide-agent` — `8e170e2`

---

## v1.7.0 — 2026-08-04

<sub>릴리스 커밋 `94f9791`</sub>

#### UI

<details>
<summary><b>feat(ui): 모든 모델 대기에 시그니처 애니메이션</b> — 이름 생성 포함 · <code>f8b645b</code></summary>

범용 깜빡이는 점 대신 한 가지 마크로 통일: 브랜드 마크(favicon.svg)의 점 3개가 자기 clay 색조 계단을 따라 물결처럼 내려가고, 옆 라벨에 clay 광택이 흐르고, 이름 생성 호출에는 sparkle 주위로 clay 링이 회전.

- `ClayDots`/`ClaySpark`/`ClayWait`(lib/ui.tsx) + keyframes(styles/index.css), `--clay-mid`/`--clay-pale` 토큰, reduced-motion은 정지 배지로 고정
- 스트리밍 답변 · 위키 컴파일 줄 · 입력창 힌트 · 대기 턴 배너 · 헤더/사이드바 retitle 버튼에 적용
- **세션 이름 짓기는 지금까지 아예 안 보였음**: auto-title/retitle/import가 호출 전후로 `session:titling {on}`을 emit해 행 제목·헤더 제목·모든 이름 버튼이 함께 대기(`store.titling` 단일 소스, finally에서 해제해 마크가 눌어붙을 수 없음)
- 데모도 titling 이벤트 쌍을 흉내내고, `route()`가 늦게 답할 수 있어 canned 모델 호출도 대기를 보여줌

</details>

<details>
<summary><b>feat(ui): 사이드바 대화를 프로젝트별로 묶고 헤더 접기</b> — <code>5567ec4</code></summary>

평평한 한 목록 대신 프로젝트별(공통 → 개인 → 미지정)로 편철, 헤더로 접기(localStorage 유지). `setProject`가 세션 목록도 패치해 행이 즉시 이동.

</details>

<details>
<summary><b>feat(ui): 우클릭 메뉴가 클릭한 요소에서 스스로 구성</b> — <code>366a986</code></summary>

이전엔 화면마다 손으로 배선해 4곳에만 있었음. 이제 우클릭한 대상에서 조립:

- `mirrorRows()` — 클릭한 행/카드가 가진 컨트롤을 aria-label/title/텍스트로 DOM에서 읽어와 아이콘을 복제하고 danger 스타일을 추론. 선택하면 실제 버튼을 클릭하므로 핸들러 소유권은 화면에 남음. 형제 행은 제외 — 프로젝트 헤더가 그 아래 대화들을 삭제 제안하면 안 되므로
- `dataRows()` — 선택 영역·입력창·링크·이미지·코드 블록·트리 행의 전체 경로 복사
- `appRows()` — 앱 공통 동작

그룹은 라벨 기준 dedup(화면 자체 행이 우선) + 구분선 축약으로 병합. 그 결과 손으로 쓴 메뉴 대부분이 죽은 코드가 됨: 채팅 메시지는 전용 메뉴를 완전히 잃고, 사이드바 행은 "열기"만 남고, 위키 주제의 관리자 전용 삭제는 중복 `isAdmin` 검사 대신 **버튼의 존재 자체**로 게이트됨.

길면 메뉴가 스크롤(Shift+우클릭 힌트는 고정), 메뉴 안 스크롤이 메뉴를 닫지 않음. `GroupHeader`에 빠져 있던 aria-label 추가. main에서 빨갛던 `turnSkillKeys` 블록 타입도 넓힘.

</details>

<details>
<summary><b>feat(brand): 관리자 지정 로고 + 워크스페이스 제목</b> — <code>ba7ebb6</code></summary>

이름과 마크가 세 군데 하드코딩돼 있었음. 관리자가 Admin → Config → Branding에서 한 번 올리면 사이드바 · 로그인 카드 · 랜딩 화면 · 브라우저 탭에 전원 실시간 반영.

- `brandTitle`/`brandLogoMaxMB` 설정 키, 로고는 `<dataDir>/brand/logo.<ext>`에 저장하고 **mtime을 캐시버스트 토큰으로**(DB 컬럼 없음)
- `GET /api/brand`·`/api/brand/logo`는 공개 — 로그인 전에도 카드가 브랜딩됨. 로고 응답에 nosniff + 잠근 CSP를 실어 **업로드된 SVG가 이 오리진에서 스크립트를 못 돌리게** 함
- 이미지 mime/매직바이트 검증을 `lib/images.ts`로 분리해 아바타 업로드와 공유(아바타는 래스터 전용 유지 — SVG는 호출부별 opt-in)

</details>

#### LLM Wiki · 플러그인

<details>
<summary><b>feat(wiki): 기존 주제에 raw 소스 추가 + 편집</b> — <code>0cfb7bf</code></summary>

컴파일된 주제를 다시 만들지 않고 최신화. 파일 탐색기 raw/ 탭에 드롭 존(파일 또는 폴더 통째)과 기존 텍스트 소스 인라인 편집기.

- 서버: `PUT /api/wiki/topics/:id/file`이 raw/ 텍스트 파일 하나를 제자리 저장(경로 소독, 텍스트 전용, `wikiEditMaxKB` 상한). 기존 add-sources POST는 **자동 재컴파일을 중단** — 업로드가 파일당 1요청이라 N번 컴파일이 경합해 inflight 가드가 나중 파일을 든 것들을 떨어뜨림. 클라이언트가 한 번만 재컴파일
- 설정: `wikiSourceEditEnabled`(엔드포인트 403 + UI 숨김), `wikiEditMaxKB`
- 웹: `FileExplorer`에 선택적 `uploadDir`/`onUpload`·`editDir`/`onSave`를 추가해 두 번째 모달 대신 기존 트리/미리보기 재사용, `WikiExplorer`가 관리자에게 배선하고 "재컴파일 필요" 바 표시. 드래그-드롭 수집을 `lib/dropfiles`로 분리(Sidebar·ImportSessionModal에 중복돼 있었고 세 번째 사본이 될 뻔)

</details>

<details>
<summary><b>feat(wiki): 사이드바 주제 행에서 소스 관리자 열기</b> — <code>675711f</code></summary>

탐색기가 주제의 채팅 배너에서만 열려 소스 관리하려면 스레드부터 옮겨야 했음. 이제 모든 사이드바 주제 행의 주제 삭제 옆에 폴더 버튼(관리자). 우클릭 메뉴가 자동 반영(`ctxrows`가 행의 버튼을 읽으므로)돼 터치 유저는 롱프레스로 도달.

</details>

<details>
<summary><b>feat(plugins): 스킬별·유저별 사용 횟수</b> — <code>4861dae</code></summary>

턴이 어떤 스킬을 호출했는지 유저별로 집계해 스킬이 이미 사는 곳(플러그인 상세 모달에서 스킬 펼치기)에 노출: 워크스페이스 총합, 본인 카운트, (관리자만) 유저별 분해.

- `skill_usage` 테이블 — (유저, 스킬 키)당 한 행 upsert. 키는 원문 그대로 기록하고 읽을 때 플러그인의 스킬과 매칭(`skillKey`가 `plugin:skill`·`plugin/skill`·맨 `skill`을 하나로 접음)
- 호출 경로 둘 다 집계: 프롬프트 자체가 슬래시 커맨드인 경우(입력창 팔레트가 보내는 형태)와 턴 도중의 Skill/SlashCommand 도구 호출
- `skillUsageEnabled`(기본 on)가 집계와 UI를 동시에 게이트. 삭제된 유저의 orphan 행은 리소스 정리 스윕에 합류

</details>

#### PR 리뷰 — 웹훅

<details>
<summary><b>feat(review): 웹훅 기반 PR 리뷰(저장소별 시크릿)</b> — <code>2130a27</code></summary>

폴링 간격을 기다리는 대신 제공자가 PR 이벤트를 밀어 넣음. `POST /api/review/hooks/<repoId>`, 저장소별 인증은 GitHub HMAC(`X-Hub-Signature-256`) / GitLab secret-token 헤더 / Bitbucket은 `?token=`(자체 시크릿 필드가 없음). PR 이벤트만 폴링을 돌리고 댓글·push 노이즈는 200으로 무시. 관리자가 저장소 편집 다이얼로그에서 발급/회전/삭제(URL + 시크릿 복사 + 제공자별 설정 힌트).

**폴 병합**도 추가: 폴 도중 도착한 요청을 버리지 않고 끝난 뒤 한 번 다시 실행 — `REVIEW_POLL_MS=0`인 웹훅 전용 배포에서는 이 구멍이 치명적.

</details>

<details>
<summary><b>feat(review): 저장소별 폴링 토글</b> — 웹훅 전용 저장소 · <code>226aef7</code></summary>

`REVIEW_POLL_MS=0`은 전부 아니면 전무였음. `review_repos.poll_enabled`로 개별 저장소만 인터벌 폴러가 건너뜀 — 웹훅을 건 저장소는 폴링을 멈추고, 못 건 저장소는 계속 폴링. 웹훅 수신과 수동 "지금 새로고침"은 `pollRepo`를 직접 부르므로 무관, 인터벌 틱만 플래그를 존중. 사이드바가 건너뛴 저장소를 "webhook only"로 표시.

</details>

<details>
<summary><b>feat(review): 등록 시점에 웹훅 + 폴링 결정</b> — <code>716a1f7</code></summary>

웹훅이 편집 다이얼로그 전용이라 새 저장소는 항상 웹훅 없이 시작. 추가 다이얼로그에 스위치 두 개(폴링 on, 웹훅 off 기본), `createRepo`가 요청 시 시크릿 발급, 생성 직후 URL/시크릿 표시 — 호스트 설정이 필요한 바로 그 시점. `reviewWebhook`이 꺼진 상태에서 웹훅을 요청하면 조용한 다운그레이드 대신 403 거부. 공유 URL+시크릿 블록과 체크박스 행은 각각 한 컴포넌트로 통합.

</details>

---

## v1.6.0 — 2026-08-04

<sub>릴리스 커밋 `d7af8ef`</sub>

#### 가져온 세션 이름

<details>
<summary><b>feat: 가져온 로컬 세션을 그 대화 내용으로 이름 짓기</b> — <code>cb9cb5e</code></summary>

CLI가 이름을 안 붙인 트랜스크립트가 가져오기 피커와 결과 채팅 행에 raw uuid로 나옴. 두 층으로 해결:

- `listSessions`가 첫 유저 메시지의 정제된 스니펫으로 폴백(그리고 `custom`을 보고해 CLI가 지은 제목은 절대 덮지 않음)
- 가져오기 응답이 나간 뒤 스니펫 이름 채팅마다 새 채팅과 같은 모델 titling 패스(가져온 트랜스크립트의 앞쪽 유저 턴 몇 개를 읽음)를 돌려 `session:title`로 전달

`auto-title.ts`에 공유 `titleFor` 코어 기반 `autoTitleImported` 추가, 제목 소독기는 `lib/session-import.ts`로 이동해 양쪽이 공유. 새 설정: `importAutoTitleEnabled`, `importAutoTitleMessages`.

</details>

<details>
<summary><b>feat(import): 이름 짓기를 가져오기 화면의 선택으로</b> — <code>b93c07d</code></summary>

트랜스크립트마다 모델 호출 1회 비용이므로 그냥 일어나면 안 됨. 화면에 체크박스(유저 본인의 자동 이름 설정에서 시드), 서버는 요청이 명시할 때만 titling 패스 수행, 관리자 플래그는 선택지 제공 여부 자체를 게이트. 끄면 첫 메시지 스니펫이 이름으로 남음 — 어쨌든 raw uuid는 아님.

</details>

<details>
<summary><b>feat: 수동 "이 대화 이름 짓기" 버튼</b> — 첫 턴이 아니어도 · <code>67ee010</code></summary>

자동 이름은 플레이스홀더를 단 채팅의 첫 턴에 한 번만 발동해서, 그 시점을 지난 채팅(과 이름 기능 이전에 가져온 모든 채팅)은 받은 이름에 갇혔음. 채팅 헤더와 사이드바 각 행에 ✨ 버튼, 우클릭 메뉴에도 이름 변경 옆에 추가.

`retitleSession`은 `maybeAutoTitle`이 필요로 하는 가드를 일부러 버림 — **버튼을 누른 것 자체가 요청**이라 플레이스홀더 제목도 유저의 자동 이름 설정도 게이트가 아니고 기존 이름을 덮어씀. 이미 진행된 대화는 첫 메시지로 설명되지 않으므로 여러 턴을 읽고, 실패 사유(인증 없음 · 아직 말한 게 없음 · 개인 대화가 아님)를 던져 UI가 표시(자동 경로는 조용히 실패해야 하는 것과 반대). 헤더 버튼이 폰에서 동작하는 쪽.

</details>

#### 가져오기 정합성

<details>
<summary><b>fix(import): 트랜스크립트에서 CLI 배관 라인 제거</b> — <code>d105d33</code></summary>

가져온 세션이 raw `<local-command-caveat>` 블록으로 끝났음. CLI는 자기가 주입한 줄을 `type:"user"`로 적는데 `jsonlToMessages`가 `isSidechain`과 meta *타입*만 걸러 `isMeta` 줄이 실제 채팅 메시지로 통과. 슬래시 커맨드 래퍼와 캡처된 로컬 커맨드 stdout도 같은 경로.

모든 호출자가 지나는 한 곳에서 제거해 메시지 행과 생성 제목이 깨끗해짐. 태그 말고 남는 게 없을 때만 버리므로 그걸 인용한 진짜 메시지는 살아남음.

</details>

<details>
<summary><b>fix(import): 가져온 <code>/clear</code>·<code>/compact</code>가 위 히스토리를 접도록</b> — <code>0c06e3f</code></summary>

Chat.tsx는 유저 메시지가 `/clear`·`/compact`로 시작할 때(우리 입력창이 보내는 평범한 형태) 접는데, CLI는 같은 동작을 `<command-name>/clear</command-name><command-args>…</command-args>`로 적어 매칭 실패 — 가져온 세션엔 태그 뭉치(배관 필터 후엔 아무것도)만 남고 접힘도 없었음.

가져오기 시 슬래시 커맨드 줄을 `/name args`로 재작성. `userTexts`가 이를 건너뛰므로 커맨드가 생성 제목이 되는 일도 없음.

</details>

<details>
<summary><b>feat(import): 이미 가져온 세션 표시 + 세션별 덮어쓰기/복제</b> — <code>b74f044</code></summary>

`claude_session_id`로 `chat_sessions`를 키잉하는 곳이 없어 같은 폴더를 재가져오면 이미 가진 세션이 조용히 하나 더 복제됨. 스테이징 목록이 이 유저 소유 트랜스크립트에 `dup`을 보고하고, 피커가 배지 + 행마다 덮어쓰기/복사 추가 select를 붙임.

덮어쓰기는 기존 채팅 id를 재사용(메시지를 교체하고 새로 올린 프로젝트를 다시 가리킴)해 링크와 히스토리가 보존됨. select는 행 라벨 밖에 — 안에 있으면 모든 상호작용이 체크박스를 토글. 데모 라우터도 중복 2개 포함 목록을 시드.

</details>

<details>
<summary><b>feat(import): 프로젝트도 덮어쓰기/복제 선택</b> — <code>1376bd7</code></summary>

프로젝트 쪽은 늘 복제라 이름 충돌이 조용히 `myproj-2` + 두 번째 projects 행이 됐고, 재가져오기하면 같은 작업 디렉터리가 두 벌. 피커가 이미 소유한 이름을 표시하고 세션 행과 같은 선택지를 제공.

덮어쓰기는 그 projects 행과 경로를 재사용하며 업로드를 **그 위에 복사** — 같은 경로 파일은 교체되고 나머지는 생존. 일부러 wipe가 아님(.git · 미추적 작업 · 에디터 상태가 그 디렉터리에 삶). 함께 가져온 세션은 slug가 경로에서 파생되므로 기존 경로에 대해 resume.

</details>

<details>
<summary><b>feat(import): 덮어쓸 때 기존 파일 유지/삭제 선택</b> — <code>335fa6b</code></summary>

덮어쓰기가 항상 병합이라(업로드를 위에 복사) 옮겨진 프로젝트를 재가져오면 낡은 파일이 영원히 남음. 피커가 덮어쓰기 선택 옆에서 물음: 유지(병합, 기존 동작) 또는 삭제(폴더를 먼저 비우고 업로드만 남김).

삭제는 절대 기본값이 아니고, 되돌릴 파일이 있을 때만 동작하며, 힌트가 경고색으로 바뀌어 사라지는 것(.git 히스토리 · 미커밋 작업)을 명시. 디렉터리 자체는 재생성하지 않고 유지 — code-server 컨테이너가 마운트 중일 수 있고 경로가 projects 행에 기록돼 있음.

`emptyProjectDir`은 호출자 자신의 projects 루트 아래가 아닌 경로를 거부 — 경로는 우리 행에서 오지만 되돌릴 수 없는 작업이라 신뢰 대신 검사.

</details>

<details>
<summary><b>fix(import): 프로젝트를 업로드하는 단계에서 확정</b> — <code>fc6b082</code></summary>

프로젝트 이름과 덮어쓰기 선택이 `~/.claude` 폴더 고르기 뒤 마지막 단계에 있었는데 프로젝트는 트리 단계가 끝날 때 이미 업로드됨. 세션 폴더를 건너뛰면 더 나빠서, 이미 디스크에 올라간 프로젝트의 이름을 손으로 묻는 꼴.

이제 트리 단계에서 유저가 실제로 고른 폴더 이름을 프리필해서 물음(`stripRoot`가 알고도 버리던 값). 마지막 단계는 "프로젝트: x · 덮어쓰기"만 요약. 루트 폴더 이름이 없는 평면 다중 파일 드롭에서는 트랜스크립트 cwd 꼬리를 폴백으로 유지.

</details>

#### Git

<details>
<summary><b>feat(git): 저장소가 아닌 프로젝트 git init + 원격 게시</b> — <code>9519395</code></summary>

가져온 프로젝트는 파일 뭉치라 Git 패널이 "not a git repository"로 막다른 길. 이제 두 갈래: init만, 또는 publish(init → 첫 커밋 → 등록된 자격증명으로 제공자에 저장소 생성 → push). 붙여넣은 URL은 생성을 건너뛰며, API를 모르는 제공자로 가는 유일한 경로.

저장소 생성은 `lib/git-publish.ts`(GitHub Enterprise 포함, GitLab, Bitbucket), `git-ops`에 `gitInit`/`gitHasCommits`/`gitSetOrigin` 추가 — 전부 이미 된 부분엔 no-op이라 이미 추적 중인 프로젝트를 publish 해도 히스토리를 다시 쓰지 않음. remote는 생성 성공 후에만 연결하므로 실패해도 origin이 그대로.

body의 credential id는 호출자 기준으로 재검사(유저 스코프 자격증명은 소유자에게만 해석). 설정: `gitPublishEnabled`(버튼이 아니라 엔드포인트를 게이트), `gitInitBranch`.

</details>

<details>
<summary><b>feat(git): 프로젝트별 remote 수동 관리</b> — <code>7dd4e90</code></summary>

클론이 우연히 가진 origin하고만 대화할 수 있었음. 이제 remote 목록 · 추가 · 주소 변경 · 삭제(기본 접힘 — 대부분 origin 하나를 아무도 안 건드림). 모든 변경이 갱신된 목록을 반환하고 패널 상태를 리로드 — origin 재지정은 push가 어떤 자격증명으로 해석되는지도 바꾸기 때문.

`git remote add`는 `--` 구분자를 안 받으므로 이스케이프가 아니라 **검증**: 앞의 `-`는 플래그로 읽힘. URL은 http(s)/ssh/git과 scp 형식 `user@host:path`로 제한 — 맨 로컬 경로나 `file://`은 **일부러 거부**(remote로 쓰면 한 유저가 다른 유저의 프로젝트 디렉터리에서 fetch할 수 있고, git의 `ext::` 전송은 명령을 실행). `lib/git-ops.test.ts`가 그 케이스들을 커버하고 publish 라우트의 붙여넣은 URL도 같은 함수로 검증.

375px에서 브랜치 행이 다이얼로그를 넘치던 것과 remote URL 필드가 85px로 눌리던 것도 수정.

</details>

---

## v1.5.0 — 2026-08-04

<sub>릴리스 커밋 `17a1e3a`</sub>

<details>
<summary><b>feat: 제공자 <code>/v1/models</code>에서 모델 목록 자동 수집</b> — <code>c5c5f5d</code></summary>

프론티어 모델 id가 자주 바뀌어 하드코딩된 `models` 맵이 상함. 서버가 설정된 제공자(api.anthropic.com 또는 커스텀 base URL)에서 최신순 목록을 `modelsMax`까지 받아 모든 소비자가 이미 읽는 그 `models` 설정에 되씀. 부팅 시 + `modelsRefreshMs`마다, 또는 관리자 패널 [지금 가져오기].

`defaultModel`의 select 옵션도 고정 배열이 아니라 그 맵을 따라가므로 갓 받아온 id를 바로 선택 가능.

</details>

<details>
<summary><b>feat: claude.ai 5시간 창이 리셋되면 턴 자동 재개</b> — <code>7bc5495</code></summary>

플랜 한도(5시간 · 주간)로 죽은 턴은 일시적 429가 아니라 `withRateLimitRetry`로 어쩔 수 없고 프롬프트가 그냥 사라졌음. 이제 새 `pending_resumes` 테이블에 보관하고 입력창이 재시도 예정 시각을 표시(취소 가능), 창이 열리면 서버가 다시 enqueue. 타이머는 부팅 시 재무장해 대기 중 재시작에도 프롬프트가 안 날아가고, `autoResumeStaleMs`를 넘겨 밀린 행은 재생 대신 폐기.

**구조적으로 Claude 구독 전용** — 자격 요건이 해석된 provider env의 `CLAUDE_CODE_OAUTH_TOKEN`이라 API 키 · bedrock/vertex/커스텀(그런 창이 없음)은 절대 보관되지 않음. 리뷰 세션도 제외(관리자 인증으로 무인 실행되며 자체 워치독 보유).

마이페이지에서 유저별 opt-in(`users.auto_resume`, 기본 off — 몇 시간 뒤 무인 실행되므로), 관리자 `autoResume*` 키가 워크스페이스 전체 게이트 + grace/시도/대기/stale 한도 조정. 데모는 `!limit` 프리픽스로 전체 루프를 흉내.

</details>

<details>
<summary><b>feat: 프라이머 질의로 5시간 창 열어 두기</b> — <code>7db52ae</code></summary>

5시간 창은 벽시계가 아니라 **첫 과금 메시지에 열려** 5시간 뒤 닫힘. 리셋 후 놀면 그 시간은 그냥 사라짐 — 1시간 쉬면 5시간이 아니라 4시간.

opt-in 유저에 대해 유저별 스케줄러가 실제 창을 probe하고, 열린 게 없으면 아주 작은 일회용 질의(저렴한 모델, 도구 차단, 하드 타임아웃)로 창을 연 뒤 그 창의 실제 `resets_at`까지 잠듦. 채팅 세션이 아님 — `chat_sessions` 행도 메시지도 사이드바 항목도 없고, 유저 프로젝트 디렉터리의 단명 CLI 서브프로세스일 뿐이며 `usage` 행 1개로 과금돼 비용은 보임.

auto-resume과 동일한 Claude 구독 게이트. probe를 못 읽으면 추측하지 않고 `windowPrimerRetryMs`로 재시도해 잘못된 추측으로 메시지를 낭비하지 않음. 마이페이지 opt-in(`users.prime_window`, 기본 off — 쿼터를 씀)이며 마지막 선점 시각이 `user:primed` 소켓 이벤트로 실시간 표시. 관리자 `windowPrimer*`가 모델/프롬프트/grace/재시도 조정.

</details>

---

## v1.4.0 — 2026-08-03

<sub>릴리스 커밋 `5e7a59b`</sub>

#### 통합 검색

<details>
<summary><b>feat(search): 워크스페이스 통합 검색 <code>Ctrl/Cmd+K</code></b> — <code>37033e9</code></summary>

엔드포인트 1개 + 팔레트 1개로 모든 내부 표면: 개인 대화, 공유 방 대화, DM/그룹 메시지, 프로젝트, LLM Wiki 주제와 컴파일/원본 문서, PR 리뷰 세션, 유저 디렉터리.

- 가시성은 재유도하지 않고 각 기능 자체의 게이트를 재사용(`canViewChat` 시맨틱, `rooms.isMember`, projects `canAccess`, `listReviewSessionsForUser`, dm 멤버십) — DM은 관리자에게도 멤버십 전용
- 메시지 매칭은 저장된 content JSON을 평탄화해 산문 · 도구 이름 · 도구 입력 · 도구 출력까지 전부 검색 대상
- 결과를 누르면 사이드바가 하듯 착지: 스레드가 열리고 해당 메시지로 스크롤 + 링 강조(접힌 `/clear`·`/compact` 블록은 자동 펼침), 프로젝트 · 위키 파일은 FileExplorer가 그 파일로 바로 열림
- 설정: `searchEnabled`(API를 하드 404 + UI 숨김), `searchMaxPerType`, `searchFileMaxKB`, `searchScanMaxFiles`

</details>

<details>
<summary><b>feat(search): 타입별(기본) 또는 최신/오래된 단일 타임라인 정렬</b> — <code>0b71232</code></summary>

그룹이 기본(표면당 섹션, 내부는 최신순), 시간 모드 둘은 전 표면을 한 목록으로 평탄화하고 각 행이 타입 배지를 지님. 날짜 없는 항목(사람 · 위키 문서)은 양방향 모두 목록 끝으로 — 가장 오래된 척하지 않음.

**오래된순은 서버도 반대쪽 끝에서 후보를 골라야 함**: 안 그러면 타입별 상한이 각 표면의 최신 행만 돌려주고 클라이언트가 뒤집으므로 진짜 오래된 것은 DB를 못 떠남. `?sort=newest|oldest` 추가, 시간 정렬 수집기 전부가 상한 적용 전에 이를 존중.

선택은 브라우저별 유지(localStorage `searchSort`). 행 스니펫을 행 폭으로 제한 — items-start가 긴 경로/CJK를 콘텐츠 크기로 늘려 폰에서 팔레트를 넘침.

</details>

- **docs: 검색 정렬 옵션 문서화** — `b5ca545`

<details>
<summary><b>feat(search): 시간 전용 정렬 + 기능별 필터 탭</b> — <code>e5f86ed</code></summary>

타입 그룹 모드 제거. 결과는 항상 최신/오래된 타임라인 하나이고, 좁히기는 정렬 아래 필터 칩으로: 전체 · 개인 · 대화방 · DM · 프로젝트 · LLM Wiki · PR 리뷰 · 사람, 각각 히트 수를 달고 실제로 매칭된 표면만 칩이 생김.

탭은 히트 **타입이 아니라 기능** 기준 — 방 안의 메시지는 "대화방", 같은 모양이 위키 스레드 안이면 "LLM Wiki"로 편철되며, 채팅 히트가 어느 표면에서 왔는지 이미 기록하는 `nav.kind`에서 해석. 섹션 헤더가 없어졌으므로 모든 행이 타입 배지를 유지. 정렬 전환은 재조회(서버가 선택한 끝에서 후보를 고르므로)하고, 새 질의에 없는 필터는 빈 팔레트 대신 "전체"로 폴백.

</details>

<details>
<summary><b>fix(search): 타입별 상한 적용 전에 호출자 기준으로 후보를 좁힘</b> — <code>1a976f9</code></summary>

가시성 자체는 이미 옳았고(인메모리 `chats` 맵이 게이트, 일회용 멤버 계정 감사로 교차 유출 없음 확인) 문제는 개인 제목 수집기가 LIKE + LIMIT을 **모든 유저의** `chat_sessions`에 돌린 뒤 안 보이는 행을 나중에 버린 것 — 바쁜 워크스페이스에서는 자기 대화가 볼 수 없는 행들에 밀려 상한 밖으로 떨어질 수 있음.

멤버는 SQL에서 소유자 스코프(관리자는 `canViewChat`으로 이미 가진 교차 뷰 유지). 메시지 프리필터도 가시 세션 목록이 IN 리스트로 바인딩하기엔 너무 클 때 같은 탈출구를 가져 SQLite 파라미터 에러 대신 넓은 스캔으로 degrade.

</details>

<details>
<summary><b>fix(search)!: 관리자도 타인의 개인 공간은 검색 불가</b> — 보안 · <code>87ccb9b</code></summary>

`canViewChat`/`canAccess`는 관리자가 개별 개인 스레드나 유저 스코프 프로젝트를 직접 열게 해주고 검색이 그걸 물려받았음. **요청받아 스레드 하나를 여는 것과 모든 유저의 개인 대화를 한 번에 grep 하는 것은 같은 권한이 아님**:

- 개인 대화 · 위키 질의 스레드: 관리자 포함 소유자만(`visibleChats`가 isAdmin 분기를 잃고 제목 질의도 SQL에서 소유자 스코프)
- 유저 스코프 프로젝트: 소유자만
- 메시지: 항상 호출자 자신의 가시 세션으로 프리필터 — 관리자 질의가 타인의 개인 메시지를 디스크에서 **읽지조차 않음**
- DM은 이미 멤버십 전용

공유 표면(내가 속한 방, 방 스코프 프로젝트, PR 리뷰, LLM Wiki 지식 기반, 유저 디렉터리)은 그대로. 단건 엔드포인트의 기존 게이트도 그대로 — 이 변경은 검색만 좁힘. 실행 중 컨테이너에서 일회용 멤버 계정으로 검증: 멤버 본인 세션 · 프로젝트는 본인에게 2건, 관리자에게 0건(`types=` 강제해도 동일).

</details>

#### 조작 · 단축키

<details>
<summary><b>feat(web): 핵심 동작 단축키, 플랫폼별 표기</b> — <code>bd9b76a</code></summary>

테이블 하나(`SHORTCUT_GROUPS`)가 전역 핸들러와 `?` 치트시트를 동시에 구동하므로 목록에 있는 바인딩은 반드시 동작. 키 표기는 플랫폼대로(맥 ⇧⌘O, 윈도우/리눅스 Ctrl+Shift+O).

Mod+K / Mod+/ 검색(기존), Mod+Shift+O 새 대화, Mod+B 사이드바(`<md` 드로어 / `≥md` 컬럼), Mod+Shift+H 홈, Mod+Shift+L 테마. `?`는 텍스트 필드 밖에서만 열려 메시지에 물음표를 쳐도 안 뜨고, 열린 다이얼로그가 키보드를 소유. 입력창의 `Esc`는 메뉴가 없을 때 실행 중 턴을 중단. 버튼 툴팁에 단축키 표기, 사이드바 푸터에 Shortcuts 행. 하드코딩 `search.shortcut`('Ctrl+K')은 `fmtKeys`로 대체.

</details>

<details>
<summary><b>feat(web): 앱이 우클릭을 소유</b> — 전용 컨텍스트 메뉴, Shift는 브라우저 것 · <code>733c583</code></summary>

윈도우 리스너 하나가 `contextmenu`를 가져가 어디서 우클릭해도 워크스페이스 동작이 나옴: 새 대화 · 검색 · 사이드바 · 테마 · 새로고침, 그리고 클릭 지점이 입력 · 선택 · 링크면 클립보드 행. 더 나은 항목이 있는 화면은 자체 메뉴를 붙이고(사이드바 행 열기/이름변경/삭제, 채팅 메시지 복사/편집/삭제) 전역 핸들러는 이미 default-prevented된 것에서 물러남.

탈출구: **Shift+우클릭** — 그때는 preventDefault를 안 하므로 브라우저 메뉴가 그대로 나옴(Firefox/VS Code 관례). 단축키 시트와 메뉴 자체 푸터에 안내, 관리자는 `customContextMenu`로 전체 차단.

Mod+B 사이드바 로직은 공유 `toggleSidebar()`로, 사이드바의 rename/delete 프롬프트는 명명 핸들러로 빼서 hover 버튼과 메뉴 행이 사본 둘이 아니라 같은 코드를 실행.

</details>

<details>
<summary><b>feat(web): 데스크톱 좌측 사이드바 접기</b> — <code>607e460</code></summary>

컬럼을 숨길 수 있고 localStorage에 유지. 기존 헤더 햄버거가 펼침 컨트롤을 겸함 — `<md`에서는 드로어용으로 항상 보이고, `≥md`에서는 접힌 동안만 보임.

</details>

- **feat(web): 로고를 누르면 검색이 중앙에 있는 랜딩 화면으로** — `a943777`
- **fix(web): 사이드바 헤더가 제목 뒤로 언어 토글을 숨기지 않도록** — `f2fb154`
- **fix(web): 언어 스위치를 사이드바 푸터로 옮겨 제목이 들어가게** — `a35a08d`

<details>
<summary><b>refactor(web): 언어를 2방향 토글이 아니라 목록에서 선택</b> — <code>965f4be</code></summary>

토글은 언어가 정확히 둘일 때만 성립하므로 언어가 늘어날 UI엔 잘못된 컨트롤. `LANGS`로 구동:

- `LangSelect`(네이티브 select, 옵션은 LANGS)가 `LangToggle`을 대체(사이드바 푸터 + 로그인)
- `Lang` 타입도 LANGS에서 파생하고 `detect()`가 저장/브라우저 값을 `'ko'`/`'en'` 분기 대신 LANGS로 검증
- `toggleLang` 제거, `lang.toggleTitle` → `lang.pickTitle`(ko+en)로 번역 문자열에 언어 목록을 굽는 것도 중단

이제 언어 추가 = LANGS 항목 1 + 라벨 + 사전(DICT가 Lang별 타입이라 tsc가 빠진 걸 짚어 줌).

</details>

#### 세션 이름 · 빌드

<details>
<summary><b>feat: 새 대화를 주제로 이름 짓기, 유저별 토글</b> — <code>663b859</code></summary>

새 개인 대화가 손으로 바꾸기 전까지 플레이스홀더 제목을 유지했음. 첫 턴이 끝나면 서버가 저렴한 모델에 한 줄 제목을 요청해 `session:title`로 모든 클라이언트에 push. 아직 플레이스홀더인 대화만 건드리므로 유저가 고른 이름이 항상 이김. 인증이 없거나 호출이 실패/타임아웃하면 첫 메시지 절단으로 폴백.

끄기는 마이페이지 체크박스 하나(`users.auto_title`), 관리자는 `autoTitleEnabled`로 통째 제거 — 모델 · 길이 상한 · 타임아웃도 레지스트리 키. 정적 데모는 canned 제목으로 흐름을 미러.

</details>

- merge: `feat/auto-session-title` — `bca1272`

<details>
<summary><b>chore: 로컬 compose 재빌드가 스스로 정리</b> — <code>94ce165</code></summary>

`docker compose up -d --build`는 매번 이전 이미지를 dangling으로 남김(:latest 태그를 잃고 레이어는 유지). 빌드 + `docker image prune -f`를 한 스크립트로 묶고 CLAUDE.md 릴리스 워크플로가 이를 가리키게 해 세션마다 정리를 기억할 필요 없음.

prune은 dangling만 건드림 — 태그된 버전 · 실행 컨테이너 · 볼륨 · 빌드 캐시는 그대로.

</details>

---

## v1.3.1 — 2026-08-03

<sub>릴리스 커밋 `0f736c0`</sub>

<details>
<summary><b>fix(privacy): 마스터 스위치가 채널별 토글을 덮어쓰고 잠금</b> — <code>f1cfd57</code></summary>

출시된 패널의 두 문제: "사용량 텔레메트리" 옆의 맨 체크박스는 체크가 **보낸다**는 건지 **막는다**는 건지 말하지 않고, 마스터는 "전부 차단"처럼 읽히면서 실제로는 AND 게이트라 켜 놓아도 아래 9개가 살아 보이며 각각 그걸 되돌리는 것처럼 보임.

이제 마스터는 **OR 오버라이드**: 켜면 전 채널 차단, 채널 키는 무시되고 그 행들은 잠긴 상태(회색 · 비활성 · 유효 상태 표시)로 렌더되며 어떤 스위치가 잡고 있는지 한 줄로 명시. 끄면 채널별로 선택, 마스터와 전 채널이 꺼지면 아무것도 차단되지 않고 상속 env는 손대지 않음(기존대로).

잠금은 뷰가 privacy 그룹을 특수 처리하는 대신 `ConfigDef`의 새 `disabledWhen` 필드가 구동해 레지스트리가 단일 진실원으로 남음. 모든 라벨이 "… 차단"으로 바뀌고 그룹에 "체크 = 차단" 힌트 — 체크의 의미가 하나뿐이 되도록.

</details>

---

## v1.3.0 — 2026-07-31

<sub>릴리스 커밋 `68e920c`</sub>

<details>
<summary><b>feat(privacy): 비필수 Anthropic 전송의 채널별 토글</b> — <code>1e62f66</code></summary>

마스터 스위치는 남기되, 딱 한 채널만 되살리고 싶은 운영자(예: 자기 OTel 수집기로 메트릭)가 전부를 포기해야 했음.

`privacy.ts`가 각 채널을 **데이터로** 기술(키, 고정할 env, 벗겨낼 상속 변수, 병합할 settings, 우산 변수가 커버하는지 여부)하고 `privacyPlan()`이 마스터 + 채널 9개를 두 spawn 지점이 적용할 계획 하나로 해석. `on`을 import가 아니라 인자로 받아 모듈이 DB 프리로 남고 self-check가 직접 구동 가능.

`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`은 그것이 커버하는 모든 채널이 아직 켜져 있을 때만 방출 — 텔레메트리 · 에러 리포트 · 설문 · 업데이터를 통째로 막으므로 일부러 되살린 채널 옆에 세우면 운영자를 조용히 덮어씀. 마스터 off는 여전히 상속 env를 전혀 안 건드림.

설명은 i18n(`cfgDesc.<key>`, ko+en)에 살고 각각 env 변수 이름이 아니라 **무엇이 기기를 떠나는지**를 말함.

</details>

---

## v1.2.0 — 2026-07-31

<sub>릴리스 커밋 `de73205`</sub>

#### 프라이버시

<details>
<summary><b>feat(privacy): 비필수 Anthropic 전송 기본 전면 차단</b> — <code>1e8f69f</code></summary>

모든 에이전트 턴이 Claude Code CLI를 spawn 하는데, CLI는 기본적으로 추론 요청 **밖에서도** Anthropic과 통신함: 사용량 텔레메트리, 에러 리포트, `/feedback`·`/bug`·`/share`(코드 포함 트랜스크립트 전체 업로드), 세션 품질 설문과 그 트랜스크립트 업로드 후속, 비필수 모델 호출, 자동 업데이터 핑, WebFetch 도메인 preflight(호스트명을 api.anthropic.com으로 전송), Artifact 게시, 공식 마켓플레이스 자동 설치, OpenTelemetry export.

새 `server/src/claude/privacy.ts`가 모든 opt-out을 한곳에 모으고 두 spawn 지점에 적용 — `buildOptions()`(env를 **마지막에** 고정해 상류가 채널을 다시 열 수 없게, 그리고 env가 아니라 설정인 `skipWebFetchPreflight`는 SDK flag-settings 층으로)와 code-server 컨테이너 스펙(에디터 터미널의 `claude` 실행도 커버). 상속된 OTel/트레이싱 엔드포인트 · 헤더는 덮어쓰는 게 아니라 벗겨냄.

`blockNonessentialTraffic`(기본 on, `BLOCK_NONESSENTIAL_TRAFFIC`)로 게이트하며 끄면 상속 env를 그대로 둬 의도적 OTel 수집기가 동작. 추론 요청 자체는 영향 없음 — 그것까지 없애려면 LLM Provider = custom.

</details>

#### README

<details>
<summary><b>docs(readme): 완전 로컬 실행 스택 + 권장 사양</b> — 5커밋 · <code>7d123d5</code> <code>b39d856</code> <code>1adfd4b</code> <code>fcb675c</code> <code>8e84bff</code></summary>

- `7d123d5` 권장 사양(CPU/RAM/디스크/아키텍처/네트워크)
- `b39d856` "완전 로컬" 섹션(`ANTHROPIC_BASE_URL` → LiteLLM/로컬 모델, api.anthropic.com 미사용), 로컬 LLM의 GPU/VRAM은 앱 사양과 별개임을 명시
- `1adfd4b` 오프라인 운용용 복붙 compose(Ollama + LiteLLM + 앱), 앱은 LLM Provider(custom)로 로컬 게이트웨이를 가리킴
- `fcb675c` 같은 스택의 docker run 변형
- `8e84bff` 정정 — Ollama ≥0.14, vLLM, LM Studio, llama.cpp가 `/v1/messages`를 네이티브로 노출하므로 Claude Code가 `ANTHROPIC_BASE_URL`로 직접 연결. 기본 로컬 스택에서 LiteLLM 프록시 제거(폴백으로만 유지)

</details>

<details>
<summary><b>docs(readme): 데모 GIF 재촬영 · 목차 · 배지 · GFM 취소선 수정</b> — 4커밋 · <code>c24608c</code> <code>b0ec001</code> <code>2d3526a</code> <code>fe74580</code></summary>

- `c24608c` 기존 히어로 GIF는 초기 빌드 것. 현재 VITE_DEMO 앱에서 재캡처: 팀 방 + 프레즌스, 스트리밍 턴, 브라우저 내 툴 승인, 툴 실행, code-server로 Split. 영문 UI, 1200px
- `b0ec001` 두 README 히어로 아래에 최상위 TOC, 앵커는 GitHub 렌더 슬러그로 검증
- `2d3526a` 헤더에 Docker ≥26 배지
- `fe74580` `4~8`/`~20~30`이 GitHub에서 `~취소선~`으로 파싱됨 → en dash로 교체

</details>

<details>
<summary><b>feat(release): 기본 amd64, 가끔 쓰는 <code>--arm</code></b> — <code>0a97718</code></summary>

arm64 에뮬 빌드가 이 호스트에서 20–30분이라 릴리스는 amd64 기본, `-- --arm`으로 linux/arm64도 게시.

</details>

---

## v1.1.1 — 2026-07-31

<sub>릴리스 커밋 `6d2d8c5`</sub>

<details>
<summary><b>docs(dockerhub): 저장소 개요 페이지 + 셸별 실행 커맨드</b> — <code>5ea9258</code></summary>

`DOCKERHUB.md`(GitHub 링크, bash/PowerShell/CMD 실행 블록), `scripts/hub-description.mjs` + `npm run hub:desc`로 Hub API에 개요 push, README의 docker run도 bash/zsh · PowerShell · CMD 변형으로 분리.

</details>

<details>
<summary><b>feat(release): buildx 멀티아치 빌드</b> — linux/amd64 + linux/arm64 · <code>d5b1956</code></summary>

`release.mjs`가 `docker buildx build --platform … --push`를 쓰고 docker-container 빌더(`ccw-multi`)가 없으면 자동 생성. `PLATFORMS`로 아키텍처 오버라이드.

</details>

---

## v1.1.0 — 2026-07-31

<sub>릴리스 커밋 `8d01636`</sub>

<details>
<summary><b>feat(release): 버전 + Docker Hub 이미지 배포 파이프라인</b> — <code>8102e6a</code></summary>

`scripts/release.mjs`가 `:버전` / `:latest` / `:sha-<short>` 3개 태그로 build & push, `npm run release[:patch|:minor|:major]`(npm version이 버전 올리고 git 태그), compose의 `APP_IMAGE` 파라미터로 게시된 이미지 pull, CLAUDE.md 규칙 3 + README에 릴리스 단계 문서화.

</details>

<details>
<summary><b>feat(deploy): 클론 없이 실행하는 단독 <code>docker-compose.hub.yml</code></b> — <code>ecfe492</code></summary>

`build:` 없는 pull 전용 compose라 파일 하나만 받으면 게시된 이미지로 실행. README에 curl + up 흐름.

</details>

<details>
<summary><b>feat(codeserver): 네트워크 자동 생성으로 단일 <code>docker run</code> 성립</b> — <code>7ee811c</code></summary>

`ensureNetwork()`가 부팅 시 code-server 네트워크를 만들고 앱 컨테이너를 연결. compose 아래서는 no-op.

</details>

---

## 초기 개발 — 2026-07-20 → 07-31

버전 태그 이전 144커밋. [DESIGN.md](DESIGN.md) 14절의 **P0–P5 빌드 단계**로 시작해, 설계 문서에 없던 축들이 순차로 붙었다.

### 07-20 — P0–P5 골격 (설계 스펙 그대로)

<details>
<summary><b>P0 골격</b> — 스캐폴드 · DB · 인증 · <code>b536aac</code> <code>f043752</code> <code>6c155d3</code></summary>

- `b536aac` 모노레포 스캐폴드, Docker 배포(compose · 단일 이미지 · 소켓 마운트 · 네임드 볼륨), 빌드 설정
- `f043752` SQLite/Drizzle 스키마, DDL 초기화, path/settings/id 유틸
- `6c155d3` scrypt 인증, 폐기 가능한 DB 세션, 계정 발급

</details>

<details>
<summary><b>P1–P4 코어</b> — SDK 러너 · 공유방 · code-server · 플러그인 · <code>545efb6</code> <code>47153ef</code> <code>6d8dcdf</code> <code>f7c1a44</code></summary>

- `545efb6` **P1** 세션당 SDK 러너, 스트리밍, `canUseTool` 웹 권한 브리지, 전역 스로틀 + 429 백오프, 사용량 추적
- `47153ef` **P4** 공유 대화방(방장/위임), FIFO 큐 + 취소, Socket.IO 팬아웃/프레즌스
- `6d8dcdf` **P2** dockerode spawn/reap, 볼륨 서브패스 마운트, 인앱 http+ws 프록시
- `f7c1a44` **P3** 2클래스 플러그인 매니저(공통/개인, git + tarball, 강제/선호)

</details>

<details>
<summary><b>API + 웹 셸</b> — REST 라우트 전체 · React SPA · <code>6e6e220</code> <code>4fc95f4</code></summary>

- `6e6e220` REST 라우트(sessions/rooms/projects/plugins/admin) + Fastify 엔트리포인트
- `4fc95f4` React SPA — 채팅/툴 카드/권한 프롬프트, 방, 에디터 분할, 관리자 + 플러그인 패널

</details>

<details>
<summary><b>초기 안정화 4건</b> — code-server 컨테이너 수명 · 빈 에디터 · <code>b611365</code> <code>f6a0e5c</code> <code>de41ba9</code> <code>0dcc963</code></summary>

- `b611365` 로그아웃 시 그 유저의 에디터 컨테이너 제거
- `f6a0e5c` code-server가 `:8080`에 바인딩된 뒤 URL 반환 — iframe 502 경쟁 회피
- `de41ba9` 에디터 전용 뷰가 0폭 그리드 컬럼에 렌더돼 빈 화면
- `0dcc963` 부팅 시 orphan 에디터 컨테이너 제거 — 추적 안 되는 생존자가 영영 reap되지 않던 문제

</details>

<details>
<summary><b>OSS 문서화 · 브랜딩</b> — README · LICENSE · 아이콘 · i18n README · <code>219f1d1</code> <code>85207d9</code> <code>5642b85</code> <code>bfb51ba</code> <code>96a98c6</code></summary>

- `219f1d1` 다듬은 OSS README(강점/아키텍처 mermaid/배지) + MIT LICENSE
- `85207d9` 라이브 데모 GIF(채팅 · 웹 툴 승인 · code-server 분할)
- `5642b85` 앱 아이콘(clay spark favicon.svg) + PWA manifest + theme-color
- `bfb51ba` 오리지널 앱 아이콘(split-workspace 마크)을 favicon · 인앱 로고 · README에
- `96a98c6` README i18n — 영어(기본) + 한국어 + 언어 스위처

</details>

### 07-21 — LLM Wiki (설계에 없던 4번째 엔티티)

<details>
<summary><b>feat(server): OAuth 토큰 vs API 키 라우팅, 플러그인 래핑, 권한 응답 채널</b> — <code>2b7d42a</code></summary>

`sk-ant-oat*`는 `CLAUDE_CODE_OAUTH_TOKEN`, `sk-ant-api*`는 `ANTHROPIC_API_KEY`로. 플러그인을 `{type:'local',path}`로 래핑, 격리 루트/`additionalDirectories`. AskUserQuestion 선택을 deny+message(응답 채널)로 Claude에 되돌려주고 `permission:resolved`/`answered` emit. `.env.example`에 부트스트랩 admin + 키 주석.

</details>

- **fix(web): 채팅 pane 스크롤 + 그리드 레이아웃 `minmax(0,1fr)`** — `8519167`

<details>
<summary><b>feat(projects): git clone으로 프로젝트 생성</b> — <code>8f5324e</code></summary>

`POST /api/projects`가 선택적 `gitUrl`을 받아 mkdir 대신 클론(execFile, 셸 없음). http(s)/git/ssh 스킴 검증(`file://` 차단), URL에서 이름 유도, `GIT_TERMINAL_PROMPT=0`로 비공개 저장소는 즉시 실패, 실패 시 부분 디렉터리 정리.

</details>

<details>
<summary><b>feat(wiki): LLM Wiki 탭</b> — 관리자 주제 · 유저별 질의 스레드 · 폴더 업로드 · <code>af18dd4</code></summary>

`wiki_topics` 테이블 + `chat_sessions.wiki_topic_id` + 컴파일 상태 컬럼(가드된 ALTER 마이그레이션), 주제 디렉터리와 위키 cwd 해석(세션 목록은 위키 스레드 제외), `routes/wiki.ts`(주제 CRUD — 생성/삭제는 관리자 전용, 유저별 스레드 get-or-create, 스테이징 업로드 = 업로드 → 삭제 가능 목록 → 확정/취소, 폴더 드래그&드롭 전 깊이 재귀 경로, CLAUDE.md 그라운딩), multipart `fieldNameSize` 상향, 부팅 시 스테이징 reap, 컴파일 중 질의 차단.

웹: Wiki 사이드바 섹션 + `WikiCreateModal`(드롭존 · 진행바 · 스테이징 목록) + `WikiBanner` + store/socket + `api.uploadProgress`.

</details>

<details>
<summary><b>feat(wiki): 전체 컴파일 파이프라인</b> — 원본 → 합성 문서 + <code>_index</code> · <code>9bc2159</code></summary>

`compileTopic()`이 `./raw/` 위에서 Claude를 실행(acceptEdits + 항상 허용 `canUseTool`)해 상호 링크된 `./wiki/` 문서와 confidence, 계층형 `_index.md` 생성. 생성/파일 추가 시 자동 실행 + 수동 재컴파일 버튼, single-flight 가드, 빈/mock은 즉시 done. 상태(idle|compiling|done|error) + 단계별 하트비트를 `wiki:status`/`wiki:progress`로 방송해 멈춘 것처럼 보이지 않음.

</details>

<details>
<summary><b>feat(wiki): <code>raw/</code> 불변 펜스 + 트리·단일 파일 엔드포인트</b> — <code>3c742b7</code></summary>

컴파일 `canUseTool`이 `raw/` 아래 Write/Edit을 거부(에이전트가 오작동해도 원본 불변), 출력은 `wiki/`만. `GET …/tree` → `{raw, wiki}` 경로 + 크기(내용 없음), `GET …/file?dir=raw|wiki&path=` → 파일 하나의 텍스트.

</details>

<details>
<summary><b>feat(wiki): 주제 파일 트리 탐색기</b> — 원본 + 컴파일본 · <code>1367783</code></summary>

`WikiBanner`의 파일 탐색기 버튼이 모달을 열어 raw/wiki 토글, 상대 경로로 만든 접이식 폴더 트리, 파일별 지연 로드 뷰어. 업로드한 원본 전부(중첩 · 바이너리 포함)를 보여 컴파일 후 사라진 것처럼 보이지 않게.

</details>

<details>
<summary><b>fix(wiki): 업로드 시 유니코드(한글/NFD) 폴더 이름 보존</b> — <code>14a8a1f</code></summary>

`safeFile`의 `[가-힣]` 화이트리스트가 조합형(NFC) 음절만 매칭해서 macOS 분해형(NFD) 자모가 통째로 제거됨 — 순한글 폴더는 `''`가 되고(내부 파일이 부모로 떨어짐) 한글+영숫자는 한글 부분만 소실.

`safeSeg`로 교체: NFC 정규화 + 경로 구분자/제어 문자만 제거하고 나머지 유니코드는 유지. 중첩 한글/혼합 경로 생존 검증.

</details>

<details>
<summary><b>feat(wiki): 주제 삭제 시 디스크 파일까지 + 부팅 시 orphan 정리</b> — <code>91460d1</code></summary>

삭제가 DB 행만이 아니라 주제 디렉터리(raw/ + wiki/)를 rm. `reapWikiOrphans()`가 DB 행 없는 `/data/wiki/<id>`를 부팅 시 제거(기존 파일 유지 동작이 남긴 잔재도 청소). 확인 대화가 파일이 영구 삭제됨을 경고.

</details>

<details>
<summary><b>feat(wiki): 컴파일에 이미지 포함(멀티모달) + 질의 그라운딩</b> — <code>2e315ce</code></summary>

이미지가 코드 제외 대상은 아니었지만 프롬프트가 언급을 안 해 사실상 무시됐고, 질의 시 그라운딩이 텍스트 `wiki/`를 가리켜 `raw/` 이미지에 도달 불가.

이제 컴파일이 멀티모달 Read로 이미지(.png/.jpg/.gif/.webp)를 읽어 다이어그램 · 스크린샷을 출처와 함께 문서에 전사/기술하고, 그라운딩이 시각 질문에는 `raw/` 이미지를 직접 열라고 지시. 빨강/파랑 테스트 이미지가 읽혀 문서에 기술됨(confidence high) 검증.

</details>

<details>
<summary><b>feat(wiki): 이미지 미리보기 + 마크다운 렌더 토글</b> — <code>a89e08e</code></summary>

`GET …/blob`이 원본 바이트를 이미지 content-type으로 스트리밍(동일 오리진 쿠키 인증)해 `<img>` 미리보기, 마크다운 렌더러를 `lib/md.ts`로 분리(채팅 + 탐색기 공유), 이미지 파일은 `<img>`로 `.md`는 렌더/원문 토글, 나머지 텍스트는 원문 유지.

</details>

<details>
<summary><b>fix(md): 제대로 된 블록 수준 마크다운 렌더러</b> — 채팅 + 위키 공용 · <code>03bae9a</code></summary>

기존 렌더러가 모든 개행을 `<br/>`로 바꿔 블록 사이가 크게 벌어졌고 hr/표/h4-6/취소선/태스크 리스트 지원이 없었음.

블록 파서로 재작성: 제목 1–6, hr(`---`/`***`/`___`), 인용, 펜스드 + 인라인 코드, ul/ol(순서 전환 시 분할) + 태스크 항목, GFM 표, 이미지, 소프트 브레이크 단락(`<br/>` 남발 대신 블록 마진). 이스케이프 우선이라 여전히 XSS 안전, NUL 센티널 플레이스홀더로 텍스트의 숫자/공백이 절대 훼손되지 않음. 인용/리스트 판정은 이스케이프 후 수행(`&gt;` 매칭). 전 문법 렌더 테스트로 검증.

</details>

<details>
<summary><b>feat(chat): 답변 · 코드 블록 복사 버튼 + 프로젝트 파일 탐색기</b> — <code>1e143de</code> <code>dfb89f1</code></summary>

- `1e143de` 메시지 hover 컨트롤로 답변 복사(어시스턴트 텍스트 블록 결합, 툴 카드 제외 / 유저 메시지는 본문), 마크다운 코드 블록마다 복사 버튼을 위임 클릭 리스너 하나로(내용이 `dangerouslySetInnerHTML`이라 React onClick 불가) — `pre code`의 textContent를 읽어 디코드된 원본 복사. 렌더 안 되는 ⧉ 글리프를 📋로 교체
- `dfb89f1` 프로젝트 채팅에 파일 버튼 추가, 위키 탐색기의 트리/미리보기를 범용 `FileExplorer`로 추출하고 `WikiExplorer`가 그걸 감쌈. 새 엔드포인트 `GET /api/projects/:id/tree|file|blob`(부풀린 디렉터리 스킵, 5000파일 상한, 경로 탈출 가드, 바이너리/대용량은 미리보기 안 함)

</details>

### 07-22 — 유저별 토큰 · i18n · 정적 데모 · git 커밋/푸시

- **docs: 작업 규칙을 담은 CLAUDE.md 신설** — `aed6b6e`

<details>
<summary><b>feat(token): 유저별 암호화 토큰 + 작성자별 해석</b> — 3커밋 + merge · <code>d06bde9</code> <code>8310b93</code> <code>37cddf9</code> <code>ee0a3d8</code></summary>

- `d06bde9` `secret-box`(AES-256-GCM 저장 암호화), `users.claude_token_enc`/`_set_at` 컬럼 + 멱등 마이그레이션, `claude-token`(유저/관리자 공통 토큰 set/clear/meta, `resolveClaudeAuth`), 설정에 `forceMock`·`tokenEncSecret` — `anthropicApiKey`는 레거시 폴백으로 강등
- `8310b93` `buildOptions`가 해석된 작성자 토큰을 주입하고 떠도는 호스트 키를 제거, `runTurn`/`probeCommands`/wiki-compile이 작성자 · 생성자별로 토큰 해석, 토큰이 없으면 전역 `mockClaude` 대신 턴 단위 mock. `PUT/DELETE /api/auth/me/claude-token`, `/me`·`/login`이 토큰 상태 노출, `POST /api/users`가 `claudeToken` 수용, 관리자 공통 토큰 엔드포인트
- `37cddf9` `MyTokenModal`(셀프 등록/수정/삭제 + nag 변형), 사이드바 '내 토큰' 항목과 미등록 배지, 토큰 등록 전까지 로그인마다 nag 모달, AdminPanel의 공통 토큰 섹션 + 유저 생성 시 선택적 토큰, `.env.example`에 `TOKEN_ENC_SECRET` + 토큰 우선순위
- `ee0a3d8` merge

</details>

<details>
<summary><b>feat(plugins): 상세(매니페스트 + 스킬) · 파일 트리 · 업데이트 API</b> — <code>bb43660</code> <code>4cc47f7</code></summary>

- `bb43660` `lib/filetree.ts`로 `walkFiles`/`resolveUnder`/`IMG_CT`를 projects · plugins 공유로 추출, `GET …/detail`(plugin.json + `skills/*/SKILL.md` 프론트매터), `GET …/{tree,file,blob}`, `POST …/update`(git fetch+reset to remote HEAD, 마켓플레이스만), `canViewPlugin`(공통은 전원, 유저 스코프는 소유자/관리자)
- `4cc47f7` 플러그인 상세 모달 — 스킬 목록, 파일 트리, 업데이트

</details>

<details>
<summary><b>feat(wiki): 이미 컴파일된 위키 임포트(컴파일 생략)</b> — <code>432ec46</code></summary>

"precompiled" 옵션. 켜면 업로드 폴더를 원본이 아니라 완성된 위키로 취급 — 스테이징 파일을 `wiki/` 아래 배치(주제 export 폴더가 둘 다 가지면 `raw/`도), `compileStatus=done` 표시, Claude 컴파일 단계 전면 생략. `mapPrecompiled()`가 스테이징 트리를 정규화(래퍼 폴더 제거, 주제 export면 `wiki/*`+`raw/*` 라우팅, 아니면 전부 → `wiki/`).

</details>

<details>
<summary><b>feat(web): i18n(한국어 + 영어)</b> — 3커밋 + merge · <code>a42a7b1</code> <code>fbf6c2d</code> <code>23476b6</code> <code>c057788</code></summary>

- `a42a7b1` 자립형 i18n 모듈(`web/src/lib/i18n.ts`): lang 상태 + localStorage 유지 + `useSyncExternalStore` 구독, `t()`/`useT()`, ko/en 사전(~230키). 기본 언어는 localStorage → `navigator.language` → ko. 채팅 헤더와 로그인 페이지에 `LangToggle`, 12개 컴포넌트 + App/store/ui의 한글 문자열 전부 외부화, `{name}` 토큰 보간
- `fbf6c2d` 언어 토글을 사이드바 상단(전역)으로 — 채팅 · 플러그인 · 관리자 어디서나. 채팅 헤더의 중복 토글 제거
- `23476b6` `LangToggle`을 절대 위치 우상단으로 띄워 264px 고정 사이드바 제목이 EN에서 줄바꿈되지 않게
- `c057788` merge(Sidebar.tsx 충돌 해소)

</details>

<details>
<summary><b>docs: i18n · README 유지 규칙 상설화 + README 갱신</b> — <code>b05471d</code> <code>7c3b6b1</code></summary>

- `b05471d` CLAUDE.md 규칙 6(모든 사용자 노출 문자열은 i18n을 거칠 것 — ko+en 양쪽 키)과 규칙 7(의미 있는 새 기능은 두 README 모두에)
- `7c3b6b1` 토큰 우선순위(개인 → 관리자 공통 → env → MOCK)를 강점 · 기능 · `.env` · 로드맵 체크에 반영, 구조 섹션에 `src/wiki`·`src/auth`·`src/usage`·웹 i18n 추가

</details>

<details>
<summary><b>feat(web): <code>/clear</code>·<code>/compact</code> 지점의 히스토리를 접이식 스택으로</b> — <code>d075c12</code></summary>

각 `/clear`·`/compact` 유저 메시지가 구간을 닫고, 그 위 대화가 타임스탬프 달린 커맨드별 토글(기본 접힘)로 축약돼 두 커맨드가 쌓이는 만큼 접힘도 쌓임. 영속 메시지 목록 위의 순수 렌더 패스라 히스토리는 절대 사라지지 않음.

</details>

<details>
<summary><b>feat(web): LLM Wiki 인용 출처 패널 + 크기 조절 + 마크다운 보정</b> — <code>0e6d4e7</code> <code>b0f9a4b</code> <code>30fb4c3</code> <code>fac5d3f</code> <code>e5aed82</code></summary>

- `0e6d4e7` 스레드별 우측 패널이 각 답변이 참고한 파일을 나열(wiki/raw 그룹). 출처는 그 턴의 Read 툴 호출 + 모델이 산문에서 언급한 `wiki/`·`raw/` 경로. 답변 속 언급은 `<mark>` 인용으로 감싸 hover 상호 강조, 클릭하면 제자리 미리보기. 모델이 공백을 접으므로 기록된 경로는 근사치 — 미리보기가 정규화된 basename으로 실제 트리 항목에 해석한 뒤 fetch하고, 진짜 못 찾으면 인라인으로 우아하게 실패
- `b0f9a4b` 왼쪽 가장자리 드래그 핸들로 패널 크기 조절(300–1000px 클램프, localStorage 유지), 기본 360px
- `30fb4c3` Notion export의 `<aside>` 콜아웃과 상대 경로 이미지가 깨지던 문제 — `md()`가 `<aside>` 래퍼를 풀고 선택적 `opts.img` 해석기로 비-http 이미지를 topic/project blob 엔드포인트에 매핑
- `fac5d3f` merge · `e5aed82` 데모 스레드에 Read 호출과 인용을 시드해 패널이 실제로 보이게

</details>

<details>
<summary><b>feat(web): 실제 앱을 그대로 비추는 정적 GitHub Pages 데모</b> — <code>d300b00</code></summary>

백엔드 없는 데모 빌드(`VITE_DEMO`)가 실제 컴포넌트 · 스토어 · 스타일을 전부 재사용하고 네트워크 층만 교체해, 데모가 동일하게 보이고 새 UI가 자동으로 나타남.

`web/src/demo`(fetch + XHR + socket.io 목: 라우터, 시드 인메모리 db, 웹 권한 프롬프트가 포함된 스트리밍 턴 시뮬레이션)를 `main.tsx`에서 `import.meta.env.VITE_DEMO` 뒤로 설치(일반 빌드에선 트리셰이킹), `build:demo` 스크립트 + Pages 배포 워크플로, favicon 참조를 `BASE_URL` 기준으로, README 데모 배지 + CLAUDE.md 규칙 8 + `web/src/demo/README.md`.

</details>

<details>
<summary><b>feat(git): 채팅에서 커밋/푸시 + 암호화된 원격 자격증명</b> — 설계 → 구현 → 보안 수정 · <code>304bbad</code> <code>a7418b8</code> <code>2abdd2c</code> <code>7053eca</code></summary>

- `304bbad` 설계 스펙 선행
- `a7418b8` `git_credentials` 테이블(유저별 + 관리자 공통, AES-GCM, 호스트 키잉), remote 호스트로 유저 → 공통 해석, HTTPS PAT는 정적 `GIT_ASKPASS` 헬퍼로(시크릿은 자식 env에만, URL · reflog에 절대 안 남음), 프로젝트 git 엔드포인트(status/commit/push)와 클론의 자격증명 피커, Claude 서브프로세스에 git author identity + push 자격증명을 줘 스스로 커밋/푸시 가능, UI · i18n · 데모 목 · README
- `2abdd2c` **보안**: 명시된 `credentialId`의 호스트가 저장소 URL 호스트와 다르면 클론 거부 — 저장된 PAT를 공격자 URL로 유출하는 것 방지(리뷰 high). `gitCommit`이 선택된 스테이징 리네임을 원본 경로까지 확장해 옛 경로의 스테이징된 삭제를 떨어뜨리지 않게(리뷰 medium)
- `7053eca` merge

</details>

### 07-23 — Git 워크플로 다듬기

<details>
<summary><b>feat(git): 브랜치 목록 + 전환, 원격 브랜치 전체 노출</b> — <code>f6a5b99</code> <code>4fccdee</code> <code>4a0cd5f</code></summary>

- `f6a5b99` `gitBranches`(현재 + 로컬 + 원격, `origin/HEAD` 필터), `gitCheckout`(DWIM: 로컬 전환 또는 원격 전용 브랜치 자동 추적), `GET /git/branches`·`POST /git/checkout`, 정적 배지를 대체한 브랜치 select
- `4fccdee` README ko/en에 브랜치 전환 언급
- `4a0cd5f` shallow 클론이 단일 브랜치라 원격 브랜치가 안 보이던 문제 — `--no-single-branch`로 클론(`--depth`만 주면 `--single-branch`가 함의됨), `gitFetchRemotes()`가 origin refspec을 `*`로 넓혀 기존 클론도 커버. 실제 네트워크 검증: 전 master만 → 후 master+test+octocat-patch-1

</details>

<details>
<summary><b>feat(git): 프로젝트 삭제(파일까지) + 선택/삭제 분리</b> — <code>f47160e</code> <code>f13a849</code></summary>

- `f47160e` `DELETE /api/projects/:id`가 작업 디렉터리도 제거하되 스코프의 projects 루트 **안쪽으로 엄격히 해석될 때만**(경로 탈출 가드). 남은 파일 때문에 같은 이름 재클론이 충돌하던 문제 해결
- `f13a849` Radix `DM.Item`의 `onSelect`가 휴지통 클릭에도 발화해 삭제가 프로젝트 전환도 시킴 — 메뉴를 controlled로 만들고 각 행을 평범한 select + delete 버튼으로

</details>

<details>
<summary><b>feat(git): 자격증명 해석 결과 표시 · full clone · 클론 브랜치 지정</b> — <code>d4749fc</code> <code>8a159b1</code> <code>895ac7d</code> <code>bf2d2aa</code></summary>

- `d4749fc` 자격증명 힌트가 Bitbucket 사용자명을 명확히(ATATT API 토큰은 이메일)
- `8a159b1` 실제 해석된 자격증명(출처: 내 것 vs 공유, 제공자, 호스트, 사용자명)과 커밋 identity를 노출해 거부 · 만료된 PAT를 한눈에 진단. `resolveGitCredMeta()`는 메타만 반환(토큰 미전송)
- `895ac7d` shallow(depth 1) 대신 full clone — `git log`/`blame` 동작. ref 갱신 fetch의 `--depth 1`도 제거(안 그러면 브랜치 조회마다 다시 shallow)
- `bf2d2aa` 클론 시 선택적 브랜치 입력 — ref 이름 검증(안전 문자, 선행 대시 금지로 `--arg` 주입 차단)

</details>

- **feat(session): 사이드바에서 개인 세션 이름 변경** — `532fba8`

<details>
<summary><b>feat(server): 선택적 TLS로 localhost 밖에서도 PWA 설치</b> — <code>64e4d0e</code></summary>

PWA 설치는 secure context가 필요한데 브라우저는 localhost만 예외로 둬 `http://<ip>`에서는 불가. `TLS_KEY`/`TLS_CERT`가 브라우저 신뢰 인증서를 가리키면 HTTPS로 서비스(socket.io와 `/cs` 프록시가 같은 서버를 타므로 리스너 하나로 전부 커버), 비면 기존대로 평문. compose env 통과 + 읽기 전용 `./certs` 마운트, README + `.env.example`, certs gitignore.

</details>

### 07-24 — PR 리뷰 세션 (설계 16절)

<details>
<summary><b>feat(review): PR 리뷰 세션 백엔드</b> — 클론 · 폴링 · 로컬 머지 · <code>b6a84fb</code></summary>

private/room/wiki와 나란한 관리자 생성 세션 타입: `review_repos`(감시 원격) + `review_sessions`(열린 PR당 1개) 스키마, GitHub/GitLab/Bitbucket Cloud PR/MR 조회 어댑터, 매니저(full clone, 호스트 폴링, PR별 git 워크트리, 로컬 `--no-ff` 머지 — 충돌은 리뷰용으로 트리에 남김, 작성자→로컬 유저 매칭), `/api/review/{repos,sessions}`(관리자 생성/폴/삭제, 작성자 읽기 전용), 리뷰 턴은 PR 워크트리 cwd에서 실행(비동기 `cwdFor`), io의 관리자 쓰기/작성자 읽기 게이팅 + `review:changed` 방송, `REVIEW_POLL_MS` 인터벌 + 수동 새로고침, 부팅 orphan 리퍼.

</details>

<details>
<summary><b>feat(review): PR 리뷰 UI · 데모 · 문서 · 폴링 타임아웃</b> — <code>6572ba3</code> <code>88630ac</code> <code>48e061e</code> <code>80b802c</code></summary>

- `6572ba3` store(리뷰 저장소/세션 상태, `openReview`, 저장소 추가/삭제/폴, 로컬 머지, `review:changed` 실시간 갱신), 사이드바 "코드리뷰" 섹션(관리자는 감시 저장소 + 중첩 PR 세션, 멤버는 자기 읽기 전용 PR), 채팅 리뷰 헤더(PR 링크, base←head, 머지 상태, 로컬 머지 버튼, 읽기 전용 배지)와 읽기 전용 작성자용 입력창/모델/모드 잠금
- `88630ac` 정적 데모에 감시 저장소(acme/webapp) + PR 리뷰 세션 2개 시드 + `/api/review/*` 목
- `48e061e` README ko/en · DESIGN 16절 · `.env` 문서화
- `80b802c` 호스트 API fetch에 `AbortSignal.timeout(20s)` — 멈춘 호스트가 `createRepo`를 막거나 폴 락을 물지 않게(`finally`가 항상 실행). `matchAuthor`에 신뢰 팀 사용자명 매칭 전제와 업그레이드 경로 주석. 적대적 리뷰 MEDIUM 2건 반영

</details>

### 07-27 — 전자동 리뷰 파이프라인 · 샌드박스 · 사용량 미터 · 모바일

<details>
<summary><b>feat(review): 전자동 파이프라인</b> — 머지 → 빌드/실행 → 리뷰 → verdict · <code>96c38b9</code> <code>c91e30e</code> <code>eca05ec</code></summary>

- `96c38b9` PR 감지 시(`REVIEW_AUTO` 기본 on) 채팅 없이 전 과정 실행: 로컬 머지 후 **무인 에이전트 턴**(리뷰 세션은 `makeAutoAllow`로 도구 자동 허용, 클래스1 펜스는 유지)이 빌드/실행 · 버그 감지 · diff 리뷰를 하고 `VERDICT: MERGE_SAFE|DO_NOT_MERGE`를 출력, `runTurn`의 `onDone`(FIFO 큐로 전달)이 verdict + summary를 파싱해 저장. 머지 충돌이면 verdict=conflict로 빌드/리뷰 생략. `approvePr()`은 관리자 명시 동작으로 호스트 API를 통해 **원격에서 실제 병합**
- `c91e30e` UI — 헤더의 VERDICT 배지(running/merge-safe/hold/conflict)와 요약 툴팁, 관리자 "자동 리뷰 실행"·"PR 병합(원격)"(확인 대화), 사이드바 배지, i18n, 데모 목
- `eca05ec` README ko/en · DESIGN · `.env` 문서화

</details>

<details>
<summary><b>fix(review): 자동 턴에서 git PAT 배제 + 재진입 가드</b> — 보안 · <code>1aa4d54</code></summary>

적대적 리뷰 결과(CRITICAL 1, HIGH 1, MEDIUM 1) 반영:

- **CRITICAL**: 리뷰 턴은 Bash 자동 허용 상태로 PR이 통제하는 코드를 빌드/실행하므로 병합 권한 git 자격증명을 더 이상 주입하지 않음(`kind=review`는 `buildGitEnv` 생략). 리뷰는 절대 push하지 않고 원격 머지는 호스트 API를 씀
- **HIGH**: `autoReview()`가 로컬 머지부터 턴의 `onDone`까지 리뷰별 in-flight 가드를 유지 — 재실행이 살아 있는 턴 아래에서 워크트리를 `git reset`/머지 하거나 verdict를 경합할 수 없음. verdict=running 동안 재실행 버튼 비활성
- **MEDIUM**: verdict는 PR 내용에 유도될 수 있는 **자문 성격의 LLM 의견** — approve 확인 대화가 관리자에게 diff를 먼저 읽으라고 안내

잔여 한계(자동 실행이 PR 코드를 실행, env의 Claude 토큰, 신뢰 못 할 저장소는 `REVIEW_AUTO=0`, 샌드박스가 업그레이드 경로)를 `makeAutoAllow`와 README 보안 posture에 문서화.

</details>

<details>
<summary><b>fix(review): 재리뷰 정확성 4연속 수정</b> — 재조회 · stale live · resume · 워치독 · <code>78c7f2c</code> <code>308c676</code> <code>1601682</code> <code>3c630de</code> <code>8028893</code></summary>

- `78c7f2c` (1) `pollRepo`가 기존 리뷰 세션의 head SHA 변경을 감지해 verdict 리셋 + 노트 + 파이프라인 재실행. (2) "안 보고 있으면 히스토리가 없어진다" — 메시지는 항상 저장되고 있었고 구멍은 턴 도중 구독하지 않은 클라이언트로의 라이브 전달: 서버가 진행 중 턴의 부분 블록을 `session:join` ack에서 재생, 클라이언트는 소켓 (재)연결 시 재조인 + 메시지 재조회
- `fbd2d10` merge PR #2
- `308c676` (A) `applyJoinState`가 항상 `live`를 설정(없으면 null)해 유령/중복 LiveView 제거. (B) 실행 중 도착한 push를 재진입 가드가 버리지 않고 `rerunPending`에 기록해 끝난 뒤 재리뷰
- `1601682` **근본 원인**: `autoReview`가 저장된 `claudeSessionId`로 턴을 enqueue 해 재리뷰가 첫 리뷰 대화를 **resume** — 모델이 자기 이전 verdict를 보고 "같은 작업"이라 판단, 갱신된 워크트리를 다시 읽지 않고 낡은 결과를 재제출. 자동 리뷰 턴마다 `claude_session_id`를 비워 매번 새 대화로
- `3c630de` 멈춘 턴이 verdict='running'에 박히고 가드가 안 풀려 재시작 없이는 재실행 불가 → `REVIEW_TURN_TIMEOUT_MS`(기본 10분) 워치독 + `settled` 플래그로 `done()`/`onDone`/워치독 멱등화
- `8028893` 워치독이 `interruptTurn`(비동기 abort) 직후 가드를 풀어 대기 재리뷰의 `git reset --hard`가 종료 중 턴과 워크트리를 경합 — 이제 가드 해제와 대기 재리뷰는 오직 턴의 `onDone`에서만

</details>

<details>
<summary><b>feat(review): PR 빌드/테스트를 격리 샌드박스 컨테이너에서</b> — 보안 · <code>768121e</code> <code>033afd6</code> <code>c876330</code> <code>0dedf93</code></summary>

- `768121e` 리뷰 턴이 신뢰할 수 없는 PR 코드를 앱 컨테이너(Docker 소켓 마운트 ≈ 호스트 root)에서 실행하지 않도록: `review/sandbox.ts`가 PR별 잠근 형제 컨테이너(워크트리만 마운트, **Docker 소켓 없음**, CapDrop ALL, no-new-privileges, 메모리/pid 제한)를 띄우고 인프로세스 MCP 툴 `mcp__sandbox__run`만 노출. 리뷰 턴은 호스트 `Bash`를 `disallowedTools`로 차단. Docker 부재 시 호스트 폴백(신뢰 팀 한계). 턴 종료 시 제거, orphan은 부팅 시 reap. 빌드 못 하는 스택은 정적 리뷰만 + verdict에 "빌드 미실행" 명시. `REVIEW_SANDBOX_IMAGE`/`_MEM_MB`/`_EXEC_TIMEOUT_MS`
- `033afd6` 워크트리의 `.git`이 메인 클론 gitdir을 절대 경로로 참조해 워크트리만 마운트하면 샌드박스 안 `git diff`/`log`가 깨짐 — `reviews/<id>` 전체를 실제 절대 경로에 마운트하고 cwd만 워크트리로
- `c876330` merge PR #3
- `0dedf93` 프롬프트가 호스트 점검(`docker` CLI 존재 등)으로 빌드 가능성을 판단하게 둬 성급히 "빌드 미실행(환경 제약)" 선언 — **툴 목록에서 `mcp__sandbox__run`의 존재가 유일한 신호**임을 명시하고, 실제 시도 후에만 환경 제약을 주장하도록 재작성

</details>

<details>
<summary><b>feat(review): 완료된 자동 리뷰를 PR 코멘트로 게시</b> — <code>60df2ce</code> <code>0b183e0</code></summary>

verdict가 나오면 판정 라벨 + 요약 + 리뷰 본문을 PR 자체에 게시(GitHub issue comment / GitLab MR note / Bitbucket PR comment, 같은 병합 권한 자격증명).

`postReviewComment()`는 enqueueTurn의 `onDone`에서 호출되되 **이번 턴이 verdict를 산출한 경우에만**(`setFinal`이 boolean 반환) — 워치독 타임아웃된 부분 리뷰는 게시하지 않음. best-effort라 실패는 시스템 노트로만 기록하고 파이프라인을 깨지 않음. `REVIEW_COMMENT`(기본 on)로 내부에만 두는 것도 가능.

</details>

<details>
<summary><b>feat(usage): 채팅 헤더에 컨텍스트 윈도우 + claude.ai 플랜 한도</b> — <code>123312f</code> <code>e40b0ce</code> <code>7f5f6ed</code></summary>

CLI의 `/usage`를 비추는 팝오버: 세션별 컨텍스트 윈도우 사용률(`getContextUsage`), claude.ai 플랜 레이트 리밋(5시간/주간/모델별)과 리셋 카운트다운(`usage_EXPERIMENTAL` SDK 컨트롤 호출, API 키 세션은 불가).

서버 `probeUsage()`가 `probeCommands`의 단명 질의 트릭(세션 resume → CLI 컨트롤 채널 질의 → abort)을 15초 TTL 캐시와 함께 재사용, `GET /api/sessions/:id/usage`. 프론트 `UsagePill`(Radix popover) + i18n + 데모 목. `e40b0ce`에서 요청자별 캐시 키 + 세션 전환 시 stale pill 제거.

</details>

<details>
<summary><b>feat(mobile): 웹 UI 전면 반응형 레이아웃</b> — <code>b6e8e22</code> <code>b6a06e6</code> <code>6ed6f9d</code></summary>

사이드바가 `<md`(768px)에서 오프캔버스 드로어가 되고 모든 상단바의 햄버거로 토글(백드롭 + 닫기, 내비게이션 · 패널 전환 시 자동 닫힘), Shell 그리드는 `≥md` 2컬럼 / `<md` 단일 + 드로어, 폰에서는 채팅 전용 강제(분할 뷰와 code-server iframe이 그 폭에서 무용, 위키 출처 패널 숨김 — 인라인 인용은 유지), `FileExplorer` 모달은 `<md`에서 세로 스택, 로그인 · 플러그인 설치 폼 · git 자격증명 · 관리자 그리드 · 사용량 표를 좁은 화면에서 유동/스크롤 가능하게, 좌우 패딩 축소, `useIsMobile` 훅 + `MobileMenuButton` 신설.

`6ed6f9d` 작업 규칙 9로 상설화: 가로 body 스크롤 금지, 고정 그리드 대신 `md:` 분기, 드로어 패턴, 폰에서 무의미한 뷰 숨김, 모바일 뷰포트 실제 검증.

</details>

### 07-28 — 방 채팅 분리 · 인터럽트 · `@` 자동완성 · 설정 레지스트리

<details>
<summary><b>feat(rooms): 팀 채팅과 Claude 지시 분리</b> — <code>83bba34</code> <code>422ef8c</code> <code>f7f5368</code></summary>

- `83bba34` 설계 스펙 선행
- `422ef8c` 입력창 모드 토글(채팅 / Claude, 기본 채팅, 방별 유지). 채팅 메시지는 방송 + 저장만 하고 Claude 턴을 만들지 않음. `@claude`/`@클로드`를 치면 지시 모드로 전환. 선택적 '채팅 포함'이 마지막 턴 이후 쌓인 팀 채팅을 프롬프트 컨텍스트로 주입. `messages.chat` 컬럼(멱등 마이그레이션), 턴 없는 방송용 `postChat()`
- `f7f5368` 리뷰 후속 — `chat=1` 메시지의 편집 어포던스를 숨김(편집이 chat 플래그 없이 `chat:send`를 재발행해 **의도치 않은 Claude 턴**을 쏘고 `/edit`으로 이후 방 히스토리를 전부 잘라냈음). `includeChat` 경계를 `gt` → `gte`로 바꿔 마지막 지시와 같은 밀리초의 채팅이 영구 누락되지 않게

</details>

<details>
<summary><b>fix(session): 중단/인터럽트가 실제로 턴을 멈추게</b> — 2단 수정 · <code>6ec7012</code> <code>daf99ab</code></summary>

- `6ec7012` 인터럽트가 `abortController`에만 의존했고 그건 CLI stdin을 닫고 graceful 경로를 ~2초 기다릴 뿐이라 모델이 계속 스트리밍. `runReal`의 루프도 abort 신호를 확인하지 않았고, 백오프 중 중단은 타이머를 끝까지 잤음. `interruptTurn`이 SDK 컨트롤 채널의 `query.interrupt()`를 즉시 발화(abort는 teardown 폴백), `runReal`이 Query 핸들을 노출하고 신호 즉시 루프 탈출, 부분 결과는 interrupted로 저장, `withRateLimitRetry`가 AbortSignal로 수면 단축. 실제 SDK 검증: `q.interrupt()`가 ~11ms에 resolve, 이후 토큰 0
- `daf99ab` **그런데도 죽어 있던 진짜 이유**: 핸들러가 부작용 호출을 옵셔널 체이닝 ack 안에 뒀음 — `ack?.({ ok: interruptTurn(p.sessionId) })`. 클라이언트는 ack 콜백 없이 emit 하므로 `ack`는 undefined이고, 옵셔널 체이닝은 단락해 **인자를 평가하지 않음** → `interruptTurn()`/`cancelQueued()`가 아예 호출된 적이 없음. 호출을 별도 문장으로 끌어올림

</details>

<details>
<summary><b>feat(chat): 입력창의 <code>@</code> 파일/폴더 자동완성</b> — <code>6bc9a74</code> <code>c3e950c</code></summary>

- `6bc9a74` 프로젝트가 붙은 채팅에서 `@`를 치면 파일 · 폴더 퍼지 검색 메뉴(폴더는 평면 트리 엔드포인트에서 유도), `/` 팔레트와 동일 조작. 선택하면 `@경로` 삽입. 문장 중간에서도 동작하고 방의 `@claude` 멘션과 공존. 기존 tree 엔드포인트 재사용, 데스크톱 + 375px 검증
- `c3e950c` 방향키가 선택만 옮기고 목록을 스크롤하지 않아 강조가 화면 밖으로 사라짐 — 모듈 스코프 콜백 ref(`scrollIntoView block:'nearest'`)를 슬래시 팔레트와 `@` 피커 양쪽에 적용

</details>

- **feat(review): 문서만 바뀐 PR은 머지/빌드/실행 생략** — 비-소스(마크다운/텍스트/이미지/LICENSE)만이면 건너뛰고 MERGE_SAFE, 모르는 파일은 소스로 셈 · `0010237`

<details>
<summary><b>feat(config): 모든 런타임 설정을 위한 관리자 설정 레지스트리</b> — 3커밋 + merge 2 · <code>b56e82b</code> <code>0ed0ba8</code> <code>bea431f</code></summary>

- `b56e82b` `server/src/lib/config-registry.ts` 하나가 모든 운영 노브의 단일 진실원. 해석 순서 DB 오버라이드 → env → 기본값. 런타임 소비자가 `cfg.int/str/bool`로 **라이브** 읽기라 관리자 편집이 재시작 없이 적용(턴 캡 세마포어, 리뷰 폴러, code-server 리퍼가 `applyLive` 훅으로 재무장). `GET/PUT/DELETE /api/admin/config`(그룹 · 타입 · 시크릿 마스킹), 공개 `GET /api/config`, AdminPanel의 그룹별 라이브 편집 UI, env + 하드코딩 상수 이관, 인프라 · 시크릿은 읽기 전용
- `0ed0ba8` 키별 표시명/설명을 i18n에서, object/array JSON 설정용 구조 편집기, Docker 이미지 존재 확인 + pull(allowlist), 재시작 버튼 + "재시작 필요" 배너
- `bea431f` 각 카테고리를 캐럿 + 항목 수를 단 접힌 `<details>`로 — JS 0줄, 접근성 유지, 모바일 대응
- merge `a4dd6f7` · `a19c330`

</details>

### 07-29 — 로컬 세션 가져오기 + 워크스페이스 확장 10종

<details>
<summary><b>feat(import): 로컬 세션 가져오기</b> — 설계 → 모듈 → 엔드포인트 → 모달 → 데모 → 문서 · 9커밋 · <code>0eae20a</code> … <code>35e5497</code></summary>

- `0eae20a` 설계 스펙(프로젝트 + `~/.claude` 세션 파일) · `eb335df` 구현 계획
- `c83b85e` 순수 세션 임포트 모듈(encode/rewrite/backfill) + 스테이징 경로
- `b793f40` 스테이징 + 확정 엔드포인트 — `POST/DELETE /api/import/staging/:sid`(파일 + 슬롯 화이트리스트 + 취소), `GET …/sessions`, `POST /api/import/sessions`(프로젝트 배치 + cwd 재작성 jsonl + 백필), 부팅 시 `reapImportStaging()`. 목적지 slug는 서버가 `encodeSlug(path.resolve(dest))`로 계산 — **클라이언트 경로는 신뢰하지 않음**
- `f8a3a86` store `importSessions` + i18n ko/en
- `c1c93cb` `ImportSessionModal` — project(폴더 선택/드롭, 루트 `.gitignore`가 기본 체크 시드) → tree(gitignore/.git 인지 체크박스 트리 + 캐스케이드, `CLAUDE.md`·`.claude/*`는 강제 체크 + 잠금) → claude(폴더 피커 + slug 인코딩 가이드, 건너뛰기 가능) → sessions(전체 선택 + 프로젝트 이름 → 확정). 취소/닫기는 스테이징 폐기
- `68e217a` 데모 목 · `e08436c` README 항목 · `35e5497` merge

</details>

<details>
<summary><b>feat(import): 트리 UX + 파일별 업로드 진행률 + 기능 플래그</b> — <code>f18bef8</code> <code>0f899dc</code> <code>f44daa8</code> <code>c675112</code></summary>

- `f18bef8` 업로드 파일 트리의 디렉터리 행 접기 · `0f899dc` `FileExplorer` + 가져오기 트리에 전체 펼치기/접기
- `f44daa8` 하나의 거대한 multipart 대신 요청당 파일 하나로 업로드 — 큰 `~/.claude` 폴더의 'Payload Too Large' 해결(트랜스크립트 하나가 20MB+). 공유 `<UploadProgress>`(바이트 기준 전체 바 + 현재 파일 바), `.claude` 피커 자동 열기 제거(macOS에서 가이드 팝업을 가림) + 숨김 폴더 단축키(Cmd+Shift+.) 안내, `uploadMaxMB` 50 → 200
- `c675112` `sessionImportEnabled` 플래그(라우트 403 + 버튼 숨김) + **CLAUDE.md 규칙 10** — 새 기능의 튜닝 상수 · 기능 플래그는 config-registry `DEFS`에 등록하고 `cfg.*`로 라이브 읽기, 서버 측도 반드시 게이트

</details>

- **docs(claude): 브랜치 작업은 명시적 지시 없으면 main 자동 병합 금지** — `9a27d4c`
- **chore: `bash.exe.stackdump` 크래시 덤프 무시** — `698d18b`

<details>
<summary><b>feat(review): 저장소별 샌드박스 이미지 · 저장소 편집 · 자가 회복</b> — <code>1aba1cd</code> <code>2dbfb3a</code> <code>5e6455e</code> <code>0eeba85</code></summary>

- `1aba1cd` 모든 프로젝트를 전역 이미지 하나(node:20-bookworm)로 돌려 Python/Rust 등은 툴체인이 없었음 — 저장소별 `sandbox_image`(nullable) + 전역 폴백
- `2dbfb3a` `PATCH /api/review/repos/:id` — 이름/base/이미지/자격증명 제자리 수정. `gitUrl`/provider/host는 불변, `credentialId`는 호스트 바인딩 + 스코프 재검증
- `5e6455e` merge PR #6
- `0eeba85` **리뷰가 중간에 멈추던 근본 원인**: 워치독이 10분 기본값에서 아직 작동 중인 턴을 죽이고 verdict=error로 표시했는데 돌아올 길이 없음(폴링은 새 PR/head 이동에만 반응). 타임아웃 10분 → 30분(최대 2시간 조정 가능), `reviewMaxRetries`(기본 2)로 타임아웃 시 'running' 유지 + 자동 재시도, 부팅 시 `recoverInterruptedReviews()`가 재시작으로 'running'에 남은 리뷰를 재큐잉(reviewAuto가 꺼져 있으면 interrupted로 표시), `onDone` 전에 샌드박스 teardown을 await 해 재시도 경로의 워크트리 경합 차단, `forgetReview()`로 삭제된 리뷰의 인메모리 잔여 정리. 적대적 동시성 검증 패스로 발견

</details>

<details>
<summary><b>feat(admin): 패널 탭 분할 · 활동 관리자 · 호스트 Docker 정리</b> — <code>063e0eb</code> <code>561e470</code> <code>6cd1ddd</code></summary>

- `063e0eb` 한 줄 스크롤을 탭 레이아웃으로(개요/유저/제공자/사용량/설정), `TABS` 배열이라 이후 탭 추가가 한 줄. 순수 프론트 재구성
- `561e470` 실행 중 Claude 턴, 대기 메시지, code-server + 리뷰 샌드박스 컨테이너, 실행 중 리뷰 파이프라인을 행별 컨트롤(인터럽트/취소/kill)과 함께 보여주는 라이브 작업 관리자. Docker 없이도 읽기 전용 스캔은 degrade, 열려 있는 동안 자동 폴링(`processPollMs`)
- `6cd1ddd` Resources 탭 — 읽기 전용 인벤토리 스캔(ccw 컨테이너, 참조 + dangling 이미지, orphan 디렉터리 · DB 행)과 정리. 전체 초기화는 spawn된 컨테이너 + dangling 이미지 + 진짜 orphan만 제거하고 **유저 데이터는 절대 건드리지 않음**(모듈 로드 assertion으로 강제). `rmSync`는 데이터 루트 아래로 봉쇄, dangling 전용 prune, orphan은 동작마다 서버가 재유도, 10분 클론 유예, 이중 확인

</details>

<details>
<summary><b>feat(mypage): 마이페이지 신설</b> — 아바타 · 토큰 · git 자격증명 · 프로젝트 · <code>9b00a83</code></summary>

프로필 이미지 업로드 · Claude 토큰 · git 자격증명 · 개인 프로젝트 관리를 'me' 패널로 통합, 토큰 · git 자격증명 진입점을 사이드바 푸터에서 클릭 가능한 프로필 행으로 이동.

**보안**: 스트리밍 층 크기 상한(413), mime + 매직바이트 검증, mime 유래 디스크 파일명(경로 탈출 안전), `safeName`이 전부 점인 프로젝트명 거부, nosniff 헤더.

</details>

<details>
<summary><b>feat(chat): 세션별 effort 선택 + 파일 첨부 · 스크린샷 붙여넣기</b> — <code>b36bc11</code> <code>d8301b3</code></summary>

- `b36bc11` 모델 선택기 옆 effort pill(low/medium/high/xhigh/max)이 SDK `Options.effort`에 연결. `chat_sessions.effort` 컬럼, `defaultEffort` 관리자 설정. 미지원 모델은 조용히 강등
- `d8301b3` 허용된 루트 안 세션별 `.attachments` 디렉터리에 업로드하고 절대 경로를 프롬프트 앞에 붙여 에이전트가 Read(이미지는 시각적으로). 첨부 버튼 · 붙여넣기 · 드래그드롭 · 썸네일 칩. **보안**: 크기 · 개수 상한, 원자적 배타 쓰기, basename 소독기(경로 탈출/RLO/ADS/윈도우 예약어), 방 GET 멤버십 게이트, nosniff. `attachmentMaxMB`/`Count`

</details>

<details>
<summary><b>feat(provider): LLM provider 오버라이드</b> — bedrock/vertex/커스텀 base URL · <code>11cec38</code></summary>

유저별 + 관리자 공통 provider 프로필이 턴 서브프로세스 env를 구성. 커스텀 base URL이 Anthropic 호환 변환 프록시를 통한 OpenAI/ChatGPT/로컬 LLM 경로. provider 미설정 시 기본 Claude 토큰 경로 그대로.

시크릿은 AES-GCM 암호화, 반환 · 로깅 안 함. `buildOptions`가 적용 전에 **모든** provider env를 비워 호스트 전역 변수가 기본/mock 턴에 새지 않게. `requireAdmin`/`requireAuth` + `llmProvidersEnabled` 게이트.

</details>

<details>
<summary><b>feat(requests): 멤버 요청 → 관리자 승인 워크플로</b> — <code>b962d99</code></summary>

액션 레지스트리를 가진 범용 승인 프레임워크(요청 가능한 관리자 동작을 한 곳에서 추가). 멤버가 사유와 함께 타입별 요청(common_project / wiki_topic / role_upgrade)을 제출하고 관리자가 새 탭에서 승인/거부, 승인 시 재사용된 create 함수로 실제 실행.

**인가**: 결정은 관리자 전용, `role_upgrade`는 요청자 본인만 승격(payload 대상 없음), `WHERE status='pending'` 원자적 claim으로 최대 1회 실행, 멤버는 자기 요청만 조회. `approvalsEnabled` 게이트.

</details>

<details>
<summary><b>feat(dm): 간단한 DM + 그룹 채팅 채널(방으로 승격)</b> — <code>74bb92b</code></summary>

Claude 없는 사람 전용 경량 메시징: Socket.IO 위의 1:1 DM과 그룹 채널, 전 유저 사용 가능. 사이드바 Messages 섹션 + `DmView`(안 읽음 배지), 관리자는 그룹 채널을 공통 프로젝트 방으로 승격.

모든 읽기/쓰기/소켓 경로가 멤버십 게이트, 승격은 관리자 전용, 소켓 페이로드 문자열 강제 변환(크래시 DoS 방지), 메시지 길이 상한, `dmEnabled` 게이트.

</details>

<details>
<summary><b>feat(ui): 손으로 만든 통일 SVG 아이콘 세트</b> — 이모지 전면 교체 · <code>ec5d444</code> <code>21dc2af</code></summary>

- `ec5d444` `web/src/lib/icons.tsx`: Svg 래퍼 하나에서 나오는 Feather/Lucide 스타일 아웃라인 아이콘 43개(currentColor, 1.75 stroke, size prop, title/aria). 16개 컴포넌트의 단독 크롬 글리프 교체. 콘텐츠 · 문서 · 데모 이모지는 유지
- `21dc2af` i18n 문자열 값에 박혀 있던 장식 이모지(관리자/플러그인/마이페이지 제목, 모드 · verdict · 툴 상태 라벨)를 제거하고 옆에 아이콘 컴포넌트를 렌더. `MODES`/`VERDICT_UI`/`ToolCard` 맵이 Icon을 지님, Modal 제목이 ReactNode로 확대, 아이콘 5개 추가. 진짜 콘텐츠 기호(→, ＋, ⌘⇧)만 남김

</details>

### 07-30 → 07-31 — 요청 흐름 마감 · 첫 릴리스 직전

<details>
<summary><b>feat(requests): 공통 프로젝트 생성도 요청-게이트, 실제 폼과 동일 입력</b> — <code>dfbc5ae</code> <code>9397a48</code></summary>

멤버는 공통(공유) 프로젝트를 직접 만들 수 없고, 공유 `ProjectCreateForm`이 멤버+공통 제출을 `POST /api/projects`(비관리자의 scope=common은 여전히 403) 대신 승인 흐름으로 라우팅.

요청이 **실제 생성 UI와 같은 필드**(이름 + git 클론 URL + 브랜치 + 자격증명 피커)를 실어 나르고, 승인 시 `common_project` 액션이 요청자로서 실제 클론을 수행. `createProject`/`validateProjectInput`을 추출해 라우트와 액션이 공유하되 제출 · 실행 양쪽에서 자격증명 소유권 + 호스트 매칭 검사 보존. 폼은 채팅 프로젝트 메뉴(개인/공통 토글)와 마이페이지에서 재사용. `9397a48`은 10개 기능 그룹 병합.

</details>

<details>
<summary><b>docs(readme): 캡처 기반 기능 투어 갤러리 23장</b> — <code>c4c2f0f</code></summary>

정적 데모(MOCK 모드, 실제 UI)에서 캡처한 `docs/screenshots/*.png`로 전 기능 커버(채팅/툴 카드, 웹 권한 프롬프트, 사용량 미터, 슬래시 + `@` 메뉴, 방 + 위임, DM/그룹, git 패널, 분할 에디터, LLM Wiki + 출처, PR 리뷰 verdict, 마이페이지, 관리자 전 탭, 플러그인, i18n(ko), 모바일/PWA). 두 README에 "기능 둘러보기" 섹션 삽입.

`main.tsx`가 데모 빌드에서만 zustand store를 window에 노출(프로덕션은 트리셰이킹)해 스크린샷/e2e 도구가 뷰를 결정적으로 조작.

</details>

<details>
<summary><b>fix: 로그인 Enter · IME 조합 중 Enter · 이미지 라이트박스</b> — <code>f182546</code> <code>fe30ac2</code> <code>90954fd</code></summary>

- `f182546` `LangToggle` 버튼에 type이 없어 submit이 기본값. 로그인 폼의 첫 submit 버튼이라 입력에서 Enter를 치면 로그인 대신 그게 눌려 언어가 바뀜 → `type="button"`
- `fe30ac2` 이미지 첨부 클릭 시 원본 크기 라이트박스(Radix Dialog 오버레이 — Esc + 포커스 트랩 무료), 입력창과 트랜스크립트 썸네일 양쪽
- `90954fd` 한글 음절이 아직 조합 중일 때 Enter를 누르면 제출 + textarea 비우기가 발화하고, 열려 있던 조합이 빈 필드에 마지막 글자를 다시 커밋해 중복 → submit/edit/DM 전송 Enter 핸들러를 `!e.nativeEvent.isComposing`으로 가드

</details>

---

## 설계 원본과의 차이

[DESIGN.md](DESIGN.md)는 P0–P5 + PR 리뷰까지를 규정한다. 그 뒤 실제로 붙은, 원설계에 없던 축은 다음과 같다.

| 축 | 상태 |
|---|---|
| 유저별 API 키 (15절 "확장 seam") | **구현됨** — 유저별 암호화 토큰 + 작성자별 해석 (07-22) |
| 웹훅 수신 (16절 "미구현") | **구현됨** — 저장소별 시크릿 + 폴링 on/off (v1.7.0) |
| 풀 git GUI (15절 "범위 밖") | **부분 구현** — 커밋 · 푸시 · pull · 브랜치 · remote · init/publish · diff · 히스토리 그래프 (v1.9.0까지) |
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
