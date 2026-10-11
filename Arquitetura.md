# Arquitetura CPQ & Proposal Management

9 de outubro de 2026 · @Miguel

## Sumário executivo

Este documento define a arquitetura da plataforma de CPQ (configurar, preçar, cotar) e gestão de propostas: stack, modelo de dados, repositório de documentos, segurança e operação. Todas as escolhas tecnológicas estão decididas, e o sistema garante que o documento enviado ao cliente corresponde à cotação aprovada.

Decisões principais:

1. **Stack decidida**: TypeScript ponta-a-ponta (React + NestJS), com o motor de regras e preços CPQ num pacote partilhado que corre no browser (resposta imediata) e no servidor (fonte de verdade).
2. **Monólito modular + worker assíncrono**: a geração de DOCX/PDF, as notificações e a auditoria passam para filas (BullMQ/Redis) com padrão *outbox*, eliminando inconsistências entre a base de dados e os ficheiros.
3. **Snapshots imutáveis**: cada versão de cotação é congelada com hash; a aprovação fica ligada a esse hash e ao hash do documento gerado. Qualquer alteração posterior invalida a aprovação.
4. **Modelo de dados completo**: clientes, utilizadores, listas de preços, custos, impostos, políticas de aprovação, versões de conteúdo, documentos e auditoria encadeada.
5. **Repositório de documentos numa pasta local do servidor**, com a estrutura `Clientes/{cliente}/{proposta}/{01_Trabalho,02_Enviado,03_Assinado}`; o acesso passa sempre pela aplicação.
6. **Segurança de menor privilégio**: autenticação local (email e palavra-passe, com bloqueio por tentativas e sessões revogáveis), papéis complementados com regras por registo (dono, equipa, região), custos e margens visíveis só a quem tem permissão, segredos fora do repositório.
7. **Um único servidor Ubuntu** com a aplicação, a MariaDB 12.3 e o Redis, com cópias de segurança contínuas para um disco ou servidor separado e um procedimento de restauro testado.
8. **Aceitação pelo cliente por portal com ligação segura** (assinatura eletrónica simples, com comprovativo), sem fornecedores externos de assinatura.

## Visão geral e decisões arquiteturais

O sistema tem duas vertentes — **Motor CPQ** e **Proposal Content Engine** — e uma terceira transversal: **Governança** (aprovações, auditoria, integridade documental). O princípio orientador é simples: a MariaDB é a fonte de verdade para dados estruturados; a pasta de documentos é a fonte de verdade para ficheiros; nada passa entre os dois sem um evento registado.

| ADR | Decisão | Escolha | Alternativa rejeitada | Porquê |
| --- | --- | --- | --- | --- |
| 01 | Linguagem do backend | Node.js + NestJS (TypeScript) | C# .NET 8 | Mesmo código de regras e tipos no browser e no servidor; uma só linguagem para a equipa |
| 02 | Estilo de arquitetura | Monólito modular + worker separado | Microserviços | Domínio coeso, equipa pequena; módulos com fronteiras claras permitem extrair serviços mais tarde |
| 03 | Estilo de API | REST + OpenAPI (3.0 exportado pelo NestJS), cliente TS gerado | GraphQL | Caching HTTP, autorização por endpoint e auditoria mais simples; o frontend recebe tipos gerados |
| 04 | ORM | Prisma como cliente tipado; migrações SQL manuais com executor próprio | TypeORM | Tipagem mais forte; triggers, colunas geradas e `UUID` nativo não se exprimem em Prisma |
| 05 | Base de dados | MariaDB 12.3 LTS instalada no servidor Ubuntu, em disco próprio, com mariabackup e binlogs copiados para um destino separado | Base de dados gerida externa | Um só servidor reduz custo e peças a gerir. A contrapartida é a equipa assumir backups, upgrades e monitorização da BD |
| 06 | Identidade | Autenticação local: utilizadores, papéis e palavras-passe (scrypt) geridos pela própria aplicação; token JWT próprio (HS256) com versão de sessão | Provedor de identidade externo (Entra ID, IdentityServer) | Sem dependências externas; o administrador gere utilizadores e papéis na aplicação; a versão de sessão permite revogar tokens de imediato |
| 07 | Editor de texto | TipTap, com bloqueio otimista por secção | Edição simultânea em tempo real (Yjs) | Redação por uma pessoa de cada vez é o caso comum; o conflito é detetado e comunicado, sem infraestrutura de tempo real |
| 08 | Motor de documentos | Docxtemplater (núcleo) + modelo base `.docx` + conversão própria de HTML para OOXML; PDF gerado pela aplicação (pdfkit) | OpenXML SDK; módulo HTML pago | Coerente com ADR-01; sem licenças adicionais. O PDF não tem a fidelidade de uma conversão pelo Word |
| 09 | Processamento assíncrono | BullMQ sobre Redis + tabela *outbox* | Chamadas síncronas | Retries, idempotência, isolamento do pedido HTTP |
| 10 | Regras CPQ | Pacote `@cpq/rules-engine` em TS puro, sem I/O | Regras só no frontend ou só no backend | Validação instantânea na UI, mas o servidor revalida sempre antes de gravar |
| 11 | Repositório de documentos | Pasta local do servidor, atrás da interface `DocumentRepository` | Serviço de ficheiros externo | Simples, rápido e fácil de copiar; a interface permite trocar o repositório mais tarde |
| 12 | Aceitação do cliente | Portal com ligação segura e comprovativo (assinatura eletrónica simples) | Fornecedores de assinatura externos | Sem dependências externas nem custos por envelope; a prova é o hash do documento, a identificação do signatário, a data e o IP |

