#!/bin/bash
# Prepara este computador como ambiente de testes: inicializa e arranca MariaDB e Redis, cria as bases de
# dados (cpq_dev e cpq_test) e aplica migrações e seed. É idempotente: pode correr-se as vezes que for preciso.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/env.sh"

[ -x "$MARIADB_HOME/bin/mariadbd" ] || { echo "MariaDB não encontrada em $MARIADB_HOME (ver README)"; exit 1; }
[ -x "$REDIS_HOME/bin/redis-server" ] || { echo "Redis não encontrado em $REDIS_HOME (ver README)"; exit 1; }
mkdir -p "$DATA" "$REDIS_DATA"

# --- MariaDB -------------------------------------------------------------------------------------
if [ ! -d "$MARIADB_DATA/mysql" ]; then
  echo "A inicializar a MariaDB em $MARIADB_DATA …"
  "$MARIADB_HOME/scripts/mariadb-install-db" --basedir="$MARIADB_HOME" --datadir="$MARIADB_DATA" \
    --auth-root-authentication-method=normal --skip-test-db >/dev/null
fi

if ! "$MARIADB_HOME/bin/mariadb-admin" --socket="$DB_SOCKET" -uroot ping >/dev/null 2>&1; then
  echo "A arrancar a MariaDB (porta $DB_PORT) …"
  nohup "$MARIADB_HOME/bin/mariadbd" --defaults-file="$HERE/mariadb.cnf" --basedir="$MARIADB_HOME" \
    --datadir="$MARIADB_DATA" --socket="$DB_SOCKET" --port="$DB_PORT" --pid-file="$DATA/mariadb.pid" \
    >"$DATA/mariadb.log" 2>&1 &
  for _ in $(seq 1 60); do
    "$MARIADB_HOME/bin/mariadb-admin" --socket="$DB_SOCKET" -uroot ping >/dev/null 2>&1 && break
    sleep 1
  done
  "$MARIADB_HOME/bin/mariadb-admin" --socket="$DB_SOCKET" -uroot ping >/dev/null
fi

"$MARIADB_HOME/bin/mariadb" --socket="$DB_SOCKET" -uroot <<SQL
CREATE DATABASE IF NOT EXISTS cpq_dev  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS cpq_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'cpq'@'127.0.0.1' IDENTIFIED BY 'cpq';
CREATE USER IF NOT EXISTS 'cpq'@'localhost' IDENTIFIED BY 'cpq';
GRANT ALL PRIVILEGES ON cpq_dev.*  TO 'cpq'@'127.0.0.1', 'cpq'@'localhost';
GRANT ALL PRIVILEGES ON cpq_test.* TO 'cpq'@'127.0.0.1', 'cpq'@'localhost';
GRANT ALL PRIVILEGES ON \`cpq\\_test\\_%\`.* TO 'cpq'@'127.0.0.1', 'cpq'@'localhost';
SQL

# --- Redis ---------------------------------------------------------------------------------------
if ! "$REDIS_HOME/bin/redis-cli" -p "$REDIS_PORT" ping >/dev/null 2>&1; then
  echo "A arrancar o Redis (porta $REDIS_PORT) …"
  "$REDIS_HOME/bin/redis-server" --port "$REDIS_PORT" --bind 127.0.0.1 --dir "$REDIS_DATA" \
    --appendonly yes --daemonize yes --logfile "$DATA/redis.log" >/dev/null
  sleep 1
fi

# --- Configuração da aplicação -------------------------------------------------------------------
if [ ! -f "$ROOT/.env" ]; then
  cat >"$ROOT/.env" <<ENV
DATABASE_URL=mysql://cpq:cpq@127.0.0.1:$DB_PORT/cpq_dev
TEST_DATABASE_URL=mysql://cpq:cpq@127.0.0.1:$DB_PORT/cpq_test
REDIS_URL=redis://127.0.0.1:$REDIS_PORT
TEST_REDIS_URL=redis://127.0.0.1:$REDIS_PORT/1
DOCUMENT_STORAGE_DIR=$DATA/storage
ENV
  echo "Criado $ROOT/.env"
fi

# --- Migrações e dados de teste ------------------------------------------------------------------
cd "$ROOT"
pnpm --filter @cpq/shared build >/dev/null
pnpm --filter @cpq/db build >/dev/null
set -a; source "$ROOT/.env"; set +a
pnpm db:migrate
pnpm db:seed
echo
echo "Ambiente pronto. MariaDB: 127.0.0.1:$DB_PORT (cpq/cpq)   Redis: 127.0.0.1:$REDIS_PORT"
echo "Arrancar a aplicação: pnpm dev      Testes: pnpm test   E2E: pnpm e2e"
