export const RACE_COLUMNS =
  "id, name, short_name, location, country, country_code, event_date, date_range, image, season" as const

export const PACKAGE_COLUMNS =
  "id, race_id, name, circuit, location, country, country_code, event_date, date_range, trade_price, currency, total_capacity, is_enquiry, is_hidden, requires_booking_approval, image, tier, duration, inventory_group_id, includes, featured, sort_order, brochure_url, description, gallery_images, product_code, salesforce_product_id, salesforce_product_family, retail_price_multiplier, sell_on_trade_portal, sell_on_wix, sell_on_partners, integration_sync_status, integration_synced_at, integration_sync_error" as const

export const INVENTORY_COLUMNS = "package_id, qty_available, qty_held" as const
