# My PRs — local dashboard

A live, local view of the GitHub pull requests you need to act on. Fetches through your
`gh` CLI auth on every refresh, categorizes each PR, and serves a small React dashboard on
`localhost:7337`.

## Launch

```bash
cd ~/pr-dashboard && npm install && npm run dev
```

Opens `http://localhost:7337` automatically (in Dia; set `BROWSER=Chrome` to override).
Auto-refreshes every 90s; the **Refresh** button forces a fresh fetch.

## Requirements

- `gh` authenticated (`gh auth status`)
- Node 18+

## Configuration

By default the dashboard shows every open PR you author, are asked to review, or have
reviewed — across **all** orgs. To scope it to specific organizations, either:

- set `PR_DASH_ORGS` (comma-separated), e.g. `PR_DASH_ORGS=my-org,other-org npm run dev`, or
- copy `pr-dashboard.config.example.json` to `pr-dashboard.config.json` and list the orgs:

  ```json
  { "orgs": ["my-org"] }
  ```

The env var wins over the config file. An empty list means no org filter.

Set `PR_DASH_NO_OPEN=1` to skip auto-opening the browser.

## Sections

- **Reviews to do** — review requested from you
- **Ready to merge** — your PRs, approved, green, no conflict
- **Approved, blocked** — your PRs, approved but conflicts or red CI
- **Awaiting review** — your PRs waiting on a reviewer
- **Changes requested** — a reviewer is blocking your PR
- **I approved (others)** — others' PRs you approved
- **I requested changes** — others' PRs you're blocking
- **Drafts** — your drafts

## Configure it for a specific project

There's a bundled Claude Code skill (`.claude/skills/pr-dashboard/`) that launches,
configures, and troubleshoots the dashboard for any set of orgs.
