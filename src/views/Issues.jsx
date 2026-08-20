import React from "react"
import {Badge, BoardChips, Empty, Labels, RepoTag, Row, Section, useSticky} from "../ui.jsx"
import {cx, matchesQuery, plural, timeAgo} from "../lib/format.js"

const SECTIONS = [
    {key: "prMerged", title: "PR merged, issue still open", emoji: "🏁", hint: "The work shipped — close the issue or say what is left"},
    {key: "assigned", title: "Assigned to me", emoji: "🎯", hint: "Open issues on your plate"},
    {key: "assignedStale", title: "Assigned, going stale", emoji: "🕸️", hint: "Assigned to you but untouched for a while — close, reassign or update"},
    {key: "mentioned", title: "Mentions waiting on me", emoji: "💬", hint: "Someone pulled you into these but they are not assigned to you"},
    {key: "authored", title: "I opened these", emoji: "✍️", hint: "Your open issues, assigned to someone else or nobody"},
    {key: "closedRecently", title: "Closed this week", emoji: "✅", hint: "What you wrapped up in the last 7 days", collapsed: true},
]

const PR_FILTERS = [
    {key: "all", label: "all"},
    {key: "open", label: "PR in flight", match: (i) => i.prSummary?.hasOpen},
    {key: "merged", label: "PR merged", match: (i) => i.prSummary?.state === "merged"},
    {key: "none", label: "no PR yet", match: (i) => (i.prSummary?.count ?? 0) === 0},
]

const PR_STATE_TONES = {open: "green", draft: "neutral", merged: "purple", closed: "red"}

function keep(issue, query) {
    return matchesQuery(
        query,
        issue.title,
        issue.repo,
        issue.author,
        `#${issue.number}`,
        issue.assignees,
        (issue.labels || []).map((l) => l.name),
        (issue.boards || []).map((b) => b.project.title),
        issue.milestone?.title,
        (issue.linkedPrs || []).map((p) => [p.title, `#${p.number}`, p.author]),
    )
}

/** One-glance summary of the PRs attached to an issue. */
function PrBadge({summary}) {
    if (!summary || summary.count === 0) return <Badge tone="neutral">no PR</Badge>
    const {state, primary, count} = summary
    const label = state === "draft" ? "draft PR" : state === "merged" ? "PR merged" : state === "closed" ? "PR closed" : "PR open"
    return (
        <Badge tone={PR_STATE_TONES[state] || "neutral"} title={`${primary.repo}#${primary.number} — ${primary.title}`}>
            {label} #{primary.number}
            {count > 1 ? ` +${count - 1}` : ""}
        </Badge>
    )
}

const REVIEW_SHORT = {
    APPROVED: {text: "approved", tone: "green"},
    CHANGES_REQUESTED: {text: "changes requested", tone: "red"},
    REVIEW_REQUIRED: {text: "needs review", tone: "orange"},
}

/** The linked pull requests, listed under their issue with their live state. */
function LinkedPrs({prs, issueRepo}) {
    if (!prs || prs.length === 0) return null
    const order = {OPEN: 0, MERGED: 1, CLOSED: 2}
    const sorted = [...prs].sort((a, b) => (order[a.state] ?? 3) - (order[b.state] ?? 3) || b.number - a.number)
    return (
        <div className="sub-rows">
            {sorted.map((pr) => {
                const review = pr.state === "OPEN" ? REVIEW_SHORT[pr.reviewDecision] : null
                return (
                    <a key={pr.url} className="sub-row" href={pr.url} target="_blank" rel="noreferrer">
                        <span className="sub-arrow">↳</span>
                        <Badge tone={pr.state === "MERGED" ? "purple" : pr.state === "CLOSED" ? "red" : pr.isDraft ? "neutral" : "green"}>
                            {pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.isDraft ? "draft" : "open"}
                        </Badge>
                        {pr.repo && pr.repo !== issueRepo && <RepoTag repo={pr.repo} />}
                        <span className="num">#{pr.number}</span>
                        <span className="sub-title">{pr.title}</span>
                        <span className="sub-side">
                            {pr.ci && <Badge tone={pr.ci.tone}>CI {pr.ci.state.toLowerCase()}</Badge>}
                            {review && <Badge tone={review.tone}>{review.text}</Badge>}
                            {pr.conflicts && pr.state === "OPEN" && <Badge tone="red">conflicts</Badge>}
                            {pr.author && <span className="mini">@{pr.author}</span>}
                            <span className="ago">{timeAgo(pr.mergedAt || pr.updatedAt)}</span>
                        </span>
                    </a>
                )
            })}
        </div>
    )
}

