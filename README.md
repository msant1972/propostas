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

`pnpm env:setup` é idempotente. Cria o `.env` (ignorado pelo git) com `DATABASE_URL`, `TEST_DATABASE_URL`, `REDIS_URL` e `TEST_REDIS_URL`. Os dados ficam em `~/tools/data`. No modo de desenvolvimento (`AUTH_MODE=dev`) o ecrã de login deixa escolher o perfil; em produção a API só aceita tokens do Entra ID.

Utilizadores de desenvolvimento (criados pelo seed): um por papel — Comercial, Gestor_Comercial, Aprovador_Financeiro, Juridico e Administrador.
