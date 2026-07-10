# Claude Cost

Approximate local cost tracking for [Claude Code](https://code.claude.com/docs) when billed through **Google Vertex AI**. It parses your local session transcripts and estimates spend — no proxy, no network calls.

> ⚠️ **Approximate.** Prices vary by region and negotiated rates. Always reconcile against your GCP Billing export for authoritative numbers.

## Install

### Run without installing

From a local clone (no `npm install` required):

```bash
node bin/claude-cost.js --monthly
node bin/claude-cost.js --since 7d --by-model

# or via npm script
npm start -- --monthly
```

From npm (no global install):

```bash
npx claude-cost --since 7d --by-model
```

### Install globally

```bash
npm install -g claude-cost
claude-cost --help
```

To install globally from a local clone:

```bash
npm install -g .
```

## Usage

```bash
claude-cost                         # all-time total
claude-cost --since 7d              # last 7 days
claude-cost --since today           # since local midnight
claude-cost --since 2025-01-01      # since a date
claude-cost --monthly               # since start of current month
claude-cost --by-model              # per-model breakdown
claude-cost --json                  # machine-readable output
claude-cost --dir ~/.claude/projects
claude-cost --pricing ./my-prices.json
```

## Flags

| Flag         | Description                                       |
| ------------ | ------------------------------------------------- |
| `--since`    | `7d`, `24h`, `90m`, `2w`, `today`, or an ISO date |
| `--monthly`  | Since the start of the current month (local time) |
| `--by-model` | Break totals down per model                       |
| `--json`     | Output JSON instead of a table                    |
| `--dir`      | Override transcript directory                     |
| `--pricing`  | Path to a custom pricing JSON                     |
| `-h, --help` | Show help                                         |

## Pricing

Edit `pricing.config.json` (USD per 1,000,000 tokens). Model names are matched by substring, so `claude-sonnet-4` matches `claude-sonnet-4@20250514`.

## Development

```bash
npm test        # run the built-in Node test runner
```

## License

MIT
