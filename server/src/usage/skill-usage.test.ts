// Runnable check (no framework): npx tsx server/src/usage/skill-usage.test.ts
// Covers the two halves of skill counting that have no DB in them: what a turn counts as a skill
// invocation, and the key both spellings collapse to when matched against a plugin's skills.
import assert from 'node:assert';
import { turnSkillKeys } from './tracker.js';
import { skillKey } from '../plugins/manager.js';

const tool = (name: string, input: any) => ({ type: 'tool_use', name, input });

// prompt IS the slash command (what the composer's palette sends) → counted, args stripped
assert.deepEqual(turnSkillKeys('/caveman:caveman-stats --share', []), ['caveman:caveman-stats']);
// leading whitespace still counts; a mid-text slash does not (that's prose, not a command)
assert.deepEqual(turnSkillKeys('  /brainstorming', []), ['brainstorming']);
assert.deepEqual(turnSkillKeys('use the /brainstorming skill', []), []);
// model-side invocations: the Skill tool and an explicit SlashCommand call
assert.deepEqual(turnSkillKeys('hi', [tool('Skill', { skill: 'superpowers:brainstorming' })]), ['superpowers:brainstorming']);
assert.deepEqual(turnSkillKeys('hi', [tool('SlashCommand', { command: '/pr create' })]), ['pr']);
// other tools and text blocks are ignored; repeats count twice (one row bump each)
assert.deepEqual(
  turnSkillKeys('/tdd', [{ type: 'text', text: 'x' }, tool('Bash', { command: 'ls' }), tool('Skill', { skill: 'tdd' })]),
  ['tdd', 'tdd'],
);
// malformed input never throws or produces an empty key
assert.deepEqual(turnSkillKeys('/', [tool('Skill', {}), tool('Skill', { skill: null })]), []);

// all three spellings of the same skill collapse to one key (namespaced, bare, plugin sub-path)
assert.equal(skillKey('caveman:caveman-stats'), skillKey('caveman-stats'));
assert.equal(skillKey('my-plugin/review'), skillKey('review'));
assert.equal(skillKey('Superpowers:Brainstorming'), 'brainstorming');
// distinct skills stay distinct
assert.notEqual(skillKey('a:review'), skillKey('a:summarize'));

console.log('skill-usage: ok');
