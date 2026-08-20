import {ORGS, EXTRA_REPOS, makeCache, cleanMessage, viewer} from "./gh.mjs"
import {getPrs} from "./prs.mjs"
import {getWork, groupIssues, groupBoards} from "./work.mjs"
import {getNotifications} from "./notifications.mjs"

const CACHE_MS = 60_000
const cache = makeCache(CACHE_MS)

const ALL_SECTIONS = ["prs", "work", "notifications"]

async function section(name, load, force) {
    try {
        return {ok: true, data: await cache.get(name, load, force)}
    } catch (e) {
        return {ok: false, error: cleanMessage(e)}
    }
}

/** Merge the board metadata found in the work sweep into the PR cards. */
function attachBoards(prGroups, work) {
    if (!work) return
    const byUrl = new Map(work.items.map((i) => [i.url, i]))
    for (const [key, list] of Object.entries(prGroups)) {
        if (key === "errors") continue
        for (const pr of list) {
            const match = byUrl.get(pr.url)
            if (match) {
                pr.boards = match.boards
                pr.parent = match.parent || null
                if (!pr.milestone && match.milestone) pr.milestone = match.milestone
            }
        }
    }
}

function prCount(groups, keys) {
    return keys.reduce((n, k) => n + (groups[k]?.length || 0), 0)
}

const URGENCY = {now: 0, soon: 1, later: 2}

