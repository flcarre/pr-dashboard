import React from "react"
import {Badge, BoardChips, Labels, RepoTag, Reviewers, Section, Empty} from "../ui.jsx"
import {MERGE_LABELS, REVIEW_LABELS, matchesQuery, timeAgo} from "../lib/format.js"

export const PR_SECTIONS = [
    {key: "reviewsToDo", title: "Reviews to do", emoji: "🔴", hint: "Others are waiting on your review"},
    {key: "readyToMerge", title: "Ready to merge", emoji: "🟢", hint: "Approved, green CI, no conflicts"},
    {key: "approvedBlocked", title: "Approved, blocked", emoji: "🟠", hint: "Conflicts or red CI to fix"},
    {key: "changesRequested", title: "Changes requested", emoji: "✋", hint: "A reviewer is blocking your PRs"},
    {key: "awaitingReview", title: "Awaiting review", emoji: "🟡", hint: "Your PRs waiting for a reviewer"},
    {key: "iApproved", title: "I approved (others)", emoji: "👀", hint: "Waiting for merge by the author or a maintainer"},
    {key: "iBlocked", title: "I requested changes", emoji: "⛔", hint: "Waiting for the author's fix"},
    {key: "drafts", title: "Drafts", emoji: "📝", hint: "Your draft PRs", collapsed: true},
]

function DiffStat({pr}) {
    if (pr.additions == null && pr.deletions == null) return null
    return (
        <span className="diffstat" title={pr.changedFiles != null ? `${pr.changedFiles} files changed` : undefined}>
            <span className="add">+{pr.additions ?? 0}</span>
            <span className="del">-{pr.deletions ?? 0}</span>
        </span>
    )
}

export function PrCard({pr}) {
    const review = pr.reviewDecision ? REVIEW_LABELS[pr.reviewDecision] : null
    const merge = pr.mergeStateStatus ? MERGE_LABELS[pr.mergeStateStatus] : null
    return (
        <a className="card" href={pr.url} target="_blank" rel="noreferrer">
            <div className="card-top">
                <RepoTag repo={pr.repo} />
                <span className="num">#{pr.number}</span>
                <DiffStat pr={pr} />
                <span className="ago">{timeAgo(pr.updatedAt)}</span>
            </div>
            <div className="card-title">{pr.title}</div>
            <div className="card-badges">
                {pr.isDraft && <Badge tone="neutral">draft</Badge>}
                {review && <Badge tone={review.tone}>{review.text}</Badge>}
                <Badge tone={pr.ci.tone} title={pr.ci.failing?.length ? `Failing: ${pr.ci.failing.join(", ")}` : undefined}>
                    CI: {pr.ci.label}
                </Badge>
                {merge && <Badge tone={merge.tone}>{merge.text}</Badge>}
                {!pr.mine && pr.myReview && <span className="you">you:&nbsp;{(REVIEW_LABELS[pr.myReview] || {text: pr.myReview.toLowerCase()}).text}</span>}
                {pr.author && <span className="author">@{pr.author}</span>}
            </div>
            {pr.labels?.length > 0 && (
                <div className="card-labels">
                    <Labels labels={pr.labels} />
                </div>
            )}
            {pr.boards?.length > 0 && (
                <div className="card-labels">
                    <BoardChips boards={pr.boards} />
                </div>
            )}
            <Reviewers reviewers={pr.reviewers} />
        </a>
    )
}

function keep(pr, query) {
    return matchesQuery(query, pr.title, pr.repo, pr.author, `#${pr.number}`, (pr.labels || []).map((l) => l.name), (pr.boards || []).map((b) => b.project.title))
}

export default function Prs({prs, query}) {
    if (!prs) return <Empty>Pull requests could not be loaded — see the error banner above.</Empty>
    const sections = PR_SECTIONS.map((def) => ({def, list: (prs[def.key] || []).filter((pr) => keep(pr, query))})).filter((s) => s.list.length > 0)
    if (sections.length === 0) {
        return <Empty>{query ? "No pull request matches this filter." : "No open pull request needs you. 🎉"}</Empty>
    }
    return (
        <>
            {sections.map(({def, list}) => (
                <Section key={def.key} storageKey={`pr.${def.key}`} title={def.title} emoji={def.emoji} hint={def.hint} count={list.length} collapsedByDefault={def.collapsed}>
                    <div className="grid">
                        {list.map((pr) => (
                            <PrCard key={pr.url} pr={pr} />
                        ))}
                    </div>
                </Section>
            ))}
        </>
    )
}
