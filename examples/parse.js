'use strict';

// Parse a skill file and show it in four sections: the skill header, what it
// carries beside its own text, each tool with its params, and the compiled
// skill -- the system text as the model receives it, with every tool fence
// interpolated down to its id.
//
//   node examples/parse.js                # bundled examples/SKILL.md
//   node examples/parse.js path/SKILL.md  # your own skill

const { join } = require('path');
const { parseSkillFile, compile, includedFiles } = require('..');

const file = process.argv[2] || join(__dirname, 'SKILL.md');

// Colors only on a TTY, and NO_COLOR wins.
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const bold = (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const gray = (s) => (tty ? `\x1b[90m${s}\x1b[0m` : s);
const cyan = (s) => (tty ? `\x1b[36m${s}\x1b[0m` : s);

// A labeled horizontal rule: `── label ───────────────...`, sized to the
// terminal: tty width, else the COLUMNS convention, else 74. Capped so
// ultra-wide windows don't get kilometer-long rules.
const WIDTH = Math.min(process.stdout.columns || Number(process.env.COLUMNS) || 74, 100);
function section(label) {
  const rule = '─'.repeat(Math.max(0, WIDTH - label.length - 4));
  console.log();
  console.log(`${gray('──')} ${bold(label)} ${gray(rule)}`);
  console.log();
}

let skill;
try {
  skill = parseSkillFile(file);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

section('skill');
console.log(`${bold(skill.name || '(unnamed)')} ${gray(`${skill.tools.length} tools`)}`);
if (skill.description) console.log(skill.description);

// What the skill carries: the entries as declared, then the files they
// actually resolve to -- a directory is everything under it. This is the list
// that has to travel with the skill for its tools to run anywhere else.
if (skill.includes.length > 0) {
  section('includes');
  console.log(skill.includes.join(', '));
  for (const path of includedFiles(skill)) console.log(gray(`  ${path}`));
}

section('tools');
skill.tools.forEach((tool, i) => {
  if (i > 0) console.log();
  console.log(cyan(bold(tool.id)));
  console.log(tool.description);
  // Params straight from the tool's JSON Schema, one per line: name, type
  // (enum values, or type plus its format annotation), default; description
  // on its own line below.
  const params = Object.entries(tool.schema.properties);
  const label = ([, p]) =>
    p.enum ? `enum(${p.enum.join(', ')})` : p.format ? `${p.type} ${p.format}` : p.type;
  const nameW = Math.max(0, ...params.map(([name]) => name.length));
  for (const entry of params) {
    const [name, p] = entry;
    const dflt = p.default !== undefined ? `  = ${p.default}` : '';
    console.log(`  ${name.padEnd(nameW)}  ${gray(label(entry))}${dflt}`);
    if (p.description) console.log(`  ${' '.repeat(nameW)}  ${gray(p.description)}`);
  }
});

// The compiled skill: what you send as system text -- the prose with each
// fence interpolated to its tool id, followed by the call protocol.
section('compiled');
console.log(compile(skill));
