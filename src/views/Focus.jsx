import React from "react"
import {Badge, Empty, Row, Section, StatTile, useSticky} from "../ui.jsx"
import {cx, matchesQuery, plural} from "../lib/format.js"

const LANES = {
    review: {emoji: "👀", label: "review"},
    merge: {emoji: "🚀", label: "merge"},
    fix: {emoji: "🔧", label: "fix"},
    inbox: {emoji: "🔔", label: "inbox"},
    sprint: {emoji: "🏃", label: "sprint"},
    stale: {emoji: "🕸️", label: "stale"},
}

const URGENCIES = [
    {key: "now", title: "Do now", emoji: "🔥", hint: "Someone is blocked on you, or a merge is one click away"},
    {key: "soon", title: "Do next", emoji: "📌", hint: "This sprint's work and threads that moved since you read them"},
    {key: "later", title: "Cleanup", emoji: "🧺", hint: "Stale assignments and notifications you opened and never closed out"},
]

function FocusRow({entry}) {
    const lane = LANES[entry.lane] || {emoji: "•", label: entry.lane}
    return (
        <Row
            item={{repo: entry.repo, number: entry.number, title: entry.title, url: entry.url, updatedAt: entry.updatedAt}}
            leading={
                <span className="lane" title={lane.label}>
                    {lane.emoji}
                </span>
            }
            badges={<Badge tone={entry.urgency === "now" ? "red" : entry.urgency === "soon" ? "blue" : "neutral"}>{entry.why}</Badge>}
        />
    )
}

export default function Focus({data, query, onGo}) {
    const [lane, setLane] = useSticky("focus.lane", null)
    const {stats, focus} = data
    const filtered = (focus || []).filter((f) => (!lane || f.lane === lane) && matchesQuery(query, f.title, f.repo, f.why, `#${f.number ?? ""}`))
    const noData = Object.values(stats).every((v) => v === null)
    const laneCounts = new Map()
    for (const f of focus || []) laneCounts.set(f.lane, (laneCounts.get(f.lane) || 0) + 1)

    return (
        <>
            <div className="tiles">
                <StatTile label="reviews to do" value={stats.reviewsToDo} tone={stats.reviewsToDo ? "red" : "green"} onClick={() => onGo("prs")} />
                <StatTile label="ready to merge" value={stats.readyToMerge} tone={stats.readyToMerge ? "green" : "neutral"} onClick={() => onGo("prs")} />
                <StatTile label="my PRs blocked" value={stats.blockedPrs} tone={stats.blockedPrs ? "orange" : "neutral"} onClick={() => onGo("prs")} />
                <StatTile label="assigned issues" value={stats.assignedIssues} tone={stats.staleIssues ? "orange" : "neutral"} hint={stats.staleIssues ? `${stats.staleIssues} going stale` : undefined} onClick={() => onGo("issues")} />
                <StatTile label="unread inbox" value={stats.unread} tone={stats.unread ? "blue" : "neutral"} onClick={() => onGo("inbox")} />
                <StatTile label="opened & forgotten" value={stats.forgotten} tone={stats.forgotten ? "orange" : "neutral"} hint="Read but never cleared, still open" onClick={() => onGo("inbox")} />
                <StatTile label="in current sprint" value={stats.sprintItems} tone="purple" onClick={() => onGo("boards")} />
                <StatTile label="closed this week" value={stats.closedThisWeek} tone="green" onClick={() => onGo("issues")} />
            </div>

            <div className="toolbar">
                <span className="toolbar-label">Lane</span>
                <button className={cx("pill", !lane && "active")} onClick={() => setLane(null)}>
                    all
                </button>
                {[...laneCounts.entries()].map(([key, count]) => (
                    <button key={key} className={cx("pill", lane === key && "active")} onClick={() => setLane(lane === key ? null : key)}>
                        {(LANES[key] || {emoji: "•"}).emoji} {(LANES[key] || {label: key}).label} <span className="pill-count">{count}</span>
                    </button>
                ))}
                <span className="toolbar-spacer" />
                <span className="toolbar-label">{plural(filtered.length, "action")}</span>
            </div>

            {filtered.length === 0 && (
                <Empty>
                    {noData
                        ? "Nothing could be loaded — see the error banner above."
                        : query || lane
                          ? "Nothing matches this filter."
                          : "Nothing is waiting on you. 🎉"}
                </Empty>
            )}

            {URGENCIES.map((u) => {
                const list = filtered.filter((f) => f.urgency === u.key)
                if (list.length === 0) return null
                return (
                    <Section key={u.key} storageKey={`focus.${u.key}`} title={u.title} emoji={u.emoji} hint={u.hint} count={list.length}>
                        <div className="rows">
                            {list.map((entry) => (
                                <FocusRow key={`${entry.lane}:${entry.url}`} entry={entry} />
                            ))}
                        </div>
                    </Section>
                )
            })}
        </>
    )
}
