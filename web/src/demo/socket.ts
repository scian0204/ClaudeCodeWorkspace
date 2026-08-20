// Mock socket.io Socket for the static demo. Store wiring is unchanged — the store still
// calls .on()/.emit(); here .emit() interprets outbound events and synthesizes the inbound
// stream (message → turn:start → deltas → tool → turn:end), including one permission prompt
// on the first turn of each chat so the web-approval UX is demoable.
import { db, ATTACHMENTS } from './data';

type Fn = (...a: any[]) => void;
const rid = () => (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`);

const handlers = new Map<string, Fn[]>();
const timers: any[] = [];
const gated = new Set<string>();
const waiting = new Map<string, (answer?: string) => void>(); // requestId → continue-the-turn (answer: AskUserQuestion pick/free text)

function deliver(event: string, payload?: any) { (handlers.get(event) || []).forEach((fn) => fn(payload)); }
function later(ms: number, fn: Fn) { timers.push(setTimeout(fn, ms)); }
function clearTimers() { timers.splice(0).forEach(clearTimeout); }

const chunks = (s: string, n = 3) => {
  const words = s.split(' '); const out: string[] = []; const step = Math.ceil(words.length / n);
  for (let i = 0; i < words.length; i += step) out.push(words.slice(i, i + step).join(' ') + (i + step < words.length ? ' ' : ''));
  return out;
};

function reply(text: string, nAtt = 0) {
  const short = text.length > 56 ? text.slice(0, 53) + '…' : text;
  const isCmd = text.trim().startsWith('/');
  const attNote = nAtt ? `Thanks — I can see ${nAtt} attachment${nAtt > 1 ? 's' : ''}. ` : '';
  return {
    intro: attNote + (isCmd ? `Running \`${text.trim()}\`. Let me pull the current state first.` : `Sure — let me take a look at "${short || 'the attachment'}".`),
    tools: [
      { name: 'Bash', input: { command: 'grep -rn "TODO" src/ | head' }, output: 'src/index.ts:42:  // TODO: wire up metrics\nsrc/db.ts:88:  // TODO: add retry' },
      // a real Edit input so the chat's diff card (+N −N badge, colored body) is demoable
      { name: 'Read', input: { file_path: 'src/db.ts' }, output: 'export async function run(sql: string) {\n  await db.query(sql);\n}' },
      // a real Edit input so the chat's diff card (+N −N badge, colored body) is demoable
      { name: 'Edit', input: { file_path: 'src/db.ts', old_string: 'export async function run(sql: string) {\n  await db.query(sql);\n}', new_string: 'export async function run(sql: string) {\n  await withRetry(() => db.query(sql), { tries: 3 });\n}' }, output: 'Applied 1 edit.' },
      // four back-to-back calls: enough to exercise the folded "commands" row (toolFoldMin)
      { name: 'Bash', input: { command: 'npm test -- db' }, output: 'PASS src/db.test.ts (3 tests)' },
    ],
    outro: 'Applied the retry wrapper. The flaky call now retries up to 3 times before failing — want me to run the tests?',
  };
}

function appendMsg(sessionId: string, msg: any) { (db.messages[sessionId] || (db.messages[sessionId] = [])).push(msg); }

// ── background work (task panel) ──────────────────────────────────────────────
// Mirror of server/src/claude/tasks.ts: the real thing folds the CLI's task_* / background_tasks
// system messages into one list per session and re-broadcasts the WHOLE list on every change.
const demoTasks = new Map<string, any[]>();
function demoTasksFor(sessionId: string) { return (demoTasks.get(sessionId) || []).map((t) => ({ ...t })); }

function taskUpsert(sessionId: string, id: string, patch: any) {
  const list = demoTasks.get(sessionId) || [];
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) list.push({ id, kind: 'task', label: '', status: 'running', background: false, startedAt: Date.now(), ...patch });
  else list[i] = { ...list[i], ...patch };
  demoTasks.set(sessionId, list);
  deliver('tasks:update', { sessionId, tasks: demoTasksFor(sessionId) });
}

