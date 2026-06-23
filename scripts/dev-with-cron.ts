/**
 * Local dev with automatic integration cron (offline Salesforce sales, holds, outbox).
 * Same behaviour as production Vercel cron, but runs every 60s by default.
 */
import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { config } from "dotenv"

config({ path: resolve(process.cwd(), ".env.local") })

const child = spawn("npx", ["next", "dev"], {
  stdio: "inherit",
  env: { ...process.env, ENABLE_LOCAL_INTEGRATION_CRON: "true" },
  cwd: process.cwd(),
  shell: true,
})

child.on("exit", (code) => process.exit(code ?? 0))

function shutdown(): void {
  child.kill("SIGINT")
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
