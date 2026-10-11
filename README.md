# Propostas — CPQ & gestão de propostas

Servidor de propostas (configurar, preçar, cotar e gerir propostas). A arquitetura está em [Arquitetura.md](Arquitetura.md) e a ordem de construção em [Planeamento.md](Planeamento.md).

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `apps/api` | API NestJS (REST, OpenAPI) |
| `apps/web` | Frontend React + Vite |
| `apps/worker` | Worker BullMQ (relay do outbox) |
| `packages/rules-engine` | Motor de regras e preços (TypeScript puro, corre no browser e no servidor) |
| `packages/shared` · `packages/api-client` | Tipos partilhados · cliente gerado do OpenAPI |
| `db` | Schema Prisma, migrações SQL, seed |
| `infra` | Ansible (servidor Ubuntu) e runbook de restauro |
| `e2e` | Testes Playwright |

## Ambiente de testes local

Pré-requisitos: Node 24 e pnpm. A MariaDB 12.3 e o Redis são compilados em `~/tools` (o Homebrew não tem pacotes para todas as versões de macOS): `mariadb` em `~/tools/mariadb` e `redis` em `~/tools/redis`.

```bash
pnpm install
pnpm env:setup     # inicializa e arranca MariaDB + Redis, cria cpq_dev e cpq_test, migra e carrega dados
pnpm dev           # API (3000) + web (5173) + worker
pnpm test:all      # lint, tipos e todos os testes, incluindo os de integração
pnpm e2e           # Playwright (precisa de: npx playwright install chromium)
pnpm env:stop      # pára MariaDB e Redis
```

`pnpm env:setup` é idempotente. Cria o `.env` (ignorado pelo git) com `DATABASE_URL`, `TEST_DATABASE_URL`, `REDIS_URL` e `TEST_REDIS_URL`. Os dados ficam em `~/tools/data`. A autenticação é local. O seed cria um utilizador por papel (palavra-passe de demonstração `Demo-Pass-2026!`): `comercial@exemplo.pt`, `gestor@exemplo.pt`, `financeiro@exemplo.pt`, `juridico@exemplo.pt` e `admin@exemplo.pt`. Em produção defina `AUTH_JWT_SECRET` (mínimo 32 caracteres) e crie os utilizadores no ecrã de administração.


## Certificado TLS (portal do cliente)

O servidor usa um certificado autoassinado. Em produção é gerado pelo Ansible; para gerar um à mão:

```bash
scripts/tls/selfsigned.sh propostas.exemplo.pt --ip 10.0.0.5     # imprime a impressão digital SHA-256
```

## Operação e go-live

Manual de operação, plano de implantação e checklist do piloto estão em [docs/](docs/): [OPERACAO.md](docs/OPERACAO.md), [IMPLANTACAO.md](docs/IMPLANTACAO.md) e [PILOTO.md](docs/PILOTO.md).
