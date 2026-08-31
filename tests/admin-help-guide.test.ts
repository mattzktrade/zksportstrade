import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  DEFAULT_HELP_TOPIC,
  HELP_TOPIC_IDS,
  HELP_TOPICS,
  isHelpTopicId,
  searchHelp,
} from "../lib/admin/help-guide"

describe("admin help guide", () => {
  it("has unique topic ids matching the public list", () => {
    const ids = HELP_TOPICS.map((topic) => topic.id)
    assert.deepEqual(ids, [...HELP_TOPIC_IDS])
    assert.equal(new Set(ids).size, ids.length)
  })

  it("starts on getting started and every topic has usable copy", () => {
    assert.equal(DEFAULT_HELP_TOPIC, "start")
    for (const topic of HELP_TOPICS) {
      assert.ok(topic.nav.trim())
      assert.ok(topic.title.trim())
      assert.ok(topic.summary.trim())
      assert.ok(topic.blocks.length > 0)
    }
  })

  it("finds selling and stock topics from everyday words", () => {
    const deals = searchHelp("booking form")
    assert.ok(deals.topics.some((topic) => topic.id === "sales"))

    const ready = searchHelp("ready to send")
    assert.ok(ready.topics.some((topic) => topic.id === "sales"))

    const stock = searchHelp("purchase order")
    assert.ok(stock.topics.some((topic) => topic.id === "inventory"))

    const questions = searchHelp("password")
    assert.ok(questions.questions.some((item) => item.q.toLowerCase().includes("password")))

    const leads = searchHelp("leads")
    assert.ok(leads.topics.some((topic) => topic.id === "sales"))
  })

  it("ignores unknown hashes", () => {
    assert.equal(isHelpTopicId("start"), true)
    assert.equal(isHelpTopicId("not-a-topic"), false)
  })
})
