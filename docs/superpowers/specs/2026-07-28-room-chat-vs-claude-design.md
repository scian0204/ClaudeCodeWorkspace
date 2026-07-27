# 공통 세션(room) — 팀 잡담 vs 클로드 지시 구분

**Date:** 2026-07-28
**Status:** approved (design)

## 문제

공통 세션(`kind='room'`)에서 지금은 멤버가 보낸 **모든** 메시지가 `chat:send` →
`enqueueTurn` → `runTurn` 으로 흘러 클로드가 매번 응답한다. 팀원끼리 잡담만 하고
싶어도 클로드가 끼어들고 토큰을 쓴다. 잡담과 "클로드에게 주는 지시"를 구분해야 한다.

private / wiki / review 세션은 단독 사용자이거나 무인 파이프라인이라 이 구분이
필요 없다 → **room 에만 적용**.

## 결정 사항

1. **구분 방식 = 작성창 모드 토글** (`💬 채팅` / `🤖 클로드`). @mention 파싱이나 LLM
   자동분류는 안 함(YAGNI).
2. **기본값 = 채팅.** room 별로 localStorage 에 sticky.
   - ⚠️ 동작 변경: 배포 후 기존 room 도 첫 메시지는 클로드로 안 감(채팅으로 처리).
     의도된 변경 — 요청 취지가 "잡담이 클로드로 새지 않게".
3. **`@클로드` / `@claude` 단축 트리거.** 작성창 **맨 앞**에 이 토큰을 치면 UI 토글이
   `클로드` 모드로 flip 되고 그 토큰 문자열은 입력창에서 **제거**된다(클로드로 literal
   전송 안 됨). 그 외 `@...` 는 손대지 않음 → **향후 `@` 파일참조 기능과 공존**
   (`@클로드`/`@claude` 두 토큰만 예약).
4. **잡담 포함 체크박스.** `클로드` 모드일 때만 노출. 체크하고 지시를 보내면 *마지막
   클로드 턴 이후 쌓인 잡담*을 프롬프트 맥락으로 앞에 붙여 전달.
5. **🤖 뱃지.** 클로드로 간 user 메시지(chat=0)에 작은 뱃지를 붙여 시각 구분. 잡담
   메시지(chat=1)는 평범한 멤버 버블.

## 데이터 모델

`messages` 테이블에 컬럼 1개 추가:

```
chat INTEGER NOT NULL DEFAULT 0   -- 1 = 팀 잡담(클로드 미전달). role='user' 에만 의미.
```

- `server/src/db/schema.ts` — `messages` 에 `chat: integer('chat').notNull().default(0)`.
- `server/src/db/index.ts` — DDL 의 messages 정의에 `chat INTEGER NOT NULL DEFAULT 0`
  추가 + 멱등 마이그레이션 `ALTER TABLE messages ADD COLUMN chat INTEGER NOT NULL DEFAULT 0`
  (기존 wiki/token 마이그레이션과 동일한 try/catch 패턴).

## 서버

### 소켓 (`server/src/realtime/io.ts`)
`chat:send` 페이로드 확장(새 이벤트 대신 확장 — 라우팅 한 곳):

```ts
{ sessionId, text, chat?: boolean, includeChat?: boolean }
```

핸들러 분기:
- `chat === true`:
  - **room 에서만** 유효. 비-room 세션에서 오면 `chat` 플래그 무시하고 기존 클로드
    전송으로 처리(토글 자체가 room 에서만 노출되므로 정상 경로엔 안 옴 — 방어적).
  - `wikiTopic 컴파일 중` 가드는 클로드 질의에만 의미 → 잡담은 통과.
  - 큐/턴 **안 거침**. `postChat(sessionId, author, text)` 로 즉시 저장 + `message`
    broadcast. (턴 진행 중에도 팀은 대화 가능.)
- 아니면(클로드 모드): 기존대로 `enqueueTurn(..., { includeChat })`.

### 큐 (`server/src/rooms/queue.ts`)
`QueueItem` / `enqueueTurn` 에 `includeChat?: boolean` 전달 → `runTurn` 으로 넘김.

