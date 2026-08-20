import {execFile} from "node:child_process"
import {defineConfig} from "vite"
import react from "@vitejs/plugin-react"
import {getPrsPayload} from "./server/prs.mjs"
import {getDashboard} from "./server/dashboard.mjs"

const PORT = Number(process.env.PR_DASH_PORT || 7337)
const DEFAULT_BROWSER = "Dia"

const ROUTES = {
    "/api/dashboard": async (url) => {
        const sections = (url.searchParams.get("sections") || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        return getDashboard({force: url.searchParams.get("force") === "1", sections})
    },
    "/api/prs": async () => getPrsPayload(),
}

function ghApi() {
    return {
        name: "gh-dashboard-api",
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                if (!req.url) return next()
                const url = new URL(req.url, "http://localhost")
                const handler = ROUTES[url.pathname]
                if (!handler) return next()
                res.setHeader("content-type", "application/json")
                res.setHeader("cache-control", "no-store")
                try {
                    res.end(JSON.stringify(await handler(url)))
                } catch (e) {
                    res.statusCode = 500
                    res.end(JSON.stringify({error: String(e?.message || e)}))
                }
            })
        },
    }
}

function openInBrowser() {
    return {
        name: "open-in-browser",
        configureServer(server) {
            if (process.env.PR_DASH_NO_OPEN) return
            server.httpServer?.once("listening", () => {
                const url = `http://localhost:${server.config.server.port || PORT}/`
                const browser = process.env.BROWSER || DEFAULT_BROWSER
                execFile("open", ["-a", browser, url], (err) => {
                    if (err) execFile("open", [url])
                })
            })
        },
    }
}

export default defineConfig({
    plugins: [react(), ghApi(), openInBrowser()],
    server: {port: PORT, strictPort: true, open: false},
})
