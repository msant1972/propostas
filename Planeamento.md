# Planeamento de implementação — CPQ & Proposal Management

Baseado em [Arquitetura.md](Arquitetura.md), que é a fonte de verdade para decisões técnicas, modelo de dados e regras de negócio. Este documento define **a ordem de construção, o âmbito de cada fase e quando uma fase está concluída**. Se houver conflito entre os dois, prevalece a arquitetura; corrige-se o planeamento.

## 1. Princípios de execução

1. **Fatias verticais.** Cada tarefa entrega base de dados + API + UI (+ worker, se aplicável) a funcionar de ponta a ponta, não camadas isoladas.
2. **Contrato primeiro.** A API é desenhada em OpenAPI 3.1; o cliente TypeScript do frontend é gerado a partir dela. Nenhum tipo é escrito à mão nos dois lados.
3. **Regras de negócio só em código partilhado.** Motor de regras e cálculo de preços vivem em `@cpq/rules-engine` (TS puro, sem I/O). O browser usa-o para resposta imediata, o servidor reavalia sempre antes de gravar.
4. **Testes com casos de referência** para preços e regras antes de construir a UI correspondente.
5. **Nada de geração de ficheiros nem notificações síncronas** dentro de um pedido HTTP: tudo passa por `outbox_events` e pelo worker.
6. **Migrações versionadas e reversíveis**; triggers e colunas geradas entram como migrações SQL manuais.
7. **Cada fase termina com o critério de saída verificável** da secção respetiva. Não se começa a fase seguinte sem ele.

Esforço: **S** ≈ até 2 dias, **M** ≈ 3–5 dias, **L** ≈ 1–2 semanas, **XL** > 2 semanas (dividir antes de começar). As durações em calendário só se fixam depois de definida a dimensão da equipa.

## 2. Estrutura do repositório (monorepo)

```
/apps
  /web          React 18, Vite, TS, shadcn/ui, Tailwind, TanStack Query, Zustand, TipTap
  /api          NestJS, Prisma, CASL, OpenAPI 3.1
  /worker       NestJS + BullMQ (relay do outbox, documentos, auditoria, notificações, SLA e expiração)
/packages
  /rules-engine @cpq/rules-engine: regras JSONLogic + cálculo de preços (TS puro)
  /api-client   cliente TS gerado a partir do OpenAPI
  /shared       tipos de domínio, enums, utilitários (UUIDv7, hash canónico, dinheiro)
/db
  /migrations   Prisma + SQL manual (triggers, colunas geradas)
  /seed         dados de referência
/infra          Ansible (servidor Ubuntu) + runbook de restauro
/e2e            Playwright
```

Módulos NestJS (fronteira própria, sem aceder a tabelas alheias): `auth`, `users`, `clients`, `catalog`, `pricing`, `rules`, `quotes`, `content`, `proposals`, `documents`, `approvals`, `audit`, `outbox`, `notifications`, `portal`.

## 3. Mapa de fases

| Fase | Nome | Entrega | Depende de |
| --- | --- | --- | --- |
| 0 | Decisões e pré-requisitos | Respostas às decisões bloqueantes; acesso ao servidor | — |
| 1 | Fundações | Repositório, CI/CD, infra por código, autenticação, observabilidade | 0 |
| 2 | CPQ | Catálogo, preços, regras, cotações versionadas e bloqueadas | 1 |
| 3 | Proposal Engine | Conteúdos, editor, compilação DOCX/PDF, worker, repositório local | 2 |
| 4 | Workflow e governança | Estados, aprovações, auditoria encadeada, envio com verificação de hash | 3 |
| 5 | Aceitação e integrações | Portal de aceitação, acompanhamento, CRM interno, RGPD | 4 |
| 6 | Endurecimento e go-live | Testes de carga, restauro, segurança, migração de dados, formação | 5 |

Fase 0 e as aprovações de acesso (servidor) correm **em paralelo** com o início da Fase 1.

## 4. Fase 0 — Decisões e pré-requisitos

| ID | Tarefa | Dono | Bloqueia |
| --- | --- | --- | --- |
| 0.1 | Limites de desconto/margem/valor por nível de aprovação | Direção financeira | Fase 4 (pode avançar com valores provisórios em seed) |
| 0.2 | Casos de referência de preços: 50 cotações calculadas pela área financeira | Financeiro | Fase 2 (critério de saída) |
| 0.3 | Workshop de regras de preço e de bundles | Financeiro + comercial | Fase 2 |
| 0.4 | Línguas das propostas e modelo `.docx` base por língua | Comercial / marketing | Fase 3 |
| 0.6 | API/eventos do CRM interno e dono dos dados de cliente | Equipa do CRM | Fase 5 |
| 0.7 | Multi-empresa (várias entidades legais)? | Direção | Modelo de dados (decidir antes da Fase 2) |
| 0.8 | Servidor SMTP para as notificações e lista inicial de utilizadores e papéis | TI | Fase 1 |
| 0.9 | Servidor Ubuntu, domínio, certificado TLS, discos de dados e destino das cópias de segurança | TI | Fase 1 |

