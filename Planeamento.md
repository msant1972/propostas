# Planeamento de implementação — CPQ & Proposal Management

Baseado em [Arquitetura.md](Arquitetura.md), que é a fonte de verdade para decisões técnicas, modelo de dados e regras de negócio. Este documento define **a ordem de construção, o âmbito de cada fase e quando uma fase está concluída**. Se houver conflito entre os dois, prevalece a arquitetura; corrige-se o planeamento.

## 1. Princípios de execução

1. **Fatias verticais.** Cada tarefa entrega base de dados + API + UI (+ worker, se aplicável) a funcionar de ponta a ponta, não camadas isoladas.
2. **Contrato primeiro.** A API é desenhada em OpenAPI 3.1; o cliente TypeScript do frontend é gerado a partir dela. Nenhum tipo é escrito à mão nos dois lados.
3. **Regras de negócio só em código partilhado.** Motor de regras e cálculo de preços vivem em `@cpq/rules-engine` (TS puro, sem I/O). O browser usa-o para resposta imediata, o servidor reavalia sempre antes de gravar.
4. **Testes com casos de referência** para preços e regras antes de construir a UI correspondente.
5. **Nada de Graph síncrono** dentro de um pedido HTTP: tudo passa por `outbox_events` e pelo worker.
6. **Migrações versionadas e reversíveis**; triggers e colunas geradas entram como migrações SQL manuais.
7. **Cada fase termina com o critério de saída verificável** da secção respetiva. Não se começa a fase seguinte sem ele.

Esforço: **S** ≈ até 2 dias, **M** ≈ 3–5 dias, **L** ≈ 1–2 semanas, **XL** > 2 semanas (dividir antes de começar). As durações em calendário só se fixam depois de definida a dimensão da equipa.

## 2. Estrutura do repositório (monorepo)

```
/apps
  /web          React 18, Vite, TS, shadcn/ui, Tailwind, TanStack Query, Zustand, TipTap + Yjs, MSAL
  /api          NestJS, Prisma, CASL, OpenAPI 3.1
  /collab       Hocuspocus (persistência em section_documents)
  /worker       NestJS + BullMQ (relay do outbox, Graph, documentos, assinatura, notificações)
/packages
  /rules-engine @cpq/rules-engine: regras JSONLogic + cálculo de preços (TS puro)
  /api-client   cliente TS gerado a partir do OpenAPI
  /shared       tipos de domínio, enums, utilitários (UUIDv7, hash canónico, dinheiro)
/db
  /migrations   Prisma + SQL manual (triggers, colunas geradas)
  /seed         dados de referência
/infra          Terraform/CloudFormation + Ansible + docker-compose
/e2e            Playwright
```

Módulos NestJS (fronteira própria, sem aceder a tabelas alheias): `auth`, `users`, `clients`, `catalog`, `pricing`, `rules`, `quotes`, `content`, `proposals`, `documents`, `approvals`, `audit`, `outbox`, `notifications`, `signature`, `graph`.

## 3. Mapa de fases

| Fase | Nome | Entrega | Depende de |
| --- | --- | --- | --- |
| 0 | Decisões e pré-requisitos | Respostas às decisões bloqueantes; acessos Entra/AWS/M365 | — |
| 1 | Fundações | Repositório, CI/CD, infra por código, autenticação, observabilidade | 0 |
| 2 | CPQ | Catálogo, preços, regras, cotações versionadas e bloqueadas | 1 |
| 3 | Proposal Engine + SharePoint | Conteúdos, editor colaborativo, compilação DOCX/PDF, worker Graph | 2 |
| 4 | Workflow e governança | Estados, aprovações, auditoria encadeada, envio com verificação de hash | 3 |
| 5 | Assinatura e integrações | Assinatura eletrónica, acompanhamento, CRM interno | 4 |
| 6 | Endurecimento e go-live | Testes de carga, restauro, segurança, migração de dados, formação | 5 |

Fase 0 e as pré-aprovações de segurança (Graph, AWS) correm **em paralelo** com o início da Fase 1.

## 4. Fase 0 — Decisões e pré-requisitos

