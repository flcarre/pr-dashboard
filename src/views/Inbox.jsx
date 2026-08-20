import React from "react"
import {Badge, Empty, Row, Section, useSticky} from "../ui.jsx"
import {SUBJECT_TYPES, cx, matchesQuery, timeAgo} from "../lib/format.js"

const SECTIONS = [
    {key: "todo", title: "Unread — to handle", emoji: "🔔", hint: "Straight from your GitHub inbox, nothing read yet"},
    {key: "newActivity", title: "Moved since you read it", emoji: "🌀", hint: "You read these, then someone commented or pushed again"},
    {key: "forgotten", title: "Opened, then forgotten", emoji: "🫥", hint: "Read but never cleared, and the issue or PR is still open — the pile that silently grows"},
    {key: "handled", title: "Handled — safe to clear", emoji: "🧹", hint: "You read them and the subject is now closed or merged: clear them from your GitHub inbox"},
    {key: "watching", title: "Other read notifications", emoji: "📻", hint: "Releases, CI runs, discussions and anything without an open/closed state", collapsed: true},
]

function stateBadge(n) {
    if (n.merged || n.state === "MERGED") return <Badge tone="purple">merged</Badge>
    if (n.state === "CLOSED") return <Badge tone="neutral">closed</Badge>
    if (n.state === "OPEN") return <Badge tone={n.isDraft ? "neutral" : "green"}>{n.isDraft ? "draft" : "open"}</Badge>
    return null
}

function keep(n, query, reason) {
    if (reason && n.reason !== reason) return false
    return matchesQuery(query, n.title, n.repo, n.reasonLabel, n.type, n.number != null ? `#${n.number}` : "")
}

function NotifRow({n}) {
    const badges = (
        <>
            {stateBadge(n)}
            <Badge tone="neutral" title={`Notification reason: ${n.reason}`}>
                {n.reasonLabel}
            </Badge>
        </>
    )
    const meta = (
        <>
            <span className="mini">{SUBJECT_TYPES[n.type] || n.type}</span>
            {n.lastReadAt && <span className="mini">read {timeAgo(n.lastReadAt)} ago</span>}
            {n.reviewDecision === "CHANGES_REQUESTED" && <span className="mini warn">changes requested</span>}
        </>
    )
    return <Row item={n} leading={<span className={cx("dot", n.unread ? "unread" : "read")} title={n.unread ? "unread" : "read"} />} badges={badges} meta={meta} />
}

export default function Inbox({notifications, query}) {
    const [reason, setReason] = useSticky("inbox.reason", null)
    if (!notifications) {
        return (
            <Empty>
                The notification inbox could not be loaded. It needs the <code>notifications</code> scope: run <code>gh auth refresh -s notifications</code>.
            </Empty>
        )
    }
    const {groups, reasons, truncated} = notifications
    const sections = SECTIONS.map((def) => ({def, list: (groups[def.key] || []).filter((n) => keep(n, query, reason))})).filter((s) => s.list.length > 0)

    return (
        <>
            <div className="toolbar">
                <span className="toolbar-label">Reason</span>
                <button className={cx("pill", !reason && "active")} onClick={() => setReason(null)}>
                    all
                </button>
                {reasons.map((r) => (
                    <button key={r.reason} className={cx("pill", reason === r.reason && "active")} onClick={() => setReason(reason === r.reason ? null : r.reason)}>
                        {r.label} <span className="pill-count">{r.count}</span>
                    </button>
                ))}
                <a className="link" href="https://github.com/notifications" target="_blank" rel="noreferrer">
                    open GitHub inbox ↗
                </a>
            </div>
            {truncated && <div className="banner subtle">Showing the 300 most recent notifications — older ones are not fetched.</div>}
            {sections.length === 0 && <Empty>{query || reason ? "No notification matches this filter." : "Inbox zero. 🎉"}</Empty>}
            {sections.map(({def, list}) => (
                <Section key={def.key} storageKey={`inbox.${def.key}`} title={def.title} emoji={def.emoji} hint={def.hint} count={list.length} collapsedByDefault={def.collapsed}>
                    <div className="rows">
                        {list.map((n) => (
                            <NotifRow key={n.id} n={n} />
                        ))}
                    </div>
                </Section>
            ))}
        </>
    )
}
