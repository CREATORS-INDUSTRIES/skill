'use strict';

// Parsing: SKILL.md source -> a Skill. Markdown prose for the model plus
// ```tool fences that declare executable tools. The fences are lifted out
// statically -- each becomes a tool whose `schema` is valid JSON Schema, built
// right here at parse time -- and the prose is rendered with every fence
// replaced by its tool's id. The declared set of tools IS the skill's
// contract. Pure: the only I/O is the read in `parseSkillFile` and the
// existence check `includedFiles` does for what the frontmatter declares.

const { readFileSync, lstatSync, readdirSync } = require('fs');
const { dirname, join, relative, sep, isAbsolute, resolve: resolvePath } = require('path');
const { SkillError } = require('./error');
const { checkTemplate } = require('./argv');

/**
 * Read and parse a skill file. Tool `run` templates resolve relative to the
 * file's directory (each tool carries it as `workdir`), and everything the
 * frontmatter `includes:` must be in that directory -- a declared include
 * that is not there throws here, not the first time a tool runs it.
 */
function parseSkillFile(file) {
  const path = resolvePath(file);
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SkillError(err.message, path);
  }
  const skill = parseSkill(source, { file: path, workdir: dirname(path) });
  includedFiles(skill);
  return skill;
}

/**
 * Parse skill source: walk the fenced code blocks, lift every ```tool fence
 * into a tool, and replace it in the prose with the tool's id. Non-tool
 * fences pass through untouched.
 *
 * @param {string} source skill markdown
 * @param {object} [opts]
 * @param {string} [opts.file] path used in error messages
 * @param {string} [opts.workdir] directory tool `run` commands execute from
 * @returns {{ name: string|undefined, description: string|undefined, includes: string[], file: string|null, workdir: string, tools: object[], rendered: string }}
 */
function parseSkill(source, opts) {
  const file = (opts && opts.file) || null;
  const workdir = (opts && opts.workdir) || '.';

  // Frontmatter is metadata, not prose: parse it out (name/description) and
  // strip it from the source so it never reaches the compiled template.
  const fmMatch = String(source).match(/^---\n([\s\S]*?)\n---\n?/);
  const fm = fmMatch ? fmMatch[1] : '';
  const body = fmMatch ? String(source).slice(fmMatch[0].length) : String(source);
  const lines = body.split('\n');

  const tools = [];
  const seen = new Set();
  const rendered = [];
  let fence = null; // { body } while inside a ```tool block

  for (const line of lines) {
    const open = line.match(/^```(\S*)\s*$/);
    if (fence === null && open && open[1] === 'tool') {
      fence = { body: [] };
      continue;
    }
    if (fence !== null) {
      if (/^```\s*$/.test(line)) {
        const tool = parseToolBlock(fence.body, file, workdir);
        if (seen.has(tool.id)) throw new SkillError(`duplicate tool id '${tool.id}'`, file);
        seen.add(tool.id);
        tools.push(tool);
        rendered.push(tool.id);
        fence = null;
      } else {
        fence.body.push(line);
      }
      continue;
    }
    rendered.push(line);
  }
  if (fence !== null) throw new SkillError('unterminated ```tool block', file);

  // Frontmatter keys: `skill:` names the skill, `description:` summarizes it,
  // `includes:` lists what it carries beside its own text.
  const name = (fm.match(/^skill:\s*(.+)$/m) || [])[1];
  const description = (fm.match(/^description:\s*(.+)$/m) || [])[1];
  return {
    name: name && name.trim(),
    description: description && description.trim(),
    includes: parseIncludes(fm, file),
    file,
    workdir,
    tools,
    rendered: rendered.join('\n').trim(),
  };
}

// `includes:` -- what a skill carries beside its own text: the script a tool
// runs, the data it reads. Comma separated, same shape as a param's `enum`,
// each entry a path relative to the skill's directory:
//
//   includes: handle.py, queries, Makefile
//
// An entry is whatever is at that path. Nothing is inferred from its name --
// an extension is not what makes something a file (Makefile, LICENSE), so the
// filesystem answers: a file is that file, a directory is everything under it.
function parseIncludes(fm, file) {
  const raw = (fm.match(/^includes:\s*(.+)$/m) || [])[1];
  if (raw === undefined) return [];
  const names = [];
  for (const entry of raw.split(',')) {
    // A trailing slash is how people write directories; it means nothing here,
    // since what an entry is comes from the filesystem, not from its spelling.
    const name = entry.trim().replace(/\/+$/, '');
    if (!name) continue;
    checkInclude(name, file);
    if (names.includes(name)) throw new SkillError(`duplicate include '${name}'`, file);
    names.push(name);
  }
  return names;
}

// An include names something inside the skill, and only that. A skill is a
// directory that travels -- to another machine, out of a package, off a URL --
// so a path that reaches outside it is a skill that cannot be moved, and an
// absolute one is a skill that only works here.
function checkInclude(name, file) {
  if (isAbsolute(name) || name.startsWith('~')) {
    throw new SkillError(`include '${name}': must be relative to the skill's directory`, file);
  }
  const parts = name.split(/[\\/]/);
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new SkillError(`include '${name}': must stay inside the skill's directory`, file);
  }
}

/**
 * The files a skill's `includes` resolve to: every declared entry expanded --
 * a file is itself, a directory is everything under it -- as paths relative to
 * the skill's directory, sorted. This is the list to pack, to digest, or to
 * copy when a skill moves; a skill with no includes has nothing to move.
 *
 * Throws SkillError when a declared include is not there, which is why
 * `parseSkillFile` calls it: a skill missing what it runs is broken when the
 * file is read, not when a model finally calls the tool.
 */