// One turn's worth of behind-the-scenes work: a Task-tool subagent that finishes, plus a backgrounded
// shell that keeps running past it — enough to exercise every panel state. The subagent also streams
// a nested tool call + text (subagent:delta/subagent:block) so the task panel's live view is demoable.
function runDemoTasks(sessionId: string) {
  const sub = `task_${rid().slice(0, 6)}`, sh = `task_${rid().slice(0, 6)}`;
  const subTool = `tu_${rid().slice(0, 6)}`, grep = `t_${rid().slice(0, 6)}`;
  later(300, () => taskUpsert(sessionId, sub, { kind: 'subagent', agentType: 'code-reviewer', toolUseId: subTool, label: 'Review the changed files for hook-order bugs', status: 'running', startedAt: Date.now() }));
  later(700, () => taskUpsert(sessionId, sh, { kind: 'shell', label: 'npm run build -w web', status: 'running', background: true, startedAt: Date.now() }));
  later(900, () => deliver('tool:use', { sessionId, id: grep, name: 'Grep', input: { pattern: 'useEffect\\(' }, parentId: subTool, agentType: 'code-reviewer' }));
  later(1500, () => deliver('tool:result', { sessionId, id: grep, output: 'web/src/lib/ui.tsx:41: useEffect(() => { ... }, [])\nweb/src/components/Sidebar.tsx:118: useEffect(...)', isError: false }));
  const subText = 'Two suspicious dependency arrays so far — checking whether the hooks read state they never list.';
  chunks(subText).forEach((c, i) => later(1700 + i * 160, () => deliver('subagent:delta', { sessionId, parentId: subTool, text: c })));
  later(1700 + chunks(subText).length * 160 + 200, () => deliver('subagent:block', { sessionId, parentId: subTool, agentType: 'code-reviewer', text: subText }));
  later(1600, () => taskUpsert(sessionId, sub, { lastTool: 'Grep', tokens: 8400, toolUses: 5 }));
  later(2900, () => taskUpsert(sessionId, sub, { status: 'completed', endedAt: Date.now(), tokens: 12800, toolUses: 9, summary: '2 findings: a stale dependency array in useGuideInset, and a missing IME guard on the retitle input.' }));
  later(5200, () => taskUpsert(sessionId, sh, { status: 'completed', endedAt: Date.now(), background: false, summary: 'built in 4.1s — 1 chunk over 500 kB' }));
}

// Mirror of the server's auto-titling: a still-unnamed private chat gets named after its topic once
// the first turn ends. The real thing asks a cheap model; the demo just takes the opening words.
const DEMO_DEFAULT_TITLE = 'New chat';
function autoTitle(sessionId: string, text: string) {
  if (!db.me.autoTitle) return;
  const s = db.sessions.find((x) => x.id === sessionId);
  if (!s || s.title !== DEMO_DEFAULT_TITLE) return;
  const title = String(text || '').trim().split('\n')[0].split(/\s+/).slice(0, 6).join(' ').slice(0, 40);
  if (!title) return;
  // same session:titling → session:title pair the server sends, so the naming animation is demoable
  deliver('session:titling', { sessionId, on: true });
  later(1500, () => {
    s.title = title;
    deliver('session:title', { sessionId, title });
    deliver('session:titling', { sessionId, on: false });
  });
}

// After a turn in a thread bound to a wiki topic, the real server asks a small model whether the
// exchange is worth keeping. The demo has no model, so it uses the question itself: anything that
// reads like a real question about the topic becomes an addition. The topic's own mode decides
// whether that arrives as a card to accept ('ask') or as a note that it already went in ('auto').
function topicForSession(sessionId: string) {
  const own = db.wikiTopics.find((t: any) => `cs_${t.id}` === sessionId);
  if (own) return own;
  const s = db.sessions.find((x: any) => x.id === sessionId) as any;
  const linked = s?.wikiRefId || (db.rooms.find((r: any) => r.chatSessionId === sessionId) as any)?.wikiRefId;
  return linked ? db.wikiTopics.find((t: any) => t.id === linked) : undefined;
}

