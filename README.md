# GitHub dashboard — local

Everything GitHub is waiting on you for, in one local page: pull requests, issues, your
notification inbox (including the ones you opened and then forgot), and your project-board
tasks by sprint and epic. Reads through your `gh` CLI auth on every refresh and serves a
small React app on `localhost:7337`.

## Launch

```bash
cd ~/pr-dashboard && npm install && npm run dev
```

Opens `http://localhost:7337` automatically (in Dia; set `BROWSER=Chrome` to override).
Auto-refreshes every 120s — the **auto** button pauses it, **Refresh** forces a fetch.

## Requirements

- `gh` authenticated (`gh auth status`), with two extra scopes for the full dashboard:

  ```bash
  gh auth refresh -s notifications,read:project
  ```

  Without `notifications` the Notifications tab is empty; without `read:project` the Boards
  tab is empty. Everything else keeps working — the dashboard degrades per source and tells
  you what is missing.
- Node 18+.

## Tabs

- **Focus** — one ranked list of what to do: *Do now* (reviews requested from you, merges
  ready, your blocked PRs, unread mentions), *Do next* (current-sprint items, threads that
  moved since you read them), *Cleanup* (stale assignments, notifications you never cleared).
  The tiles on top are clickable and jump to the matching tab.
- **Pull requests** — reviews to do, ready to merge, approved-but-blocked, changes requested,
  awaiting review, ones you approved or are blocking, drafts. Each card carries CI status,
  mergeability, diff size, labels, reviewers and its board status.
- **Issues** — assigned to you, assigned but going stale (14+ days idle), mentions waiting on
  you, ones you opened, and what you closed this week.
- **Notifications** — the part GitHub's own inbox hides:
  - *Unread* — nothing looked at yet.
  - *Moved since you read it* — you read it, then someone commented or pushed.
  - *Opened, then forgotten* — read, never cleared, and the issue or PR is **still open**.
  - *Handled, safe to clear* — read and the subject is now closed or merged.
  - Filterable by notification reason (review requested, mention, CI, …).
- **Boards** — your Projects v2 items grouped by **sprint** (the running iteration is
  highlighted), **epic**, **status** or **priority**, with story points per group, due dates
  and a "current sprint only" toggle. Epics are read from an `Epic`-style board field, else
  the sub-issue parent, else an `epic:`-prefixed label, else the milestone. Items assigned to
  you that sit on no board get their own section, so nothing hides.

Shortcuts: <kbd>1</kbd>–<kbd>5</kbd> switch tabs, <kbd>/</kbd> focuses the filter box,
<kbd>r</kbd> refreshes. The filter box searches titles, repos, authors, labels, projects,
sprints and epics across the active tab.

## Configuration

By default the dashboard covers **all** orgs you touch. To scope it, either:

- set `PR_DASH_ORGS` (comma-separated), e.g. `PR_DASH_ORGS=my-org,other-org npm run dev`, or
- copy `pr-dashboard.config.example.json` to `pr-dashboard.config.json`:

  ```json
  { "orgs": ["my-org"], "repos": ["other-org/one-repo"] }
  ```

`repos` adds individual repositories that fall outside those orgs. Env vars win over the file
(`PR_DASH_REPOS` for repos); empty lists mean no filter.

Other env vars: `PR_DASH_PORT` (default 7337), `PR_DASH_NO_OPEN=1` to skip opening a browser.

## How it works

- `server/prs.mjs` — `gh search prs` (authored / review-requested / reviewed / assigned) then
  `gh pr view` per PR for CI and review state.
- `server/items.mjs` + `server/work.mjs` — one GraphQL sweep of issues and PRs assigned to,
  authored by or mentioning you, with their Projects v2 field values (status, sprint, epic,
  priority, estimate, due date). Both the Issues and the Boards tabs come from this sweep.
- `server/notifications.mjs` — `/notifications?all=true`, then a batched GraphQL lookup of
  each subject's open/closed/merged state — that state is what separates "forgotten" from
  "handled".
- `server/dashboard.mjs` — merges the three sources, ranks the Focus list, and caches each
  source independently for 60s so one failure never blanks the page.

Read-only throughout: the dashboard never merges, comments or mutates anything.

Endpoints: `/api/dashboard` (`?force=1` to bypass the cache) and `/api/prs` (PRs only).

## Configure it for a specific project

There's a bundled Claude Code skill (`.claude/skills/pr-dashboard/`) that launches,
configures and troubleshoots the dashboard for any set of orgs.
