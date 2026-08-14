// Runnable check: npx vitest run server/src/auth/claude-login.test.ts
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect } from 'vitest';

// DATA_DIR must be set before anything imports config.ts (paths.ts reads it at module load).
const DATA = path.join(os.tmpdir(), 'ccw-login-test');
process.env.DATA_DIR = DATA;

const { credentialEnv, COMMON } = await import('./claude-login.js');

// A turn runs with the HOME of whoever OWNS the session — for a room session that is the room, not
// the person typing. The CLI then looks for .credentials.json under that HOME and reports "Not logged
// in · Please run /login" for a user who is signed in. So the store must be named explicitly, for
// every scope, not just the shared account.
describe('credentialEnv', () => {
  it('points a signed-in user at their own credential store', () => {
    expect(credentialEnv('u1')).toEqual({
      CLAUDE_SECURESTORAGE_CONFIG_DIR: path.join(DATA, 'users', 'u1', '.claude'),
    });
  });
  it('points the shared account at the common store', () => {
    expect(credentialEnv(COMMON)).toEqual({
      CLAUDE_SECURESTORAGE_CONFIG_DIR: path.join(DATA, 'common', '.claude'),
    });
  });
  it('never returns an empty env — that is what left room turns unauthenticated', () => {
    expect(Object.keys(credentialEnv('u1'))).toHaveLength(1);
  });
});
