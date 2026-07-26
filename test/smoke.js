'use strict';

// Smoke test over test/SKILL.md -- a real skill file on disk, so a failing
// case can be debugged by opening the fixture, editing it, and re-running
// (`node test/smoke.js`, or `node examples/parse.js test/SKILL.md`).

const assert = require('assert');
const { join } = require('path');
const { SkillError, parseSkill, parseSkillFile, compile, resolve } = require('..');

const FIXTURE = join(__dirname, 'SKILL.md');

// 1. Parse the fixture: frontmatter, spec catalog, workdir.
const skill = parseSkillFile(FIXTURE);
assert.strictEqual(skill.name, 'waitlist');
assert.strictEqual(
  skill.description,
  'Manage the product waitlist - accept, revoke and inspect signups.',
);
assert.deepStrictEqual(skill.tools.map((s) => s.id), ['access', 'stats']);
assert.strictEqual(skill.tools[0].workdir, __dirname);

// 2. The access tool: `schema` IS valid JSON Schema, built at parse time
// (no separate lowering step; a param with no default is required).
const access = skill.tools[0];
assert.deepStrictEqual(access.schema, {
  type: 'object',
  properties: {
    operation: {
      type: 'string',
      enum: ['accept', 'reject'],
      description: 'action to perform',
      default: 'accept',
    },
    user: { type: 'string', format: 'email', description: 'email of the user' },
  },
  required: ['user'],
});
assert.strictEqual(access.run, 'echo --$operation $user');

// 3. The stats tool: no params; comments/blank lines in the fence are ignored.
const stats = skill.tools[1];
assert.deepStrictEqual(stats.schema, { type: 'object', properties: {} });
assert.strictEqual(stats.run, 'echo stats');

// 4. The compiled template: fences collapse to their ids, all else survives,
// and the frontmatter (already parsed to name/description) never reaches it.
assert.ok(skill.rendered.includes('\naccess\n'), 'tool fence should render as its id');
assert.ok(skill.rendered.includes('\nstats\n'), 'tool fence should render as its id');
assert.ok(!skill.rendered.includes('run:'), 'fence bodies must not leak into prose');
assert.ok(skill.rendered.includes('```bash'), 'non-tool fences must pass through');
assert.ok(skill.rendered.includes('not a tool, just documentation'));
assert.ok(skill.rendered.includes('Prefer accepting users'));
assert.ok(!skill.rendered.includes('skill: waitlist'), 'frontmatter must not leak into prose');
assert.ok(!skill.rendered.startsWith('---'), 'frontmatter must be stripped');

// 5. Custom formats pass through untouched (format is an open annotation
// vocabulary in JSON Schema 2020-12).
const iban = parseSkill(
  '```tool\nid: t\nparams:\n  x:\n    type: string\n    format: iban\nrun: echo $x\n```',
).tools[0];
assert.deepStrictEqual(iban.schema, {
  type: 'object',
  properties: { x: { type: 'string', format: 'iban' } },
  required: ['x'],
});

// 6. resolve: a model's raw output resolves to the declared tool call.
// Bare JSON, fenced, or embedded in prose all work; prose alone is null.
const bare = resolve(skill.tools, '{"tool": "access", "args": {"operation": "reject", "user": "x@y.z"}}');
assert.strictEqual(bare.tool.id, 'access');
assert.deepStrictEqual(bare.args, { operation: 'reject', user: 'x@y.z' });
assert.deepStrictEqual(bare.argv, ['echo', '--reject', 'x@y.z']);

const fenced = resolve(
  skill.tools,
  'I will use the access tool.\n```json\n{"tool": "access", "args": {"user": "a@b.c"}}\n```\nDone.',
);
assert.deepStrictEqual(fenced.args, { operation: 'accept', user: 'a@b.c' }, 'default fills the hole');

const embedded = resolve(skill.tools, 'Sure: {"tool": "stats"} coming up.');
assert.strictEqual(embedded.tool.id, 'stats');
assert.deepStrictEqual(embedded.argv, ['echo', 'stats']);

assert.strictEqual(resolve(skill.tools, 'The waitlist has 12 people.'), null);
assert.strictEqual(resolve(skill.tools, 'Counts: {"total": 12}'), null, 'JSON without tool key is content');

