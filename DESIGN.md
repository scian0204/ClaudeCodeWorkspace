# ClaudeCode Workspace — 설계 스펙 (DESIGN.md)

> 서버 1대에 상주하는 Claude Code를 팀 단위(또는 개인 원격)로 쓰는 웹 워크스페이스.
> UI/UX는 Claude Code 데스크톱 앱을 따라간다. 이 문서는 grilling 세션으로 확정된 빌드 스펙이다.

목업: https://claude.ai/code/artifact/f09ede0d-b888-43b6-8c8a-76c43c618503

---

## 1. 목표 / 범위

- **타겟:** 상호 신뢰하는 개발 팀, 또는 개인 원격 사용자.
- **핵심 가치:** 서버 1대가 세션별 격리된 Claude Code + code-server 워크스페이스를 제공. 공통/개인 플러그인·프로젝트를 웹에서 관리.
- **비목표(v1):** 무신뢰 멀티테넌트 SaaS, 강한 하드 격리(에이전트 측), 유저별 API 키, 실시간 협업편집(CRDT).

---

## 2. 아키텍처 핵심

- **세션 모델 B + 공유방 A 하이브리드:** "단 하나의 Claude Code"는 *배포 단위 하나*를 뜻함(런타임 프로세스 하나가 아님). 서버 1대가 세션마다 프로세스를 격리. 추가로 여러 유저가 같은 세션을 공유하는 **공유 대화방(단체채팅형)**을 제공.
- **구동 = Agent SDK (TypeScript).** `query()`가 세션마다 **Claude CLI 서브프로세스**를 spawn한다(in-process 아님). 스트리밍 입력(`AsyncIterable<SDKUserMessage>` + `streamInput()`) + `interrupt()`(`still_queued` 반환)를 사용.
- **신뢰 모델 = 상호신뢰 팀/개인.** 격리는 소프트 펜스로 처리하고 보안은 **경량 posture**로 간다("쉽게 접근만 못하게").
- **공용 API 키 1개(v1).** 키 해석 로직만 추상화해 나중 "유저별 키" 옵션을 끼울 seam을 남긴다(지금은 안 만듦).

### 2.1 검증된 Agent SDK 사실 (per-call Options)
`cwd`, `env`(HOME 포함), `settingSources`, `plugins`(로컬 경로), `mcpServers`, `agents`, `permissionMode`, `allowedTools`/`disallowedTools`, `canUseTool`, `hooks`, `additionalDirectories`, `resume`/`sessionId`/`forkSession`, `pathToClaudeCodeExecutable` — 전부 호출별 지정 가능. `settingSources`는 tier(user/project/local) 선택만 가능하며 임의 경로를 가리키지 못한다 → 공통 tier는 명시 주입으로 처리.

---

## 3. 파일시스템 레이아웃

```
/data
  /common
    /.claude        # 공통 settings, agents, commands, skills (admin 관리)
    /plugins        # 공통 플러그인 (로컬 경로로 주입)
    /projects       # 공통 프로젝트 (팀 공유 편집)
  /users/<uid>
    /.claude        # 개인 settings + 개인 플러그인/agents
    /projects       # 개인 private 프로젝트
  /rooms/<roomId>
    /.claude        # 방 settings (공통 tier 주입 + 방 설정)
    /projects       # 방 전용 프로젝트
  app.db            # SQLite 메타 인덱스
```
- `/data`는 **네임드 도커 볼륨**. 앱 컨테이너와 code-server 형제 컨테이너가 이름으로 참조.

---

## 4. Config 레이어링 & 오버라이드

**레이어링(하이브리드 주입):**
- **개인 tier:** 세션에 `env.HOME=/data/users/<uid>` → `~/.claude`가 개인 설정/플러그인으로 자연 해석.
- **방 tier:** `env.HOME=/data/rooms/<roomId>` 동일 방식.
- **공통 tier:** 앱이 명시 주입 — 공통 플러그인 `plugins:[/data/common/plugins/...]`, 공통 MCP `mcpServers`, 공통 agents `agents`, 공통 deny/permission은 옵션으로.
- **프로젝트:** 유저/방이 연 프로젝트 = `cwd`.

**오버라이드 정책 — 2 클래스:**
- **클래스 1 (보안/정책 잠금, 유저 오버라이드 불가):** 격리 deny 룰(타 유저 경로·`~/.claude`·키 경로 차단), `additionalDirectories` 펜스, `permissionMode` 하한선. **항상 마지막에 강제 적용.**
- **클래스 2 (편의 기본값, 오버라이드/확장 가능):** 공통 플러그인·MCP·agents·기본 모델. 기본 ON, 유저가 자기 세션서 끄기 + 개인 것 추가 가능. 이름 충돌 시 **개인 우선**(클래스1 예외).
- admin은 특정 공통 플러그인을 **필수 강제**(유저 비활성 불가 = 클래스1로 승격)로 지정 가능.

---

## 5. 권한 (툴 승인) 모델

