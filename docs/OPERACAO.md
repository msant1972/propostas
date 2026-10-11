# Manual de operação

Runbooks para operar o servidor de propostas (CPQ). Cada comando foi confrontado com o código e os scripts do repositório em 11 de outubro de 2026. Onde o repositório ainda não faz o que a arquitetura descreve, o texto diz-o em caixas **Lacuna** (resumidas no fim, secção 16). O que depende de decisão do negócio está marcado com **[Decisão]**.

Documentos relacionados: [Arquitetura.md](../Arquitetura.md), [Planeamento.md](../Planeamento.md), [infra/RESTORE.md](../infra/RESTORE.md), [IMPLANTACAO.md](IMPLANTACAO.md), [PILOTO.md](PILOTO.md).

## 1. Visão geral da instalação

Um único servidor Ubuntu Server LTS com tudo: Nginx, API, worker, web, Redis (contentores Docker Compose) e MariaDB 12.3 (no anfitrião).

```
 Browser / cliente (portal)
        │ 443 (TLS 1.2/1.3, certificado autoassinado)   80 → redireciona para 443
        ▼
 ┌────────────────────────── Servidor Ubuntu ───────────────────────────┐
 │  Nginx ──/api/v1/portal/*──► API :3000  (limit_req 30/min por IP)     │
 │    │   ──/api/*────────────► API :3000  (limit_req 600/min por IP)    │
 │    └─ /  ──────────────────► web :8081  (127.0.0.1, SPA estática)     │
 │                                                                       │
 │  API ──► MariaDB 127.0.0.1:3306 ◄── Worker (relay outbox + filas)     │
 │                                      │   ▲                            │
 │                          Redis :6379 ◄───┘  (BullMQ: filas events/audit)
 │  Worker ──► DOCUMENT_STORAGE_DIR (/srv/cpq/documents)                 │
 │  Worker ──► AUDIT_EXPORT_DIR     (/srv/cpq/audit)                     │
 │  Worker ──► SMTP (587) / webhook Teams (opcional)                     │
 │                                                                       │
 │  systemd timers ──► cpq-backup-full (03:30 UTC) / cpq-backup-binlogs  │
 │                     (a cada 5 min) ──► $CPQ_BACKUP_TARGET (outro sítio)│
 └───────────────────────────────────────────────────────────────────────┘
```

A API não usa o Redis: grava a alteração e o evento em `outbox_events` na mesma transação; o worker publica os eventos no Redis e processa-os. Se o Redis ou o worker estiverem em baixo, a aplicação continua a gravar, mas nada é gerado nem enviado até voltarem.

### Componentes, portas e processos

| Componente | Onde corre | Porta | Notas |
| --- | --- | --- | --- |
| Nginx | anfitrião (systemd `nginx`) | 80, 443 | Site `/etc/nginx/sites-available/cpq` |
| API (NestJS) | contentor `api`, rede do anfitrião | 3000 | Prefixo `/api/v1`; imagem `cpq/api:<app_image_tag>`; limite 2 GB |
| Worker | contentor `worker` | — | Imagem `cpq/worker:<tag>`; limite 1 GB |
| Web (SPA) | contentor `web` | 127.0.0.1:8081 | Imagem `cpq/web:<tag>` |
| Redis 8 | contentor `redis`, AOF `everysec` | 6379 | Volume Docker `redis-data`; limite 1 GB |
| MariaDB 12.3 | anfitrião (systemd `mariadb`) | 127.0.0.1:3306 | `bind-address = 127.0.0.1` |
| Chaves de encriptação | systemd `mariadb-keys` | — | Decifra `keys.enc` para tmpfs `/run/mariadb-keys` antes da MariaDB |
| Backups | systemd timers `cpq-backup-full.timer`, `cpq-backup-binlogs.timer` | — | Scripts em `/usr/local/sbin/` |

Firewall: o Ansible só acrescenta regras `allow` para 22, 80 e 443 (ver Lacuna L5: confirmar que o `ufw` está ativo).

### Pastas e ficheiros

| Caminho | Conteúdo |
| --- | --- |
| `/opt/cpq/docker-compose.yml` | Composição (gerada pelo Ansible) |
| `/opt/cpq/api.env`, `/opt/cpq/worker.env` | Configuração e segredos (o Ansible aponta para aqui; a arquitetura previa `/etc/cpq/*.env`). Dono `root`, modo `0640` |
| `/etc/cpq/tls/portal.crt`, `portal.key` | Certificado autoassinado (chave modo `0600`) |
| `/etc/nginx/sites-available/cpq` | Configuração do Nginx |
| `/etc/mysql/mariadb.conf.d/90-cpq.cnf` | Configuração da MariaDB |
| `/etc/mysql/encryption/keys.enc`, `keys.pass` | Chave de encriptação cifrada e respetiva palavra-passe (`root:root 0400`) |
| `/var/lib/mysql` | Dados da MariaDB (disco dedicado, XFS; binlogs em `/var/lib/mysql/binlog.*`, retenção local 3 dias) |
| `/srv/cpq/documents` | Repositório de documentos (`Clientes/{cliente}/{proposta}/{01_Trabalho,02_Enviado,03_Assinado}`); nunca sobrescrito |
| `/srv/cpq/audit` | Exportações diárias da auditoria `audit-AAAA-MM-DD.jsonl` + `.sha256` (modo `0440`) |
| `/var/backups/cpq` | Área temporária dos backups completos antes de copiar |
| `/usr/local/sbin/cpq-backup-full`, `cpq-backup-binlogs` | Scripts de backup |

Utilizadores de sistema: o utilizador SSH de administração (`ansible_user`, com `sudo`), `root` (dono dos segredos e dos backups), `mysql` (MariaDB). Os contentores correm com o utilizador definido nas imagens.

O fuso horário do servidor é UTC (o Ansible fixa-o). Todas as horas deste manual são UTC.

## 2. Referência de configuração

A validação é feita ao arrancar (`apps/api/src/config/env.ts`, `apps/worker/src/config.ts`). Uma configuração inválida impede o arranque e o erro aparece nos logs do contentor.

### 2.1 API (`api.env`)

| Variável | Obrigatória | Por omissão | Descrição |
| --- | --- | --- | --- |
| `NODE_ENV` | não | `development` | `development`, `test` ou `production`. Em produção o segredo JWT é obrigatório. O compose já a fixa em `production` |
| `PORT` | não | `3000` | Porta da API (o compose fixa `3000`; o Nginx espera esta) |
| `DATABASE_URL` | **sim** | — | `mysql://utilizador:palavra-passe@127.0.0.1:3306/cpq`. Use palavra-passe só com letras e números (o URL não é «escapado» por todos os componentes) |
| `REDIS_URL` | não | `redis://127.0.0.1:6379` | Validada, mas a API não a usa |
| `WEB_ORIGIN` | não | `http://localhost:5173` | Origem permitida no CORS. Em produção: `https://propostas.exemplo.pt` |
| `AUTH_JWT_SECRET` | **sim em produção** | — | Segredo HS256 dos tokens; mínimo 32 caracteres; não pode ser o de desenvolvimento |
| `AUTH_TOKEN_TTL_HOURS` | não | `8` | Validade da sessão (1 a 72 h) |
| `LOGIN_MAX_ATTEMPTS` | não | `5` | Falhas seguidas que bloqueiam a conta (mínimo 3) |
| `LOGIN_LOCK_MINUTES` | não | `15` | Duração do bloqueio |
| `LOGIN_RATE_PER_MINUTE` | não | `10` | Pedidos de login por IP e por minuto |
| `DOCUMENT_STORAGE_DIR` | não | `./storage` | Pasta dos documentos. Em produção `/srv/cpq/documents` (tem de ser a mesma da do worker) |
| `ISSUER_COUNTRY` | não | `PT` | País da entidade emitente (2 letras; determina o IVA) |
| `TLS_CERT_FILE` | não | — | Caminho do `portal.crt` **visto pelo contentor**; dele sai a impressão digital mostrada no portal |
| `PORTAL_RATE_PER_MINUTE` | não | `30` | Pedidos ao portal por IP e por minuto (lido de `process.env`) |
| `PORTAL_LINK_DAYS` | não | `30` | Validade máxima de uma ligação do portal (1 a 180); nunca excede a validade da proposta |
| `PORTAL_BASE_URL` | não | `http://localhost:5173` | Base das ligações do portal devolvidas pela API. Em produção `https://propostas.exemplo.pt` |
| `THROTTLE_LIMIT` | não | `120` | Pedidos por minuto e por cliente (limite global da API) |