// Errors name the problem so the host can feed them back to the model.
assert.throws(() => resolve(skill.tools, '{"tool": "purge"}'), /unknown tool 'purge'.*access, stats/);
assert.throws(() => resolve(skill.tools, '{"tool": "access"}'), /missing required arg 'user'/);
assert.throws(
  () => resolve(skill.tools, '{"tool": "access", "args": {"user": "a@b.c", "extra": 1}}'),
  /unknown arg 'extra'/,
);
assert.throws(
  () => resolve(skill.tools, '{"tool": "access", "args": {"operation": "purge", "user": "a@b.c"}}'),
  /must be one of: accept, reject/,
);

// Coercion: models quote primitives; outcomes are strict.
const typed = parseSkill(
  '```tool\nid: t\nparams:\n  n:\n    type: integer\n  ok:\n    type: boolean\nrun: echo $n $ok\n```',
).tools;
const coerced = resolve(typed, '{"tool": "t", "args": {"n": "3", "ok": "true"}}');
assert.deepStrictEqual(coerced.args, { n: 3, ok: true });
assert.throws(() => resolve(typed, '{"tool": "t", "args": {"n": "3.5", "ok": true}}'), /must be integer/);
assert.throws(() => resolve(typed, '{"tool": "t", "args": {"n": 1, "ok": "yes"}}'), /must be boolean/);

// 7. compile: prose first, then the call protocol. The catalog is the SAME
// JSON Schema the SDK path uses -- one format everywhere.
const compiled = compile(skill);
assert.ok(compiled.startsWith('This skill manages'), 'prose leads');
assert.ok(compiled.includes('{"tool": "<name>", "args": {"<param>": <value>}}'));
const catalog = JSON.parse(compiled.slice(compiled.indexOf('['), compiled.lastIndexOf(']') + 1));
assert.deepStrictEqual(
  catalog,
  skill.tools.map((t) => ({ name: t.id, description: t.description, input_schema: t.schema })),
  'catalog is the tools verbatim, as JSON Schema',
);
assert.ok(!compiled.includes('final answer'), 'no loop semantics: the package only compiles system');
// Round-trip: an answer following the compiled contract resolves cleanly.
const followed = resolve(skill.tools, '{"tool": "access", "args": {"user": "a@b.c"}}');
assert.strictEqual(followed.tool.id, 'access');

// 8. resolve also takes an ALREADY-STRUCTURED call (an SDK's native
// tool-calling output) -- same validation, same argv, no text parsing.
const structured = resolve(skill.tools, { tool: 'access', args: { user: 'x@y.z' } });
assert.deepStrictEqual(structured.args, { operation: 'accept', user: 'x@y.z' });
assert.deepStrictEqual(structured.argv, ['echo', '--accept', 'x@y.z']);
assert.throws(() => resolve(skill.tools, { tool: 'access' }), /missing required arg 'user'/);
assert.throws(() => resolve(skill.tools, { args: {} }), /string "tool" property/);

// 9. Errors: each bad shape throws SkillError, never a silent guess.
assert.throws(() => parseSkill('```tool\ndescription: x\nrun: y\n```'), /missing 'id'/);
assert.throws(() => parseSkill('```tool\nid: x\n```'), /missing 'run'/);
assert.throws(() => parseSkill('```tool\nid: x\nrun: y\n'), /unterminated/);
assert.throws(() => parseSkill('```tool\n???\n```'), /bad line/);
assert.throws(
  () => parseSkill('```tool\nid: a\nrun: x\n```\n```tool\nid: a\nrun: y\n```'),
  /duplicate tool id/,
);
assert.throws(
  () => parseSkill('```tool\nid: t\nparams:\n  x:\n    type: email\nrun: echo $x\n```'),
  /invalid type 'email'.*JSON Schema type/,
);
assert.throws(
  () => parseSkill('```tool\nid: t\nparams:\n  x:\n    type: string\n    kind: email\nrun: echo $x\n```'),
  /unknown key 'kind'/,
);
assert.throws(
  () =>
    parseSkill(
      '```tool\nid: t\nparams:\n  x:\n    type: string\n    enum: a, b\n    default: c\nrun: echo $x\n```',
    ),
  /default 'c' is not one of its enum values/,
);
try {
  parseSkill('```tool\nid: x\n```', { file: '/some/SKILL.md' });
  assert.fail('should have thrown');
} catch (err) {
  assert.ok(err instanceof SkillError);
  assert.strictEqual(err.file, '/some/SKILL.md');
}
assert.throws(() => parseSkillFile(join(__dirname, 'nope.md')), SkillError);

console.log('smoke ok');
