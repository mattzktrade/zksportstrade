/**
 * Poll the integration cron HTTP endpoint against an already-running `next dev` server.
 * Use `npm run dev:local` instead if you want cron built into the dev server process.
 */
import { resolve } from "node:path"
import { config } from "dotenv"
import { runLocalIntegrationCronHttp } from "../lib/integrations/local-integration-cron"

config({ path: resolve(process.cwd(), ".env.local") })

void runLocalIntegrationCronHttp()
