---
name: pr-dashboard
description: "Launch, configure, and troubleshoot the local GitHub dashboard — a React app that shows everything waiting on you on GitHub via your gh CLI auth: pull requests (to review, ready to merge, blocked, drafts), issues (assigned, stale, mentions), the notification inbox (unread, moved-since-read, opened-and-forgotten, clearable) and project-board tasks by sprint and epic. Use when the user wants to open/start their PR or GitHub dashboard, scope it to specific GitHub orgs or repos, or fix it when a tab shows nothing or errors."
argument-hint: "[orgs]"
---

# GitHub dashboard

A local dashboard of everything GitHub is waiting on you for. It shells out to the `gh` CLI on
every refresh and serves a React UI on `http://localhost:7337` with five tabs: **Focus**,
**Pull requests**, **Issues**, **Notifications**, **Boards**.

Use this skill to **launch**, **configure** (which orgs/repos), or **troubleshoot** it.

## Prerequisites

- `gh` authenticated — `gh auth status` (the dashboard has no auth of its own; it uses yours).
- Two extra token scopes for the full dashboard:
  `gh auth refresh -s notifications,read:project`
  — `notifications` powers the Notifications tab, `read:project` the Boards tab. Each source
  degrades on its own: missing scopes empty one tab and print a warning, nothing else breaks.
- Node 18+.

## Launch

```bash
cd ~/pr-dashboard && npm install && npm run dev
```

Opens `http://localhost:7337` automatically and auto-refreshes every 120s. Set `BROWSER=<app>`
to choose the browser, `PR_DASH_NO_OPEN=1` for none, `PR_DASH_PORT=<n>` for another port
(`strictPort` is on, so a taken port fails fast instead of drifting).

Shortcuts in the UI: <kbd>1</kbd>–<kbd>5</kbd> tabs, <kbd>/</kbd> filter box, <kbd>r</kbd> refresh.

## Configure the scope

By default it covers **all** orgs you touch. To scope it:

- **One-off**: `PR_DASH_ORGS=org-a,org-b npm run dev` (and `PR_DASH_REPOS=org-c/repo`).
- **Persistent**: write `pr-dashboard.config.json` at the repo root:

  ```json
  { "orgs": ["org-a", "org-b"], "repos": ["org-c/one-repo"] }
  ```

  (`pr-dashboard.config.example.json` is the template.) Env vars win over the file; empty lists
  mean no filter. `repos` pulls in individual repositories outside the listed orgs. This config
  file is git-ignored — it's personal to your checkout.

## What lands where (so you can reason about what shows up)

- **Pull requests** — from `gh search prs` (authored / review-requested / reviewed / assigned),
  then `gh pr view` per PR. Your PRs: draft → `drafts`; approved + green + no conflict →
  `readyToMerge`; approved but conflicting/red → `approvedBlocked`; changes requested →
  `changesRequested`; else `awaitingReview`. Others' PRs: review requested from you (or assigned
  to you, unreviewed) → `reviewsToDo`; you requested changes → `iBlocked`; else `iApproved`.
- **Issues / Boards** — one GraphQL sweep of issues and PRs assigned to, authored by or
  mentioning you, carrying their Projects v2 field values. Issues bucket into assigned, assigned
  &-stale (14+ days idle), mentions, authored, closed-this-week, plus PR-merged-issue-still-open.
  Each issue also carries its linked PRs (from `closedByPullRequestsReferences`, i.e. PRs that
  would close it — not plain mentions) with state, CI, review decision and conflicts, and its
  sub-issue progress. The Issues toolbar filters on that: PR in flight / PR merged / no PR yet. Board rows group by sprint
  (iteration field, current one detected from its start date and duration), epic, status or
  priority. Epic resolution order: `Epic`-style board field → sub-issue parent → `epic:` label →
  milestone.
- **Notifications** — `/notifications?all=true` plus a batched GraphQL lookup of each subject's
  state, which is what splits *unread* / *moved since you read it* / *opened then forgotten*
  (read, uncleared, still open) / *handled, safe to clear* (read, closed or merged).
- **Focus** — a ranked cross-source list (now / next / cleanup) built in `server/dashboard.mjs`.

## Troubleshoot

- **A single tab is empty** → check the warning banner: it names the missing scope. Run
  `gh auth refresh -s notifications,read:project`.
- **No PR info on issues** → older GitHub Enterprise lacks
  `closedByPullRequestsReferences`; the sweep drops the field, warns, and the Issues tab hides
  the PR badges and filter rather than claiming every issue has no PR.
- **Everything empty** → `gh auth status`; check the org filter isn't excluding it all
  (`echo $PR_DASH_ORGS`, inspect `pr-dashboard.config.json`); hit
  `/api/dashboard?force=1` to bypass the 60s cache and read the `errors` and `warnings` arrays.
- **Partial-data banner** → each entry names its source and the `gh` error verbatim; the rest of
  the dashboard is still live.
- **Slow first load** → PR details are fetched with one `gh pr view` per PR (6 in flight) and
  every source is cached 60s; a large PR set is slower on first paint.
- **Wrong CI/state** → the data mirrors `gh pr view --json …`; if `gh` shows it differently, the
  dashboard will too.

## Rules

- Read-only: this dashboard only *reads* GitHub via `gh`; it never merges, comments, or mutates.
- Never print or commit a `gh` token; `pr-dashboard.config.json` stays git-ignored.
