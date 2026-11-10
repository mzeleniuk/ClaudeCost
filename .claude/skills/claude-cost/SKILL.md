---
name: claude-cost
description: Report how much the user has spent on Claude Code, using the local claude-cost CLI that estimates spend from session transcripts. Use when the user asks about their Claude spending, cost, bill, budget, or token usage, for example "how much have I spent this month?", "what did Claude cost me this week?", or "which model costs me the most?".
allowed-tools: Bash(node *claude-cost.js*)
---

# Claude Code spending

`claude-cost.js` in this folder starts the CLI. Run it with node from any directory. It needs no install and makes no network calls. Use the path exactly as below. Don't add `..` to it, because this folder is usually a symlink and the CLI won't be where `..` points.

```bash
node "${CLAUDE_SKILL_DIR}/claude-cost.js" --monthly --by-model
```

Pick flags from the question:

| Question                      | Flags                       |
| ----------------------------- | --------------------------- |
| This month (the default)      | `--monthly --by-model`      |
| Today                         | `--since today --by-model`  |
| Last week, last 30 days       | `--since 7d`, `--since 30d` |
| Since a date                  | `--since 2026-10-15`        |
| Last month, or month by month | `--by-month`                |
| All time                      | no flags                    |

There is no end-date flag. For "last month", run `--by-month` and read that month's rows. `--by-month` already splits each month by model, and the CLI rejects it combined with `--by-model`.

Add `--json` when you need to compare or add up numbers yourself. Otherwise the table is short enough to show as is.

## Reading the output

The user may run more than one Claude config directory. Each one shows up as a profile with its own table, followed by an "All profiles" total. Lead with the overall total, then the split by profile or model if it helps answer the question.

The figures are estimates priced from `pricing.config.json`. Say so once, briefly. The GCP Billing export has the real numbers.

If the output lists unknown models or models "Not offered at the ... endpoint", mention it. Unknown models cost $0 in the report, so the total is too low. The endpoint warning usually means the region setting is wrong.
