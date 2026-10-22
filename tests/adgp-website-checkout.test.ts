import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { adgpUnitPrice, catalogItemFor } from "../lib/integrations/adgp/catalog"
import { verifyAdgpApiSecret } from "../lib/integrations/adgp/auth"
import {
  ADGP_API_SECRET_HEADER,
  ADGP_NOTIFY_EMAILS,
  CONTACT_ONLY_SLUGS,
  DEFAULT_ADGP_OWNER_EMAIL,
  isAdgpDay,
  isContactOnlySlug,
} from "../lib/integrations/adgp/config"
import { websiteCustomerEmailSubject, websiteOrderNotifyRecipients } from "../lib/email/send-website-order"
import {
  classifySalesChannel,
  isAgentPortalBooking,
  isPortalCheckoutChannel,
  isPrepaidCheckoutChannel,
} from "../lib/orders/channel"
import { isPublicApiPath, isSessionlessApiPath } from "../lib/supabase/session-guard"
import { DEAL_SOURCES } from "../lib/crm/deal-types"

const sql = readFileSync(
  new URL("../supabase/migrations/20261021120000_adgp_website_checkout.sql", import.meta.url),
  "utf8",
)
const fixSql = readFileSync(
  new URL("../supabase/migrations/20261022103000_fix_website_order_lead_stage.sql", import.meta.url),
  "utf8",
)

describe("ADGP website checkout mapping", () => {
  it("never treats Paddock Club as a contact-only exception that can be sold", () => {
    assert.equal(isContactOnlySlug("paddock-club"), true)
    assert.ok(CONTACT_ONLY_SLUGS.includes("paddock-club"))
    assert.match(sql, /adgp_package_map/)
    assert.doesNotMatch(sql, /'paddock-club'/)
    assert.match(sql, /abudhabi-skybridge-terrace-friday-2026/)
    assert.match(sql, /abudhabi-2026-3-days-velocity-terrace/)
    assert.match(sql, /abudhabi-2026-south-club/)
    assert.match(sql, /abudhabi-2026-west-grandstand/)
    assert.doesNotMatch(sql, /sat-sun/)
  })

  it("accepts the ADGP day labels used on the site", () => {
    assert.equal(isAdgpDay("3-day weekend"), true)
    assert.equal(isAdgpDay("Friday"), true)
    assert.equal(isAdgpDay("Saturday & Sunday"), false)
  })

  it("matches catalog rows by slug and day only", () => {
    const friday = {
      slug: "skybridge-terrace",
      day: "Friday",
      packageId: "abudhabi-skybridge-terrace-friday-2026",
      name: "Friday Skybridge",
      currency: "USD",
      unitPrice: 495,
      sellable: 12,
      buyable: true,
      reason: null,
    }
    assert.equal(catalogItemFor([friday], "skybridge-terrace", "Friday")?.packageId, friday.packageId)
    assert.equal(catalogItemFor([friday], "skybridge-terrace", "Saturday"), null)
    assert.equal(catalogItemFor([friday], "paddock-club", "Friday"), null)
  })
})

