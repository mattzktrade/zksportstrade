-- Fix incorrect Champions Club shell → Paddock Club Suite SF product links for Dutch GP.
-- The old fuzzy matching linked Champions Club shells to Paddock Club Suite's single ticket
-- products (PR-000437/438/439) because "club" + "friday" scored high enough.
-- This migration:
--   1. Clears the SF link from Champions Club shells that hold PR-000437/438/439
--   2. Finds the Paddock Club Suite shells for the same race and re-links them
--   3. If Paddock Club Suite shells don't exist yet they'll be created on next sync

BEGIN;

-- Step 1: Identify the Salesforce IDs held by the wrongly-linked packages.
-- Save them into a temp table so we can re-assign them to the correct shells.
CREATE TEMP TABLE _fix_shell_relink AS
SELECT
  p.id            AS wrong_shell_id,
  p.product_code,
  p.salesforce_product_id,
  p.shell_parent_package_id,
  p.duration,
  parent.name     AS parent_name
FROM packages p
JOIN packages parent ON parent.id = p.shell_parent_package_id
WHERE p.product_code IN ('PR-000437', 'PR-000438', 'PR-000439')
  AND p.shell_parent_package_id IS NOT NULL;

-- Step 2: Clear the incorrect SF links on Champions Club shells.
UPDATE packages
SET salesforce_product_id = NULL,
    product_code = NULL,
    integration_sync_status = 'not_synced',
    integration_sync_error = NULL,
    integration_synced_at = NULL
WHERE product_code IN ('PR-000437', 'PR-000438', 'PR-000439')
  AND shell_parent_package_id IS NOT NULL;

-- Step 3: Find the Paddock Club - Club Suite parent (product_code PR-000436) and
-- re-link its shells to the correct SF products by matching duration.
UPDATE packages AS shell
SET salesforce_product_id = fix.salesforce_product_id,
    product_code = fix.product_code,
    integration_sync_status = 'not_synced'
FROM _fix_shell_relink fix
JOIN packages club_suite_parent
  ON club_suite_parent.product_code = 'PR-000436'
  AND club_suite_parent.shell_parent_package_id IS NULL
WHERE shell.shell_parent_package_id = club_suite_parent.id
  AND shell.duration = fix.duration;

DROP TABLE _fix_shell_relink;

COMMIT;
