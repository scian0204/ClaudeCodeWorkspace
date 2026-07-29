# Local Session Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로컬 Claude Code 세션(프로젝트 폴더 + `~/.claude/projects/<slug>` 세션 파일)을 웹에서 업로드해 개인 세션으로 복제 — 과거 대화 표시 + resume 가능.

**Architecture:** LLM Wiki의 staging 업로드 모델을 미러링. 프로젝트 폴더와 `.claude` 세션 폴더를 각각 staging 슬롯에 스트리밍 업로드 → 확정 시 서버가 프로젝트를 `/data/users/<uid>/projects/<name>`에 배치하고, jsonl을 서버 slug 디렉터리에 `cwd` 재작성하며 배치하고, `chat_sessions` 행 + `messages` 백필을 생성.

**Tech Stack:** Fastify + Drizzle(SQLite) 백엔드, React + Vite + Tailwind 프론트, `@anthropic-ai/claude-agent-sdk` resume.

## Global Constraints

- **slug 인코딩(불변):** `absPath.replace(/[^a-zA-Z0-9]/g, '-')`. 서버 cwd 절대경로에 적용. (CLI 번들에서 검증한 규칙.)
- **i18n 필수:** UI 문자열은 `web/src/lib/i18n.ts`의 `DICT` `ko`/`en` **양쪽에 동일 키**. 컴포넌트는 `const t = useT()`.
- **반응형 필수:** 모달 `<md` 세로 스택, 트리 자체 `overflow-auto`, body 가로 스크롤 금지.
- **데모 목:** 새 REST 엔드포인트는 `web/src/demo/router.ts`에 목 라우트 추가.
- **커밋:** 기능 단위, `feat/fix/...` 컨벤션, 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **최종 답변 한글.** 브랜치 `feat/local-session-import` (이미 생성됨, 스펙 커밋됨).
- 참조 스펙: `docs/superpowers/specs/2026-07-29-local-session-import-design.md`.

---

## File Structure

- `server/src/lib/session-import.ts` (신규) — 순수 변환: `encodeSlug`, `rewriteCwd`, `jsonlToMessages`, `readSessionsFromSlug`(fs, 목록화).
- `server/src/lib/session-import.test.ts` (신규) — 순수 함수 단위 테스트.
- `server/src/lib/paths.ts` (수정) — `importStagingRoot`, `importStaging(sid)`.
- `server/src/routes/import.ts` (신규) — staging + confirm 엔드포인트. (`sessions.ts` 비대화 방지 위해 별도 파일.)
- `server/src/index.ts` (수정) — `importRoutes` 등록 + `reapImportStaging()` boot 호출.
- `web/src/components/ImportSessionModal.tsx` (신규) — 다단계 모달.
- `web/src/components/Sidebar.tsx` (수정) — 개인 섹션에 "세션 가져오기" 버튼 + 모달 마운트.
- `web/src/lib/store.ts` (수정) — `importSessions` 액션 + 세션 목록 새로고침.
- `web/src/lib/i18n.ts` (수정) — `import.*` 키 ko/en.
- `web/src/demo/router.ts`, `web/src/demo/data.ts` (수정) — 목.
- `web/package.json` (수정) — `ignore` 의존성.
- `README.md`, `README.ko.md` (수정) — 기능 목록.

---

### Task 1: 순수 변환 모듈 — encodeSlug + rewriteCwd

**Files:**
- Create: `server/src/lib/session-import.ts`
- Test: `server/src/lib/session-import.test.ts`

**Interfaces:**
- Produces: `encodeSlug(absPath: string): string`, `rewriteCwd(line: string, newCwd: string): string`

