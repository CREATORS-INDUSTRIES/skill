'use strict';

// `includes:` -- what a skill carries beside its own text. Built on real
// directories in a temp dir, because the whole point of the field is what the
// filesystem says is there: an entry is a file or a directory because it IS
// one, never because of how its name is spelled.

const assert = require('assert');
const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const { SkillError, parseSkill, parseSkillFile, includedFiles } = require('..');

const FM = (includes) =>
  `---\nskill: t\ndescription: d\nincludes: ${includes}\n---\n\n\`\`\`tool\nid: run\nrun: uv run handle.py\n\`\`\`\n`;

// A skill directory: SKILL.md, a script beside it, a directory of queries, and
// a file with no extension -- which is a file, like any other.
function fixture(includes) {
  const dir = mkdtempSync(join(tmpdir(), 'skill-includes-'));
  writeFileSync(join(dir, 'SKILL.md'), FM(includes));
  writeFileSync(join(dir, 'handle.py'), 'print("hi")\n');
  writeFileSync(join(dir, 'Makefile'), 'all:\n');
  mkdirSync(join(dir, 'queries', 'nested'), { recursive: true });
  writeFileSync(join(dir, 'queries', 'signups.sql'), 'select 1;\n');
  writeFileSync(join(dir, 'queries', 'nested', 'deep.sql'), 'select 2;\n');
  return dir;
}

// 1. Declared as written, whitespace and trailing slashes off. The skill knows
// its own directory, which is what an include is relative to.
const dir = fixture('handle.py , queries/ ,Makefile');
const skill = parseSkillFile(join(dir, 'SKILL.md'));
assert.deepStrictEqual(skill.includes, ['handle.py', 'queries', 'Makefile']);
assert.strictEqual(skill.workdir, dir);
assert.strictEqual(skill.file, join(dir, 'SKILL.md'));

// 2. Expanded: a file is itself, a directory is everything under it however
// deep, sorted, forward slashes everywhere.
assert.deepStrictEqual(includedFiles(skill), [
  'Makefile',
  'handle.py',
  'queries/nested/deep.sql',
  'queries/signups.sql',
]);

// 3. No `includes:` is no includes -- and nothing to move.
const bare = parseSkillFile(join(fixture('handle.py'), 'SKILL.md'));
const plain = parseSkill('```tool\nid: t\nrun: echo hi\n```');
assert.deepStrictEqual(plain.includes, []);
assert.deepStrictEqual(includedFiles(plain), []);
assert.ok(bare.includes.length === 1, 'fixture still declares its script');

// 4. A declared include that is not there is a broken skill, and it breaks
// when the file is read -- not the first time a model calls the tool.
const missing = mkdtempSync(join(tmpdir(), 'skill-includes-'));
writeFileSync(join(missing, 'SKILL.md'), FM('handle.py'));
assert.throws(
  () => parseSkillFile(join(missing, 'SKILL.md')),
  (err) => err instanceof SkillError && /include 'handle.py' is declared but not in /.test(err.message),
);

// 5. An include names something inside the skill, and only that: a skill that
// reaches outside its directory is a skill that cannot travel.
for (const bad of ['/etc/passwd', '../secrets.env', '~/notes.txt', 'a/../../b', './x']) {
  assert.throws(
    () => parseSkill(FM(bad)),
    (err) => err instanceof SkillError && /must (be relative to|stay inside)/.test(err.message),
    `include '${bad}' should be refused`,
  );
}
assert.throws(() => parseSkill(FM('a, a')), /duplicate include 'a'/);

// 6. A symlink is refused rather than followed, at the top level and inside a
// declared directory: what it points at is not part of the skill.
const linked = fixture('link.py');
symlinkSync(join(linked, 'handle.py'), join(linked, 'link.py'));
assert.throws(() => parseSkillFile(join(linked, 'SKILL.md')), /include 'link.py' is a symlink/);

const inside = fixture('queries');
symlinkSync(join(inside, 'handle.py'), join(inside, 'queries', 'link.py'));
assert.throws(
  () => parseSkillFile(join(inside, 'SKILL.md')),
  /include 'queries\/link.py' is a symlink/,
);

console.log('includes ok');
