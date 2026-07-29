# CLAUDE.md

ClaudeCode Workspace — 서버 1대 상주 Claude Code 팀 워크스페이스. 전체 스펙은 [DESIGN.md](DESIGN.md).

- 백엔드: `server/` (Fastify + TS, Agent SDK 세션당 서브프로세스, SQLite/Drizzle)
- 프론트: `web/` (React + Vite + Tailwind)
- 배포: `docker-compose.yml` (app + 동적 spawn code-server 형제 컨테이너)

## 작업 규칙 (반드시 준수)

1. **큰 작업은 브랜치 분리.** 규모가 크다고 판단되면 `main`에서 feature 브랜치를 파고 개발, 완료 시 `main`으로 병합한다.
2. **기능 단위 커밋.** 별도 지시가 없어도 하나의 기능/논리 단위가 끝날 때마다 커밋한다. 커밋 메시지는 `feat/fix/...` 컨벤션.
3. **완료 후 docker compose 반영.** 기능 개발이 끝나면 `docker compose`로 프로젝트가 실행 중인지 확인하고, 빌드 & 재실행해서 변경을 반영한다.
   ```bash
   docker compose ps
   docker compose up -d --build
   ```
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

## 개발

```bash
npm run dev        # server + web 동시 (concurrently)
npm run typecheck  # server + web 타입체크
npm run build      # web 프로덕션 빌드
```
