import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  dataDir: path.resolve(env.DATA_DIR || './data'),
  sessionSecret: env.SESSION_SECRET || 'change-me-please',
  // Legacy/bootstrap shared credential. Per-user tokens (DB) take precedence; the
  // admin-managed common token (DB) is the primary shared fallback — this env is only
  // used before an admin sets one. Empty is fine.
  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  // Force mock for every turn regardless of any token (dev). Otherwise mock is decided
  // per-turn: a turn with no resolvable token (user/common/env) runs the echo agent.
  forceMock: env.MOCK_CLAUDE === '1',
  // Symmetric key material for encrypting stored tokens at rest (falls back to sessionSecret).
  tokenEncSecret: env.TOKEN_ENC_SECRET || '',
  claudeCodePath: env.CLAUDE_CODE_PATH || '',
  // Optional TLS. PWA install requires a secure context, and browsers only exempt
  // localhost from that — over http://<ip> the install prompt never appears. Point
  // these at a browser-trusted cert (e.g. mkcert) to serve HTTPS; empty = plain HTTP.
  tlsKeyPath: env.TLS_KEY || '',
  tlsCertPath: env.TLS_CERT || '',
  maxConcurrentTurns: Number(env.MAX_CONCURRENT_TURNS || 3),
  bootstrapAdminUser: env.BOOTSTRAP_ADMIN_USER || 'admin',
  bootstrapAdminPassword: env.BOOTSTRAP_ADMIN_PASSWORD || 'admin',
  codeServer: {
    image: env.CODE_SERVER_IMAGE || 'codercom/code-server:latest',
    idleMs: Number(env.CODE_SERVER_IDLE_MS || 30 * 60 * 1000),
    network: env.CODE_SERVER_NETWORK || '',
    dataVolume: env.DATA_VOLUME || '',
  },
  isProd: env.NODE_ENV === 'production',
};

export type AppConfig = typeof config;
