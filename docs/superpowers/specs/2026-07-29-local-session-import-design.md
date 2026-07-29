# 로컬 Claude 세션 → 개인 세션 업로드(import) — 설계 스펙

> 2026-07-29. 로컬에서 Claude Code로 작업하던 세션을 **프로젝트 폴더 + 해당 프로젝트의 `~/.claude` 세션 파일**과 함께
> 이 워크스페이스의 **개인 세션**으로 올려, 열면 과거 대화가 그대로 보이고 이어서 대화(resume)까지 되게 한다.

## 1. 배경 사실 (검증됨)

- 개인 세션 = `chat_sessions(kind='private')` 행 + 프로젝트(`cwd`) + `claudeSessionId`(SDK resume id). HOME=`/data/users/<uid>`.
- **트랜스크립트 저장소가 둘**:
  - SDK **jsonl** — `HOME/.claude/projects/<slug>/<uuid>.jsonl`. `resume`가 이걸 읽어 모델 기억을 복원.
  - DB **`messages`** 테이블 — 채팅 UI가 렌더하는 원본.
  - resume 시 jsonl이 없으면 조용히 새 대화로 폴백(`session-manager.ts` 의 `/No conversation found/` 분기) → **모델 기억 상실**. 그래서 jsonl 배치가 필수.
- **slug 인코딩(정확성 핵심, CLI 번들에서 확인):** `absPath.replace(/[^a-zA-Z0-9]/g, '-')`. 모든 비영숫자 → `-`.
  - 로컬 slug(`C--dev-MyProj`)와 서버 slug(`-data-users-<uid>-projects-MyProj`)는 다르므로 **재인코딩 + jsonl 내부 `cwd` 재작성**이 필요.
- 로컬 `~/.claude/projects/<slug>/` 폴더 1개가 세션의 모든 것을 담음:
  - `<uuid>.jsonl` (세션당 1개, 슬러그 폴더에 여러 세션 공존 가능)
  - `<uuid>/subagents/`, `<uuid>/workflows/` (세션별 사이드체인 기록)
  - `memory/` (프로젝트 메모리 — 슬러그 단위 공유)
- jsonl 라인 필드: `type`, `cwd`(윈도 절대경로), `sessionId`, `version`, `gitBranch`, `message`, `isSidechain`, `timestamp` 등.
- **웹 폴더 업로드의 근본 제약:** 브라우저는 보안상 (a) 선택 폴더의 **절대경로를 노출하지 않음**(`webkitRelativePath`=폴더명+상대경로만), (b) 파일 다이얼로그를 **특정 경로로 자동 이동/자동선택 못 함**. → 절대경로는 `.claude` jsonl의 `cwd`에서 역산, picker 자동이동은 가이드 UI로 대체.
- 참조 구현: **LLM Wiki 폴더 업로드 = staging 모델** (`server/src/routes/wiki.ts`, `web/.../Sidebar.tsx`의 `WikiCreateModal`). 파일마다 rel 경로를 multipart **fieldname**에 실어 staging에 스트리밍 → 확인 시 staged 트리를 목적지로 이동. boot 시 staging reap.

## 2. UX 흐름

사이드바 **개인** 섹션에 **"세션 가져오기"** 버튼 → 모달(`ImportSessionModal`):

1. **프로젝트 폴더 선택** — `webkitdirectory` 픽 + 드롭(wiki의 `traverseEntry` 재사용).
2. **파일 선택 트리** — 픽 즉시 업로드하지 않고 FileList를 모아 트리 렌더.
   - 폴더 루트 `.gitignore`를 읽어 매칭 파일은 **기본 체크 해제**. 나머지 체크. `.git/`도 기본 해제.
   - 세션 필수 파일(`CLAUDE.md`, 프로젝트 로컬 `.claude/`)은 항상 포함(토글 불가, 트리에서 잠금 표시).
   - gitignore 매칭은 `ignore` npm(신규 의존성 1개). 사용자가 체크박스로 자유 토글(디렉터리 토글은 하위 캐스케이드).
