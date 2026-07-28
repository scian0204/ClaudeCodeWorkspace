import path from 'node:path';

const env = process.env;

// Bootstrap + static configuration, read once at process start. These are needed before the DB is
// open (paths, cookie/crypto secrets), bind the server (port/host/TLS), run only at first boot
// (bootstrap admin), or are pure Docker-deployment infra — so they stay env-only and are shown
// read-only in the admin panel. Every runtime-tunable value lives in the config registry
// (lib/config-registry.ts) instead: DB-backed, admin-editable, resolved live at each use site.
export const config = {
  port: Number(env.PORT || 3000),
  dataDir: path.resolve(env.DATA_DIR || './data'),
  sessionSecret: env.SESSION_SECRET || 'change-me-please',
  // Legacy/bootstrap shared credential (env fallback). The admin-managed common token (DB) takes
  // precedence; this is only used before an admin sets one. Empty is fine.
  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  // Symmetric key material for encrypting stored tokens at rest (falls back to sessionSecret).
  tokenEncSecret: env.TOKEN_ENC_SECRET || '',
  // Optional TLS. PWA install requires a secure context (browsers only exempt localhost); point
  // these at a browser-trusted cert to serve HTTPS. Empty = plain HTTP.
  tlsKeyPath: env.TLS_KEY || '',
  tlsCertPath: env.TLS_CERT || '',
  bootstrapAdminUser: env.BOOTSTRAP_ADMIN_USER || 'admin',
  bootstrapAdminPassword: env.BOOTSTRAP_ADMIN_PASSWORD || 'admin',
  // Docker deployment infra for the dynamically spawned code-server / review-sandbox siblings
  // (compose sets these; empty disables Docker-backed editors/sandboxes).
  codeServer: {
    network: env.CODE_SERVER_NETWORK || '',
    dataVolume: env.DATA_VOLUME || '',
  },
  isProd: env.NODE_ENV === 'production',
};

export type AppConfig = typeof config;
