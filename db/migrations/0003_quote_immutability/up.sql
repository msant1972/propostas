CREATE TRIGGER trg_qv_immutable BEFORE UPDATE ON quote_versions
FOR EACH ROW
BEGIN
    IF OLD.status <> 'DRAFT'
       AND NOT (NEW.snapshot_hash <=> OLD.snapshot_hash
                AND NEW.snapshot_json <=> OLD.snapshot_json
                AND NEW.grand_total   = OLD.grand_total
                AND NEW.total_tcv     = OLD.total_tcv
                AND NEW.price_list_id = OLD.price_list_id
                AND NEW.currency      = OLD.currency) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'quote_version bloqueada: crie uma nova versão';
    END IF;
END
-- split
CREATE TRIGGER trg_qi_bi BEFORE INSERT ON quote_items
FOR EACH ROW
BEGIN
    IF (SELECT status FROM quote_versions WHERE id = NEW.quote_version_id) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'quote_version bloqueada: crie uma nova versão';
    END IF;
END
-- split
CREATE TRIGGER trg_qi_bu BEFORE UPDATE ON quote_items
FOR EACH ROW
BEGIN
    IF (SELECT status FROM quote_versions WHERE id = OLD.quote_version_id) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'quote_version bloqueada: crie uma nova versão';
    END IF;
END
-- split
CREATE TRIGGER trg_qi_bd BEFORE DELETE ON quote_items
FOR EACH ROW
BEGIN
    IF (SELECT status FROM quote_versions WHERE id = OLD.quote_version_id) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'quote_version bloqueada: crie uma nova versão';
    END IF;
END
