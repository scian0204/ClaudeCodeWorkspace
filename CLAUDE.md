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

## 개발

```bash
npm run dev        # server + web 동시 (concurrently)
npm run typecheck  # server + web 타입체크
npm run build      # web 프로덕션 빌드
```
