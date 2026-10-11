# Desempenho: medições, metas e dimensionamento

Medições feitas em 2026-10-11 numa máquina de desenvolvimento, **não** no servidor de produção. Os números servem para comparar com as metas de `Arquitetura.md` (secção "Desempenho e disponibilidade") e para orientar o dimensionamento; ver os limites da metodologia no fim da secção 1.

| Meta (Arquitetura.md) | Resultado | Estado |
|---|---|:--:|
| Validação de regras na UI: p95 < 50 ms até 200 linhas | p95 = 11,0 ms (200 linhas); por tecla p95 = 14,7 ms | **OK** (com reserva: primeira chamada a frio ≈ 36 a 53 ms) |
| Recalcular e gravar cotação de 200 linhas no servidor: p95 < 500 ms | 1 utilizador: p95 = 103 ms; 5 em simultâneo: p95 = 629 ms; 20 em simultâneo: p95 = 1 798 ms | **OK com 1 pedido de cada vez; FALHA com 5 ou mais em simultâneo** |
| Geração DOCX + PDF: p95 < 60 s, assíncrona | 1 pedido: 1,25 s; 20 em simultâneo: p95 = 3,05 s; a API responde 202 em p95 = 179 ms | **OK** |
| Disponibilidade 99,5 % em horário de expediente | não mensurável aqui | n/d |

Também se encontraram **três problemas reais de concorrência** (erros 500 sob carga), um deles corrigido; ver a secção 3.

## 1. Metodologia

**Máquina:** Mac com Intel Core i7-8850H (6 cores, 12 threads, 2,6 GHz), 16 GiB de RAM, SSD NVMe, macOS 24.6, Node 24.16. MariaDB 12.3.3 e Redis locais (o MariaDB com a configuração de `scripts/env/mariadb.cnf`: `innodb_buffer_pool_size` = 256 MiB, `max_connections` = 100, sem binlog). Redis na base 2. O pool de ligações do Prisma é de 10 ligações por processo da API.

**Isolamento:** base `cpq_perf` (recriada a cada execução), API na porta 3100 (limites reais do portal) e uma segunda instância na 3101 só para medir o débito do portal sem o limite por IP, worker próprio, pasta de documentos temporária. Nada toca em `cpq_dev` nem nas portas 3000/5173.

**Dois instrumentos** (comando único: `pnpm perf`, que corre os dois por ordem):

1. `packages/rules-engine/bench/quote.bench.ts` (`pnpm perf:bench`): micro-benchmark do motor `@cpq/rules-engine` compilado, em Node, com 200 produtos, 600 escalões de preço (3 por produto), 333 regras JSONLogic (CONSTRAINT em todos os produtos, REQUIRES, RECOMMENDS, EXCLUDES, DEFAULT), atributos obrigatórios em 1 de cada 5 produtos, IVA normal e reduzido, descontos de linha e desconto global. 200 iterações de aquecimento e depois 1 500 a 3 000 medidas por tamanho. Escreve `bench/resultado.json`.
2. `scripts/perf/run.mjs` (`node scripts/perf/run.mjs` ou `pnpm perf`): Node puro com `fetch`, sem dependências novas. Recria a base `cpq_perf`, aplica migrações e seed, arranca API, API aberta e worker, cria por HTTP 200 produtos (40 com atributos obrigatórios), 626 itens de preço na lista "Geral EUR", 295 regras, 1 cliente e 21 propostas com cotações de 200 linhas e 4 secções (3 blocos da biblioteca mais uma com a tabela de preços), corre os cenários, amostra CPU e RAM dos processos a cada 500 ms (`ps`) e escreve `scripts/perf/out/perf-report.json` e `perf-report.md` (a execução completa demora cerca de 85 s). Variáveis: `PERF_QUICK=1` (volumes reduzidos), `PERF_ONLY=login,lists,save,docs,portal`, `PERF_KEEP_DB=1`, `PERF_NO_SPAWN=1`.

