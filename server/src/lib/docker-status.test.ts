// Runnable check: npx vitest run server/src/lib/docker-status.test.ts
import { describe, it, expect } from 'vitest';
import { classifyDockerError } from './docker-status.js';

// The reason is what the admin banner shows, and it is the only thing telling an operator whether to
// mount the socket, fix permissions, or start the daemon — so each shape gets pinned.
describe('classifyDockerError', () => {
  it('reads a missing socket from the errno, the message, or Windows wording', () => {
    expect(classifyDockerError({ code: 'ENOENT' })).toBe('socket-missing');
    expect(classifyDockerError(new Error('connect ENOENT /var/run/docker.sock'))).toBe('socket-missing');
    expect(classifyDockerError(new Error('The system cannot find the file specified.'))).toBe('socket-missing');
  });
  it('separates a permission problem from an absent socket', () => {
    expect(classifyDockerError({ code: 'EACCES' })).toBe('denied');
    expect(classifyDockerError(new Error('permission denied while trying to connect'))).toBe('denied');
  });
  it('falls back to unreachable for a dead daemon or a timeout', () => {
    expect(classifyDockerError({ code: 'ECONNREFUSED' })).toBe('unreachable');
    expect(classifyDockerError({ code: 'ETIMEDOUT', message: 'docker ping timed out' })).toBe('unreachable');
    expect(classifyDockerError(undefined)).toBe('unreachable');
  });
});
