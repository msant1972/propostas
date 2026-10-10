CREATE TABLE content_blocks (
    id            UUID PRIMARY KEY,
    code          VARCHAR(50)  NOT NULL UNIQUE,
    title         VARCHAR(255) NOT NULL,
    is_legal      BOOLEAN      NOT NULL DEFAULT FALSE,
    owner_user_id UUID         NOT NULL,
    created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    deleted_at    DATETIME(6),
    FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE TABLE content_block_versions (
    id              UUID PRIMARY KEY,
    block_id        UUID NOT NULL,
    language        CHAR(5) NOT NULL,
    version_number  INT NOT NULL,
    status          ENUM('DRAFT','APPROVED','RETIRED') NOT NULL DEFAULT 'DRAFT',
    body_html       MEDIUMTEXT NOT NULL,
    review_due_date DATE NOT NULL,
    created_by      UUID NOT NULL,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_cbv (block_id, language, version_number),
    FOREIGN KEY (block_id)   REFERENCES content_blocks(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE tags (
    id   UUID PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE content_block_tags (
    block_id UUID NOT NULL,
    tag_id   UUID NOT NULL,
    PRIMARY KEY (block_id, tag_id),
    FOREIGN KEY (block_id) REFERENCES content_blocks(id),
    FOREIGN KEY (tag_id)   REFERENCES tags(id)
);

CREATE TABLE proposal_sections (
    id               UUID PRIMARY KEY,
    proposal_id      UUID NOT NULL,
    position         SMALLINT NOT NULL,
    title            VARCHAR(255) NOT NULL,
    block_version_id UUID,                       -- NULL em secções escritas de raiz
    is_modified      BOOLEAN NOT NULL DEFAULT FALSE,
    row_version      INT NOT NULL DEFAULT 1,
    KEY ix_ps_order (proposal_id, position),
    FOREIGN KEY (proposal_id)      REFERENCES proposals(id) ON DELETE RESTRICT,
    FOREIGN KEY (block_version_id) REFERENCES content_block_versions(id)
);

CREATE TABLE section_documents (
    section_id UUID PRIMARY KEY,
    ydoc_state LONGBLOB NOT NULL,                -- estado Yjs persistido pelo Hocuspocus
    html_cache MEDIUMTEXT,                       -- HTML derivado, usado na compilação
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (section_id) REFERENCES proposal_sections(id) ON DELETE CASCADE
);

ALTER TABLE proposals DROP COLUMN sp_drive_id, DROP COLUMN sp_folder_item_id, ADD COLUMN folder_path VARCHAR(500);

-- Repositório documental: pasta local do servidor (DOCUMENT_STORAGE_DIR). `storage_key` é o caminho relativo.
CREATE TABLE documents (
    id               UUID PRIMARY KEY,
    proposal_id      UUID NOT NULL,
    quote_version_id UUID,
    kind             ENUM('DOCX','PDF','SIGNED_PDF','ATTACHMENT') NOT NULL,
    origin           ENUM('GENERATED','MANUALLY_EDITED','UPLOADED') NOT NULL,
    folder           ENUM('01_Trabalho','02_Enviado','03_Assinado') NOT NULL,
    file_name        VARCHAR(255) NOT NULL,
    storage_key      VARCHAR(500) NOT NULL UNIQUE,
    sha256           CHAR(64)     NOT NULL,
    size_bytes       BIGINT       NOT NULL,
    generated_from   UUID,
    created_by       UUID,
    created_at       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY ix_doc_proposal (proposal_id, created_at),
    FOREIGN KEY (proposal_id)      REFERENCES proposals(id),
    FOREIGN KEY (quote_version_id) REFERENCES quote_versions(id),
    FOREIGN KEY (generated_from)   REFERENCES documents(id),
    FOREIGN KEY (created_by)       REFERENCES users(id)
);
