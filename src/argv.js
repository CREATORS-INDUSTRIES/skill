'use strict';

// The run template -> argv. One scanner, used twice: at parse time to check
// the template is well formed and every `$name` in it was declared, and at
// resolve time to fill it in.
//
// A run says two things: where each argv word ends, and where a param goes.
//
// Words end at whitespace, which is all a command line ever needs -- until a
// word has to hold a space, and then the run is written as a list and each
// item is exactly one word, verbatim:
//
//   run: ls -lAh -- $dir
//   run:
//     - awk
//     - -v
//     - f=$file
//     - BEGIN{while((getline l<f)>0){n++; print n": "l}}
//
// There is no quoting, because quoting would mean a character that sometimes
// groups words and sometimes is just itself, and a run template carries other
// languages -- python, awk, sed -- that spend quotes on their own strings.
// A list has nothing to escape and nothing to strip: what is written is what
// the process receives.
//
// Params are `$name`, substituted inside their word and never splitting it.
// `$$` is a literal dollar, which is the one escape there has to be: without
// it a `$0` in an awk program reads as a param named `0`.

const { SkillError } = require('./error');

const NAME = /[A-Za-z0-9_]/;

/** The argv words of a run, before substitution. */
function words(run, id, file) {
  const where = id ? `tool '${id}': ` : '';
  if (Array.isArray(run)) {
    if (run.length === 0) throw new SkillError(`${where}run is empty`, file);
    return run.map(String);
  }
  const split = String(run).trim().split(/\s+/).filter(Boolean);
  if (split.length === 0) throw new SkillError(`${where}run is empty`, file);
  return split;
}

/**
 * Scan one word into literal and param segments.
 *
 * @returns {Array<{lit?: string, param?: string}>}
 */
function segments(word) {
  const out = [];
  const lit = (text) => {
    const last = out[out.length - 1];
    if (last && last.lit !== undefined) last.lit += text;
    else out.push({ lit: text });
  };

  for (let i = 0; i < word.length; i++) {
    if (word[i] !== '$') {
      lit(word[i]);
      continue;
    }
    if (word[i + 1] === '$') {
      lit('$');
      i++;
      continue;
    }
    let j = i + 1;
    while (j < word.length && NAME.test(word[j])) j++;
    // A `$` in front of anything that cannot be a param name is just a dollar.
    if (j === i + 1) {
      lit('$');
      continue;
    }
    out.push({ param: word.slice(i + 1, j) });
    i = j - 1;
  }

  return out.length ? out : [{ lit: '' }];
}

/**
 * Scan a run template into words, each a list of segments.
 *
 * @param {string|string[]} run the template as written
 * @param {string} [id] tool id, for error messages
 * @param {string} [file] skill path, for error messages
 */
function tokenize(run, id, file) {
  return words(run, id, file).map(segments);
}

/**
 * Check a template at parse time: every param it references was declared. A
 * `$typo` is a broken tool, and a broken tool should be an error when the file
 * is read, not the first time a model happens to call it.
 */
function checkTemplate(run, declared, id, file) {
  const names = new Set(declared);
  for (const word of tokenize(run, id, file)) {
    for (const seg of word) {
      if (seg.param === undefined) continue;
      if (!names.has(seg.param)) {
        const known = [...names].join(', ') || 'none';
        throw new SkillError(
          `tool '${id}': run references $${seg.param}, which is not a declared param (declared: ${known})`,
          file,
        );
      }
    }
  }
}

/**
 * Fill a template in. Values substitute inside their word and never split it,
 * so an argument can never smuggle in extra words, flags or commands.
 */
function renderArgv(run, args, id, file) {
  return tokenize(run, id, file).map((word) =>
    word
      .map((seg) => {
        if (seg.param === undefined) return seg.lit;
        const value = args[seg.param];
        if (value === undefined || value === null) {
          throw new SkillError(`missing value for $${seg.param} in tool '${id}'`, file);
        }
        return typeof value === 'string' ? value : JSON.stringify(value);
      })
      .join(''),
  );
}

/**
 * The programs a skill can spawn: the first word of every `run`, deduplicated
 * and sorted, each with the tools that reach for it.
 *
 * This is knowable without running anything, and that is a property of the
 * format rather than a trick. There is no shell, so the first word of a run is
 * the executable -- it cannot be a function, an alias, an expansion, or a
 * second command hiding behind a `;`. A host can tell you a skill needs `uv`
 * before you approve it, and say which tool will fail if you do not have it.
 *
 * A run whose first word holds a param (`run: $cmd --flag`) has no program
 * until the call is made; it comes back `dynamic`, named as it was written.
 *
 * @param {{tools: object[]}} skill a parsed skill
 * @returns {Array<{name: string, dynamic: boolean, tools: string[]}>}
 */
function programs(skill) {
  const found = new Map();
  for (const tool of (skill && skill.tools) || []) {
    const word = tokenize(tool.run, tool.id)[0];
    const dynamic = word.some((seg) => seg.param !== undefined);
    const name = word.map((seg) => (seg.param === undefined ? seg.lit : `$${seg.param}`)).join('');
    const key = `${dynamic ? '$' : ''}${name}`;
    if (!found.has(key)) found.set(key, { name, dynamic, tools: [] });
    found.get(key).tools.push(tool.id);
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { tokenize, checkTemplate, renderArgv, programs };
