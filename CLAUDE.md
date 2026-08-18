# CLAUDE.md

ClaudeCode Workspace — 서버 1대 상주 Claude Code 팀 워크스페이스. 전체 스펙은 [DESIGN.md](DESIGN.md).

- 백엔드: `server/` (Fastify + TS, Agent SDK 세션당 서브프로세스, SQLite/Drizzle)
- 프론트: `web/` (React + Vite + Tailwind)
- 배포: `docker-compose.yml` (app + 동적 spawn code-server 형제 컨테이너)

## 작업 규칙 (반드시 준수)

1. **큰 작업은 브랜치 분리.** 규모가 크다고 판단되면 `main`에서 feature 브랜치를 파고 개발한다. 브랜치에서 작업한 경우, **사용자의 명시적 지시가 없으면 `main`에 바로 병합하지 않는다.** 브랜치 상태로 두고 병합 여부를 사용자에게 확인받는다.
2. **기능 단위 커밋.** 별도 지시가 없어도 하나의 기능/논리 단위가 끝날 때마다 커밋한다. 커밋 메시지는 `feat/fix/...` 컨벤션.
3. **완료 후 docker compose 반영 + Docker Hub 배포.** 기능 개발이 끝나면 `docker compose`로 프로젝트가 실행 중인지 확인하고, 빌드 & 재실행해서 변경을 반영한다. 그 다음 버전을 올려 Docker Hub(`cian0204/claudecode-workspace`)에 이미지를 push 한다.
   ```bash
   docker compose ps
   npm run compose:up      # = docker compose up -d --build && docker image prune -f
   npm run release:patch   # 버그픽스·자잘한 수정 (새 기능이면 release:minor)
   ```
   - **로컬 빌드는 반드시 `npm run compose:up`으로** 한다. `docker compose up -d --build`를 맨손으로 돌리면 재빌드마다 이전 이미지가 `:latest` 태그를 잃고 dangling(`<none>`)으로 쌓인다. `compose:up`은 빌드·재실행 후 `docker image prune -f`로 즉시 정리한다(dangling만 삭제 — 태그 달린 이미지·실행 중 컨테이너·볼륨·빌드 캐시는 건드리지 않음).
   - 릴리스로 생긴 구버전 태그(`:1.2.3`, `:sha-abc1234`)까지 비우려면 명시적으로: `docker image rm cian0204/claudecode-workspace:<태그>`. 빌드 캐시가 커졌으면 `docker builder prune -f`.
   - **`docker builder prune`은 릴리스 빌더의 캐시를 지우지 않는다.** `release:*`가 쓰는 `ccw-multi` 빌더(docker-container 드라이버)는 캐시를 **자기 볼륨**(`buildx_buildkit_ccw-multi0_state`)에 따로 쌓는데, `docker builder prune`·`docker image prune`·`docker system df`의 Build Cache 항목 모두 여기를 못 본다. 실제로 이게 92GB까지 자라 디스크를 채우고 Docker 엔진을 죽인 적이 있다(2026-08-19). 이제 `scripts/release.mjs`가 push 성공 후 `10GB`로 잘라내며, 상한은 `BUILDX_KEEP_STORAGE`로 조절한다. 수동 확인·정리:
     ```bash
     docker system df                                   # Local Volumes 항목이 크면 이 볼륨을 의심
     docker buildx prune --builder ccw-multi -a -f       # 전부 비우기
     ```
   - Docker Desktop의 이미지 스캐너(Scout)는 실행마다 취약점 DB를 `%TEMP%\trivy-*`·`%TEMP%\docker-scout`에 복사해 쌓는다(31GB까지 자란 적 있음). 설정에서 꺼둔 상태(`settings-store.json`의 `SbomIndexing: false`) — 다시 켜지 말 것.
   - **디스크가 꽉 차면 Docker 엔진이 모든 API에 500을 반환하고 워크스페이스도 함께 내려간다.** 복구: 공간 확보 → Docker Desktop 종료 → `wsl --shutdown` → Docker Desktop 재시작. VM 디스크(`%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx`)는 **워크스페이스 `/data` 볼륨을 담고 있으므로 절대 삭제하지 않는다.**
   - `release:*`는 `npm version`으로 `package.json` 버전을 올리고 git 태그(`vX.Y.Z`)를 만든 뒤, `scripts/release.mjs`가 `:버전`·`:latest`·`:sha-<short>` 3개 태그로 build & push 한다.
   - **기본은 amd64만**(빠름, 약 1–2분). arm64까지 멀티아치로 올리려면 `npm run release:patch -- --arm` (arm64는 qemu 에뮬 빌드라 느림, 약 20–30분 — **가끔만**).
   - **선행 조건**: 이 머신에서 최초 1회 `docker login`(Docker Hub 토큰) 되어 있어야 한다. 미로그인 시 push가 auth 에러로 실패한다. (Claude은 자격증명을 직접 입력하지 않는다 — 로그인은 사용자가 수행.)
   - `npm version`은 작업 트리가 깨끗해야 동작하므로 **커밋(규칙 2) 후** 실행한다. 버전을 안 올리고 재-push만 하려면 `npm run release`.
