import assert from "node:assert/strict"
import test from "node:test"
import {
  accountNameMatchesDomain,
  corporateEmailDomain,
  emailDomain,
  isConsumerEmailDomain,
  isPersonLikeAccountName,
  planDomainAccountMerges,
  type DomainGroupAccount,
} from "../lib/crm/email-domain-account-groups"

function account(partial: Partial<DomainGroupAccount> & Pick<DomainGroupAccount, "id" | "name">): DomainGroupAccount {
  return {
    email: null,
    accountTypes: ["direct_client"],
    contactNames: [],
    contactEmails: [],
    dealCount: 0,
    orderCount: 0,
    supplierNames: [],
    createdAt: "2026-08-26T00:00:00.000Z",
    ...partial,
  }
}

test("extracts the registrable domain and ignores consumer mailboxes", () => {
  assert.equal(emailDomain("dawn@senategrandprix.com"), "senategrandprix.com")
  assert.equal(emailDomain("dawn@mail.senategrandprix.com"), "senategrandprix.com")
  assert.equal(emailDomain("jane@apex-travel.co.uk"), "apex-travel.co.uk")
  assert.equal(corporateEmailDomain("dawn@gmail.com"), null)
  assert.equal(corporateEmailDomain("dawn@outlook.com"), null)
  assert.equal(corporateEmailDomain("dawn@hotmail.co.uk"), null)
  assert.equal(isConsumerEmailDomain("gmail.com"), true)
  assert.equal(isConsumerEmailDomain("senategrandprix.com"), false)
})

test("treats person and mailbox names as person-like, and real companies as not", () => {
  assert.equal(isPersonLikeAccountName("Dawn Evans", ["Dawn Evans"]), true)
  assert.equal(isPersonLikeAccountName("Accounts", ["Accounts Primary"]), true)
  assert.equal(isPersonLikeAccountName("Senate", []), false)
  assert.equal(isPersonLikeAccountName("Senate Grand Prix", ["Dawn Evans"]), false)
  assert.equal(isPersonLikeAccountName("Apex Travel", ["Jane Smith"]), false)
})

test("does not match a company whose name merely contains the domain letters", () => {
  assert.equal(accountNameMatchesDomain("Ctrip Travel Holding (Hong Kong) Limited", "trip.com"), false)
  assert.equal(accountNameMatchesDomain("Lee Enterprise, Inc", "salesforce.com"), false)
  assert.equal(accountNameMatchesDomain("GST Entertainment LTD", "joyz.co"), false)
  assert.equal(accountNameMatchesDomain("Exclusive GP Limited", "grandprixevents.com"), false)
  assert.equal(accountNameMatchesDomain("ASMALLWORLD", "asw.com"), false)
  assert.equal(accountNameMatchesDomain("ASW Events AG", "asw.com"), true)
  assert.equal(accountNameMatchesDomain("Eight Obsidia Ltd T/A Avory Astoria", "avoryastoria.com"), true)
  assert.equal(accountNameMatchesDomain("ATM Corporate Events", "atmevents.co.uk"), true)
  assert.equal(accountNameMatchesDomain("Ignite", "weareignite.co.uk"), true)
  assert.equal(accountNameMatchesDomain("Blend Group Ltd", "theblendgroup.com"), true)
  assert.equal(accountNameMatchesDomain("Senate", "senategrandprix.com"), true)
  assert.equal(accountNameMatchesDomain("Senate Grand Prix", "senategrandprix.com"), true)
  assert.equal(accountNameMatchesDomain("Microsoft 365", "microsoft.com"), false)
  assert.equal(accountNameMatchesDomain("Microsoft", "microsoft.com"), true)
  assert.equal(isPersonLikeAccountName("Raphaël Sixou", ["Raphaël Sixou"]), true)
})

test("does not treat a brand-named contact as a person account", () => {
  assert.equal(isPersonLikeAccountName("ASMALLWORLD", ["ASMALLWORLD"]), false)
  assert.equal(isPersonLikeAccountName("accounts@senategrandprix.com", []), true)
})