3. **선택분만 업로드** — staging `project/` 슬롯으로 스트리밍(진행률 바, wiki와 동일).
4. **`.claude` 세션 폴더 선택 안내** — 프로젝트 업로드 끝나면 picker를 자동 `click()`으로 띄우고 **동시에 가이드 패널**:
   - "`~/.claude/projects/` 에서, 프로젝트 절대경로를 `\ : /` 등 → `-` 로 바꾼 이름의 폴더를 선택하세요. 예: `C:\dev\MyProj` → `C--dev-MyProj`."
   - **skip 가능** 버튼(세션 없이 프로젝트만 가져오기).
5. **`.claude` 폴더 업로드** — staging `claude/` 슬롯으로. 서버가 jsonl `cwd`에서 원 절대경로 역산 → 프로젝트명/원본 slug 확정, 업로드한 프로젝트 폴더명과 tail 일치 검증(불일치 시 경고, 진행은 허용).
6. **세션 선택(체크박스)** — staging의 `claude/<slug>/`에서 발견한 세션 목록을 **체크박스**로 표시(uuid · 제목(`custom-title` 라인) · 마지막 수정 · 메시지 수). **복수/전부 선택 가능**, 각 선택 세션이 **별도 개인 세션**으로 생성(프로젝트는 공유). 최소 1개 필요(단 4에서 skip했으면 0개=프로젝트만).
7. **확인** → import 실행 → 사이드바 개인 목록에 세션(들) 등장. 열면 과거 대화가 보이고 이어서 대화 가능.

## 3. 서버

### 3.1 staging 엔드포인트 (`server/src/routes/sessions.ts` 확장, wiki 미러)

- `POST /api/import/staging/:sid/files?slot=project|claude` — 스트리밍 multipart. rel 경로는 fieldname. `slot`별 하위 디렉터리에 저장. per-file 캡은 기존 multipart 설정 재사용.
- `DELETE /api/import/staging/:sid/file?slot=&path=` — 개별 삭제.
- `DELETE /api/import/staging/:sid` — 전체 취소.
- `GET /api/import/staging/:sid/sessions` — `claude/` 슬롯을 스캔해 `{ slug, originalCwd, projectTail, sessions: [{uuid,title,mtime,msgCount}] }` 반환(6단계 세션 선택 UI용).
- boot reap: `reapImportStaging()` (전체 삭제) — wiki `reapWikiStaging` 패턴.

경로: `paths.importStaging(sid)` = `/data/.import-staging/<sid>`, 하위 `project/`, `claude/`. `sid` 검증은 wiki `validSid` 재사용.

### 3.2 확정 엔드포인트

`POST /api/import/sessions` — body `{ sid, projectName?, sessionUuids: string[] }`:

1. staging `claude/`에서 `<slug>/` 를 찾아 jsonl `cwd`로 원본 절대경로·프로젝트명 역산(`projectName` 미지정 시).
2. **프로젝트 배치:** staging `project/` 트리를 `/data/users/<uid>/projects/<name>` 로 이동(이름 충돌 시 `-2` dedupe). `projects` 행 insert(scope='user', ownerId=uid). `project/`가 비었으면(=슬러그만 온 경우) 에러.
3. 서버 cwd = 프로젝트 경로. **serverSlug = cwd.replace(/[^a-zA-Z0-9]/g,'-')**.
4. **각 `sessionUuids`에 대해:**
   a. `claude/<slug>/<uuid>.jsonl` → `HOME/.claude/projects/<serverSlug>/<uuid>.jsonl` 로 복사하며 **각 라인의 `cwd` 필드를 서버 cwd로 재작성**(나머지 라인 내용 불변). 첫 세션에서 `<slug>/<uuid>/`(subagents·workflows)·`memory/`도 같은 목적지로 이동.
   b. `chat_sessions` insert: `{ kind:'private', ownerId:uid, projectId, claudeSessionId:uuid, title }`.
   c. **messages 백필:** jsonl 메인스레드 라인을 block으로 변환해 insert(§3.3).
5. 생성된 세션 목록 반환. staging 삭제.

### 3.3 순수 변환 모듈 `server/src/lib/session-import.ts` (+ 테스트)