**Cenários:** (a) login com a mesma conta a concorrência 1, 5 e 20; (b) listagens e leituras com concorrência 10 (300 pedidos cada); (c) `PUT /proposals/:id/quotes/:versionId` com 200 linhas, concorrência 1, 5 e 20, cada worker sobre a sua própria proposta (como utilizadores diferentes), mais a pré-visualização no servidor; (d) 20 pedidos de `documents/compile` em simultâneo e o tempo de cada um até `GET .../jobs/:eventId` dar `DONE` (consulta de 200 em 200 ms, por isso a resolução é de 0,2 s); (e) portal, com o limite real por IP e com débito sem limite.

**Limites da medição (a ter em conta):**
- O gerador de carga, a API, o worker, o MariaDB e o Redis partilham a mesma máquina (e, durante a medição, outros programas do desenvolvedor). Em produção o Nginx e o MariaDB também estão no mesmo servidor, mas sem o gerador de carga.
- Uma só instância da API (um processo Node, uma thread JavaScript). Os valores de concorrência são, em boa parte, a fila dessa thread.
- O micro-benchmark corre em Node (V8); o browser usa o mesmo motor JavaScript, mas o portátil/PC do utilizador pode ser mais lento que este Mac. Não se mediu em browsers reais.
- Volumes pequenos (21 propostas, 4 000 linhas de cotação). Não se mediu com milhões de linhas.
- A disponibilidade não se mede com testes de carga; depende de monitorização e de cópias de segurança (ver `infra/`).

## 2. Resultados

### 2.1 Motor de regras (browser): meta p95 < 50 ms

`calculateQuote` (preços, escalões, descontos, IVA, margem, regras JSONLogic, atributos e bundles), regime estável:

| Linhas | p50 ms | p95 ms | p99 ms | Meta |
|---:|---:|---:|---:|:--:|
| 10 | 0,55 | 0,71 | 0,86 | OK |
| 50 | 2,28 | 2,76 | 3,29 | OK |
| 100 | 4,50 | 5,26 | 6,06 | OK |
| 200 | 8,62 | 11,05 | 15,81 | OK |

- O custo é linear (cerca de 0,043 ms por linha); `evaluateRules` sozinho (regras, atributos, bundles) pesa só 1,3 ms a 200 linhas (p50), ou seja, cerca de 15 % do total. O resto é aritmética decimal (`decimal.js`) e a procura de escalões.
- **Rotina de pré-visualização a cada tecla** (200 linhas, alterar 1 e recalcular tudo): p50 = 10,2 ms, p95 = 14,7 ms, p99 = 27,9 ms. Cem teclas seguidas custam 0,99 s de CPU, ou seja, **a 10 teclas por segundo ocupa cerca de 10 % do thread principal**. Cabe numa frame de 60 fps (16,7 ms) no p95, mas com folga pequena num PC mais lento.
- **Primeira chamada (JIT a frio)**: 0,8 ms (10 linhas), 3,5 ms (50), 7,8 ms (100) e **36 a 53 ms (200 linhas)** em três execuções. Ou seja, a primeira validação de uma cotação de 200 linhas, antes de o V8 otimizar o código, pode ultrapassar os 50 ms. A meta é de p95 em regime estável e cumpre-se, mas o utilizador sente este primeiro cálculo.
- Heap no fim do benchmark: 32 MiB.

Recomendação: aplicar *debounce* de 100 a 150 ms à pré-visualização (reduz o trabalho em rajadas sem atraso perceptível) e, se se quiser eliminar qualquer bloqueio da interface em cotações grandes, mover o cálculo para um Web Worker. Para o primeiro cálculo a frio, pode fazer-se um cálculo de aquecimento com uma cotação vazia ou pequena ao abrir a página (não medido).

### 2.2 API

Valores de `scripts/perf/out/perf-report.md` (execução completa; tempos em ms).

**(a) Login (scrypt).** Sem meta formal; referência interna p95 < 500 ms.

| Concorrência | p50 | p95 | p99 | req/s | Erros |
|---:|---:|---:|---:|---:|---:|
| 1 | 86 | 103 | 150 | 11,1 | 0 |
| 5 | 138 | 216 | 259 | 33,5 | 3 de 100 |
| 20 | 648 | 899 | 911 | 18,3 | 50 de 100 |