## Arquitetura tecnológica

A estrutura assenta na separação entre o caminho síncrono (utilizador → API → MariaDB) e o caminho assíncrono (outbox → fila → worker → ficheiros e notificações). O utilizador nunca espera pela geração de um documento.

**Caminho síncrono**: Browser → Nginx (TLS) → API NestJS (REST) → MariaDB.

**Caminho assíncrono**: a API grava a alteração de negócio e o registo em `outbox_events` na mesma transação → o *relay* do worker publica o evento no BullMQ (Redis) → os processadores do worker geram documentos, enviam notificações e acrescentam a auditoria.

**Acesso do cliente**: o portal de aceitação é servido pela mesma API, em rotas públicas `/portal/*` protegidas por um token aleatório de uso limitado (ver «Aceitação pelo cliente»).

| Camada | Tecnologia | Responsabilidade |
| --- | --- | --- |
| Frontend | React 18+, TypeScript, Vite, TailwindCSS, TanStack Query, Zustand, TipTap | UI, validação local de regras e preços, edição de secções |
| API | NestJS, Prisma, CASL, OpenAPI | Regras de negócio, autorização, transações, outbox |
| Worker | NestJS + BullMQ | Documentos, notificações, auditoria encadeada, SLA e expiração, exportações |
| Dados | MariaDB 12.3 LTS (InnoDB) e Redis, no mesmo servidor | Fonte de verdade estruturada; cache e filas |
| Ficheiros | Pasta local do servidor (`DOCUMENT_STORAGE_DIR`) | Documentos de proposta e comprovativos; cópia da auditoria |
| Plataforma | Nginx, Docker Compose, systemd, OpenTelemetry Collector | Entrada TLS, processos, observabilidade |

### Implantação em produção

Toda a plataforma corre num único servidor Ubuntu Server LTS: aplicação, MariaDB e Redis. É a opção mais simples e barata; o preço é que o servidor é um ponto único de falha, por isso a arquitetura compensa com cópias de segurança contínuas para fora do servidor, reinício automático dos serviços e um procedimento de restauro testado.

| Componente | Onde corre | Notas |
| --- | --- | --- |
| Entrada HTTPS | Nginx no servidor, com **certificado TLS autoassinado** (ECDSA P-256, SAN com os nomes DNS e IP do servidor), gerado pelo Ansible | Redireciona HTTP para HTTPS, HSTS, TLS 1.2/1.3, limites de pedidos por IP (`limit_req`, mais apertado no portal); só as portas 22, 80 e 443 ficam abertas. O browser avisa que o certificado não é de confiança até ser instalado ou confirmado pela impressão digital (ver «Certificado do portal») |
| API, Worker, Web | Contentores Docker Compose atrás do Nginx | Processos separados, com limites de memória e CPU por contentor e `restart: unless-stopped` |
| MariaDB 12.3 LTS | Servidor Ubuntu, pacote oficial, disco dedicado cifrado (LUKS) | Só aceita ligações locais; memória do *buffer pool* reservada para não competir com a aplicação |
| Redis | Servidor Ubuntu, contentor com persistência AOF | Guarda as filas do worker, por isso a persistência é obrigatória |
| Repositório de documentos | Pasta `DOCUMENT_STORAGE_DIR` num disco dedicado, fora da raiz do Nginx | Nunca é servida diretamente: a API verifica a permissão a cada descarga |
| Backups | mariabackup diário completo + binlogs copiados a cada 5 minutos; cópia incremental dos documentos (restic ou rsync) | Para um disco ou servidor separado (NFS ou SSH); retenção de 35 dias; restauro testado trimestralmente |
| Recuperação | `systemd` reinicia os serviços; em perda do servidor, reconstrução por Ansible e restauro das cópias | RTO de 4 h |
| Segredos | Ficheiros `/etc/cpq/*.env` com dono `root` e permissão `0640`, criados pelo Ansible (cofre `ansible-vault`) | Nunca no repositório; a chave de encriptação da MariaDB fica num ficheiro cifrado cuja palavra-passe só `root` lê |
| Cópia da auditoria | Exportação do `audit_log` de 6 em 6 horas (ficheiros diários, idempotentes) para `AUDIT_EXPORT_DIR`, com verificação da cadeia de hashes ao mesmo ritmo; ficheiros só de leitura, replicados para o destino de backup | A cadeia de hashes deteta alterações; a cópia fora do servidor impede reescrever a história |
| Logs e métricas | OpenTelemetry Collector → ficheiros locais e Prometheus/Grafana (opcional) | Alarmes por email para disco, memória, filas, erros 5xx e falhas de backup |
| Infraestrutura | Ansible | Servidor reconstruível a partir de código em caso de perda total |

