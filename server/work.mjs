import {searchItems} from "./items.mjs"
import {viewer} from "./gh.mjs"

const STALE_DAYS = 14

function daysAgo(n) {
    return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
}

function ageDays(iso) {
    if (!iso) return null
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

/**
 * Condense the pull requests linked to an issue into the one line the Issues
 * view needs: is work in flight, is it merged (so the issue can be closed), or
 * has nobody started.
 */
function summarizePrs(prs) {
    const list = prs || []
    if (list.length === 0) return {count: 0, state: "none", primary: null, hasOpen: false, hasMerged: false}
    const open = list.filter((p) => p.state === "OPEN")
    const merged = list.filter((p) => p.state === "MERGED")
    const primary =
        [...open].sort((a, b) => Number(a.isDraft) - Number(b.isDraft) || (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0] ||
        [...merged].sort((a, b) => (b.mergedAt || "").localeCompare(a.mergedAt || ""))[0] ||
        list[0]
    let state = "closed"
    if (open.length) state = open.every((p) => p.isDraft) ? "draft" : "open"
    else if (merged.length) state = "merged"
    return {count: list.length, state, primary, hasOpen: open.length > 0, hasMerged: merged.length > 0}
}

/**
 * One GraphQL sweep of everything that could be "on my plate": issues and PRs
 * assigned to, authored by, or mentioning me, plus what closed recently.
 * Both the Issues and the Boards views are derived from this single sweep.
 */
export async function getWork() {
    const me = await viewer()
    const since = daysAgo(7)
    const {items, errors, warnings, features} = await searchItems([
        {source: "assignedIssue", query: "is:issue is:open assignee:@me"},
        {source: "authoredIssue", query: "is:issue is:open author:@me"},
        {source: "mentionedIssue", query: "is:issue is:open mentions:@me"},
        {source: "assignedPr", query: "is:pr is:open assignee:@me"},
        {source: "authoredPr", query: "is:pr is:open author:@me"},
        {source: "closedRecently", query: `is:issue is:closed assignee:@me closed:>=${since}`},
        {source: "mergedRecently", query: `is:pr is:merged author:@me merged:>=${since}`},
    ])

    for (const item of items) {
        item.mine = item.author === me
        item.assignedToMe = item.assignees.includes(me)
        item.ageDays = ageDays(item.updatedAt)
        item.openedDays = ageDays(item.createdAt)
        item.stale = item.state === "OPEN" && item.ageDays !== null && item.ageDays >= STALE_DAYS
        item.prSummary = summarizePrs(item.linkedPrs)
    }

    return {me, items, errors, warnings, features, staleDays: STALE_DAYS}
}

/** Bucket the sweep into the Issues view. */
export function groupIssues(work) {
    const issues = work.items.filter((i) => i.kind === "issue")
    const has = (i, s) => i.sources.includes(s)
    const groups = {
        prMerged: [],
        assigned: [],
        assignedStale: [],
        mentioned: [],
        authored: [],
        closedRecently: [],
    }
    for (const issue of issues) {
        if (issue.state !== "OPEN") {
            if (has(issue, "closedRecently")) groups.closedRecently.push(issue)
            continue
        }
        // A merged PR on a still-open issue is its own action: close the issue.
        if ((issue.assignedToMe || has(issue, "authoredIssue")) && issue.prSummary?.state === "merged") {
            groups.prMerged.push(issue)
            continue
        }
        if (issue.assignedToMe) {
            if (issue.stale) groups.assignedStale.push(issue)
            else groups.assigned.push(issue)
            continue
        }
        if (has(issue, "authoredIssue")) {
            groups.authored.push(issue)
            continue
        }
        if (has(issue, "mentionedIssue")) groups.mentioned.push(issue)
    }
    const byUpdated = (a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")
    for (const key of Object.keys(groups)) groups[key].sort(byUpdated)
    groups.closedRecently.sort((a, b) => (b.closedAt || "").localeCompare(a.closedAt || ""))
    return groups
}

const STATUS_ORDER = [
    /in ?review|review|relecture/i,
    /in ?progress|doing|en cours|wip|started/i,
    /blocked|on hold/i,
    /ready|to ?do|next/i,
    /backlog|triage|new|icebox/i,
    /done|shipped|closed/i,
]

function statusRank(status) {
    if (!status) return STATUS_ORDER.length
    const idx = STATUS_ORDER.findIndex((re) => re.test(status))
    return idx === -1 ? STATUS_ORDER.length : idx
}

function epicOf(item, board) {
    if (board?.epic?.value) return {label: String(board.epic.value), source: board.epic.field}
    if (item.parent) return {label: `#${item.parent.number} ${item.parent.title}`, source: "sub-issue", url: item.parent.url}
    const epicLabel = item.labels.find((l) => /^(epic|theme|initiative)[:/ ]/i.test(l.name))
    if (epicLabel) return {label: epicLabel.name, source: "label"}
    if (item.milestone) return {label: item.milestone.title, source: "milestone"}
    return null
}

function groupBy(rows, keyOf, metaOf) {
    const out = new Map()
    for (const row of rows) {
        const key = keyOf(row) ?? " none"
        if (!out.has(key)) out.set(key, {key, meta: metaOf(row), rows: []})
        out.get(key).rows.push(row)
    }
    return [...out.values()]
}

/**
 * Reshape the sweep into board (Projects v2) rows: one row per item x project,
 * with the sprint / epic / status / priority the board carries for it.
 */
export function groupBoards(work) {
    const rows = []
    for (const item of work.items) {
        if (item.state !== "OPEN") continue
        if (!item.assignedToMe && !(item.kind === "pr" && item.mine)) continue
        for (const board of item.boards) {
            if (board.project.closed) continue
            rows.push({
                key: `${item.url}#${board.project.url || board.project.title}`,
                item,
                project: board.project,
                status: board.status?.value || null,
                iteration: board.iteration || null,
                epic: epicOf(item, board),
                priority: board.priority?.value || null,
                estimate: board.estimate?.value ?? null,
                due: board.due?.value || null,
                area: board.area?.value || null,
                extraFields: board.fields,
            })
        }
    }

    const projects = new Map()
    for (const row of rows) {
        const key = row.project.url || row.project.title
        if (!projects.has(key)) {
            projects.set(key, {
                title: row.project.title,
                number: row.project.number,
                url: row.project.url,
                rows: [],
                sprints: [],
                epics: [],
                statuses: [],
                points: 0,
            })
        }
        projects.get(key).rows.push(row)
    }

    for (const project of projects.values()) {
        project.rows.sort(
            (a, b) =>
                statusRank(a.status) - statusRank(b.status) ||
                (b.iteration?.current ? 1 : 0) - (a.iteration?.current ? 1 : 0) ||
                (b.item.updatedAt || "").localeCompare(a.item.updatedAt || ""),
        )
        project.sprints = groupBy(
            project.rows,
            (r) => r.iteration?.title || null,
            (r) => ({
                title: r.iteration?.title || "No sprint",
                current: !!r.iteration?.current,
                startDate: r.iteration?.startDate || null,
                duration: r.iteration?.duration || null,
            }),
        )
        project.sprints.sort(
            (a, b) =>
                (b.meta.current ? 1 : 0) - (a.meta.current ? 1 : 0) ||
                (b.meta.startDate || "").localeCompare(a.meta.startDate || ""),
        )
        project.epics = groupBy(
            project.rows,
            (r) => r.epic?.label || null,
            (r) => ({title: r.epic?.label || "No epic", url: r.epic?.url || null, source: r.epic?.source || null}),
        )
        project.epics.sort((a, b) => b.rows.length - a.rows.length || a.meta.title.localeCompare(b.meta.title))
        project.statuses = groupBy(
            project.rows,
            (r) => r.status || null,
            (r) => ({title: r.status || "No status"}),
        )
        project.statuses.sort((a, b) => statusRank(a.meta.title) - statusRank(b.meta.title))
        project.points = project.rows.reduce((n, r) => n + (typeof r.estimate === "number" ? r.estimate : 0), 0)
    }

    const list = [...projects.values()].sort((a, b) => b.rows.length - a.rows.length)
    const onABoard = new Set(rows.map((r) => r.item.url))
    const noBoard = work.items.filter((i) => i.state === "OPEN" && i.assignedToMe && !onABoard.has(i.url))

    return {
        projects: list,
        rows,
        noBoard,
        currentSprint: list.flatMap((p) =>
            p.sprints.filter((s) => s.meta.current).map((s) => ({project: p.title, projectUrl: p.url, ...s})),
        ),
    }
}
