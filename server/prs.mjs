import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {readFileSync} from "node:fs"

const exec = promisify(execFile)
const MAX_BUFFER = 64 * 1024 * 1024
const CACHE_MS = 30_000

function loadOrgs() {
    if (process.env.PR_DASH_ORGS) {
        return process.env.PR_DASH_ORGS.split(",").map((s) => s.trim()).filter(Boolean)
    }
    try {
        const cfg = JSON.parse(readFileSync(new URL("../pr-dashboard.config.json", import.meta.url)))
        if (Array.isArray(cfg.orgs)) return cfg.orgs.filter(Boolean)
    } catch {}
    return []
}

const ORGS = loadOrgs()

let cache = {at: 0, data: null}

async function gh(args) {
    const {stdout} = await exec("gh", args, {maxBuffer: MAX_BUFFER})
    return stdout
}

async function ghJson(args) {
    return JSON.parse(await gh(args))
}

async function pool(items, size, fn) {
    const out = new Array(items.length)
    let cursor = 0
    const workers = Array.from({length: Math.min(size, items.length)}, async () => {
        while (cursor < items.length) {
            const idx = cursor++
            out[idx] = await fn(items[idx], idx)
        }
    })
    await Promise.all(workers)
    return out
}

function summarizeCi(rollup) {
    const checks = rollup || []
    let fail = 0
    let pending = 0
    let gated = 0
    for (const x of checks) {
        const conclusion = (x.conclusion || "").toUpperCase()
        const status = (x.status || "").toUpperCase()
        const state = (x.state || "").toUpperCase()
        if (["FAILURE", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE"].includes(conclusion) || ["FAILURE", "ERROR"].includes(state)) {
            fail++
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
    return {fail, pending, gated, total, tone, label}
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

function classify(pr, sources, me) {
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
    if (pr.myReview === "CHANGES_REQUESTED") return "iBlocked"
    return "iApproved"
}

export async function getPrs({force = false} = {}) {
    if (!force && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data

    const me = (await gh(["api", "user", "--jq", ".login"])).trim()
    const listFields = "number,url,repository"
    const [authored, requested, reviewed] = await Promise.all([
        ghJson(["search", "prs", "--author", "@me", "--state", "open", "--limit", "100", "--json", listFields]),
        ghJson(["search", "prs", "--review-requested", "@me", "--state", "open", "--limit", "100", "--json", listFields]),
        ghJson(["search", "prs", "--reviewed-by", "@me", "--state", "open", "--limit", "100", "--json", listFields]),
    ])

    const sourcesByUrl = new Map()
    const register = (list, src) => {
        for (const p of list) {
            const owner = p.repository?.nameWithOwner || ""
            const org = owner.split("/")[0]
            if (ORGS.length && !ORGS.includes(org)) continue
            const entry = sourcesByUrl.get(p.url) || new Set()
            entry.add(src)
            sourcesByUrl.set(p.url, entry)
        }
    }
    register(authored, "authored")
    register(requested, "requested")
    register(reviewed, "reviewed")

    const urls = [...sourcesByUrl.keys()]
    const detailFields = "number,title,url,author,isDraft,reviewDecision,mergeStateStatus,mergeable,statusCheckRollup,reviews,reviewRequests,latestReviews,updatedAt"
    const details = await pool(urls, 6, async (url) => {
        try {
            return await ghJson(["pr", "view", url, "--json", detailFields])
        } catch (e) {
            return {url, error: String(e?.message || e)}
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
            repo: repoFromUrl(d.url),
            number: d.number,
            title: d.title,
            url: d.url,
            author: d.author?.login || "",
            isDraft: d.isDraft,
            reviewDecision: d.reviewDecision || null,
            mergeStateStatus: d.mergeStateStatus || null,
            mergeable: d.mergeable || null,
            updatedAt: d.updatedAt,
            ci,
            myReview,
            reviewers: buildReviewers(d.latestReviews, d.reviewRequests),
            mine: d.author?.login === me,
        }
        const bucket = classify({...pr, ci}, sources, me)
        groups[bucket].push(pr)
    }

    const rank = {red: 0, orange: 1, blue: 2, green: 3, neutral: 4}
    for (const key of Object.keys(groups)) {
        if (key === "errors") continue
        groups[key].sort((a, b) => (rank[a.ci.tone] - rank[b.ci.tone]) || (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    }

    const data = {me, generatedAt: new Date().toISOString(), groups}
    cache = {at: Date.now(), data}
    return data
}
