# Restauro da base de dados (runbook)

Objetivo: RPO ≤ 15 min, RTO ≤ 4 h. Ensaiar trimestralmente numa instância separada.

1. Criar a instância a partir do Terraform (`environments/<amb>.tfvars`) e correr `ansible-playbook site.yml`. Parar a MariaDB.
2. Obter o último backup completo: `aws s3 ls s3://$CPQ_BACKUPS_BUCKET/full/` e descarregar o mais recente para `/var/backups/cpq`.
3. Esvaziar `/var/lib/mysql`, extrair o tar e correr `mariadb-backup --copy-back --target-dir=<pasta>`; `chown -R mysql:mysql /var/lib/mysql`.
4. Descarregar os binlogs posteriores ao backup: `aws s3 sync s3://$CPQ_BACKUPS_BUCKET/binlogs/ /var/backups/cpq/binlogs/`.
5. Arrancar a MariaDB e aplicar os binlogs até ao instante pretendido:
   `mariadb-binlog --start-position=<pos do backup> --stop-datetime='<UTC>' /var/backups/cpq/binlogs/binlog.* | mariadb`.
6. Validar: `SELECT MAX(seq) FROM audit_log;` e correr o job de verificação da cadeia de auditoria. Registar a data, a duração e o resultado do ensaio.
