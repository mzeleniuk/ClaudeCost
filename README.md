# Claude Cost

Approximate local cost tracking for [Claude Code](https://code.claude.com/docs) when billed through **Google Vertex AI**. It parses your local session transcripts and estimates spend — no proxy, no network calls.

By default it merges transcripts from `~/.config/claude/projects` and `~/.claude/projects` (modern path first). If `CLAUDE_CONFIG_DIR` is set, it reads only `$CLAUDE_CONFIG_DIR/projects`, the same folder Claude Code uses. Pass `--dir` to scan a single custom location. If `profiles.config.json` is present, each configured profile is reported separately.

> ⚠️ **Approximate.** Prices vary by region and negotiated rates. Always reconcile against your GCP Billing export for authoritative numbers.

## Install

The package is not on npm yet, so run it from a local clone.

### Run without installing

Requires Node.js 24.15 or newer. Run the TypeScript entry point directly:

```bash
node bin/claude-cost.ts --monthly
node bin/claude-cost.ts --since 7d --by-model

# or via npm script
npm start -- --monthly
```

### Install globally

From the clone, build and install the `claude-cost` command:

```bash
npm ci
npm install -g .
claude-cost --help
```

## Usage

```bash
claude-cost                         # all-time total
claude-cost --backup ~/backups      # copy the usage store to a new folder
claude-cost --budget 200            # warn when this month's spend passes $200
claude-cost --by-model              # per-model breakdown
claude-cost --by-month              # per-month, per-model history (all time)
claude-cost --dashboard             # write data/dashboard.html, print its link
claude-cost --dir ~/.claude/projects
claude-cost --forecast              # project this month's total from the pace so far
claude-cost --json                  # machine-readable output
claude-cost --monthly               # since start of current month
claude-cost --monthly --compare previous  # that against the same stretch of last month
claude-cost --pricing ./my-prices.json
claude-cost --region us             # price at the US multi-region endpoint
claude-cost --since 2025-01-01      # since local midnight on a date
claude-cost --since 2025-01-15T10:00  # since a local date and time
claude-cost --since 7d              # last 7 days
claude-cost --since 7d --compare previous  # that against the 7 days before
claude-cost --since today           # since local midnight
```

## Dashboard

`--dashboard` writes one HTML file with your spend over time. It has daily and monthly cost charts stacked by model, rankings of models and projects, a calendar and an hour-by-weekday map of when you spend, a token mix next to the cost mix, and main agent against subagent spend. The dollar figure for what prompt caching saved comes from pricing the same messages with every cache token billed as plain input. `npm run dashboard` does the same as `claude-cost --dashboard`.

```bash
claude-cost --dashboard                          # writes data/dashboard.html
claude-cost --dashboard --out ~/Desktop/cost.html
claude-cost --dashboard --since 30d              # only the last 30 days
```

The command does not open a browser. It prints where it wrote the file and a `file://` link to it, which most terminals make clickable, so you can open it or copy it into any browser:

```text
Dashboard written to /Users/me/claude-cost/data/dashboard.html
Open in your browser: file:///Users/me/claude-cost/data/dashboard.html
$1,883.72 across 272 sessions, Jul 17 to Nov 11
285k input, 10M output, 956.4M cache read, 98M cache write, 13,667 messages
```

After the link come the total cost, session count and date range, then a line with tokens by kind (input, output, cache read, cache write) and the message count.

The file has the styles, script and data inlined. It needs no server, makes no network requests and works from `file://`. The filters (dates, profiles, models, projects) run in the browser, so changing one does not re-run the CLI. The CLI options that choose what to read still apply: `--since`, `--dir`, `--pricing`, `--region`, `--no-cache` and `--rebuild-cache`.

File size depends on how many distinct combinations of day, hour, profile, model, project and main or subagent you have, not on how many messages. The data is one row per combination, at about 100 bytes a row. Four months of one person's use came to 605 rows, 63 KB of data and a 142 KB file, of which about 79 KB is the fixed page. Using many projects and models across most hours of the day adds rows fast, so a year of heavy use can reach a few MB. That is an estimate from the row size, not a measurement. Pass `--since` to cut the file down.

It contains your project names and what each cost. By default it goes in the store folder, `data/` next to the program, which is in `.gitignore` and moves with `storeDir` in `settings.config.json`. A file written with `--out` is yours to keep private. Do not share it unless you are fine with that. If the store folder is read-only, as in an installed copy, pass `--out`.

Project names come from the transcript folder names. Claude Code writes `/Users/me/Dev/app` as `-Users-me-Dev-app`, which cannot be reversed with certainty, so the CLI looks for a directory on disk that matches. If the directory is gone, the dashboard shows the folder name instead.

The page opens on the last 30 days. When none of your usage falls in them, it opens on all history. The range tabs at the top switch between 7, 30 and 90 days, the month and all history, and the choice goes into the page link, so a reload or a copied link keeps it. A link that has no range opens on the default, and `#range=all` opens all history.

The `spent` tile is followed by a "vs previous" tile for the 7, 30 and 90 day ranges and for the month. It sets the range against the period of equal length before it, or against the same days of the previous month for the month range. It shows the change in percent and what the earlier period cost. It is not shown for `all`, when the earlier period has no spend, or when the data does not reach back to the start of the earlier period. `--since` can cut the data short of that.

`--dashboard` cannot be combined with `--json`, `--by-model`, `--by-month`, `--monthly` or `--compare`. `--out` needs `--dashboard`.

## Flags

| Flag              | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `--since`         | `7d`, `24h`, `90m`, `2w`, `today`, or a date (see below)          |
| `--monthly`       | Since the start of the current month (local time)                 |
| `--by-month`      | Per-month, per-model breakdown across all history                 |
| `--by-model`      | Break totals down per model. Not with `--by-month`.               |
| `--json`          | Output JSON instead of a table                                    |
| `--dashboard`     | Write an HTML dashboard. See [Dashboard](#dashboard).             |
| `--out`           | Where `--dashboard` writes. Default: `dashboard.html` in `data/`. |
| `--dir`           | Override transcript directory. Ignores `profiles.config.json`.    |
| `--pricing`       | Path to a custom pricing JSON. Overrides per-profile pricing.     |
| `--region`        | Vertex AI endpoint you call. Overrides every other setting.       |
| `--compare`       | `previous`: set the period against the one before it. See below.  |
| `--budget`        | Warn when this month's spend passes this many USD. See below.     |
| `--forecast`      | Project this month's spend to the end of the month. See below.    |
| `--strict`        | Exit 1 on unpriced models, unreadable lines or a passed budget.   |
| `--backup`        | Copy the usage store into a new folder in this path, then exit.   |
| `--no-cache`      | Read transcripts from disk only. See [Usage store](#usage-store). |
| `--rebuild-cache` | Read every transcript again and rewrite the usage store.          |
| `-h, --help`      | Show help                                                         |

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

A model with no matching key is priced at $0, so the total comes out too low. Every run that uses one prints a warning on stderr, and the table and `--json` list it too:

```text
claude-cost: warning: models missing from pricing.config.json are priced at $0: claude-sonnet-4-1
```

`--strict` turns the warning into an error. The report or dashboard is still written, then the command exits with status 1, so a script can stop on an out-of-date pricing file. Usage outside `--since` does not count. Usage with no model name in the transcript is not listed, because there is no name to add to the file.

```bash
claude-cost --strict --json > usage.json || echo "update pricing.config.json"
```

## Budget and forecast

`--budget <usd>` warns when this month's spend passes a limit. The month is the current calendar month in local time. The check reads that month whatever `--since`, `--monthly` or `--by-month` say. It adds up every profile, and prices each one with its own pricing file and region.

```bash
claude-cost --budget 200
claude-cost --budget 200 --strict || echo "over budget"
```

To set a limit for every run, add `budget` to `settings.config.json`. It is a number of USD above zero, and `--budget` overrides it:

```json
{ "budget": 200 }
```

A text report ends with a block for the month, and a `--json` report gets a `budget` key:

```text
⏺ November 2026
  ⎿  Spent     $152.07 of $200.00 budget (76%)
     Forecast  $177.89 at the current pace
```

```json
"budget": {
  "month": "2026-11",
  "spentUSD": 152.069579,
  "budgetUSD": 200,
  "overBudget": false,
  "forecast": { "projectedUSD": 177.892828, "overBudget": false }
}
```

`budgetUSD` is null when only `--forecast` was given, and `forecast` is null when `--forecast` was not.

When spend passes the budget, the run prints a warning on stderr and exits with status 0. Spend equal to the budget does not pass it. With `--strict` the same line is an error and the exit status is 1, after the report prints.

```text
claude-cost: warning: November 2026 spend $152.07 is $52.07 over the $100.00 budget.
```

`--forecast` divides the month's spend by the share of the month that has passed, so $50 after 14 of 28 days projects to $100. It assumes the rest of the month costs the same per day as the days so far, so a few heavy days early in the month push it up. It is not available during the first day of the month, because a few hours of use say little about the month. The text block says so, and `projectedUSD` is null.

With a budget, a forecast above it prints a warning on stderr. `--strict` does not turn that into exit status 1, because spend has not passed the budget yet.

```text
claude-cost: warning: November 2026 is on pace for $177.92, $17.92 over the $160.00 budget.
```

The month is a second scan next to the report, which the usage store keeps fast. With `--no-cache` the run reads every transcript twice.

## Compare periods

`--compare previous` sets the report's period against the period before it, and prints the change in cost. It needs `--since` or `--monthly`, because without one the report covers all history and nothing comes before it.

```bash
claude-cost --since 7d --compare previous
claude-cost --monthly --compare previous
claude-cost --since 7d --by-model --compare previous
```

A text report ends with a block for both periods. `--by-model` adds a row for each model that either period used, with the models of the current period first:

```text
⏺ Compared with the previous period
  ⎿  This period  2026-11-19 17:18:44 to 2026-11-26 17:18:44 local
     Previous     2026-11-12 17:18:44 to 2026-11-19 17:18:44 local

     model               this period  previous          change
     claude-sonnet-5-5        $31.20    $22.10   +$9.10 (+41%)
     claude-opus-5-5          $12.40    $20.35   -$7.95 (-39%)
     ─────────────────────────────────────────────────────────
     total                    $43.60    $42.45   +$1.15 (+3%)
```

The previous period depends on what the report covers:

- With `--since`, it is the stretch of equal length that ends where the report starts. `--since 7d` compares the last 7 days with the 7 days before them. The report runs up to the moment the command starts.
- With `--monthly`, it is the same stretch of the previous month, from its first day to the same day and time. On 26 November at 17:18 that is 1 October to 26 October at 17:18. A whole previous month would make every month look cheaper until its last day. When the previous month has fewer days than the current one has reached, the previous period is that whole month.

The change is this period's cost minus the previous period's, in dollars and as a percent of the previous cost. The percent is left out when the previous period cost nothing. The current figures are the ones in the report above the block. With profiles, the block adds up every profile, and each profile is priced with its own pricing file and region.

A `--json` report gets a `compare` key. `until` is exclusive, and the current period ends when the command started. `changePercent` is null when the previous period cost nothing, and `byModel` is there only with `--by-model`:

```json
"compare": {
  "against": "previous",
  "current": { "since": "2026-11-19T15:18:44.000Z", "until": "2026-11-26T15:18:44.000Z", "total": { "costUSD": 43.6, "...": "..." } },
  "previous": { "since": "2026-11-12T15:18:44.000Z", "until": "2026-11-19T15:18:44.000Z", "total": { "costUSD": 42.45, "...": "..." } },
  "changeUSD": 1.15,
  "changePercent": 2.7,
  "byModel": {
    "claude-opus-5-5": { "currentUSD": 12.4, "previousUSD": 20.35, "changeUSD": -7.95, "changePercent": -39.1 }
  }
}
```

The previous period is a second scan, which the usage store keeps fast. With `--no-cache` the run reads every transcript twice. Usage in the previous period is priced like the rest, so a model that only the previous period used and the pricing file lacks gets the same warning, and `--strict` exits with status 1. This differs from the other reports, where usage before `--since` does not count.

`--compare` cannot be combined with `--by-month`, which already lists every month, or with `--dashboard`, which has its own comparison. See [Dashboard](#dashboard).

## Unreadable transcript lines

Claude Code does not document the transcript format, so a new version may change it. The parser counts every line that has a `"usage"` key and that it cannot use:

- The line is not valid JSON.
- The line is an assistant record with no `usage` object, for example because the object moved.
- The `usage` object has no recognized token count, or a count that is not a number, for example because the fields were renamed.

Each run that finds such lines prints a warning on stderr with the counts and the first failing file and byte offset:

```text
claude-cost: warning: 3 of 12,040 transcript lines with usage could not be read (2 not valid JSON, 1 without recognized token counts). Totals may be too low, and Claude Code may have changed its transcript format. First: ~/.claude/projects/proj/a.jsonl, byte 5120: not valid JSON.
```

`--json` reports the counts as `skippedLines`, and `--strict` exits with status 1. The usage store saves the counts for each transcript, so the warning stays on later runs. It clears when the transcript is rewritten or `--rebuild-cache` reads it again and finds nothing wrong. Counts for a deleted transcript stay, like its usage. A store saved before this check has no counts until `--rebuild-cache`. A last line without a newline is not counted, because Claude Code may still be writing it. A format change that renames the `"usage"` key itself is not detected, because the parser skips lines without that key.

## Usage store

Each run saves the usage it reads in `data/`, next to the program, with one file per transcript directory. `~/.claude/projects` is stored in `data/claude-projects-<hash>.json`. The next run reads only what changed: a transcript with the same size and modification time is skipped, and one that grew is read from where the last run stopped. On 285 MB of transcripts, a run went from 0.66 s to 0.21 s.

Claude Code deletes CLI transcripts after [`cleanupPeriodDays`](https://code.claude.com/docs/en/data-usage#data-retention), 30 days by default. Sessions started or last continued in Claude Desktop are exempt. When a transcript is deleted, its usage stays in the store and keeps counting in every report. The table then adds a line like "Includes 12 deleted transcript(s) kept in the usage store", and `--json` reports the same count as `archivedTranscripts`.

That makes `data/` the only copy of that history, so treat it like data:

- Back it up with `--backup`, described [below](#back-up-the-store). `git clean -fdx` deletes `data/`, because it is in `.gitignore`. Plain `git clean -fd` leaves it alone.
- `--rebuild-cache` reads every transcript on disk again but keeps the usage of deleted ones. Use it when you suspect the store is wrong.
- `--no-cache` ignores the store and does not write it. Totals then cover only the transcripts still on disk.
- Deleting a file in `data/` is the only way to drop stored history.
- A store that cannot be parsed is renamed to `*.corrupt-<time>` and rebuilt from the transcripts on disk. Nothing is deleted.

The store saves the raw `usage` object of each message, not computed costs. Pricing, region and parser fixes apply to stored history the same as to live transcripts. To keep it small, the store leaves out fields that are zero or empty and saves one record per message, where a transcript often repeats a message once per content block.

To keep the store somewhere else, set `storeDir` in `settings.config.json`. A relative path is resolved against that file's folder:

```json
{ "storeDir": "~/.local/share/claude-cost" }
```

To keep CLI transcripts longer in the first place, raise `cleanupPeriodDays` in `~/.claude/settings.json`. The store only has what some run has read. A transcript created and deleted between two runs is lost.

### Back up the store

`--backup <path>` copies the store files into a new folder inside `<path>` and exits. It reads no transcripts, prints no report and cannot be combined with other options.

```bash
claude-cost --backup ~/Documents/claude-cost-backups
```

```text
Backed up 2 usage store files to /Users/me/Documents/claude-cost-backups/claude-cost-backup-2026-11-25T08-44-43-012Z
```

Each run makes a new `claude-cost-backup-<time>` folder, with the time in UTC, and never overwrites or deletes anything in `<path>`. A fixed folder name would be unsafe. If `data/` is deleted, the next run rebuilds it from the transcripts still on disk, and a backup of that smaller store over the old files would destroy the history the backup exists to keep. Delete old backup folders yourself when you no longer need them.

The copy holds the store as the last run that read transcripts left it. Run `claude-cost` first if the backup should include today's transcripts. It includes any `*.corrupt-<time>` files, which can hold history that exists nowhere else. It leaves out `dashboard.html`.

`<path>` must be outside the store folder, because deleting the store would delete a backup inside it. Pick a folder on another disk or in a synced folder, so one failure does not take both copies.

To restore, copy the files from a backup folder into the store folder, which is `data/` unless you set `storeDir`. Usage from deleted transcripts counts again in the next report.

## Use from any Claude session

The repo ships a Claude Code skill in `.claude/skills/claude-cost`. Once it's linked into your user skills folder, Claude in any workspace can answer "how much have I spent this month?" by running this CLI. To link it, run this from the clone:

```bash
mkdir -p ~/.claude/skills
ln -s "$PWD/.claude/skills/claude-cost" ~/.claude/skills/claude-cost
```

Skills are read per config directory. If you use `CLAUDE_CONFIG_DIR` or keep several accounts, repeat the link for each one, for example `~/.claude-work/skills`. Because these are links, changes you pull into the clone apply right away.

Claude asks once before it runs the skill. To skip that prompt, add `Skill(claude-cost)` to `permissions.allow` in your settings.

## Development

The implementation, CLI entry point, dashboard and tests are TypeScript. Shared interfaces in `src/types.ts` describe usage events, raw usage records, pricing, store entries, reports and dashboard data. Configuration files still receive their existing runtime validation; transcript fields follow the provider schema after the parser checks their object shape.

```bash
npm ci                 # installs tools and builds through the prepare hook
npm run typecheck      # strict checking, including tests and the dashboard DOM
npm run build          # emits JavaScript and source maps into dist/
npm test               # runs the Node tests on the TypeScript sources
npm run test:coverage  # runs the tests and prints a coverage report
npm run smoke          # builds, then runs the compiled CLI and dashboard once
npm run format:check   # checks source formatting
npm run lint           # runs oxlint with type-aware rules
```

`npm start`, `npm run monthly`, `npm run history` and `npm run dashboard` run the TypeScript entry point directly using Node 24.15+'s built-in type stripping. These commands work without a build or installed development tools. Source dashboard runs strip the types from `src/dashboard/app.ts` and inline the HTML, CSS and icons from that folder, so edits apply on the next run. After a build, `node dist/bin/claude-cost.js` runs without TypeScript or other runtime dependencies.

The build copies the HTML, CSS and icons beside the compiled dashboard renderer. The compiler removes types and type-only imports before the browser script is embedded in the standalone offline page. Both source and compiled CLI runs use configuration files and `data/` at the project root. The installed `claude-cost` command points to `dist/bin/claude-cost.js`.

### Transcript fixtures

`test/transcripts` holds real usage records from several Claude Code versions, each with an `.expected.json` file of the events they must give. `test/transcript-drift.test.ts` checks them, and `test/transcript-fuzz.test.ts` mutates them with a seeded generator. `FUZZ_SEED` and `FUZZ_RUNS` change the seed and the number of runs. A failure prints its seed and run number.

When a new Claude Code version changes the usage format, add a fixture for it. The script keeps the usage object as written and replaces ids and timestamps. It drops message text.

```bash
node scripts/sanitize-transcript.ts ~/.claude/projects test/transcripts <new-version>
```

It writes a `.jsonl` file and an `.expected.json` file for each version you list. Check the expected file by hand against the transcript, then run `npm test`.

### Git hooks

The hooks are plain shell scripts in `.githooks`. Git does not use that folder by default, so run this once per clone:

```bash
npm run hooks:install   # git config core.hooksPath .githooks
```

`pre-commit` checks formatting of the staged files with Prettier, then runs `npm run typecheck` and `npm run lint`. `pre-push` runs `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm run test:coverage` and `npm run smoke`. The standalone typecheck includes scripts and the Claude skill wrapper that the test build excludes. To skip a hook once, pass `--no-verify` to `git commit` or `git push`.

## License

MIT
