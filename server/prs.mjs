import {gh, ghJson, inScope, pool, viewer, cleanMessage} from "./gh.mjs"

function summarizeCi(rollup) {
    const checks = rollup || []
    let fail = 0
    let pending = 0
    let gated = 0
    const failing = []
    for (const x of checks) {
        const conclusion = (x.conclusion || "").toUpperCase()
        const status = (x.status || "").toUpperCase()
        const state = (x.state || "").toUpperCase()
        if (["FAILURE", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE"].includes(conclusion) || ["FAILURE", "ERROR"].includes(state)) {
            fail++
            if (failing.length < 4) failing.push(x.name || x.context || "check")
        } else if (conclusion === "ACTION_REQUIRED" || status === "ACTION_REQUIRED") {
            gated++
        } else if (["IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED"].includes(status) || state === "PENDING" || (!conclusion && status && status !== "COMPLETED")) {
            pending++
        }
    }
    const total = checks.length
    let tone = "neutral"
    let label = "no checks"
    if (total === 0) {
        tone = "neutral"
        label = "no checks"
    } else if (fail > 0) {
        tone = "red"
        label = `${fail} failing`
    } else if (gated > 0) {
        tone = "orange"
        label = "gated"
    } else if (pending > 0) {
        tone = "blue"
        label = "running"
    } else {
        tone = "green"
        label = "passing"
    }
    return {fail, pending, gated, total, tone, label, failing}
}

function repoFromUrl(url) {
    const m = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url || "")
    return m ? m[1] : ""
}

function buildReviewers(latestReviews, reviewRequests) {
    const byLogin = new Map()
    for (const r of latestReviews || []) {
        const login = r.author?.login
        if (!login) continue
        byLogin.set(login, {login, state: r.state, team: false})
    }
    for (const r of reviewRequests || []) {
        const login = r.login || r.slug || r.name
        if (!login) continue
        if (!byLogin.has(login)) byLogin.set(login, {login, state: "REQUESTED", team: !r.login})
    }
    return [...byLogin.values()]
}

function effectiveMyReview(reviews, me) {
    const decisive = (reviews || []).filter((r) => r.author?.login === me && (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED"))
    if (decisive.length) return decisive[decisive.length - 1].state
    const commented = (reviews || []).some((r) => r.author?.login === me)
    return commented ? "COMMENTED" : null
}

function classify(pr, sources) {
    if (pr.mine) {
        if (pr.isDraft) return "drafts"
        if (pr.reviewDecision === "APPROVED") {
            const conflicts = pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY"
            if (conflicts || pr.ci.fail > 0) return "approvedBlocked"
            return "readyToMerge"
        }
        if (pr.reviewDecision === "CHANGES_REQUESTED") return "changesRequested"
        return "awaitingReview"
    }
    if (sources.has("requested")) return "reviewsToDo"
    if (sources.has("assigned") && !pr.myReview) return "reviewsToDo"
    if (pr.myReview === "CHANGES_REQUESTED") return "iBlocked"
    return "iApproved"
}

const LIST_FIELDS = "number,url,repository"
const DETAIL_FIELDS = [
    "number",
    "title",
    "url",
    "author",
    "isDraft",
    "reviewDecision",
    "mergeStateStatus",
    "mergeable",
    "statusCheckRollup",
    "reviews",
    "reviewRequests",
    "latestReviews",
    "labels",
    "assignees",
    "additions",
    "deletions",
    "changedFiles",
    "createdAt",
    "updatedAt",
].join(",")

export async function getPrs() {
    const me = await viewer()
    const [authored, requested, reviewed, assigned] = await Promise.all([
        ghJson(["search", "prs", "--author", "@me", "--state", "open", "--limit", "100", "--json", LIST_FIELDS]),
        ghJson(["search", "prs", "--review-requested", "@me", "--state", "open", "--limit", "100", "--json", LIST_FIELDS]),
        ghJson(["search", "prs", "--reviewed-by", "@me", "--state", "open", "--limit", "100", "--json", LIST_FIELDS]),
        ghJson(["search", "prs", "--assignee", "@me", "--state", "open", "--limit", "100", "--json", LIST_FIELDS]),
    ])

    const sourcesByUrl = new Map()
    const register = (list, src) => {
        for (const p of list || []) {
            if (!inScope(p.repository?.nameWithOwner || "")) continue
            const entry = sourcesByUrl.get(p.url) || new Set()
            entry.add(src)
            sourcesByUrl.set(p.url, entry)
        }
    }
    register(authored, "authored")
    register(requested, "requested")
    register(reviewed, "reviewed")
    register(assigned, "assigned")

    const urls = [...sourcesByUrl.keys()]
    const details = await pool(urls, 6, async (url) => {
        try {
            return await ghJson(["pr", "view", url, "--json", DETAIL_FIELDS])
        } catch (e) {
            return {url, error: cleanMessage(e)}
        }
    })

    const groups = {
        reviewsToDo: [],
        readyToMerge: [],
        approvedBlocked: [],
        awaitingReview: [],
        changesRequested: [],
        iApproved: [],
        iBlocked: [],
        drafts: [],
        errors: [],
    }

    for (const d of details) {
        const sources = sourcesByUrl.get(d.url) || new Set()
        if (d.error) {
            groups.errors.push({url: d.url, error: d.error})
            continue
        }
        const ci = summarizeCi(d.statusCheckRollup)
        const myReview = effectiveMyReview(d.reviews, me)
        const pr = {
            kind: "pr",
            repo: repoFromUrl(d.url),
            number: d.number,
            title: d.title,
            url: d.url,
            author: d.author?.login || "",
            isDraft: d.isDraft,
            reviewDecision: d.reviewDecision || null,
            mergeStateStatus: d.mergeStateStatus || null,
            mergeable: d.mergeable || null,
            labels: (d.labels || []).map((l) => ({name: l.name, color: l.color})),
            assignees: (d.assignees || []).map((a) => a.login),
            additions: d.additions ?? null,
            deletions: d.deletions ?? null,
            changedFiles: d.changedFiles ?? null,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
            ci,
            myReview,
            reviewers: buildReviewers(d.latestReviews, d.reviewRequests),
            mine: d.author?.login === me,
            sources: [...sources],
            boards: [],
        }
        const bucket = classify(pr, sources)
        groups[bucket].push(pr)
    }

    const rank = {red: 0, orange: 1, blue: 2, green: 3, neutral: 4}
    for (const key of Object.keys(groups)) {
        if (key === "errors") continue
        groups[key].sort((a, b) => rank[a.ci.tone] - rank[b.ci.tone] || (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    }

    return {me, groups}
}

/** Kept for the standalone /api/prs endpoint. */
export async function getPrsPayload() {
    const {me, groups} = await getPrs()
    return {me, generatedAt: new Date().toISOString(), groups}
}

export {summarizeCi}
