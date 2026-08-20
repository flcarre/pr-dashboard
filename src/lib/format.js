export function timeAgo(iso) {
    if (!iso) return ""
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.round(diff / 60000)
    if (mins < 1) return "now"
    if (mins < 60) return `${mins}m`
    const hours = Math.round(mins / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.round(hours / 24)
    if (days < 30) return `${days}d`
    const months = Math.round(days / 30)
    if (months < 12) return `${months}mo`
    return `${Math.round(months / 12)}y`
}

export function dateShort(iso) {
    if (!iso) return ""
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
    if (Number.isNaN(d.getTime())) return ""
    return d.toLocaleDateString(undefined, {month: "short", day: "numeric"})
}

export function repoShort(repo) {
    return (repo || "").split("/")[1] || repo || ""
}

export function repoClass(repo) {
    let h = 0
    const s = repo || ""
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
    return `c${h % 6}`
}

export function cx(...parts) {
    return parts.filter(Boolean).join(" ")
}

export function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many ?? `${one}s`}`
}

export const REVIEW_LABELS = {
    APPROVED: {text: "approved", tone: "green"},
    CHANGES_REQUESTED: {text: "changes requested", tone: "red"},
    REVIEW_REQUIRED: {text: "needs review", tone: "neutral"},
    COMMENTED: {text: "commented", tone: "blue"},
}

export const MERGE_LABELS = {
    CLEAN: {text: "mergeable", tone: "green"},
    DIRTY: {text: "conflicts", tone: "red"},
    BLOCKED: {text: "blocked", tone: "neutral"},
    UNSTABLE: {text: "unstable", tone: "orange"},
    BEHIND: {text: "behind", tone: "orange"},
    HAS_HOOKS: {text: "hooks", tone: "neutral"},
    UNKNOWN: {text: "unknown", tone: "neutral"},
}

export const REVIEWER_STATE = {
    APPROVED: {mark: "OK", tone: "green"},
    CHANGES_REQUESTED: {mark: "X", tone: "red"},
    COMMENTED: {mark: "…", tone: "blue"},
    REQUESTED: {mark: "?", tone: "neutral"},
    PENDING: {mark: "?", tone: "neutral"},
    DISMISSED: {mark: "-", tone: "neutral"},
}

const PRIORITY_TONES = [
    [/p0|urgent|critical|highest|blocker/i, "red"],
    [/p1|high|haute/i, "orange"],
    [/p2|medium|moyenne|normal/i, "blue"],
    [/p3|low|basse|minor/i, "neutral"],
]

export function priorityTone(value) {
    if (!value) return "neutral"
    for (const [re, tone] of PRIORITY_TONES) if (re.test(String(value))) return tone
    return "neutral"
}

const STATUS_TONES = [
    [/done|shipped|closed|merged/i, "green"],
    [/review|relecture/i, "blue"],
    [/progress|doing|en cours|wip/i, "orange"],
    [/block|hold/i, "red"],
]

export function statusTone(value) {
    if (!value) return "neutral"
    for (const [re, tone] of STATUS_TONES) if (re.test(String(value))) return tone
    return "neutral"
}

/** Text match used by the global filter box. */
export function matchesQuery(query, ...fields) {
    const q = query.trim().toLowerCase()
    if (!q) return true
    const terms = q.split(/\s+/)
    const haystack = fields
        .flat(3)
        .filter((v) => typeof v === "string" || typeof v === "number")
        .join(" ")
        .toLowerCase()
    return terms.every((t) => haystack.includes(t))
}

/** Readable label for a GitHub notification subject type. */
export const SUBJECT_TYPES = {
    PullRequest: "PR",
    Issue: "issue",
    Release: "release",
    Discussion: "discussion",
    Commit: "commit",
    CheckSuite: "CI",
    RepositoryVulnerabilityAlert: "security",
    RepositoryInvitation: "invitation",
}