- **접근법 = 하이브리드(c).** 기본은 웹 인터랙티브 프롬프트(`canUseTool` 콜백이 멈추고 웹 클라에 Allow/Deny/Always 띄움). 세션별 모드 토글(default / acceptEdits / bypass), admin이 **천장** 지정(예: bypass 금지 가능). 클래스1 잠금 deny 펜스는 모드 무관 항상 적용.
- **공유방 승인권:** **방장**이 기본 보유. 방장이 멤버별로 위임 가능(멤버 목록 UI에서 닉네임 옆 토글).
  - **위임 가능:** 툴 승인, 인터럽트, 멤버 초대/추방, 방 삭제, 방장 이양.
  - **방장 전용(위임 불가):** 방 권한모드 변경.
  - 주의(수용됨): 방삭제·방장이양까지 위임 가능 = 위임 멤버가 방을 날리거나 자기한테 이양 가능(footgun). 신뢰 팀 전제로 수용.

---

## 6. 공유 대화방

- **방 = 워크스페이스 엔티티**(`/data/rooms/<roomId>`), HOME=방, 멤버 attach. 개인 유저와 평행 구조.
- **세션 연속성:** 방 = 장기 단일 세션(resume 계속, 컨텍스트 넘치면 자동 compact) + "새 주제 리셋" 옵션.
- **동시성:** **FIFO 큐** — 한 명 턴 중이면 다음 메시지 대기, 끝나면 자동 처리. "Claude 작업 중 · 대기 N" 표시.
  - **대기 중 취소:** 아직 시작 안 한 큐 메시지 제거 가능. (실행 중 턴 중단 = 인터럽트, 권한 필요)
  - **발화자 프리픽스:** 각 메시지 앞 `[유저명]:` 붙여 모델이 다자 대화 인식.
  - **팬아웃:** 방 전원이 같은 라이브 스트림(토큰+툴콜)을 WebSocket으로 봄.
- **방장:** 생성자 기본. 이양 가능. 방장 이탈 시 가장 오래된 멤버 자동 승계. admin은 모든 방 오버라이드.
- **방 접근 범위:** 자기 방 projects + 공통 projects.

---

## 7. code-server 통합 (에디터/터미널/git)

- **유저/방별 인스턴스.** 프로젝트 볼륨 마운트해서 `docker run`/`docker rm` 수준으로 배포/제거. **오케스트레이션 프레임워크 안 짬.**
- **마운트 범위(보안 안전망):** 각 컨테이너는 **자기 볼륨 + 공통 projects만** 마운트. 타 유저 볼륨·백엔드 소스·호스트·키 = 마운트 안 함. → 통합 터미널서 임의 셸 돌려도 자기 것+공통만 닿음.
- **라이프사이클:** on-demand 起動(유저가 에디터 열 때) + 유휴 타임아웃(예 30분) + 로그아웃 시 제거. 백엔드에 타임아웃 맵 + reaper 루프 하나.
- **라우팅:** `/cs/<uid>/<projectId>/<random-token>`. code-server 포트는 직접 노출 금지(internal 바인드), 인앱 http-proxy 통해서만. code-server 자체 auth는 `none`, 우리 프록시에 위임.
- **Claude Code는 별개:** 백엔드 SDK 서브프로세스로 동작(컨테이너 안 아님). 같은 유저 볼륨을 호스트 파일시스템에서 직접 접근.
  - 결과: 사람의 편집/터미널 = 컨테이너 하드 격리, 에이전트 파일 접근 = 소프트 펜스. 둘 다 같은 볼륨 위. **API 키는 백엔드에만 있어 code-server 터미널은 공용키 못 읽음.**
- **동시편집:** last-write-wins + "디스크서 변경됨" 경고. CRDT는 범위 밖.

---

## 8. 플러그인 관리

- **소스:** 마켓플레이스(git repo + marketplace.json) + 로컬 업로드 둘 다.
- **공통 tier = admin 전용:** 마켓플레이스 등록·공통 플러그인 설치/삭제·필수강제 지정.
- **개인 tier = 유저 자유:** 자기 마켓플레이스 추가·개인 플러그인 설치·공통(클래스2) on/off.

---

## 9. 인증 / 역할

- **내장 계정**(admin 발급) + **admin / member** 역할. 개인 원격 모드 = 계정 1개(그 사람이 admin).
- 서버 세션 + httpOnly 쿠키(취소 가능). 구조는 어댑터로 잡아 나중 SSO/프록시 헤더 끼울 수 있게.
- **계정 발급(provisioning)은 P0 인증에 포함**(다중 유저 테스트에 필요).

---

## 10. 공용 키 운영

- **레이트리밋:** 앱 레벨 **전역 동시 턴 제한**(설정값) + 초과분 큐잉 + 429 백오프. 유저엔 "잠시 혼잡" 표시. (방 FIFO 큐와 별개인 서버 전역 스로틀.)
- **비용 귀속:** SDK result의 usage(토큰)를 세션/유저/방별 DB 누적 → 관리자 사용량 대시보드(과금 아님, 가시성).