O scrypt custa cerca de 85 ms de CPU por login e corre no *thread pool* do libuv (4 threads por omissão): o pico de CPU da API foi de 408 % (4 cores). Os erros são HTTP 500 por um problema de concorrência, não por falta de capacidade (secção 3.2).

**(b) Leituras** (concorrência 10, limite interno p95 < 200 ms):

| Pedido | p50 | p95 | p99 | req/s |
|---|---:|---:|---:|---:|
| `GET /proposals` (20 por página) | 18,1 | 24,1 | 29,9 | 543 |
| `GET /proposals?q=carga` | 16,7 | 20,7 | 25,3 | 587 |
| `GET /catalog/products` (20 por página) | 11,7 | 17,8 | 47,6 | 767 |
| `GET /cpq/catalog` (catálogo completo do motor, 200+ produtos, 626 itens de preço, 295 regras) | 32,3 | 46,0 | 49,3 | 293 |
| `GET /proposals/:id/quotes/:versionId` (200 linhas) | 97,1 | 123,9 | 136,3 | 102 |

Todas OK, sem erros. A leitura de uma cotação de 200 linhas é a mais cara (cerca de 10 ms de CPU por pedido: carrega as linhas com tipos decimais e reavalia as regras do rascunho).

**(c) Gravar cotação de 200 linhas** (meta p95 < 500 ms):

| Concorrência | p50 | p95 | p99 | req/s | Erros | Meta |
|---:|---:|---:|---:|---:|---:|:--:|
| 1 | 90,6 | 102,7 | 121,3 | 10,9 | 0 | OK |
| 5 | 318 | 629 | 845 | 14,6 | 0 | **FALHA** |
| 20 | 1 357 | 1 798 | 2 027 | 14,4 | 0 | **FALHA** |
| pré-visualização no servidor (`/quotes/preview`), c=5 | 65,2 | 82,2 | 135 | 71,7 | 0 | OK |

Uma gravação isolada demora cerca de 90 ms (OK com folga). O débito satura nos **cerca de 14 a 15 gravações por segundo por instância da API** e a partir daí os pedidos esperam em fila, daí a latência ser proporcional à concorrência (5 pedidos × 70 ms ≈ 350 ms; 20 × 70 ms ≈ 1,4 s). A meta falha, portanto, quando 5 ou mais utilizadores gravam **no mesmo instante** uma cotação de 200 linhas. Num uso real isto é raro (secção 4), mas é o ponto mais apertado da meta. Ver o gargalo na secção 3.1.

**(d) Geração de documentos** (meta p95 < 60 s):

| Teste | p50 | p95 | máx |
|---|---:|---:|---:|
| 1 pedido isolado (pedido até DONE) | 1 250 ms | | |
| 20 em simultâneo (pedido até DONE) | 2 197 ms | 3 052 ms | 3 053 ms |
| resposta HTTP 202 da API | 161 ms | 179 ms | 179 ms |

Os 20 DOCX + PDF (cada proposta com cotação de 200 linhas e 4 secções; PDF de ≈ 32 KB, DOCX de ≈ 21 KB) ficaram todos prontos em 3,06 s, com zero falhas. **Meta cumprida com folga (20 vezes)**. O worker usou 59 % de CPU em média, pico 102 % (cerca de 1 core), 404 MiB de RAM. A API não bloqueia (202 em < 0,2 s). O intervalo do relay do outbox (`RELAY_INTERVAL_MS` = 1 s) é parte da latência de um pedido isolado.

**(e) Portal público do cliente:**

| Teste | p50 | p95 | p99 | req/s | Erros |
|---|---:|---:|---:|---:|---:|
| Limite real: 60 pedidos seguidos, `PORTAL_RATE_PER_MINUTE`=30 | | | | | 30 × 200 e 30 × 429 (correto) |
| 20 ligações distintas, c=20, sem limite | 57,9 | 104,0 | 123,4 | 312 | 0 |
| 1 ligação só (todos os pedidos na mesma ligação), c=20, sem limite | 55,1 | 88,9 | 222,8 | 84 | **1 501 de 2 000 (75 %)** |
| Token inválido (404), c=20 | 13,2 | 22,0 | | 1 370 | 0 (404 esperado) |

