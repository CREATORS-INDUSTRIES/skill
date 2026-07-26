---
skill: waitlist
description: Manage the product waitlist - accept, revoke and inspect signups.
---

This skill manages the product waitlist: accepting or rejecting a pending
user, and inspecting the queue.

To change a user's state, use the access tool:

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
run: echo --$operation $user
```

For counts, prefer the stats tool:

```tool
# Comments and blank lines inside a fence are ignored by the parser.

id: stats
description: count total, accepted and pending waitlist entries
run: echo stats
```

A fence that is not a `tool` fence is plain prose and must survive rendering
untouched:

```bash
echo "not a tool, just documentation"
```

Prefer accepting users unless told otherwise.
