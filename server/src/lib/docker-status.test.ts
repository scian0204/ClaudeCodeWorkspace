// Runnable check: npx vitest run server/src/lib/docker-status.test.ts
import { describe, it, expect } from 'vitest';
import { classifyDockerError, dataDirOnVolume } from './docker-status.js';

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

// Editors mount DATA_VOLUME with a subpath taken from DATA_DIR, so the two must describe the same
// place. The failure this pins is a `docker run -v ccw_data:/data` without DATA_DIR: the app then
// writes to /app/server/data inside the container, the volume stays empty, and the editor mount dies
// on "no such file or directory" while the state is one `docker rm` away from gone.
describe('dataDirOnVolume', () => {
  const vol = { Type: 'volume', Name: 'ccw_data', Destination: '/data' };
  it('accepts the named volume mounted exactly at DATA_DIR', () => {
    expect(dataDirOnVolume([vol], '/data', 'ccw_data')).toBe(true);
  });
  it('rejects DATA_DIR left at the in-image default while the volume sits at /data', () => {
    expect(dataDirOnVolume([vol], '/app/server/data', 'ccw_data')).toBe(false);
  });
  it('rejects another volume name, a bind mount, and a parent-only mount', () => {
    expect(dataDirOnVolume([vol], '/data', 'other')).toBe(false);
    expect(dataDirOnVolume([{ Type: 'bind', Name: '', Destination: '/data' }], '/data', 'ccw_data')).toBe(false);
    expect(dataDirOnVolume([vol], '/data/sub', 'ccw_data')).toBe(false);
  });
  it('rejects an empty or missing mount list', () => {
    expect(dataDirOnVolume([], '/data', 'ccw_data')).toBe(false);
    expect(dataDirOnVolume(undefined as any, '/data', 'ccw_data')).toBe(false);
  });
});