describe("ADGP website order SQL", () => {
  it("adds a website order channel and prepaid paid deal owned by the supplied profile", () => {
    assert.match(sql, /channel in \('trade_portal', 'wix', 'partner_api', 'admin', 'native_deal', 'website'\)/)
    assert.match(sql, /create or replace function public.place_website_order/)
    assert.match(sql, /create or replace function public.place_website_checkout_hold/)
    assert.match(sql, /source,\s+stage,/s)
    assert.match(sql, /'website'/)
    assert.match(sql, /'paid_confirmed'/)
    assert.match(sql, /'talking'/)
    assert.doesNotMatch(sql, /lead_stage = null/)
    assert.match(fixSql, /create or replace function public.place_website_order/)
    assert.match(fixSql, /'talking'/)
    assert.doesNotMatch(fixSql, /lead_stage = null/)
    assert.match(sql, /p_owner_profile_id/)
    assert.match(sql, /owner_profile_required/)
    assert.match(sql, /linked_inventory_sellable/)
    assert.match(sql, /leaves_one_remaining/)
    assert.match(sql, /adjust_linked_inventory_available/)
    assert.match(sql, /allocate_order_cost_layers/)
    assert.match(sql, /external_order_id/)
    assert.doesNotMatch(sql, /create or replace function public.place_wix_order/)
    assert.doesNotMatch(sql, /ingestMarketingLead/)
    assert.doesNotMatch(sql, /create or replace function public.place_order\(/)
  })
})

describe("ADGP auth and notify", () => {
  it("checks the dedicated ADGP secret in constant time", () => {
    const request = new Request("https://zk-sports.trade/api/adgp/catalog", {
      headers: { [ADGP_API_SECRET_HEADER]: "secret-a" },
    })
    assert.equal(verifyAdgpApiSecret(request, "secret-a"), true)
    assert.equal(verifyAdgpApiSecret(request, "secret-b"), false)
    assert.equal(DEFAULT_ADGP_OWNER_EMAIL, "matt@zk-sports.com")
    assert.deepEqual(websiteOrderNotifyRecipients(), ["bookings@zk-sports.com", "matt@zk-sports.com"])
    assert.equal(websiteCustomerEmailSubject("Skybridge Terrace"), "Your booking is confirmed — Skybridge Terrace")
    assert.ok(ADGP_NOTIFY_EMAILS.includes("matt@zk-sports.com"))
  })
})

describe("ADGP channel and session paths", () => {
  it("counts website orders in the Website sold bucket and keeps them off the agent portal", () => {
    assert.equal(classifySalesChannel("website"), "wix")
    assert.equal(isPortalCheckoutChannel("website"), false)
    assert.equal(
      isAgentPortalBooking({
        agentProfileId: "agent-1",
        viewerProfileId: "agent-1",
        channel: "website",
      }),
      false,
    )
    assert.equal(DEAL_SOURCES.includes("website"), true)
  })

  it("treats /api/adgp as sessionless", () => {
    assert.equal(isSessionlessApiPath("/api/adgp/catalog"), true)
    assert.equal(isPublicApiPath("/api/adgp/orders"), true)
    assert.equal(isSessionlessApiPath("/api/webhooks/marketing-lead"), true)
  })

  it("keeps website checkout prepaid and off Xero / portal deal attach", () => {
    assert.equal(isPrepaidCheckoutChannel("website"), true)
    assert.equal(isPrepaidCheckoutChannel("wix"), true)
    assert.equal(isPrepaidCheckoutChannel("trade_portal"), false)
    const orders = readFileSync(new URL("../lib/integrations/adgp/orders.ts", import.meta.url), "utf8")
    assert.match(orders, /enqueuePackageInventoryChannelSyncServer/)
    assert.doesNotMatch(orders, /enqueueOrderIntegrationsServer/)
    assert.match(orders, /sendWebsiteOrderEmail/)
    assert.match(orders, /sendWebsiteCustomerEmail/)
    assert.match(orders, /placeWebsiteOrderInApp/)
    const catalog = readFileSync(new URL("../lib/integrations/adgp/catalog.ts", import.meta.url), "utf8")
    assert.match(catalog, /isContactOnlySlug/)
    assert.match(catalog, /effectiveSellableByPackageId/)
    assert.match(catalog, /adgpUnitPrice/)
    assert.doesNotMatch(catalog, /retailPriceFromTrade/)
    assert.equal(adgpUnitPrice(495), 495)
    assert.equal(adgpUnitPrice(3825), 3825)
    assert.equal(adgpUnitPrice(4455, 1.1, null), 4455)
    assert.equal(adgpUnitPrice(5000, null, 5500), 5500)
    assert.equal(adgpUnitPrice(0), 0)
    assert.equal(adgpUnitPrice(null), null)
    const email = readFileSync(new URL("../lib/email/send-website-order.ts", import.meta.url), "utf8")
    assert.doesNotMatch(email, /getBookingConfirmationCc/)
    assert.match(email, /sendWebsiteCustomerEmail/)
    assert.match(email, /Your booking is confirmed/)
  })
})
