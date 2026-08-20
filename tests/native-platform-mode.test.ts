import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import {
  getPlatformRuntimeMode,
  isNativePlatformMode,
  isSalesforceRuntimeEnabled,
} from "../lib/platform/runtime-mode"
import {
  getSalesforceConfig,
  isSalesforceConfigured,
} from "../lib/integrations/salesforce/config"

const originalSalesforceClientId = process.env.SALESFORCE_CLIENT_ID
const originalSalesforceClientSecret = process.env.SALESFORCE_CLIENT_SECRET
const originalSalesforceInstanceUrl = process.env.SALESFORCE_INSTANCE_URL

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

afterEach(() => {
  restoreEnv("SALESFORCE_CLIENT_ID", originalSalesforceClientId)
  restoreEnv("SALESFORCE_CLIENT_SECRET", originalSalesforceClientSecret)
  restoreEnv("SALESFORCE_INSTANCE_URL", originalSalesforceInstanceUrl)
})

test("the platform is native-only after Salesforce retirement", () => {
  assert.equal(getPlatformRuntimeMode(), "native")
  assert.equal(isNativePlatformMode(), true)
  assert.equal(isSalesforceRuntimeEnabled(), false)
})

test("legacy env flags cannot turn Salesforce back on", () => {
  delete process.env.ZK_PLATFORM_MODE
  process.env.ZK_PLATFORM_MODE = "legacy"

  assert.equal(getPlatformRuntimeMode(), "native")
  assert.equal(isSalesforceRuntimeEnabled(), false)
})

test("Salesforce stays off even when leftover credentials remain present", () => {
  process.env.SALESFORCE_CLIENT_ID = "legacy-client"
  process.env.SALESFORCE_CLIENT_SECRET = "legacy-secret"
  process.env.SALESFORCE_INSTANCE_URL = "https://legacy.example.test"

  assert.equal(isSalesforceConfigured(), false)
  assert.equal(getSalesforceConfig(), null)
})
