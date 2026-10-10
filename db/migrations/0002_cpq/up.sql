CREATE TABLE clients (
    id            UUID PRIMARY KEY,
    code          VARCHAR(50)  NOT NULL UNIQUE,
    name          VARCHAR(255) NOT NULL,
    vat_number    VARCHAR(30),
    country_code  CHAR(2)      NOT NULL,
    tier          VARCHAR(30),
    vat_valid     BOOLEAN      NOT NULL DEFAULT FALSE,
    crm_external_id VARCHAR(100) UNIQUE,
    created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    deleted_at    DATETIME(6)
);

CREATE TABLE product_attributes (
    id            UUID PRIMARY KEY,
    product_id    UUID NOT NULL,
    code          VARCHAR(50)  NOT NULL,
    label         VARCHAR(100) NOT NULL,
    data_type     ENUM('INTEGER','DECIMAL','LIST','BOOLEAN') NOT NULL,
    min_value     DECIMAL(15,4),
    max_value     DECIMAL(15,4),
    step_value    DECIMAL(15,4),
    allowed_values_json JSON,
    is_required   BOOLEAN NOT NULL DEFAULT FALSE,
    default_value VARCHAR(100),
    UNIQUE KEY uq_pa (product_id, code),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE product_bundle_items (
    id                   UUID PRIMARY KEY,
    bundle_product_id    UUID NOT NULL,
    component_product_id UUID NOT NULL,
    is_required          BOOLEAN NOT NULL DEFAULT TRUE,
    default_quantity     DECIMAL(12,3) NOT NULL DEFAULT 1,
    min_quantity         DECIMAL(12,3),
    max_quantity         DECIMAL(12,3),
    sort_order           SMALLINT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_pbi (bundle_product_id, component_product_id),
    CONSTRAINT chk_pbi_self CHECK (bundle_product_id <> component_product_id),
    FOREIGN KEY (bundle_product_id)    REFERENCES products(id),
    FOREIGN KEY (component_product_id) REFERENCES products(id)
);

CREATE TABLE tax_rates (
    id               UUID PRIMARY KEY,
    country_code     CHAR(2)     NOT NULL,
    tax_category     VARCHAR(30) NOT NULL DEFAULT 'STANDARD',
    regime           ENUM('STANDARD','REDUCED','EXEMPT','REVERSE_CHARGE','OUTSIDE_SCOPE') NOT NULL,
    rate_percent     DECIMAL(5,2) NOT NULL,
    exemption_reason VARCHAR(255),
    valid_from       DATE NOT NULL,
    valid_to         DATE,
    UNIQUE KEY uq_tax (country_code, tax_category, regime, valid_from)
);

CREATE TABLE fx_rates (
    id             UUID PRIMARY KEY,
    base_currency  CHAR(3)       NOT NULL,
    quote_currency CHAR(3)       NOT NULL,
    rate           DECIMAL(18,8) NOT NULL,
    rate_date      DATE          NOT NULL,
    source         VARCHAR(50)   NOT NULL,
    UNIQUE KEY uq_fx (base_currency, quote_currency, rate_date)
);

CREATE TABLE price_lists (
    id          UUID PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    currency    CHAR(3)      NOT NULL,
    region      VARCHAR(50),
    channel     VARCHAR(50),
    client_tier VARCHAR(30),
    valid_from  DATE         NOT NULL,
    valid_to    DATE,
    CONSTRAINT chk_pl_dates CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE price_list_items (
    id            UUID PRIMARY KEY,
    price_list_id UUID NOT NULL,
    product_id    UUID NOT NULL,
    min_quantity  DECIMAL(12,3) NOT NULL DEFAULT 0,
    unit_price    DECIMAL(15,4) NOT NULL,
    UNIQUE KEY uq_pli (price_list_id, product_id, min_quantity),
    FOREIGN KEY (price_list_id) REFERENCES price_lists(id),
    FOREIGN KEY (product_id)    REFERENCES products(id)
);

CREATE TABLE cpq_rules (
    id                UUID PRIMARY KEY,
    source_product_id UUID NOT NULL,
    target_product_id UUID,
    rule_type   ENUM('REQUIRES','EXCLUDES','RECOMMENDS','CONSTRAINT','DEFAULT') NOT NULL,
    params_json JSON CHECK (params_json IS NULL OR JSON_VALID(params_json)),
    condition_json JSON CHECK (condition_json IS NULL OR JSON_VALID(condition_json)),
    priority    SMALLINT NOT NULL DEFAULT 100,
    message     VARCHAR(255),
    valid_from  DATE NOT NULL,
    valid_to    DATE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_rule_self CHECK (target_product_id IS NULL OR target_product_id <> source_product_id),
    FOREIGN KEY (source_product_id) REFERENCES products(id),
    FOREIGN KEY (target_product_id) REFERENCES products(id)
);

CREATE TABLE proposals (
    id             UUID PRIMARY KEY,
    code           VARCHAR(50)  NOT NULL UNIQUE,
    title          VARCHAR(255) NOT NULL,
    client_id      UUID NOT NULL,
    owner_user_id  UUID NOT NULL,
    owner_team_id  UUID,
    region         VARCHAR(50),
    status ENUM('DRAFT','IN_REVIEW','PENDING_APPROVAL','APPROVED','SENT',
                'ACCEPTED','REJECTED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    currency       CHAR(3)      NOT NULL DEFAULT 'EUR',
    language       CHAR(5)      NOT NULL DEFAULT 'pt-PT',
    valid_until    DATE,
    sp_drive_id    VARCHAR(255),
    sp_folder_item_id VARCHAR(255),
    row_version    INT NOT NULL DEFAULT 1,
    created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at     DATETIME(6),
    KEY ix_prop_owner_status (owner_user_id, status),
    FOREIGN KEY (client_id)     REFERENCES clients(id),
    FOREIGN KEY (owner_user_id) REFERENCES users(id),
    FOREIGN KEY (owner_team_id) REFERENCES teams(id)
);

CREATE TABLE quote_versions (
    id              UUID PRIMARY KEY,
    proposal_id     UUID NOT NULL,
    version_number  INT  NOT NULL,
    status          ENUM('DRAFT','LOCKED','SUPERSEDED') NOT NULL DEFAULT 'DRAFT',
    is_current      BOOLEAN NOT NULL DEFAULT TRUE,
    current_flag    TINYINT AS (IF(is_current, 1, NULL)) PERSISTENT,
    price_list_id   UUID NOT NULL,
    currency        CHAR(3) NOT NULL,
    fx_rate_to_eur  DECIMAL(18,8) NOT NULL DEFAULT 1,
    subtotal        DECIMAL(15,2) NOT NULL DEFAULT 0,
    discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_tax       DECIMAL(15,2) NOT NULL DEFAULT 0,
    grand_total     DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_mrr       DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_tcv       DECIMAL(15,2) NOT NULL DEFAULT 0,
    margin_percent  DECIMAL(6,2),
    snapshot_json   JSON,
    snapshot_hash   CHAR(64),
    locked_at       DATETIME(6),
    created_by      UUID NOT NULL,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_qv_number  (proposal_id, version_number),
    UNIQUE KEY uq_qv_current (proposal_id, current_flag),
    CONSTRAINT chk_locked_hash CHECK (status = 'DRAFT' OR snapshot_hash IS NOT NULL),
    FOREIGN KEY (proposal_id)   REFERENCES proposals(id) ON DELETE RESTRICT,
    FOREIGN KEY (price_list_id) REFERENCES price_lists(id),
    FOREIGN KEY (created_by)    REFERENCES users(id)
);

CREATE TABLE quote_items (
    id                UUID PRIMARY KEY,
    quote_version_id  UUID NOT NULL,
    line_number       SMALLINT NOT NULL,
    product_id        UUID NOT NULL,
    product_name_snapshot VARCHAR(255) NOT NULL,
    attributes_json   JSON,
    quantity          DECIMAL(12,3) NOT NULL CHECK (quantity > 0),
    term_months       SMALLINT,
    list_unit_price   DECIMAL(15,4) NOT NULL,
    unit_cost         DECIMAL(15,4) NOT NULL,            -- já na moeda da cotação
    cost_fx_rate      DECIMAL(18,8) NOT NULL DEFAULT 1,  -- moeda de custo -> moeda da cotação
    discount_percent  DECIMAL(5,2)  NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
    net_unit_price    DECIMAL(15,4) NOT NULL,
    global_discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate_percent  DECIMAL(5,2)  NOT NULL,
    tax_regime        VARCHAR(20)   NOT NULL DEFAULT 'STANDARD',
    tax_amount        DECIMAL(15,2) NOT NULL DEFAULT 0,
    line_total        DECIMAL(15,2) NOT NULL,            -- valor_linha - desconto global, sem imposto
    UNIQUE KEY uq_qi_line (quote_version_id, line_number),
    FOREIGN KEY (quote_version_id) REFERENCES quote_versions(id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id)       REFERENCES products(id)
);
