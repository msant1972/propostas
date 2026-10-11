-- Autenticação local: o utilizador entra com email e palavra-passe; os papéis são atribuídos na aplicação.
ALTER TABLE users
    DROP COLUMN entra_oid,
    ADD COLUMN password_hash        VARCHAR(255),
    ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN password_changed_at  DATETIME(6),
    ADD COLUMN failed_logins        INT NOT NULL DEFAULT 0,
    ADD COLUMN locked_until         DATETIME(6),
    ADD COLUMN token_version        INT NOT NULL DEFAULT 1,
    ADD COLUMN last_login_at        DATETIME(6),
    ADD UNIQUE KEY uq_users_email (email);
