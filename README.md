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
- `run` becomes an argv, `$param` substitutes per word. No shell, ever:

```js
'uv run waitlist/handle.py --$operation $user'
// { operation: 'accept', user: 'x@y.z' }
['uv', 'run', 'waitlist/handle.py', '--accept', 'x@y.z']
```

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
`compile(skill)`, `resolve(tools, answer)`, `SkillError`. Full types in
`index.d.ts`.

## License

Apache License 2.0. This distribution includes a `NOTICE` file; per Section
4(d) of the license, any derivative work you distribute must include a
readable copy of its attribution notices, crediting CREATORS
(https://www.creators.industries/research/hard-skills) as the origin of this
code and of the hard-skill specification (markdown skills with embedded
executable ` ```tool ` fences).
