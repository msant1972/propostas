-- Emails repetidos (possíveis em bases antigas, onde o email não era único) ficam distintos antes de passarem a ser a chave de acesso.
UPDATE users u
JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY email ORDER BY id) AS rn FROM users) d ON d.id = u.id
SET u.email = CONCAT(SUBSTRING_INDEX(u.email, '@', 1), '+dup', d.rn, '@', SUBSTRING_INDEX(u.email, '@', -1))
WHERE d.rn > 1;

-- split
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
