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

  const { startLocalIntegrationCron } = await import("./lib/integrations/local-integration-cron")
  startLocalIntegrationCron()
}
