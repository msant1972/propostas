DROP TRIGGER IF EXISTS trg_audit_no_update;
DROP TRIGGER IF EXISTS trg_audit_no_delete;
ALTER TABLE proposals DROP COLUMN sent_at, DROP COLUMN status_reason;
DROP TABLE IF EXISTS approval_delegations;
DROP TABLE IF EXISTS approval_decisions;
DROP TABLE IF EXISTS approval_requests;
DROP TABLE IF EXISTS approval_policies;
