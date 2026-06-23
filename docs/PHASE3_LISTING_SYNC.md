# Phase 3 — Listing content sync

## ZK Sports Product2 field map (portalwix sandbox)

| Portal data | Salesforce label | API name | Type |
|-------------|------------------|----------|------|
| Name | Product Name | `Name` | Text |
| Description | Product Description | `Description` | Text Area |
| Includes | Inclusions | `Inclusions__c` | Rich Text Area |
| Hero image | Image URL | `Image_URL_c__c` | URL |
| Gallery | Gallery Images | `Gallery_Images_c__c` | Long Text Area |
| Brochure | Brochure URL | `Brochure_URL_c__c` | URL |
| Event / race | Event Name | `Event_Name__c` | Lookup(Event) |
| Trade price | Unit Price | `Unit_Price__c` | Currency |
| Stock received | Stock Quantity | `Stock_Quantity__c` | Number |
| Sellable now | Available Quantity | `Available_Quantity__c` | Number |
| Cost source | Source | `Source__c` | Long Text Area |
| Product code (read) | Product Code | `Product_Code__c` | Auto Number |
| Qty / value sold (read) | Quantity Sold / Value Sold | `Quantity_Sold__c` / `Value_Sold__c` | Formula / Currency |

These API names are the **defaults** in `lib/integrations/salesforce/config.ts` (matched to your **portalwix** sandbox via the API).

**Important:** Salesforce may show a label like “Image URL” while the real API name is `Image_URL_c__c` (extra `_c`). Check **Fields & Relationships → click the field → Field Name** — that exact value must match the portal default or your `.env.local` override.

Override per org with `SALESFORCE_FIELD_*` in `.env.local` if production uses different API names (e.g. `Image_URL__c` without the extra `_c`).

## What syncs

When you save a package in **Admin → Catalog** (or add stock / queue sync), the existing `product.upsert` outbox job pushes:

| Portal field | Salesforce | Notes |
|--------------|------------|--------|
| Name | `Name` | Phase 2 |
| Description | `Description` | Only when description is set in admin |
| Includes | `Inclusions__c` | HTML bullet list for Rich Text |
| Hero image URL | `Image_URL__c` | HTTPS; relative paths need `NEXT_PUBLIC_APP_URL` |
| Gallery URLs | `Gallery_Images__c` | One URL per line |
| Brochure URL | `Brochure_URL__c` | HTTPS |
| Event / race | `Event_Name__c` | Phase 2 |
| Trade price / stock | Pricebook + qty fields | Phase 2 |

**Wix:** Payload is built on every sync; API push is **Phase 4** (no-op until `channel_listings` rows exist).

## Page layout

Add these fields to the Product **Lightning record page** or **page layout** so staff can see synced content: Description, Inclusions, Image URL, Gallery Images, Brochure URL.

## Verify

1. Edit description, includes, or image on a mapped package in Admin → Catalog → Save.
2. Sync runs automatically (or **Integrations → Process sync queue**).
3. Refresh the Salesforce product record.

```bash
npx tsx scripts/sf-product-sync-diagnose.ts --sync <package-id>
```

## Wix (Phase 4 prep)

See master plan — `channel_listings` mapping required before live Wix content push.