function IssueRow({issue, showAge, showPrs}) {
    const badges = (
        <>
            {showPrs && issue.state === "OPEN" && <PrBadge summary={issue.prSummary} />}
            {issue.state !== "OPEN" && (
                <Badge tone={issue.stateReason === "NOT_PLANNED" ? "neutral" : "green"}>{issue.stateReason === "NOT_PLANNED" ? "not planned" : "closed"}</Badge>
            )}
            {issue.comments > 0 && (
                <span className="mini" title={plural(issue.comments, "comment")}>
                    {issue.comments} 💬
                </span>
            )}
            {showAge && issue.ageDays != null && <Badge tone={issue.ageDays > 30 ? "red" : "orange"}>{issue.ageDays}d idle</Badge>}
        </>
    )
    const meta = (
        <>
            {issue.openedDays != null && (
                <span className="mini" title={issue.createdAt}>
                    opened {timeAgo(issue.createdAt)} ago{issue.author ? ` by @${issue.author}` : ""}
                </span>
            )}
            {issue.subIssues && (
                <span className="mini" title={`${issue.subIssues.completed} of ${issue.subIssues.total} sub-issues done`}>
                    ☑ {issue.subIssues.completed}/{issue.subIssues.total} sub-issues
                </span>
            )}
            <Labels labels={issue.labels} />
            {issue.milestone && <span className="mini">🏁 {issue.milestone.title}</span>}
            {issue.parent && (
                <span className="mini" title={issue.parent.title}>
                    ↳ epic #{issue.parent.number}
                </span>
            )}
            {issue.assignees?.length > 0 && <span className="mini">{issue.assignees.map((a) => `@${a}`).join(" ")}</span>}
            <BoardChips boards={issue.boards} />
        </>
    )
    return (
        <div className="row-group">
            <Row item={issue} badges={badges} meta={meta} />
            <LinkedPrs prs={issue.linkedPrs} issueRepo={issue.repo} />
        </div>
    )
}

export default function Issues({issues, query, staleDays, features}) {
    const [prFilter, setPrFilter] = useSticky("issues.prFilter", "all")
    if (!issues) return <Empty>Issues could not be loaded — see the error banner above.</Empty>

    // No point offering a PR filter, or claiming "no PR", when the linked-PR
    // lookup itself was unavailable.
    const prs = features?.linkedPrs !== false
    const active = (prs && PR_FILTERS.find((f) => f.key === prFilter)) || PR_FILTERS[0]
    const counts = new Map(PR_FILTERS.map((f) => [f.key, 0]))
    for (const list of Object.values(issues)) {
        for (const issue of list) {
            for (const f of PR_FILTERS) if (!f.match || f.match(issue)) counts.set(f.key, counts.get(f.key) + 1)
        }
    }

    const sections = SECTIONS.map((def) => ({
        def,
        list: (issues[def.key] || []).filter((i) => keep(i, query)).filter((i) => !active.match || active.match(i)),
    })).filter((s) => s.list.length > 0)

    return (
        <>
            {prs && (
                <div className="toolbar">
                    <span className="toolbar-label">Pull request</span>
                    {PR_FILTERS.map((f) => (
                        <button key={f.key} className={cx("pill", prFilter === f.key && "active")} onClick={() => setPrFilter(f.key)}>
                            {f.label} <span className="pill-count">{counts.get(f.key)}</span>
                        </button>
                    ))}
                </div>
            )}

            {sections.length === 0 && <Empty>{query || active.key !== "all" ? "No issue matches this filter." : "No issue waiting on you. 🎉"}</Empty>}

            {sections.map(({def, list}) => (
                <Section
                    key={def.key}
                    storageKey={`issue.${def.key}`}
                    title={def.title}
                    emoji={def.emoji}
                    count={list.length}
                    collapsedByDefault={def.collapsed}
                    hint={def.key === "assignedStale" ? `Assigned to you, no activity for ${staleDays}+ days` : def.hint}
                >
                    <div className="rows">
                        {list.map((issue) => (
                            <IssueRow key={issue.url} issue={issue} showAge={def.key === "assignedStale"} showPrs={prs} />
                        ))}
                    </div>
                </Section>
            ))}
        </>
    )
}