**Saída:** 0.2, 0.3, 0.7, 0.8 e 0.9 respondidas; as restantes com data de resposta acordada.

## 5. Fase 1 — Fundações

Objetivo: um utilizador autentica-se e vê o catálogo em QA, com traces ponta a ponta.

### Backend / infraestrutura

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 1.1 | Monorepo (pnpm/turborepo), lint, formatação, tsconfig partilhado | S |
| 1.2 | Prisma + MariaDB 12.3 local (compose); migração inicial das tabelas base; teste de ordenação de UUIDv7 (decide `UUID` vs `BINARY(16)`) e de `ON UPDATE CURRENT_TIMESTAMP(6)` | M |
| 1.3 | Preparação do servidor: Nginx com certificado TLS autoassinado (gerado pelo Ansible), firewall, discos dedicados (LUKS) para a base de dados e para os documentos | L |
| 1.4 | Ansible: Ubuntu, Docker Compose, Nginx, MariaDB oficial com encriptação (`file_key_management` em tmpfs), Redis com AOF | L |
| 1.5 | Backups: mariabackup diário, binlogs e documentos copiados para o destino separado a cada 5 min; **primeiro restauro testado** noutra instância | M |
| 1.6 | CI/CD: build, testes, SAST, análise de dependências, imagens assinadas; deploy para dev e QA; migrações automáticas | L |
| 1.7 | Segredos: leitura do Secrets Manager pelo papel IAM; configuração por ambiente | S |
| 1.8 | OpenTelemetry (web, API, worker) → Collector → CloudWatch; ID de correlação; painéis e alarmes base | M |

### API

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 1.9 | Esqueleto NestJS: validação por DTO, tratamento de erros uniforme, versionamento, OpenAPI 3.1, geração do `api-client` | M |
| 1.10 | `auth`: login local (email e palavra-passe com scrypt), token próprio com versão de sessão, bloqueio por tentativas, mudança de palavra-passe, gestão de utilizadores, papéis e equipas pelo administrador | L |
| 1.11 | CASL: guard de autorização e filtros de consulta por dono/equipa/região | M |
| 1.12 | `outbox`: gravação do evento na mesma transação (serviço transacional reutilizável) | S |
| 1.13 | `catalog` (leitura): produtos e listagem, com seed de teste | S |
| 1.14 | Rate limiting por utilizador, CSP, cabeçalhos de segurança | S |

### Worker

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 1.15 | Esqueleto NestJS + BullMQ; relay do outbox (`SKIP LOCKED`, `jobId` idempotente, recuperação de `PROCESSING` antigos); retries com *backoff* e *jitter* | M |
| 1.16 | Fila de auditoria com concorrência 1 (cadeia de hashes) — implementação completa na Fase 4, esqueleto aqui | S |

### Frontend

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 1.17 | App Vite + Tailwind + shadcn/ui; layout, navegação, tema, i18n (pt-PT; estrutura pronta para outras línguas) | M |
| 1.18 | Ecrã de login, mudança de palavra-passe (obrigatória no primeiro acesso), rota protegida, ecrã de acesso negado | M |
| 1.19 | TanStack Query com `api-client`; tratamento global de erros; página de catálogo (lista) | S |
| 1.20 | Playwright: login e listagem do catálogo em QA | S |

**Saída:** login local em QA; catálogo visível; trace único do browser até à BD; restauro de backup executado e documentado; pipeline verde.

## 6. Fase 2 — CPQ

Objetivo: cotar com preços corretos, versionar e bloquear.

### Pacote `@cpq/rules-engine` (primeiro, sem UI)

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 2.1 | Tipos de domínio e aritmética monetária (decimais exatos, `round2` *half-up*) | M |
| 2.2 | Escolha da lista de preços (pontuação por especificidade, desempate) | M |
| 2.3 | Cálculo: escalões, desconto de linha, desconto global repartido com resíduo, impostos por linha, MRR/ARR/TCV, margem com câmbio | L |
| 2.4 | Regras: `REQUIRES`, `EXCLUDES`, `RECOMMENDS`, `CONSTRAINT`, `DEFAULT` com condição JSONLogic, prioridade e vigência; validação de atributos (min/max/incremento) | L |
| 2.5 | Bundles: componentes obrigatórios/opcionais | M |
| 2.6 | JSON canónico e `snapshot_hash` (SHA-256) | S |
| 2.7 | Suite de testes com as **50 cotações de referência** (tarefa 0.2) e testes de propriedade (somas de parcelas = total) | L |

