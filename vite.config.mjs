import {execFile} from "node:child_process"
import {defineConfig} from "vite"
import react from "@vitejs/plugin-react"
import {getPrs} from "./server/prs.mjs"

const PORT = 7337
const DEFAULT_BROWSER = "Dia"

function ghApi() {
    return {
        name: "gh-pr-api",
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                if (!req.url || req.url.split("?")[0] !== "/api/prs") return next()
                const force = req.url.includes("force=1")
                try {
                    const data = await getPrs({force})
                    res.setHeader("content-type", "application/json")
                    res.end(JSON.stringify(data))
                } catch (e) {
                    res.statusCode = 500
                    res.setHeader("content-type", "application/json")
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
