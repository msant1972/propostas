# Restauro da base de dados e dos documentos (runbook)

Objetivo: RPO ≤ 15 min, RTO ≤ 4 h. Ensaiar trimestralmente num servidor separado e registar data, duração e resultado.

1. Preparar o servidor com `ansible-playbook site.yml` (Ubuntu, Docker, Nginx, MariaDB, serviços de backup). Parar a MariaDB.
2. Obter o último backup completo do destino de cópias (`$CPQ_BACKUP_TARGET/full/`) e copiá-lo para `/var/backups/cpq`.
3. Esvaziar `/var/lib/mysql`, extrair o tar e correr `mariadb-backup --copy-back --target-dir=<pasta>`; `chown -R mysql:mysql /var/lib/mysql`.
4. Copiar os binlogs posteriores ao backup: `rsync -a $CPQ_BACKUP_TARGET/binlogs/ /var/backups/cpq/binlogs/`.
5. Arrancar a MariaDB e aplicar os binlogs até ao instante pretendido:
   `mariadb-binlog --start-position=<pos do backup> --stop-datetime='<UTC>' /var/backups/cpq/binlogs/binlog.* | mariadb`.
6. Restaurar os documentos: `rsync -a $CPQ_BACKUP_TARGET/documents/ /srv/cpq/documents/` (os ficheiros nunca são sobrescritos, por isso a cópia é cumulativa) e a auditoria: `rsync -a $CPQ_BACKUP_TARGET/audit/ /srv/cpq/audit/`.
7. Validar: `SELECT MAX(seq) FROM audit_log;`, correr a verificação da cadeia de auditoria e confirmar que o hash de alguns documentos coincide com `documents.sha256`.
