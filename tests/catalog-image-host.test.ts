import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { canOptimizeCatalogImage } from "../lib/images/next-image-host"

describe("canOptimizeCatalogImage", () => {
  it("allows local and already-configured CDNs", () => {
    assert.equal(canOptimizeCatalogImage("/placeholder.svg"), true)
    assert.equal(canOptimizeCatalogImage("/images/circuits/yas.jpg"), true)
    assert.equal(
      canOptimizeCatalogImage("https://static.wixstatic.com/media/abc~mv2.jpg"),
      true,
    )
    assert.equal(
      canOptimizeCatalogImage("https://proj.supabase.co/storage/v1/object/public/package-images/a.jpg"),
      true,
    )
  })

  it("rejects unknown remote hosts so next/image is not used", () => {
    assert.equal(
      canOptimizeCatalogImage(
        "https://www.abudhabigp.com/documents/75946/2623105/Marina-Views-Suite-500x400px_2.avif",
      ),
      false,
    )
    assert.equal(
      canOptimizeCatalogImage("https://example.com/gallery/photo.jpg"),
      false,
    )
  })
})
