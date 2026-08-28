export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.NODE_ENV !== "development") return
  if (process.env.ENABLE_LOCAL_INTEGRATION_CRON !== "true") return
  if (!process.env.CRON_SECRET?.trim()) {
    console.warn(
      "[local-cron] ENABLE_LOCAL_INTEGRATION_CRON is set but CRON_SECRET is missing — automatic sync disabled.",
    )
    return
  }

  // Webpack also compiles this file for Edge (middleware/proxy). A normal
  // `import()` of the cron graph pulls Node `crypto` into that compile and
  // breaks `next dev --webpack`. Keep the specifier inside Function so Edge
  // does not trace it; Node still starts the existing tsx cron loop.
  const { spawn } = (await new Function("return import('node:child_process')")()) as typeof import("node:child_process")
  spawn("npx", ["tsx", "scripts/run-local-cron-loop.ts"], {
    env: process.env,
    stdio: "inherit",
    shell: true,
    windowsHide: true,
  })
}