function maybeLearn(sessionId: string, question: string) {
  const topic: any = topicForSession(sessionId);
  if (!topic || !topic.autoLearn || topic.autoLearn === 'off') return;
  const q = question.trim();
  if (q.length < 12 || q.startsWith('/')) return; // small talk and slash commands are not knowledge
  const title = q.replace(/[?？.!]+$/, '').slice(0, 60);
  const content = title + '\n\n이 대화에서 정리된 내용입니다. 실제 서버에서는 모델이 답변을 읽고 남길 만한 지식인지 판단해 이 글을 씁니다.';
  if (topic.autoLearn === 'auto') {
    topic.compiledAt = Date.now();
    later(600, () => deliver('wiki:learned', { sessionId, topicId: topic.id, topicName: topic.name, title }));
    return;
  }
  const proposal = {
    id: `wp_${rid()}`, topicId: topic.id, topicName: topic.name, sessionId,
    title, slug: 'from-conversation', content, status: 'pending', createdBy: db.me.id, createdAt: Date.now(),
  };
  db.wikiProposals.push(proposal);
  later(600, () => deliver('wiki:proposal', { sessionId, proposal }));
}

function runTurn(sessionId: string, text: string, nAtt = 0) {
  const firstText = text;
  runDemoTasks(sessionId); // subagent + background shell alongside the answer (task panel)
  const r = reply(text, nAtt);
  const finalBlocks: any[] = [];

  const streamOutro = () => {
    let d = 200;
    // same thinking-then-text shape the real SDK streams (see runReal's stream_event handling)
    for (let i = 0; i < 8; i++) later(d += 110, () => deliver('assistant:thinking', { sessionId, len: 38 }));
    chunks(r.outro).forEach((c) => later(d += 180, () => deliver('assistant:delta', { sessionId, text: c })));
    later(d += 60, () => deliver('turn:usage', { sessionId, inputTokens: 12400, outputTokens: 420 }));
    finalBlocks.push({ type: 'text', text: r.outro });
    later(d += 300, () => {
      const msg = { id: `m_${rid()}`, role: 'assistant', authorId: null, authorName: 'Claude', content: { blocks: finalBlocks }, createdAt: Date.now() };
      appendMsg(sessionId, msg);
      deliver('turn:end', { sessionId, message: msg });
      autoTitle(sessionId, firstText);
      maybeLearn(sessionId, firstText);
    });
  };

  // run the turn's tools one after another (use → 700ms → result), then stream the outro
  const runTools = (i = 0) => {
    if (i >= r.tools.length) { streamOutro(); return; }
    const tl = r.tools[i];
    const id = `t_${rid()}`;
    deliver('tool:use', { sessionId, id, name: tl.name, input: tl.input });
    finalBlocks.push({ type: 'tool_use', id, name: tl.name, input: tl.input });
    later(700, () => {
      deliver('tool:result', { sessionId, id, output: tl.output, isError: false });
      finalBlocks[finalBlocks.length - 1].output = tl.output;
      later(250, () => runTools(i + 1));
    });
  };

  // a short thinking phase, then the intro text. Input tokens land FIRST (the real stream reports
  // them at the start of each agent-loop iteration), so the live meter moves before any text shows.
  let d = 150;
  later(d, () => deliver('turn:usage', { sessionId, inputTokens: 6100, outputTokens: 0 }));
  for (let i = 0; i < 6; i++) later(d += 120, () => deliver('assistant:thinking', { sessionId, len: 34 }));
  chunks(r.intro).forEach((c) => later(d += 160, () => deliver('assistant:delta', { sessionId, text: c })));
  finalBlocks.push({ type: 'text', text: r.intro });

  if (!gated.has(sessionId)) {
    // first turn in this chat → ask for permission before the tools run
    gated.add(sessionId);
    later(d += 400, () => {
      const requestId = `perm_${rid()}`;
      waiting.set(requestId, () => runTools()); // wrapped: the cont's answer arg must not become the index
      deliver('permission:request', { sessionId, requestId, tool: r.tools[0].name, input: r.tools[0].input });
    });
  } else {
    later(d += 400, () => runTools());
  }
}