A identidade é local (sem serviços externos). As notificações saem por email (SMTP) e, opcionalmente, para um canal do Teams através de um *webhook* de entrada, que não precisa de registo de aplicações.

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
- **Edição**: TipTap, limitado ao subconjunto de formatação que o documento suporta; cada secção tem `row_version` (bloqueio otimista): quem grava com uma versão antiga recebe um aviso de conflito e recarrega.
- **Compilação** (job assíncrono): montar secções → sanitizar o HTML e resolver as *merge tags* → preencher o modelo base `.docx` com Docxtemplater (o corpo entra em OOXML gerado pela aplicação) → gerar o PDF → gravar ambos em `01_Trabalho` → calcular o SHA-256 → registar em `documents`, com a impressão digital dos dados da cotação usados.

### Documentos (repositório local)

- **Estrutura**: pasta `Clientes/{codigo_cliente}/{codigo_proposta}/` com subpastas `01_Trabalho`, `02_Enviado` e `03_Assinado`. Os nomes são normalizados (sem acentos, separadores nem pontos iniciais) e a aplicação recusa qualquer caminho fora da raiz.
- **Imutabilidade**: um ficheiro nunca é sobrescrito. Cada geração cria ficheiros novos (`{proposta}_v{versão}_{data}_{id}.docx|pdf`) e o histórico fica na pasta e na tabela `documents`.
- **Permissões**: a pasta não é servida diretamente. Quem descarrega passa pela API, que verifica a permissão sobre a proposta. O sistema operativo só permite o acesso ao utilizador do serviço.
- **Identificadores**: a base de dados guarda a `storage_key` (caminho relativo) e o `sha256`; o ficheiro em disco é sempre confrontado com o hash registado.
- **Edições manuais** (fonte de verdade): os dados comerciais vivem no CPQ; o texto final pode ser afinado fora da aplicação (descarregar, editar no Word, carregar de volta). O carregamento fica registado como `MANUALLY_EDITED`, com ligação ao documento de origem. Uma verificação periódica compara o hash em disco com o registado e assinala também alterações feitas diretamente na pasta. Regenerar cria sempre ficheiros novos, sem apagar os anteriores.
- **Envio**: ao enviar, o PDF e o DOCX aprovados são copiados para `02_Enviado` e é essa cópia que o cliente recebe pelo portal.

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
| `APPROVED` | `SENT` | Enviar (comercial) | `snapshot_hash` e `sha256` do documento iguais aos aprovados; proposta dentro da validade | Copia o PDF e o DOCX para `02_Enviado` e cria a ligação do portal de aceitação |
| `APPROVED` | `DRAFT` | Editar (comercial) | Confirmação explícita | A aprovação deixa de valer; nova versão de cotação |
| `SENT` | `ACCEPTED` ou `REJECTED` | Resposta do cliente no portal, ou registo manual com evidência (comercial) | — | Comprovativo de aceitação em `03_Assinado` |
| `SENT` | `EXPIRED` | Job diário | `valid_until` ultrapassada | Notifica o comercial |
| `SENT` | `DRAFT` | Rever após envio (comercial) | Confirmação explícita | Revoga a ligação do portal; a versão enviada passa a `SUPERSEDED`; nova versão de cotação |
| `EXPIRED` | `DRAFT` | Reabrir (comercial) | Nova data de validade | Nova versão de cotação |
| `DRAFT`, `IN_REVIEW`, `PENDING_APPROVAL`, `APPROVED`, `SENT` | `CANCELLED` | Cancelar (dono ou gestor) | Motivo obrigatório | Cancela pedidos abertos e revoga a ligação do portal |

Cada retorno a `DRAFT` a partir de uma versão `LOCKED` cria uma nova versão de cotação; a versão anterior e as aprovações que recebeu ficam no histórico.

