-- RFN V12.4.0: associate each subscriber with their PPPoE username.
-- Passwords are intentionally not stored in the customer record.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pppoe_username varchar(180);

CREATE UNIQUE INDEX IF NOT EXISTS customers_pppoe_username_unique_idx
  ON customers (pppoe_username)
  WHERE pppoe_username IS NOT NULL AND btrim(pppoe_username) <> '';
