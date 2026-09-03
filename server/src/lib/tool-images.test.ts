// Runnable check (no framework): npx tsx server/src/lib/tool-images.test.ts
import assert from 'node:assert/strict';
import { splitToolResult, imageExt } from './tool-images.js';

const px = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');

// plain string → unchanged, no images
assert.deepEqual(splitToolResult('exit=0\nok'), { text: 'exit=0\nok', images: [] });

// the CLI's normalised shape: text blocks + an Anthropic-style image source
const r = splitToolResult([
  { type: 'text', text: '### Page\n- URL: http://x' },
  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: px } },
  { type: 'text', text: 'done' },
]);
assert.equal(r.text, '### Page\n- URL: http://x\ndone', 'text blocks joined, image block removed from text');
assert.equal(r.images.length, 1);
assert.equal(r.images[0].mime, 'image/jpeg');
assert.equal(r.images[0].data.toString('base64'), px, 'base64 decoded to bytes');

// MCP's raw block shape is accepted too
assert.equal(splitToolResult([{ type: 'image', data: px, mimeType: 'image/png' }]).images[0].mime, 'image/png');

// an image with a mime we do not serve stays in the text as a stub instead of vanishing
const odd = splitToolResult([{ type: 'image', data: px, mimeType: 'image/bmp' }]);
assert.equal(odd.images.length, 0);
assert.ok(odd.text.includes('image/bmp'));

// non-array objects are stringified (the old behaviour for anything unexpected)
assert.equal(splitToolResult({ a: 1 }).text, '{"a":1}');
assert.equal(splitToolResult(undefined).text, '');

assert.equal(imageExt('image/jpeg'), 'jpeg');
assert.equal(imageExt('text/plain'), null);

console.log('tool-images: ok');
