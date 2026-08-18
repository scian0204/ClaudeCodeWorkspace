// Runnable check: npx vitest run server/src/claude/prompt.test.ts
import { describe, it, expect } from 'vitest';
import { composePrompt, isSlashCommand } from './prompt.js';

const ATT = [{ abs: '/data/att/shot.png', isImage: true }];
const CHAT = [{ name: '민수', text: '배포 언제?' }];

// The bug: a room prefixed every prompt with the speaker's name, which pushed the "/" off the front —
// so the CLI stopped seeing a command at all and the model answered it as prose.
describe('a slash command reaches the CLI undecorated', () => {
  it('sends the command as typed in a room', () => {
    expect(composePrompt({ text: '/clear', kind: 'room', authorName: '지훈' })).toBe('/clear');
  });

  it('sends it as typed even with attachments and chat catch-up in play', () => {
    const out = composePrompt({
      text: '/compact 다국어 관련', kind: 'room', authorName: '지훈', contextChat: CHAT, attachments: ATT,
    });
    expect(out).toBe('/compact 다국어 관련');
  });

  it('leaves a personal-session command alone too', () => {
    expect(composePrompt({ text: '/context', kind: 'user', authorName: '지훈', attachments: ATT })).toBe('/context');
  });

  it('only treats a leading slash as a command — the CLI does the same', () => {
    expect(isSlashCommand('/clear')).toBe(true);
    expect(isSlashCommand('run /clear later')).toBe(false);
    expect(isSlashCommand('')).toBe(false);
  });
});

// Ordinary messages must keep every decoration they had before the fix.
describe('an ordinary message still carries its context', () => {
  it('names the speaker in a room', () => {
    expect(composePrompt({ text: '빌드 깨졌어', kind: 'room', authorName: '지훈' })).toBe('[지훈]: 빌드 깨졌어');
  });

  it('leaves a personal message bare', () => {
    expect(composePrompt({ text: '빌드 깨졌어', kind: 'user', authorName: '지훈' })).toBe('빌드 깨졌어');
  });

  it('prepends the chat catch-up and the attachment paths', () => {
    const out = composePrompt({
      text: '이거 봐줘', kind: 'room', authorName: '지훈', contextChat: CHAT, attachments: ATT,
    });
    expect(out).toBe('[첨부 파일]\n- /data/att/shot.png (이미지)\n\n[이전 대화]\n[민수]: 배포 언제?\n\n[지훈]: 이거 봐줘');
  });

  it('marks a non-image attachment without the image note', () => {
    const out = composePrompt({
      text: '로그 확인', kind: 'user', authorName: '지훈', attachments: [{ abs: '/data/att/app.log', isImage: false }],
    });
    expect(out).toBe('[첨부 파일]\n- /data/att/app.log\n\n로그 확인');
  });
});