O limite por IP funciona exatamente como especificado (30 respostas 200 e a seguir 429). Sem limite, o portal aguenta ~300 req/s com ligações distintas. Com todos os pedidos concorrentes sobre a **mesma** ligação, 75 % falham com 500 (secção 3.3).

## 3. Problemas encontrados

### 3.1 Gargalo: gravar cotação gasta ~70 ms de CPU, metade em Prisma (não corrigido)

Evidência: a API fica a 93 a 107 % de CPU (um core) durante o cenário (c) e o débito não passa de 14 a 15 gravações/s com concorrência 5 ou 20; o MariaDB ocupa só 33 % de um core. Um perfil de CPU (`node --cpu-prof`, 80 `PUT` de 200 linhas, concorrência 5) deu, aproximadamente: **Prisma (compilador de consultas WASM, serialização de argumentos e conversão de resultados) ≈ 52 % do CPU**, motor de regras + `decimal.js` ≈ 15 % (≈ 11 ms por pedido, coerente com o micro-benchmark), descodificação de strings e GC ≈ 12 %, validação dos DTO (class-validator) ≈ 4 %, driver `mariadb` ≈ 4 %. O custo do Prisma vem sobretudo de `quoteItem.deleteMany` + `createMany` de 200 linhas × 17 colunas e da releitura das 200 linhas (`get()`, com `Decimal`) no fim do `saveDraft`.

Recomendações (por ordem de custo/benefício):
1. Inserir as linhas com um único `INSERT ... VALUES (...),(...)` em SQL direto (`$executeRaw`) em vez de `createMany`, e devolver o resultado já calculado em vez de reler as linhas; estimativa: baixar de 70 para cerca de 25 a 35 ms de CPU (não medido).
2. Executar duas ou mais instâncias da API (Node `cluster` ou PM2 com 2 a 4 processos atrás do Nginx); o débito escala quase linearmente até ao número de cores livres. Atenção: a cache do catálogo (`CatalogLoader`, 30 s) é por processo e a invalidação em escritas administrativas só atinge o processo que recebeu o pedido; com várias instâncias é preciso a cache partilhada em Redis (tarefa 2.15, já anotada no código).
3. Não é o MariaDB: com 33 % de um core a cerca de 15 gravações/s, tem margem de 3 a 4 vezes.

### 3.2 Erros 500 em logins concorrentes da mesma conta (corrigido)

Evidência: 3 % a 50 % de HTTP 500 no cenário (a), com `Record has changed since last read in table 'users'` (código 1020) no log da API. A causa é o MariaDB 12.3 com `innodb_snapshot_isolation=ON` (omissão desde 11.6): a transação de `AuthService.login` (`apps/api/src/auth/auth.service.ts`, linhas 63 a 66) lê e atualiza a mesma linha de `users` que outra transação concorrente atualizou, e o MariaDB aborta uma em vez de a deixar sobrescrever. É a mesma conta em simultâneo (o que um balcão partilhado ou uma reabertura em vários separadores faz), por isso o impacto real é baixo, mas é um 500 evitável. Correção sugerida: repetir a transação ao receber P2034/1020 (como feito em 3.4) ou, melhor, atualizar `lastLoginAt`/`failedLogins` com um `UPDATE` direto sem leitura prévia dentro da transação.

### 3.3 Portal: 75 % de erros 500 quando vários pedidos chegam à mesma ligação ao mesmo tempo (corrigido)

Evidência: 1 501 de 2 000 pedidos falharam com `Record has changed since last read in table 'share_links'` (1020; 155 ocorrências por 200 pedidos na medição reduzida). Causa: `PortalService.view` (`apps/api/src/portal/portal.service.ts`) faz `shareLink.update({ openCount: { increment: 1 }, lastOpenedAt: ... })` numa transação que antes leu a mesma linha; a mesma causa de 3.2. Com um cliente a abrir o link em condições normais (pedidos sequenciais) não se manifesta, e o limite de 30/min por IP também o atenua, mas um cliente que abre o link em dois separadores ou um pré-visualizador de email que busca o link em paralelo pode ver um erro "interno" na primeira abertura. Correção sugerida: o mesmo que em 3.2 (retry em P2034/1020, ou `UPDATE share_links SET open_count = open_count + 1 ...` direto, e ler o `firstOpenedAt` com `RETURNING`).

