import {ghGraphql, inScope, scopeQualifier, cleanMessage} from "./gh.mjs"

const PAGE_SIZE = 50
const MAX_PAGES = 4

const FIELD_VALUES = `
    fieldValues(first: 30) {
        nodes {
            __typename
            ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldIterationValue { title startDate duration field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldMilestoneValue { milestone { title } field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldLabelValue { labels(first: 5) { nodes { name } } field { ... on ProjectV2FieldCommon { name } } }
        }
    }`

const PROJECT_ITEMS = `
    projectItems(first: 6, includeArchived: false) {
        nodes {
            isArchived
            project { title number url closed }
            ${FIELD_VALUES}
        }
    }`

const LINKED_PRS = `
    closedByPullRequestsReferences(first: 6, includeClosedPrs: true) {
        totalCount
        nodes {
            number
            title
            url
            state
            isDraft
            merged
            mergedAt
            updatedAt
            reviewDecision
            mergeable
            author { login }
            repository { nameWithOwner }
            commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
        }
    }`

const SUB_ISSUES = `
    subIssuesSummary { total completed percentCompleted }`

const COMMON = `
    number
    title
    url
    state
    createdAt
    updatedAt
    repository { nameWithOwner }
    author { login }
    assignees(first: 6) { nodes { login } }
    labels(first: 12) { nodes { name color } }
    milestone { title dueOn }
    comments { totalCount }`

/**
 * Search issues/PRs through GraphQL. `features` lets us retry with pieces
 * disabled when the token or the schema doesn't support them.
 */
function buildQuery(features) {
    const projects = features.projects ? PROJECT_ITEMS : ""
    const parent = features.parent ? "parent { number title url state repository { nameWithOwner } }" : ""
    const linkedPrs = features.linkedPrs ? LINKED_PRS : ""
    const subIssues = features.subIssues ? SUB_ISSUES : ""
    return `
    query($q: String!, $first: Int!, $after: String) {
        search(query: $q, type: ISSUE, first: $first, after: $after) {
            issueCount
            pageInfo { hasNextPage endCursor }
            nodes {
                __typename
                ... on Issue {
                    ${COMMON}
                    closedAt
                    stateReason
                    ${parent}
                    ${linkedPrs}
                    ${subIssues}
                    ${projects}
                }
                ... on PullRequest {
                    ${COMMON}
                    closedAt
                    isDraft
                    merged
                    mergedAt
                    reviewDecision
                    ${projects}
                }
            }
        }
    }`
}

const FIELD_MATCHERS = [
    ["status", /^(status|statut|state|colonne|column|stage)$/i],
    ["iteration", /^(sprint|iteration|itération|cycle)$/i],
    ["epic", /^(epic|epics|feature|thème|theme|initiative|chantier)$/i],
    ["priority", /^(priorit(y|é|e)|prio|urgency)$/i],
    ["estimate", /^(estimate|estimation|points|story ?points|size|taille|effort)$/i],
    ["due", /^(due|due ?date|deadline|target ?date|échéance|echeance)$/i],
    ["area", /^(area|team|équipe|equipe|squad|component|composant|scope)$/i],
]

function classifyField(name) {
    for (const [key, re] of FIELD_MATCHERS) if (re.test(name || "")) return key
    return null
}

function isCurrentIteration(startDate, duration) {
    if (!startDate || !duration) return false
    const start = new Date(`${startDate}T00:00:00Z`).getTime()
    const end = start + duration * 86_400_000
    const now = Date.now()
    return now >= start && now < end
}

function readFieldValue(node) {
    switch (node.__typename) {
        case "ProjectV2ItemFieldSingleSelectValue":
            return {value: node.name, type: "select"}
        case "ProjectV2ItemFieldIterationValue":
            return {
                value: node.title,
                type: "iteration",
                startDate: node.startDate,
                duration: node.duration,
                current: isCurrentIteration(node.startDate, node.duration),
            }
        case "ProjectV2ItemFieldTextValue":
            return {value: node.text, type: "text"}
        case "ProjectV2ItemFieldNumberValue":
            return {value: node.number, type: "number"}
        case "ProjectV2ItemFieldDateValue":
            return {value: node.date, type: "date"}
        case "ProjectV2ItemFieldMilestoneValue":
            return {value: node.milestone?.title, type: "milestone"}
        case "ProjectV2ItemFieldLabelValue":
            return {value: (node.labels?.nodes || []).map((l) => l.name).join(", "), type: "labels"}
        default:
            return null
    }
}

function shapeProjectItem(item) {
    const out = {
        project: {
            title: item.project?.title || "Project",
            number: item.project?.number ?? null,
            url: item.project?.url || "",
            closed: !!item.project?.closed,
        },
        status: null,
        iteration: null,
        epic: null,
        priority: null,
        estimate: null,
        due: null,
        area: null,
        fields: [],
    }
    for (const node of item.fieldValues?.nodes || []) {
        const name = node?.field?.name
        const read = readFieldValue(node)
        if (!name || !read || read.value === null || read.value === undefined || read.value === "") continue
        const key = read.type === "iteration" ? "iteration" : classifyField(name)
        if (key === "iteration") {
            if (!out.iteration || read.current) {
                out.iteration = {
                    title: read.value,
                    startDate: read.startDate,
                    duration: read.duration,
                    current: read.current,
                    field: name,
                }
            }
        } else if (key && out[key] === null) {
            out[key] = {value: read.value, field: name}
        } else {
            out.fields.push({field: name, value: read.value, type: read.type})
        }
    }
    return out
}