- **Políticas de aprovação** configuráveis: condição (ex.: desconto > 15 % ou margem < 25 % ou total > 100 000 €), níveis, modo sequencial ou paralelo, SLA por nível com escalonamento, e delegação durante ausências. Os valores do exemplo são ilustrativos e devem ser definidos pela direção financeira.
- **Ligação ao snapshot**: cada decisão regista o `snapshot_hash` da cotação e o hash do documento aprovado. Antes de enviar ao cliente, o sistema verifica que ambos coincidem com o que vai sair; se não coincidirem, o envio é bloqueado.
- **Âmbito do pedido**: `approval_requests.scope` é `COMMERCIAL` (desconto, margem, valor) ou `LEGAL` (secções jurídicas modificadas). Ambos referenciam a versão de cotação e o documento compilado, e guardam o `snapshot_hash` e o `sha256` do documento no momento do pedido. O envio exige todos os pedidos que as políticas determinam em `APPROVED`, com hashes iguais aos atuais.
- **Notificações**: email (SMTP) e, opcionalmente, mensagem num canal do Teams por *webhook* de entrada. As mensagens trazem uma ligação direta para a página de decisão da aplicação (autenticação MSAL), onde o aprovador decide com o seu próprio token, nunca com uma conta de serviço. Os destinatários são os utilizadores cujo papel (último conhecido, guardado em `users.roles_json`) coincide com o nível pendente.

### Aceitação pelo cliente e acompanhamento

#### Certificado do portal

O portal é servido por HTTPS com um **certificado autoassinado**, gerado uma só vez pelo Ansible (`scripts/tls/selfsigned.sh` faz o mesmo à mão). É um certificado de servidor (`serverAuth`), ECDSA P-256, válido por 825 dias, com os nomes DNS e IP do servidor no *Subject Alternative Name*.

- **O que garante**: a ligação é cifrada e o servidor prova que detém a chave do certificado; o `snapshot_hash` e o hash do documento continuam a ser a prova do conteúdo.
- **O que não garante**: como não há uma autoridade de certificação conhecida, o browser do cliente mostra um aviso na primeira visita. Para o cliente poder confirmar que está no servidor certo, a aplicação lê o certificado (`TLS_CERT_FILE`) e inclui a **impressão digital SHA-256** na mensagem que envia com a ligação e na página do portal; o cliente compara-a com a que o browser mostra ao inspecionar o certificado. Quem preferir pode instalar o `portal.crt` como certificado de confiança.
- **Renovação**: antes de expirar, apagam-se `portal.crt` e `portal.key` e volta-se a correr o playbook; a impressão digital muda e tem de ser comunicada de novo. Um alarme avisa 30 dias antes.

- **Portal de aceitação**: ao enviar, a aplicação gera uma ligação com um token aleatório (256 bits). Só o *hash* do token fica na base de dados (`share_links`), com validade e possibilidade de revogação. O cliente abre a ligação, vê o PDF aprovado e aceita ou recusa, indicando nome e email e confirmando que leu o documento. Não requer conta nem instalação.
- **Assinatura eletrónica simples**: a prova de aceitação é o conjunto *hash do documento + nome e email do signatário + data + endereço IP + agente de utilizador*, guardado em `customer_responses` e na auditoria. A aplicação gera um comprovativo em PDF, guardado em `03_Assinado`. É uma assinatura eletrónica simples, adequada à aceitação comercial de uma proposta.
- **Acompanhamento de abertura**: cada abertura da ligação regista data, contagem e primeira abertura em `share_links`, e um evento de auditoria. Não se usam píxeis de rastreio em email, por questões de RGPD.
- **Efeito no estado**: a aceitação move a proposta para `ACCEPTED` e a recusa para `REJECTED`; a ligação deixa de aceitar respostas.

## Modelo de dados (MariaDB)

O modelo tem mais de 30 tabelas, todas com FKs reais. Convenções: chaves `UUID` nativas (MariaDB 10.7+) com valores UUIDv7 gerados na aplicação, para índices ordenados no tempo; datas em `DATETIME(6)` UTC (ligações com `time_zone='+00:00'` e valores por omissão `CURRENT_TIMESTAMP(6)`, porque `ON UPDATE` só aceita essa família de funções); valores monetários `DECIMAL(15,4)` em cálculo e `DECIMAL(15,2)` em totais; *soft delete* com `deleted_at`; bloqueio otimista com `row_version`. A base de dados é criada com `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` e InnoDB por omissão. Na fase 1, um teste de inserção ordenada confirma que o tipo `UUID` mantém a ordem temporal dos UUIDv7; se não mantiver, usa-se `BINARY(16)`.

