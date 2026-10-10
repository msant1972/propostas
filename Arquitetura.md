# Arquitetura CPQ & Proposal Management

9 de outubro de 2026 · @Miguel

## Sumário executivo

Este documento define a arquitetura da plataforma de CPQ (configurar, preçar, cotar) e gestão de propostas: stack, modelo de dados, integrações, segurança e operação. Todas as escolhas tecnológicas estão decididas, e o sistema garante que o documento enviado ao cliente corresponde à cotação aprovada.

Decisões principais:

1. **Stack decidida**: TypeScript ponta-a-ponta (React + NestJS), com o motor de regras CPQ num pacote partilhado que corre no browser (resposta imediata) e no servidor (fonte de verdade).
2. **Monólito modular + worker assíncrono**: todas as chamadas ao Microsoft Graph, geração de DOCX/PDF e notificações passam para filas (BullMQ/Redis) com padrão *outbox*, eliminando inconsistências entre MariaDB e SharePoint.
3. **Snapshots imutáveis**: cada versão de cotação é congelada com hash; a aprovação fica ligada a esse hash e ao hash do documento gerado. Qualquer alteração posterior invalida a aprovação.
4. **Modelo de dados completo**: clientes, utilizadores, listas de preços, custos, impostos, políticas de aprovação, versões de conteúdo, documentos e auditoria encadeada.
5. **Segurança de menor privilégio**: `Sites.Selected` (nunca `Sites.ReadWrite.All` nem `Files.ReadWrite.All`), segredos em AWS Secrets Manager, RBAC complementado com regras por registo (dono, equipa, região).
6. **Produção em AWS**: um único servidor Ubuntu em Amazon EC2 com a aplicação, a MariaDB 12.3 e o Redis, apoiado por serviços AWS para segredos, backups imutáveis e observabilidade.

## Visão geral e decisões arquiteturais

O sistema tem duas vertentes — **Motor CPQ** e **Proposal Content Engine** — e uma terceira transversal: **Governança** (aprovações, auditoria, integridade documental). O princípio orientador é simples: a MariaDB é a fonte de verdade para dados estruturados; o SharePoint é a fonte de verdade para ficheiros; nada passa entre os dois sem um evento registado.

