# @crtrs/skill

Parser for hard skills files. A hard skill is markdown prose for the
model, plus ` ```tool ` fences that declare executable tools. 

## Install

```bash
npm install @crtrs/skill
```

## Skill file

````markdown
---
skill: waitlist
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

The fence grammar is a deliberately closed YAML subset — `id`, `description`,
`params`, `run`. Anything outside that shape is a `SkillError`, not a guess.
`run` is split into argv words at resolve time and `$param` tokens substitute
inside words: no shell, ever.

Params are flat JSON Schema. `type` must be a JSON Schema primitive (`string`,
`number`, `integer`, `boolean`, `object`, `array`); semantics ride the standard
keywords — `format` for semantic strings (`email`, `uri`, or any custom word:
format is an open annotation vocabulary in JSON Schema 2020-12), `enum` for
closed value sets, plus `description` and `default`. Static checks at parse
time: invalid types, unknown keys, and a `default` outside its `enum` are all
errors.

## Use

The whole loop is four lines -- the package owns everything except the
inference call:

```js
const { parseSkillFile, compile, resolve } = require('@crtrs/skill');

const skill = parseSkillFile('SKILL.md');
const system = compile(skill);            // prose + call protocol, model-facing
const output = await myInference(system); // your model, your way
const call = resolve(skill.tools, output);
```

`compile` produces the system text: the skill's prose (fences collapsed to
tool ids) followed by the call protocol -- the exact wire shape `resolve`
parses plus the tool catalog. Same parse feeds both, so what the model is told
and what the parser accepts cannot drift.

`resolve` takes the model's raw text, or an already-structured call object
(e.g. an SDK's native tool-calling output):

```js
if (call === null) {
  // no tool call in the text. What that means -- final answer, retry,
  // something else -- is your loop's decision, not the package's.
} else {
  call.tool.id; // 'access'
  call.args;    // { operation: 'accept', user: 'x@y.z' }  (default filled)
  call.argv;    // ['uv', 'run', 'waitlist/handle.py', '--accept', 'x@y.z']
}
// Invalid calls throw SkillError with a message written to feed back to
// the model (unknown tool, missing required arg, enum violation, ...).
```

Using a SDK's native tool-calling instead of raw text? Skip `compile`: use
`skill.rendered` as the system text and hand each tool over directly,
`tool.schema` is already valid JSON Schema (Anthropic, OpenAI and MCP all
take it as the input schema):

```js
const tools = skill.tools.map((tool) => ({
  name: tool.id,
  description: tool.description,
  input_schema: tool.schema,
}));
```

The package never calls a model. You own the loop, it referees both directions
of the contract: what the model may call, and what it actually called.

API: `parseSkill(source, { file, workdir })`, `parseSkillFile(path)`,
`compile(skill)`, `resolve(tools, answer)`, `SkillError`.
Full types in `index.d.ts`.

## License

Apache License 2.0. This distribution includes a `NOTICE` file; per Section
4(d) of the license, any derivative work you distribute must include a
readable copy of its attribution notices, crediting CREATORS
(https://www.creators.industries/research/hard-skills) as the origin of this
code and of the hard-skill specification (markdown skills with embedded
executable ` ```tool ` fences).
