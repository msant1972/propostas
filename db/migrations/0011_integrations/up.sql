-- Contacto do cliente (mínimo necessário para enviar a ligação do portal) e dados da sincronização com o CRM.
ALTER TABLE clients
    ADD COLUMN contact_name  VARCHAR(255),
    ADD COLUMN contact_email VARCHAR(255),
    ADD COLUMN crm_synced_at DATETIME(6),
    ADD KEY ix_clients_contact_email (contact_email);

-- Chaves de API para integrações (CRM): só o hash da chave fica guardado.
CREATE TABLE api_keys (
    id           UUID PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    key_prefix   CHAR(8)      NOT NULL,
    key_hash     CHAR(64)     NOT NULL UNIQUE,
    scopes       VARCHAR(255) NOT NULL,
    created_by   UUID         NOT NULL,
    created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_used_at DATETIME(6),
    revoked_at   DATETIME(6),
    FOREIGN KEY (created_by) REFERENCES users(id)
);