| Domínio | Tabela | Propósito | Relações principais |
| --- | --- | --- | --- |
| Identidade | `users` | Utilizadores locais: email único, palavra-passe (hash), papéis, equipa, região, bloqueio e versão de sessão | — |
| Identidade | `teams` | Equipas comerciais para regras de visibilidade | 1:N `users` |
| Clientes | `clients` | Cliente com NIF/VAT, país, tier, ID externo do CRM | 1:N `proposals` |
| Catálogo | `products` | Produto/serviço, unidade, custo, modelo de cobrança | 1:N `product_attributes` |
| Catálogo | `product_attributes` | Atributos configuráveis tipados | N:1 `products` |
| Catálogo | `price_lists` / `price_list_items` | Preços por moeda, região, canal, tier, vigência | N:1 `products` |
| Catálogo | `product_bundle_items` | Componentes de *bundles* (obrigatório/opcional, quantidades) | N:1 `products` (pai e componente) |
| Catálogo | `tax_rates` | IVA por país, categoria fiscal e regime | — |
| Catálogo | `fx_rates` | Taxas de câmbio diárias com fonte | — |
| Catálogo | `cpq_rules` | Regras com condição JSONLogic | N:1 `products` (origem e alvo) |
| Propostas | `proposals` | Cabeçalho, estado, validade, idioma, pasta no repositório | N:1 `clients`, `users` |
| Propostas | `quote_versions` | Versões com snapshot e hash | N:1 `proposals` |
| Propostas | `quote_items` | Linhas com preços e custos congelados | N:1 `quote_versions`, `products` |
| Conteúdo | `content_blocks` / `content_block_versions` | Biblioteca versionada | 1:N versões |
| Conteúdo | `tags` / `content_block_tags` | Categorização N:N | — |
| Conteúdo | `proposal_sections` | Ordem das secções, versão de bloco usada, alterações | N:1 `proposals`, `content_block_versions` |
| Conteúdo | `section_documents` | HTML de cada secção | 1:1 `proposal_sections` |
| Documentos | `documents` | DOCX/PDF gerados, `driveItem.id`, `eTag`, hash, origem | N:1 `proposals`, `quote_versions` |
| Integrações | `api_keys` | Chaves de API (só o hash), âmbitos, último uso e revogação | — |
| Documentos | `share_links` | Ligações do portal de aceitação (só o hash do token), validade e aberturas | N:1 `proposals`, `documents` |
| Documentos | `customer_responses` | Aceitação ou recusa do cliente, com a prova | N:1 `share_links` |
| Governança | `approval_policies` | Condições, níveis, modo, SLA | — |
| Governança | `approval_requests` / `approval_decisions` | Pedido por versão e âmbito (comercial ou jurídico), decisão por aprovador | N:1 `quote_versions`, `documents`, `approval_policies` |
| Governança | `audit_log` | Registo append-only com cadeia de hashes | — |
| Infraestrutura | `outbox_events` | Eventos a processar pelo worker | — |

**Resultado do teste da tarefa 1.2 (MariaDB 12.3.3):** o tipo nativo `UUID` mantém a ordem temporal dos UUIDv7, o Prisma lê e escreve-o sem perdas (declarado como `CHAR(36)` no schema) e `ON UPDATE CURRENT_TIMESTAMP(6)` funciona. Mantém-se `UUID`; `BINARY(16)` não é necessário. As migrações são SQL manual, aplicadas por um executor próprio (`db/src/migrate.ts`), e o `schema.prisma` é mantido em sincronia à mão. O OpenAPI exportado pelo NestJS é 3.0 (não 3.1): o cliente TypeScript é gerado a partir dele sem diferenças práticas.

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
    contact_name  VARCHAR(255),                     -- contacto para enviar a proposta (dado pessoal: o mínimo)
    contact_email VARCHAR(255),
    crm_synced_at DATETIME(6),
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
    email         VARCHAR(255) NOT NULL UNIQUE,
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
    folder_path    VARCHAR(500),
    sent_at        DATETIME(6),
    status_reason  VARCHAR(500),
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
    id                UUID PRIMARY KEY,
    proposal_id       UUID NOT NULL,
    quote_version_id  UUID,
    kind              ENUM('DOCX','PDF','SIGNED_PDF','ATTACHMENT') NOT NULL,
    origin            ENUM('GENERATED','MANUALLY_EDITED','UPLOADED') NOT NULL,
    folder            ENUM('01_Trabalho','02_Enviado','03_Assinado') NOT NULL,
    file_name         VARCHAR(255) NOT NULL,
    storage_key       VARCHAR(500) NOT NULL UNIQUE,   -- caminho relativo à raiz do repositório
    sha256            CHAR(64)     NOT NULL,
    size_bytes        BIGINT       NOT NULL,
    generated_from    UUID,
    source_fingerprint CHAR(64),                      -- impressão digital da cotação usada no documento
    created_by        UUID,
    created_at        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY ix_doc_proposal (proposal_id, created_at),
    FOREIGN KEY (proposal_id)      REFERENCES proposals(id),
    FOREIGN KEY (quote_version_id) REFERENCES quote_versions(id),
    FOREIGN KEY (generated_from)   REFERENCES documents(id),
    FOREIGN KEY (created_by)       REFERENCES users(id)
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
    ydoc_state LONGBLOB NOT NULL,                -- reservado (edição em tempo real); hoje vazio
    html_cache MEDIUMTEXT,                       -- HTML derivado, usado na compilação
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (section_id) REFERENCES proposal_sections(id) ON DELETE CASCADE
);

