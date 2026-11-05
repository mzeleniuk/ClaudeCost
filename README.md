# Claude Cost

Approximate local cost tracking for [Claude Code](https://code.claude.com/docs) when billed through **Google Vertex AI**. It parses your local session transcripts and estimates spend — no proxy, no network calls.

By default it merges transcripts from `~/.config/claude/projects` and `~/.claude/projects` (modern path first). Pass `--dir` to scan a single custom location. If `profiles.config.json` is present, each configured profile is reported separately.

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
claude-cost --since 2025-01-01      # since a date
claude-cost --monthly               # since start of current month
claude-cost --by-month              # per-month, per-model history (all time)
claude-cost --by-model              # per-model breakdown
claude-cost --json                  # machine-readable output
claude-cost --dir ~/.claude/projects
claude-cost --pricing ./my-prices.json
```

## Flags

| Flag         | Description                                                    |
| ------------ | -------------------------------------------------------------- |
| `--since`    | `7d`, `24h`, `90m`, `2w`, `today`, or an ISO date              |
| `--monthly`  | Since the start of the current month (local time)              |
| `--by-month` | Per-month, per-model breakdown across all history              |
| `--by-model` | Break totals down per model                                    |
| `--json`     | Output JSON instead of a table                                 |
| `--dir`      | Override transcript directory. Ignores `profiles.config.json`. |
| `--pricing`  | Path to a custom pricing JSON. Overrides per-profile pricing.  |
| `-h, --help` | Show help                                                      |

`--monthly` filters to the current month only. `--by-month` shows every month in your transcripts, each with a per-model breakdown.

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

`dir` is that account’s Claude config directory (`CLAUDE_CONFIG_DIR`). Transcripts are read from `<dir>/projects`. Each profile is calculated the same way as a single run. The table prints one section per profile, then a total across all of them. `--json` wraps those sections in a `profiles` array plus the same summed total. With no `profiles.config.json`, `--json` stays a single report.

`pricing` is optional. When it is omitted, the profile uses `--pricing` if you passed it, otherwise `pricing.config.json`. `--pricing` overrides every profile. `--dir` skips the profile file and scans one directory.

## Pricing

Edit `pricing.config.json` (USD per 1,000,000 tokens). Fields: `input`, `output`, `cacheWrite` (5-minute cache write), `cacheWrite1h` (1-hour cache write), `cacheRead`. Model names are matched by substring, so `claude-sonnet-4` matches `claude-sonnet-4@20250514`.

## Development

```bash
npm test        # run the built-in Node test runner
```

## License

MIT