4. **최종 답변은 한글.** 사용자에게 보내는 최종 답변은 한글로 작성한다. (코드/커밋/에러 문자열은 원문 유지)
5. **끝까지 자율 완료.** 크게 모순되거나 방향이 갈리는 지점이 아니라면, 매번 확인받지 말고 직접 판단해 작업을 끝까지 완료한다.
6. **UI 문자열은 항상 다국어(i18n).** 프론트(`web/`)에 사용자에게 보이는 문자열을 추가/수정하면 절대 하드코딩하지 말고 반드시 i18n을 거친다.
   - 사전: `web/src/lib/i18n.ts` 의 `DICT` — `ko`/`en` 두 딕셔너리에 **동일 키를 양쪽 다** 추가한다. (키 하나만 있으면 `ko` → raw key 순으로 폴백)
   - 컴포넌트: `const t = useT();` 후 `t('scope.key')`. 변수 삽입은 `t('key', { name })` + 사전값에 `{name}` 플레이스홀더.
   - React 밖(store 등): `import { t } from './i18n'` (비반응형) 사용.
   - 키 네이밍: 기존 `scope.camelCase` 컨벤션 유지(`sidebar.*`, `common.*`, `chat.*` 등). 조건부 문구는 키 2개로 분기(예: `t(flag ? 'x.a' : 'x.b')`).
7. **중요 기능은 README 반영.** 자잘한 수정(버그픽스·리팩터·문구 조정)이 아니라, 사용자가 체감하는 새 기능/워크플로가 추가되면 스스로 판단해 `README.md`(영문)와 `README.ko.md`(국문) **양쪽**의 관련 섹션(기능 목록 등)에 간결히 추가한다. 애매하면 넣는 쪽으로.
8. **새 기능은 정적 데모에도 반영.** 프론트(`web/`)에 사용자에게 보이는 기능을 추가/변경하면, GitHub Pages 정적 데모(`npm run build:demo`, `VITE_DEMO`)에서도 그대로 눌러볼 수 있게 목(mock) 레이어를 함께 갱신한다. 데모는 **실제 컴포넌트·스토어를 그대로 재사용**하므로 UI/스토어 변경은 자동 반영되지만, 백엔드 의존은 목으로 채워야 한다.
   - 새 **REST 엔드포인트**(`api.get/post/...` 또는 raw `fetch('/api/...')`) → `web/src/demo/router.ts`에 라우트 추가 + 필요한 시드는 `web/src/demo/data.ts`.
   - 새 **socket 이벤트**(emit/on) → `web/src/demo/socket.ts`에서 처리(들어오는 이벤트는 시뮬레이션, 나가는 이벤트는 해석).
   - 검증: `npm run build:demo -w web` 후 `npx vite preview --base=/ClaudeCodeWorkspace/`로 브라우저 확인. 상세 가이드는 [web/src/demo/README.md](web/src/demo/README.md).
9. **UI는 반응형(모바일) 필수.** 프론트(`web/`)에 사용자에게 보이는 UI를 추가/변경하면 데스크톱만 보지 말고 항상 모바일(폭 <768px = Tailwind `md` 브레이크포인트)도 함께 맞춘다. 페이지 body는 **가로 스크롤이 절대 없어야** 한다(넓은 표·코드·다이어그램은 자체 `overflow-x-auto` 컨테이너로 감싼다).
   - 레이아웃: 고정 px 폭이나 다단 그리드를 무조건 깔지 말고 `md:` 로 분기한다(`grid-cols-1 md:grid-cols-[...]`). 사이드바성 패널은 `<md`에서 오프캔버스 드로어로 — 기존 `sidebarOpen`(store) + `useIsMobile`(`web/src/lib/ui.tsx`) 패턴 재사용.
   - 새 상단바/헤더에는 `MobileMenuButton`(`web/src/lib/ui.tsx`)을 넣어 어느 화면에서도 드로어를 열 수 있게 한다. 모달 내부의 다단 그리드는 `<md`에서 세로로 스택.
   - 폰에서 의미 없는 뷰(code-server iframe, split 등)는 `useIsMobile`로 모바일에서 숨기고 chat 전용으로 강제한다. 좌우 패딩은 `px-3 md:px-5`처럼 화면에 맞춰 줄인다.
   - 검증: 데모/dev를 모바일 뷰포트(예: 375px)로 실제 확인하고, 데스크톱(≥768px)이 그대로인지도 함께 본다.
