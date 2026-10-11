ALTER TABLE users
    DROP INDEX uq_users_email,
    DROP COLUMN password_hash, DROP COLUMN must_change_password, DROP COLUMN password_changed_at,
    DROP COLUMN failed_logins, DROP COLUMN locked_until, DROP COLUMN token_version, DROP COLUMN last_login_at,
    ADD COLUMN entra_oid UUID NOT NULL DEFAULT uuid();
