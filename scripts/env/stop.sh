#!/bin/bash
# Pára a MariaDB e o Redis do ambiente de testes.
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/env.sh"
"$MARIADB_HOME/bin/mariadb-admin" --socket="$DB_SOCKET" -uroot shutdown 2>/dev/null && echo "MariaDB parada"
"$REDIS_HOME/bin/redis-cli" -p "$REDIS_PORT" shutdown nosave 2>/dev/null && echo "Redis parado"
exit 0
