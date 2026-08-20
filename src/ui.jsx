import React, {useCallback, useEffect, useState} from "react"
import {cx, dateShort, repoClass, repoShort, timeAgo, REVIEWER_STATE} from "./lib/format.js"

export function useSticky(key, initial) {
    const [value, setValue] = useState(() => {
        try {
            const raw = localStorage.getItem(`prdash.${key}`)
            return raw === null ? initial : JSON.parse(raw)
        } catch {
            return initial
        }
    })
    const set = useCallback(
        (next) => {
            setValue((prev) => {
                const resolved = typeof next === "function" ? next(prev) : next
                try {
                    localStorage.setItem(`prdash.${key}`, JSON.stringify(resolved))
                } catch {}
                return resolved
            })
        },
        [key],
    )
    return [value, set]
}

export function Badge({tone = "neutral", title, children}) {
    return (
        <span className={`badge tone-${tone}`} title={title}>
            {children}
        </span>
    )
}

export function RepoTag({repo, full}) {
    if (!repo) return null
    return (
        <span className={`repo repo-${repoClass(repo)}`} title={repo}>
            {full ? repo : repoShort(repo)}
        </span>
    )
}

function luminance(hex) {
    const v = (hex || "").replace("#", "")
    if (v.length !== 6) return 0.5
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function labelStyle(color) {
    if (!color) return undefined
    const hex = `#${color.replace("#", "")}`
    const dark = luminance(hex) < 0.35
    return dark ? {background: `${hex}cc`, color: "#fff", borderColor: hex} : {background: `${hex}22`, color: hex, borderColor: `${hex}66`}
}

export function Labels({labels, max = 4}) {
    if (!labels || labels.length === 0) return null
    const shown = labels.slice(0, max)
    return (
        <span className="labels">
            {shown.map((l) => (
                <span key={l.name} className="label" style={labelStyle(l.color)}>
                    {l.name}
                </span>
            ))}
            {labels.length > max && <span className="label more">+{labels.length - max}</span>}
        </span>
    )
}

export function Reviewers({reviewers}) {
    if (!reviewers || reviewers.length === 0) return <div className="reviewers empty">No reviewer assigned</div>
    return (
        <div className="reviewers">
            <span className="reviewers-label">Reviewers</span>
            {reviewers.map((r) => {
                const s = REVIEWER_STATE[r.state] || {mark: "?", tone: "neutral"}
                return (
                    <span key={r.login} className={`reviewer tone-${s.tone}`} title={r.state}>
                        {r.team ? "team " : "@"}
                        {r.login} <span className="reviewer-mark">{s.mark}</span>
                    </span>
                )
            })}
        </div>
    )
}

export function BoardChips({boards, max = 2}) {
    if (!boards || boards.length === 0) return null
    return (
        <span className="board-chips">
            {boards.slice(0, max).map((b, i) => (
                <span key={`${b.project.url || b.project.title}-${i}`} className="board-chip" title={b.project.title}>
                    <span className="board-chip-name">{b.project.title}</span>
                    {b.status?.value && <span className="board-chip-status">{b.status.value}</span>}
                    {b.iteration?.title && <span className={cx("board-chip-sprint", b.iteration.current && "current")}>{b.iteration.title}</span>}
                </span>
            ))}
        </span>
    )
}

export function Section({title, emoji, hint, count, right, children, collapsedByDefault = false, storageKey}) {
    const [collapsed, setCollapsed] = useSticky(`collapse.${storageKey || title}`, collapsedByDefault)
    return (
        <section className={cx("section", collapsed && "is-collapsed")}>
            <header className="section-head">
                <button className="section-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
                    <span className={cx("caret", collapsed && "closed")}>{collapsed ? "▸" : "▾"}</span>
                    {emoji && <span className="emoji">{emoji}</span>}
                    <span className="section-title">{title}</span>
                    {count !== undefined && <span className="count">{count}</span>}
                </button>
                {right}
                {hint && !collapsed && <p className="hint">{hint}</p>}
            </header>
            {!collapsed && children}
        </section>
    )
}

export function Empty({children}) {
    return <div className="empty-state">{children}</div>
}

export function StatTile({label, value, tone = "neutral", hint, onClick, active}) {
    const Tag = onClick ? "button" : "div"
    return (
        <Tag className={cx("tile", `tile-${tone}`, active && "active", onClick && "clickable")} onClick={onClick} title={hint}>
            <span className="tile-value">{value ?? "–"}</span>
            <span className="tile-label">{label}</span>
        </Tag>
    )
}

/**
 * Compact one-line row used by the issue, inbox and board lists: repo, number,
 * title, then whatever badges the view wants on the right.
 */
export function Row({item, href, leading, badges, meta, tone}) {
    return (
        <a className={cx("row", tone && `row-${tone}`)} href={href || item?.url} target="_blank" rel="noreferrer">
            <div className="row-main">
                {leading}
                <RepoTag repo={item?.repo} />
                {item?.number != null && <span className="num">#{item.number}</span>}
                <span className="row-title">{item?.title}</span>
            </div>
            <div className="row-side">
                {badges}
                {item?.updatedAt && <span className="ago">{timeAgo(item.updatedAt)}</span>}
            </div>
            {meta && <div className="row-meta">{meta}</div>}
        </a>
    )
}

export function Due({date}) {
    if (!date) return null
    const day = new Date(String(date).length === 10 ? `${date}T00:00:00Z` : date)
    const overdue = day.getTime() < Date.now()
    return (
        <Badge tone={overdue ? "red" : "neutral"} title={String(date)}>
            due {dateShort(date)}
        </Badge>
    )
}

/** Bind single-key shortcuts, ignoring keystrokes typed into inputs. */
export function useHotkeys(map) {
    useEffect(() => {
        const onKey = (e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return
            const tag = (e.target?.tagName || "").toLowerCase()
            if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) {
                if (e.key === "Escape") e.target.blur()
                return
            }
            const fn = map[e.key]
            if (fn) {
                e.preventDefault()
                fn()
            }
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [map])
}
