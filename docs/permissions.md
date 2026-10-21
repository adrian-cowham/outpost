# Permissions

Out of the box, reads run automatically and anything else asks you first. You don't need to change anything to get started; this page is for when you want to tune it.

## What actions may do

An action declares which named **groups** it inherits, and those groups are the only thing granting it anything:

| group | what it is |
|---|---|
| `core` | implicit for every Claude-backed action — read its envelope, report results back. No network. |
| `read` | local file reads + read-only git |
| `pull` | network **reads** only — anchored whitelists for `curl`, `gh api`, MCP `get_/list_/search_`, `kubectl get` |
| `edit` | local writes, dependency manifests, and test runners — scoped to the session's own worktree |
| `push` | external writes — **and gated**: a matching call runs only if you approved a draft pinning it |

Settings › Permissions edits those groups inline, rule by rule. Every edit is checked before it applies (a rule that would allow a write, escape its allowed directories, or be too slow to evaluate is refused, with the reason shown next to the row), and recorded in the group's revision history, where it can be reverted.

The same page lists every blocked call across all actions with three verdicts: never allow, add to a group the action already inherits, or queue a fix to the action itself.

![Settings › Permissions: the five groups, with `edit`'s bash patterns expanded](screenshots/permissions.png)

## The config files

Two files govern what runs without asking, and they answer different questions:

- **`config/permission-groups.json`** — what an *action* may do. Seeded from the tracked `config/permission-groups.default.json` on first start, then reconciled against it on every boot (your local additions survive, your local deletions stay deleted).
- **`config/allowlist.json`** — what an *interactive session or skill* may do without queueing an approval card. Seeded from `config/allowlist.default.json`. Three lists: `alwaysAllow` (exact tool names), `alwaysAllowBashPatterns` (regex against a `Bash` call's `command`), `alwaysAllowMcpPatterns` (regex against `mcp__<server>__<tool>`), plus an optional `alwaysAllowPathPatterns` for path-scoped write tools.

Both are gitignored per checkout, so rules you add in a dev worktree don't leak into your real install.

The full rule-by-rule model is in [`CLAUDE.md`](../CLAUDE.md#permission-groups).