**Correção (todas as rotas afetadas):** `apps/api/src/common/retry.ts` (`retryOnConflict`, reconhece P2034 e os erros 1020/1213 do MariaDB) aplicado ao login, às gravações de cotações e aos atributos de produto. No portal, o incremento de `open_count` passou a ser um UPDATE isolado (sem transação de leitura anterior) e a primeira abertura é marcada por `UPDATE … WHERE first_opened_at IS NULL`, de modo que só um pedido a audita. Reexecutado `pnpm perf`: **0 erros** em login (c=20), cotações (c=20) e portal na mesma ligação (c=20), contra 3–50 %, 0 % e 75 % antes. O que continua acima da meta é só a latência com 5/20 gravações simultâneas, que é fila de CPU de uma instância (ver 3.1).

### 3.4 Gravação concorrente de cotações de propostas diferentes dava 500 (corrigido)

Evidência: ao criar os dados de teste (cinco gravações em paralelo, propostas diferentes), a API devolveu 500 com `Transaction failed due to a write conflict or a deadlock` em `quoteItem.createMany`. Causa: o `DELETE FROM quote_items WHERE quote_version_id = ?` de uma versão ainda sem linhas bloqueia um intervalo (*gap lock*) do índice que as transações vizinhas partilham; quando duas inserem a seguir, ficam à espera uma da outra (deadlock), e o MariaDB aborta uma.
Correção em `apps/api/src/proposals/quotes.service.ts`: função `retryOnConflict` (até 6 tentativas com *backoff* aleatório, só para o erro P2034) aplicada às transações de `saveDraft` e `lock`. A operação é segura de repetir (apaga e volta a inserir as linhas a partir do corpo do pedido, e o outbox só é escrito na mesma transação). Depois da correção, zero erros nos 340 pedidos de gravação concorrentes (c=5 e c=20). `tsc --noEmit` do `@cpq/api` passa; não corri os testes da API (usam bases partilhadas com outros agentes).

### 3.5 Outras observações

- Gravação de atributos de produto (`PUT /catalog/products/:id/attributes`) com 10 pedidos em paralelo também devolveu 500 (mesma classe de erros 1020/deadlock, por `deleteMany` + `createMany` sobre `product_attributes`). É uma rota administrativa, de uso raro e sem concorrência real; não corrigida.
- Não se encontrou N+1 nem falta de índice nas consultas medidas (as listagens respondem em 12 a 24 ms de p95 com 21 propostas e 225 produtos). Com os volumes de teste isso não prova nada para milhões de linhas; a pesquisa `q=` de propostas e as listagens têm de ser revistas com `EXPLAIN` quando o histórico crescer (`ix_prop_owner_status` cobre a listagem por responsável, mas não a pesquisa de texto).
- O `performance_schema` do MariaDB de desenvolvimento está desligado (`@@performance_schema = 0`), por isso não houve resumo de consultas lentas; recomenda-se ligar o `slow_query_log` (`long_query_time = 0,2`) em produção.

## 4. Dimensionamento do servidor (Ubuntu)

Perfil de carga assumido para o cálculo (hipótese a validar com utilizadores reais): um utilizador ativo gera em média 1 gravação de cotação a cada 30 s enquanto edita, 1 leitura a cada 5 s, e as proposições enviadas geram acessos esporádicos ao portal; 1 em cada 20 propostas gera documentos por hora de ponta; logins concentrados no início do expediente (10 utilizadores por minuto no máximo).

Capacidade medida de **uma** instância da API neste Mac: ≈ 14 gravações de 200 linhas/s, ≈ 100 leituras de 200 linhas/s, ≈ 300 a 750 leituras de listagem/s, ≈ 11 a 33 logins/s (4 threads de scrypt), portal ≈ 300 req/s. Isto corresponde ao núcleo de um único processo Node; o desempenho por core do servidor real pode diferir e deve ser confirmado (secção 4, ponto 4).

