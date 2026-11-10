# Claude Cost

Approximate local cost tracking for [Claude Code](https://code.claude.com/docs) when billed through **Google Vertex AI**. It parses your local session transcripts and estimates spend — no proxy, no network calls.

By default it merges transcripts from `~/.config/claude/projects` and `~/.claude/projects` (modern path first). If `CLAUDE_CONFIG_DIR` is set, it reads only `$CLAUDE_CONFIG_DIR/projects`, the same folder Claude Code uses. Pass `--dir` to scan a single custom location. If `profiles.config.json` is present, each configured profile is reported separately.

> ⚠️ **Approximate.** Prices vary by region and negotiated rates. Always reconcile against your GCP Billing export for authoritative numbers.

## Install

The package is not on npm yet, so run it from a local clone.

### Run without installing

No `npm install` required:

```bash
node bin/claude-cost.js --monthly
node bin/claude-cost.js --since 7d --by-model

# or via npm script
npm start -- --monthly
```

### Install globally

From the clone, install the `claude-cost` command:

```bash
npm install -g .
claude-cost --help
```

## Usage

```bash
claude-cost                         # all-time total
claude-cost --since 7d              # last 7 days
claude-cost --since today           # since local midnight
claude-cost --since 2025-01-01      # since local midnight on a date
claude-cost --since 2025-01-15T10:00  # since a local date and time
claude-cost --monthly               # since start of current month
claude-cost --by-month              # per-month, per-model history (all time)
claude-cost --by-model              # per-model breakdown
claude-cost --json                  # machine-readable output
claude-cost --dir ~/.claude/projects
claude-cost --pricing ./my-prices.json
claude-cost --region us             # price at the US multi-region endpoint
```

## Flags

| Flag         | Description                                                    |
| ------------ | -------------------------------------------------------------- |
| `--since`    | `7d`, `24h`, `90m`, `2w`, `today`, or a date (see below)       |
| `--monthly`  | Since the start of the current month (local time)              |
| `--by-month` | Per-month, per-model breakdown across all history              |
| `--by-model` | Break totals down per model. Not with `--by-month`.            |
| `--json`     | Output JSON instead of a table                                 |
| `--dir`      | Override transcript directory. Ignores `profiles.config.json`. |
| `--pricing`  | Path to a custom pricing JSON. Overrides per-profile pricing.  |
| `--region`   | Vertex AI endpoint you call. Overrides every other setting.    |
| `-h, --help` | Show help                                                      |

`--monthly` filters to the current month only. `--by-month` shows every month in your transcripts, each with a per-model breakdown, so it can't be combined with `--by-model`.

`--since` takes a date as `YYYY-MM-DD`, which means local midnight. Add a time as `YYYY-MM-DDTHH:MM`, with optional seconds, to start at that local time. Add `Z` or an offset such as `+02:00` to give the time in another zone. Anything else is rejected, including impossible dates such as `2025-02-30`.

## Region

Vertex AI charges by endpoint. The global endpoint gets list price. The `us` and `eu` multi-region endpoints and the single-region endpoints cost 10% more, on every rate including long-context rates. The default is `global`. To change it, copy `settings.config.example.json` to `settings.config.json` and set `region`:

```json
{ "region": "us" }
```

`settings.config.json` is local and is not committed. A profile can set its own `region`, and `--region` overrides both. Accepted values are `global`, `us`, `eu`, `us-east5`, `europe-west1`, `asia-southeast1` and `asia-east1`. These are the same location names Claude Code reads from `CLOUD_ML_REGION`.

Each endpoint offers a different set of models. `us-east5` has no Claude 5 models, for example. If your transcripts use a model that Vertex does not list at your endpoint, the report still prices it at that endpoint's rates and lists it under "Not offered at the ... endpoint". That warning usually means the region setting is wrong.

## Profiles

To track more than one Claude Code account, copy `profiles.config.example.json` to `profiles.config.json` and list each account. `profiles.config.json` is local and is not committed.

```json
{
  "profiles": [
    { "name": "vertex", "dir": "~/.claude" },
    {
      "name": "work",
      "dir": "~/.claude-work",
      "pricing": "./pricing.work.json"
    }
  ]
}
```

`dir` is that account’s Claude config directory (`CLAUDE_CONFIG_DIR`). Transcripts are read from `<dir>/projects`. Each profile needs its own directory. Two profiles that resolve to the same `projects` folder, through a symlink for example, or where one sits inside the other, are rejected because their transcripts would be counted twice. Each profile is calculated the same way as a single run. The table prints one section per profile, then a total across all of them. `--json` wraps those sections in a `profiles` array plus the same summed total. With no `profiles.config.json`, `--json` stays a single report.

`pricing` is optional. When it is omitted, the profile uses `--pricing` if you passed it, otherwise `pricing.config.json`. `--pricing` overrides every profile. `region` is optional too and falls back to `settings.config.json`. `--dir` skips the profile file and scans one directory.

## Pricing

Edit `pricing.config.json` (USD per 1,000,000 tokens at the global endpoint; see [Region](#region) for the others). It lists the Claude models Vertex AI currently prices. Older models such as Claude Sonnet 4, Opus 4.1 and the 3.x family are left out, so their usage is reported as unknown and priced at $0. Fields: `input`, `output`, `cacheWrite` (5-minute cache write), `cacheWrite1h` (1-hour cache write), `cacheRead`.

A key matches any model ID that contains it and ends on a version boundary. `claude-sonnet-4-5` matches `claude-sonnet-4-5@20250929` and `claude-sonnet-4-5-20250929`. It does not match `claude-sonnet-4-7`, which shows up under unknown models until you add it. The longest matching key wins, and dots count as hyphens, so `claude-opus-5.5` uses `claude-opus-5-5`.

Some models charge more for long prompts. Add a `longContext` object with a `threshold` and the same five rate fields. When a request's prompt (input, cache read and cache write tokens together) is over `threshold`, every token in that request uses the `longContext` rates:

```json
"claude-haiku-5-5": {
  "input": 0.1, "output": 0.5, "cacheWrite": 0.125, "cacheWrite1h": 0.2, "cacheRead": 0.01,
  "longContext": {
    "threshold": 100000,
    "input": 0.5, "output": 2.5, "cacheWrite": 0.625, "cacheWrite1h": 1.0, "cacheRead": 0.05
  }
}
```

## Use from any Claude session

The repo ships a Claude Code skill in `.claude/skills/claude-cost`. Once it's linked into your user skills folder, Claude in any workspace can answer "how much have I spent this month?" by running this CLI. To link it, run this from the clone:

```bash
mkdir -p ~/.claude/skills
ln -s "$PWD/.claude/skills/claude-cost" ~/.claude/skills/claude-cost
```

Skills are read per config directory. If you use `CLAUDE_CONFIG_DIR` or keep several accounts, repeat the link for each one, for example `~/.claude-work/skills`. Because these are links, changes you pull into the clone apply right away.

Claude asks once before it runs the skill. To skip that prompt, add `Skill(claude-cost)` to `permissions.allow` in your settings.

## Development

```bash
npm test        # run the built-in Node test runner
```

## License

MIT