10. **튜닝 상수·기능 플래그는 관리자 설정으로.** 새 기능에 (a) 운영자가 바꿀 만한 값(타임아웃·크기/개수 한도·폴링 주기·이미지 태그 등)이나 (b) 켜고 끌 만한 기능 토글이 생기면, 코드에 상수로 박지 말고 **`server/src/lib/config-registry.ts`의 `DEFS`에 등록**한다. 등록만 하면 관리자 API(`/api/admin/config`)와 관리자 패널 UI에 자동 노출된다.
    - 값 사용처: `cfg.int/str/bool('key')`로 **라이브** 읽기(관리자 편집이 재시작 없이 반영). 부팅 시 1회만 읽는 값(서버 생성자 등)은 `restart: true`.
    - 라벨: i18n에 `cfg.<key>`/`cfgDesc.<key>`를 **ko/en 양쪽** 추가(없으면 key가 그대로 노출됨). 새 그룹이면 `admin.cfgGroup.<group>`도 양쪽 추가.
    - 클라이언트가 알아야 하는 플래그는 `publicConfig()`(→ `/api/config`)에 실어 보내고, store(`refreshLists`)에서 읽어 UI를 게이팅한다. 서버 측에서도 반드시 게이트(엔드포인트에서 차단) — UI 숨김만으로 끝내지 말 것.
    - 판단 기준: "값이 절대 안 변한다" → 상수 유지(YAGNI). "운영 중 조정하거나 끌 여지가 있다" → 설정으로 뺀다. 애매하면 빼는 쪽.
11. **모든 커밋은 업데이트 노트에 남긴다.** 기능 추가·수정·버그픽스·리팩터 무엇이든 커밋(규칙 2)할 때 [CHANGELOG.md](CHANGELOG.md)(영문)와 [CHANGELOG.ko.md](CHANGELOG.ko.md)(국문) **양쪽**에 항목을 추가한다. README(규칙 7)는 "사용자가 체감하는 기능"만 올리지만, 여기는 **전 커밋**이 대상이다.
    - **위치**: 아직 릴리스되지 않은 커밋은 최상단 `## Unreleased` 섹션(없으면 새로 만든다)에 쌓는다. `npm run release:*`로 버전을 올릴 때 그 제목을 `## vX.Y.Z — YYYY-MM-DD`로 바꾸고 바로 아래에 `<sub>릴리스 커밋 \`해시\`</sub>`를 넣는다(해시는 release 커밋이 생긴 뒤 채운다). 초기 개발 구간(날짜별 `###`)은 과거 기록이므로 건드리지 않는다.
    - **형식**: 커밋 하나 = `<details>` 하나. 요약 줄에는 제목과 해시만, 본문에 상세.
      ```markdown
      <details>
      <summary><b>feat(scope): 한 줄 제목</b> — 짧은 부연 · <code>a1b2c3d</code></summary>

      왜 필요했는지(버그면 **근본 원인**), 어떻게 고쳤는지, 새 설정 키·엔드포인트·보안 판단.

      </details>
      ```
      - `<summary>` 다음 줄과 `</details>` 앞에는 **빈 줄**이 있어야 GitHub이 내부 마크다운을 렌더한다.
      - 상세가 한 줄로 끝나는 자잘한 커밋은 토글 대신 `- **제목** — 설명 · \`해시\`` 불릿으로. merge 커밋도 `- merge: \`브랜치\` — \`해시\`` 한 줄.
      - 관련 커밋이 여러 개면(같은 기능의 연속 수정 등) 토글 하나로 묶고 본문에서 해시별로 나눈다. 한 버전의 항목이 8개를 넘으면 `#### 주제` 소제목으로 그룹핑.
    - **내용 기준**: 커밋 제목을 그대로 옮기지 말고 *무엇이 왜 바뀌었는지*를 쓴다. 버그픽스는 증상이 아니라 원인(예: "옵셔널 체이닝이 인자를 평가하지 않아 호출 자체가 없었음"), 보안 관련은 무엇을 막는지, 새 설정은 키 이름을 명시.
    - **쉬운 말로 쓴다(문서 전반: CHANGELOG·README).** 독자는 이 코드를 안 본 사람이다. 버그 항목은 **증상 → 원인 → 조치** 순서로 나눠 쓰고, 한 문장에 절을 3개 넘게 쌓지 않는다. 작업하면서 머릿속에 생긴 은유·내부 용어(프로브·콜드 스타트·스폰·배관·굶다·스트림 오염·포그라운드/백그라운드·last-known-good·헤드리스·클램프·게이팅·리플레이·페르소나·papercut 등)는 **문서에 그대로 옮기지 않는다** — 조회 · CLI 시작 시간 · 새로 실행 · 내부 동작 · 시간을 넘겨 실패 · 승인 통로가 끊김 · 순서대로 실행/뒤에서 따로 실행 · 마지막에 정상 조회된 값 · 화면 없이 실행 · 권한 상한 · 켜고 끄기 · 앞부분을 다시 받아 봄 · 이름 붙은 에이전트 · 자잘한 불편 처럼 **행동으로** 쓴다. 설정 키·환경변수·API 경로·에러 문자열·`feat/fix` 같은 식별자는 원문 그대로 둔다.
    - 상단 요약(커밋 총계·타임라인 표)의 수치도 함께 갱신한다. 해시 누락 점검: `git log --pretty=%h | sort > /tmp/a; grep -oE '\b[0-9a-f]{7}\b' CHANGELOG.md | sort -u > /tmp/b; comm -23 /tmp/a /tmp/b` — CHANGELOG 자체를 고친 커밋만 남으면 정상.

