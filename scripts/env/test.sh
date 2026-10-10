#!/bin/bash
# Corre toda a bateria de testes (unitários + integração contra a MariaDB e o Redis locais).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
[ -f .env ] || { echo "Falta o .env: corra primeiro 'pnpm env:setup'"; exit 1; }
set -a; source .env; set +a
pnpm --filter @cpq/shared build >/dev/null
pnpm --filter @cpq/db build >/dev/null
pnpm --filter @cpq/rules-engine build >/dev/null
pnpm lint
pnpm typecheck
pnpm test
