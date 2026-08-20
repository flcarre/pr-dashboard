import React, {useMemo} from "react"
import {Badge, BoardChips, Due, Empty, Labels, Row, Section, useSticky} from "../ui.jsx"
import {cx, dateShort, matchesQuery, plural, priorityTone, statusTone} from "../lib/format.js"

const GROUPINGS = [
    {key: "sprint", label: "Sprint"},
    {key: "epic", label: "Epic"},
    {key: "status", label: "Status"},
    {key: "priority", label: "Priority"},
]

const STATUS_ORDER = [/in ?review|review/i, /in ?progress|doing|en cours|wip/i, /block|hold/i, /ready|to ?do|next/i, /backlog|triage|new/i, /done|shipped/i]

function statusRank(status) {
    if (!status) return STATUS_ORDER.length
    const idx = STATUS_ORDER.findIndex((re) => re.test(status))
    return idx === -1 ? STATUS_ORDER.length : idx
}

function keep(row, query) {
    return matchesQuery(
        query,
        row.item.title,
        row.item.repo,
        `#${row.item.number}`,
        row.project.title,
        row.status,
        row.epic?.label,
        row.iteration?.title,
        row.priority,
        row.area,
        (row.item.labels || []).map((l) => l.name),
    )
}

function groupKey(row, grouping) {
    if (grouping === "sprint") return row.iteration?.title || "No sprint"
    if (grouping === "epic") return row.epic?.label || "No epic"
    if (grouping === "status") return row.status || "No status"
    if (grouping === "priority") return row.priority || "No priority"
    return "All"
}

function groupRows(rows, grouping) {
    const map = new Map()
    for (const row of rows) {
        const key = groupKey(row, grouping)
        if (!map.has(key)) map.set(key, {key, rows: [], current: false, url: null, startDate: null, duration: null})
        const group = map.get(key)
        group.rows.push(row)
        if (grouping === "sprint" && row.iteration?.current) {
            group.current = true
            group.startDate = row.iteration.startDate
            group.duration = row.iteration.duration
        }
        if (grouping === "epic" && row.epic?.url) group.url = row.epic.url
    }
    const groups = [...map.values()]
    if (grouping === "status") groups.sort((a, b) => statusRank(a.key) - statusRank(b.key))
    else if (grouping === "sprint") groups.sort((a, b) => Number(b.current) - Number(a.current) || (a.key === "No sprint" ? 1 : b.key === "No sprint" ? -1 : a.key.localeCompare(b.key)))
    else groups.sort((a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key))
    return groups
}

function points(rows) {
    return rows.reduce((n, r) => n + (typeof r.estimate === "number" ? r.estimate : 0), 0)
}

function BoardRow({row, grouping}) {
    const badges = (
        <>
            {row.status && <Badge tone={statusTone(row.status)}>{row.status}</Badge>}
            {row.priority && <Badge tone={priorityTone(row.priority)}>{row.priority}</Badge>}
            {typeof row.estimate === "number" && <Badge tone="neutral">{row.estimate} pt</Badge>}
            <Due date={row.due} />
        </>
    )
    const meta = (
        <>
            {row.item.kind === "pr" && <span className="mini">PR</span>}
            {grouping !== "sprint" && row.iteration?.title && <span className={cx("mini", row.iteration.current && "current")}>🏃 {row.iteration.title}</span>}
            {grouping !== "epic" && row.epic?.label && (
                <span className="mini" title={`epic from ${row.epic.source}`}>
                    🧩 {row.epic.label}
                </span>
            )}
            {row.area && <span className="mini">🗂️ {row.area}</span>}
            {row.extraFields?.slice(0, 2).map((f) => (
                <span key={f.field} className="mini">
                    {f.field}: {String(f.value)}
                </span>
            ))}
            <Labels labels={row.item.labels} max={3} />
        </>
    )
    return <Row item={row.item} badges={badges} meta={meta} />
}