### API

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 2.8 | `clients` (CRUD, soft delete, `crm_external_id` reservado) | M |
| 2.9 | `catalog` (escrita): produtos, atributos, bundles, listas de preços e itens (validação de sobreposição e especificidade), `tax_rates`, `fx_rates` | L |
| 2.10 | `rules` (CRUD de regras com validação da condição JSONLogic) | M |
| 2.11 | `proposals` (cabeçalho, código, dono, validade, moeda, língua) | M |
| 2.12 | `quotes`: criar/editar versão `DRAFT`, recalcular no servidor com o motor partilhado, rejeitar configuração inválida, guardar linhas com preços/custos/impostos congelados | L |
| 2.13 | Bloquear versão: `LOCKED`, `snapshot_json`, `snapshot_hash`; nova versão com a ordem correta de `is_current` | M |
| 2.14 | Migração SQL manual: triggers de imutabilidade (`trg_qv_immutable`, `trg_qi_*`) e testes que as exercitam | M |
| 2.15 | Cache de catálogo e listas de preços em Redis com invalidação por evento | M |
| 2.16 | Importação de catálogo e listas de preços (CSV) para carga inicial | M |

### Frontend

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 2.17 | Gestão de clientes (lista, ficha, criação/edição) | M |
| 2.18 | Administração de catálogo, atributos, bundles, listas de preços, impostos e câmbios | L |
| 2.19 | Administração de regras com pré-visualização da condição | M |
| 2.20 | Lista de propostas com filtros (estado, dono, cliente) e permissões por papel | M |
| 2.21 | Configurador de cotação: linhas, atributos, quantidades, descontos; avaliação local de regras e preços a cada alteração (p95 < 50 ms até 200 linhas); mensagens de regra | XL |
| 2.22 | Versões da cotação: histórico, comparação entre versões, indicação de bloqueada | M |
| 2.23 | Testes E2E: criar proposta, configurar, ver margem, bloquear, criar nova versão | M |

**Saída:** as 50 cotações de referência coincidem ao cêntimo com o cálculo da área financeira; tentativa de alterar versão `LOCKED` por SQL direto é rejeitada pelos triggers; cotação de 200 linhas cumpre p95 < 50 ms (UI) e < 500 ms (servidor).

## 7. Fase 3 — Proposal Engine

Objetivo: gerar uma proposta completa (DOCX e PDF) e guardá-la no repositório local, com os hashes registados. **Feita.**

### Worker / repositório

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 3.1 | Interface `DocumentRepository` e implementação em pasta local (`DOCUMENT_STORAGE_DIR`): abertura exclusiva, nomes normalizados, sem sair da raiz | M |
| 3.2 | Estrutura `Clientes/{cliente}/{proposta}/{01_Trabalho,02_Enviado,03_Assinado}` criada ao gravar | S |
| 3.3 | Tratamento de falhas: *retry* com *backoff* pelo outbox, mensagem do último erro guardada | M |
| 3.4 | Job de compilação: montar secções → Docxtemplater (`{@conteudo}` em OOXML) → PDF → hash → `documents` (ficheiros em `01_Trabalho`) | XL |
| 3.5 | Deteção de edições manuais: comparação periódica do hash em disco com o registado | M |

### API

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 3.6 | `content`: blocos, versões (rascunho/aprovado/retirado), línguas, tags, responsável e data de revisão; bloco jurídico só pelo Jurídico | L |
| 3.7 | Secções da proposta referenciando versão de bloco; `is_modified` quando se altera bloco jurídico; bloqueio otimista por `row_version` | M |
| 3.8 | Catálogo fechado de *merge tags* tipadas; variável em falta bloqueia a geração | M |
| 3.9 | Tabela de preços como elemento estruturado do documento | M |
| 3.10 | Sanitização do HTML do editor antes de entrar no DOCX; subconjunto de formatação suportado | M |
| 3.11 | Endpoints de documentos: pedir geração, estado do pedido, listar, descarregar, carregar versão editada | M |
| 3.12 | Regeneração: cria sempre ficheiros novos, sem apagar os anteriores | S |