`AUTH_MODE` já não é lido pelo código (ver Lacuna L1).

### 2.2 Worker (`worker.env`)

| Variável | Obrigatória | Por omissão | Descrição |
| --- | --- | --- | --- |
| `DATABASE_URL` | **sim** | — | Igual à da API |
| `REDIS_URL` | não | `redis://127.0.0.1:6379` | Filas BullMQ |
| `DOCUMENT_STORAGE_DIR` | não | `./storage` | Igual à da API |
| `AUDIT_EXPORT_DIR` | não | `./storage-audit` | Em produção `/srv/cpq/audit` |
| `MAIL_OUTBOX_DIR` | não | `./mail-outbox` | Só usada **sem** `SMTP_URL`: as mensagens ficam em ficheiros `.eml` e não são enviadas |
| `SMTP_URL` | não, mas necessária em produção | — | `smtp://utilizador:palavra-passe@servidor:587` (`smtps://` para TLS implícito). Palavra-passe com caracteres especiais tem de ir codificada em URL |
| `MAIL_FROM` | não | `propostas@localhost` | Remetente. Definir um endereço real do domínio (SPF/DKIM) |
| `TLS_CERT_FILE` | não | — | Impressão digital do certificado nos emails ao cliente |
| `RETENTION_IP_DAYS` | não | `365` | Dias até apagar IP e agente de utilizador das respostas do portal **[Decisão: confirmar com o DPO]** |
| `RETENTION_LINK_DAYS` | não | `180` | Dias após expirar até apagar ligações sem resposta |
| `TEAMS_WEBHOOK_URL` | não | — | Webhook de entrada do Teams; opcional |
| `APP_BASE_URL` | não | `http://localhost:5173` | Base das ligações nos emails (aprovações, propostas, portal). Em produção igual a `PORTAL_BASE_URL` |
| `RELAY_INTERVAL_MS` | não | `1000` | Intervalo do relay do outbox |
| `RELAY_BATCH` | não | `100` | Eventos reclamados por ciclo |
| `OUTBOX_MAX_ATTEMPTS` | não | `8` | Tentativas antes de `FAILED` |
| `OUTBOX_STALE_MINUTES` | não | `10` | Minutos em `PROCESSING` até o evento voltar a `PENDING` |
| `SCHEDULER_ENABLED` | não | ligado | **Cuidado:** qualquer texto não vazio (incluindo `false` e `0`) liga-o; só o valor vazio (`SCHEDULER_ENABLED=`) o desliga. Em produção deixar ligado |

### 2.3 Exemplos para produção (sem segredos reais)

`/opt/cpq/api.env`:

```
NODE_ENV=production
PORT=3000
DATABASE_URL=mysql://cpq:TROCAR_PALAVRA_PASSE_DB@127.0.0.1:3306/cpq
REDIS_URL=redis://127.0.0.1:6379
WEB_ORIGIN=https://propostas.exemplo.pt
PORTAL_BASE_URL=https://propostas.exemplo.pt
AUTH_JWT_SECRET=TROCAR_PELO_VALOR_GERADO_COM_OPENSSL
AUTH_TOKEN_TTL_HOURS=8
DOCUMENT_STORAGE_DIR=/srv/cpq/documents
ISSUER_COUNTRY=PT
TLS_CERT_FILE=/etc/cpq/tls/portal.crt
```

`/opt/cpq/worker.env`:

```
DATABASE_URL=mysql://cpq:TROCAR_PALAVRA_PASSE_DB@127.0.0.1:3306/cpq
REDIS_URL=redis://127.0.0.1:6379
DOCUMENT_STORAGE_DIR=/srv/cpq/documents
AUDIT_EXPORT_DIR=/srv/cpq/audit
SMTP_URL=smtp://utilizador:TROCAR@smtp.exemplo.pt:587
MAIL_FROM=propostas@exemplo.pt
APP_BASE_URL=https://propostas.exemplo.pt
TLS_CERT_FILE=/etc/cpq/tls/portal.crt
RETENTION_IP_DAYS=365
RETENTION_LINK_DAYS=180
# TEAMS_WEBHOOK_URL=https://...
```

Criar com as permissões certas:

```bash
sudo install -m 0640 -o root -g root /dev/null /opt/cpq/api.env      # depois editar
sudo install -m 0640 -o root -g root /dev/null /opt/cpq/worker.env
sudoedit /opt/cpq/api.env
```

> **Lacuna L2:** o `docker-compose.yml.j2` não monta nenhum volume (`/srv/cpq/documents`, `/srv/cpq/audit`, `/etc/cpq/tls`). Sem isso os contentores escrevem dentro do contentor e perdem tudo ao recriá-lo, e `TLS_CERT_FILE` não é encontrado (a impressão digital desaparece em silêncio). Antes do go-live é preciso acrescentar `volumes` à `api` e ao `worker` (documents e audit em leitura/escrita; `/etc/cpq/tls` só leitura). O mesmo vale para a UID com que a aplicação escreve nas pastas.

### 2.4 Gerar o `AUTH_JWT_SECRET`

```bash
openssl rand -base64 48        # 64 caracteres; mínimo exigido: 32
```

Guarde-o no cofre de segredos da organização. Nunca no repositório.

### 2.5 Utilizadores da base de dados

O Ansible não cria a base nem os utilizadores. Uma vez, no servidor, como `root`:

```bash
sudo mariadb <<'SQL'
CREATE DATABASE cpq CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'cpq'@'127.0.0.1' IDENTIFIED BY 'TROCAR_PALAVRA_PASSE_DB';
GRANT ALL PRIVILEGES ON cpq.* TO 'cpq'@'127.0.0.1';
-- utilizador dos backups (usado pelo script cpq-backup-full com --user=backup)
CREATE USER 'backup'@'localhost' IDENTIFIED VIA unix_socket;   -- ver nota
GRANT RELOAD, PROCESS, LOCK TABLES, BINLOG MONITOR ON *.* TO 'backup'@'localhost';
SQL
```

Nota: o script de backup corre como `root` e liga-se como `--user=backup`; com `unix_socket` o nome do utilizador de sistema teria de ser `backup`. Se falhar, use `CREATE USER 'backup'@'localhost' IDENTIFIED BY '...'` e coloque a palavra-passe em `/root/.my.cnf` (secção `[mariadb-backup]`). Valide no primeiro backup (secção 7.1). Se as migrações falharem com erro 1419 (triggers com binlog ativo), execute-as com um utilizador administrativo. **Validar em QA.**

## 3. Instalação de raiz (Ubuntu)

### 3.1 Pré-requisitos no servidor

1. Ubuntu Server LTS, acesso SSH por chave para um utilizador com `sudo`.
2. Um disco para a MariaDB (variável `mariadb_data_device`, por omissão `/dev/sdb`) e outro para `/srv/cpq` (documentos e auditoria).
3. DNS `propostas.exemplo.pt` (ou o nome escolhido) a apontar para o servidor.
4. Destino de backups acessível por SSH/rsync (`CPQ_BACKUP_TARGET`, ex.: `backup@servidor-copias:/backups/cpq`) com chave SSH do `root` do servidor autorizada, e pastas `full/`, `binlogs/`, `documents/`, `audit/` criadas.
5. Na máquina de administração: `ansible` (com as coleções `community.general`, `ansible.posix`, `community.docker`), `git`, Node 24 e pnpm (para migrar e criar o primeiro utilizador).

> **Lacuna L3:** o Ansible formata o `mariadb_data_device` em XFS, mas **não** configura LUKS (o comentário diz «cifrado com LUKS») nem prepara o disco de `/srv/cpq`, nem cria `/etc/mysql/encryption/keys.enc`/`keys.pass`. Estes três passos são manuais e têm de estar feitos **antes** de correr o playbook (o serviço `mariadb-keys` falha sem `keys.enc`). A MariaDB só arranca com o ficheiro de chaves em `/run/mariadb-keys/keys.txt` (formato `file_key_management`: `1;<hex de 64 caracteres>`).

Preparar as chaves (exemplo, no servidor, uma vez):