- [ ] **Step 1: 테스트 작성** — `server/src/lib/session-import.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { encodeSlug, rewriteCwd } from './session-import.js';

describe('encodeSlug', () => {
  it('replaces every non-alphanumeric with dash', () => {
    expect(encodeSlug('/data/users/u1/projects/MyProj')).toBe('-data-users-u1-projects-MyProj');
    expect(encodeSlug('C:\\dev\\My.Proj_v2')).toBe('C--dev-My-Proj-v2');
  });
});

describe('rewriteCwd', () => {
  it('replaces cwd field, preserves other fields', () => {
    const line = JSON.stringify({ type: 'attachment', cwd: 'C:\\dev\\X', sessionId: 'a', gitBranch: 'main' });
    const out = JSON.parse(rewriteCwd(line, '/data/users/u1/projects/X'));
    expect(out.cwd).toBe('/data/users/u1/projects/X');
    expect(out.sessionId).toBe('a');
    expect(out.gitBranch).toBe('main');
  });
  it('leaves lines without cwd untouched', () => {
    const line = JSON.stringify({ type: 'mode', sessionId: 'a' });
    expect(rewriteCwd(line, '/x')).toBe(line);
  });
  it('returns unparseable lines verbatim', () => {
    expect(rewriteCwd('not json', '/x')).toBe('not json');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run -w server test -- session-import` → FAIL(모듈 없음). (vitest 사용 여부는 `server/package.json` 확인; 없으면 `node --test` 스타일로 전환하되 아래 구현은 동일.)

- [ ] **Step 3: 구현** — `server/src/lib/session-import.ts` (이 부분만 우선 작성)

```ts
// Encode an absolute path into the CLI's ~/.claude/projects/<slug> dir name.
// Rule verified from the CLI bundle: replace every non-alphanumeric char with '-'.
export function encodeSlug(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, '-');
}

// Rewrite the top-level `cwd` field of one jsonl transcript line to the server-side project path,
// so `resume` finds a transcript whose cwd matches the runtime cwd. Everything else is preserved.
// Unparseable lines are returned verbatim (be lenient — never corrupt the transcript).
export function rewriteCwd(line: string, newCwd: string): string {
  const s = line.trim();
  if (!s) return line;
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === 'object' && 'cwd' in obj && typeof obj.cwd === 'string') {
      obj.cwd = newCwd;
      return JSON.stringify(obj);
    }
    return line;
  } catch { return line; }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run -w server test -- session-import` → PASS(encodeSlug + rewriteCwd).

- [ ] **Step 5: 커밋** — `git add server/src/lib/session-import.ts server/src/lib/session-import.test.ts && git commit -m "feat(import): slug encoding + jsonl cwd rewrite (pure)"`

---

### Task 2: jsonl → messages 백필 변환

**Files:**
- Modify: `server/src/lib/session-import.ts`
- Test: `server/src/lib/session-import.test.ts`

**Interfaces:**
- Produces: `jsonlToMessages(lines: string[], sessionId: string, baseTs?: number): Array<{ role: 'user'|'assistant'; content: any; createdAt: number }>`
  - block 포맷은 `session-manager.ts`의 `Block`과 동일: `{type:'text',text}` | `{type:'tool_use',id,name,input,output?,isError?}`.
  - user 메시지 content = `{ text }`; assistant content = `{ blocks }`.

- [ ] **Step 1: 테스트 추가** (같은 파일)

```ts
import { jsonlToMessages } from './session-import.js';

describe('jsonlToMessages', () => {
  it('reconstructs user + assistant(text+tool_use) with merged tool_result, skips meta/sidechain', () => {
    const lines = [
      JSON.stringify({ type: 'custom-title', sessionId: 's', customTitle: 'T' }),
      JSON.stringify({ type: 'user', sessionId: 's', message: { role: 'user', content: 'hello' }, timestamp: '2026-01-01T00:00:00.000Z' }),
      JSON.stringify({ type: 'assistant', sessionId: 's', message: { role: 'assistant', content: [
        { type: 'text', text: 'hi' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      ] }, timestamp: '2026-01-01T00:00:01.000Z' }),
      JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: 'noise' } }),
      JSON.stringify({ type: 'user', sessionId: 's', message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'file.txt', is_error: false },
      ] }, timestamp: '2026-01-01T00:00:02.000Z' }),
      JSON.stringify({ type: 'user', sessionId: 's', message: { role: 'user', content: 'next' }, timestamp: '2026-01-01T00:00:03.000Z' }),
    ];
    const msgs = jsonlToMessages(lines, 's');
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(msgs[0].content).toEqual({ text: 'hello' });
    const blocks = msgs[1].content.blocks;
    expect(blocks[0]).toEqual({ type: 'text', text: 'hi' });
    expect(blocks[1]).toMatchObject({ type: 'tool_use', id: 't1', name: 'Bash', output: 'file.txt', isError: false });
    expect(msgs[2].content).toEqual({ text: 'next' });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run -w server test -- session-import` → FAIL(`jsonlToMessages` 없음).

