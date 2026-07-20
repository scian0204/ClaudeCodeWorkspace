import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  dataDir: path.resolve(env.DATA_DIR || './data'),
  sessionSecret: env.SESSION_SECRET || 'change-me-please',
  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  // mock when no key OR explicitly forced — keeps the app fully runnable w/o a key
  mockClaude: env.MOCK_CLAUDE === '1' || !env.ANTHROPIC_API_KEY,
  claudeCodePath: env.CLAUDE_CODE_PATH || '',
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
