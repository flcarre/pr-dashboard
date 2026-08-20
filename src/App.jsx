import React, {useCallback, useEffect, useMemo, useRef, useState} from "react"
import {useHotkeys, useSticky} from "./ui.jsx"
import {cx, timeAgo} from "./lib/format.js"
import Focus from "./views/Focus.jsx"
import Prs from "./views/Prs.jsx"
import Issues from "./views/Issues.jsx"
import Inbox from "./views/Inbox.jsx"
import Boards from "./views/Boards.jsx"

const REFRESH_MS = 120_000

const TABS = [
    {key: "focus", label: "Focus", hint: "Everything waiting on you, ranked"},
    {key: "prs", label: "Pull requests", hint: "Reviews to do, your PRs, what you are blocking"},
    {key: "issues", label: "Issues", hint: "Assigned, mentioned, authored, recently closed"},
    {key: "inbox", label: "Notifications", hint: "Unread, moved-since-read, opened-and-forgotten, clearable"},
    {key: "boards", label: "Boards", hint: "Project board items by sprint, epic, status"},
]

function badgeFor(tab, stats) {
    if (!stats) return null
    if (tab === "focus") return null
    if (tab === "prs") return stats.reviewsToDo || null
    if (tab === "issues") return stats.assignedIssues || null
    if (tab === "inbox") return stats.unread || null
    if (tab === "boards") return stats.sprintItems || null
    return null
}

export default function App() {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [tab, setTab] = useSticky("tab", "focus")
    const [query, setQuery] = useState("")
    const [autoRefresh, setAutoRefresh] = useSticky("autoRefresh", true)
    const searchRef = useRef(null)

    const load = useCallback(async (force) => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`/api/dashboard${force ? "?force=1" : ""}`)
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
    }, [load])

    useEffect(() => {
        if (!autoRefresh) return
        const id = setInterval(() => load(true), REFRESH_MS)
        return () => clearInterval(id)
    }, [autoRefresh, load])

    const hotkeys = useMemo(
        () => ({
            r: () => load(true),
            "/": () => searchRef.current?.focus(),
            "1": () => setTab("focus"),
            "2": () => setTab("prs"),
            "3": () => setTab("issues"),
            "4": () => setTab("inbox"),
            "5": () => setTab("boards"),
        }),
        [load, setTab],
    )
    useHotkeys(hotkeys)

    const scopeLabel = useMemo(() => {
        if (!data) return ""
        const {orgs = [], repos = []} = data.scope || {}
        if (!orgs.length && !repos.length) return "all orgs"
        return [...orgs, ...repos].join(", ")
    }, [data])

    return (
        <div className="app">
            <header className="topbar">
                <div className="brand">
                    <h1>GitHub dashboard</h1>
                    {data?.me && <span className="me">@{data.me}</span>}
                    {scopeLabel && <span className="scope" title="Scope — set PR_DASH_ORGS or pr-dashboard.config.json">{scopeLabel}</span>}
                </div>
                <div className="controls">
                    <input
                        ref={searchRef}
                        className="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Filter (press /)"
                        spellCheck={false}
                    />
                    {query && (
                        <button className="ghost" onClick={() => setQuery("")} title="Clear filter">
                            ✕
                        </button>
                    )}
                    <button
                        className={cx("ghost", autoRefresh && "on")}
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        title={autoRefresh ? `Auto-refresh every ${REFRESH_MS / 1000}s — click to pause` : "Auto-refresh paused — click to resume"}
                    >
                        {autoRefresh ? "auto" : "paused"}
                    </button>
                    {data && <span className="stamp">updated {timeAgo(data.generatedAt)} ago</span>}
                    <button className="refresh" onClick={() => load(true)} disabled={loading}>
                        {loading ? "…" : "↻ Refresh"}
                    </button>
                </div>
            </header>

            <nav className="tabs">
                {TABS.map((t) => {
                    const badge = badgeFor(t.key, data?.stats)
                    return (
                        <button key={t.key} className={cx("tab", tab === t.key && "active")} onClick={() => setTab(t.key)} title={t.hint}>
                            {t.label}
                            {badge ? <span className="tab-badge">{badge}</span> : null}
                        </button>
                    )
                })}
            </nav>

            {error && <div className="banner error">Could not reach the dashboard API: {error}</div>}
            {loading && !data && <div className="banner">Loading pull requests, issues, notifications and boards via gh…</div>}

            {data?.errors?.length > 0 && (
                <div className="banner warn">
                    <strong>Partial data.</strong>
                    <ul>
                        {data.errors.slice(0, 6).map((e, i) => (
                            <li key={i}>
                                <code>{e.source}</code>: {e.error}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {data?.warnings?.length > 0 && (
                <div className="banner subtle">
                    {data.warnings.map((w, i) => (
                        <div key={i}>{w}</div>
                    ))}
                </div>
            )}

            {data && (
                <main className="content">
                    {tab === "focus" && <Focus data={data} query={query} onGo={setTab} />}
                    {tab === "prs" && <Prs prs={data.prs} query={query} />}
                    {tab === "issues" && <Issues issues={data.issues} query={query} staleDays={data.staleDays} features={data.features} />}
                    {tab === "inbox" && <Inbox notifications={data.notifications} query={query} />}
                    {tab === "boards" && <Boards boards={data.boards} query={query} warnings={data.warnings} />}
                </main>
            )}

            <footer className="footer">
                <span>
                    Shortcuts: <kbd>1</kbd>–<kbd>5</kbd> tabs · <kbd>/</kbd> filter · <kbd>r</kbd> refresh
                </span>
            </footer>
        </div>
    )
}