- [ ] **Step 3: 구현** (append to `session-import.ts`)

```ts
type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any; output?: string; isError?: boolean };

const META_TYPES = new Set(['custom-title', 'mode', 'attachment', 'summary', 'system', 'file-history-snapshot']);

function textFrom(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b?.type === 'text').map((b) => b.text).join('');
  return '';
}

// Walk transcript lines in order, rebuilding the workspace message rows the chat UI renders.
// Mirrors session-manager.runReal's block mapping: a turn's assistant text/tool_use blocks accumulate
// into one assistant message; tool_result lines merge output into the matching tool_use block; a real
// human user line flushes the pending assistant message then emits a user message.
export function jsonlToMessages(
  lines: string[], _sessionId: string, baseTs = 0,
): Array<{ role: 'user' | 'assistant'; content: any; createdAt: number }> {
  const out: Array<{ role: 'user' | 'assistant'; content: any; createdAt: number }> = [];
  let buf: Block[] = [];
  const toolIndex = new Map<string, number>();
  let seq = 0;
  const nextTs = (ts?: string) => {
    const t = ts ? Date.parse(ts) : NaN;
    return Number.isFinite(t) ? t : baseTs + (seq++);
  };
  const flush = (ts: number) => {
    if (buf.length) { out.push({ role: 'assistant', content: { blocks: buf }, createdAt: ts }); buf = []; toolIndex.clear(); }
  };

  for (const raw of lines) {
    const s = raw.trim(); if (!s) continue;
    let m: any; try { m = JSON.parse(s); } catch { continue; }
    if (!m || m.isSidechain === true || META_TYPES.has(m.type)) continue;
    const ts = nextTs(m.timestamp);
    if (m.type === 'assistant') {
      for (const b of m.message?.content || []) {
        if (b.type === 'text') buf.push({ type: 'text', text: b.text });
        else if (b.type === 'tool_use') { toolIndex.set(b.id, buf.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input }) - 1); }
      }
    } else if (m.type === 'user') {
      const content = m.message?.content;
      let mergedOnly = false;
      if (Array.isArray(content)) {
        const results = content.filter((b) => b?.type === 'tool_result');
        for (const r of results) {
          const idx = toolIndex.get(r.tool_use_id);
          if (idx != null) { (buf[idx] as any).output = typeof r.content === 'string' ? r.content : JSON.stringify(r.content); (buf[idx] as any).isError = !!r.is_error; }
        }
        mergedOnly = results.length > 0 && !content.some((b) => b?.type === 'text');
      }
      if (mergedOnly) continue; // tool_result-only line: merged, no message
      const text = textFrom(content);
      if (!text) continue;
      flush(ts);
      out.push({ role: 'user', content: { text }, createdAt: ts });
    }
  }
  flush(baseTs + (seq++));
  return out;
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run -w server test -- session-import` → PASS.

- [ ] **Step 5: 커밋** — `git commit -am "feat(import): jsonl transcript -> messages backfill (pure)"`

---

### Task 3: fs 목록화 헬퍼 + paths

**Files:**
- Modify: `server/src/lib/session-import.ts`, `server/src/lib/paths.ts`