| ID | Tarefa | Dono | Bloqueia |
| --- | --- | --- | --- |
| 0.1 | Limites de desconto/margem/valor por nível de aprovação | Direção financeira | Fase 4 (pode avançar com valores provisórios em seed) |
| 0.2 | Casos de referência de preços: 50 cotações calculadas pela área financeira | Financeiro | Fase 2 (critério de saída) |
| 0.3 | Workshop de regras de preço e de bundles | Financeiro + comercial | Fase 2 |
| 0.4 | Línguas das propostas e modelo `.docx` base por língua | Comercial / marketing | Fase 3 |
| 0.5 | Assinatura avançada ou qualificada (QES); escolha do fornecedor | Jurídico | Fase 5 |
| 0.6 | API/eventos do CRM interno e dono dos dados de cliente | Equipa do CRM | Fase 5 |
| 0.7 | Multi-empresa (várias entidades legais)? | Direção | Modelo de dados (decidir antes da Fase 2) |
| 0.8 | Aprovação de segurança: `Sites.Selected`, `Mail.Send` restrito, registo Azure Bot | Segurança TI | Fase 3 |
| 0.9 | Contas AWS, domínio, certificado ACM, tenant M365 de QA e site SharePoint "Propostas" por ambiente | TI | Fase 1 |
| 0.10 | Licença e custo do módulo HTML do Docxtemplater | Compras | Fase 3 |

**Saída:** 0.2, 0.3, 0.7, 0.8 e 0.9 respondidas; as restantes com data de resposta acordada.

## 5. Fase 1 — Fundações

Objetivo: um utilizador autentica-se e vê o catálogo em QA, com traces ponta a ponta.

### Backend / infraestrutura

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 1.1 | Monorepo (pnpm/turborepo), lint, formatação, tsconfig partilhado | S |
| 1.2 | Prisma + MariaDB 12.3 local (compose); migração inicial das tabelas base; teste de ordenação de UUIDv7 (decide `UUID` vs `BINARY(16)`) e de `ON UPDATE CURRENT_TIMESTAMP(6)` | M |
| 1.3 | Terraform/CloudFormation: VPC, subnets privadas, ALB + WAF + ACM, NAT, VPC endpoints, EC2, EBS dedicado, IAM, KMS, S3 (backups e Object Lock) | L |
| 1.4 | Ansible: Ubuntu, Docker Compose, Nginx, MariaDB oficial com encriptação (`file_key_management` em tmpfs), Redis com AOF | L |
| 1.5 | Backups: mariabackup diário, binlogs → S3 a cada 5 min, AWS Backup; **primeiro restauro testado** noutra instância | M |
| 1.6 | CI/CD: build, testes, SAST, análise de dependências, imagens assinadas; deploy para dev e QA; migrações automáticas | L |
| 1.7 | Segredos: leitura do Secrets Manager pelo papel IAM; configuração por ambiente | S |
| 1.8 | OpenTelemetry (web, API, worker) → Collector → CloudWatch; ID de correlação; painéis e alarmes base | M |

### API

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 1.9 | Esqueleto NestJS: validação por DTO, tratamento de erros uniforme, versionamento, OpenAPI 3.1, geração do `api-client` | M |
| 1.10 | `auth`: validação JWT do Entra ID, mapeamento de grupos para papéis (`Comercial`, `Gestor_Comercial`, `Aprovador_Financeiro`, `Juridico`, `Administrador`), criação/atualização de `users` no primeiro login | M |
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
| 1.18 | MSAL (Authorization Code + PKCE), rota protegida, renovação de token, ecrã de acesso negado | M |
| 1.19 | TanStack Query com `api-client`; tratamento global de erros; página de catálogo (lista) | S |
| 1.20 | Playwright: login e listagem do catálogo em QA | S |

**Saída:** login real em QA com Entra ID; catálogo visível; trace único do browser até à BD; restauro de backup executado e documentado; pipeline verde.

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

## 7. Fase 3 — Proposal Engine + SharePoint

Objetivo: gerar uma proposta completa e guardá-la no SharePoint com `Sites.Selected`.

