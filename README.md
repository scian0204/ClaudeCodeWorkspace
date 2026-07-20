# ClaudeCode Workspace

서버 1대에 상주하는 Claude Code를 **팀 단위(또는 개인 원격)**로 쓰는 웹 워크스페이스.
세션마다 프로세스가 격리되며, 여러 명이 같은 세션을 공유하는 **공유 대화방**과 통합 **code-server 에디터**를 제공한다.
UI/UX는 Claude Code 데스크톱 앱을 따른다. 설계 전문은 [DESIGN.md](DESIGN.md).

## 핵심 기능

- **개인 채팅** — Agent SDK가 세션마다 Claude CLI 서브프로세스를 spawn (per-session `HOME`/`cwd`/plugins 주입).
- **공유 대화방** — 방 = 워크스페이스 엔티티. FIFO 큐 + 대기취소 + 발화자 프리픽스 + 라이브 팬아웃(WebSocket). 방장 + 멤버별 권한 위임.
- **웹 권한 프롬프트** — `canUseTool` 콜백이 멈추고 웹에서 허용/거부/항상. 모드(default·acceptEdits·bypass·plan) + admin 천장. 격리 deny 펜스는 모드 무관 항상 적용.
- **code-server 통합** — 유저/방별 컨테이너를 dockerode로 spawn/reap, 볼륨 subpath로 스코프 제한, 인앱 프록시 `/cs/<uid>/<projectId>/<token>`.
- **플러그인** — 공통(admin: 마켓+로컬업로드+필수강제) / 개인(유저: 마켓+업로드+on/off). 2클래스 오버라이드.
- **관리자 패널** — 사용자 발급, 사용량 대시보드(가시성), 전역 설정, 공용키 전역 동시성 캡 + 429 백오프.

## 빠른 시작 (개발)

```bash
npm install                 # 워크스페이스 전체 설치 (server + web)
cp .env.example .env        # ANTHROPIC_API_KEY 넣으면 실제 Claude, 비우면 MOCK 모드
npm run dev                 # server(:3000) + web(:5173, Vite proxy) 동시 실행
```

브라우저에서 http://localhost:5173 → 초기 관리자 **admin / admin** 로그인 (배포 후 변경).

> `ANTHROPIC_API_KEY`가 없으면 **MOCK 모드**로 동작한다(에코 에이전트 — 스트리밍/권한/툴카드 UX를 키 없이 그대로 시연 가능). code-server(에디터)는 도커 배포에서만 동작한다.

## 도커 배포 (프로덕션)

```bash
cp .env.example .env        # 최소 SESSION_SECRET, ANTHROPIC_API_KEY 설정
docker compose up -d --build
```

- 단일 `app` 이미지(멀티스테이지: web 빌드 → Fastify + 정적서빙 + Claude CLI). 포트 3000.
- 호스트 도커 소켓 마운트 → code-server를 **형제 컨테이너**로 동적 spawn(dind 아님). 내부 네트워크 `claudecode_internal`, 호스트 미노출.
- `/data`는 네임드 볼륨 `claudecode-workspace_data`. code-server 형제는 이 볼륨을 이름 + subpath로 참조(자기 프로젝트 + 공통만).
- code-server 볼륨 subpath 마운트는 Docker Engine ≥ 26 필요.

## 주요 환경변수 (.env)

| 변수 | 설명 |
|---|---|
| `ANTHROPIC_API_KEY` | 공용 단일 키. 비면 MOCK 모드 |
| `SESSION_SECRET` | 쿠키 서명 시크릿 (**반드시 변경**) |
| `MAX_CONCURRENT_TURNS` | 공용키 전역 동시 턴 캡 (기본 3) |
| `BOOTSTRAP_ADMIN_USER/PASSWORD` | 최초 부팅 시 admin 계정(유저 0명일 때만) |
| `CODE_SERVER_IMAGE` | 에디터 이미지 (기본 codercom/code-server) |
| `CODE_SERVER_IDLE_MS` | 유휴 컨테이너 reaper 타임아웃 (기본 30분) |

## 구조

```
server/            Fastify + Socket.IO + Agent SDK + SQLite/Drizzle + dockerode
  src/claude/      session-manager(턴 실행), config-layering(HOME/cwd/펜스), permissions(canUseTool 브리지), throttle
  src/rooms/       manager(멤버십·방장·위임), queue(FIFO)
  src/codeserver/  manager(spawn/reap), proxy(/cs http+ws)
  src/routes/      sessions·rooms·projects·plugins·admin (+ auth)
web/               React + Vite + Tailwind + Radix + zustand + socket.io-client
DESIGN.md          확정 설계 스펙
Dockerfile,docker-compose.yml
```

## 빌드 단계 (구현 완료)

P0 골격 · P1 개인채팅+SDK · P2 프로젝트/code-server · P3 플러그인 · **P4 공유 대화방(첫 릴리스 커트라인)** · P5 관리자/운영.

## 보안 posture (경량 — 신뢰 팀/개인 전제)

앱 로그인 + 세션 쿠키 수준. 도커 소켓 마운트 = 앱이 사실상 호스트 root. 에이전트 파일 접근은 소프트 펜스(파일툴 경로 차단), 사람의 code-server 터미널은 컨테이너 하드 격리 + 공용키 미노출. 무신뢰 멀티테넌트 용도 아님.
