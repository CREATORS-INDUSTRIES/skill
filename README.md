### Hard Skills

Parser, compiler and resolver for hard skills: markdown skills with embedded
executable ` ```tool ` fences. One file declares what the model reads, what it
may call, and what runs when it calls. The declared tools are the contract.

This package is the general purpose skill layer, engine-neutral by design: no model calls, no SDK bindings, zero runtime dependencies.

Built at [CREATORS](https://creators.industries)  

### Install

```bash
npm install @crtrs/skill
```

### Skill file

````markdown
---
skill: waitlist
description: Accept, reject and inspect waitlist signups.
---

Manage the product waitlist.

```tool
id: access
description: accept or reject a pending waitlist user
params:
  operation:
    type: string
    enum: accept, reject
    description: action to perform
    default: accept
  user:
    type: string
    format: email
    description: email of the user
run: uv run waitlist/handle.py --$operation $user
```

Prefer accepting users unless told otherwise.
````

A tool fence has four keys: `id`, `description`, `params`, `run`.

- Params are flat JSON Schema: `type`, `format`, `enum`, `description`, `default`.
- No `default` means required.
- Anything outside the shape is a `SkillError` at parse time.
- Every param appears in `run`, and every `$name` in `run` is a declared param. Both directions are checked at parse time.
- `run` becomes an argv, `$param` substitutes per word. No shell, ever:

```js
'uv run waitlist/handle.py --$operation $user'
// { operation: 'accept', user: 'x@y.z' }
['uv', 'run', 'waitlist/handle.py', '--accept', 'x@y.z']
```

### The run line is the whole call

A param that never appears in the template is a `SkillError`, the same as a
`$name` no param declares. The rule runs both ways on purpose: a param the
template does not mention would still reach the tool — through an environment
variable, on stdin, through whatever side channel a host offers — and then the
command someone read before approving the skill is not the command that runs.

```yaml
params:
  path:
    type: string
  content:
    type: string
run: tee $path        # SkillError: 'content' is declared but never used in run
```

A whole file, a blob of JSON, a secret: if a tool receives it, it is an argv
word, and the run line says so. Values substitute inside their word and never
split it, so size and spaces are not a reason to reach for another channel.

### What a skill carries

A tool that runs `uv run handle.py` needs `handle.py`. `includes:` in the
frontmatter is where a skill says so — comma separated, each entry a path
relative to the skill's directory:

```yaml
---
skill: waitlist
description: Accept, reject and inspect waitlist signups.
includes: handle.py, queries, Makefile
---
```

An entry is whatever is at that path. Nothing is read into its name — an
extension is not what makes something a file — so the filesystem answers: a
file is that file, a directory is everything under it, however deep. A path
that is absolute, starts with `~`, or climbs out with `..` is a `SkillError`:
a skill reaches inside its own directory and nowhere else, which is what lets
it travel.

`parseSkillFile` checks them. A declared include that is not there is a broken
skill and fails when the file is read, the same as a `$typo` in a `run`
template — not the first time a model calls the tool.

```js
skill.includes;          // ['handle.py', 'queries', 'Makefile'] -- as declared
includedFiles(skill);    // ['Makefile', 'handle.py', 'queries/nested/deep.sql', ...]
```

`includedFiles` expands the declaration into the actual files, relative to
`skill.workdir` and sorted: the list to pack, to digest, or to copy when a
skill moves. Symlinks are refused rather than followed — what one points at is
not part of the skill, and it would arrive somewhere else as a dangling name.

### What a skill needs on the machine

Because there is no shell, the first word of a `run` is the executable — never
an alias, an expansion, or a second command hiding behind a `;`. So what a
skill will spawn is knowable before it runs once:

```js
programs(skill);
// [{ name: 'uv', dynamic: false, tools: ['dump', 'restore'] }]
```

That is the list to check against a `PATH` before someone approves a skill, so
"this needs `uv`, which you do not have" arrives before the run and not three
tool calls into it. A run whose first word holds a param (`run: $cmd --flag`)
has no program until the call is made, and comes back `dynamic`.

### When a word needs a space

Whitespace ends a word, which is all a command line ever needs — until one
word has to hold a space. Then `run` is a list, and each item is exactly one
argv word, verbatim:

```yaml
run:
  - awk
  - -v
  - f=$file
  - BEGIN{while((getline l<f)>0){n++; print n": "l}}
```

There is no quoting. Quotes would mean a character that sometimes groups words
and sometimes is just itself, and a run template carries other languages —
python, awk, sed — that spend quotes on their own strings. `python -c
print('hi')` passes `print('hi')`, quotes and all. A list has nothing to escape
and nothing to strip: what is written is what the process receives.

The shell's other characters are ordinary too. `|`, `>`, `;`, `&&`, `*` and
backticks are just characters in an argv word — no pipe, no redirect, no glob,
and no expansion of anything but the params the tool declared. A value
substitutes *inside* its word and can never split it.

`$$` is a literal dollar, and it is the one escape there has to be: without it
a `$0` in an awk program would read as a param named `0`.

A `$name` that was never declared is a `SkillError` at parse time, not a
surprise the first time a model calls the tool.

## Use

The whole loop is four lines. The package owns everything except the
inference call:

```js
const { parseSkillFile, compile, resolve } = require('@crtrs/skill');

const skill = parseSkillFile('SKILL.md');
const system = compile(skill);            // prose + call protocol, model-facing
const output = await myInference(system); // your model, your way
const call = resolve(skill.tools, output);
```

`compile` emits the system text: the prose with fences collapsed to tool
ids, then the call protocol with the tool catalog in JSON Schema. Same parse
feeds both, so what the model is told and what `resolve` accepts cannot
drift.

`resolve` takes raw model text or an already-structured call (an SDK's
native tool-calling output). It validates against the tool's schema:
defaults filled, required enforced, enums checked, primitives coerced.

```js
if (call === null) {
  // no tool call in the text. What that means is your loop's decision.
} else {
  call.tool.id; // 'access'
  call.args;    // { operation: 'accept', user: 'x@y.z' }
  call.argv;    // ['uv', 'run', 'waitlist/handle.py', '--accept', 'x@y.z']
}
// Invalid calls throw SkillError, worded to feed straight back to the model.
```

On an SDK's native tool-calling, skip `compile`: send `skill.rendered` as
system text and hand tools over directly. `tool.schema` is already valid
JSON Schema, the shape Anthropic, OpenAI and MCP take as input schema:

```js
const tools = skill.tools.map((tool) => ({
  name: tool.id,
  description: tool.description,
  input_schema: tool.schema,
}));
```

API: `parseSkill(source, { file, workdir })`, `parseSkillFile(path)`,
`includedFiles(skill)`, `programs(skill)`, `compile(skill)`,
`resolve(tools, answer)`, `SkillError`. Full types in `index.d.ts`.

## License

Apache License 2.0. This distribution includes a `NOTICE` file; per Section
4(d) of the license, any derivative work you distribute must include a
readable copy of its attribution notices, crediting CREATORS
(https://www.creators.industries/research/hard-skills) as the origin of this
code and of the hard-skill specification (markdown skills with embedded
executable ` ```tool ` fences).
