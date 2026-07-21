# 유저별 Claude Code 토큰 — 설계 스펙

날짜: 2026-07-22
관련: [DESIGN.md](../../../DESIGN.md) §9(인증), §10(공용 키), §15(확장 seam)

## 목표

각 유저가 본인의 Claude Code 인증 토큰을 등록하고, 개인 세션과 공유방에서의 **각 질의가 그 질의를 보낸 사람의 토큰**으로 실행되도록 한다. v1의 "공용 키 1개"에서 "유저별 키 + admin 관리 공통 폴백"으로 전환.

## 결정 사항 (확정)

- **토큰 등록 위치:** admin 계정 발급 유지(셀프 회원가입 없음). 각 유저는 프로필/설정에서 본인 토큰을 셀프 등록/수정. admin 유저 생성 폼에도 optional 토큰 필드.
- **미등록 시 동작:** 공용 서버 토큰으로 폴백. 미등록 유저는 로그인마다 "토큰 등록" 안내 팝업 노출(등록 전까지).
- **공통 토큰:** env 뿐 아니라 **admin 계정 설정 UI**에서 등록(암호화 저장). env 키는 부트스트랩/레거시 폴백.
- **저장 보안:** 토큰은 AES-256-GCM으로 at-rest 암호화. 평문은 API 응답으로 절대 반환 안 함.

## 토큰 주체

턴 발화자(`p.author.id`).
- 개인 세션: 발화자 == 소유자.
- 공유방: 매 메시지의 발신자. `runTurn`이 이미 `p.author` 보유, usage도 발화자 귀속.
- resume(`claudeSessionId`)는 방 공유 그대로 — 토큰은 API 인증용일 뿐 transcript id와 무관. 턴마다 다른 토큰 OK.

## 아키텍처

### 핵심 삽입점
`server/src/claude/config-layering.ts:buildOptions()` — 현재 전역 `config.anthropicApiKey`를 읽어 env에 주입(45–49줄). 이 지점을 "해석된 토큰 주입"으로 교체. prefix 판별(`sk-ant-oat*` → `CLAUDE_CODE_OAUTH_TOKEN`, `sk-ant-api*` → `ANTHROPIC_API_KEY`) 로직 재사용.

### 토큰 해석
새 함수 `resolveClaudeAuth(userId: string | null): { token: string; source: 'user'|'shared'|'none' }`
```
유저 개인 토큰 복호화 성공        → source='user'
없음 + admin 공통 토큰(DB) 있음   → source='shared'
없음 + env ANTHROPIC_API_KEY 있음 → source='shared' (레거시 폴백)
전부 없음                         → source='none' (mock)
```
`MOCK_CLAUDE=1`은 전역 강제 mock 오버라이드로 유지. `runTurn`의 `if (config.mockClaude)`는 per-turn `if (auth.source==='none')`로 변경.

### 암호화 (secret-box)
새 모듈 `server/src/lib/secret-box.ts`: `encrypt(plain)`/`decrypt(blob)`.
- AES-256-GCM. 키 = env `TOKEN_ENC_SECRET`(없으면 `SESSION_SECRET`)에서 scrypt 32B 파생.
- 저장 포맷 `iv:tag:ciphertext` (hex).

## 데이터 모델

`users` 테이블 nullable 컬럼 추가:
- `claude_token_enc` TEXT — 암호문 blob
- `claude_token_set_at` INTEGER — 표시용 등록 시각

공통 토큰: `settings` 테이블 (`getSetting`/`setSetting` 재사용)
- `claude_common_token_enc` — 암호문
- `claude_common_token_set_at` — 등록 시각

부팅 시 컬럼 자동 보정(idempotent `ALTER TABLE ... ADD COLUMN` guard).

## API

유저(본인):
- `GET /api/auth/me` — `hasClaudeToken`, `claudeTokenSetAt` 추가
- `PUT /api/auth/me/claude-token` `{token}` — 형식검사(`sk-ant-oat*`|`sk-ant-api*`) 후 암호화 저장
- `DELETE /api/auth/me/claude-token`

admin:
- `POST /api/users` — optional `claudeToken` 수용
- `GET /api/admin/claude-token` — 공통 토큰 hasToken/setAt/마스킹
- `PUT /api/admin/claude-token` `{token}`
- `DELETE /api/admin/claude-token`

모든 응답: 평문 토큰 없음. 마스킹 힌트(끝 4자)만 옵션.

## 프론트 (web/)

- **설정/프로필:** 토큰 입력(password형) + 저장/삭제 + 상태 표시. `claude setup-token` 발급 안내.
- **로그인 나그 팝업:** 로그인 후 `!hasClaudeToken`이면 모달(입력 + "나중에"). 등록 전까지 매 로그인.
- **admin 설정:** 공통 토큰 입력 + 상태. 기존 admin 설정 패널 확장.

## 보존 불변식

- 토큰은 백엔드 SDK 서브프로세스 env에만 주입. code-server 컨테이너엔 미주입(DESIGN.md §7 유지).
- 전역 동시턴 캡(§10): 의미가 "공용키 보호" → "서버 자원 보호"로 전환. 유지. 유저별 캡은 나중 seam.
- 비용 귀속: 이미 발화자별. usage 트래커 유지(admin 가시성).

## 미포함 (나중, 필요 시)

라이브 토큰 유효성 검증(첫 실패 턴에서 재등록 안내로 지연), 유저별 rate-limit 캡, 셀프 회원가입.