### Frontend

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 3.13 | Biblioteca de conteúdos: pesquisa por tags/língua, versões, estados, revisão pendente | L |
| 3.14 | Editor de proposta: lista de secções, reordenar, inserir bloco, editar com TipTap, inserir variáveis | XL |
| 3.15 | Ecrã de geração: progresso por consulta periódica, variáveis por resolver, descarga, carregamento de versão editada | L |
| 3.16 | E2E: composição → geração pelo worker → descarga do PDF | M |

**Saída:** proposta completa gerada e guardada no repositório; falha simulada deixa a proposta gravada e o job retoma sozinho; edição fora da aplicação é detetada pelo hash.

## 8. Fase 4 — Workflow e governança

Objetivo: nenhum documento sai se o hash não for o aprovado.

| ID | Camada | Tarefa | Esf. |
| --- | --- | --- | --- |
| 4.1 | API | Máquina de estados conforme a tabela de transições da arquitetura; transições inválidas recusadas; testes por transição | L |
| 4.2 | API | `approval_policies` (CRUD, condição JSONLogic, níveis, modo, SLA, delegação) e avaliação para escolher os pedidos de uma versão | L |
| 4.3 | API | `approval_requests`/`approval_decisions`: criação ao submeter com `snapshot_hash` e `sha256`; decisão com comentário; modos sequencial e paralelo; delegação (`on_behalf_of`) | L |
| 4.4 | API | Invalidar aprovação quando a cotação ou o documento mudam; pedidos jurídicos (`LEGAL`) para blocos jurídicos modificados | M |
| 4.5 | API | Envio: verificar hash da cotação (recalculado a partir de `snapshot_json`) e do documento; copiar PDF para `02_Enviado`; bloquear em caso de divergência | M |
| 4.6 | Worker | Auditoria encadeada: fila com concorrência 1, `row_hash`, utilizador de BD só com `INSERT`/`SELECT` | M |
| 4.7 | Worker | Exportação diária para ficheiros só de leitura (`AUDIT_EXPORT_DIR`), replicados para o destino de backup; job noturno de verificação da cadeia com alerta | M |
| 4.8 | Worker | SLA e escalonamento de aprovações; expiração diária de propostas (`SENT` → `EXPIRED`) | M |
| 4.9 | Worker | Notificações: email (SMTP) e, opcionalmente, mensagem no Teams por *webhook* de entrada, com ligação à página de decisão | L |
| 4.10 | Frontend | Submeter para aprovação com resumo de políticas aplicáveis | M |
| 4.11 | Frontend | Caixa de entrada do aprovador, página de decisão (cotação, margem, documento, histórico), delegação | L |
| 4.12 | Frontend | Linha temporal da proposta (estados, aprovações, auditoria) e ação de envio com estado dos hashes | M |
| 4.13 | Frontend | Administração de políticas de aprovação | M |
| 4.14 | Todas | Teste automatizado: alterar cotação ou documento depois de aprovado e tentar enviar → bloqueado | M |

**Saída:** o teste 4.14 passa; cadeia de auditoria verificada e exportação WORM a funcionar; fluxo completo comercial → aprovador → envio demonstrado em QA com notificações reais.

## 9. Fase 5 — Aceitação e integrações

**Feita**: portal do cliente com ligações seguras e comprovativo, acompanhamento de abertura, integração com o CRM por chave de API e RGPD (retenção, exportação e anonimização). O percurso completo (aprovação em dois níveis, envio, aceitação do cliente e comprovativo) tem teste *end-to-end* no browser.

| ID | Camada | Tarefa | Esf. |
| --- | --- | --- | --- |
| 5.1 | API | Portal de aceitação: ligação com token aleatório (só o hash fica guardado), validade, revogação, limite de tentativas por IP; impressão digital do certificado autoassinado na mensagem e no portal | L |
| 5.2 | API | Resposta do cliente (aceitar/recusar) com nome, email, hash do documento, data e IP; resposta única por ligação; transição para `ACCEPTED`/`REJECTED` | L |
| 5.3 | Worker | Comprovativo de aceitação em PDF, guardado em `03_Assinado`; notificação ao comercial | M |
| 5.4 | API | Acompanhamento de abertura (primeira e última abertura, contagem), sem píxeis de rastreio | M |
| 5.5 | API/Worker | Integração com o CRM interno conforme 0.6 (clientes, oportunidades, `crm_external_id`), por interface e *webhook* | L |
| 5.6 | API | RGPD: retenção por tipo de dado, exportação/anonimização por titular, base legal registada | M |
| 5.7 | Frontend | Página pública do portal; estado da aceitação na proposta, nova ligação, registo manual de aceitação com evidência | L |

**Saída:** proposta aceite pelo cliente no portal passa a `ACCEPTED` sem intervenção manual, com comprovativo; dados de cliente consistentes com o CRM.

