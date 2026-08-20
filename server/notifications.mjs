import {ghApi, ghGraphql, inScope, chunk, cleanMessage, viewer} from "./gh.mjs"

const PER_PAGE = 100
const MAX_PAGES = 3
const BATCH = 40

const REASON_LABELS = {
    assign: "assigned to you",
    author: "you opened it",
    comment: "you commented",
    ci_activity: "CI activity",
    invitation: "invitation",
    manual: "you subscribed",
    member_feature_requested: "feature request",
    mention: "you were mentioned",
    review_requested: "review requested",
    security_alert: "security alert",
    security_advisory_credit: "security advisory",
    state_change: "state changed",
    subscribed: "repo subscription",
    team_mention: "your team was mentioned",
    approval_requested: "approval requested",
}

/** api.github.com/repos/o/r/issues/1 -> github.com/o/r/issues/1 */
function htmlUrl(apiUrl, repo, type) {
    if (!apiUrl) return repo ? `https://github.com/${repo}` : "https://github.com/notifications"
    const m = /repos\/([^/]+)\/([^/]+)\/(issues|pulls|releases|discussions|commits)\/([^/?#]+)/.exec(apiUrl)
    if (m) {
        const kind = {issues: "issues", pulls: "pull", releases: "releases/tag", discussions: "discussions", commits: "commit"}[m[3]]
        return `https://github.com/${m[1]}/${m[2]}/${kind}/${m[4]}`
    }
    if (type === "CheckSuite" && repo) return `https://github.com/${repo}/actions`
    return repo ? `https://github.com/${repo}` : apiUrl
}

function subjectRef(n) {
    const m = /repos\/([^/]+)\/([^/]+)\/(issues|pulls)\/(\d+)/.exec(n.subject?.url || "")
    if (!m) return null
    return {owner: m[1], name: m[2], number: Number(m[4])}
}

function gqlString(s) {
    return JSON.stringify(String(s))
}

/** Resolve open/closed/merged state for the issue & PR subjects, in batches. */
async function resolveStates(refs) {
    const states = new Map()
    for (const group of chunk(refs, BATCH)) {
        const body = group
            .map(
                (r, i) => `
            n${i}: repository(owner: ${gqlString(r.owner)}, name: ${gqlString(r.name)}) {
                item: issueOrPullRequest(number: ${r.number}) {
                    __typename
                    ... on Issue { state stateReason updatedAt title comments { totalCount } }
                    ... on PullRequest { state isDraft merged updatedAt title reviewDecision comments { totalCount } }
                }
            }`,
            )
            .join("\n")
        let data
        try {
            data = await ghGraphql(`query {${body}\n}`)
        } catch {
            continue // a single unreadable repo shouldn't sink the whole inbox
        }
        group.forEach((r, i) => {
            const item = data?.[`n${i}`]?.item
            if (!item) return
            states.set(`${r.owner}/${r.name}#${r.number}`, {
                kind: item.__typename === "PullRequest" ? "pr" : "issue",
                state: (item.state || "").toUpperCase(),
                stateReason: item.stateReason || null,
                merged: !!item.merged,
                isDraft: !!item.isDraft,
                reviewDecision: item.reviewDecision || null,
                comments: item.comments?.totalCount ?? 0,
                subjectUpdatedAt: item.updatedAt || null,
            })
        })
    }
    return states
}

async function fetchAll() {
    const all = []
    for (let page = 1; page <= MAX_PAGES; page++) {
        const batch = await ghApi(`/notifications?all=true&per_page=${PER_PAGE}&page=${page}`)
        if (!Array.isArray(batch) || batch.length === 0) break
        all.push(...batch)
        if (batch.length < PER_PAGE) break
    }
    return all
}

/**
 * The notification inbox, split into what still needs doing, what was opened
 * and then forgotten (read, never cleared, subject still open), and what is
 * effectively handled (subject closed/merged) and can be cleared.
 */
export async function getNotifications() {
    const me = await viewer()
    let raw
    try {
        raw = await fetchAll()
    } catch (e) {
        const msg = cleanMessage(e)
        const hint = /404|Not Found|scope/i.test(msg)
            ? " — the gh token may lack the `notifications` scope; run `gh auth refresh -s notifications`."
            : ""
        throw new Error(msg + hint)
    }

    const scoped = raw.filter((n) => inScope(n.repository?.full_name))
    const refs = []
    const seen = new Set()
    for (const n of scoped) {
        const ref = subjectRef(n)
        if (!ref) continue
        const key = `${ref.owner}/${ref.name}#${ref.number}`
        if (seen.has(key)) continue
        seen.add(key)
        refs.push(ref)
    }
    const states = await resolveStates(refs)

    const groups = {todo: [], newActivity: [], forgotten: [], handled: [], watching: []}
    const reasons = new Map()

    for (const n of scoped) {
        const repo = n.repository?.full_name || ""
        const ref = subjectRef(n)
        const state = ref ? states.get(`${ref.owner}/${ref.name}#${ref.number}`) : null
        const lastRead = n.last_read_at ? new Date(n.last_read_at).getTime() : 0
        const updated = n.updated_at ? new Date(n.updated_at).getTime() : 0
        const item = {
            id: n.id,
            repo,
            type: n.subject?.type || "Unknown",
            title: n.subject?.title || "(no title)",
            url: htmlUrl(n.subject?.url, repo, n.subject?.type),
            number: ref?.number ?? null,
            reason: n.reason,
            reasonLabel: REASON_LABELS[n.reason] || n.reason,
            unread: !!n.unread,
            updatedAt: n.updated_at,
            lastReadAt: n.last_read_at || null,
            updatedSinceRead: !n.unread && lastRead > 0 && updated > lastRead,
            state: state?.state || null,
            kind: state?.kind || (n.subject?.type === "PullRequest" ? "pr" : n.subject?.type === "Issue" ? "issue" : "other"),
            merged: !!state?.merged,
            isDraft: !!state?.isDraft,
            reviewDecision: state?.reviewDecision || null,
            comments: state?.comments ?? null,
        }

        reasons.set(item.reason, (reasons.get(item.reason) || 0) + 1)

        const closed = item.state === "CLOSED" || item.state === "MERGED" || item.merged
        if (item.unread) groups.todo.push(item)
        else if (closed) groups.handled.push(item)
        else if (item.updatedSinceRead) groups.newActivity.push(item)
        else if (item.state === "OPEN") groups.forgotten.push(item)
        else groups.watching.push(item)
    }

    const byUpdated = (a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")
    for (const key of Object.keys(groups)) groups[key].sort(byUpdated)

    return {
        me,
        groups,
        total: scoped.length,
        fetched: raw.length,
        truncated: raw.length >= PER_PAGE * MAX_PAGES,
        reasons: [...reasons.entries()].map(([reason, count]) => ({reason, label: REASON_LABELS[reason] || reason, count})).sort((a, b) => b.count - a.count),
    }
}