```bash
sudo install -d -m 0700 /etc/mysql/encryption
echo "1;$(openssl rand -hex 32)" | sudo tee /tmp/keys.txt >/dev/null
openssl rand -base64 32 | sudo tee /etc/mysql/encryption/keys.pass >/dev/null
sudo chmod 0400 /etc/mysql/encryption/keys.pass
sudo openssl enc -aes-256-cbc -pbkdf2 -in /tmp/keys.txt -out /etc/mysql/encryption/keys.enc -pass file:/etc/mysql/encryption/keys.pass
sudo shred -u /tmp/keys.txt
```

**Guarde cópias de `keys.enc` e `keys.pass` fora do servidor** (cofre da organização, separado do destino de backups). Sem elas, os backups das tabelas cifradas são irrecuperáveis (ver secção 7).

### 3.2 Inventário e variáveis

Em `infra/ansible/inventory.ini`:

```ini
[cpq]
propostas.exemplo.pt ansible_user=admin
```

Em `infra/ansible/group_vars/all.yml`, rever pelo menos: `environment_name` (por omissão `qa`; mudar para `prod`), `mariadb_data_device`, `mariadb_buffer_pool_size` (por omissão `4G`), `server_names` (nomes DNS no certificado), `server_ips` (se se aceder por IP), `app_image_tag` (por omissão `latest`; em produção fixe uma versão) e `tls_days` (825).

O destino dos backups vem da variável de ambiente `CPQ_BACKUP_TARGET` na máquina de administração:

```bash
export CPQ_BACKUP_TARGET='backup@servidor-copias:/backups/cpq'
```

### 3.3 Segredos com `ansible-vault`

O repositório ainda não consome segredos do cofre (ver L4). Procedimento recomendado, **não testado no repositório**: guardar os ficheiros `.env` completos num cofre e copiá-los para o servidor com o módulo `copy`, que decifra automaticamente.

```bash
mkdir -p infra/ansible/secrets            # já deve estar no .gitignore; confirme antes de continuar
$EDITOR infra/ansible/secrets/api.env     # conteúdo da secção 2.3
$EDITOR infra/ansible/secrets/worker.env
ansible-vault encrypt infra/ansible/secrets/api.env infra/ansible/secrets/worker.env

cd infra/ansible
ansible cpq -b --ask-vault-pass -m ansible.builtin.copy -a "src=secrets/api.env dest=/opt/cpq/api.env owner=root group=root mode=0640"
ansible cpq -b --ask-vault-pass -m ansible.builtin.copy -a "src=secrets/worker.env dest=/opt/cpq/worker.env owner=root group=root mode=0640"
```

A pasta `/opt/cpq` é criada pelo papel `app`; na primeira vez, crie-a antes (`ansible cpq -b -m file -a "path=/opt/cpq state=directory mode=0750"`).

### 3.4 Ordem de execução

1. Preparar discos, LUKS, chaves (3.1) e a base de dados/utilizadores (2.5, depois de a MariaDB estar instalada, no passo 3).
2. Correr o playbook (ordem dos papéis: `base`, `docker`, `mariadb`, `nginx`, `backup`, `app`):

   ```bash
   cd infra/ansible
   ansible-playbook site.yml --check --diff    # simulação (a geração do certificado e o compose não simulam tudo)
   ansible-playbook site.yml
   ```

   Se o último passo (`app`) falhar por falta dos `.env`, crie-os (3.3) e volte a correr: o playbook é idempotente.
3. Criar a base e os utilizadores (2.5) e, se ainda não o fez, os ficheiros `.env`.
4. Aplicar as migrações (secção 6.2) e criar o primeiro administrador (3.7).
5. Recriar os contentores: `sudo docker compose -f /opt/cpq/docker-compose.yml up -d`.

### 3.5 Certificado autoassinado e impressão digital

O papel `nginx` gera o certificado **uma só vez** (`creates: portal.crt`): ECDSA P-256, `serverAuth`, 825 dias, SAN com `server_names` e `server_ips`. No fim do passo mostra a impressão digital. Para a ler quando quiser:

```bash
sudo openssl x509 -in /etc/cpq/tls/portal.crt -noout -fingerprint -sha256 -enddate
```

Registe a impressão digital e a data de expiração (secção 8). A aplicação lê o mesmo ficheiro (`TLS_CERT_FILE`, ver L2) e mostra a impressão digital no portal e nos emails ao cliente. Fora do Ansible, o equivalente manual é `scripts/tls/selfsigned.sh propostas.exemplo.pt --ip 10.0.0.5 --out /etc/cpq/tls`.

### 3.6 SMTP

Defina `SMTP_URL` e `MAIL_FROM` no `worker.env`. Teste: submeta uma proposta para aprovação e confirme que o aprovador recebe o email. Sem `SMTP_URL`, o worker **não envia nada**: grava `.eml` em `MAIL_OUTBOX_DIR` (e o evento fica `DONE`). Confirmação rápida: `docker compose -f /opt/cpq/docker-compose.yml exec worker ls /app/mail-outbox` não deve crescer em produção (ajuste o caminho conforme a imagem).

### 3.7 Primeiro administrador

O comando corre a partir de um checkout do repositório, na versão instalada, com acesso à base de dados. A MariaDB só escuta em `127.0.0.1`; use um túnel SSH a partir da máquina de administração:

```bash
ssh -N -L 3307:127.0.0.1:3306 admin@propostas.exemplo.pt &
git checkout <tag-da-versao> && pnpm install --frozen-lockfile
pnpm --filter @cpq/shared build && pnpm --filter @cpq/db build
export DATABASE_URL='mysql://cpq:TROCAR_PALAVRA_PASSE_DB@127.0.0.1:3307/cpq'
pnpm --filter @cpq/db user:create admin@exemplo.pt 'Palavra-passe-Temp-2026!' Administrador --nome 'Nome do Administrador' --must-change
```

Papéis válidos: `Comercial`, `Gestor_Comercial`, `Aprovador_Financeiro`, `Juridico`, `Administrador`. A política exige 10+ caracteres, três tipos de caracteres e que não contenha o email; `--allow-weak` ignora-a (nunca em produção). O comando é um *upsert* por email: voltar a correr repõe a palavra-passe, desbloqueia a conta e termina as sessões. Não corra `pnpm db:seed` em produção (cria utilizadores de demonstração com palavra-passe conhecida).

Entre em `https://propostas.exemplo.pt`, mude a palavra-passe (pedido obrigatório com `--must-change`) e crie os restantes utilizadores no ecrã **Utilizadores**.

## 4. Operação diária

Todos os comandos `docker compose` assumem `cd /opt/cpq` (ou `-f /opt/cpq/docker-compose.yml`).

### 4.1 Estado, arranque, paragem, reinício

```bash
sudo docker compose ps                         # api, worker, web, redis
systemctl status mariadb nginx docker --no-pager
systemctl list-timers 'cpq-backup-*'           # próximas execuções dos backups

sudo docker compose up -d                      # arranca/recria o que faltar
sudo docker compose restart worker             # reinício de um serviço (api, worker, web, redis)
sudo docker compose stop                       # pára a aplicação (a MariaDB e o Nginx continuam)
sudo systemctl restart nginx                   # ou reload, para configuração
sudo systemctl restart mariadb                 # reinicia a base (a API/worker voltam a ligar-se)
```

Ordem para parar tudo: `docker compose stop` → `systemctl stop mariadb`. Ordem de arranque: `mariadb` → `docker compose up -d`. Os contentores têm `restart: unless-stopped`; o worker trata `SIGTERM` (termina limpo) e eventos a meio voltam a `PENDING` após `OUTBOX_STALE_MINUTES`.

### 4.2 Logs

```bash
sudo docker compose logs -f --tail=200 api
sudo docker compose logs -f --tail=200 worker
sudo docker compose logs --since 1h worker | grep -iE "falhou|error|warn"
sudo journalctl -u mariadb -u nginx --since "1 hour ago" --no-pager
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log
```

No worker, procure: `Scheduler` (tarefas periódicas e erros delas), `evento ... falhou (tentativa N)`.

> **Lacuna L6:** o Docker usa o `json-file` por omissão **sem rotação**; os logs crescem até encher o disco. Configure `/etc/docker/daemon.json` com `{"log-driver":"json-file","log-opts":{"max-size":"20m","max-file":"5"}}` e reinicie o Docker (os contentores têm de ser recriados). Também não há OpenTelemetry Collector nem Prometheus instalados (a arquitetura prevê-os); a monitorização da secção 12 é a mínima viável.

### 4.3 Saúde

