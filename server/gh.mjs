import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {readFileSync} from "node:fs"

const exec = promisify(execFile)
const MAX_BUFFER = 64 * 1024 * 1024

function readConfig() {
    try {
        return JSON.parse(readFileSync(new URL("../pr-dashboard.config.json", import.meta.url)))
    } catch {
        return {}
    }
}

const CONFIG = readConfig()

function listOption(envVar, key) {
    if (process.env[envVar]) {
        return process.env[envVar]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
    }
    const value = CONFIG[key]
    return Array.isArray(value) ? value.filter(Boolean) : []
}

/** Orgs the dashboard is scoped to. Empty = no filter. */
export const ORGS = listOption("PR_DASH_ORGS", "orgs")

/** Extra repos (owner/name) to always include, even outside the scoped orgs. */
export const EXTRA_REPOS = listOption("PR_DASH_REPOS", "repos")

export function orgOf(nameWithOwner) {
    return (nameWithOwner || "").split("/")[0]
}

/** True when a repo passes the org scope (extra repos always pass). */
export function inScope(nameWithOwner) {
    if (!nameWithOwner) return true
    if (EXTRA_REPOS.includes(nameWithOwner)) return true
    if (!ORGS.length) return true
    return ORGS.includes(orgOf(nameWithOwner))
}

/** `owner:x owner:y` search qualifiers for the configured scope, or "". */
export function scopeQualifier() {
    const parts = ORGS.map((o) => `org:${o}`).concat(EXTRA_REPOS.map((r) => `repo:${r}`))
    return parts.length ? ` ${parts.join(" ")}` : ""
}

export async function gh(args) {
    const {stdout} = await exec("gh", args, {maxBuffer: MAX_BUFFER})
    return stdout
}

export async function ghJson(args) {
    const out = await gh(args)
    return out.trim() ? JSON.parse(out) : null
}

/** REST call through gh, e.g. ghApi("/notifications?all=true"). */
export async function ghApi(path, {method} = {}) {
    const args = ["api", "-H", "Accept: application/vnd.github+json"]
    if (method) args.push("-X", method)
    args.push(path)
    return ghJson(args)
}

/**
 * GraphQL through gh. Throws an Error carrying `.graphqlErrors` when the API
 * answers with an `errors` array, so callers can degrade on unknown fields.
 */
export async function ghGraphql(query, variables = {}) {
    const args = ["api", "graphql", "-f", `query=${query}`]
    for (const [k, v] of Object.entries(variables)) {
        if (v === undefined || v === null) continue
        args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`)
    }
    let raw
    try {
        raw = await gh(args)
    } catch (e) {
        // gh exits non-zero on GraphQL errors but still prints the JSON body.
        const body = String(e?.stdout || "")
        const parsed = safeParse(body)
        if (parsed?.errors?.length) throw graphqlError(parsed.errors)
        throw new Error(cleanMessage(e))
    }
    const parsed = safeParse(raw)
    if (!parsed) throw new Error("gh graphql returned no JSON")
    if (parsed.errors?.length && !parsed.data) throw graphqlError(parsed.errors)
    if (parsed.errors?.length) parsed.data.__errors = parsed.errors
    return parsed.data
}

function safeParse(text) {
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

function graphqlError(errors) {
    const err = new Error(errors.map((e) => e.message).join("; "))
    err.graphqlErrors = errors
    return err
}

export function cleanMessage(e) {
    const raw = String(e?.stderr || e?.message || e)
    return raw.split("\n").filter(Boolean).slice(0, 3).join(" — ").slice(0, 400)
}

/** Run `fn` over `items` with at most `size` in flight. */
export async function pool(items, size, fn) {
    const out = new Array(items.length)
    let cursor = 0
    const workers = Array.from({length: Math.max(1, Math.min(size, items.length))}, async () => {
        while (cursor < items.length) {
            const idx = cursor++
            out[idx] = await fn(items[idx], idx)
        }
    })
    await Promise.all(workers)
    return out
}

export function chunk(items, size) {
    const out = []
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
    return out
}

/** Small time-based memo, one entry per key. */
export function makeCache(ttlMs) {
    const store = new Map()
    return {
        async get(key, load, force) {
            const hit = store.get(key)
            if (!force && hit && Date.now() - hit.at < ttlMs) return hit.data
            const data = await load()
            store.set(key, {at: Date.now(), data})
            return data
        },
        clear() {
            store.clear()
        },
    }
}

let mePromise = null

/** Cached viewer login (stable for the process lifetime). */
export async function viewer() {
    if (!mePromise) {
        mePromise = gh(["api", "user", "--jq", ".login"])
            .then((s) => s.trim())
            .catch((e) => {
                mePromise = null
                throw new Error(`gh auth failed: ${cleanMessage(e)}`)
            })
    }
    return mePromise
}
