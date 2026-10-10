CREATE TABLE share_links (
    id               UUID PRIMARY KEY,
    proposal_id      UUID NOT NULL,
    document_id      UUID NOT NULL,
    token_hash       CHAR(64) NOT NULL UNIQUE,
    expires_at       DATETIME(6) NOT NULL,
    revoked_at       DATETIME(6),
    first_opened_at  DATETIME(6),
    last_opened_at   DATETIME(6),
    open_count       INT NOT NULL DEFAULT 0,
    created_by       UUID NOT NULL,
    created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY ix_sl_proposal (proposal_id),
    FOREIGN KEY (proposal_id) REFERENCES proposals(id),
    FOREIGN KEY (document_id) REFERENCES documents(id),
    FOREIGN KEY (created_by)  REFERENCES users(id)
);

CREATE TABLE customer_responses (
    id              UUID PRIMARY KEY,
    share_link_id   UUID NOT NULL UNIQUE,
    proposal_id     UUID NOT NULL,
    decision        ENUM('ACCEPTED','DECLINED') NOT NULL,
    signer_name     VARCHAR(255) NOT NULL,
    signer_email    VARCHAR(255) NOT NULL,
    comment         TEXT,
    document_sha256 CHAR(64) NOT NULL,
    ip_address      VARCHAR(45),
    user_agent      VARCHAR(500),
    decided_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    FOREIGN KEY (share_link_id) REFERENCES share_links(id),
    FOREIGN KEY (proposal_id)   REFERENCES proposals(id)
);
