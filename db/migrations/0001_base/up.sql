CREATE TABLE teams (
    id           UUID PRIMARY KEY,
    name         VARCHAR(100) NOT NULL UNIQUE,
    lead_user_id UUID
);

CREATE TABLE users (
    id           UUID PRIMARY KEY,
    entra_oid    UUID         NOT NULL UNIQUE,
    email        VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    team_id      UUID,
    region       VARCHAR(50),
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE TABLE products (
    id              UUID PRIMARY KEY,
    sku             VARCHAR(50)  NOT NULL UNIQUE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    unit_of_measure VARCHAR(20)  NOT NULL DEFAULT 'UN',
    billing_model   ENUM('ONE_TIME','RECURRING','USAGE_BASED','MILESTONE') NOT NULL,
    billing_period  ENUM('MONTH','QUARTER','YEAR'),
    unit_cost       DECIMAL(15,4) NOT NULL DEFAULT 0,
    cost_currency   CHAR(3)      NOT NULL DEFAULT 'EUR',
    tax_category    VARCHAR(30)  NOT NULL DEFAULT 'STANDARD',
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    row_version     INT          NOT NULL DEFAULT 1,
    created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT chk_recurring_period CHECK (billing_model <> 'RECURRING' OR billing_period IS NOT NULL)
);

CREATE TABLE outbox_events (
    id              UUID PRIMARY KEY,
    aggregate_id    UUID         NOT NULL,
    event_type      VARCHAR(100) NOT NULL,
    payload         JSON         NOT NULL,
    status          ENUM('PENDING','PROCESSING','DONE','FAILED') NOT NULL DEFAULT 'PENDING',
    attempts        SMALLINT     NOT NULL DEFAULT 0,
    next_attempt_at DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY ix_outbox_pending (status, next_attempt_at)
);

CREATE TABLE audit_log (
    seq           BIGINT AUTO_INCREMENT PRIMARY KEY,
    occurred_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    actor_user_id UUID,
    entity_type   VARCHAR(50)  NOT NULL,
    entity_id     UUID         NOT NULL,
    action        VARCHAR(50)  NOT NULL,
    diff_json     JSON         NOT NULL,
    prev_hash     CHAR(64)     NOT NULL,
    row_hash      CHAR(64)     NOT NULL,
    KEY ix_audit_entity (entity_type, entity_id)
);
