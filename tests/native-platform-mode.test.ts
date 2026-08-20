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

const originalMode = process.env.ZK_PLATFORM_MODE
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
  restoreEnv("ZK_PLATFORM_MODE", originalMode)
  restoreEnv("SALESFORCE_CLIENT_ID", originalSalesforceClientId)
  restoreEnv("SALESFORCE_CLIENT_SECRET", originalSalesforceClientSecret)
  restoreEnv("SALESFORCE_INSTANCE_URL", originalSalesforceInstanceUrl)
})

test("legacy mode remains the safe default", () => {
  delete process.env.ZK_PLATFORM_MODE

  assert.equal(getPlatformRuntimeMode(), "legacy")
  assert.equal(isNativePlatformMode(), false)
  assert.equal(isSalesforceRuntimeEnabled(), true)
})

test("native mode disables Salesforce runtime access", () => {
  process.env.ZK_PLATFORM_MODE = "native"

  assert.equal(getPlatformRuntimeMode(), "native")
  assert.equal(isNativePlatformMode(), true)
  assert.equal(isSalesforceRuntimeEnabled(), false)
})

test("native mode parsing is case-insensitive and trims whitespace", () => {
  process.env.ZK_PLATFORM_MODE = "  NATIVE  "

  assert.equal(getPlatformRuntimeMode(), "native")
})

test("unknown values fall back to legacy mode", () => {
  process.env.ZK_PLATFORM_MODE = "prototype"

  assert.equal(getPlatformRuntimeMode(), "legacy")
  assert.equal(isSalesforceRuntimeEnabled(), true)
})

test("native mode blocks Salesforce even when legacy credentials remain present", () => {
  process.env.ZK_PLATFORM_MODE = "native"
  process.env.SALESFORCE_CLIENT_ID = "legacy-client"
  process.env.SALESFORCE_CLIENT_SECRET = "legacy-secret"
  process.env.SALESFORCE_INSTANCE_URL = "https://legacy.example.test"

  assert.equal(isSalesforceConfigured(), false)
  assert.equal(getSalesforceConfig(), null)
})