## 10. Fase 6 — Endurecimento e go-live

**Estado (11 de outubro de 2026):** feitos o ensaio de restauro e a verificação de integridade (`pnpm ops:restore-rehearsal`, `pnpm ops:verify`) e a documentação de operação, implantação e piloto. Desempenho, importação de dados e segurança estão **em curso**. O ensaio de recuperação completo num servidor Ubuntu e o piloto ainda não começaram.

| ID | Tarefa | Esf. | Estado |
| --- | --- | --- | --- |
| 6.1 | Testes de carga: geração concorrente de documentos, cotações de 200 linhas | M | Em curso |
| 6.2 | Ensaio de recuperação completo: perda do servidor e restauro por código, incluindo falha de zona (RTO ≤ 4 h, RPO ≤ 15 min) | M | Parcial: o script de ensaio e a verificação de integridade estão feitos e validados no ambiente local; falta o ensaio completo em Ubuntu com o destino de backups real |
| 6.3 | Revisão de segurança: cabeçalhos e CSP, segredos, portal do cliente, dependências; teste de intrusão | L | Em curso |
| 6.4 | Migração de dados reais (clientes, catálogo, listas de preços, blocos de conteúdo) com reconciliação | L | Em curso |
| 6.5 | Formação por perfil (Comercial, Gestor, Aprovador, Jurídico, Administrador) e manual de operação (runbooks, alertas, restauro) | M | Manual de operação e guiões de formação escritos (por validar no piloto) |
| 6.6 | Piloto com um grupo reduzido de comerciais; correção de defeitos; decisão de go-live | L | Plano e checklist escritos; piloto por agendar |
| 6.7 | Revisão de custos (NAT, CloudWatch, licenças) e plano de migração da BD para RDS se a carga o exigir | S | Por fazer (texto herdado da versão AWS; a instalação é um servidor Ubuntu único) |

Documentação desta fase: [docs/OPERACAO.md](docs/OPERACAO.md) (manual de operação e runbooks), [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md) (plano de colocação em produção) e [docs/PILOTO.md](docs/PILOTO.md) (checklist do piloto e formação). A secção 16 do manual lista as lacunas de infraestrutura a fechar antes do go-live.

**Saída:** metas de desempenho e disponibilidade medidas em produção; restauro validado; piloto sem defeitos críticos abertos.

## 11. Estratégia de testes

| Nível | Âmbito | Ferramenta |
| --- | --- | --- |
| Unitário | Motor de preços e regras (casos de referência e propriedades), serviços de domínio | Vitest/Jest |
| Base de dados | Migrações para a frente e para trás, triggers, restrições | Testes de integração com MariaDB 12.3 em contentor |
| Contrato | API contra o OpenAPI; cliente gerado compila | Testes de contrato no CI |
| Integração | API e worker contra MariaDB, Redis e uma pasta temporária de documentos | Vitest |
| End-to-end | Fluxos completos por papel | Playwright |
| Não-funcionais | Carga, restauro, segurança | k6, ensaios manuais registados |

Regra: alterações ao motor de preços ou às transições de estado não entram sem casos de teste novos.

## 12. Definição de pronto (por tarefa)

- Código revisto e a passar no CI (lint, tipos, testes, SAST).
- Migrações aplicadas e revertidas com sucesso em QA.
- OpenAPI atualizado e cliente gerado sem alterações pendentes.
- Autorização verificada (papel e regra por registo) com teste.
- Eventos relevantes a entrar em `audit_log`.
- Logs, métricas e traces presentes; alarmes criados quando aplicável.
- Texto de interface em pt-PT através do sistema de i18n.

## 13. Riscos que condicionam a ordem

| Risco | Efeito no plano | Resposta |
| --- | --- | --- |
| Regras de preço mais complexas do que o modelo | Retrabalho na Fase 2 | Workshop 0.3 antes de começar; condições JSONLogic como válvula |
| Conversão HTML → DOCX perde formatação | Atraso em 3.5 | Subconjunto de formatação; testes visuais desde o início da Fase 3 |
| `UUID` da MariaDB não ordena UUIDv7 | Alteração de chaves | Teste em 1.2, antes de existir qualquer dado |
| Servidor único e restauro nunca testado | Risco operacional | Restauro em 1.5 e ensaio completo em 6.2 |

## 14. Próximo passo

Começar pela **Fase 1**, na ordem: 1.1 → 1.2 → 1.9/1.10 em paralelo com 1.3/1.4 (infraestrutura). A tarefa 1.2 decide o tipo de chave primária e, por isso, vem antes de qualquer outra migração.
