'use strict';

// Resolving: a model's answer -> the tool call it asks for. The package never
// calls a model -- the host does that however it likes; this is the referee
// for the way back. Args are validated against the tool's JSON Schema and the
// `run` template becomes a concrete argv, with no shell anywhere.

const { SkillError } = require('./error');
const { renderArgv } = require('./argv');

/**
 * Resolve a model's answer into the tool call it asks for. Takes either the
 * model's RAW TEXT (the wire shape is one JSON object,
 * `{ "tool": "<id>", "args": { ... } }`, found as the whole string, inside a
 * fenced code block, or embedded in prose) or an ALREADY-STRUCTURED call
 * object (e.g. from an SDK's native tool-calling).
 *
 * Returns null when the text carries no tool call (what that means is up to
 * the host's loop), or `{ tool, args, argv }` with args validated against the
 * tool's schema -- defaults filled, required enforced, enums checked,
 * primitives coerced -- and argv ready to spawn. Anything invalid throws a
 * SkillError whose message is written to be fed back to the model.
 */
function resolve(tools, answer) {
  const call =
    answer !== null && typeof answer === 'object'
      ? answer
      : extractCall(String(answer ?? ''));
  if (call === null) return null;
  if (typeof call.tool !== 'string') {
    throw new SkillError('a call object must have a string "tool" property');
  }

  const tool = tools.find((t) => t.id === call.tool);
  if (!tool) {
    const known = tools.map((t) => t.id).join(', ');
    throw new SkillError(`unknown tool '${call.tool}' (declared tools: ${known})`);
  }

  const args = validateArgs(tool, call.args);
  // The run template becomes argv here, values substitute inside their word,
  // and no shell is ever involved.
  return { tool, args, argv: renderArgv(tool.run, args, tool.id) };
}

// Find the call object in a model's output. Tries, in order: the whole text as
// JSON, each fenced code block, then every balanced {...} candidate in the
// prose. Only an object with a string `tool` key counts -- any other JSON in
// the answer is just content.
function extractCall(text) {
  const candidates = [text.trim()];
  for (const m of text.matchAll(/```[a-z]*\s*\n([\s\S]*?)```/g)) candidates.push(m[1].trim());
  for (let i = text.indexOf('{'); i !== -1; i = text.indexOf('{', i + 1)) {
    const end = matchBrace(text, i);
    if (end !== -1) candidates.push(text.slice(i, end + 1));
  }
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && typeof value.tool === 'string') return value;
    } catch {
      // not JSON; keep scanning
    }
  }
  return null;
}

// Index of the brace closing the one at `start`, honoring strings; -1 if none.
function matchBrace(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

// Validate a call's args against the tool's schema: unknown args rejected,
// defaults filled, required enforced, primitives coerced (models emit strings),
// enums checked after coercion.
function validateArgs(tool, args) {
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new SkillError(`tool '${tool.id}': "args" must be an object`);
  }

  const properties = tool.schema.properties;
  const required = new Set(tool.schema.required || []);
  for (const key of Object.keys(args)) {
    if (!(key in properties)) {
      const known = Object.keys(properties).join(', ') || 'none';
      throw new SkillError(`tool '${tool.id}': unknown arg '${key}' (declared params: ${known})`);
    }
  }

  const out = {};
  for (const [name, prop] of Object.entries(properties)) {
    let value = args[name];
    if (value === undefined || value === null) {
      if (!required.has(name)) value = prop.default;
      else throw new SkillError(`tool '${tool.id}': missing required arg '${name}'`);
    }
    value = coerce(tool, name, prop, value);
    if (prop.enum !== undefined && !prop.enum.includes(value)) {
      throw new SkillError(
        `tool '${tool.id}': arg '${name}' must be one of: ${prop.enum.join(', ')} (got '${value}')`,
      );
    }
    out[name] = value;
  }
  return out;
}

// Coerce a value to its schema type. Lenient on the string side (models often
// quote numbers and booleans), strict on the outcome: a value that cannot
// become the declared type is an error, never a silent pass.
function coerce(tool, name, prop, value) {
  const fail = () => {
    throw new SkillError(
      `tool '${tool.id}': arg '${name}' must be ${prop.type} (got ${JSON.stringify(value)})`,
    );
  };
  switch (prop.type) {
    case 'string':
      return typeof value === 'string' ? value : fail();
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return fail();
    }
    case 'integer':
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) fail();
      if (!Number.isFinite(n)) fail();
      if (prop.type === 'integer' && !Number.isInteger(n)) fail();
      return n;
    }
    case 'object':
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          fail();
        }
      }
      return value && typeof value === 'object' && !Array.isArray(value) ? value : fail();
    case 'array':
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          fail();
        }
      }
      return Array.isArray(value) ? value : fail();
    default:
      return value;
  }
}

module.exports = { resolve };