```bash
curl -sk https://propostas.exemplo.pt/api/v1/health      # {"status":"ok"}
curl -s  http://127.0.0.1:3000/api/v1/health             # direto à API, no servidor
```

O `/health` só confirma que a API responde; **não** testa MariaDB nem Redis. Para o resto:

```bash
sudo mariadb -e "SELECT 1"
sudo docker compose exec redis redis-cli ping            # PONG
sudo docker compose exec redis redis-cli LLEN bull:events:wait    # fila de trabalho pendente
sudo docker compose exec redis redis-cli LLEN bull:audit:wait
```

### 4.4 Outbox: estado das filas

Estados de `outbox_events`: `PENDING`, `PROCESSING`, `DONE`, `FAILED`. Colunas: `id`, `aggregate_id` (normalmente o id da proposta), `event_type`, `payload`, `status`, `attempts`, `next_attempt_at`, `created_at`, `last_error`.

```sql
-- resumo por estado
SELECT status, COUNT(*) FROM outbox_events GROUP BY status;

-- atrasados: pendentes com mais de 5 minutos (worker parado ou Redis em baixo)
SELECT id, event_type, attempts, created_at, last_error
FROM outbox_events
WHERE status IN ('PENDING','PROCESSING') AND created_at < NOW() - INTERVAL 5 MINUTE
ORDER BY created_at;

-- presos em PROCESSING (voltam sozinhos a PENDING ao fim de OUTBOX_STALE_MINUTES)
SELECT id, event_type, next_attempt_at FROM outbox_events WHERE status = 'PROCESSING' ORDER BY next_attempt_at;

-- eventos FAILED, mais recentes primeiro
SELECT id, event_type, aggregate_id, attempts, created_at, LEFT(last_error, 200) AS erro
FROM outbox_events WHERE status = 'FAILED' ORDER BY created_at DESC;

-- eventos DONE por dia (volume)
SELECT DATE(created_at) AS dia, COUNT(*) FROM outbox_events WHERE status = 'DONE' GROUP BY dia ORDER BY dia DESC LIMIT 14;
```

As tentativas falhadas voltam a `PENDING` com *backoff* exponencial (5 s × 2^n, com *jitter*, máximo 15 min). À 8.ª tentativa (`OUTBOX_MAX_ATTEMPTS`) passam a `FAILED`. A tabela cresce (os `DONE` nunca são apagados): faça uma limpeza periódica, p. ex. mensal, depois de decidir a retenção **[Decisão]**:

```sql
DELETE FROM outbox_events WHERE status = 'DONE' AND created_at < NOW() - INTERVAL 90 DAY;
```

### 4.5 Eventos FAILED: diagnóstico e reprocessamento

> **Lacuna L7:** o código comenta que `FAILED` «gera alerta», mas não gera: nada notifica nem há ecrã. O alarme é uma consulta (secção 12). A única interface é o SQL acima; a UI só mostra `last_error` da geração de documentos da proposta em causa.

1. Leia `last_error` e `event_type`. Causas habituais: SMTP indisponível (`portal.invite`, `approval.requested`...), disco cheio ou sem permissões (`document.compile`), variável de merge em falta (`document.compile`), `Sem processador para ...` (evento de uma versão mais recente da aplicação).
2. Corrija a causa (secção 15).
3. Reprocesse um evento (volta ao relay no ciclo seguinte; o `jobId` do BullMQ é o id do evento e os jobs são removidos ao terminar, por isso não há duplicação):

   ```sql
   UPDATE outbox_events SET status = 'PENDING', attempts = 0, next_attempt_at = CURRENT_TIMESTAMP(6)
   WHERE id = '<id-do-evento>' AND status = 'FAILED';
   ```

   Vários de uma vez, do mesmo tipo: acrescente `AND event_type = 'document.compile'` em vez do `id`.
4. **Exceção, `portal.invite`:** ao esgotar as tentativas o token da ligação é apagado do payload (por segurança). Reprocessar enviaria `.../portal/undefined`. Não reprocesse: na proposta, separador **Portal do cliente**, crie uma nova ligação com **Criar e enviar** (revoga as anteriores). Marque o evento antigo como tratado se quiser limpar o alarme: `UPDATE outbox_events SET status='DONE' WHERE id='<id>';`.
5. Eventos que já não interessam (p. ex. `document.compile` de uma proposta cancelada): o mesmo `UPDATE ... SET status='DONE'`, e registe o motivo no registo de incidentes.
6. Eventos `audit.*` em `FAILED` são graves (a auditoria fica atrasada): nunca os marque `DONE`; corrija a causa e reprocesse.

O relay também grava eventos de auditoria (`audit.record`) no `outbox_events`: o ordenamento da cadeia é garantido pela linha única de `audit_head` e pela fila `audit` com concorrência 1.

## 5. Tarefas periódicas do worker

Correm no worker (`SCHEDULER_ENABLED`), com um *lock* no Redis para que só um worker as execute. Se uma falhar, regista `<nome> falhou: ...` no log e repete no ciclo seguinte.

| Tarefa | Frequência | O que faz |
| --- | --- | --- |
| `sla` | 60 s | Pedidos de aprovação fora de prazo: renova o prazo, regista `approval.escalated` e notifica o papel de escalamento (por omissão `Administrador`) |
| `expiry` | 1 h | Propostas `SENT` com `valid_until` anterior ao dia de hoje passam a `EXPIRED`, revoga as ligações do portal e notifica o dono |
| `manual-edits` | 15 min | Compara o hash em disco dos documentos `GENERATED` de `01_Trabalho` com o registado; se diferir, marca `MANUALLY_EDITED` e regista `document.manually_edited` |
| `audit-verify` | 6 h | Verifica a cadeia de auditoria inteira; se estiver quebrada, cria o evento `alert.audit_chain_broken` (email aos administradores) |
| `audit-export` | 6 h | Exporta os **dias já fechados** em falta para `AUDIT_EXPORT_DIR` (`audit-AAAA-MM-DD.jsonl` + `.sha256`, modo `0440`); nunca sobrescreve |
| `retention` | 24 h | RGPD: apaga IP e agente de utilizador das respostas mais antigas que `RETENTION_IP_DAYS` e ligações expiradas e sem resposta mais antigas que `RETENTION_LINK_DAYS` |

Nota: a verificação da cadeia corre de 6 em 6 horas (a arquitetura falava em «noturna») e a exportação também (não há uma hora fixa diária).

## 6. Atualizações

### 6.1 Princípios

- Uma versão = uma *tag* do repositório = três imagens (`cpq/api`, `cpq/worker`, `cpq/web`) com a mesma *tag* + as migrações dessa *tag*.
- Antes de atualizar: backup completo manual (7.2), fora de horas de expediente, com aviso aos utilizadores (a janela típica é de 15 a 30 minutos; **[Decisão]** fixar a janela, p. ex. fora do horário comercial).
- Migrações primeiro, contentores depois; as migrações têm de ser compatíveis com a versão anterior da aplicação durante o curto intervalo, ou então a aplicação é parada antes (caso por defeito deste manual).

> **Lacuna L8:** o repositório não tem Dockerfiles nem pipeline que construa e publique as imagens `cpq/*`. Até existir, o passo «obter as imagens» abaixo é manual (construir e carregar com `docker load` ou publicar num registo da organização).

### 6.2 Procedimento

```bash
# 1. no servidor: backup e paragem da aplicação (a MariaDB continua)
sudo systemctl start cpq-backup-full.service
sudo docker compose -f /opt/cpq/docker-compose.yml stop api worker

# 2. na máquina de administração, com o túnel SSH aberto (secção 3.7)
git fetch --tags && git checkout <nova-tag>
pnpm install --frozen-lockfile
pnpm --filter @cpq/shared build && pnpm --filter @cpq/db build
export DATABASE_URL='mysql://cpq:...@127.0.0.1:3307/cpq'
pnpm db:migrate                       # aplica as pendentes; escreve "up: 0013_..., ..." ou "nada a fazer"

# 3. no servidor: nova versão
#    opção A: acertar app_image_tag em infra/ansible/group_vars/all.yml e correr: ansible-playbook site.yml
#    opção B (atalho no servidor):
sudo sed -i 's#\(cpq/[a-z]*\):[A-Za-z0-9._-]*#\1:<nova-tag>#' /opt/cpq/docker-compose.yml
sudo docker compose -f /opt/cpq/docker-compose.yml up -d

# 4. verificar
curl -sk https://propostas.exemplo.pt/api/v1/health
sudo docker compose -f /opt/cpq/docker-compose.yml logs --tail=50 api worker
```