test("plans a high-confidence merge of person accounts into the matching company", () => {
  const plans = planDomainAccountMerges([
    account({
      id: "senate",
      name: "Senate",
      accountTypes: ["supplier"],
      supplierNames: ["Senate"],
      email: null,
    }),
    account({
      id: "dawn",
      name: "Dawn Evans",
      contactNames: ["Dawn Evans"],
      contactEmails: ["dawn@senategrandprix.com"],
    }),
    account({
      id: "accounts",
      name: "Accounts",
      email: "accounts@senategrandprix.com",
      contactNames: ["Accounts Primary"],
      contactEmails: ["accounts@senategrandprix.com"],
    }),
    account({
      id: "simon",
      name: "Simon Steer",
      contactNames: ["Simon Steer"],
      contactEmails: ["simon@senategrandprix.com"],
    }),
    account({
      id: "gmail-person",
      name: "Pat Gmail",
      contactNames: ["Pat Gmail"],
      contactEmails: ["pat@gmail.com"],
    }),
  ])

  const senate = plans.find((plan) => plan.domain === "senategrandprix.com")
  assert.ok(senate)
  assert.equal(senate?.confidence, "high")
  assert.equal(senate?.target?.id, "senate")
  assert.deepEqual(
    (senate?.sources ?? []).map((source) => source.id).sort(),
    ["accounts", "dawn", "simon"],
  )
  assert.equal(
    plans.some((plan) => plan.sources.some((source) => source.id === "gmail-person")),
    false,
  )
})

test("does not merge when several differently named companies share a domain", () => {
  const plans = planDomainAccountMerges([
    account({
      id: "alpha",
      name: "Alpha Hospitality",
      contactEmails: ["ops@sharedbrand.com"],
    }),
    account({
      id: "beta",
      name: "Beta Tickets",
      contactEmails: ["sales@sharedbrand.com"],
    }),
    account({
      id: "pat",
      name: "Pat Person",
      contactNames: ["Pat Person"],
      contactEmails: ["pat@sharedbrand.com"],
    }),
  ])
  const plan = plans.find((row) => row.domain === "sharedbrand.com")
  assert.equal(plan?.confidence === "high", false)
  assert.equal(plan?.target ?? null, null)
})

test("does not pick between two matching company accounts for the same domain", () => {
  const plans = planDomainAccountMerges([
    account({ id: "ferrari", name: "Ferrari" }),
    account({ id: "hospitality", name: "Ferrari Hospitality" }),
    account({
      id: "francesca",
      name: "Zecchi, Francesca",
      contactNames: ["Zecchi, Francesca"],
      contactEmails: ["francesca.zecchi@ferrari.com"],
    }),
  ])
  const plan = plans.find((row) => row.domain === "ferrari.com")
  assert.equal(plan?.confidence, "skip")
  assert.equal(plan?.target, null)
})

test("does not merge person-only clusters with no company account", () => {
  const plans = planDomainAccountMerges([
    account({
      id: "a",
      name: "Ann Abel",
      contactNames: ["Ann Abel"],
      contactEmails: ["ann@newco-example.com"],
    }),
    account({
      id: "b",
      name: "Ben Abel",
      contactNames: ["Ben Abel"],
      contactEmails: ["ben@newco-example.com"],
    }),
  ])
  const plan = plans.find((row) => row.domain === "newco-example.com")
  assert.equal(plan?.confidence, "skip")
  assert.equal(plan?.target, null)
  assert.equal(plan?.sources.length, 2)
})

test("does not merge when the only company on a domain has an unrelated name", () => {
  const plans = planDomainAccountMerges([
    account({
      id: "gst",
      name: "GST Entertainment LTD",
      contactEmails: ["ops@joyz.co"],
    }),
    account({
      id: "santa",
      name: "Santa Buiko",
      contactNames: ["Santa Buiko"],
      contactEmails: ["operations@joyz.co"],
    }),
  ])
  assert.equal(
    plans.some((plan) => plan.confidence === "high" && plan.sources.some((source) => source.id === "santa")),
    false,
  )
})

test("leaves mixed-domain accounts alone", () => {
  const plans = planDomainAccountMerges([
    account({
      id: "mixed",
      name: "Mixed Person",
      contactNames: ["Mixed Person"],
      contactEmails: ["a@alpha-example.com", "b@beta-example.com"],
    }),
  ])
  const mixed = plans.find((plan) => plan.domain === "(mixed corporate domains)")
  assert.ok(mixed)
  assert.equal(mixed?.confidence, "skip")
  assert.equal(mixed?.skippedAccounts[0]?.account.id, "mixed")
})
