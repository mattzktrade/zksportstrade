/**
 * Local dev with automatic integration cron (offline Salesforce sales, holds, outbox).
 * Cron runs in a separate tsx process so `next dev` HMR cannot keep stale inventory logic.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { resolve } from "node:path"
import { config } from "dotenv"

config({ path: resolve(process.cwd(), ".env.local") })

const children: ChildProcess[] = []

function spawnChild(command: string, args: string[], extraEnv?: Record<string, string>): ChildProcess {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    cwd: process.cwd(),
    shell: true,
  })
  children.push(child)
  return child
}

// Next dev without in-process cron (see instrumentation.ts).
const nextDev = spawnChild("npx", ["next", "dev", "--webpack"], {
  ENABLE_LOCAL_INTEGRATION_CRON: "false",
})

// Fresh cron graph on every tick — same code path as `npx tsx scripts/verify-*.ts`.
const cronLoop = spawnChild("npx", ["tsx", "scripts/run-local-cron-loop.ts"])

function shutdown(): void {
  for (const child of children) {
    child.kill("SIGINT")
  }
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

nextDev.on("exit", (code) => {
  shutdown()
  process.exit(code ?? 0)
})

cronLoop.on("exit", (code) => {
  if (code && code !== 0) {
    console.error("[dev:local] cron loop exited:", code)
  }
})
