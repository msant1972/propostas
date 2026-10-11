-- Ponta da cadeia de auditoria: uma só linha, bloqueada (FOR UPDATE) por cada escritor.
-- Garante a ordem da cadeia mesmo com vários processos a escrever ao mesmo tempo.
CREATE TABLE audit_head (
    id        TINYINT PRIMARY KEY,
    last_hash CHAR(64) NOT NULL
);

INSERT INTO audit_head (id, last_hash)
SELECT 1, COALESCE((SELECT row_hash FROM audit_log ORDER BY seq DESC LIMIT 1), REPEAT('0', 64));