- `encodeSlug(absPath): string` — `absPath.replace(/[^a-zA-Z0-9]/g,'-')`.
- `rewriteCwd(jsonlLine: string, newCwd: string): string` — 파싱해 `cwd` 있으면 교체, 재직렬화. 파싱 실패 라인은 원본 유지(관대).
- `jsonlToMessages(lines: string[], sessionId: string): MessageRow[]` — 라인 순회로 턴 재구성(`session-manager.ts` `runReal`의 block 매핑 미러):
  - `isSidechain===true` 라인 skip. 메타 타입(`custom-title`,`mode`,`attachment`,`summary`,`system`,`file-history-snapshot` 등) skip.
  - `type==='assistant'`: `message.content`의 `text`→`{type:'text'}`, `tool_use`→`{type:'tool_use',id,name,input}` 를 현재 assistant 블록 버퍼에 누적(+toolIndex).
  - `type==='user'`: content에 `tool_result` 있으면 `toolIndex`로 해당 tool_use 블록에 `output`/`isError` 병합(메시지 생성 안 함). 실제 사람 텍스트가 있으면 → 먼저 버퍼된 assistant 블록을 assistant 메시지 1개로 flush, 그다음 user 메시지 insert.
  - 종료 시 버퍼 flush. `createdAt`은 라인 `timestamp` 우선, 없으면 단조 증가.
- 순수 함수 → fs 없이 단위 테스트. 최소 테스트 1개: 대표 jsonl 조각(user→assistant+tool_use→user tool_result→assistant text) → 기대 block 구조.

### 3.4 paths 추가

`server/src/lib/paths.ts`: `importStagingRoot`, `importStaging(sid)`. lazy ensure(디렉터리 생성은 업로드 시).

## 4. 프론트

- `web/src/components/Sidebar.tsx`: 개인 섹션에 "세션 가져오기" 버튼 + `ImportSessionModal`. wiki `WikiCreateModal`의 픽/드롭/staging 스트리밍/진행률/취소 로직 재사용. 신규: gitignore 트리(2단계), `.claude` 가이드+picker(4단계), 세션 체크박스(6단계).
- `web/src/lib/store.ts`: `importSessions(payload)` 액션 + 완료 후 세션 목록 새로고침(기존 세션 로드 경로 재사용).
- `web/src/lib/i18n.ts`: 새 문자열 전부 `ko`/`en` 양쪽 키 추가(`import.*` 스코프).
- 의존성: `ignore` (web).
- **반응형:** 모달은 `<md`에서 세로 스택, 트리는 자체 `overflow-auto`. 가로 스크롤 금지.

## 5. 데모 목 (정적 데모 반영)

- `web/src/demo/router.ts`: `/api/import/staging/*`, `/api/import/sessions` 목 라우트(staged 파일 목록·가짜 세션 목록·성공 응답).
- `web/src/demo/data.ts`: import 후 등장할 시드 세션 1개.
- 검증: `npm run build:demo -w web`.

## 6. 재현 범위 / 한계 (명시)

- ✅ 모델 기억(resume) · UI 과거 대화 · 서브에이전트/워크플로 기록 · 프로젝트 메모리 · 선택 파일.
- ⚠️ `.claude` skip 시: 프로젝트만 개인 프로젝트로 들어오고 세션은 빈 새 대화(모델 기억 없음) — UI에 명시.
- ❌ 웹 picker 특정 경로 자동 이동(OS 제약) → 가이드 UI로 대체.
- jsonl 내부 과거 툴 경로(`C:\...`)는 텍스트라 재작성 안 함(불필요·손상 위험). 최상위 `cwd`만 재작성.
- 대용량 폴더는 2단계 gitignore 기본 해제로 방어(node_modules 등). 서버 per-file 캡 유지.

## 7. 보안/격리

- import는 **본인 개인 tier 한정**(`requireAuth`, ownerId=현재 유저). 프로젝트는 `paths.userProjects(uid)` 아래에만 생성.
- 경로 세그먼트 sanitize(wiki `safeRelPath`/`safeSeg` 재사용)로 traversal 차단. jsonl 배치 목적지는 항상 서버가 계산(`HOME/.claude/projects/<serverSlug>`), 클라 경로 신뢰 안 함.
- `.claude` 업로드는 오직 `projects/<slug>` 하위만 사용 — 사용자가 실수로 상위 `~/.claude`(settings/토큰 등)를 골라도 서버는 `projects/<slug>/{*.jsonl,<uuid>/,memory}` 만 채택, 나머지 무시.

## 8. 문서/README

사용자 체감 신규 기능 → `README.md`/`README.ko.md` 기능 목록에 "로컬 세션 가져오기" 간결히 추가.