function focusList({prs, issues, notifications, boards}) {
    const focus = []
    const push = (entry) => focus.push(entry)

    for (const pr of prs?.groups.reviewsToDo || []) {
        push({
            urgency: "now",
            lane: "review",
            title: pr.title,
            url: pr.url,
            repo: pr.repo,
            number: pr.number,
            why: pr.sources?.includes("requested") ? "Your review is requested" : "Assigned to you",
            updatedAt: pr.updatedAt,
        })
    }
    for (const pr of prs?.groups.readyToMerge || []) {
        push({urgency: "now", lane: "merge", title: pr.title, url: pr.url, repo: pr.repo, number: pr.number, why: "Approved and green — merge it", updatedAt: pr.updatedAt})
    }
    for (const pr of prs?.groups.changesRequested || []) {
        push({urgency: "now", lane: "fix", title: pr.title, url: pr.url, repo: pr.repo, number: pr.number, why: "A reviewer is blocking your PR", updatedAt: pr.updatedAt})
    }
    for (const pr of prs?.groups.approvedBlocked || []) {
        push({
            urgency: "now",
            lane: "fix",
            title: pr.title,
            url: pr.url,
            repo: pr.repo,
            number: pr.number,
            why: pr.ci.fail > 0 ? `Approved but ${pr.ci.label}` : "Approved but conflicting",
            updatedAt: pr.updatedAt,
        })
    }
    for (const n of notifications?.groups.todo || []) {
        if (!["review_requested", "mention", "team_mention", "assign", "approval_requested", "security_alert"].includes(n.reason)) continue
        push({urgency: "now", lane: "inbox", title: n.title, url: n.url, repo: n.repo, number: n.number, why: `Unread — ${n.reasonLabel}`, updatedAt: n.updatedAt})
    }
    for (const row of boards?.rows || []) {
        if (!row.iteration?.current) continue
        if (/done|shipped|closed/i.test(row.status || "")) continue
        push({
            urgency: "soon",
            lane: "sprint",
            title: row.item.title,
            url: row.item.url,
            repo: row.item.repo,
            number: row.item.number,
            why: `${row.project.title} — ${row.iteration.title}${row.status ? ` · ${row.status}` : ""}`,
            updatedAt: row.item.updatedAt,
        })
    }
    for (const n of notifications?.groups.newActivity || []) {
        push({urgency: "soon", lane: "inbox", title: n.title, url: n.url, repo: n.repo, number: n.number, why: "New activity since you last read it", updatedAt: n.updatedAt})
    }
    for (const issue of issues?.prMerged || []) {
        push({
            urgency: "later",
            lane: "close",
            title: issue.title,
            url: issue.url,
            repo: issue.repo,
            number: issue.number,
            why: `PR #${issue.prSummary.primary.number} merged — close the issue?`,
            updatedAt: issue.updatedAt,
        })
    }
    for (const issue of issues?.assignedStale || []) {
        push({urgency: "later", lane: "stale", title: issue.title, url: issue.url, repo: issue.repo, number: issue.number, why: `Assigned, untouched for ${issue.ageDays}d`, updatedAt: issue.updatedAt})
    }
    for (const n of notifications?.groups.forgotten || []) {
        push({urgency: "later", lane: "inbox", title: n.title, url: n.url, repo: n.repo, number: n.number, why: "Read but never cleared — still open", updatedAt: n.updatedAt})
    }

    const seen = new Set()
    return focus
        .filter((f) => {
            const key = `${f.lane}:${f.url}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
        .sort((a, b) => URGENCY[a.urgency] - URGENCY[b.urgency] || (b.updatedAt || "").localeCompare(a.updatedAt || ""))
}

function buildStats({prs, issues, notifications, boards}) {
    return {
        reviewsToDo: prs ? prs.groups.reviewsToDo.length : null,
        myOpenPrs: prs ? prCount(prs.groups, ["readyToMerge", "approvedBlocked", "awaitingReview", "changesRequested", "drafts"]) : null,
        readyToMerge: prs ? prs.groups.readyToMerge.length : null,
        blockedPrs: prs ? prCount(prs.groups, ["approvedBlocked", "changesRequested"]) : null,
        assignedIssues: issues
            ? issues.assigned.length + issues.assignedStale.length + issues.prMerged.filter((i) => i.assignedToMe).length
            : null,
        staleIssues: issues ? issues.assignedStale.length : null,
        issuesToClose: issues ? issues.prMerged.length : null,
        issuesWithoutPr: issues ? issues.assigned.concat(issues.assignedStale).filter((i) => i.prSummary?.state === "none").length : null,
        unread: notifications ? notifications.groups.todo.length : null,
        forgotten: notifications ? notifications.groups.forgotten.length + notifications.groups.newActivity.length : null,
        clearable: notifications ? notifications.groups.handled.length : null,
        sprintItems: boards ? boards.rows.filter((r) => r.iteration?.current).length : null,
        boardItems: boards ? boards.rows.length : null,
        projects: boards ? boards.projects.length : null,
        closedThisWeek: issues ? issues.closedRecently.length : null,
    }
}

/**
 * The whole dashboard: PRs, issues, the notification inbox and the project
 * boards. Every source is fetched and cached independently, so one failing
 * (a missing token scope, say) still leaves the rest usable.
 */
export async function getDashboard({force = false, sections = ALL_SECTIONS} = {}) {
    const wanted = new Set(sections.length ? sections : ALL_SECTIONS)
    const [prsRes, workRes, notifRes] = await Promise.all([
        wanted.has("prs") ? section("prs", getPrs, force) : section("prs", getPrs, false),
        wanted.has("work") ? section("work", getWork, force) : section("work", getWork, false),
        wanted.has("notifications") ? section("notifications", getNotifications, force) : section("notifications", getNotifications, false),
    ])

    const work = workRes.ok ? workRes.data : null
    const prs = prsRes.ok ? prsRes.data : null
    const notifications = notifRes.ok ? notifRes.data : null
    const issues = work ? groupIssues(work) : null
    const boards = work ? groupBoards(work) : null
    if (prs && work) attachBoards(prs.groups, work)

    let me = prs?.me || work?.me || notifications?.me || ""
    if (!me) {
        try {
            me = await viewer()
        } catch {
            me = ""
        }
    }

    const errors = []
    if (!prsRes.ok) errors.push({source: "pull requests", error: prsRes.error})
    if (!workRes.ok) errors.push({source: "issues & boards", error: workRes.error})
    if (!notifRes.ok) errors.push({source: "notifications", error: notifRes.error})
    for (const e of work?.errors || []) errors.push({source: `search (${e.source})`, error: e.error})
    for (const e of prs?.groups.errors || []) errors.push({source: e.url, error: e.error})

    return {
        me,
        generatedAt: new Date().toISOString(),
        scope: {orgs: ORGS, repos: EXTRA_REPOS},
        prs: prs ? prs.groups : null,
        issues,
        boards,
        notifications: notifications ? {groups: notifications.groups, reasons: notifications.reasons, total: notifications.total, truncated: notifications.truncated} : null,
        focus: focusList({prs, issues, notifications, boards}),
        stats: buildStats({prs, issues, notifications, boards}),
        features: work?.features || null,
        warnings: work?.warnings || [],
        errors,
        staleDays: work?.staleDays ?? 14,
    }
}