| Utilizadores em simultâneo | Carga estimada | Instâncias da API | CPU | RAM | Disco |
|---:|---|---:|---|---|---|
| 25 | 1 gravação/s, 5 leituras/s | 1 | 2 vCPU | 4 GiB | 40 GB SSD |
| 100 | 3,3 gravações/s, 20 leituras/s (≈ 25 a 35 % de um core) | 1 (2 se se quiser margem para picos) | 4 vCPU | 8 GiB | 100 GB SSD |
| 300 | 10 gravações/s (≈ 70 % de um core só nas gravações) | 2 a 3 (cache de catálogo partilhada em Redis) | 8 vCPU | 16 GiB | 200 GB SSD |
| 1 000 | 33 gravações/s | 4 a 6, e aplicar a recomendação 3.1.1 | 16 vCPU | 32 GiB | 500 GB SSD |

Racional dos recursos (medidos nesta execução):
- **CPU:** 1 core por instância da API em carga (107 % medido a saturar), mais ~1 core de pico para o worker durante gerações de documentos (102 %), mais o MariaDB (30 a 55 % de um core a 15 gravações/s) e o Nginx. O scrypt do login usa até 4 cores durante ~0,1 s por login; é pontual.
- **RAM:** API ≈ 0,55 a 0,7 GiB por instância (RSS), worker ≈ 0,3 a 0,4 GiB, MariaDB: o buffer pool deve caber nos dados quentes (a configuração de desenvolvimento usa 256 MiB; em produção 25 a 50 % da RAM, por exemplo 2 GiB nos 8 GiB), Redis ≈ 50 a 100 MiB, e sistema/Nginx 1 GiB.
- **Disco:** SSD (NVMe preferido) porque o MariaDB faz *fsync* em cada gravação de cotação (com binlog ligado em produção, e cópias de segurança). Tamanho dos dados medido: ≈ 0,9 KB por linha de cotação em `quote_items` (≈ 0,18 MB por versão de 200 linhas, com índices), PDF ≈ 32 KB e DOCX ≈ 21 KB por geração (propostas de teste com 4 secções; documentos com anexos ou logótipos serão maiores). Exemplo: 50 000 propostas por ano × 3 versões de 100 linhas + 5 gerações de documentos cada ≈ 3 GB de base de dados + ≈ 40 GB de documentos; o dimensionamento acima cobre vários anos e cópias locais, mas as cópias de segurança remotas e a retenção legal dos documentos definem o disco real.
- **Rede:** irrelevante para estes volumes (a resposta de uma cotação de 200 linhas pesa ≈ 60 KB).

Outras recomendações de configuração:
1. Subir `connectionLimit` do Prisma de 10 (`db/src/index.ts`) só se se observar espera por ligação; a 15 gravações/s com ~25 ms de base de dados por pedido, 10 ligações chegam. O `max_connections` do MariaDB tem de cobrir instâncias × `connectionLimit` + worker.
2. Ligar `innodb_flush_log_at_trx_commit=1` (durabilidade) e medir com binlog ligado: os números desta execução foram obtidos com `skip-log-bin`, por isso a produção será um pouco mais lenta nas gravações.
3. Manter o limite do portal (30 pedidos/min por IP) e confirmar que o Nginx envia `X-Forwarded-For` (a API só confia em *loopback*), senão todos os clientes do portal partilham um só contador.
4. Repetir `pnpm perf` no servidor real, com o gerador de carga numa máquina à parte, antes da entrada em produção; os relatórios guardam a máquina e a data.

## 5. Como repetir

```bash
pnpm perf               # micro-benchmark do motor + testes de carga da API (≈ 90 s)
pnpm perf:bench         # só o motor
PERF_QUICK=1 node scripts/perf/run.mjs   # validação rápida do próprio script
PERF_ONLY=save,docs node scripts/perf/run.mjs
```

Requer o MariaDB e o Redis locais a correr (`pnpm env:setup`). O relatório fica em `scripts/perf/out/perf-report.{json,md}` (e `packages/rules-engine/bench/resultado.json`); os registos da API e do worker de teste ficam em `scripts/perf/out/*.log`. O script reinicia a API ou o worker se forem terminados por fora durante o teste e avisa no relatório; o cenário (a) usa a mesma conta, o que expõe o problema 3.2.
