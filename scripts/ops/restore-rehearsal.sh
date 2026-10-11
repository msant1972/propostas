#!/bin/bash
# Ensaio de restauro: faz um backup completo da base de dados em funcionamento, restaura-o numa instância
# separada (porta 3307, pasta própria) e verifica a integridade (auditoria, documentos e snapshots).
# Mede a duração de cada passo (o RTO é a soma dos passos de restauro). Não toca na instância original.
# Uso: scripts/ops/restore-rehearsal.sh [--keep]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$ROOT/scripts/env/env.sh"
set -a; source "$ROOT/.env"; set +a

KEEP=0; [ "${1:-}" = "--keep" ] && KEEP=1
WORK="$DATA/restore-rehearsal"
PORT=3307
SOCK="$WORK/mariadb.sock"
DB="$MARIADB_HOME/bin"
now() { date +%s; }
step() { echo; echo "== $1"; }
cleanup() {
  "$DB/mariadb-admin" --socket="$SOCK" -uroot shutdown >/dev/null 2>&1 || true
  [ "$KEEP" = 1 ] || rm -rf "$WORK"
}
trap cleanup EXIT

rm -rf "$WORK"; mkdir -p "$WORK/backup" "$WORK/data"
T0=$(now)

step "1. Backup completo (mariadb-backup) da instância em funcionamento"
S=$(now)
"$DB/mariadb-backup" --backup --target-dir="$WORK/backup" --socket="$DB_SOCKET" --user=root >"$WORK/backup.log" 2>&1
"$DB/mariadb-backup" --prepare --target-dir="$WORK/backup" >>"$WORK/backup.log" 2>&1
echo "   $(( $(now) - S )) s, $(du -sh "$WORK/backup" | cut -f1)"

step "2. Restauro para uma pasta de dados nova (copy-back)"
S=$(now)
"$DB/mariadb-backup" --copy-back --target-dir="$WORK/backup" --datadir="$WORK/data" >"$WORK/restore.log" 2>&1
echo "   $(( $(now) - S )) s"

step "3. Arranque da instância restaurada (porta $PORT)"
S=$(now)
nohup "$DB/mariadbd" --defaults-file="$ROOT/scripts/env/mariadb.cnf" --basedir="$MARIADB_HOME" --datadir="$WORK/data" \
  --socket="$SOCK" --port=$PORT --pid-file="$WORK/mariadb.pid" >"$WORK/mariadb.log" 2>&1 &
for _ in $(seq 1 60); do "$DB/mariadb-admin" --socket="$SOCK" -uroot ping >/dev/null 2>&1 && break; sleep 1; done
"$DB/mariadb-admin" --socket="$SOCK" -uroot ping >/dev/null
echo "   $(( $(now) - S )) s"

step "4. Comparação de contagens (original vs restaurada)"
for t in users clients proposals quote_versions documents audit_log customer_responses; do
  a=$("$DB/mariadb" --socket="$DB_SOCKET" -uroot cpq_dev -N -e "SELECT COUNT(*) FROM $t")
  b=$("$DB/mariadb" --socket="$SOCK" -uroot cpq_dev -N -e "SELECT COUNT(*) FROM $t")
  printf "   %-20s original=%-6s restaurada=%-6s %s\n" "$t" "$a" "$b" "$([ "$a" = "$b" ] && echo OK || echo DIFERENTE)"
  [ "$a" = "$b" ] || { echo "   FALHA: contagens diferentes em $t"; exit 1; }
done

step "5. Verificação de integridade na instância restaurada"
S=$(now)
RESTORED_URL="mysql://cpq:cpq@127.0.0.1:$PORT/cpq_dev"
DOCUMENT_STORAGE_DIR="$DOCUMENT_STORAGE_DIR" pnpm --silent --filter @cpq/db run ops:verify --db "$RESTORED_URL" --storage "$DOCUMENT_STORAGE_DIR"
echo "   $(( $(now) - S )) s"

echo
echo "Ensaio concluído em $(( $(now) - T0 )) s (backup + restauro + verificação). Registe a data e a duração no manual de operação."