### Worker / Graph

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 3.1 | Interface `DocumentRepository` e implementação Graph `v1.0`; *mock* para testes | M |
| 3.2 | Autenticação do worker (client credentials com certificado do Secrets Manager); concessão `Sites.Selected` ao site "Propostas" por ambiente | M |
| 3.3 | Job "criar estrutura da proposta": pastas `/Clientes/{cliente}/{proposta}/01_Trabalho`, `02_Enviado`, `03_Assinado`; idempotente (`conflictBehavior: fail` + verificação prévia); guarda `driveItem.id` | M |
| 3.4 | Tratamento de `429`/`503` com `Retry-After`; JSON batching; testes de falha e retoma | M |
| 3.5 | Job de compilação: montar secções → Docxtemplater → carregar → converter PDF → hash → `documents` (ficheiros em `01_Trabalho`) | XL |
| 3.6 | Subscrição Graph (webhook + delta query), renovação por job, marcação `MANUALLY_EDITED`; receção de webhooks em `/webhooks/*` com validação de `clientState` | L |

### API / colaboração

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 3.7 | `content`: blocos, versões (rascunho/aprovado/retirado), línguas, tags, responsável e data de revisão; bloco jurídico | L |
| 3.8 | `proposals`: secções referenciando versão de bloco; `is_modified` quando se altera bloco jurídico | M |
| 3.9 | Catálogo fechado de *merge tags* tipadas; validação na compilação; variável em falta bloqueia a geração | M |
| 3.10 | Tabela de preços como elemento estruturado do documento | M |
| 3.11 | Hocuspocus: autenticação por token, persistência em `section_documents`, `html_cache`, autorização por proposta | L |
| 3.12 | Sanitização do HTML do editor antes de entrar no DOCX; subconjunto de formatação suportado | M |
| 3.13 | Endpoints de documentos: estado do job, descarregar, abrir no Word Online (`webUrl`) | S |
| 3.14 | Regeneração: bloqueada se `MANUALLY_EDITED` sem confirmação; cria novo documento sem apagar o anterior | M |

### Frontend

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 3.15 | Biblioteca de conteúdos: pesquisa por tags/língua, versões, estados, revisão pendente | L |
| 3.16 | Editor de proposta: lista de secções, reordenar, inserir bloco, editar com TipTap + Yjs (cursores, presença), extensão de *merge tags* | XL |
| 3.17 | Ecrã de compilação: progresso via WebSocket, erros de variáveis em falta, pré-visualização PDF, abertura no Word Online | L |
| 3.18 | Aviso de documento editado manualmente e fluxo de confirmação para regenerar | S |
| 3.19 | E2E: composição → compilação → documento visível no SharePoint de QA | M |

**Saída:** proposta completa gerada e guardada no SharePoint de QA com `Sites.Selected` (sem permissões a nível do tenant); falha simulada do SharePoint deixa a proposta gravada e o job retoma sozinho; testes visuais com documentos de referência aprovados.

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
| 4.7 | Worker | Exportação diária para S3 com Object Lock (compliance); job noturno de verificação da cadeia com alerta | M |
| 4.8 | Worker | SLA e escalonamento de aprovações; expiração diária de propostas (`SENT` → `EXPIRED`) | M |
| 4.9 | Worker | Notificações: email (`Mail.Send` restrito) e cartões adaptativos no Teams com ligação à página de decisão; registo Azure Bot | L |
| 4.10 | Frontend | Submeter para aprovação com resumo de políticas aplicáveis | M |
| 4.11 | Frontend | Caixa de entrada do aprovador, página de decisão (cotação, margem, documento, histórico), delegação | L |
| 4.12 | Frontend | Linha temporal da proposta (estados, aprovações, auditoria) e ação de envio com estado dos hashes | M |
| 4.13 | Frontend | Administração de políticas de aprovação | M |
| 4.14 | Todas | Teste automatizado: alterar cotação ou documento depois de aprovado e tentar enviar → bloqueado | M |

**Saída:** o teste 4.14 passa; cadeia de auditoria verificada e exportação WORM a funcionar; fluxo completo comercial → aprovador → envio demonstrado em QA com notificações reais.

## 9. Fase 5 — Assinatura e integrações