// `!ask` demo: exercises the AskUserQuestion card — option buttons plus the free-text "직접 입력" row.
// Mirrors the real flow: tool:use(AskUserQuestion) → permission:request → respond('answer', text)
// feeds the pick back as the tool result and the turn continues with it.
function runAskQuestion(sessionId: string) {
  const finalBlocks: any[] = [];
  let d = 150;
  for (let i = 0; i < 4; i++) later(d += 110, () => deliver('assistant:thinking', { sessionId, len: 30 }));
  const intro = 'Before I scaffold this, one quick question.';
  chunks(intro).forEach((c) => later(d += 150, () => deliver('assistant:delta', { sessionId, text: c })));
  finalBlocks.push({ type: 'text', text: intro });
  const input = { questions: [{
    question: 'Which bundler should the new package use?',
    options: [
      { label: 'Vite', description: 'fast dev server, Rollup production build' },
      { label: 'esbuild', description: 'fastest builds, fewer plugins' },
      { label: 'Keep current setup', description: 'inherit the workspace default' },
    ],
  }] };
  later(d += 400, () => {
    const requestId = `perm_${rid()}`;
    const toolId = `t_${rid()}`;
    deliver('tool:use', { sessionId, id: toolId, name: 'AskUserQuestion', input });
    finalBlocks.push({ type: 'tool_use', id: toolId, name: 'AskUserQuestion', input });
    waiting.set(requestId, (answer?: string) => {
      const output = answer || 'Denied.';
      finalBlocks[finalBlocks.length - 1].output = output;
      deliver('tool:result', { sessionId, id: toolId, output, isError: false });
      // the picked label (or the free text) sits after the arrow in chat.userChoiceAnswer
      const chosen = /→ "([\s\S]*)"$/.exec(String(answer || ''))?.[1] || answer || '';
      const outro = chosen ? `Got it — going with **${chosen}**. I'll wire the scripts accordingly.` : 'Understood, leaving it as is.';
      let e = 150;
      chunks(outro).forEach((c) => later(e += 160, () => deliver('assistant:delta', { sessionId, text: c })));
      finalBlocks.push({ type: 'text', text: outro });
      later(e + 300, () => {
        const msg = { id: `m_${rid()}`, role: 'assistant', authorId: null, authorName: 'Claude', content: { blocks: finalBlocks }, createdAt: Date.now() };
        appendMsg(sessionId, msg);
        deliver('turn:end', { sessionId, message: msg });
      });
    });
    deliver('permission:request', { sessionId, requestId, tool: 'AskUserQuestion', input });
  });
}

// Mirror of server/src/claude/auto-resume.ts for the static demo: sending a message that starts with
// `!limit` pretends the claude.ai 5h window is spent, so the "parked until reset" banner (and its
// cancel button) is reachable without a real account. The demo waits 20s instead of 5 hours.
const DEMO_RESUME_WAIT_MS = 20_000;
const parked = new Map<string, { sessionId: string; text: string; timer: any }>();

function parkTurn(sessionId: string, text: string) {
  const id = `res_${rid()}`;
  const resumeAt = Date.now() + DEMO_RESUME_WAIT_MS;
  deliver('turn:error', { sessionId, aborted: false, error: 'Claude AI usage limit reached', resumeAt });
  deliver('turn:resumeScheduled', { sessionId, id, resumeAt, attempts: 0, text, author: { id: db.me.id, name: db.me.displayName } });
  const timer = setTimeout(() => {
    parked.delete(id);
    deliver('turn:resumeFired', { sessionId, id, author: { id: db.me.id, name: db.me.displayName } });
    deliver('turn:start', { sessionId });
    runTurn(sessionId, text.trim().slice('!limit'.length).trim() || 'continue');
  }, DEMO_RESUME_WAIT_MS);
  timers.push(timer);
  parked.set(id, { sessionId, text, timer });
}

// ── guide assistant (the floating corner panel) ──────────────────────────────
// The real thing runs a Claude agent whose tools call this app's own API. Here we recognise the
// handful of intents the panel's suggestion chips produce and replay the same event stream
// (guide:message → guide:start → deltas → tool chips → guide:end), including the guide:action the
// store applies — so language switching, the shortcut sheet and session creation really work.
function guideMsg(role: 'user' | 'assistant', content: any) {
  const m = { id: `g_${rid()}`, role, content, createdAt: Date.now() };
  db.guideMessages.push(m);
  return m;
}

