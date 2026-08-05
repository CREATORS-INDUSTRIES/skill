'use strict';

// The run template -> argv. A run says two things: where each argv word ends,
// and where a param goes. Nothing else -- there is no quoting to learn and
// nothing is stripped from what was written.

const assert = require('assert');
const { SkillError, parseSkill, resolve } = require('..');

// A skill built around one run template, so a case is one string.
function toolWith(run, params = 'text:\n    type: string\n    default: x') {
  return parseSkill(
    `---\nskill: t\n---\n\n\`\`\`tool\nid: t\ndescription: d\nparams:\n  ${params}\nrun: ${run}\n\`\`\`\n`,
  ).tools[0];
}
const argv = (run, args = {}) => resolve([toolWith(run)], { tool: 't', args }).argv;

// 1. Whitespace ends a word, and values substitute inside their word.
assert.deepStrictEqual(argv('ls -lAh -- $text', { text: '/tmp' }), ['ls', '-lAh', '--', '/tmp']);
assert.deepStrictEqual(argv('cmd --flag=$text', { text: 'v' }), ['cmd', '--flag=v']);

// 2. Quotes are ordinary characters. A run carries other languages -- python,
// awk, sed -- and their quotes belong to them, not to this format.
assert.deepStrictEqual(argv("python -c print('hi')", {}), ['python', '-c', "print('hi')"]);
assert.deepStrictEqual(argv('cmd "$text"', { text: 'v' }), ['cmd', '"v"']);

// 3. So are the shell's metacharacters. Nothing here pipes, redirects, chains
// or globs: they are just characters in an argv word.
assert.deepStrictEqual(argv('cmd a|b >c ;d `e` *.txt', {}), ['cmd', 'a|b', '>c', ';d', '`e`', '*.txt']);

// 4. `$$` is a literal dollar -- the one escape there has to be, because
// otherwise a `$0` in an awk program reads as a param named `0`. A `$` in
// front of anything that cannot be a param name is just a dollar.
assert.deepStrictEqual(argv('grep -e $$0 $text', { text: 'f' }), ['grep', '-e', '$0', 'f']);
assert.deepStrictEqual(argv('grep -e $@ $text', { text: 'f' }), ['grep', '-e', '$@', 'f']);

// 5. A value never splits its word, whatever it holds. That is the whole
// safety property.
assert.deepStrictEqual(argv('ls $text', { text: 'a b; rm -rf /' }), ['ls', 'a b; rm -rf /']);
assert.deepStrictEqual(argv('ls $text', { text: '$(id)' }), ['ls', '$(id)']);

// 6. When a word has to hold a space, the run is a list and each item is
// exactly one word, verbatim. This is the only way to write an awk or sed
// program, and it needs no escaping at all.
const listed = parseSkill(
  [
    '---',
    'skill: t',
    '---',
    '',
    '```tool',
    'id: read',
    'description: read a stretch of a file',
    'params:',
    '  file:',
    '    type: string',
    '  from:',
    '    type: integer',
    '    default: 1',
    'run:',
    '  - awk',
    '  - -v',
    '  - f=$file',
    '  - -v',
    '  - a=$from',
    '  - BEGIN{while((getline l<f)>0){n++; if(n>=a) print n": "l}}',
    '```',
    '',
  ].join('\n'),
).tools[0];

assert.deepStrictEqual(listed.run, [
  'awk',
  '-v',
  'f=$file',
  '-v',
  'a=$from',
  'BEGIN{while((getline l<f)>0){n++; if(n>=a) print n": "l}}',
]);

const call = resolve([listed], { tool: 'read', args: { file: '/tmp/x', from: 3 } });
assert.deepStrictEqual(call.argv, [
  'awk',
  '-v',
  'f=/tmp/x',
  '-v',
  'a=3',
  'BEGIN{while((getline l<f)>0){n++; if(n>=a) print n": "l}}',
]);
assert.strictEqual(call.argv[5].includes(' '), true, 'a list item keeps its spaces');

// 7. A path that looks like a flag is still one word, wherever it lands.
const dashed = resolve([listed], { tool: 'read', args: { file: '-R' } });
assert.strictEqual(dashed.argv[2], 'f=-R');

// 8. An empty run is an error, in either form.
assert.throws(() => toolWith('   '), (e) => e instanceof SkillError && /missing 'run'/.test(e.message));

// 9. A `$name` that was never declared is a parse error. Before, a typo in a
// run template survived parsing and only surfaced the first time a model
// called the tool.
assert.throws(
  () => toolWith('ls $txet'),
  (e) => e instanceof SkillError && /run references \$txet, which is not a declared param \(declared: text\)/.test(e.message),
);

// 10. A tool with no params still runs, and the error names that it has none.
assert.deepStrictEqual(
  resolve([parseSkill('---\nskill: t\n---\n\n```tool\nid: t\ndescription: d\nrun: uptime\n```\n').tools[0]], { tool: 't' }).argv,
  ['uptime'],
);
assert.throws(
  () => parseSkill('---\nskill: t\n---\n\n```tool\nid: t\ndescription: d\nrun: ls $dir\n```\n'),
  (e) => e instanceof SkillError && /\(declared: none\)/.test(e.message),
);

console.log('argv ok');
