---
skill: deploy
description: Deploy the app, roll it back, and check what is live.
includes: scripts
---

This skill operates the app's deploy pipeline. One environment at a time;
production always asks for an explicit version.

Both tools run a script that ships with the skill, which is what `includes:`
declares: `scripts` is a directory, so everything under it belongs to the
skill and travels with it.

To ship or roll back, use the deploy tool:

```tool
id: deploy
description: deploy a version to an environment, or roll back to the previous one
params:
  action:
    type: string
    enum: ship, rollback
    description: ship a new version or roll back to the previous one
    default: ship
  env:
    type: string
    enum: staging, production
    description: target environment
  version:
    type: string
    description: version tag to ship (ignored on rollback)
    default: latest
run: bash scripts/deploy.sh --$action --env $env --version $version
```

To see what shipped before now, read the history. It runs a python script
whose dependencies are declared in the script itself (PEP 723), so `uv` builds
the environment on the spot and the skill stays a folder you can copy:

```tool
id: history
description: the last few versions deployed to an environment, newest first
params:
  env:
    type: string
    enum: staging, production
    description: environment to read the history of
run: uv run --script scripts/history.py $env
```

Every param a tool declares appears in its `run`, so the run line is the whole
call -- a release note is a single argv word, however long it is, and not
something handed over on the side:

```tool
id: announce
description: post the release note for a version
params:
  version:
    type: string
    description: version the note is about
  note:
    type: string
    description: the release note, in full, newlines and all
run: bash scripts/announce.sh $version $note
```

To see what is currently live, check the status:

```tool
id: status
description: show the version currently live in each environment
run: bash scripts/status.sh
```

Never ship to production without naming a version. When a deploy fails,
report the error verbatim and suggest a rollback; do not retry on your own.
