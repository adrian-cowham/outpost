---
name: meta.session
description: Hand a step to the user as an ordinary interactive session that starts by sending a given prompt — typically a personal skill invocation like `/investigate-cscu CSCU-123`. Use when the user already has a skill for this kind of work and drives it themselves in one session. Builtin runner — the daemon starts the session as soon as the step begins; the step resolves when the user marks it done.
outpost:
  kind: action
  category: meta
  side_effects: none
  runner: builtin
  timeout_sec: 604800
  retries: 0
---

# meta.session

A step whose work is one user-driven Claude session. When the step starts, the daemon spawns a session under the **user's own permissions** — not an action allowlist — and sends `prompt` as its first message. The step parks in `waiting` with the session rendered inline; the user converses with it, approves whatever it asks to do, and marks the step **Done** in the PWA when finished.

Use it when a ticket type has a dedicated skill the user runs interactively — the skill owns the investigation, the approval gates, and the write-back. Plan it as the job's **only** step: the skill does in one session what a planned chain of `read.investigate` → `write.*` steps would otherwise split up.

Do NOT use it for work an action in the catalog already covers, or as a hold between steps — that's `meta.wait`.

## Inputs

- `prompt` — the first message, verbatim. A skill invocation: `/<skill-name> <args>`.
- `reason` — optional one-liner shown on the step in the PWA.

The session opens in the step's `workspace`: `none` opens it in the user's home directory, `readonly` in a fresh checkout of that repo. Never `writable`.