| ADR | Decisão | Escolha | Alternativa rejeitada | Porquê |
| --- | --- | --- | --- | --- |
| 01 | Linguagem do backend | Node.js + NestJS (TypeScript) | C# .NET 8 | Mesmo código de regras e tipos no browser e no servidor; uma só linguagem para a equipa. .NET seria melhor apenas se a manipulação OpenXML fosse o núcleo do produto |
| 02 | Estilo de arquitetura | Monólito modular + worker separado | Microserviços | Domínio coeso, equipa pequena; módulos com fronteiras claras permitem extrair serviços mais tarde |
| 03 | Estilo de API | REST + OpenAPI 3.1, cliente TS gerado | GraphQL | Caching HTTP, autorização por endpoint e auditoria mais simples; o frontend recebe tipos gerados |
| 04 | ORM | Prisma (com migrações versionadas) | TypeORM | Tipagem mais forte, migrações declarativas; SQL nativo para relatórios |
| 05 | Base de dados | MariaDB 12.3 LTS instalada no servidor Ubuntu (repositório oficial MariaDB), em volume EBS próprio, com mariabackup e binlogs enviados para S3 | Amazon RDS for MariaDB | Um só servidor reduz custo e peças a gerir. A contrapartida é a equipa assumir backups, upgrades e monitorização da BD. A RDS, que suporta a 12.3 desde agosto de 2026 ([AWS](https://www.amazonaws.cn/en/new/2026/amazon-rds-for-mariadb-12-3/)), fica como caminho de migração se a carga ou a exigência de disponibilidade crescerem |
| 06 | Identidade | Microsoft Entra ID apenas (MSAL no frontend, validação JWT no backend) | IdentityServer | Os utilizadores já estão no M365; um segundo IdP só acrescenta custo |
| 07 | Editor de texto | TipTap + Yjs + Hocuspocus | SlateJS | Colaboração em tempo real pronta a usar; extensões para *merge tags* |
| 08 | Motor de documentos | Docxtemplater (com módulo HTML) para DOCX; conversão PDF via Graph | OpenXML SDK | Coerente com ADR-01; a conversão nativa do SharePoint dá fidelidade Word. O módulo HTML do Docxtemplater é pago: confirmar licença e custo antes da fase 3 |
| 09 | Processamento assíncrono | BullMQ sobre Redis + tabela *outbox* | Chamadas síncronas | Retries, *throttling* do Graph, idempotência |
| 10 | Regras CPQ | Pacote `@cpq/rules-engine` em TS puro, sem I/O | Regras só no frontend ou só no backend | Validação instantânea na UI, mas o servidor revalida sempre antes de gravar |

## Arquitetura tecnológica

A estrutura assenta na separação entre o caminho síncrono (utilizador → API → MariaDB) e o caminho assíncrono (outbox → fila → worker → serviços externos). O utilizador nunca espera por uma chamada ao SharePoint.

**Caminho síncrono**: Browser → ALB (WAF) → Nginx → API NestJS (REST) → MariaDB. A edição colaborativa segue Browser → Hocuspocus (WebSocket) → MariaDB.

**Caminho assíncrono**: a API grava a alteração de negócio e o registo em `outbox_events` na mesma transação → o *relay* do worker publica o evento no BullMQ (Redis) → os processadores do worker falam com o Microsoft Graph, o fornecedor de assinatura e o Teams/Exchange.

**Eventos externos**: os *webhooks* do Graph e do fornecedor de assinatura chegam a `/webhooks/*` no ALB (rota pública, validada por `clientState` ou assinatura HMAC), são recebidos pela API, gravados em `outbox_events` e processados pelo worker.

O browser fala com a API por REST e com o Hocuspocus por WebSocket; ambos gravam na MariaDB. A API regista cada alteração e o respetivo evento outbox na mesma transação, e só o worker contacta o Microsoft Graph e o fornecedor de assinatura.

| Camada | Tecnologia | Responsabilidade |
| --- | --- | --- |
| Frontend | React 18+, TypeScript, Vite, shadcn/ui, TailwindCSS, TanStack Query, Zustand, TipTap + Yjs, MSAL | UI, validação local de regras, edição colaborativa |
| API | NestJS, Prisma, CASL, OpenAPI 3.1 | Regras de negócio, autorização, transações, outbox |
| Colaboração | Hocuspocus | Sincronização Yjs e persistência de secções |
| Worker | NestJS + BullMQ | Documentos, Graph, assinatura, notificações, renovação de subscrições |
| Dados | MariaDB 12.3 LTS (InnoDB) e Redis, no mesmo servidor | Fonte de verdade estruturada; cache e filas |
| Ficheiros | SharePoint (via Graph), Amazon S3 com Object Lock | Documentos de proposta; cópia WORM da auditoria |
| Plataforma | AWS Secrets Manager, AWS KMS, CloudWatch, AWS WAF | Segredos, observabilidade, proteção de perímetro |

### Implantação em produção (AWS)

Toda a plataforma corre num único servidor Ubuntu Server LTS em Amazon EC2: aplicação, MariaDB e Redis. É a opção mais simples e barata; o preço é que o servidor é um ponto único de falha, por isso a arquitetura compensa com backups contínuos fora do servidor, recuperação automática da instância e um procedimento de restauro testado.

| Componente | Onde corre | Notas |
| --- | --- | --- |
| Entrada HTTPS | Application Load Balancer com certificado ACM e AWS WAF | O servidor fica numa subnet privada, sem IP público. Regras do listener: `/webhooks/*` é público (Graph e assinatura, validados por `clientState` ou HMAC); tudo o resto exige JWT do Entra ID. O WAF aplica limites de pedidos por IP |
| SPA, API, Hocuspocus, Worker | Servidor Ubuntu, contentores Docker Compose atrás de Nginx | Processos separados, com limites de memória e CPU por contentor |
| MariaDB 12.3 LTS | Servidor Ubuntu, pacote oficial MariaDB, volume EBS gp3 dedicado | Só aceita ligações locais; memória do *buffer pool* reservada para não competir com a aplicação |
| Redis | Servidor Ubuntu, contentor com persistência AOF | Guarda as filas do worker, por isso a persistência é obrigatória |
| Backups | mariabackup diário completo + binlogs enviados para S3 a cada 5 minutos; snapshots EBS diários com AWS Backup | Restauro testado trimestralmente noutra instância |
| Recuperação | Recuperação automática do EC2 em falha de hardware; alarmes CloudWatch | Os volumes EBS mantêm-se, por isso a instância volta com os dados. Se falhar uma zona de disponibilidade, o Terraform recria o servidor noutra zona a partir do último snapshot EBS e dos binlogs em S3, dentro do RTO de 4 h |
| Saída para a Internet | NAT Gateway (uma zona) para Graph, Entra ID, fornecedor de assinatura e Teams; *VPC endpoints* para S3, Secrets Manager, KMS e CloudWatch | Sem NAT o servidor privado não alcança o Microsoft 365; o custo do NAT entra no orçamento |
| Segredos | AWS Secrets Manager, lido pelo papel IAM da instância | Inclui o certificado da aplicação Entra ID e as credenciais da MariaDB |
| Cópia imutável da auditoria | Amazon S3 com Object Lock (modo compliance) | Exportação diária pelo worker |
| Logs e métricas | OpenTelemetry Collector → Amazon CloudWatch | Alarmes para disco, memória, filas, erros 5xx e respostas 429 do Graph |
| Infraestrutura | Terraform ou CloudFormation + Ansible | Servidor reconstruível a partir de código em caso de perda total |

O Microsoft 365 e o Entra ID continuam a ser os serviços de identidade e documentos: o servidor na AWS fala com eles por HTTPS através do Graph. O bot do Teams precisa apenas de um registo no Azure Bot Service; o código corre na AWS.

## Módulos funcionais

Cada módulo é um módulo NestJS com fronteira própria: só comunica com os outros através de serviços públicos ou eventos, nunca acedendo diretamente às tabelas alheias.

### CPQ — Configurar

- **Catálogo**: produtos, *bundles* (produto pai com componentes obrigatórios/opcionais), unidade de medida, atributos tipados (inteiro, decimal, lista, booleano) com mínimo, máximo e incremento.
- **Regras**: além de `REQUIRES`, `EXCLUDES` e `RECOMMENDS`, existem também `CONSTRAINT` (limites de quantidade ou atributo) e `DEFAULT` (valor sugerido). Cada regra tem condição opcional em JSONLogic, prioridade e período de vigência. Exemplo: *se licenças > 50 então Suporte Premium é obrigatório*.
- **Avaliação**: o pacote `@cpq/rules-engine` avalia no browser a cada alteração; o servidor reavalia ao gravar e rejeita configurações inválidas. O resultado da avaliação fica guardado no snapshot da versão.

### CPQ — Preçar

O cálculo segue uma ordem fixa e documentada, para que dois utilizadores obtenham sempre o mesmo total:

1. Preço de lista da `price_list` aplicável (moeda, região, canal, tier de cliente, data de vigência).
2. Escalões de volume, se definidos para o produto.
3. Desconto de linha (%).
4. Desconto global da cotação, aplicado sobre o subtotal de linhas — os descontos são multiplicativos, não somados.
5. Arredondamento à unidade monetária (2 casas, *half-up*) por linha, e só depois soma.
6. Impostos por linha, a partir de `tax_rates` (país, regime, isenção, autoliquidação).
7. Totais por modelo de cobrança: pontual, MRR, ARR, consumo estimado, marcos, e valor total do contrato (TCV) a partir da duração.
8. Margem por linha e global: (preço líquido − custo) ÷ preço líquido.

Regras que fecham as ambiguidades dos passos acima:

- **Escolha da lista de preços**: as candidatas são as listas com a moeda da cotação e vigentes na data da cotação. Cada campo (região, canal, tier) que coincide vale 1 ponto; um campo nulo na lista é genérico (0 pontos) e um campo preenchido que não coincide exclui a lista. Ganha a de maior pontuação; em empate, a de `valid_from` mais recente. A gravação de listas rejeita duas listas com a mesma especificidade e períodos sobrepostos, por isso um empate residual é um erro de configuração.
- **Escalões de volume**: aplica-se o item de `price_list_items` com maior `min_quantity` menor ou igual à quantidade.
- **Desconto global (%)**: `valor_linha = round2(qtd × preço_unitário × (1 − desc_linha))` e `desc_global_linha = round2(valor_linha × desc_global)`. A diferença entre `round2(Σ valor_linha × desc_global)` e a soma das parcelas vai para a linha de maior valor. O imposto é `round2((valor_linha − desc_global_linha) × taxa)`.
- **Moeda e câmbio**: a moeda da versão tem de ser a da lista de preços; `proposals.currency` é só a moeda por omissão das novas versões. O custo é convertido para a moeda da cotação com a taxa de `fx_rates` da data da cotação, e a taxa fica em `quote_items.cost_fx_rate`. `quote_versions.fx_rate_to_eur` serve apenas para relatórios.
- **Regime de IVA**: determinado no servidor a partir do país do cliente, do VAT validado (VIES) e do país da entidade emitente. `tax_rates` guarda as taxas por país, categoria fiscal do produto e regime.

Custos, preços de lista, taxas de imposto e câmbio são **copiados para a linha** no momento do cálculo. Alterar o catálogo amanhã não muda uma cotação de ontem.

### CPQ — Cotar e versionar

- Uma proposta tem várias versões de cotação (v1, v2, v3…), mas apenas uma `is_current`.
- Ao submeter para aprovação, a versão passa a `LOCKED` e é calculado um `snapshot_hash` (SHA-256 do JSON canónico com linhas, preços, regras avaliadas e condições).
- Qualquer alteração depois do bloqueio cria uma nova versão; a anterior fica intacta para auditoria.
- Ordem na transação ao criar uma versão: (1) a anterior passa a `is_current = FALSE` e `SUPERSEDED`; (2) a nova entra com `is_current = TRUE`. Trocar a ordem viola `uq_qv_current`.
- A imutabilidade é imposta na base de dados por *triggers* (ver «DDL complementar»): versões não `DRAFT` e as suas linhas rejeitam alterações. Antes de enviar, o servidor recalcula o hash a partir de `snapshot_json` e compara-o com `snapshot_hash`.

### Proposal Engine

- **Biblioteca de conteúdos versionada**: cada bloco tem versões (`content_block_versions`), estado (rascunho, aprovado, retirado), idioma, *tags* (relação N:N), responsável e data de revisão obrigatória.
- **Secções de proposta**: referenciam uma versão concreta do bloco. Se o comercial alterar um bloco marcado como jurídico, a secção fica `is_modified` e a proposta exige aprovação do perfil Jurídico.
- **Merge tags tipadas**: catálogo fechado de variáveis (`{{cliente.nome}}`, `{{cotacao.total_tcv}}`, `{{proposta.validade}}`), validadas na compilação; uma variável em falta bloqueia a geração em vez de produzir texto vazio. A tabela de preços entra como elemento estruturado, não como texto.
- **Colaboração**: TipTap + Yjs; cada secção é um documento Yjs, persistido pelo Hocuspocus na MariaDB.
- **Compilação** (job assíncrono): montar secções → preencher o modelo `.docx` do SharePoint com Docxtemplater → carregar para a pasta da proposta → converter para PDF via Graph → calcular hash do DOCX e do PDF → registar em `documents`.

### Documentos e SharePoint

- **Estrutura**: um site "Propostas" com biblioteca única e pastas `/Clientes/{codigo_cliente}/{codigo_proposta}/` com subpastas `01_Trabalho`, `02_Enviado` e `03_Assinado`. Usa-se uma biblioteca única com pastas, porque milhares de bibliotecas (uma por oportunidade) não escalam.
- **Permissões**: herdadas da biblioteca, evitando permissões únicas por pasta (degradam desempenho e gestão). O acesso fino é mediado pela aplicação; partilhas externas só a partir de `02_Enviado`.
- **Identificadores**: guardar `driveItem.id` e `eTag`, nunca caminhos — caminhos mudam quando alguém renomeia uma pasta.
- **Fonte de verdade em edições Word Online**: os dados comerciais vivem no CPQ; o texto final pode ser afinado no Word Online. Uma subscrição Graph (*webhook* + *delta query*) deteta edições manuais e marca o documento como `MANUALLY_EDITED`. A partir daí, regenerar exige confirmação explícita e cria nova versão, sem apagar a anterior.

### Workflow e aprovações

A máquina de estados inclui retornos, expiração e cancelamento, e liga o envio à verificação dos hashes aprovados.

Estados: `DRAFT`, `IN_REVIEW`, `PENDING_APPROVAL`, `APPROVED`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `CANCELLED`. Terminais: `ACCEPTED`, `REJECTED`, `CANCELLED`. Qualquer transição não listada é recusada pela API.

| De | Para | Evento (quem) | Guarda | Efeito |
| --- | --- | --- | --- | --- |
| `DRAFT` | `IN_REVIEW` | Compilar documento (comercial) | Motor de regras sem erros; merge tags todas resolvidas | Job gera DOCX e PDF em `01_Trabalho` e regista-os em `documents` |
| `IN_REVIEW` | `DRAFT` | Voltar a editar (comercial) | — | Se a versão de cotação estiver `LOCKED`, cria nova versão; documentos anteriores ficam no histórico |
| `IN_REVIEW` | `PENDING_APPROVAL` | Submeter (comercial) | Documento compilado e não `MANUALLY_EDITED` sem confirmação | Versão passa a `LOCKED`, calcula `snapshot_hash`; cria `approval_requests` por cada política aplicável, com o `sha256` do documento |
| `IN_REVIEW` | `APPROVED` | Submeter (comercial) | Nenhuma política aplicável | Aprovação automática registada em `audit_log` |
| `PENDING_APPROVAL` | `APPROVED` | Último nível aprovado (aprovador) | Todos os pedidos `APPROVED` com hashes iguais aos atuais | Notifica o comercial |
| `PENDING_APPROVAL` | `DRAFT` | Rejeitar ou devolver (aprovador); retirar (comercial) | Comentário obrigatório | Pedidos abertos passam a `REJECTED`, `RETURNED` ou `CANCELLED`; nova versão de cotação ao editar |
| `APPROVED` | `SENT` | Enviar (comercial) | `snapshot_hash` e `sha256` do documento iguais aos aprovados; proposta dentro da validade | Copia o PDF para `02_Enviado`, cria envelope no fornecedor de assinatura |
| `APPROVED` | `DRAFT` | Editar (comercial) | Confirmação explícita | A aprovação deixa de valer; nova versão de cotação |
| `SENT` | `ACCEPTED` ou `REJECTED` | Webhook do fornecedor de assinatura, ou registo manual com evidência (comercial) | — | PDF assinado em `03_Assinado` |
| `SENT` | `EXPIRED` | Job diário | `valid_until` ultrapassada | Notifica o comercial |
| `SENT` | `DRAFT` | Rever após envio (comercial) | Confirmação explícita | Cancela o envelope; a versão enviada passa a `SUPERSEDED`; nova versão de cotação |
| `EXPIRED` | `DRAFT` | Reabrir (comercial) | Nova data de validade | Nova versão de cotação |
| `DRAFT`, `IN_REVIEW`, `PENDING_APPROVAL`, `APPROVED`, `SENT` | `CANCELLED` | Cancelar (dono ou gestor) | Motivo obrigatório | Cancela pedidos abertos e envelopes |

Cada retorno a `DRAFT` a partir de uma versão `LOCKED` cria uma nova versão de cotação; a versão anterior e as aprovações que recebeu ficam no histórico.

- **Políticas de aprovação** configuráveis: condição (ex.: desconto > 15 % ou margem < 25 % ou total > 100 000 €), níveis, modo sequencial ou paralelo, SLA por nível com escalonamento, e delegação durante ausências. Os valores do exemplo são ilustrativos e devem ser definidos pela direção financeira.
- **Ligação ao snapshot**: cada decisão regista o `snapshot_hash` da cotação e o hash do documento aprovado. Antes de enviar ao cliente, o sistema verifica que ambos coincidem com o que vai sair; se não coincidirem, o envio é bloqueado.
- **Âmbito do pedido**: `approval_requests.scope` é `COMMERCIAL` (desconto, margem, valor) ou `LEGAL` (secções jurídicas modificadas). Ambos referenciam a versão de cotação e o documento compilado, e guardam o `snapshot_hash` e o `sha256` do documento no momento do pedido. O envio exige todos os pedidos que as políticas determinam em `APPROVED`, com hashes iguais aos atuais.
- **Notificações**: email e cartões adaptativos no Teams. Os botões abrem a página de decisão da aplicação (ligação direta, autenticação MSAL), onde o aprovador decide com o seu próprio token — nunca com uma conta de serviço. Decidir diretamente no cartão (Action.Execute com SSO do bot) fica como melhoria posterior.

### Assinatura eletrónica e acompanhamento

- Interface `SignatureProvider` com adaptadores para DocuSign e Adobe Sign; para assinatura qualificada eIDAS, um prestador qualificado da lista de confiança da UE.
- O PDF assinado é guardado em `03_Assinado` e o *webhook* do fornecedor move a proposta para `ACCEPTED` ou `REJECTED`.
- O acompanhamento de abertura usa os eventos do fornecedor de assinatura ou um portal de cliente com link; píxeis de rastreio em email ficam fora, por questões de RGPD.

## Modelo de dados (MariaDB)

O modelo passa de 6 para 28 tabelas, todas com FKs reais. Convenções: chaves `UUID` nativas (MariaDB 10.7+) com valores UUIDv7 gerados na aplicação, para índices ordenados no tempo; datas em `DATETIME(6)` UTC (ligações com `time_zone='+00:00'` e valores por omissão `CURRENT_TIMESTAMP(6)`, porque `ON UPDATE` só aceita essa família de funções); valores monetários `DECIMAL(15,4)` em cálculo e `DECIMAL(15,2)` em totais; *soft delete* com `deleted_at`; bloqueio otimista com `row_version`. A base de dados é criada com `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` e InnoDB por omissão. Na fase 1, um teste de inserção ordenada confirma que o tipo `UUID` mantém a ordem temporal dos UUIDv7; se não mantiver, usa-se `BINARY(16)`.

| Domínio | Tabela | Propósito | Relações principais |
| --- | --- | --- | --- |
| Identidade | `users` | Espelho dos utilizadores Entra ID (`entra_oid`), equipa, região | — |
| Identidade | `teams` | Equipas comerciais para regras de visibilidade | 1:N `users` |
| Clientes | `clients` | Cliente com NIF/VAT, país, tier, ID externo do CRM | 1:N `proposals` |
| Catálogo | `products` | Produto/serviço, unidade, custo, modelo de cobrança | 1:N `product_attributes` |
| Catálogo | `product_attributes` | Atributos configuráveis tipados | N:1 `products` |
| Catálogo | `price_lists` / `price_list_items` | Preços por moeda, região, canal, tier, vigência | N:1 `products` |
| Catálogo | `product_bundle_items` | Componentes de *bundles* (obrigatório/opcional, quantidades) | N:1 `products` (pai e componente) |
| Catálogo | `tax_rates` | IVA por país, categoria fiscal e regime | — |
| Catálogo | `fx_rates` | Taxas de câmbio diárias com fonte | — |
| Catálogo | `cpq_rules` | Regras com condição JSONLogic | N:1 `products` (origem e alvo) |
| Propostas | `proposals` | Cabeçalho, estado, validade, idioma, pasta SharePoint | N:1 `clients`, `users` |
| Propostas | `quote_versions` | Versões com snapshot e hash | N:1 `proposals` |
| Propostas | `quote_items` | Linhas com preços e custos congelados | N:1 `quote_versions`, `products` |
| Conteúdo | `content_blocks` / `content_block_versions` | Biblioteca versionada | 1:N versões |
| Conteúdo | `tags` / `content_block_tags` | Categorização N:N | — |
| Conteúdo | `proposal_sections` | Ordem das secções, versão de bloco usada, alterações | N:1 `proposals`, `content_block_versions` |
| Conteúdo | `section_documents` | Estado Yjs e cache HTML de cada secção (Hocuspocus) | 1:1 `proposal_sections` |
| Documentos | `documents` | DOCX/PDF gerados, `driveItem.id`, `eTag`, hash, origem | N:1 `proposals`, `quote_versions` |
| Documentos | `signature_envelopes` | Envelope no fornecedor de assinatura e estado | N:1 `proposals`, `documents` |
| Governança | `approval_policies` | Condições, níveis, modo, SLA | — |
| Governança | `approval_requests` / `approval_decisions` | Pedido por versão e âmbito (comercial ou jurídico), decisão por aprovador | N:1 `quote_versions`, `documents`, `approval_policies` |
| Governança | `audit_log` | Registo append-only com cadeia de hashes | — |
| Infraestrutura | `graph_subscriptions` | Subscrições Graph, `deltaLink` e expiração | — |
| Infraestrutura | `outbox_events` | Eventos a processar pelo worker | — |

### DDL das tabelas principais

```sql
CREATE TABLE clients (
    id            UUID PRIMARY KEY,
    code          VARCHAR(50)  NOT NULL UNIQUE,
    name          VARCHAR(255) NOT NULL,
    vat_number    VARCHAR(30),
    country_code  CHAR(2)      NOT NULL,
    tier          VARCHAR(30),
    crm_external_id VARCHAR(100) UNIQUE,
    created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    deleted_at    DATETIME(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE teams (
    id            UUID PRIMARY KEY,
    name          VARCHAR(100) NOT NULL UNIQUE,
    lead_user_id  UUID
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users (
    id            UUID PRIMARY KEY,
    entra_oid     UUID         NOT NULL UNIQUE,
    email         VARCHAR(255) NOT NULL,
    display_name  VARCHAR(255) NOT NULL,
    team_id       UUID,
    region        VARCHAR(50),
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    FOREIGN KEY (team_id) REFERENCES teams(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE products (
    id             UUID PRIMARY KEY,
    sku            VARCHAR(50)  NOT NULL UNIQUE,
    name           VARCHAR(255) NOT NULL,
    description    TEXT,
    unit_of_measure VARCHAR(20) NOT NULL DEFAULT 'UN',
    billing_model  ENUM('ONE_TIME','RECURRING','USAGE_BASED','MILESTONE') NOT NULL,
    billing_period ENUM('MONTH','QUARTER','YEAR'),
    unit_cost      DECIMAL(15,4) NOT NULL DEFAULT 0,
    cost_currency  CHAR(3)      NOT NULL DEFAULT 'EUR',
    tax_category   VARCHAR(30)  NOT NULL DEFAULT 'STANDARD',
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    row_version    INT          NOT NULL DEFAULT 1,
    created_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT chk_recurring_period CHECK (billing_model <> 'RECURRING' OR billing_period IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE price_lists (
    id          UUID PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    currency    CHAR(3)      NOT NULL,
    region      VARCHAR(50),
    channel     VARCHAR(50),
    client_tier VARCHAR(30),
    valid_from  DATE         NOT NULL,
    valid_to    DATE,
    CONSTRAINT chk_pl_dates CHECK (valid_to IS NULL OR valid_to >= valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE price_list_items (
    id            UUID PRIMARY KEY,
    price_list_id UUID NOT NULL,
    product_id    UUID NOT NULL,
    min_quantity  DECIMAL(12,3) NOT NULL DEFAULT 0,
    unit_price    DECIMAL(15,4) NOT NULL,
    UNIQUE KEY uq_pli (price_list_id, product_id, min_quantity),
    FOREIGN KEY (price_list_id) REFERENCES price_lists(id),
    FOREIGN KEY (product_id)    REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cpq_rules (
    id                UUID PRIMARY KEY,
    source_product_id UUID NOT NULL,
    target_product_id UUID,
    rule_type   ENUM('REQUIRES','EXCLUDES','RECOMMENDS','CONSTRAINT','DEFAULT') NOT NULL,
    condition_json JSON CHECK (condition_json IS NULL OR JSON_VALID(condition_json)),
    priority    SMALLINT NOT NULL DEFAULT 100,
    message     VARCHAR(255),
    valid_from  DATE NOT NULL,
    valid_to    DATE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_rule_self CHECK (target_product_id IS NULL OR target_product_id <> source_product_id),
    FOREIGN KEY (source_product_id) REFERENCES products(id),
    FOREIGN KEY (target_product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE proposals (
    id             UUID PRIMARY KEY,
    code           VARCHAR(50)  NOT NULL UNIQUE,
    title          VARCHAR(255) NOT NULL,
    client_id      UUID NOT NULL,
    owner_user_id  UUID NOT NULL,
    status ENUM('DRAFT','IN_REVIEW','PENDING_APPROVAL','APPROVED','SENT',
                'ACCEPTED','REJECTED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    currency       CHAR(3)      NOT NULL DEFAULT 'EUR',
    language       CHAR(5)      NOT NULL DEFAULT 'pt-PT',
    valid_until    DATE,
    sp_drive_id    VARCHAR(255),
    sp_folder_item_id VARCHAR(255),
    row_version    INT NOT NULL DEFAULT 1,
    created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at     DATETIME(6),
    KEY ix_prop_owner_status (owner_user_id, status),
    FOREIGN KEY (client_id)     REFERENCES clients(id),
    FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE quote_versions (
    id              UUID PRIMARY KEY,
    proposal_id     UUID NOT NULL,
    version_number  INT  NOT NULL,
    status          ENUM('DRAFT','LOCKED','SUPERSEDED') NOT NULL DEFAULT 'DRAFT',
    is_current      BOOLEAN NOT NULL DEFAULT TRUE,
    current_flag    TINYINT AS (IF(is_current, 1, NULL)) PERSISTENT,
    price_list_id   UUID NOT NULL,
    currency        CHAR(3) NOT NULL,
    fx_rate_to_eur  DECIMAL(18,8) NOT NULL DEFAULT 1,
    subtotal        DECIMAL(15,2) NOT NULL DEFAULT 0,
    discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_tax       DECIMAL(15,2) NOT NULL DEFAULT 0,
    grand_total     DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_mrr       DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_tcv       DECIMAL(15,2) NOT NULL DEFAULT 0,
    margin_percent  DECIMAL(6,2),
    snapshot_json   JSON,
    snapshot_hash   CHAR(64),
    locked_at       DATETIME(6),
    created_by      UUID NOT NULL,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_qv_number  (proposal_id, version_number),
    UNIQUE KEY uq_qv_current (proposal_id, current_flag),
    CONSTRAINT chk_locked_hash CHECK (status = 'DRAFT' OR snapshot_hash IS NOT NULL),
    FOREIGN KEY (proposal_id)   REFERENCES proposals(id) ON DELETE RESTRICT,
    FOREIGN KEY (price_list_id) REFERENCES price_lists(id),
    FOREIGN KEY (created_by)    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE quote_items (
    id                UUID PRIMARY KEY,
    quote_version_id  UUID NOT NULL,
    line_number       SMALLINT NOT NULL,
    product_id        UUID NOT NULL,
    product_name_snapshot VARCHAR(255) NOT NULL,
    attributes_json   JSON,
    quantity          DECIMAL(12,3) NOT NULL CHECK (quantity > 0),
    term_months       SMALLINT,
    list_unit_price   DECIMAL(15,4) NOT NULL,
    unit_cost         DECIMAL(15,4) NOT NULL,            -- já na moeda da cotação
    cost_fx_rate      DECIMAL(18,8) NOT NULL DEFAULT 1,  -- moeda de custo -> moeda da cotação
    discount_percent  DECIMAL(5,2)  NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
    net_unit_price    DECIMAL(15,4) NOT NULL,
    global_discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate_percent  DECIMAL(5,2)  NOT NULL,
    tax_regime        VARCHAR(20)   NOT NULL DEFAULT 'STANDARD',
    tax_amount        DECIMAL(15,2) NOT NULL DEFAULT 0,
    line_total        DECIMAL(15,2) NOT NULL,            -- valor_linha - desconto global, sem imposto
    UNIQUE KEY uq_qi_line (quote_version_id, line_number),
    FOREIGN KEY (quote_version_id) REFERENCES quote_versions(id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id)       REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE documents (
    id               UUID PRIMARY KEY,
    proposal_id      UUID NOT NULL,
    quote_version_id UUID,
    kind             ENUM('DOCX','PDF','SIGNED_PDF','ATTACHMENT') NOT NULL,
    origin           ENUM('GENERATED','MANUALLY_EDITED','UPLOADED') NOT NULL,
    sp_item_id       VARCHAR(255) NOT NULL,
    sp_etag          VARCHAR(255),
    sha256           CHAR(64) NOT NULL,
    created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    FOREIGN KEY (proposal_id)      REFERENCES proposals(id),
    FOREIGN KEY (quote_version_id) REFERENCES quote_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE approval_policies (
    id             UUID PRIMARY KEY,
    name           VARCHAR(100) NOT NULL,
    scope          ENUM('COMMERCIAL','LEGAL') NOT NULL,
    -- JSONLogic sobre: max_line_discount_percent, margin_percent, grand_total, has_modified_legal_section
    condition_json JSON NOT NULL CHECK (JSON_VALID(condition_json)),
    mode           ENUM('SEQUENTIAL','PARALLEL') NOT NULL DEFAULT 'SEQUENTIAL',
    -- [{"level":1,"role":"Gestor_Comercial","sla_hours":24,"escalate_to_role":"Aprovador_Financeiro"}]
    levels_json    JSON NOT NULL CHECK (JSON_VALID(levels_json)),
    priority       SMALLINT NOT NULL DEFAULT 100,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    valid_from     DATE NOT NULL,
    valid_to       DATE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE approval_requests (
    id                   UUID PRIMARY KEY,
    proposal_id          UUID NOT NULL,
    quote_version_id     UUID NOT NULL,
    document_id          UUID NOT NULL,
    policy_id            UUID NOT NULL,
    policy_snapshot_json JSON NOT NULL,
    scope                ENUM('COMMERCIAL','LEGAL') NOT NULL,
    status               ENUM('OPEN','APPROVED','REJECTED','RETURNED','CANCELLED','SUPERSEDED') NOT NULL DEFAULT 'OPEN',
    current_level        TINYINT NOT NULL DEFAULT 1,
    level_due_at         DATETIME(6),
    snapshot_hash        CHAR(64) NOT NULL,
    document_sha256      CHAR(64) NOT NULL,
    requested_by         UUID NOT NULL,
    requested_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    closed_at            DATETIME(6),
    KEY ix_ar_open (status, level_due_at),
    FOREIGN KEY (proposal_id)      REFERENCES proposals(id),
    FOREIGN KEY (quote_version_id) REFERENCES quote_versions(id),
    FOREIGN KEY (document_id)      REFERENCES documents(id),
    FOREIGN KEY (policy_id)        REFERENCES approval_policies(id),
    FOREIGN KEY (requested_by)     REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE approval_decisions (
    id                  UUID PRIMARY KEY,
    approval_request_id UUID NOT NULL,
    level_number        TINYINT NOT NULL,
    approver_user_id    UUID NOT NULL,
    on_behalf_of_user_id UUID,
    decision            ENUM('APPROVED','REJECTED','RETURNED') NOT NULL,
    comment             TEXT,
    snapshot_hash       CHAR(64) NOT NULL,
    document_sha256     CHAR(64),
    decided_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_ad (approval_request_id, level_number, approver_user_id),
    FOREIGN KEY (approval_request_id)  REFERENCES approval_requests(id),
    FOREIGN KEY (approver_user_id)     REFERENCES users(id),
    FOREIGN KEY (on_behalf_of_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_log (
    seq          BIGINT AUTO_INCREMENT PRIMARY KEY,
    occurred_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    actor_user_id UUID,
    entity_type  VARCHAR(50) NOT NULL,
    entity_id    UUID NOT NULL,
    action       VARCHAR(50) NOT NULL,
    diff_json    JSON NOT NULL,
    prev_hash    CHAR(64) NOT NULL,
    row_hash     CHAR(64) NOT NULL,
    KEY ix_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE outbox_events (
    id            UUID PRIMARY KEY,
    aggregate_id  UUID NOT NULL,
    event_type    VARCHAR(100) NOT NULL,
    payload       JSON NOT NULL,
    status        ENUM('PENDING','PROCESSING','DONE','FAILED') NOT NULL DEFAULT 'PENDING',
    attempts      SMALLINT NOT NULL DEFAULT 0,
    next_attempt_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY ix_outbox_pending (status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### DDL complementar

Tabelas que o texto exige e que faltavam. Cada `CREATE TABLE` usa os valores por omissão da base de dados (`utf8mb4`, InnoDB), por isso o sufixo é omitido.

```sql
CREATE TABLE product_attributes (
    id            UUID PRIMARY KEY,
    product_id    UUID NOT NULL,
    code          VARCHAR(50)  NOT NULL,
    label         VARCHAR(100) NOT NULL,
    data_type     ENUM('INTEGER','DECIMAL','LIST','BOOLEAN') NOT NULL,
    min_value     DECIMAL(15,4),
    max_value     DECIMAL(15,4),
    step_value    DECIMAL(15,4),
    allowed_values_json JSON,
    is_required   BOOLEAN NOT NULL DEFAULT FALSE,
    default_value VARCHAR(100),
    UNIQUE KEY uq_pa (product_id, code),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE product_bundle_items (
    id                   UUID PRIMARY KEY,
    bundle_product_id    UUID NOT NULL,
    component_product_id UUID NOT NULL,
    is_required          BOOLEAN NOT NULL DEFAULT TRUE,
    default_quantity     DECIMAL(12,3) NOT NULL DEFAULT 1,
    min_quantity         DECIMAL(12,3),
    max_quantity         DECIMAL(12,3),
    sort_order           SMALLINT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_pbi (bundle_product_id, component_product_id),
    CONSTRAINT chk_pbi_self CHECK (bundle_product_id <> component_product_id),
    FOREIGN KEY (bundle_product_id)    REFERENCES products(id),
    FOREIGN KEY (component_product_id) REFERENCES products(id)
);

CREATE TABLE tax_rates (
    id               UUID PRIMARY KEY,
    country_code     CHAR(2)     NOT NULL,
    tax_category     VARCHAR(30) NOT NULL DEFAULT 'STANDARD',
    regime           ENUM('STANDARD','REDUCED','EXEMPT','REVERSE_CHARGE','OUTSIDE_SCOPE') NOT NULL,
    rate_percent     DECIMAL(5,2) NOT NULL,
    exemption_reason VARCHAR(255),
    valid_from       DATE NOT NULL,
    valid_to         DATE,
    UNIQUE KEY uq_tax (country_code, tax_category, regime, valid_from)
);

CREATE TABLE fx_rates (
    id             UUID PRIMARY KEY,
    base_currency  CHAR(3)       NOT NULL,
    quote_currency CHAR(3)       NOT NULL,
    rate           DECIMAL(18,8) NOT NULL,
    rate_date      DATE          NOT NULL,
    source         VARCHAR(50)   NOT NULL,
    UNIQUE KEY uq_fx (base_currency, quote_currency, rate_date)
);

CREATE TABLE content_blocks (
    id            UUID PRIMARY KEY,
    code          VARCHAR(50)  NOT NULL UNIQUE,
    title         VARCHAR(255) NOT NULL,
    is_legal      BOOLEAN      NOT NULL DEFAULT FALSE,
    owner_user_id UUID         NOT NULL,
    created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    deleted_at    DATETIME(6),
    FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE TABLE content_block_versions (
    id              UUID PRIMARY KEY,
    block_id        UUID NOT NULL,
    language        CHAR(5) NOT NULL,
    version_number  INT NOT NULL,
    status          ENUM('DRAFT','APPROVED','RETIRED') NOT NULL DEFAULT 'DRAFT',
    body_html       MEDIUMTEXT NOT NULL,
    review_due_date DATE NOT NULL,
    created_by      UUID NOT NULL,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_cbv (block_id, language, version_number),
    FOREIGN KEY (block_id)   REFERENCES content_blocks(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE tags (
    id   UUID PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE content_block_tags (
    block_id UUID NOT NULL,
    tag_id   UUID NOT NULL,
    PRIMARY KEY (block_id, tag_id),
    FOREIGN KEY (block_id) REFERENCES content_blocks(id),
    FOREIGN KEY (tag_id)   REFERENCES tags(id)
);

CREATE TABLE proposal_sections (
    id               UUID PRIMARY KEY,
    proposal_id      UUID NOT NULL,
    position         SMALLINT NOT NULL,
    title            VARCHAR(255) NOT NULL,
    block_version_id UUID,                       -- NULL em secções escritas de raiz
    is_modified      BOOLEAN NOT NULL DEFAULT FALSE,
    row_version      INT NOT NULL DEFAULT 1,
    KEY ix_ps_order (proposal_id, position),
    FOREIGN KEY (proposal_id)      REFERENCES proposals(id) ON DELETE RESTRICT,
    FOREIGN KEY (block_version_id) REFERENCES content_block_versions(id)
);

CREATE TABLE section_documents (
    section_id UUID PRIMARY KEY,
    ydoc_state LONGBLOB NOT NULL,                -- estado Yjs persistido pelo Hocuspocus
    html_cache MEDIUMTEXT,                       -- HTML derivado, usado na compilação
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (section_id) REFERENCES proposal_sections(id) ON DELETE CASCADE
);

CREATE TABLE graph_subscriptions (
    id               UUID PRIMARY KEY,
    subscription_id  VARCHAR(100) NOT NULL UNIQUE,
    drive_id         VARCHAR(255) NOT NULL,
    client_state_hash CHAR(64)    NOT NULL,
    delta_link       TEXT,
    expires_at       DATETIME(6)  NOT NULL,
    last_synced_at   DATETIME(6),
    KEY ix_gs_expiry (expires_at)
);

CREATE TABLE signature_envelopes (
    id            UUID PRIMARY KEY,
    proposal_id   UUID NOT NULL,
    document_id   UUID NOT NULL,
    provider      ENUM('DOCUSIGN','ADOBE_SIGN','QES') NOT NULL,
    external_id   VARCHAR(100) NOT NULL UNIQUE,
    status        ENUM('CREATED','SENT','VIEWED','SIGNED','DECLINED','VOIDED') NOT NULL DEFAULT 'CREATED',
    sent_at       DATETIME(6),
    viewed_at     DATETIME(6),
    completed_at  DATETIME(6),
    last_event_at DATETIME(6),
    FOREIGN KEY (proposal_id) REFERENCES proposals(id),
    FOREIGN KEY (document_id) REFERENCES documents(id)
);
```

*Triggers* de imutabilidade (migração SQL manual, fora do Prisma):

```sql
DELIMITER //

CREATE TRIGGER trg_qv_immutable BEFORE UPDATE ON quote_versions
FOR EACH ROW
BEGIN
    IF OLD.status <> 'DRAFT'
       AND NOT (NEW.snapshot_hash <=> OLD.snapshot_hash
                AND NEW.snapshot_json <=> OLD.snapshot_json
                AND NEW.grand_total   = OLD.grand_total
                AND NEW.total_tcv     = OLD.total_tcv
                AND NEW.price_list_id = OLD.price_list_id
                AND NEW.currency      = OLD.currency) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'quote_version bloqueada: crie uma nova versão';
    END IF;
END//

CREATE TRIGGER trg_qi_bi BEFORE INSERT ON quote_items
FOR EACH ROW
BEGIN
    IF (SELECT status FROM quote_versions WHERE id = NEW.quote_version_id) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'quote_version bloqueada: crie uma nova versão';
    END IF;
END//

CREATE TRIGGER trg_qi_bu BEFORE UPDATE ON quote_items
FOR EACH ROW
BEGIN
    IF (SELECT status FROM quote_versions WHERE id = OLD.quote_version_id) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'quote_version bloqueada: crie uma nova versão';
    END IF;
END//

CREATE TRIGGER trg_qi_bd BEFORE DELETE ON quote_items
FOR EACH ROW
BEGIN
    IF (SELECT status FROM quote_versions WHERE id = OLD.quote_version_id) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'quote_version bloqueada: crie uma nova versão';
    END IF;
END//

DELIMITER ;
```

Notas de implementação:

- `uq_qv_current` garante uma única versão corrente por proposta: a MariaDB não tem índices parciais, mas uma coluna gerada que vale `NULL` nas versões não correntes resolve o problema.
- O total da proposta não é guardado em `proposals`; lê-se da versão corrente.
- O utilizador de base de dados da aplicação só tem `INSERT` e `SELECT` em `audit_log`; cada `row_hash` = SHA-256(`prev_hash` + conteúdo da linha), pelo que alterar uma linha quebra a cadeia. A API não escreve na cadeia diretamente: cada alteração gera um evento `audit.record` no outbox (na mesma transação) e uma fila dedicada, com concorrência 1, acrescenta-o à cadeia (lê o último `row_hash` e insere). Isto serializa a cadeia sem bloquear os pedidos; o atraso esperado é de segundos.
- O esquema Prisma é gerado a partir deste DDL, que é a referência. *Triggers* e colunas geradas não são expressáveis em Prisma e entram como migrações SQL manuais.

## Integração Microsoft Graph

Todas as chamadas usam a API `v1.0`; nenhum endpoint `beta` entra em produção. Separam-se dois contextos de identidade, porque o worker trabalha sem utilizador presente e não pode depender de tokens delegados que expiram.

### Autenticação e permissões

| Contexto | Fluxo | Permissões | Usado para |
| --- | --- | --- | --- |
| Utilizador no browser | Authorization Code + PKCE (MSAL), API com *On-Behalf-Of* | Delegadas: `User.Read`, `Sites.Selected` | Abrir documentos no Word Online, ações em nome do utilizador |
| Worker (sem utilizador) | Client credentials com certificado ou *workload identity federation* — nunca segredo em texto | Aplicação: `Sites.Selected`, com papel `write` concedido só ao site "Propostas" | Criar pastas, carregar DOCX, converter PDF, subscrições |
| Notificações | Bot do Teams (registo no Azure Bot Service, código na AWS) e envio de email limitado por política de acesso a caixas do Exchange | `Mail.Send` restrito a uma caixa de serviço | Pedidos de aprovação e alertas |

Com `Sites.Selected`, a aplicação não acede a nenhum site até um administrador lhe conceder acesso explícito; a permissão é GA e funciona tanto no Graph como nas APIs SharePoint ([Microsoft 365 Developer Blog](https://devblogs.microsoft.com/microsoft365dev/?p=11229)). As permissões `Sites.ReadWrite.All` e `Files.ReadWrite.All` não são usadas.

### Operações

| Operação | Endpoint (`v1.0`) | Notas |
| --- | --- | --- |
| Criar pasta | `POST /drives/{drive-id}/items/{parent-id}/children` | `@microsoft.graph.conflictBehavior: fail` e verificação prévia, para a operação ser idempotente em retries |
| Carregar DOCX | `PUT /drives/{drive-id}/items/{parent-id}:/{nome}:/content` | Para ficheiros grandes ou anexos, `createUploadSession` com envio em blocos |
| Converter para PDF | `GET /drives/{drive-id}/items/{item-id}/content?format=pdf` | Resposta é um redirecionamento para o ficheiro; o worker descarrega, calcula o hash e grava em `01_Trabalho`. Só no envio ao cliente (proposta `APPROVED`, hashes verificados) o PDF é copiado para `02_Enviado`, a única pasta com partilha externa |
| Abrir no Word Online | `webUrl` do `driveItem` | Não se usa `createLink`: utilizadores internos abrem com as suas próprias permissões, sem criar links de partilha |
| Partilha externa | `POST /drives/{drive-id}/items/{item-id}/invite` | Só em `02_Enviado`, destinatários nominais, só leitura, com expiração |
| Detetar edições | `POST /subscriptions` sobre a raiz da drive + `GET /drives/{drive-id}/root/delta` | O *webhook* só avisa que algo mudou; a *delta query* com o `deltaLink` guardado diz o quê. A subscrição é renovada por job antes de expirar |

### Resiliência

- Todas as operações Graph são jobs disparados por `outbox_events`, gravados na mesma transação que a alteração de negócio. Se o SharePoint estiver indisponível, a proposta fica gravada e o job tenta de novo.
- **Relay do outbox**: um processo do worker consulta `outbox_events` a cada segundo (`status = 'PENDING' AND next_attempt_at <= CURRENT_TIMESTAMP(6)`, `ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED`), marca `PROCESSING` e cria o job no BullMQ com `jobId` igual ao ID do evento, o que o torna idempotente. Ao terminar, o processador marca `DONE`; em falha, incrementa `attempts` e fixa `next_attempt_at`. Eventos em `PROCESSING` há mais de 10 minutos voltam a `PENDING`.
- Respostas `429` e `503` respeitam o cabeçalho `Retry-After`; restantes falhas usam *backoff* exponencial com *jitter* e passam a `FAILED` após o limite de tentativas, com alerta.
- Cada job tem chave de idempotência (ID do evento), para que repetir nunca crie pastas ou ficheiros duplicados.
- Pedidos independentes agrupam-se com JSON batching (`POST /$batch`) para reduzir chamadas.
- O SDK oficial Microsoft Graph para TypeScript fica atrás de uma interface `DocumentRepository`, para testes com *mocks* e eventual troca de repositório.

## Requisitos não-funcionais, segurança e operação

As metas abaixo são propostas de partida, a validar com o negócio; cada uma é mensurável.

### Desempenho e disponibilidade

| Requisito | Meta proposta | Como se garante |
| --- | --- | --- |
| Validação de regras na UI | p95 < 50 ms para cotações até 200 linhas | Motor de regras local no browser, catálogo em cache |
| Recalcular e gravar cotação (servidor) | p95 < 500 ms para 200 linhas | Catálogo e listas de preços em Redis, invalidação por evento |
| Geração DOCX + PDF | p95 < 60 s, assíncrona com progresso na UI | Worker com filas; UI informa via WebSocket |
| Disponibilidade | 99,5 % em horário de expediente | Uma instância EC2 com recuperação automática, alarmes, *health checks* |
| RPO / RTO | 15 min / 4 h | mariabackup diário + binlogs para S3 a cada 5 min, permitindo *point-in-time recovery*; teste de restauro trimestral |

### Segurança

- **Identidade**: apenas Entra ID; papéis de aplicação (`Comercial`, `Gestor_Comercial`, `Aprovador_Financeiro`, `Juridico`, `Administrador`) atribuídos via grupos Entra.
- **Autorização por registo**: além do papel, regras de visibilidade — o comercial vê as suas propostas, o gestor vê as da equipa, o aprovador vê as que lhe estão atribuídas. Implementado com CASL num *guard* NestJS, aplicado também aos filtros de consulta.
- **Segredos**: AWS Secrets Manager, lido através do papel IAM da instância EC2; nenhum segredo em variáveis de ambiente ou repositório.
- **Transporte**: TLS 1.2 no mínimo, 1.3 preferido; HSTS; WAF à frente da API.
- **Repouso**: encriptação InnoDB de tabelas, *redo* e *binlogs* com o plugin file\_key\_management, cuja chave é obtida do Secrets Manager no arranque por um serviço systemd que a escreve em tmpfs (`/run/mariadb/keys`), nunca em disco persistente (não se usa o termo "TDE", que é do SQL Server). Volumes EBS do servidor e backups também encriptados com KMS.
- **Aplicação**: validação de entrada com DTOs, sanitização do HTML do editor antes de entrar no DOCX, CSP rigorosa, proteção contra *mass assignment*, *rate limiting* por utilizador.
- **Cadeia de fornecimento**: análise de dependências e SAST no CI, imagens de contentor assinadas.

### Auditoria e conformidade

- Todos os eventos relevantes (preço, desconto, transição de estado, aprovação, alteração de bloco jurídico, envio) entram em `audit_log` com cadeia de hashes.
- Exportação diária do `audit_log` para Amazon S3 com Object Lock em modo compliance (WORM), para que nem um administrador de base de dados o possa reescrever.
- Job noturno verifica a integridade da cadeia e alerta em caso de quebra.
- **RGPD**: dados de contacto minimizados, prazos de retenção por tipo de dado, base legal documentada para acompanhamento de abertura, e exportação/eliminação por titular a partir do módulo de clientes (respeitando obrigações legais de conservação de propostas aceites).

### Observabilidade e entrega

- OpenTelemetry em frontend, API e worker, com envio para Amazon CloudWatch através do OpenTelemetry Collector; um ID de correlação acompanha cada pedido até ao job Graph que dele resulta.
- Painéis e alertas: latência p95, erros 5xx, profundidade das filas, jobs `FAILED`, respostas `429` do Graph, expiração de subscrições.
- Ambientes: desenvolvimento, teste/QA e produção, cada um com o seu site SharePoint e registo de aplicação Entra.
- CI/CD com testes unitários (motor de preços com casos de referência), testes de contrato à API, testes end-to-end (Playwright) e migrações de base de dados aplicadas automaticamente com *rollback* testado.

## Roadmap e riscos

A ordem proposta entrega primeiro o núcleo que dá valor sozinho (cotar com preços corretos) e deixa as integrações mais arriscadas para quando a base estiver estável. Cada fase termina com um critério de saída verificável.

1. **Fundações** — repositório monorepo (frontend, API, worker, `@cpq/rules-engine`), Entra ID, MariaDB com migrações, servidor Ubuntu na AWS criado por código, CI/CD, observabilidade, ambientes.
   - Saída: utilizador autentica-se e vê o catálogo em QA, com traces ponta-a-ponta.
2. **CPQ** — catálogo, listas de preços, regras, motor de preços, versões e snapshots.
   - Saída: 50 cotações de referência calculadas pelo motor coincidem ao cêntimo com o cálculo da área financeira.
3. **Proposal Engine + SharePoint** — biblioteca de conteúdos, editor colaborativo, compilação DOCX/PDF, outbox e worker Graph.
   - Saída: proposta completa gerada e guardada no SharePoint com `Sites.Selected`, sem permissões tenant-wide.
4. **Workflow e governança** — máquina de estados, políticas de aprovação, Teams, auditoria encadeada.
   - Saída: nenhum documento pode ser enviado se o hash não corresponder ao aprovado (teste automatizado).
5. **Assinatura e integrações** — fornecedor de assinatura, integração com o CRM interno, acompanhamento de abertura.
   - Saída: proposta assinada muda para `ACCEPTED` sem intervenção manual.

### Riscos principais

| Risco | Probabilidade | Impacto | Mitigação |
| --- | --- | --- | --- |
| Conversão HTML do editor → DOCX perde formatação | Alta | Médio | Limitar o editor a um subconjunto de formatação suportado; testes visuais com documentos de referência na fase 3 |
| Servidor único na AWS como ponto único de falha | Média | Alto | Backups contínuos para S3, recuperação automática do EC2, restauro testado; migrar a BD para RDS se a exigência crescer |
| Equipa de segurança não aprova permissões Graph | Média | Alto | `Sites.Selected` desde o início e pedido de aprovação na fase 1 |
| Regras de preço do negócio mais complexas do que o modelo prevê | Média | Alto | Workshop com financeiro antes da fase 2; condições JSONLogic dão margem de extensão |
| Edições no Word Online divergem da cotação | Média | Alto | Deteção via delta query + bloqueio de envio por hash |
| *Throttling* do Graph em picos de geração | Baixa | Médio | Filas com concorrência limitada, `Retry-After`, batching |

### Questões em aberto

- [ ] Que API ou eventos o CRM interno vai expor, e qual dos dois sistemas é dono dos dados de cliente?
- [ ] Há necessidade de multi-empresa (várias entidades legais a emitir propostas)?
- [ ] Que limites de desconto e margem disparam cada nível de aprovação?
- [ ] As propostas precisam de assinatura qualificada (QES) ou basta assinatura avançada?
- [ ] Em que línguas são emitidas as propostas?

### Fontes

- [Amazon RDS for MariaDB passa a suportar a 12.3 (AWS)](https://www.amazonaws.cn/en/new/2026/amazon-rds-for-mariadb-12-3/)
- [MariaDB 10.6 EOL e ciclo de LTS atual (mariadb.org)](https://mariadb.org/mariadb-server-10-6-reaches-end-of-life-on-july-6th/)
- [Calendário de versões LTS da MariaDB (mariadb.com)](https://mariadb.com/?p=40845)
- [Sites.Selected — estado GA e uso (Microsoft 365 Developer Blog)](https://devblogs.microsoft.com/microsoft365dev/?p=11229)
