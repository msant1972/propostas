CREATE TABLE approval_policies (
    id             UUID PRIMARY KEY,
    name           VARCHAR(100) NOT NULL,
    scope          ENUM('COMMERCIAL','LEGAL') NOT NULL,
    -- JSONLogic sobre: max_line_discount_percent, margin_percent, grand_total, has_modified_legal_section
    condition_json JSON NOT NULL CHECK (JSON_VALID(condition_json)),
    mode           ENUM('SEQUENTIAL','PARALLEL') NOT NULL DEFAULT 'SEQUENTIAL',
    -- [{"level":1,"role":"Gestor_Comercial","sla_hours":24,"escalate_to_role":"Aprovador_Financeiro"}]
    levels_json    JSON NOT NULL CHECK (JSON_VALID(levels_json)),
    priority       SMALLINT NOT NULL DEFAULT 100,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    valid_from     DATE NOT NULL,
    valid_to       DATE
);

CREATE TABLE approval_requests (
    id                   UUID PRIMARY KEY,
    proposal_id          UUID NOT NULL,
    quote_version_id     UUID NOT NULL,
    document_id          UUID NOT NULL,
    policy_id            UUID NOT NULL,
    policy_snapshot_json JSON NOT NULL,
    scope                ENUM('COMMERCIAL','LEGAL') NOT NULL,
    status               ENUM('OPEN','APPROVED','REJECTED','RETURNED','CANCELLED','SUPERSEDED') NOT NULL DEFAULT 'OPEN',
    current_level        TINYINT NOT NULL DEFAULT 1,
    level_due_at         DATETIME(6),
    snapshot_hash        CHAR(64) NOT NULL,
    document_sha256      CHAR(64) NOT NULL,
    requested_by         UUID NOT NULL,
    requested_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    closed_at            DATETIME(6),
    KEY ix_ar_open (status, level_due_at),
    FOREIGN KEY (proposal_id)      REFERENCES proposals(id),
    FOREIGN KEY (quote_version_id) REFERENCES quote_versions(id),
    FOREIGN KEY (document_id)      REFERENCES documents(id),
    FOREIGN KEY (policy_id)        REFERENCES approval_policies(id),
    FOREIGN KEY (requested_by)     REFERENCES users(id)
);

CREATE TABLE approval_decisions (
    id                  UUID PRIMARY KEY,
    approval_request_id UUID NOT NULL,
    level_number        TINYINT NOT NULL,
    approver_user_id    UUID NOT NULL,
    on_behalf_of_user_id UUID,
    decision            ENUM('APPROVED','REJECTED','RETURNED') NOT NULL,
    comment             TEXT,
    snapshot_hash       CHAR(64) NOT NULL,
    document_sha256     CHAR(64),
    decided_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_ad (approval_request_id, level_number, approver_user_id),
    FOREIGN KEY (approval_request_id)  REFERENCES approval_requests(id),
    FOREIGN KEY (approver_user_id)     REFERENCES users(id),
    FOREIGN KEY (on_behalf_of_user_id) REFERENCES users(id)
);

CREATE TABLE approval_delegations (
    id           UUID PRIMARY KEY,
    from_user_id UUID NOT NULL,
    to_user_id   UUID NOT NULL,
    valid_from   DATE NOT NULL,
    valid_to     DATE NOT NULL,
    created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT chk_deleg_dates CHECK (valid_to >= valid_from),
    CONSTRAINT chk_deleg_self CHECK (from_user_id <> to_user_id),
    FOREIGN KEY (from_user_id) REFERENCES users(id),
    FOREIGN KEY (to_user_id)   REFERENCES users(id)
);

ALTER TABLE proposals
    ADD COLUMN sent_at DATETIME(6),
    ADD COLUMN status_reason VARCHAR(500);

-- split
-- Auditoria append-only também na base de dados: nem a aplicação consegue reescrever ou apagar linhas.
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log é append-only';
END
-- split
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log é append-only';
END