CREATE TABLE share_links (
    id               UUID PRIMARY KEY,
    proposal_id      UUID NOT NULL,
    document_id      UUID NOT NULL,                   -- o PDF enviado, em 02_Enviado
    token_hash       CHAR(64) NOT NULL UNIQUE,        -- SHA-256 do token; o token só existe no URL entregue ao cliente
    expires_at       DATETIME(6) NOT NULL,
    revoked_at       DATETIME(6),
    first_opened_at  DATETIME(6),
    last_opened_at   DATETIME(6),
    open_count       INT NOT NULL DEFAULT 0,
    created_by       UUID NOT NULL,
    created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    FOREIGN KEY (proposal_id) REFERENCES proposals(id),
    FOREIGN KEY (document_id) REFERENCES documents(id),
    FOREIGN KEY (created_by)  REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_responses (
    id              UUID PRIMARY KEY,
    share_link_id   UUID NOT NULL UNIQUE,             -- uma só resposta por ligação
    proposal_id     UUID NOT NULL,
    decision        ENUM('ACCEPTED','DECLINED') NOT NULL,
    signer_name     VARCHAR(255) NOT NULL,
    signer_email    VARCHAR(255) NOT NULL,
    comment         TEXT,
    document_sha256 CHAR(64) NOT NULL,
    ip_address      VARCHAR(45),
    user_agent      VARCHAR(500),
    decided_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    FOREIGN KEY (share_link_id) REFERENCES share_links(id),
    FOREIGN KEY (proposal_id)   REFERENCES proposals(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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

## Repositório de documentos e processamento assíncrono

Toda a escrita de ficheiros e todas as notificações são feitas pelo worker, a partir de eventos gravados em `outbox_events` na mesma transação da alteração de negócio. Se o disco estiver cheio ou o SMTP indisponível, a proposta fica gravada e o trabalho repete-se.

### Interface do repositório

| Operação | Comportamento |
| --- | --- |
| `put` | Cria o ficheiro em `Clientes/{cliente}/{proposta}/{pasta}/{nome}` com abertura exclusiva: nunca sobrescreve; sincroniza em disco antes de devolver o SHA-256 e o tamanho |
| `get` | Lê pela `storage_key`; recusa caminhos fora da raiz |
| `copyTo` | Copia para outra pasta da mesma proposta (ex.: `01_Trabalho` → `02_Enviado`), também sem sobrescrever |
| `currentHash` | SHA-256 do ficheiro tal como está em disco agora, ou nulo se desapareceu |

### Resiliência

- Todas as operações assíncronas são jobs disparados por `outbox_events`, gravados na mesma transação que a alteração de negócio. Se uma geração falhar, a proposta fica gravada e o job tenta de novo; a mensagem do último erro guarda-se em `outbox_events.last_error` e a UI mostra-a.
- **Relay do outbox**: um processo do worker consulta `outbox_events` a cada segundo (`status = 'PENDING' AND next_attempt_at <= CURRENT_TIMESTAMP(6)`, `ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED`), marca `PROCESSING` e cria o job no BullMQ com `jobId` igual ao ID do evento, o que o torna idempotente. Ao terminar, o processador marca `DONE`; em falha, incrementa `attempts` e fixa `next_attempt_at` com *backoff* exponencial e *jitter*, passando a `FAILED` após o limite, com alerta. Eventos em `PROCESSING` há mais de 10 minutos voltam a `PENDING`.
- Os eventos `audit.record` seguem para uma fila própria com concorrência 1, que serializa a cadeia de hashes.
- O acesso aos ficheiros fica atrás da interface `DocumentRepository`, para testes e para uma eventual troca de repositório.

## Requisitos não-funcionais, segurança e operação

As metas abaixo são propostas de partida, a validar com o negócio; cada uma é mensurável.

### Desempenho e disponibilidade

| Requisito | Meta proposta | Como se garante |
| --- | --- | --- |
| Validação de regras na UI | p95 < 50 ms para cotações até 200 linhas | Motor de regras local no browser, catálogo em cache |
| Recalcular e gravar cotação (servidor) | p95 < 500 ms para 200 linhas | Catálogo e listas de preços em cache com invalidação ao alterar |
| Geração DOCX + PDF | p95 < 60 s, assíncrona com progresso na UI | Worker com filas; a UI consulta o estado do pedido |
| Disponibilidade | 99,5 % em horário de expediente | Reinício automático dos serviços, *health checks* e alarmes; servidor único |
| RPO / RTO | 15 min / 4 h | mariabackup diário + binlogs copiados a cada 5 min, permitindo *point-in-time recovery*; teste de restauro trimestral |

### Segurança

- **Identidade**: autenticação local por email e palavra-passe. Palavras-passe com *hash* scrypt e sal, política mínima (10 caracteres, três tipos, sem o email), comparação em tempo constante e o mesmo tempo de resposta para utilizadores inexistentes. Cinco falhas bloqueiam a conta 15 minutos; limite de pedidos de login por IP. Token de sessão JWT (HS256, segredo do servidor, validade de 8 h) com versão de sessão: mudar a palavra-passe, os papéis ou desativar o utilizador termina de imediato as sessões abertas. Papéis (`Comercial`, `Gestor_Comercial`, `Aprovador_Financeiro`, `Juridico`, `Administrador`) atribuídos pelo administrador, que também cria utilizadores com palavra-passe temporária de mudança obrigatória. O sistema nunca fica sem administradores ativos.
- **Autorização por registo**: além do papel, regras de visibilidade — o comercial vê as suas propostas, o gestor vê as da equipa, o aprovador vê as que lhe estão atribuídas. Implementado com CASL num *guard* NestJS, aplicado também aos filtros de consulta. Custos e margens só são visíveis a quem tem permissão.
- **Segredos**: ficheiros de ambiente com permissões restritas, geridos pelo Ansible (`ansible-vault`); nada no repositório.
- **Transporte**: TLS 1.2 no mínimo, 1.3 preferido; HSTS; certificado autoassinado (ver «Certificado do portal»); limites de pedidos no Nginx e na API.
- **Repouso**: disco de dados cifrado (LUKS) e encriptação InnoDB de tabelas, *redo* e *binlogs* com o plugin `file_key_management`; o ficheiro de chaves é cifrado e a sua palavra-passe só `root` lê. As cópias de segurança herdam a cifra (mariabackup lê tabelas já cifradas; o destino também é cifrado).
- **Portal do cliente**: token aleatório de 256 bits (só o hash fica guardado), validade, revogação, limite de tentativas por IP e resposta única por ligação.
- **Aplicação**: validação de entrada com DTOs, sanitização do HTML do editor antes de entrar no DOCX, CSP rigorosa, proteção contra *mass assignment*, *rate limiting* por utilizador.
- **Cadeia de fornecimento**: análise de dependências e SAST no CI.

### Integração com o CRM

O CRM interno liga-se por **API com chave** (`X-Api-Key`), sem sessão de utilizador. As chaves são criadas pelo administrador (a chave completa só se mostra uma vez; fica o hash), têm âmbitos (`clients:write`, `proposals:read`), registam o último uso e revogam-se de imediato.

- **O CRM envia clientes**: `POST /api/v1/integrations/crm/clients` com até 500 clientes por pedido. Cria ou atualiza por `externalId` (guardado em `crm_external_id`), liga a clientes já existentes pelo código, elimina logicamente os marcados `deleted` e devolve os erros linha a linha. Só se alteram os campos enviados: omitir um campo não o apaga.
- **O CRM lê propostas**: `GET /api/v1/integrations/crm/proposals?since=` devolve as propostas alteradas desde um instante, com estado, valores e `clientExternalId`, paginadas pelo `nextSince`.
- A fonte de verdade dos dados do cliente passa a ser o CRM, quando integrado; o formulário da aplicação continua a servir para clientes ainda sem registo no CRM.

### Auditoria e conformidade

- Todos os eventos relevantes (preço, desconto, transição de estado, aprovação, alteração de bloco jurídico, envio, resposta do cliente) entram em `audit_log` com cadeia de hashes, imutável também por *triggers* na base de dados.
- Exportação do `audit_log` de 6 em 6 horas para ficheiros diários só de leitura (`AUDIT_EXPORT_DIR`), com verificação da cadeia ao mesmo ritmo e alerta se quebrar, replicados para o destino de backup, para que nem um administrador de base de dados reescreva a história sem deixar rasto.
- Job noturno verifica a integridade da cadeia e alerta em caso de quebra.
- **RGPD**:
  - *Minimização*: guardam-se do cliente só o nome e o email de contacto necessários para enviar a proposta, e da resposta no portal o nome, o email, o IP e o agente de utilizador (a prova da aceitação).
  - *Base legal*: execução de diligências pré-contratuais (envio e resposta à proposta) e interesse legítimo (segurança e prova da aceitação).
  - *Retenção*: o IP e o agente de utilizador das respostas apagam-se ao fim de 365 dias; ligações expiradas e sem resposta apagam-se ao fim de 180 dias (configuráveis). A decisão, o nome, o email e os hashes mantêm-se, porque a lei manda conservar a prova de um contrato.
  - *Direitos do titular*: o administrador exporta (JSON) e anonimiza os dados de um titular por email. A anonimização é irreversível e substitui nome, email, IP e comentário por valores neutros, mantendo a decisão e os hashes.
  - *Auditoria sem dados pessoais*: a cadeia de auditoria é imutável, por isso não guarda nomes nem emails de clientes (só identificadores e hashes); as tentativas de login falhadas guardam apenas uma impressão do email e o IP.

### Observabilidade e entrega

- OpenTelemetry em frontend, API e worker, com envio para o OpenTelemetry Collector local; um ID de correlação acompanha cada pedido até ao job que dele resulta.
- Painéis e alertas: latência p95, erros 5xx, profundidade das filas, jobs `FAILED`, espaço em disco, falhas de backup, quebra da cadeia de auditoria.
- Ambientes: desenvolvimento, teste/QA e produção, cada um com a sua base de dados, pasta de documentos e segredo de sessão.
- CI/CD com testes unitários (motor de preços com casos de referência), de integração com MariaDB e Redis, de contrato à API e *end-to-end* (Playwright); migrações aplicadas automaticamente com *rollback* testado.

## Roadmap e riscos

A ordem proposta entrega primeiro o núcleo que dá valor sozinho (cotar com preços corretos) e deixa as partes mais dependentes de terceiros para quando a base estiver estável. Cada fase termina com um critério de saída verificável.

1. **Fundações** — monorepo (frontend, API, worker, `@cpq/rules-engine`), autenticação local, MariaDB com migrações, servidor Ubuntu configurado por Ansible, CI/CD, observabilidade, ambientes.
   - Saída: utilizador autentica-se e vê o catálogo, com traces ponta-a-ponta e um restauro de backup testado.
2. **CPQ** — catálogo, listas de preços, regras, motor de preços, versões e snapshots.
   - Saída: 50 cotações de referência calculadas pelo motor coincidem ao cêntimo com o cálculo da área financeira.
3. **Proposal Engine** — biblioteca de conteúdos, editor, compilação DOCX/PDF, outbox e worker, repositório local.
   - Saída: proposta completa gerada e guardada no repositório, com hashes registados e edições manuais detetadas.
4. **Workflow e governança** — máquina de estados, políticas de aprovação, notificações, auditoria encadeada.
   - Saída: nenhum documento pode ser enviado se o hash não corresponder ao aprovado (teste automatizado).
5. **Aceitação e integrações** — portal de aceitação, acompanhamento de abertura, integração com o CRM interno, RGPD.
   - Saída: proposta aceite pelo cliente no portal muda para `ACCEPTED` sem intervenção manual, com comprovativo.
6. **Endurecimento** — testes de carga, ensaio de restauro, revisão de segurança, migração de dados, formação e manual de operação.
   - Saída: metas de desempenho e disponibilidade medidas; restauro validado.

### Riscos principais

| Risco | Probabilidade | Impacto | Mitigação |
| --- | --- | --- | --- |
| O PDF gerado pela aplicação não reproduz tudo o que o Word faz | Média | Médio | Limitar o editor a um subconjunto de formatação suportado; permitir carregar um PDF/DOCX revisto à mão |
| Servidor único como ponto único de falha | Média | Alto | Backups contínuos para fora do servidor, reinício automático, reconstrução por Ansible, restauro testado |
| Perda do disco de documentos | Baixa | Alto | Cópia incremental frequente para o destino de backup e verificação periódica dos hashes |
| Regras de preço do negócio mais complexas do que o modelo prevê | Média | Alto | Workshop com financeiro antes da fase 2; condições JSONLogic dão margem de extensão |
| Edições fora da aplicação divergem da cotação | Média | Alto | Deteção por hash e bloqueio de envio |
| Aviso de certificado no browser do cliente ao abrir o portal | Alta | Médio | Impressão digital na mensagem e no portal; instruções para confiar no certificado; se o aviso afastar clientes, troca-se por um certificado de uma CA sem alterar a aplicação |
| Certificado autoassinado expira sem ser renovado | Média | Alto | Alarme 30 dias antes e passo no runbook |

### Questões em aberto

- [ ] O CRM interno vai usar as duas interfaces descritas (envio de clientes e leitura de propostas)? E confirma-se que o CRM é o dono dos dados de cliente?
- [ ] Há necessidade de multi-empresa (várias entidades legais a emitir propostas)?
- [ ] Que limites de desconto e margem disparam cada nível de aprovação?
- [ ] Em que línguas são emitidas as propostas?
- [ ] Onde ficam as cópias de segurança (disco externo, outro servidor, partilha de rede)?

### Fontes

- [MariaDB 10.6 EOL e ciclo de LTS atual (mariadb.org)](https://mariadb.org/mariadb-server-10-6-reaches-end-of-life-on-july-6th/)
- [Calendário de versões LTS da MariaDB (mariadb.com)](https://mariadb.com/?p=40845)
