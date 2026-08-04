// HTTP surface of the floating guide assistant.
//
// A turn is fire-and-forget: the POST returns as soon as the turn is accepted and everything after
// that (deltas, tool cards, the final message, UI actions) streams over the socket to `user:<id>`,
// so every tab the user has open stays in step — same pattern the chat sessions use.
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/index.js';
import { cfg } from '../lib/config-registry.js';
import { emitToUser } from '../realtime/io.js';
import { runGuideTurn, guideHistory, clearGuide, interruptGuide, guideBusy } from '../guide/agent.js';

// Interface languages the client can report. Only used to tell the agent which language to answer
// in, so an unknown value falls back to the team default rather than being an error.
const LANGS = ['ko', 'en'];

export async function guideRoutes(app: FastifyInstance) {
  // off = the whole feature is gone, not merely hidden (the UI also hides itself, via /api/config)
  const enabled = (reply: any) => {
    if (cfg.bool('guideEnabled')) return true;
    reply.code(404).send({ error: 'guide assistant is disabled' });
    return false;
  };

  app.get('/api/guide/messages', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!enabled(reply)) return;
    return { messages: guideHistory(u.id, cfg.int('guideHistoryMax')), busy: guideBusy(u.id) };
  });

  app.post('/api/guide/message', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!enabled(reply)) return;
    const b = (req.body || {}) as any;
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (!text) return reply.code(400).send({ error: 'empty' });
    if (text.length > cfg.int('guideMaxInputChars')) return reply.code(400).send({ error: 'message too long' });
    if (guideBusy(u.id)) return reply.code(409).send({ error: 'a guide turn is already running' });
    const lang = LANGS.includes(b.lang) ? String(b.lang) : LANGS[0];
    // The cookie header is replayed by the agent's `api` tool so the routes it calls see this exact
    // session. Nothing else about the request is forwarded.
    const cookie = req.headers.cookie || '';
    void runGuideTurn({
      app, user: u, cookie, text, lang,
      emit: (event, payload) => emitToUser(u.id, event, payload),
    }).catch((e) => emitToUser(u.id, 'guide:error', { aborted: false, error: String(e?.message || e) }));
    return { ok: true };
  });

  app.post('/api/guide/interrupt', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!enabled(reply)) return;
    return { ok: interruptGuide(u.id) };
  });

  app.delete('/api/guide/messages', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!enabled(reply)) return;
    interruptGuide(u.id); // a running turn would otherwise write its answer into the fresh thread
    clearGuide(u.id);
    emitToUser(u.id, 'guide:cleared', {});
    return { ok: true };
  });
}
