// Runnable check (no framework): npx tsx server/src/review/classify.test.ts
import assert from 'node:assert';
import { hasSourceChange } from './classify.js';

// docs / assets only → not a source change → pipeline skips merge+build+run
assert.equal(hasSourceChange(['README.md', 'docs/guide.md', 'LICENSE', 'ui/logo.svg']), false);
// nested + mixed-case extensions still classified as non-source
assert.equal(hasSourceChange(['a/b/NOTES.MD', 'img/pic.PNG']), false);
// any code file present → source change → full pipeline
assert.equal(hasSourceChange(['README.md', 'server/src/app.ts']), true);
// config/style count as source (conservative: a build may depend on them)
assert.equal(hasSourceChange(['package.json']), true);
assert.equal(hasSourceChange(['src/style.css']), true);
// empty list is not a source change (caller separately requires files.length > 0 to skip)
assert.equal(hasSourceChange([]), false);

console.log('classify: ok');