const CI_TONES = {SUCCESS: "green", FAILURE: "red", ERROR: "red", PENDING: "blue", EXPECTED: "blue"}

function shapeLinkedPr(node) {
    const rollup = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || null
    const merged = !!node.merged
    return {
        kind: "pr",
        repo: node.repository?.nameWithOwner || "",
        number: node.number,
        title: node.title,
        url: node.url,
        state: merged ? "MERGED" : (node.state || "").toUpperCase(),
        isDraft: !!node.isDraft,
        mergedAt: node.mergedAt || null,
        updatedAt: node.updatedAt || null,
        reviewDecision: node.reviewDecision || null,
        conflicts: node.mergeable === "CONFLICTING",
        author: node.author?.login || "",
        ci: rollup ? {state: rollup, tone: CI_TONES[rollup] || "neutral"} : null,
    }
}

function shapeItem(node) {
    const isPr = node.__typename === "PullRequest"
    const repo = node.repository?.nameWithOwner || ""
    return {
        kind: isPr ? "pr" : "issue",
        repo,
        number: node.number,
        title: node.title,
        url: node.url,
        state: (node.state || "").toUpperCase(),
        stateReason: node.stateReason || null,
        isDraft: !!node.isDraft,
        merged: !!node.merged,
        mergedAt: node.mergedAt || null,
        reviewDecision: node.reviewDecision || null,
        author: node.author?.login || "",
        assignees: (node.assignees?.nodes || []).map((a) => a.login),
        labels: (node.labels?.nodes || []).map((l) => ({name: l.name, color: l.color})),
        milestone: node.milestone ? {title: node.milestone.title, dueOn: node.milestone.dueOn} : null,
        comments: node.comments?.totalCount ?? 0,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        closedAt: node.closedAt || null,
        parent: node.parent
            ? {
                  number: node.parent.number,
                  title: node.parent.title,
                  url: node.parent.url,
                  state: node.parent.state,
                  repo: node.parent.repository?.nameWithOwner || "",
              }
            : null,
        linkedPrs: (node.closedByPullRequestsReferences?.nodes || []).filter(Boolean).map(shapeLinkedPr),
        subIssues: node.subIssuesSummary?.total
            ? {
                  total: node.subIssuesSummary.total,
                  completed: node.subIssuesSummary.completed ?? 0,
                  percent: node.subIssuesSummary.percentCompleted ?? 0,
              }
            : null,
        boards: (node.projectItems?.nodes || []).filter((n) => n && !n.isArchived).map(shapeProjectItem),
        sources: [],
    }
}

/** Feature support is discovered once and reused across queries. */
const features = {projects: true, parent: true, linkedPrs: true, subIssues: true}
const warnings = new Set()

function degrade(error) {
    const msg = String(error?.message || "")
    let changed = false
    if (features.projects && /projectItems|read:project|scope/i.test(msg)) {
        features.projects = false
        changed = true
        warnings.add(
            "Project (board) data is unavailable: the gh token lacks the `read:project` scope. Run `gh auth refresh -s read:project,project` to enable the Boards tab.",
        )
    }
    if (features.linkedPrs && /closedByPullRequestsReferences/i.test(msg)) {
        features.linkedPrs = false
        changed = true
        warnings.add("Linked pull requests are unavailable on this GitHub version; issues show without their PR status.")
    }
    if (features.subIssues && /subIssuesSummary/i.test(msg)) {
        features.subIssues = false
        changed = true
        warnings.add("Sub-issue progress is unavailable on this GitHub version.")
    }
    if (features.parent && /\bparent\b/i.test(msg)) {
        features.parent = false
        changed = true
        warnings.add("Sub-issue parents are unavailable on this GitHub version; epics fall back to project fields and labels.")
    }
    return changed
}

async function fetchPage(q, after) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const before = JSON.stringify(features)
        try {
            return await ghGraphql(buildQuery(features), {q, first: PAGE_SIZE, after})
        } catch (e) {
            degrade(e)
            // Retry as soon as the query got narrower — either by us, or by a
            // sibling search that hit the same unsupported field first.
            if (JSON.stringify(features) !== before) continue
            throw new Error(cleanMessage(e))
        }
    }
    throw new Error("gh graphql kept failing after narrowing the query")
}

async function runSearch(q) {
    const nodes = []
    let after = null
    for (let page = 0; page < MAX_PAGES; page++) {
        const data = await fetchPage(q, after)
        const search = data?.search
        if (!search) break
        nodes.push(...(search.nodes || []).filter(Boolean))
        if (!search.pageInfo?.hasNextPage) break
        after = search.pageInfo.endCursor
    }
    return nodes
}

/**
 * Run several labelled searches, merge them by URL and keep track of which
 * search each item came from (its `sources`).
 */
export async function searchItems(queries) {
    const scope = scopeQualifier()
    const byUrl = new Map()
    const errors = []
    const results = await Promise.all(
        queries.map(async ({source, query}) => {
            try {
                return {source, nodes: await runSearch(`${query}${scope}`)}
            } catch (e) {
                errors.push({source, error: cleanMessage(e)})
                return {source, nodes: []}
            }
        }),
    )
    for (const {source, nodes} of results) {
        for (const node of nodes) {
            if (!node.url) continue
            const repo = node.repository?.nameWithOwner || ""
            if (!inScope(repo)) continue
            const existing = byUrl.get(node.url)
            if (existing) {
                if (!existing.sources.includes(source)) existing.sources.push(source)
                continue
            }
            const item = shapeItem(node)
            item.sources.push(source)
            byUrl.set(item.url, item)
        }
    }
    return {items: [...byUrl.values()], errors, warnings: [...warnings], features: {...features}}
}
