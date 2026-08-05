/** A skill that does not parse. */
export class SkillError extends Error {
  /** Offending file path, when known. */
  file: string | null;
  constructor(message: string, file?: string);
}

/** A JSON Schema fragment. */
export interface JSONSchema {
  type?: string;
  format?: string;
  enum?: string[];
  description?: string;
  default?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
}

/** One parsed ```tool fence. */
export interface SkillTool {
  id: string;
  description: string;
  /**
   * The tool's input schema: valid JSON Schema, built at parse time from the
   * fence's params (a param with no `default` is required). Hand it straight
   * to any tool-calling SDK (Anthropic, OpenAI, MCP) as the input schema.
   */
  schema: JSONSchema;
  /**
   * The run template as written. At resolve time it becomes argv and `$param`
   * values substitute inside each word -- no shell, ever.
   *
   * A string splits on whitespace. A list is already the words, each item
   * taken verbatim, which is how a word holds a space -- there is no quoting,
   * so a quote in a template belongs to whatever language it is written in.
   * `$$` is a literal dollar. `|`, `>`, `;` and backticks are ordinary
   * characters, and a value substitutes inside its word and can never split it.
   */
  run: string | string[];
  /** Directory the command executes from (the skill file's directory). */
  workdir: string;
}

/** A parsed skill: its tool definitions plus the compiled template. */
export interface Skill {
  /** `skill:` value from the frontmatter, if present. */
  name: string | undefined;
  /** `description:` value from the frontmatter, if present. */
  description: string | undefined;
  tools: SkillTool[];
  /** The compiled template: prose with each tool fence replaced by its id. */
  rendered: string;
}

/** Parse skill source. Throws SkillError on any invalid shape. */
export function parseSkill(
  source: string,
  opts?: { file?: string; workdir?: string },
): Skill;

/** Read and parse a skill file. Throws SkillError on any invalid shape. */
export function parseSkillFile(file: string): Skill;

/**
 * Compile a parsed skill into the model-facing system text: the prose (fences
 * collapsed to tool ids) followed by the call protocol -- the exact wire shape
 * `resolve` parses plus the tool catalog. Send it as your system text when
 * driving a model over raw text; with an SDK's native tool-calling use
 * `skill.rendered` and each `tool.schema` instead.
 */
export function compile(skill: Skill): string;

/** A model's tool call, resolved against the declared tools. */
export interface ResolvedCall {
  /** The declared tool the model asked for. */
  tool: SkillTool;
  /** Validated args: defaults filled, required enforced, primitives coerced. */
  args: Record<string, unknown>;
  /** The command to spawn, $params substituted, no shell. */
  argv: string[];
}

/**
 * Resolve a model's answer into the tool call it asks for. Takes either the
 * model's raw text (the wire shape is one JSON object
 * `{ "tool": "<id>", "args": { ... } }`, found as the whole string, inside a
 * fenced code block, or embedded in prose) or an already-structured call
 * object (e.g. from an SDK's native tool-calling). Returns null when the text
 * carries no tool call (what that means is the host loop's call). Throws
 * SkillError (message written to be fed back to the model) on unknown tool or
 * bad args.
 */
export function resolve(
  tools: SkillTool[],
  answer: string | { tool: string; args?: Record<string, unknown> },
): ResolvedCall | null;
