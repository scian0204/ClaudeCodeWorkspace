import { describe, it, expect } from 'vitest';
import { parseRef, cmpSemver, newestSemver, recreateSpec, demuxLogs } from './self-update.js';

// Pure helpers only — importing the module is safe because `db` is assigned in initDb(), so nothing
// here opens a database.

describe('parseRef', () => {
  it('splits our own image ref', () => {
    expect(parseRef('cian0204/claudecode-workspace:latest'))
      .toEqual({ registry: '', repo: 'cian0204/claudecode-workspace', tag: 'latest', hub: true });
  });
  it('defaults a missing tag to latest and namespaces official images', () => {
    expect(parseRef('node')).toMatchObject({ repo: 'library/node', tag: 'latest', hub: true });
  });
  it('keeps a registry host with a port out of the tag', () => {
    expect(parseRef('registry.example.com:5000/team/app:1.2.3'))
      .toEqual({ registry: 'registry.example.com:5000', repo: 'team/app', tag: '1.2.3', hub: false });
  });
  it('ignores a digest suffix', () => {
    expect(parseRef('cian0204/claudecode-workspace:1.8.0@sha256:abc')).toMatchObject({ tag: '1.8.0' });
  });
  it('reports no repo for a bare image id (a rollback recreated by id)', () => {
    expect(parseRef('sha256:2bed35fc850bd38071a5a9c5eda3009550f81ae4')).toMatchObject({ repo: '', hub: false });
  });
});

describe('semver tags', () => {
  it('orders numerically, not lexically', () => {
    expect(cmpSemver('1.10.0', '1.9.0')).toBe(1);
    expect(cmpSemver('1.8.0', '1.8.0')).toBe(0);
  });
  it('picks the newest release tag and ignores non-version tags', () => {
    expect(newestSemver(['latest', '1.8.0', 'sha-abc1234', '1.10.2', '1.9.9'])).toBe('1.10.2');
    expect(newestSemver(['latest', 'sha-abc1234'])).toBe(null);
  });
});

describe('demuxLogs', () => {
  const frame = (stream: number, s: string) => {
    const body = Buffer.from(s, 'utf8');
    const head = Buffer.alloc(8);
    head[0] = stream;
    head.writeUInt32BE(body.length, 4);
    return Buffer.concat([head, body]);
  };
  it('drops the frame headers, including a payload length that is printable ASCII', () => {
    // length 44 = 0x2c = ',' — the old control-char scrub left this byte in the text
    const line = 'x'.repeat(44);
    expect(demuxLogs(Buffer.concat([frame(1, line), frame(2, 'err\n')]))).toBe(`${line}err\n`);
  });
  it('passes unframed (TTY) output through untouched', () => {
    expect(demuxLogs(Buffer.from('plain log line\n'))).toBe('plain log line\n');
  });
});

describe('recreateSpec', () => {
  const info = (over: any = {}) => ({
    Id: 'abcdef0123456789',
    Config: { Hostname: 'abcdef012345', Env: ['PORT=3000'], Labels: { a: '1' }, Image: 'repo/app:latest', Cmd: ['npm', 'start'], ...over.Config },
    HostConfig: { PortBindings: { '3000/tcp': [{ HostPort: '3000' }] }, RestartPolicy: { Name: 'unless-stopped' } },
    NetworkSettings: { Networks: { claudecode_internal: { Aliases: ['abcdef012345', 'app'] } } },
    ...over,
  }) as any;

  it('carries env/ports/labels over and drops the auto hostname (it is the OLD container id)', () => {
    const s = recreateSpec(info());
    expect(s.Env).toEqual(['PORT=3000']);
    expect(s.HostConfig.PortBindings['3000/tcp'][0].HostPort).toBe('3000');
    expect(s.Hostname).toBeUndefined();
  });
  it('keeps an explicitly set hostname', () => {
    expect(recreateSpec(info({ Config: { Hostname: 'my-app' } })).Hostname).toBe('my-app');
  });
  it('reattaches networks without the stale short-id alias', () => {
    expect(recreateSpec(info()).NetworkingConfig.EndpointsConfig.claudecode_internal.Aliases).toEqual(['app']);
  });
  it('drops an inherited Cmd so the NEW image\'s CMD applies', () => {
    const s = recreateSpec(info(), { Cmd: ['npm', 'start'] });
    expect('Cmd' in s).toBe(false);
  });
  it('keeps a Cmd the deploy actually overrode', () => {
    const s = recreateSpec(info(), { Cmd: ['node', 'other.js'] });
    expect(s.Cmd).toEqual(['npm', 'start']);
  });
  it('copies Cmd when the old image config is unavailable', () => {
    expect(recreateSpec(info()).Cmd).toEqual(['npm', 'start']);
  });
});
