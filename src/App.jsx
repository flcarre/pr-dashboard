import React, {useCallback, useEffect, useMemo, useState} from "react"

const SECTIONS = [
    {key: "reviewsToDo", title: "Reviews to do", emoji: "🔴", hint: "Others are waiting on your review"},
    {key: "readyToMerge", title: "Ready to merge", emoji: "🟢", hint: "Approved, green CI, no conflicts"},
    {key: "approvedBlocked", title: "Approved, blocked", emoji: "🟠", hint: "Conflicts or red CI to fix"},
    {key: "awaitingReview", title: "Awaiting review", emoji: "🟡", hint: "Your PRs waiting for a reviewer"},
    {key: "changesRequested", title: "Changes requested", emoji: "✋", hint: "A reviewer is blocking your PRs"},
    {key: "iApproved", title: "I approved (others)", emoji: "👀", hint: "Waiting for merge by the author or a maintainer"},
    {key: "iBlocked", title: "I requested changes", emoji: "⛔", hint: "Waiting for the author's fix"},
    {key: "drafts", title: "Drafts", emoji: "📝", hint: "Your draft PRs"},
]

const REVIEW_LABELS = {
    APPROVED: {text: "approved", tone: "green"},
    CHANGES_REQUESTED: {text: "changes requested", tone: "red"},
    REVIEW_REQUIRED: {text: "needs review", tone: "neutral"},
    COMMENTED: {text: "commented", tone: "blue"},
}

const MERGE_LABELS = {
    CLEAN: {text: "mergeable", tone: "green"},
    DIRTY: {text: "conflicts", tone: "red"},
    BLOCKED: {text: "blocked", tone: "neutral"},
    UNSTABLE: {text: "unstable", tone: "orange"},
    BEHIND: {text: "behind", tone: "orange"},
}

const REVIEWER_STATE = {
    APPROVED: {mark: "✓", tone: "green"},
    CHANGES_REQUESTED: {mark: "✕", tone: "red"},
    COMMENTED: {mark: "💬", tone: "blue"},
    REQUESTED: {mark: "•", tone: "neutral"},
    PENDING: {mark: "•", tone: "neutral"},
    DISMISSED: {mark: "–", tone: "neutral"},
}

function timeAgo(iso) {
    if (!iso) return ""
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.round(diff / 60000)
    if (mins < 60) return `${mins}m`
    const hours = Math.round(mins / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.round(hours / 24)
    return `${days}d`
}

function Badge({tone, children}) {
    return <span className={`badge tone-${tone}`}>{children}</span>
}

function repoShort(repo) {
    return repo.split("/")[1] || repo
}

function repoClass(repo) {
    let h = 0
    for (let i = 0; i < repo.length; i++) h = (h * 31 + repo.charCodeAt(i)) >>> 0
    return `c${h % 6}`
}

function Reviewers({reviewers}) {
    if (!reviewers || reviewers.length === 0) {
        return <div className="reviewers empty">No reviewer assigned</div>
    }
    return (
        <div className="reviewers">
            <span className="reviewers-label">Reviewers</span>
            {reviewers.map((r) => {
                const s = REVIEWER_STATE[r.state] || {mark: "•", tone: "neutral"}
                return (
                    <span key={r.login} className={`reviewer tone-${s.tone}`} title={r.state}>
                        {r.team ? "△ " : "@"}
                        {r.login} <span className="reviewer-mark">{s.mark}</span>
                    </span>
                )
            })}
        </div>
    )
}

function Card({pr}) {
    const review = pr.reviewDecision ? REVIEW_LABELS[pr.reviewDecision] : null
    const merge = pr.mergeStateStatus ? MERGE_LABELS[pr.mergeStateStatus] : null
    return (
        <a className="card" href={pr.url} target="_blank" rel="noreferrer">
            <div className="card-top">
                <span className={`repo repo-${repoClass(pr.repo)}`}>{repoShort(pr.repo)}</span>
                <span className="num">#{pr.number}</span>
                <span className="ago">{timeAgo(pr.updatedAt)}</span>
            </div>
            <div className="card-title">{pr.title}</div>
            <div className="card-badges">
                {review && <Badge tone={review.tone}>{review.text}</Badge>}
                <Badge tone={pr.ci.tone}>CI: {pr.ci.label}</Badge>
                {merge && <Badge tone={merge.tone}>{merge.text}</Badge>}
                {!pr.mine && pr.myReview && <span className="you">you:&nbsp;{(REVIEW_LABELS[pr.myReview] || {text: pr.myReview.toLowerCase()}).text}</span>}
                {pr.author && <span className="author">@{pr.author}</span>}
            </div>
            <Reviewers reviewers={pr.reviewers} />
        </a>
    )
}

function Section({def, prs}) {
    if (!prs || prs.length === 0) return null
    return (
        <section className="section">
            <header className="section-head">
                <h2>
                    <span className="emoji">{def.emoji}</span>
                    {def.title}
                    <span className="count">{prs.length}</span>
                </h2>
                <p className="hint">{def.hint}</p>
            </header>
            <div className="grid">
                {prs.map((pr) => (
                    <Card key={pr.url} pr={pr} />
                ))}
            </div>
        </section>
    )
}

export default function App() {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    const load = useCallback(async (force) => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`/api/prs${force ? "?force=1" : ""}`)
            const json = await res.json()
            if (json.error) throw new Error(json.error)
            setData(json)
        } catch (e) {
            setError(String(e?.message || e))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        load(false)
        const id = setInterval(() => load(true), 90_000)
        return () => clearInterval(id)
    }, [load])

    const total = useMemo(() => {
        if (!data) return 0
        return SECTIONS.reduce((n, s) => n + (data.groups[s.key]?.length || 0), 0)
    }, [data])

    return (
        <div className="app">
            <header className="topbar">
                <div className="brand">
                    <h1>My PRs</h1>
                    {data && <span className="me">@{data.me}</span>}
                </div>
                <div className="controls">
                    {data && <span className="total">{total} PRs</span>}
                    {data && <span className="stamp">updated {timeAgo(data.generatedAt)} ago</span>}
                    <button className="refresh" onClick={() => load(true)} disabled={loading}>
                        {loading ? "…" : "↻ Refresh"}
                    </button>
                </div>
            </header>

            {error && <div className="banner error">Error: {error}</div>}
            {loading && !data && <div className="banner">Loading PRs via gh…</div>}

            {data && (
                <main className="content">
                    {SECTIONS.map((def) => (
                        <Section key={def.key} def={def} prs={data.groups[def.key]} />
                    ))}
                    {data.groups.errors?.length > 0 && (
                        <section className="section">
                            <header className="section-head">
                                <h2>
                                    <span className="emoji">⚠️</span>
                                    Failed to load
                                    <span className="count">{data.groups.errors.length}</span>
                                </h2>
                            </header>
                            <div className="grid">
                                {data.groups.errors.map((e) => (
                                    <a key={e.url} className="card" href={e.url} target="_blank" rel="noreferrer">
                                        <div className="card-title">{e.url}</div>
                                        <div className="card-badges">
                                            <Badge tone="red">{e.error.slice(0, 80)}</Badge>
                                        </div>
                                    </a>
                                ))}
                            </div>
                        </section>
                    )}
                    {total === 0 && <div className="banner">Nothing to do. 🎉</div>}
                </main>
            )}
        </div>
    )
}