(A opção A é a preferida: regenera o compose e faz `up`. A opção B é um atalho e deixa o compose desfasado do Ansible: atualize também a variável.)

Executor de migrações (`db/src/migrate.ts`): cada pasta em `db/migrations/NNNN_nome` tem `up.sql` e `down.sql`; as aplicadas ficam na tabela `_migrations`; usa `GET_LOCK('cpq_migrate')` (uma execução de cada vez). Estado atual:

```sql
SELECT name, applied_at FROM _migrations ORDER BY name;
```

### 6.3 Rollback

**Rollback só da aplicação** (a migração é compatível, ou não houve migração): volte à *tag* anterior (`app_image_tag`) e `docker compose up -d`. Seguro sempre que o esquema novo não removeu nada de que a versão antiga precise.

**Rollback da migração:** `pnpm db:migrate down` reverte **uma** migração (a última aplicada) e remove-a de `_migrations`; repita para reverter várias. Antes, pare a `api` e o `worker`.

```bash
pnpm db:migrate down      # corre down.sql da última migração aplicada
```

Quando é seguro:

- Seguro, se a migração só criou estruturas vazias (tabelas/colunas novas ainda sem dados): o `down.sql` apaga-as.
- **Perde dados** se já houve escrita nas estruturas que o `down.sql` apaga (ex.: `0012_audit_head` apaga `audit_head`; `0010_local_auth` apaga `password_hash`, bloqueios e `token_version` e repõe `entra_oid`: ninguém consegue entrar). Leia o `down.sql` antes: `cat db/migrations/<NNNN_nome>/down.sql`.
- Na dúvida, ou se a migração corrompeu dados: **restaure o backup** feito no passo 1 (secção 7.4) em vez de usar `down`.
- Depois de reverter, volte à *tag* anterior da aplicação, que tem de coincidir com o esquema.

Teste de rollback: faça-o sempre primeiro em QA (a definição de pronto do projeto exige migrações aplicadas e revertidas em QA).

## 7. Backups e restauro

### 7.1 O que se copia e quando

| O quê | Como | Frequência | Destino (`$CPQ_BACKUP_TARGET/...`) |
| --- | --- | --- | --- |
| Base de dados, completo | `cpq-backup-full`: `mariadb-backup --backup` + `--prepare`, `tar.gz` | Diário, 03:30 UTC | `full/full-<carimbo>.tar.gz` |
| Binlogs (ponto no tempo) | `cpq-backup-binlogs`: `FLUSH BINARY LOGS` + `rsync` de `binlog.[0-9]*` | A cada 5 min | `binlogs/` |
| Documentos | `rsync -a /srv/cpq/documents/` | A cada 5 min e em cada backup completo | `documents/` |
| Exportações da auditoria | `rsync -a /srv/cpq/audit/` | Diário (no backup completo) | `audit/` |
| **Chaves de encriptação** (`keys.enc`, `keys.pass`) | **manual**, fora do destino de backups | Quando mudarem | cofre da organização |
| `.env`, `group_vars` e cofre Ansible | repositório (sem segredos) + cofre | A cada alteração | — |

Metas: RPO ≤ 15 min (binlogs de 5 em 5 min), RTO ≤ 4 h. A auditoria exportada tem RPO de até 24 h no destino (o resto da auditoria está na base de dados e nos binlogs).

Retenção declarada: 35 dias. **Lacuna L9:** o script só apaga, localmente, `/var/backups/cpq/full-*` com mais de 35 dias, mas essa pasta é esvaziada em cada execução; **o destino nunca é limpo** (nem `full/` nem `binlogs/`). Defina e agende a limpeza no destino, p. ex. `find $DESTINO/full -name 'full-*.tar.gz' -mtime +35 -delete`. Os binlogs só podem ser apagados depois do backup completo mais antigo que se quer poder restaurar.

Verificação diária (alarme: falha se nenhum ficheiro novo em 26 h):

```bash
systemctl list-timers 'cpq-backup-*'
journalctl -u cpq-backup-full.service -u cpq-backup-binlogs.service --since "26 hours ago" --no-pager | tail -30
systemctl is-failed cpq-backup-full.service cpq-backup-binlogs.service
ls -lt $CPQ_BACKUP_TARGET/full | head -3        # no destino (ou via ssh)
```

### 7.2 Backup manual

```bash
sudo systemctl start cpq-backup-full.service     # bloqueia até acabar (Type=oneshot)
journalctl -u cpq-backup-full.service -n 30 --no-pager
```

### 7.3 Verificar um backup

A verificação completa é um restauro (7.5). Verificação rápida do ficheiro: `tar -tzf full-<carimbo>.tar.gz | head` e tamanho coerente com o anterior.

### 7.4 Procedimento de restauro

Siga [infra/RESTORE.md](../infra/RESTORE.md) (7 passos: preparar servidor com o Ansible; obter o último completo; `mariadb-backup --copy-back`; copiar binlogs; aplicar binlogs até ao instante pretendido; restaurar `documents` e `audit`; validar). Acrescente o que o RESTORE.md não diz:

- **Antes do passo 1** recupere `keys.enc` e `keys.pass` do cofre para `/etc/mysql/encryption/` e confirme que `mariadb-keys.service` arranca: sem as chaves originais a MariaDB não lê as tabelas cifradas.
- Os binlogs estão cifrados (`encrypt_binlog = ON`); o `mariadb-binlog` precisa de aceder às mesmas chaves (use `--read-from-remote-server` ou execute-o no servidor com a MariaDB configurada com as chaves). **Validar no primeiro ensaio.**
- O ficheiro `.tar.gz` contém a pasta `full-<carimbo>`.
- Depois de restaurar, atualize `/opt/cpq/*.env`, volte a pôr a aplicação (`docker compose up -d`) e **corra a verificação de integridade** (7.6).
- Para um ponto no tempo, escolha `--stop-datetime` em UTC imediatamente antes do incidente; os utilizadores perdem o que foi gravado depois.

### 7.5 Ensaio de restauro (trimestral)

Objetivo: provar RPO/RTO e que os backups servem. Faça-o num servidor separado, nunca no de produção.

**Ensaio do procedimento automatizado (QA/dev).** `pnpm ops:restore-rehearsal` (`scripts/ops/restore-rehearsal.sh [--keep]`) faz backup completo da base **em funcionamento**, restaura-o numa instância separada (porta 3307, pasta `restore-rehearsal`), compara contagens (`users`, `clients`, `proposals`, `quote_versions`, `documents`, `audit_log`, `customer_responses`), corre a verificação de integridade e imprime a duração de cada passo (a soma dos passos de restauro é o RTO). Não toca na instância original.

- Em **macOS** usa cópia lógica (`mariadb-dump`) porque o `mariadb-backup` compilado localmente fica preso; em **Ubuntu** usa a física (`mariadb-backup`). Pode forçar com `CPQ_BACKUP_METHOD=dump|physical`.
- **Limitação:** o script está ligado ao ambiente local de testes (carrega `scripts/env/env.sh` e `.env`, usa `~/tools/mariadb` — ou `$CPQ_TOOLS` — e a base `cpq_dev` com o utilizador `root` por socket). **Não corre tal e qual no servidor de produção** (MariaDB do pacote, base `cpq`). Serve para validar o método e os tempos no QA; o ensaio trimestral de produção faz-se **manualmente** com o RESTORE.md num servidor de teste, seguido de `ops:verify` (abaixo).

**Ensaio completo trimestral (produção).**

1. Servidor de teste novo; `ansible-playbook site.yml` com `CPQ_BACKUP_TARGET` só de leitura.
2. Executar o RESTORE.md com cronómetro (registar a hora de cada passo).
3. Verificar a integridade (7.6) e abrir a aplicação, descarregar 2 documentos e confirmar o hash.
4. Registar no quadro abaixo; abrir ação para qualquer falha.

### 7.6 Verificação de integridade (`pnpm ops:verify`)

```bash
export DATABASE_URL='mysql://cpq:...@127.0.0.1:3307/cpq'
pnpm ops:verify --db "$DATABASE_URL" --storage /srv/cpq/documents      # caminho ABSOLUTO
```