**Interfaces:**
- Produces (`session-import.ts`): `findSlugDir(claudeSlot: string): string | null` (첫 `<slug>` 하위 디렉터리 경로), `listSessions(slugDir: string): Array<{ uuid: string; title: string; mtime: number; msgCount: number }>`, `originalCwdFromSlug(slugDir: string): string | null` (아무 jsonl의 첫 `cwd`).
- Produces (`paths.ts`): `paths.importStagingRoot`, `paths.importStaging(sid: string)`.

- [ ] **Step 1: paths 추가** — `server/src/lib/paths.ts`의 `paths` 객체에:

```ts
  importStagingRoot: path.join(D, '.import-staging'),
  importStaging: (sid: string) => path.join(D, '.import-staging', sid),
```

- [ ] **Step 2: fs 헬퍼 구현** (append to `session-import.ts`; 파일 상단에 `import fs from 'node:fs'; import path from 'node:path';` 추가)

```ts
// A claude/ slot holds exactly one <slug>/ dir (the ~/.claude/projects/<slug> the user picked).
// The browser folder picker prepends the picked folder's name, so the jsonl may sit one level
// deeper — probe the slot, its direct children, and grandchildren for the dir holding *.jsonl.
export function findSlugDir(claudeSlot: string): string | null {
  if (!fs.existsSync(claudeSlot)) return null;
  const hasJsonl = (d: string) => fs.readdirSync(d).some((f) => f.endsWith('.jsonl'));
  if (hasJsonl(claudeSlot)) return claudeSlot;
  for (const e of fs.readdirSync(claudeSlot, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const inner = path.join(claudeSlot, e.name);
    if (hasJsonl(inner)) return inner;
    for (const e2 of fs.readdirSync(inner, { withFileTypes: true })) {
      if (!e2.isDirectory()) continue;
      const g = path.join(inner, e2.name);
      if (hasJsonl(g)) return g;
    }
  }
  return null;
}

export function originalCwdFromSlug(slugDir: string): string | null {
  for (const f of fs.readdirSync(slugDir)) {
    if (!f.endsWith('.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(slugDir, f), 'utf8').split('\n')) {
      try { const o = JSON.parse(line); if (typeof o?.cwd === 'string') return o.cwd; } catch { /* skip */ }
    }
  }
  return null;
}

export function listSessions(slugDir: string): Array<{ uuid: string; title: string; mtime: number; msgCount: number }> {
  const out: Array<{ uuid: string; title: string; mtime: number; msgCount: number }> = [];
  for (const f of fs.readdirSync(slugDir)) {
    if (!f.endsWith('.jsonl')) continue;
    const uuid = f.replace(/\.jsonl$/, '');
    const full = path.join(slugDir, f);
    const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean);
    let title = uuid;
    for (const line of lines) { try { const o = JSON.parse(line); if (o?.type === 'custom-title' && o.customTitle) { title = String(o.customTitle); break; } } catch { /* skip */ } }
    out.push({ uuid, title, mtime: fs.statSync(full).mtimeMs, msgCount: jsonlToMessages(lines, uuid).length });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
```

- [ ] **Step 3: 타입체크** — Run: `npm run typecheck` → 통과.

- [ ] **Step 4: 커밋** — `git commit -am "feat(import): staging paths + slug/session fs helpers"`

---

### Task 4: staging 엔드포인트 + 라우트 등록 + boot reap