// one tool chip: the call goes out, its result lands a beat later
function guideTool(input: any, output: string, blocks: any[], at: number): number {
  const id = `gt_${rid()}`;
  const name = input.action ? 'mcp__ccw__ui' : 'mcp__ccw__api';
  later(at, () => deliver('guide:tool', { id, name, input }));
  blocks.push({ type: 'tool_use', id, name, input });
  const i = blocks.length - 1;
  later(at + 500, () => {
    blocks[i].output = output;
    deliver('guide:toolResult', { id, output, isError: false });
    if (input.action) deliver('guide:action', { action: input.action, value: input.value ?? null });
  });
  return at + 700;
}

// Which canned answer this question gets. Order matters: the URL cases win over the keywords.
function guidePlan(text: string): { steps: { input: any; output: string }[]; reply: string } {
  const q = text.toLowerCase();
  const url = /https?:\/\/\S+/.exec(text)?.[0];
  if (/(btw|사이드 ?채팅|side chat|곁다리|따로 물어)/.test(q)) {
    return {
      steps: [{ input: { action: 'openAside' }, output: 'ok — dispatched openAside' }],
      reply: '사이드 채팅을 열었습니다. 지금 대화를 그대로 이어받아 답하지만, 여기서 오간 내용은 대화 기록에 남지 않습니다 — 읽기 전용이라 파일을 고치거나 명령을 실행하지도 않아요.\n\n입력창에 `/btw 질문` 처럼 바로 물어봐도 됩니다.',
    };
  }
  if (/(위키|wiki)/.test(q) && /(연결|link|붙|참고)/.test(q)) {
    const topic = db.wikiTopics[0];
    const sid = db.sessions[0]?.id || '';
    (db.sessions[0] as any).wikiRefId = topic?.id;
    return {
      steps: [
        { input: { method: 'PATCH', path: `/api/sessions/${sid}`, body: { wikiRefId: topic?.id } }, output: 'status=200\n{"ok":true}' },
        { input: { action: 'refresh' }, output: 'ok — dispatched refresh' },
      ],
      reply: `이 대화에 \`${topic?.name}\` 위키를 연결했습니다. 앞으로 이 대화의 질문은 그 지식 기반을 먼저 찾아본 뒤 답합니다(위키 자체는 건드리지 않아요).\n\n상단 위키 버튼에서 다른 주제로 바꾸거나 연결을 끊을 수 있습니다.`,
    };
  }
  if (url && /(skill|plugin|스킬|플러그인)/.test(q)) {
    const name = url.replace(/\.git$/, '').split('/').pop() || 'plugin';
    return {
      steps: [
        { input: { method: 'POST', path: '/api/plugins/install', body: { scope: 'user', name, repo: url } }, output: `status=200\n{"plugin":{"id":"pl_demo","name":"${name}","scope":"user","enabled":true}}` },
        { input: { action: 'refresh' }, output: 'ok — dispatched refresh' },
      ],
      reply: `\`${name}\` 플러그인을 개인 범위로 설치했습니다. 함께 들어 있는 스킬은 이제 채팅에서 바로 쓸 수 있어요.\n\n플러그인 패널에서 켜고 끌 수 있습니다.`,
    };
  }
  if (url) {
    const name = url.replace(/\.git$/, '').split('/').pop() || 'repo';
    const sid = `s_${rid().slice(0, 6)}`;
    const pid = `p_${rid().slice(0, 6)}`;
    db.projects.mine.unshift({ id: pid, scope: 'user', ownerId: db.me.id, name, path: `/data/users/me/projects/${name}` });
    db.sessions.unshift({ id: sid, title: name, updatedAt: Date.now(), projectId: pid, model: 'claude-opus-4-8', effort: 'high', permissionMode: 'default' });
    return {
      steps: [
        { input: { method: 'POST', path: '/api/projects', body: { gitUrl: url } }, output: `status=200\n{"project":{"id":"${pid}","name":"${name}"}}` },
        { input: { method: 'POST', path: '/api/sessions', body: { projectId: pid } }, output: `status=200\n{"session":{"id":"${sid}"}}` },
        { input: { action: 'refresh' }, output: 'ok — dispatched refresh' },
        { input: { action: 'openSession', value: sid }, output: `ok — dispatched openSession (${sid})` },
      ],
      reply: `\`${name}\` 저장소를 클론해 개인 프로젝트로 만들고, 그 프로젝트를 작업 디렉터리로 쓰는 새 세션을 열었습니다.`,
    };
  }
  if (/(english|영어|한국어|korean|언어|language)/.test(q)) {
    const to = /(korean|한국어)/.test(q) ? 'ko' : 'en';
    return {
      steps: [{ input: { action: 'setLanguage', value: to }, output: `ok — dispatched setLanguage (${to})` }],
      reply: to === 'en'
        ? 'Switched the interface to English. You can also change it from the picker in the sidebar footer.'
        : '인터페이스를 한국어로 바꿨습니다. 사이드바 하단 선택기에서도 바꿀 수 있어요.',
    };
  }
  if (/(shortcut|단축키|키보드)/.test(q)) {
    return {
      steps: [{ input: { action: 'openShortcuts' }, output: 'ok — dispatched openShortcuts' }],
      reply: '자주 쓰는 것들:\n\n- `Ctrl/Cmd+K` 검색\n- `Ctrl/Cmd+Shift+O` 새 채팅\n- `Ctrl/Cmd+B` 사이드바\n- `Alt+↑/↓` 이전/다음 대화\n- `Ctrl/Cmd+Shift+E · G · F` 작업 / Git / 파일 패널\n- `Esc` 실행 중인 턴 중단\n- `?` 전체 목록\n\n전체 목록을 방금 열었습니다.',
    };
  }
  if (/(agent|에이전트)/.test(q)) {
    const n = db.agents.common.length + db.agents.mine.length;
    return {
      steps: [
        { input: { method: 'GET', path: '/api/agents' }, output: `status=200\n{"common":${db.agents.common.length},"mine":${db.agents.mine.length},"project":${db.agents.projects.length},"files":${db.agents.files.length}}` },
        { input: { action: 'openPanel', value: 'agents' }, output: 'ok — dispatched openPanel (agents)' },
      ],
      reply: `**팀 에이전트**는 이름·설명·시스템 프롬프트·허용 도구·모델을 미리 정해 두는 커스텀 에이전트입니다. 개인용 / 팀 공용(관리자) / 프로젝트별로 만들 수 있고, 모든 세션이 서브에이전트로 씁니다.\n\n지금 ${n}개가 등록돼 있어 패널을 열었습니다. "…하는 에이전트 만들어줘"라고 하면 프롬프트까지 써서 바로 만들어 드립니다.`,
    };
  }
  if (/(pool|모아쓰기|토큰 공유|플랜 공유)/.test(q)) {
    return {
      steps: [{ input: { method: 'GET', path: '/api/pools' }, output: 'status=200\n{"pools":[],"allUsers":true,"myPoolId":null,"optedOut":false,"hasCredential":true,"canCreate":true}' }],
      reply: '**토큰 모아쓰기**는 동의한 사람들의 Claude 플랜을 함께 써서, 아직 여유가 있는 플랜으로 턴이 실행되게 합니다. 관리자가 켜는 워크스페이스 전체 풀(개인별로 빠질 수 있음)과, 직접 만들어 참여하는 파티가 있어요.\n\n이 워크스페이스는 전체 풀이 켜져 있습니다. 마이 페이지에서 빠지거나 파티를 만들 수 있습니다.',
    };
  }
  if (/(5시간|선점|primer|prime)/.test(q)) {
    db.me.primeWindow = true;
    return {
      steps: [{ input: { method: 'PATCH', path: '/api/auth/me', body: { primeWindow: true } }, output: 'status=200\n{"user":{"primeWindow":true}}' }],
      reply: '5시간 창 선점을 켰습니다. 이제 창이 열려 있지 않을 때 서버가 아주 작은 질의를 한 번 보내 창을 미리 열어 둡니다.\n\n마이 페이지에서도 켜고 끌 수 있어요.',
    };
  }
  return {
    steps: [],
    reply: '핵심 기능은 이렇습니다:\n\n- **개인 채팅** — 사용자마다 격리된 Claude Code 세션\n- **공유 룸** — 여러 명이 하나의 Claude를 함께 조작 (FIFO 큐)\n- **웹 권한 승인** — 위험한 도구 실행 전 브라우저에서 허용/거부\n- **프로젝트 · Git 패널 · 파일 탐색기 · code-server** 편집기\n- **작업 패널** — 답변 뒤에서 돈 서브에이전트·셸·워크플로를 실시간으로\n- **팀 에이전트 · 플러그인/스킬** — 커스텀 에이전트와 스킬 설치\n- **LLM Wiki** — 문서를 올리면 질의 가능한 지식베이스로 컴파일\n- **PR 자동 리뷰** — 열린 PR마다 머지→빌드→리뷰→판정 파이프라인\n- **통합 검색** (`Ctrl/Cmd+K`), **DM/그룹 채팅**, **토큰 모아쓰기**, **사용량 미터**\n\n더 궁금한 기능을 말씀하시면 자세히 설명하고, 필요하면 대신 실행해 드립니다.',
  };
}