Verifica: (1) a cadeia de hashes da auditoria; (2) o SHA-256 de cada documento registado contra o ficheiro em disco; (3) o hash do *snapshot* de cada cotação `LOCKED`/`SUPERSEDED`. Termina com código 1 se algo falhar. Corra-o: após cada restauro, após cada ensaio, antes e depois de uma atualização grande, e sempre que a cadeia de auditoria for dada como quebrada. O `--storage` relativo é resolvido a partir da pasta `db/`, por isso use sempre caminho absoluto.

### 7.7 Registo de ensaios de restauro

| Data | Responsável | Servidor / método | Backup usado (carimbo) | Backup+cópia | Arranque + binlogs | Verificação | **RTO total** | RPO medido | `ops:verify` | Falhas / ações |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AAAA-MM-DD | | | | | | | | | OK / n problemas | |

Guarde também a saída completa do ensaio (anexo). Ensaio de arranque obrigatório antes do go-live (ver IMPLANTACAO.md).

## 8. Certificado autoassinado

- **Validade:** 825 dias (`tls_days`). Consulte a expiração: `sudo openssl x509 -in /etc/cpq/tls/portal.crt -noout -enddate`.
- **Alarme:** 30 dias antes (secção 12). Verificação simples, para um `cron` de monitorização: `openssl x509 -in /etc/cpq/tls/portal.crt -noout -checkend $((30*86400))` (código 1 se expira em 30 dias).
- **Renovação (planeada, fora de horas):**

  ```bash
  sudo mv /etc/cpq/tls/portal.crt /etc/cpq/tls/portal.crt.antigo
  sudo mv /etc/cpq/tls/portal.key /etc/cpq/tls/portal.key.antigo
  cd infra/ansible && ansible-playbook site.yml      # regenera o par, recarrega o Nginx e mostra a nova impressão digital
  sudo docker compose -f /opt/cpq/docker-compose.yml restart api worker    # relêem a impressão digital (é lida no arranque da API)
  curl -svk https://propostas.exemplo.pt 2>&1 | grep -i "expire date"
  ```

- **Comunicar a nova impressão digital:** a impressão digital muda sempre. (a) Clientes com ligações do portal **ativas** abrirão a página e verão o aviso do browser; a página já mostra a impressão digital nova. (b) Emails já enviados mostram a antiga: envie uma nota curta aos contactos com propostas `SENT` (lista: `SELECT p.code, c.name, c.contact_email FROM proposals p JOIN clients c ON c.id = p.client_id WHERE p.status = 'SENT';`) **[Decisão: quem envia e o texto]**. (c) Atualize a impressão digital registada internamente e os guiões do suporte. (d) Utilizadores que instalaram o `portal.crt` como confiável têm de instalar o novo.
- Se os avisos do browser prejudicarem a aceitação, a alternativa é um certificado de uma CA reconhecida, sem alterações à aplicação (só o Nginx) **[Decisão]**.
- Em caso de comprometimento da chave privada: renovar de imediato, revogar ligações do portal ativas e criar novas (secção 10).

## 9. Utilizadores, papéis e sessões

Tudo no ecrã **Utilizadores** (apenas `Administrador`), exceto o que está indicado.

| Tarefa | Como |
| --- | --- |
| Criar utilizador | **Novo utilizador**: email, nome, papéis, equipa, região. Se não indicar palavra-passe, gera uma temporária mostrada **uma só vez**; o utilizador tem de a mudar no primeiro acesso |
| Atribuir/alterar papéis, equipa, região, desativar | Editar o utilizador. Alterar papéis, equipa ou estado (ativo) **termina de imediato as sessões** dessa pessoa |
| Desbloquear conta | **Desbloquear** (zera as falhas). O bloqueio expira sozinho ao fim de `LOGIN_LOCK_MINUTES` (15) após `LOGIN_MAX_ATTEMPTS` (5) falhas |
| Repor palavra-passe | **Repor palavra-passe**: gera uma nova temporária, desbloqueia, termina sessões e força a mudança. Comunique-a por um canal que não seja o email da própria conta |
| Último administrador | O sistema recusa desativar/remover o papel ao último administrador ativo (`LAST_ADMIN`) |
| Plano B sem acesso à aplicação | `pnpm --filter @cpq/db user:create <email> '<palavra-passe>' Administrador --must-change` com o túnel (3.7): repõe a palavra-passe, desbloqueia e termina sessões |
| Equipas | **Equipas → Nova equipa** (usadas pela visibilidade do gestor) |

Papéis: `Comercial` (as suas propostas), `Gestor_Comercial` (as da equipa/região, custos e margens), `Aprovador_Financeiro` (custos e as que lhe foram atribuídas), `Juridico` (blocos jurídicos e aprovações jurídicas), `Administrador` (tudo; a auditoria é só de leitura mesmo para ele). Os papéis somam-se.

Consultar bloqueios e último acesso por SQL:

```sql
SELECT email, is_active, failed_logins, locked_until, last_login_at FROM users ORDER BY email;
SELECT occurred_at, action, JSON_EXTRACT(diff_json,'$.ip') AS ip FROM audit_log
WHERE action IN ('auth.login_failed','auth.locked') AND occurred_at > NOW() - INTERVAL 1 DAY ORDER BY seq DESC LIMIT 50;
```

### 9.1 Rotação do segredo JWT

Efeito: **todas as sessões terminam** (os tokens existentes deixam de validar; todos têm de voltar a iniciar sessão). Quando: suspeita de fuga do segredo, saída de um administrador com acesso ao servidor, e de forma periódica **[Decisão: ex. anual]**.

```bash
NOVO=$(openssl rand -base64 48)
sudoedit /opt/cpq/api.env             # substituir AUTH_JWT_SECRET (atualizar também o cofre)
sudo docker compose -f /opt/cpq/docker-compose.yml up -d --force-recreate api
```

Faça-o fora de horas e avise os utilizadores. Para terminar só uma sessão não é preciso rodar o segredo: desative e reative o utilizador, ou reponha a palavra-passe. O worker não usa este segredo.

### 9.2 Chaves de API do CRM

No ecrã **Integrações e privacidade** (`/integracoes`), secção **Chaves de API (CRM)**.

- **Criar:** **Nova chave**, nome (ex.: `crm-producao`) e permissões (`clients:write`, `proposals:read`; no máximo 2). A chave completa só é mostrada **uma vez**; na base fica o hash. Entregue-a ao responsável do CRM por canal seguro.
- **Usar:** cabeçalho `X-Api-Key`. `POST /api/v1/integrations/crm/clients` (até 500 clientes) e `GET /api/v1/integrations/crm/proposals?since=...`.
- **Revogar:** **Revogar** na linha da chave (efeito imediato). O ecrã mostra o último uso.
- **Rodar:** crie a nova chave, entregue-a, o CRM passa a usá-la e confirma-se o «último uso»; só então revogue a antiga. Rotação periódica **[Decisão: ex. 12 meses]**.
- Uma chave com último uso inesperado (IP ou hora) deve ser revogada e o incidente registado (secção 10).

## 10. Auditoria e resposta a incidentes

### 10.1 Como funciona

Cada evento relevante entra em `audit_log` com `prev_hash` e `row_hash` (SHA-256 sobre o JSON canónico da entrada e o hash anterior). Triggers na base (`trg_audit_no_update`, `trg_audit_no_delete`) impedem `UPDATE` e `DELETE`. A auditoria não contém nomes nem emails de clientes.

> **Lacuna L10:** a arquitetura prevê um utilizador de base de dados só com `INSERT`/`SELECT` na auditoria. Não está implementado (a aplicação usa um único utilizador com todos os privilégios e os triggers são a única barreira, contornável por quem tenha privilégios de DDL). Compensação: as exportações diárias fora do servidor.

### 10.2 Verificar a cadeia

- Automática: tarefa `audit-verify` de 6 em 6 horas; se falhar, email «ALERTA: cadeia de auditoria quebrada» aos administradores (requer SMTP funcional, senão fica só em `.eml`).
- Manual, sempre que quiser: `pnpm ops:verify --db "$DATABASE_URL" --storage /srv/cpq/documents` (secção 7.6). Mostra «Auditoria: N linhas — cadeia íntegra» ou a linha quebrada e o motivo (`prev_hash não corresponde...` ou `o conteúdo da linha foi alterado`).
- Estado da exportação: `ls -lt /srv/cpq/audit | head`; cada `.jsonl` tem um `.sha256`: `cd /srv/cpq/audit && sha256sum -c audit-AAAA-MM-DD.jsonl.sha256`.

### 10.3 Se a cadeia for dada como quebrada