function includedFiles(skill) {
  const files = [];
  for (const name of skill.includes) {
    const path = join(skill.workdir, name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      throw new SkillError(
        `include '${name}' is declared but not in ${skill.workdir}`,
        skill.file || null,
      );
    }
    if (stat.isDirectory()) walk(path, skill, files);
    else if (stat.isFile()) files.push(name);
    else throw notAFile(name, skill, stat.isSymbolicLink());
  }
  return [...new Set(files)].sort();
}

// Everything under a declared directory, whatever it is called and however
// deep. A directory is declared whole: nothing here decides that a name looks
// unimportant and drops it.
function walk(dir, skill, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, skill, files);
    else if (entry.isFile()) files.push(rel(skill.workdir, path));
    else throw notAFile(rel(skill.workdir, path), skill, entry.isSymbolicLink());
  }
}

// A path relative to the skill's directory, always with forward slashes so the
// list reads the same on every platform.
function rel(workdir, path) {
  return relative(workdir, path).split(sep).join('/');
}

// A symlink is refused rather than followed: what it points at is not part of
// the skill, and a skill that packs one arrives somewhere else as a dangling
// name. Anything else that is not a plain file cannot travel at all.
function notAFile(name, skill, symlink) {
  const what = symlink ? 'a symlink' : 'not a file';
  return new SkillError(`include '${name}' is ${what}`, skill.file || null);
}

// JSON Schema primitive types: the only valid values for a param's `type`.
// Semantics ride the other JSON Schema keywords (`format`, `enum`), never a
// made-up type word.
const SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array']);

// The keys a param block accepts: JSON Schema keywords, nothing invented.
// A closed set: an unknown key is an error, not an annotation that silently
// disappears.
const PARAM_KEYS = new Set(['type', 'format', 'enum', 'description', 'default']);

// Parse one ```tool body. The grammar is a deliberately closed YAML-like
// subset; each param block is flat JSON Schema keywords:
//   id: access
//   description: accept or reject a pending waitlist user
//   params:
//     operation:
//       type: string
//       enum: accept, reject
//       description: action to perform
//       default: accept
//     user:
//       type: string
//       format: email
//   run: uv run waitlist/handle.py --$operation $user
// Anything outside this shape is an error, not a guess. The params lower to
// `tool.schema` -- a valid JSON Schema input object -- right here at parse
// time; a param with no `default` is required.
function parseToolBlock(body, file, workdir) {
  const tool = { params: [] };
  let inParams = false;
  let inRun = false;
  let param = null;

  for (const raw of body) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;

    // `run` written as a list: each item is exactly one argv word, taken
    // verbatim. Nothing is stripped, so a word may hold spaces, quotes, or
    // anything else the command it runs expects to receive.
    const item = inRun && raw.match(/^\s+-\s?(.*)$/);
    if (item) {
      tool.run.push(item[1].trimEnd());
      continue;
    }

    const m = raw.match(/^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) throw new SkillError(`bad line in tool block: '${raw.trim()}'`, file);
    const indent = m[1];
    const key = m[2];
    const value = m[3];

    if (indent.length === 0) {
      inParams = key === 'params';
      inRun = key === 'run' && value.trim() === '';
      param = null;
      if (inRun) tool.run = [];
      else if (!inParams) tool[key] = value.trim();
    } else if (inParams && indent.length === 2) {
      param = { name: key, type: 'string', description: '' };
      tool.params.push(param);
    } else if (inParams && indent.length === 4 && param) {
      if (!PARAM_KEYS.has(key)) {
        throw new SkillError(
          `param '${param.name}': unknown key '${key}' (expected one of: ${[...PARAM_KEYS].join(', ')})`,
          file,
        );
      }
      param[key] = key === 'enum' ? value.split(',').map((s) => s.trim()) : value.trim();
    } else {
      throw new SkillError(`bad indentation in tool block at '${raw.trim()}'`, file);
    }
  }

  if (!tool.id) throw new SkillError("a tool block is missing 'id'", file);
  if (!tool.run || (Array.isArray(tool.run) && tool.run.length === 0)) {
    throw new SkillError(`tool '${tool.id}' is missing 'run'`, file);
  }

  for (const p of tool.params) {
    if (!SCHEMA_TYPES.has(p.type)) {
      throw new SkillError(
        `param '${p.name}': invalid type '${p.type}' (expected a JSON Schema type: ${[...SCHEMA_TYPES].join(', ')})`,
        file,
      );
    }
    if (p.enum !== undefined && p.default !== undefined && !p.enum.includes(p.default)) {
      throw new SkillError(
        `param '${p.name}': default '${p.default}' is not one of its enum values`,
        file,
      );
    }
  }

  // Lower the params to the tool's JSON Schema. From here on the schema IS
  // the definition -- `params` does not survive onto the public tool.
  const properties = {};
  const required = [];
  for (const p of tool.params) {
    const prop = { type: p.type };
    if (p.format !== undefined) prop.format = p.format;
    if (p.enum !== undefined) prop.enum = p.enum;
    const d = String(p.description || '').trim();
    if (d) prop.description = d;
    if (p.default !== undefined) prop.default = p.default;
    else required.push(p.name);
    properties[p.name] = prop;
  }
  const schema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;

  // The run template is checked here, not the first time a model calls the
  // tool: an unterminated quote or a `$typo` is a broken tool, and a broken
  // tool should fail when the file is read.
  checkTemplate(tool.run, Object.keys(properties), tool.id, file);

  return {
    id: tool.id,
    description: tool.description || '',
    schema,
    run: tool.run,
    workdir,
  };
}

module.exports = { parseSkill, parseSkillFile, includedFiles };