---

## 11. UI / UX

- **좌측 레일:** `+ 새 대화`, 섹션 **개인**(private 세션 목록), 섹션 **대화방**(공유방 목록), 하단 프로필/설정 + (admin) 관리자 패널.
- **메인:** 기본 채팅 뷰(데스크톱 충실 — 메시지, 툴콜 접이식 카드, 스트리밍, 인라인 권한 프롬프트, 방이면 발화자 아바타/이름, Claude 응답은 serif).
- **헤더:** 프로젝트명 + `[대화 | 분할 | 에디터]` 토글 + 모델/권한모드 셀렉터 + (방) 멤버 아바타 + 방장 표시.
- **code-server:** 에디터 토글로 전환(풀스크린) 또는 분할(대화+에디터). 유저가 분할 켤 수 있음.
- **테마:** 라이트/다크 모두. clay 액센트.

---

## 12. 기술 스택

| 레이어 | 선택 |
|---|---|
| 백엔드 | Fastify (Node/TS) |
| 실시간 | Socket.IO (room·presence·재접속; 필요시 Redis 어댑터) |
| 프론트 | React + Vite (SPA) + Tailwind + Radix |
| DB | SQLite + Drizzle (메타 인덱스만; 스케일 시 Postgres 승격) |
| 인증 | 서버 세션 + httpOnly 쿠키 |
| 컨테이너 | dockerode + `codercom/code-server` 이미지 |
| 리버스 프록시 | 인앱 http-proxy (`/cs/...`; TLS는 앞단 Caddy 옵션) |
| Claude 구동 | Agent SDK, 세션당 서브프로세스 |
| 캐시/휘발상태 | (필요시) Redis — WS 팬아웃 pub/sub, 방 FIFO 큐, presence, code-server 유휴타이머. 기본 in-memory. |

---

## 13. 도커 배포

- **모델:** 호스트 Docker 소켓 마운트 → code-server를 **형제(sibling) 컨테이너**로 spawn (dind 아님).
- **형제 볼륨 함정:** 마운트 경로는 호스트 Docker가 해석 = 호스트 경로여야 함. `/data`는 **네임드 볼륨**으로 두고 앱·code-server 둘 다 이름 참조.
- **보안(경량 posture):** 소켓 마운트 = 앱이 사실상 호스트 root. 신뢰 단일서버라 수용.
- **구성:**
```yaml
# docker-compose.yml (개략)
services:
  app:            # Fastify + 빌드된 React 정적서빙 (단일 멀티스테이지 이미지)
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - data:/data
  # (redis)       # 필요시
  # code-server 컨테이너 = app이 런타임에 동적 spawn (compose에 없음, 내부 네트워크, 호스트 미노출)
volumes:
  data:
```
- SQLite 파일 = `data` 볼륨에 영속.

---

## 14. 빌드 단계

| 단계 | 내용 |
|---|---|
| **P0 골격** | Docker 배포(compose·단일이미지·소켓마운트·네임드볼륨), Fastify+React 셸, SQLite/Drizzle, 인증(내장계정·admin/member·**계정 발급**), 좌레일+채팅 셸 |
| **P1 개인 채팅** | Agent SDK 세션당 서브프로세스(HOME/cwd), Socket.IO 스트리밍, 세션 지속(jsonl+DB 인덱스)·목록, 웹 권한 프롬프트(`canUseTool`), 전역 동시성 캡+429 백오프 |
| **P2 프로젝트/파일** | code-server spawn/kill(dockerode)·마운트범위·유휴 reaper, 인앱 프록시 `/cs/`, 에디터 토글/분할, 공통+개인 프로젝트, admin 공통프로젝트 생성 |
| **P3 플러그인** | 공통(admin: 마켓+업로드+필수강제), 개인(유저: 마켓+업로드+on/off), 2클래스 오버라이드+잠금 deny 펜스 |
| **P4 공유 대화방 ★ 첫 릴리스** | 방=워크스페이스 엔티티·멤버십·방장+위임토글, FIFO큐+취소+프리픽스+팬아웃, 방 권한모드·인터럽트, 방 code-server |
| **P5 관리자+운영** | 관리자 패널 UI·사용량 대시보드·전역설정 튜닝·비용 귀속(관리자 *동작*은 P2·P3에 인라인 존재) |

**첫 릴리스 커트라인 = P4(팀 워크스페이스 완성).** P1까지면 "개인 원격 Claude Code"가 이미 동작(개인 타겟층 커버).

---

## 15. 열린 항목 / 확장 seam

- 유저별 API 키(키 해석 추상화 뒤에 나중 추가).
- SSO / 프록시 헤더 인증(어댑터 자리 남김).
- Postgres 승격, Redis 승격(멀티프로세스 시).
- 풀 git GUI, CRDT 실시간 협업편집(현재 범위 밖).
- 알림(notifications) — 미정.
