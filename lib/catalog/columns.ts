export const RACE_COLUMNS =
  "id, name, short_name, location, country, country_code, event_date, date_range, image, season" as const

export const PACKAGE_COLUMNS =
  "id, race_id, name, circuit, location, country, country_code, event_date, date_range, trade_price, currency, total_capacity, is_enquiry, image, tier, includes, featured, sort_order, brochure_url, description, gallery_images" as const

export const INVENTORY_COLUMNS = "package_id, qty_available, qty_held" as const