export function runDemoGuide(text: string) {
  deliver('guide:message', { message: guideMsg('user', { text }) });
  const plan = guidePlan(text);
  const blocks: any[] = [];
  let at = 350;
  later(at, () => deliver('guide:start', {}));
  for (const s of plan.steps) at = guideTool(s.input, s.output, blocks, at + 250);
  chunks(plan.reply, 5).forEach((c) => later(at += 170, () => deliver('guide:delta', { text: c })));
  blocks.push({ type: 'text', text: plan.reply });
  later(at + 350, () => deliver('guide:end', { message: guideMsg('assistant', { blocks }) }));
}

export function clearDemoGuide() {
  db.guideMessages.length = 0;
  deliver('guide:cleared', {});
}

// ── side chat (/btw) ────────────────────────────────────────────────────────
// The real one forks the chat's CLI session and answers from it. Here the answer is canned, but the
// event sequence is the server's (aside:start → deltas → aside:end) so the panel behaves the same.
const ASIDE_REPLY = (q: string) => `\`${q}\` — 사이드 채팅이라 이 답은 대화 기록에 남지 않습니다.

`
  + '실제 워크스페이스에서는 지금 열려 있는 대화를 그대로 복사한 상태에서 답하므로, 지금까지 오간 내용을 모두 알고 있습니다. '
  + '대신 읽기 전용이라 파일을 고치거나 명령을 실행하지는 않습니다 — 작업이 필요하면 메인 대화에서 요청하세요.';

