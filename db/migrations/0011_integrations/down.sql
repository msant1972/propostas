DROP TABLE IF EXISTS api_keys;
ALTER TABLE clients DROP INDEX ix_clients_contact_email, DROP COLUMN contact_name, DROP COLUMN contact_email, DROP COLUMN crm_synced_at;