export default function Boards({boards, query, warnings}) {
    const [grouping, setGrouping] = useSticky("boards.grouping", "sprint")
    const [currentOnly, setCurrentOnly] = useSticky("boards.currentOnly", false)

    const projects = useMemo(() => {
        if (!boards) return []
        return boards.projects
            .map((project) => {
                const rows = project.rows.filter((row) => keep(row, query)).filter((row) => !currentOnly || row.iteration?.current)
                return {...project, filtered: rows, filteredPoints: points(rows), groups: groupRows(rows, grouping)}
            })
            .filter((p) => p.filtered.length > 0)
    }, [boards, query, grouping, currentOnly])

    if (!boards) return <Empty>Board data could not be loaded — see the error banner above.</Empty>

    const shownRows = projects.reduce((n, p) => n + p.filtered.length, 0)
    const noBoard = (boards.noBoard || []).filter((i) => matchesQuery(query, i.title, i.repo, `#${i.number}`))

    return (
        <>
            <div className="toolbar">
                <span className="toolbar-label">Group by</span>
                {GROUPINGS.map((g) => (
                    <button key={g.key} className={cx("pill", grouping === g.key && "active")} onClick={() => setGrouping(g.key)}>
                        {g.label}
                    </button>
                ))}
                <button className={cx("pill", currentOnly && "active")} onClick={() => setCurrentOnly(!currentOnly)} title="Only items in a sprint that is running right now">
                    current sprint only
                </button>
                <span className="toolbar-spacer" />
                <span className="toolbar-label">
                    {plural(shownRows, "board item")} · {plural(projects.length, "project")}
                </span>
            </div>

            {warnings?.length > 0 && projects.length === 0 && <div className="banner subtle">{warnings.join(" ")}</div>}

            {projects.length === 0 && noBoard.length === 0 && (
                <Empty>{query || currentOnly ? "Nothing matches this filter." : "Nothing assigned to you sits on a project board."}</Empty>
            )}

            {projects.map((project) => (
                <Section
                    key={project.url || project.title}
                    storageKey={`board.${project.url || project.title}`}
                    title={project.title}
                    emoji="📋"
                    count={project.filtered.length}
                    right={
                        <span className="section-right">
                            {project.filteredPoints > 0 && <Badge tone="neutral">{project.filteredPoints} pts</Badge>}
                            {project.url && (
                                <a className="link" href={project.url} target="_blank" rel="noreferrer">
                                    open board ↗
                                </a>
                            )}
                        </span>
                    }
                >
                    {project.groups.map((group) => (
                        <div key={group.key} className={cx("group", group.current && "group-current")}>
                            <div className="group-head">
                                {group.url ? (
                                    <a className="group-title" href={group.url} target="_blank" rel="noreferrer">
                                        {group.key}
                                    </a>
                                ) : (
                                    <span className="group-title">{group.key}</span>
                                )}
                                {group.current && <Badge tone="green">current</Badge>}
                                {group.startDate && (
                                    <span className="mini">
                                        {dateShort(group.startDate)}
                                        {group.duration ? ` · ${group.duration}d` : ""}
                                    </span>
                                )}
                                <span className="count">{group.rows.length}</span>
                                {points(group.rows) > 0 && <span className="mini">{points(group.rows)} pts</span>}
                            </div>
                            <div className="rows">
                                {group.rows.map((row) => (
                                    <BoardRow key={row.key} row={row} grouping={grouping} />
                                ))}
                            </div>
                        </div>
                    ))}
                </Section>
            ))}

            {noBoard.length > 0 && (
                <Section
                    storageKey="board.noBoard"
                    title="Assigned to me, on no board"
                    emoji="🧭"
                    count={noBoard.length}
                    hint="Work that exists but no sprint or project tracks it"
                    collapsedByDefault
                >
                    <div className="rows">
                        {noBoard.map((item) => (
                            <Row
                                key={item.url}
                                item={item}
                                badges={item.kind === "pr" ? <Badge tone="neutral">PR</Badge> : null}
                                meta={
                                    <>
                                        <Labels labels={item.labels} max={3} />
                                        {item.milestone && <span className="mini">🏁 {item.milestone.title}</span>}
                                        <BoardChips boards={item.boards} />
                                    </>
                                }
                            />
                        ))}
                    </div>
                </Section>
            )}
        </>
    )
}
