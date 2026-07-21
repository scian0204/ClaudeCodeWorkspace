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

## 개발

```bash
npm run dev        # server + web 동시 (concurrently)
npm run typecheck  # server + web 타입체크
npm run build      # web 프로덕션 빌드
```