12. **가이드 에이전트도 같이 업데이트.** 우측 하단 가이드 패널(`server/src/guide/`)은 워크스페이스의 **모든** 기능을 설명하고 실행할 수 있어야 한다. 사용자에게 보이는 기능을 추가/변경했으면 아래 중 해당하는 곳을 반드시 함께 고친다(규칙 7 README와 같은 판단 기준 — 애매하면 넣는 쪽).
    - **설명**: `server/src/guide/prompt.ts`의 `FEATURES` — UI에 뜨는 이름 그대로 한 줄, 기능 플래그가 있으면 키 이름도. 사람이 직접 해야 하는 것(삭제·자격증명·파일 업로드·PR 머지 등)은 `BY_HAND`에, 여러 단계를 거치는 흔한 요청은 `RECIPES`에 추가한다.
    - **실행(REST)**: `server/src/guide/api-map.ts`의 `API_ROUTES`에 새 엔드포인트를 올린다. `note`가 그대로 프롬프트의 API 레퍼런스가 되므로 바디 필드까지 적는다. 단 **DELETE · 자격증명/비밀값 · 관리자 인프라 동작(재시작·백업/복구·이미지 pull·사용자 생성) · 서버 밖으로 나가 되돌리기 어려운 동작(PR 머지, 저장소 publish, 웹훅 시크릿 발급) · 멀티파트 업로드**는 올리지 않는다(파일 상단 주석 참고).
    - **실행(브라우저 전용)**: API가 없는 UI 동작(패널 열기·뷰 전환 등)은 `server/src/guide/ui-actions.ts`의 `UI_ACTIONS`에 추가하고, **반드시** `web/src/lib/store.ts`의 `applyGuideAction`에 같은 이름의 `case`도 추가한다(한쪽만 있으면 조용히 무시된다).
    - 검증: `npx tsx server/src/guide/api-map.test.ts` — 허용목록 경계와 `UI_ACTIONS` ↔ 스토어 미러를 검사한다. 단축키를 바꿨으면 `prompt.ts`의 `SHORTCUTS` 요약도 `web/src/lib/shortcuts.ts`에 맞춘다.
    - 정적 데모(규칙 8)의 가이드 답변은 `web/src/demo/socket.ts`의 `guidePlan()`에 있다 — 데모에서도 눌러볼 만한 기능이면 인텐트를 추가한다.

## 개발

```bash
npm run dev        # server + web 동시 (concurrently)
npm run typecheck  # server + web 타입체크
npm run build      # web 프로덕션 빌드
```