### 세션 매니저 (`server/src/claude/session-manager.ts`)
- `saveMessage` 가 `chat?: boolean` 받도록(기본 0).
- `publicMessage` 에 `chat` 필드 포함(프론트 뱃지용).
- **새 export `postChat(sessionId, author, text)`**: `saveMessage({role:'user', chat:1})`
  + `chatSessions.updatedAt` 갱신 + emit `message`. 턴 없음.
- `runTurn(opts.includeChat)`:
  - 새 user 메시지 저장 **전에** 맥락 수집:
    ```sql
    SELECT author_name, content FROM messages
    WHERE session_id = ? AND chat = 1
      AND created_at > (SELECT COALESCE(MAX(created_at),0) FROM messages
                        WHERE session_id = ? AND role='user' AND chat=0)
    ORDER BY created_at
    ```
    경계 = 클로드가 마지막으로 본 user 메시지 시각. 추가 상태 없이 재주입 자동 방지.
  - 프롬프트 조립(room, contextChat 있을 때):
    ```
    [이전 대화]
    [Alice]: ...
    [Bob]: ...

    [Carol]: <지시>
    ```
    contextChat 없으면 기존 `[name]: text` 그대로.

## 프론트

### Composer (`web/src/components/Chat.tsx`)
- room 일 때 작성창 하단에 모드 토글(`💬 채팅` / `🤖 클로드`).
  - 상태: `mode` (`'chat'|'claude'`), localStorage 키 `roomMode:<roomId>`, 기본 `'chat'`.
- `클로드` 모드일 때만 `잡담 포함` 체크박스 노출(`includeChat`).
- onChange 에서 `@클로드`/`@claude` **맨 앞** 매칭(`/^@(클로드|claude)\s?/i`) 시:
  토큰 strip + `setMode('claude')`. (슬래시 메뉴 onChange 처리와 같은 지점.)
- submit: `send(text, { chat: mode==='chat', includeChat: mode==='claude' && includeChat })`.
- 채팅 모드 전송은 큐/"응답 중" UI 안 뜸(그 메시지는 턴을 안 만들므로 자연 처리).

### 메시지 렌더
- `Msg` 타입에 `chat?: boolean`.
- room 에서 `role==='user' && !chat` → 작은 🤖 뱃지(“클로드에게”). `chat===1` → 뱃지 없음.

### store (`web/src/lib/store.ts`)
- `send(text: string, opts?: { chat?: boolean; includeChat?: boolean })` 로 확장,
  `emit('chat:send', { ..., chat, includeChat })`.

### i18n (`web/src/lib/i18n.ts`)
ko/en 양쪽 동일 키 추가:
- `chat.modeChat`(💬 채팅), `chat.modeClaude`(🤖 클로드), `chat.includeChat`(잡담 포함),
  `chat.claudeBadge`(클로드에게), room 잡담 placeholder 등.

### 데모 목 (`web/src/demo/socket.ts`)
- `chat:send` 에 `chat:true` → 턴 시뮬레이션 없이 `message` 만 deliver.
- `includeChat` 는 no-op(목은 실제 클로드 없음).

### 모바일 (rule 9)
- 토글 + 체크박스를 작성창 하단 flex row 에 넣고 좁은 폭에서 wrap. 375px 확인.

## 문서 (rule 7)
- `README.md` / `README.ko.md` 기능 목록에 "room 채팅/지시 구분" 한 줄 추가.

## 비목표

- @mention 파싱 / LLM 자동분류.
- private·wiki·review 세션 적용.
- `@` 파일참조 기능(별도 작업 — 이 스펙은 `@클로드`/`@claude` 토큰만 예약).

## 검증

- `npm run typecheck`.
- room 에서: 채팅 모드 전송 → 클로드 무응답, 멤버에게 broadcast.
- `@클로드 고쳐줘` → 토글 클로드로 flip, 텍스트 "고쳐줘", 턴 실행.
- 잡담 몇 개 → `잡담 포함` 체크 후 지시 → 프롬프트에 이전 대화 포함(서버 로그/응답으로 확인).
- 🤖 뱃지: 클로드 메시지에만.
- `npm run build:demo -w web` + preview 로 데모 동작.
- 375px 모바일 레이아웃.