| ID | Camada | Tarefa | Esf. |
| --- | --- | --- | --- |
| 5.1 | Worker | Interface `SignatureProvider` e adaptador do fornecedor escolhido em 0.5; criação de envelope, cancelamento | L |
| 5.2 | API | Webhooks do fornecedor (validação HMAC, idempotência) → `signature_envelopes` e transições `ACCEPTED`/`REJECTED`; PDF assinado em `03_Assinado` | L |
| 5.3 | API/Worker | Acompanhamento de abertura via eventos do fornecedor ou portal de cliente com ligação; sem píxeis de rastreio | M |
| 5.4 | API/Worker | Integração com o CRM interno conforme 0.6 (clientes, oportunidades, `crm_external_id`) | L |
| 5.5 | API | RGPD: retenção por tipo de dado, exportação/eliminação por titular, base legal registada | M |
| 5.6 | Frontend | Estado da assinatura na proposta, reenvio, registo manual de aceitação com evidência | M |
| 5.7 | Frontend | Sincronização e ligação a oportunidades do CRM nos ecrãs de cliente e proposta | M |

**Saída:** proposta assinada passa a `ACCEPTED` sem intervenção manual; dados de cliente consistentes com o CRM.

## 10. Fase 6 — Endurecimento e go-live

| ID | Tarefa | Esf. |
| --- | --- | --- |
| 6.1 | Testes de carga: geração concorrente de documentos (limites do Graph), cotações de 200 linhas, colaboração simultânea | M |
| 6.2 | Ensaio de recuperação completo: perda do servidor e restauro por código, incluindo falha de zona (RTO ≤ 4 h, RPO ≤ 15 min) | M |
| 6.3 | Revisão de segurança: permissões Graph, WAF, CSP, segredos, dependências; teste de intrusão | L |
| 6.4 | Migração de dados reais (clientes, catálogo, listas de preços, blocos de conteúdo) com reconciliação | L |
| 6.5 | Formação por perfil (Comercial, Gestor, Aprovador, Jurídico, Administrador) e manual de operação (runbooks, alertas, restauro) | M |
| 6.6 | Piloto com um grupo reduzido de comerciais; correção de defeitos; decisão de go-live | L |
| 6.7 | Revisão de custos (NAT, CloudWatch, licenças) e plano de migração da BD para RDS se a carga o exigir | S |

**Saída:** metas de desempenho e disponibilidade medidas em produção; restauro validado; piloto sem defeitos críticos abertos.

## 11. Estratégia de testes

| Nível | Âmbito | Ferramenta |
| --- | --- | --- |
| Unitário | Motor de preços e regras (casos de referência e propriedades), serviços de domínio | Vitest/Jest |
| Base de dados | Migrações para a frente e para trás, triggers, restrições | Testes de integração com MariaDB 12.3 em contentor |
| Contrato | API contra o OpenAPI; cliente gerado compila | Testes de contrato no CI |
| Integração | Worker com `DocumentRepository` simulado; Graph real só em QA | Jest + ambiente QA |
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
| Aprovação de segurança do Graph tarde | Bloqueia a Fase 3 | Pedido na Fase 0; `DocumentRepository` simulado permite avançar |
| Regras de preço mais complexas do que o modelo | Retrabalho na Fase 2 | Workshop 0.3 antes de começar; condições JSONLogic como válvula |
| Conversão HTML → DOCX perde formatação | Atraso em 3.5 | Subconjunto de formatação; testes visuais desde o início da Fase 3 |
| `UUID` da MariaDB não ordena UUIDv7 | Alteração de chaves | Teste em 1.2, antes de existir qualquer dado |
| Servidor único e restauro nunca testado | Risco operacional | Restauro em 1.5 e ensaio completo em 6.2 |
| Licença do módulo HTML do Docxtemplater | Custo ou troca de biblioteca | Decisão 0.10 antes da Fase 3 |

## 14. Próximo passo

Começar pela **Fase 1**, na ordem: 1.1 → 1.2 → 1.9/1.10 em paralelo com 1.3/1.4 (infraestrutura). A tarefa 1.2 decide o tipo de chave primária e, por isso, vem antes de qualquer outra migração.