export function runDemoAside(sessionId: string, text: string) {
  const reply = ASIDE_REPLY(text);
  let at = 300;
  later(at, () => deliver('aside:start', { sessionId }));
  chunks(reply, 5).forEach((c) => later(at += 150, () => deliver('aside:delta', { sessionId, text: c })));
  later(at + 300, () => deliver('aside:end', { sessionId, blocks: [{ type: 'text', text: reply }] }));
}

const sock = {
  connected: true,
  id: `demo_${rid()}`,
  on(event: string, cb: Fn) { (handlers.get(event) || handlers.set(event, []).get(event)!).push(cb); return sock; },
  off(event: string) { handlers.delete(event); return sock; },
  emit(event: string, ...args: any[]) {
    if (event === 'session:join') {
      const [sessionId, ack] = args;
      if (typeof ack === 'function') ack({ queue: { running: null, waiting: [] }, pending: [], resumes: [], tasks: demoTasksFor(sessionId), control: { canApprove: true, canInterrupt: true, canSetMode: true, isOwner: true, delegable: [] } });
      const room = db.rooms.find((r) => r.chatSessionId === sessionId);
      if (room) later(60, () => deliver('presence:update', { sessionId, users: room.members.map((m: any) => ({ id: m.userId, name: m.displayName, color: m.avatarColor })) }));
      return sock;
    }
    if (event === 'chat:send') {
      const { sessionId, text, chat, attachments } = args[0] || {};
      // pull the stored data URL back so image thumbnails render inline in the echoed message
      const atts = Array.isArray(attachments)
        ? attachments.map((a: any) => ({ name: a.name, isImage: !!a.isImage, url: ATTACHMENTS.get(a.name)?.url }))
        : [];
      const content: any = { text };
      if (atts.length) content.attachments = atts;
      appendMsg(sessionId, { id: `m_${rid()}`, role: 'user', authorId: db.me.id, authorName: db.me.displayName, content, chat: !!chat, createdAt: Date.now() });
      deliver('message', { sessionId, message: db.messages[sessionId][db.messages[sessionId].length - 1] });
      if (chat) return sock; // room team chat: broadcast only, no Claude turn
      if (db.me.autoResume && String(text || '').trim().toLowerCase().startsWith('!limit')) { parkTurn(sessionId, String(text)); return sock; }
      deliver('turn:start', { sessionId });
      if (String(text || '').trim().toLowerCase().startsWith('!ask')) runAskQuestion(sessionId);
      else runTurn(sessionId, text, atts.length);
      return sock;
    }
    if (event === 'permission:respond') {
      const { requestId, decision, sessionId } = args[0] || {};
      const cont = waiting.get(requestId); waiting.delete(requestId);
      if (decision === 'deny') {
        const msg = { id: `m_${rid()}`, role: 'assistant', authorId: null, authorName: 'Claude', content: { blocks: [{ type: 'text', text: "Understood — I won't run that. Let me know how you'd like to proceed." }] }, createdAt: Date.now() };
        appendMsg(sessionId, msg);
        later(150, () => deliver('turn:end', { sessionId, message: msg }));
      } else if (cont) { const a = args[0]?.answer; later(150, () => cont(a)); }
      return sock;
    }
    if (event === 'dm:send') {
      const { channelId, text } = args[0] || {};
      const clean = String(text || '').trim();
      if (!clean) return sock;
      const msg = { id: `dm_${rid()}`, channelId, userId: db.me.id, text: clean, createdAt: Date.now() };
      (db.dmMessages[channelId] || (db.dmMessages[channelId] = [])).push(msg);
      deliver('dm:message', { channelId, message: msg });
      // canned reply from another member so the thread feels alive in the static demo
      const ch = db.dmChannels.find((c: any) => c.id === channelId);
      const other = ch?.members.find((m: any) => m.userId !== db.me.id);
      if (other) later(900, () => {
        const r = { id: `dm_${rid()}`, channelId, userId: other.userId, text: `👍 "${clean.slice(0, 40)}" 확인했어요!`, createdAt: Date.now() };
        db.dmMessages[channelId].push(r);
        deliver('dm:message', { channelId, message: r });
      });
      return sock;
    }
    if (event === 'dm:read') {
      const ch = db.dmChannels.find((c: any) => c.id === args[0]?.channelId); if (ch) ch.unread = 0; return sock;
    }
    if (event === 'chat:cancelResume') {
      const { id, sessionId } = args[0] || {};
      const p = parked.get(id); if (p) { clearTimeout(p.timer); parked.delete(id); }
      deliver('turn:resumeCancelled', { sessionId, id });
      return sock;
    }
    if (event === 'chat:interrupt' || event === 'chat:cancel') {
      clearTimers(); waiting.clear();
      const sessionId = args[0]?.sessionId;
      // same as the server's endRunningTasks: the turn's CLI is gone, so nothing it spawned survives
      for (const t of demoTasks.get(sessionId) || []) {
        if (t.status === 'running' || t.status === 'pending' || t.status === 'paused') taskUpsert(sessionId, t.id, { status: 'stopped', background: false, endedAt: Date.now() });
      }
      deliver('turn:error', { sessionId, aborted: true });
      return sock;
    }
    return sock; // session:leave and anything else → no-op
  },
};

export function getDemoSocket() { return sock as any; }