**Files:**
- Create: `server/src/routes/import.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `paths.importStaging`, `findSlugDir/listSessions/originalCwdFromSlug`, `requireAuth`.
- Produces: `importRoutes(app)`, `reapImportStaging()`.

- [ ] **Step 1: 라우트 파일 작성** — `server/src/routes/import.ts`. wiki.ts의 `safeSeg/safeRelPath/validSid/walkFiles`를 이 파일에 그대로 복제(10줄, DRY보다 저결합 우선). `slot` 파라미터 sanitize: `slot === 'claude' ? 'claude' : 'project'` (화이트리스트, traversal 방지). 엔드포인트:
  - `POST /api/import/staging/:sid/files?slot=project|claude` — `paths.importStaging(sid)/<slot>` 아래에 `(req as any).parts()` 스트리밍 저장(fieldname=rel, `safeRelPath` 적용). 응답 `{ files: walkFiles(slotDir) }`.
  - `DELETE /api/import/staging/:sid/file?slot=&path=` — 개별 삭제(`safeRelPath`).
  - `DELETE /api/import/staging/:sid` — `fs.rmSync(paths.importStaging(sid), {recursive:true,force:true})`, `{ ok:true }`.
  - `GET /api/import/staging/:sid/sessions` — `claudeSlot = importStaging(sid)/claude`; `slugDir = findSlugDir(claudeSlot)` → 없으면 `{ found:false }`; 있으면 `originalCwd = originalCwdFromSlug(slugDir)`, `{ found:true, originalCwd, projectTail: originalCwd ? path.basename(originalCwd.replace(/[\\/]+$/,'').split(/[\\/]/).pop()||'') : '', sessions: listSessions(slugDir) }`.
  - 전부 `const u = requireAuth(req, reply); if (!u) return;`, `validSid(sid)` 검증.
  - `export function reapImportStaging() { try { fs.rmSync(paths.importStagingRoot,{recursive:true,force:true}); } catch { /* noop */ } }`

- [ ] **Step 2: 등록 + reap** — `server/src/index.ts`: grep `wikiRoutes` 위치 옆에 `await importRoutes(app)`(import 추가), grep `reapWikiStaging` 위치 옆에 `reapImportStaging()` 추가.

- [ ] **Step 3: 수동 검증** — `npm run typecheck` 통과.

- [ ] **Step 4: 커밋** — `git commit -am "feat(import): staging upload endpoints + boot reap"`

---

### Task 5: 확정 엔드포인트 — 프로젝트 배치 + jsonl 배치 + 세션/백필

**Files:**
- Modify: `server/src/routes/import.ts`

**Interfaces:**
- Consumes: `encodeSlug`, `rewriteCwd`, `jsonlToMessages`, `listSessions`, `originalCwdFromSlug`, `findSlugDir`, `paths.userProjects`, `paths.userClaude`, `ensureUserLayout`, `db/schema`, `newId`, `cfg`.
- Produces: `POST /api/import/sessions` → `{ project, sessions: [{id,title}] }`.

- [ ] **Step 1: 헬퍼** — 파일 내 `safeName`(projects.ts와 동일 정규식 복제) + `uniqueDir(root, name)`:

```ts
function uniqueDir(root: string, name: string): { dir: string; name: string } {
  let n = name, i = 2;
  while (fs.existsSync(path.join(root, n))) { n = `${name}-${i++}`; }
  return { dir: path.join(root, n), name: n };
}
```

- [ ] **Step 2: 구현** — `POST /api/import/sessions`, body `{ sid, projectName?, sessionUuids: string[] }`:
  1. `const u = requireAuth(req, reply); if (!u) return;` `validSid(sid)`. `ensureUserLayout(u.id)`. `const now = Date.now();`
  2. `const claudeSlot = path.join(paths.importStaging(sid), 'claude'); const projectSlot = path.join(paths.importStaging(sid), 'project');`
  3. `const slugDir = findSlugDir(claudeSlot);`
  4. `const orig = slugDir ? originalCwdFromSlug(slugDir) : null;` `const tail = orig ? (orig.replace(/[\\/]+$/,'').split(/[\\/]/).pop() || 'imported') : 'imported';` `const name0 = safeName(String((req.body as any).projectName || tail));`
  5. **프로젝트 배치:** `const { dir: dest, name } = uniqueDir(paths.userProjects(u.id), name0);` `ensure(path.dirname(dest));` `if (fs.existsSync(projectSlot) && fs.readdirSync(projectSlot).length) fs.renameSync(projectSlot, dest); else ensure(dest);` `const project = { id: newId(), scope:'user', ownerId:u.id, name, path: dest, createdAt: now }; db.insert(schema.projects).values(project).run();`
  6. `const serverCwd = path.resolve(dest); const serverSlug = encodeSlug(serverCwd); const projDir = path.join(paths.userClaude(u.id), 'projects', serverSlug); ensure(projDir);`
  7. **부수 자료 복사(slugDir 있을 때):** `memory/` 존재 시 `fs.cpSync(path.join(slugDir,'memory'), path.join(projDir,'memory'), {recursive:true})`. 각 세션 `<uuid>/` 서브디렉터리 존재 시 동일 복사.
  8. **각 `uuid` in `sessionUuids` (Array 확인):**
     - `const src = path.join(slugDir!, uuid + '.jsonl'); if (!slugDir || !fs.existsSync(src)) continue;`
     - `const lines = fs.readFileSync(src, 'utf8').split('\n');` `fs.writeFileSync(path.join(projDir, uuid + '.jsonl'), lines.map((l) => rewriteCwd(l, serverCwd)).join('\n'));`
     - `<uuid>/` 서브디렉터리 복사(7에서 못 했으면 여기): `const sub = path.join(slugDir!, uuid); if (fs.existsSync(sub)) fs.cpSync(sub, path.join(projDir, uuid), {recursive:true});`
     - `const meta = listSessions(slugDir!).find((x) => x.uuid === uuid); const title = meta?.title || uuid;`
     - `const chatId = newId(); db.insert(schema.chatSessions).values({ id: chatId, ownerId:u.id, kind:'private', roomId:null, title, projectId: project.id, wikiTopicId:null, claudeSessionId: uuid, model: cfg.str('defaultModel'), permissionMode:'default', createdAt: now, updatedAt: now }).run();`
     - `for (const msg of jsonlToMessages(lines, chatId, now)) db.insert(schema.messages).values({ id:newId(), sessionId: chatId, role: msg.role, authorId: msg.role==='user'? u.id : null, authorName: msg.role==='user'? u.displayName : 'Claude', content: JSON.stringify(msg.content), chat:0, createdAt: msg.createdAt }).run();`
     - `sessions.push({ id: chatId, title });`
  9. `fs.rmSync(paths.importStaging(sid), {recursive:true,force:true});` 응답 `{ project, sessions }`.
  - `sessionUuids` 비면 `sessions=[]`(프로젝트만).
  - (`u.displayName`은 `requireAuth`가 반환하는 `AuthUser` 필드 — auth/index.ts 확인. 없으면 `u.username` 사용.)

- [ ] **Step 3: 타입체크 + 순수함수 회귀** — `npm run typecheck && npm run -w server test -- session-import` 통과.

- [ ] **Step 4: 커밋** — `git commit -am "feat(import): confirm endpoint — place project + jsonl + backfill sessions"`

---

### Task 6: store 액션 + api

**Files:**
- Modify: `web/src/lib/store.ts`

**Interfaces:**
- Consumes: 기존 `api.post`, 세션 목록 로드 액션(grep store에서 개인 세션 로드하는 함수명 확인, 예 `loadSessions`).
- Produces: `importSessions(payload: { sid: string; projectName?: string; sessionUuids: string[] }): Promise<{ project: any; sessions: any[] }>`.

- [ ] **Step 1: 구현** — store 인터페이스에 `importSessions` 타입 추가(다른 액션 옆), 구현: `const r = await api.post('/api/import/sessions', payload);` 후 개인 세션 목록 새로고침 액션 호출(로드 함수명은 store 실제 코드에서 확인). `return r;`

- [ ] **Step 2: 타입체크** — `npm run typecheck` 통과.

- [ ] **Step 3: 커밋** — `git commit -am "feat(import): store importSessions action"`

---

### Task 7: i18n 문자열 (ko/en)

**Files:**
- Modify: `web/src/lib/i18n.ts`

- [ ] **Step 1:** `import.*` 키를 `ko`·`en` 딕셔너리 **양쪽에** 추가. 최소 키(컴포넌트 사용 키와 정확히 일치):
  `import.button`(세션 가져오기 / Import session), `import.title`, `import.pickProject`, `import.chooseFolder`, `import.gitignoreHint`, `import.essentialLocked`, `import.uploadProject`, `import.claudeGuideTitle`, `import.claudeGuideBody`(slug 인코딩 안내 + `{example}` 플레이스홀더), `import.claudePick`, `import.claudeSkip`, `import.selectSessions`, `import.selectAll`, `import.sessionMeta`(`{count}개 메시지 · {date}`), `import.noSessions`, `import.projectName`, `import.confirm`, `import.cancel`, `import.importing`, `import.doneToast`.

- [ ] **Step 2: 커밋** — `git commit -am "feat(import): i18n ko/en strings"`

---

### Task 8: ImportSessionModal + Sidebar 버튼

**Files:**
- Create: `web/src/components/ImportSessionModal.tsx`
- Modify: `web/src/components/Sidebar.tsx`, `web/package.json`

**Interfaces:**
- Consumes: `api.uploadProgress`, `api.del`, `api.get`, `store.importSessions`, `Modal`, `useT`. `ignore` npm.
- wiki `WikiCreateModal`(`Sidebar.tsx:152~`)의 sid 생성·`traverseEntry`·`uploadCollected`·진행률·`Modal` 패턴을 복제/차용.

- [ ] **Step 1: 의존성** — `web/package.json` `dependencies`에 `ignore` 추가 후 `npm i -w web`(또는 루트에서 `npm i`). 버전은 최신 안정.

- [ ] **Step 2: 모달 구현** — `ImportSessionModal.tsx`, 단계 상태(`step: 'project'|'tree'|'claude'|'sessions'`), `sid` 1회 생성(wiki와 동일):
  - **project:** 폴더 픽(`webkitdirectory`)/드롭 → FileList 수집(업로드 안 함). 루트 `.gitignore` 파일 있으면 텍스트 읽어 `ig = ignore().add(text)`. → step='tree'.
  - **tree:** 수집 파일 트리 렌더. 파일 기본 체크 = `!(ig && ig.ignores(rel)) && !rel.split('/').includes('.git')`. 필수(`rel==='CLAUDE.md'` 또는 `rel`이 `.claude/`로 시작)는 체크 고정+잠금 표시. 디렉터리 체크박스 하위 캐스케이드. "업로드" → 체크된 것만 `FormData`(append(rel, file, file.name)) → `api.uploadProgress('/api/import/staging/'+sid+'/files?slot=project', form, setProgress)` → step='claude'.
  - **claude:** 마운트 시 `claudeRef.current?.click()` 자동 + 가이드 패널(`import.claudeGuideBody`, example=`C:\\dev\\MyProj → C--dev-MyProj`). `import.claudeSkip` 버튼 → `setSessions([])`, step='sessions'. 폴더 픽 → `uploadCollected(list, slot='claude')` 후 `const r = await api.get('/api/import/staging/'+sid+'/sessions')` → `setProjectName(r.projectTail||'')`, `setSessions(r.sessions||[])`, step='sessions'. `r.found===false`면 "세션 못 찾음, 다시 선택" 안내.
  - **sessions:** 세션 체크박스 목록(`import.selectAll` 토글 포함, 기본 전체 체크), 프로젝트명 입력(`import.projectName`, 기본 projectTail). "확인" → `await importSessions({ sid, projectName, sessionUuids: checkedUuids }); onClose();`. 빈 세션(skip)이면 프로젝트명만으로 확인 가능.
  - 취소/닫기(`onOpenChange(false)`) → `api.del('/api/import/staging/'+sid).catch(()=>{}); onClose();`
  - **반응형:** `Modal` 적당 width, 내부 다단 `<md` 세로 스택, 트리·세션목록 `max-h-* overflow-auto scrolly`.
- [ ] **Step 3: Sidebar 배선** — 개인 섹션 헤더(신규 대화 버튼 근처)에 `import.button` 버튼 + `const [importOpen, setImportOpen] = useState(false)` + `{importOpen && <ImportSessionModal onClose={() => setImportOpen(false)} />}`.

- [ ] **Step 4: 빌드/타입** — `npm run typecheck && npm run build -w web` 통과.

- [ ] **Step 5: 커밋** — `git commit -am "feat(import): ImportSessionModal (gitignore tree + .claude guide + session picker)"`

---

### Task 9: 데모 목

**Files:**
- Modify: `web/src/demo/router.ts`, `web/src/demo/data.ts`

- [ ] **Step 1:** `router.ts` seg 매칭에 추가(기존 wiki staging 목 패턴 참고):
  - `import/staging/:sid/files` POST → `{ files: [{name:'src/index.ts',size:100}] }`.
  - `import/staging/:sid/sessions` GET → `{ found:true, originalCwd:'C:\\dev\\Demo', projectTail:'Demo', sessions:[{uuid:'demo-uuid', title:'데모 세션', mtime: 1, msgCount:3}] }`.
  - `import/staging/:sid` DELETE → `{ ok:true }`.
  - `import/sessions` POST → `{ project:{id:'p-demo',name:'Demo'}, sessions:[{id:'imp1', title:'데모 세션'}] }`.
  - `data.ts`: 개인 세션 시드에 import 결과로 보일 항목 1개(선택).

- [ ] **Step 2: 데모 빌드** — `npm run build:demo -w web` 통과.

- [ ] **Step 3: 커밋** — `git commit -am "feat(import): demo mocks"`

---

### Task 10: README

**Files:**
- Modify: `README.md`, `README.ko.md`

- [ ] **Step 1:** 두 README 기능 목록에 한 줄씩 — EN: "Import a local session: upload a project folder + its `~/.claude` session files to clone the conversation as a resumable private session." / KO: "로컬 세션 가져오기: 프로젝트 폴더 + `~/.claude` 세션 파일을 업로드해 대화를 resume 가능한 개인 세션으로 복제."

- [ ] **Step 2: 커밋** — `git commit -am "docs(import): README feature entry (en/ko)"`

---

### Task 11: 통합 검증 + docker 반영

- [ ] **Step 1:** `npm run typecheck && npm run -w server test`.
- [ ] **Step 2:** 실동작 스모크 — dev 서버에서 실제 프로젝트 폴더 + `~/.claude/projects/<slug>` 업로드 → 개인 세션 생성·과거 대화 표시·이어 대화(resume) 확인. `.claude` skip 케이스도 확인(프로젝트만 생성).
- [ ] **Step 3:** `docker compose up -d --build` 로 반영, `docker compose ps` 확인.
- [ ] **Step 4:** `main` 병합.

---

## Self-Review

**Spec coverage:** §2 UX→Task 8; §3.1 staging→Task 4; §3.2 confirm→Task 5; §3.3 순수변환→Task 1·2·3; §3.4 paths→Task 3; §4 프론트→Task 6·7·8; §5 데모→Task 9; §6 한계→UI(Task 8 claude skip 안내); §7 보안→Task 4·5(requireAuth, 서버계산 slug, slot 화이트리스트, safeRelPath); §8 문서→Task 10. 커버 완료.

**Placeholder scan:** 순수 모듈(Task 1·2·3)은 완전 코드. 라우트/UI(Task 4·5·8)는 wiki 패턴 미러 + 정확한 시그니처/경로/필드/코드 스니펫 명시. 명시적 TBD 없음. (store 로드 함수명·`u.displayName` 유무는 실행 시 실제 코드에서 확인하도록 지시 명시.)

**Type consistency:** `encodeSlug`/`rewriteCwd`/`jsonlToMessages`/`findSlugDir`/`listSessions`/`originalCwdFromSlug` 이름·시그니처가 Task 1–5 전반 일관. Block 포맷은 `session-manager.ts` `Block`과 동일. `chat_sessions`/`messages`/`projects` 필드는 `schema.ts` 실제 컬럼과 일치.
