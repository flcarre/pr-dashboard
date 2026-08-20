import React from "react"
import {Badge, BoardChips, Empty, Labels, Row, Section} from "../ui.jsx"
import {matchesQuery, plural} from "../lib/format.js"

const SECTIONS = [
    {key: "assigned", title: "Assigned to me", emoji: "🎯", hint: "Open issues on your plate"},
    {key: "assignedStale", title: "Assigned, going stale", emoji: "🕸️", hint: "Assigned to you but untouched for a while — close, reassign or update"},
    {key: "mentioned", title: "Mentions waiting on me", emoji: "💬", hint: "Someone pulled you into these but they are not assigned to you"},
    {key: "authored", title: "I opened these", emoji: "✍️", hint: "Your open issues, assigned to someone else or nobody"},
    {key: "closedRecently", title: "Closed this week", emoji: "✅", hint: "What you wrapped up in the last 7 days", collapsed: true},
]

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
    )
}

function IssueRow({issue, showAge}) {
    const badges = (
        <>
            {issue.state !== "OPEN" && <Badge tone={issue.stateReason === "NOT_PLANNED" ? "neutral" : "green"}>{issue.stateReason === "NOT_PLANNED" ? "not planned" : "closed"}</Badge>}
            {issue.comments > 0 && <span className="mini" title={plural(issue.comments, "comment")}>{issue.comments} 💬</span>}
            {showAge && issue.ageDays != null && <Badge tone={issue.ageDays > 30 ? "red" : "orange"}>{issue.ageDays}d idle</Badge>}
        </>
    )
    const meta = (
        <>
            <Labels labels={issue.labels} />
            {issue.milestone && <span className="mini">🏁 {issue.milestone.title}</span>}
            {issue.parent && <span className="mini" title={issue.parent.title}>↳ epic #{issue.parent.number}</span>}
            {issue.assignees?.length > 0 && <span className="mini">{issue.assignees.map((a) => `@${a}`).join(" ")}</span>}
            <BoardChips boards={issue.boards} />
        </>
    )
    return <Row item={issue} badges={badges} meta={meta} />
}

export default function Issues({issues, query, staleDays}) {
    if (!issues) return <Empty>Issues could not be loaded — see the error banner above.</Empty>
    const sections = SECTIONS.map((def) => ({def, list: (issues[def.key] || []).filter((i) => keep(i, query))})).filter((s) => s.list.length > 0)
    if (sections.length === 0) return <Empty>{query ? "No issue matches this filter." : "No issue waiting on you. 🎉"}</Empty>
    return (
        <>
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
                            <IssueRow key={issue.url} issue={issue} showAge={def.key === "assignedStale"} />
                        ))}
                    </div>
                </Section>
            ))}
        </>
    )
}