1. **Não apague, não corrija e não reinicie o que quer que seja na tabela.** Registe a hora, a linha (`brokenAt`) e o motivo.
2. Confirme que não é falso positivo: repita `ops:verify`; verifique se o worker tem várias instâncias ou se houve restauro parcial recente.
3. Isolar: restrinja o acesso (SSH e base de dados) ao mínimo; liste quem teve acesso privilegiado ao servidor nas últimas semanas.
4. Preservar provas: faça um backup completo manual (7.2) e copie para fora `/srv/cpq/audit`, os binlogs e os logs (`journalctl`, Nginx, Docker).
5. Comparar com as cópias: as exportações `audit-*.jsonl` (e o destino de backup) contêm o estado anterior. Compare as linhas a partir de `seq` = `brokenAt` entre a base e os ficheiros; os binlogs (`mariadb-binlog`) mostram quem executou `UPDATE`/`DELETE` ou `TRIGGER DROP`.
6. Avaliar o impacto: o que mudou (campos, utilizadores), se afeta propostas enviadas/aceites; use `ops:verify` para ver documentos e *snapshots*.
7. Decidir restauro: se houve adulteração, restaure a base de um backup anterior ao incidente (7.4) e reconcilie com as exportações **[Decisão: Direção/Segurança]**.
8. Notificar: encarregado da proteção de dados e segurança; se houver dados pessoais envolvidos, avaliar a obrigação de notificar a CNPD em 72 horas **[Decisão jurídica]**.
9. Fechar: causa, correções (rotar `AUTH_JWT_SECRET` e palavras-passe, chaves de API, acessos SSH) e registo do incidente.

## 11. RGPD operacional

- **Retenção automática** (tarefa `retention`, diária): `RETENTION_IP_DAYS` = 365 (IP e agente de utilizador das respostas) e `RETENTION_LINK_DAYS` = 180 (ligações expiradas e sem resposta). Nome, email, decisão e hashes mantêm-se (prova do contrato). Cada execução com efeito regista `privacy.retention` na auditoria. **[Decisão]** confirmar os prazos com o encarregado da proteção de dados.
- **Pedido de exportação** (acesso): **Integrações e privacidade → Direitos do titular**, email do titular, **Exportar dados**. Devolve JSON com clientes, respostas do portal e utilizadores com esse email (sem hashes de palavras-passe). Entregue por canal seguro, após verificar a identidade do titular. Regista `privacy.exported`.
- **Pedido de anonimização/apagamento:** mesmo ecrã, **Anonimizar** (confirmação explícita). **Irreversível**: apaga contacto do cliente, nome/email/IP/comentário das respostas, e desativa e anonimiza utilizadores com esse email (não pode anonimizar o seu próprio utilizador). Mantém decisão e hashes. Regista `privacy.anonymized`. Antes, exporte e guarde o que a lei exigir; avalie se há obrigação de conservação.
- **Backups:** os dados anonimizados continuam nos backups até expirarem (35 dias). Se voltar a restaurar um backup anterior, volte a aplicar os pedidos de anonimização registados.
- **Registo dos pedidos:** a aplicação só regista na auditoria o facto (quem, quando, contagens), sem o email do titular. Mantenha um **registo próprio** (folha da organização) com: data do pedido, titular (referência), direito exercido, quem verificou a identidade, data de resposta (prazo legal: 1 mês), resultado e responsável.

## 12. Monitorização e alarmes

Mínimo viável com ferramentas do sistema (L6: não há Prometheus/Collector). Cada verificação pode correr por `cron`/`systemd` no servidor ou num sistema externo, com email em falha. **[Decisão]**: destinatários e ferramenta.

| Alarme | Verificação | Limiar sugerido |
| --- | --- | --- |
| Aplicação em baixo | `curl -fsk https://propostas.exemplo.pt/api/v1/health` a cada minuto (de fora) | 2 falhas seguidas |
| Contentor parado | `docker compose ps --status exited` não vazio | qualquer |
| MariaDB | `mariadb -e 'SELECT 1'` | falha |
| Disco | `df -h /var/lib/mysql /srv/cpq /var/backups/cpq /` | > 80 % aviso, > 90 % crítico |
| Memória | `free -m`; `docker stats --no-stream` | disponível < 15 %, ou contentor perto do `mem_limit` |
| Fila parada | SQL: `SELECT COUNT(*) FROM outbox_events WHERE status IN ('PENDING','PROCESSING') AND created_at < NOW() - INTERVAL 10 MINUTE` | > 0 |
| Eventos falhados | SQL: `SELECT COUNT(*) FROM outbox_events WHERE status='FAILED'` | > 0 |
| 5xx | `awk '$9 ~ /^5/' /var/log/nginx/access.log` (por janela de tempo) | > 5 em 5 min |
| Backup | idade do último `full-*.tar.gz` no destino e `systemctl is-failed cpq-backup-*` | completo > 26 h; binlogs > 15 min |
| Certificado | `openssl x509 -checkend $((30*86400))` | expira em < 30 dias |
| Cadeia de auditoria | email do worker + `pnpm ops:verify` semanal | qualquer quebra |
| Exportação da auditoria | `ls -t /srv/cpq/audit | head -1` com mais de 2 dias | alarme |
| Atualizações de segurança | `unattended-upgrades` ativo; `/var/run/reboot-required` | reiniciar na janela seguinte |

Revisão semanal (10 minutos): `docker compose ps`, `df -h`, eventos `FAILED`, último backup, último ensaio de restauro, expiração do certificado.

