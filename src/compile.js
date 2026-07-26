'use strict';

// Compiling: a parsed Skill -> the model-facing system text. The prose (tool
// fences already collapsed to their ids) followed by the call protocol. Both
// halves come from the same parse, so what the model is told and what
// `resolve` accepts can never drift apart.

/**
 * Compile a parsed skill into the model-facing system text.
 *
 * This is the whole raw-text loop: send `compile(skill)` as your system text,
 * run inference however you like, hand the answer to `resolve`. (Driving an
 * SDK's native tool-calling instead? Use `skill.rendered` and each
 * `tool.schema` directly; the protocol text is unnecessary there.)
 */
function compile(skill) {
  return `${skill.rendered}\n\n${protocol(skill.tools)}`;
}

// The call protocol: how the model asks for a tool. The catalog is rendered
// as JSON Schema -- the exact same `tool.schema` objects an SDK would receive
// -- so every consumer of a skill, human or model, reads one single format.
function protocol(tools) {
  const catalog = tools.map((tool) => ({
    name: tool.id,
    description: tool.description,
    input_schema: tool.schema,
  }));

  return `To use a tool, respond with exactly one JSON object and nothing else:
{"tool": "<name>", "args": {"<param>": <value>}}

Available tools (each "input_schema" is JSON Schema for the tool's "args"):
${JSON.stringify(catalog, null, 2)}

Rules:
- "tool" must be the "name" of one of the tools above.
- "args" must satisfy the tool's "input_schema"; params with a "default" may be omitted.
- One tool call per response.`;
}

module.exports = { compile };