## 13. Resolução de problemas

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| Utilizador não consegue entrar: «Email ou palavra-passe incorretos» | Palavra-passe errada; utilizador inativo (a resposta é igual) | Confirmar utilizador ativo na lista; repor palavra-passe (9) |
| «Conta bloqueada por tentativas falhadas» (HTTP 423) | 5 falhas seguidas | Esperar 15 min ou **Desbloquear**. Ver tentativas em `audit_log` (`auth.locked`) |
| Muitas falhas de login do mesmo IP / HTTP 429 | Ataque ou cliente com palavra-passe errada; limite de 10 pedidos/min/IP | Rever Nginx/`audit_log`; bloquear o IP com `ufw deny from <ip>` |
| Todos os utilizadores são desligados de repente | `AUTH_JWT_SECRET` mudou ou a API reiniciou com outro segredo | Confirmar `api.env`; é esperado após rotação (9.1) |
| Toda a gente com erro 502 | API em baixo ou a arrancar | `docker compose ps`; `logs api` (procurar «Configuração inválida» ou erro de ligação à BD) |
| API não arranca: «AUTH_JWT_SECRET é obrigatório em produção» | Segredo em falta/curto (< 32) | Corrigir `api.env` |
| Documento fica em «A gerar…» / não gera | Worker parado, Redis em baixo, evento `PENDING`/`FAILED` | `docker compose ps`; `redis-cli ping`; consultas 4.4; `logs worker`; reiniciar o `worker`; ver `last_error` e 4.5 |
| Geração falha: «Variáveis por resolver» | Falta um dado (merge tag) na proposta/cliente | Preencher o dado no cliente/proposta e voltar a gerar (não é falha técnica) |
| Geração falha por permissões ou disco | `/srv/cpq/documents` cheio, sem permissão ou sem volume (L2) | `df -h /srv/cpq`; permissões da pasta; reprocessar o evento |
| Emails não saem | `SMTP_URL` em falta (mensagens vão para `.eml`), credenciais erradas, porta 587 bloqueada, remetente rejeitado | `logs worker` («evento ... falhou»); `grep SMTP /opt/cpq/worker.env`; teste a porta: `nc -zv smtp.exemplo.pt 587`; corrigir e reprocessar (4.5). Mensagens em `MAIL_OUTBOX_DIR` indicam SMTP não configurado |
| Cliente não recebe o email da proposta | Spam, endereço errado, evento `portal.invite` `FAILED` | Ver `outbox_events`; criar nova ligação e enviar de novo; ou copiar a ligação e enviá-la manualmente |
| Portal mostra aviso de certificado | Esperado (autoassinado) ou certificado expirado | Cliente confirma a impressão digital (indicada no portal e no email). Se expirou, renovar (8). Se a impressão digital não aparece: `TLS_CERT_FILE` mal definido ou sem volume (L2) |
| Portal: «Ligação inválida ou expirada» | Ligação revogada/expirada, proposta expirada ou revista | Criar nova ligação (separador **Portal do cliente**) |
| Portal: muitos pedidos (429) | Limite de 30/min por IP | Esperar; se for legítimo (cliente atrás de NAT), subir `PORTAL_RATE_PER_MINUTE` e o `limit_req` do Nginx |
| Proposta presa em «Aguarda aprovação» | Aprovador sem papel/equipa certos, SLA, delegação em falta | Ver pedido em **Aprovações → Mostrar todos (administrador)**; ver política; delegar ou cancelar e re-submeter; a tarefa `sla` escala sozinha |
| Proposta presa em «Em revisão» sem documento | Geração falhou ou está pendente | Ver evento `document.compile` do `aggregate_id` = id da proposta (4.4) |
| Envio bloqueado: «O ficheiro ... foi alterado em disco» | Alguém editou/trocou o ficheiro na pasta (hash ≠ `documents.sha256`) | Nunca editar diretamente a pasta. Regenerar o documento (cria ficheiros novos) ou descarregar, editar e **Carregar versão editada**; depois repetir aprovação se necessário. Se foi corrupção/acesso indevido, ver 10 e correr `ops:verify` |
| Envio bloqueado: `QUOTE_HASH_MISMATCH` / `DOCUMENT_HASH_MISMATCH` | Cotação ou documento mudou depois da aprovação | Voltar a editar e re-submeter para aprovação (comportamento previsto) |
| Documento marcado «Editado à mão» sem ninguém ter carregado | A tarefa `manual-edits` detetou hash diferente em `01_Trabalho` | Investigar acessos à pasta; regenerar |
| Disco cheio | Logs Docker sem rotação (L6), documentos, backups locais, binlogs, `mail-outbox` | `df -h`; `du -xh /var/lib/docker /var/log /var/backups/cpq | sort -h | tail`; `docker system prune` **só** de imagens/contentores não usados (nunca volumes); aumentar disco. Se for `/var/lib/mysql`, ver binlogs (retenção 3 dias) |
| MariaDB não arranca | Chaves de encriptação ausentes (`mariadb-keys` falhou), disco `/var/lib/mysql` não montado, disco cheio, corrupção | `systemctl status mariadb-keys mariadb`; `journalctl -u mariadb -u mariadb-keys -n 100`; verificar `/run/mariadb-keys/keys.txt` e `mount | grep mysql`. Se faltar o tmpfs após reinício, `systemctl restart mariadb-keys mariadb`. Sem as chaves: restauro (7.4) |
| Após reinício do servidor a BD não sobe | `keys.pass`/`keys.enc` em falta ou LUKS por abrir | Abrir o volume LUKS, `systemctl start mariadb-keys mariadb` |
| Fila parada (itens `PENDING` a envelhecer) | Worker parado, Redis em baixo/AOF corrompido | `docker compose ps`; `restart worker`; `redis-cli ping`; `logs redis`; o Redis recria-se, os eventos estão na BD (`outbox_events`) e são republicados pelo relay |
| Eventos em `PROCESSING` há muito tempo | Worker caiu a meio | Voltam sozinhos a `PENDING` após 10 min |
| Evento `FAILED` com «Sem processador para X» | Worker de versão mais antiga que a API | Atualizar o worker para a mesma *tag* e reprocessar |
| Tarefas periódicas não correm | `SCHEDULER_ENABLED` ligado mas Redis em baixo; lock Redis preso | `logs worker` («Scheduler»); `redis-cli --scan --pattern 'cpq:job:*'` (expiram sozinhos) |
| CRM recebe 401/403 | Chave revogada, errada ou sem âmbito | Ver ecrã **Integrações**; criar nova (9.2) |
| Migração falha ao aplicar | Erro SQL, `GET_LOCK` preso, privilégios | Mensagem do `pnpm db:migrate`; a migração falhada não fica registada em `_migrations`; corrigir e repetir; se parcialmente aplicada, restaurar o backup do passo 1 |
| Browser mostra a aplicação mas dados não carregam | `WEB_ORIGIN` incorreto (CORS) | Corrigir `api.env` e recriar a `api` |
| Hora «errada» nos registos | Tudo está em UTC | Esperado; a interface mostra no fuso do browser |

## 14. Rotinas de manutenção

| Quando | O quê |
| --- | --- |
| Diário | Alarmes (12); backup completo OK |
| Semanal | Revisão de 10 min (12); `pnpm ops:verify` |
| Mensal | Limpeza de `outbox_events` `DONE`; limpeza do destino de backups (L9); atualizações do sistema e reinício se `reboot-required`; revisão de utilizadores ativos |
| Trimestral | Ensaio de restauro (7.5) e registo (7.7); revisão das políticas de aprovação e de blocos jurídicos |
| Anual | Rotação de `AUTH_JWT_SECRET` e chaves de API **[Decisão]**; revisão de retenções RGPD; ponto de situação da expiração do certificado |
| 30 dias antes da expiração do certificado | Renovação (8) |

## 15. Registo de alterações e incidentes

Mantenha um registo simples (folha partilhada) com: data/hora UTC, quem, o quê e porquê, resultado. Obrigatório para atualizações, rotações de segredos, renovação de certificado, restauros, incidentes de auditoria e pedidos RGPD.

## 16. Lacunas encontradas no repositório (para decidir antes do go-live)

| # | Lacuna | Efeito | Sugestão |
| --- | --- | --- | --- |
| L1 | `docker-compose.yml.j2` define `AUTH_MODE: entra` e comenta «preenchido a partir do Secrets Manager»; o código já só usa autenticação local e a variável é ignorada | Texto enganador | Remover a variável e o comentário |
| L2 | O compose não monta volumes de documentos, auditoria e certificado | Perda de dados ao recriar contentores; impressão digital do certificado ausente | Acrescentar `volumes` à `api` e ao `worker` |
| L3 | O Ansible não configura LUKS, nem o disco `/srv/cpq`, nem as chaves de encriptação da MariaDB, nem cria a base, o utilizador `cpq` e o utilizador `backup` | Passos manuais críticos | Acrescentar tarefas ou documentar como pré-requisito (feito neste manual) |
| L4 | `ansible-vault` não é consumido; os `.env` não são criados pelo Ansible (a arquitetura previa `/etc/cpq/*.env`, o compose usa `/opt/cpq/*.env`) | Segredos criados à mão | Tarefa `copy` com ficheiros cifrados |
| L5 | O papel `nginx` só adiciona regras `allow` ao `ufw`; não define política por omissão nem `state: enabled` | Firewall pode ficar inativo (a API 3000 e o Redis 6379 usam a rede do anfitrião) | Verificar `sudo ufw status verbose`; se inativo: `sudo ufw default deny incoming && sudo ufw enable` (as regras 22/80/443 já existem) |
| L6 | Sem rotação de logs Docker; sem OpenTelemetry/Prometheus/alarmes; `/health` não testa BD/Redis | Disco cheio por logs; sem alertas | `daemon.json` (4.2); scripts de monitorização (12); estender o health |
| L7 | `FAILED` não gera alerta nem há ecrã de eventos; `portal.invite` falhado não é reprocessável | Falhas silenciosas | Alarme SQL (12); ecrã de administração (futuro) |
| L8 | Sem Dockerfiles nem pipeline de imagens (`cpq/api`, `cpq/worker`, `cpq/web`) | Não há forma reproduzível de produzir a versão a instalar | Criar antes do go-live |
| L9 | A retenção de 35 dias de backups não é aplicada no destino | Destino cresce sem limite | `find ... -mtime +35 -delete` no destino |
| L10 | Utilizador de BD só com `INSERT`/`SELECT` na auditoria não existe | Defesa em profundidade menor | Criar utilizadores de migração e de runtime separados |
| L11 | `restore-rehearsal.sh` só funciona no ambiente local (`cpq_dev`, `~/tools`) | O ensaio de produção é manual | Generalizar o script ou documentar (feito) |
| L12 | `SCHEDULER_ENABLED=false` não desliga o agendador (`z.coerce.boolean`) | Surpresa operacional | Corrigir a leitura da variável |
| L13 | A verificação da cadeia e a exportação correm de 6 em 6 h, não «noturna/diária» como na arquitetura | Diferença de texto | Alinhar o texto da arquitetura |
| L14 | `infra/RESTORE.md` não menciona as chaves de encriptação nem os binlogs cifrados | Restauro falha sem as chaves | Acrescentar (feito aqui, 7.4) |
