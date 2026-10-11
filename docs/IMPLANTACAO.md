# Plano de colocação em produção

Plano para passar o CPQ de QA a produção num único servidor Ubuntu. Complementa o [manual de operação](OPERACAO.md) (comandos) e o [plano do piloto](PILOTO.md). Itens marcados **[Decisão]** dependem do negócio ou da direção; **[Lacuna Lx]** remete para a secção 16 do manual de operação (coisas que o repositório ainda não faz).

## 1. Pré-requisitos

| Área | Requisito | Responsável | Estado |
| --- | --- | --- | --- |
| Servidor | Ubuntu Server LTS, acesso SSH por chave, utilizador com `sudo`, UTC | Infraestrutura | ☐ |
| Discos | Disco 1: sistema. Disco 2: base de dados (XFS, LUKS preparado à mão, **[Lacuna L3]**). Disco 3: `/srv/cpq` (documentos e auditoria). Os dois de dados separados do sistema | Infraestrutura | ☐ |
| Destino de backups | Servidor ou disco **fora** deste servidor (rsync por SSH ou partilha montada), chave SSH do `root` autorizada, pastas `full/`, `binlogs/`, `documents/`, `audit/`, cifrado | Infraestrutura | ☐ |
| Rede | Portas 22 (restrita a IPs de administração), 80 e 443 de entrada; saída para repositórios apt/Docker/MariaDB e para o SMTP | Redes | ☐ |
| DNS | Nome (ex.: `propostas.exemplo.pt`) para o servidor; nome interno e, se os clientes acedem de fora, nome público | Redes | ☐ |
| SMTP | Servidor/relay, utilizador, porta 587, endereço remetente com SPF/DKIM para o domínio | TI / Email | ☐ |
| Imagens | `cpq/api`, `cpq/worker`, `cpq/web` com *tag* fixa **[Lacuna L8]** | Equipa de desenvolvimento | ☐ |
| Segredos | Cofre da organização com: `AUTH_JWT_SECRET`, palavra-passe da BD, palavra-passe SMTP, `keys.enc`/`keys.pass` da MariaDB, palavra-passe do `ansible-vault` | Segurança | ☐ |
| Estação de administração | Ansible, Node 24, pnpm, `git`, acesso SSH ao servidor | Administração | ☐ |
| Pessoas | Administrador principal e substituto; responsável pelos backups; contacto de suporte | Direção | ☐ |
| Decisões de negócio | Limites das políticas de aprovação (0.1), línguas e modelos `.docx` (0.4), dono dos dados de cliente/CRM (0.6), retenções RGPD | Direção, Financeiro, Comercial | ☐ |

## 2. Dimensionamento inicial recomendado

Valores de partida, **provisórios**; os números definitivos virão de [DESEMPENHO.md](DESEMPENHO.md) (testes de carga da tarefa 6.1). Não os trate como medidos.

| Recurso | Recomendação inicial | Justificação |
| --- | --- | --- |
| CPU | 4 vCPU | A geração de DOCX/PDF e o `scrypt` das palavras-passe são os trabalhos intensivos; o worker corre 5 jobs em paralelo na fila `events`; o MariaDB, o Nginx e o Redis partilham os mesmos núcleos |
| RAM | 16 GB | Limites dos contentores: API 2 GB + worker 1 GB + Redis 1 GB (= 4 GB) + *buffer pool* da MariaDB 4 GB (valor de `group_vars/all.yml`) + MariaDB/SO/Nginx/cache de ficheiros. 8 GB seria o mínimo absoluto; 16 GB deixa margem para picos de geração |
| Disco do sistema | 60 GB SSD | SO, imagens Docker, logs (com rotação, ver L6), `/var/backups/cpq` (temporário: cabe um backup completo comprimido) |
| Disco da base de dados | 100 GB SSD cifrado | Tamanho do catálogo e das propostas é pequeno, mas há binlogs (3 dias, cifrados) e o backup físico temporário; reavaliar com os dados reais da migração (6.4) |
| Disco de documentos e auditoria | 200 GB | Os ficheiros nunca são sobrescritos (cada geração cria DOCX+PDF novos); o crescimento = propostas × versões × tamanho médio. Estimar: nº de propostas/ano × versões médias × (DOCX+PDF) e multiplicar por 3 anos |
| Destino de backups | ≥ 3× (BD + documentos) | 35 dias de completos comprimidos + binlogs + cópia cumulativa de documentos e auditoria |
| Rede | 100 Mbit/s é suficiente | Documentos até 25 MB (limite do Nginx) |

Revisão: após o piloto, comparar a utilização (`df`, `free`, `docker stats`, tempos de geração) com estes valores e ajustar `mariadb_buffer_pool_size` e os `mem_limit` do compose.

## 3. Sequência de instalação

1. Preparar discos, LUKS e chaves da MariaDB (OPERACAO 3.1).
2. Preencher inventário e `group_vars/all.yml` (`environment_name: prod`, nomes DNS, `app_image_tag` fixa) (OPERACAO 3.2).
3. Criar os `.env` com `ansible-vault` (OPERACAO 3.3).
4. `ansible-playbook site.yml` (OPERACAO 3.4); anotar a impressão digital do certificado.
5. Criar base, utilizadores `cpq` e `backup` (OPERACAO 2.5), aplicar migrações, criar o administrador (OPERACAO 3.7).
6. Corrigir as lacunas de infraestrutura (L2 volumes, L5 firewall, L6 rotação de logs, L9 limpeza no destino) **antes** de entrar dados reais.
7. Primeiro backup completo manual e primeiro **ensaio de restauro** num servidor de teste (OPERACAO 7.5), com `ops:verify`.
8. Configurar a monitorização e os alarmes (OPERACAO 12) e testar cada um uma vez de propósito (parar o worker, encher um `tmp`, etc.).

## 4. Checklist de segurança antes do go-live

Revisão formal de segurança e teste de intrusão: tarefa 6.3, documentada em [SEGURANCA.md](SEGURANCA.md) (em curso, por outra equipa). Esta lista é o mínimo operacional.

- [ ] `AUTH_JWT_SECRET` gerado com `openssl rand -base64 48`, só em `api.env`, e guardado no cofre; a API recusa arrancar em produção sem ele ou com o de desenvolvimento.
- [ ] `/opt/cpq/api.env` e `worker.env`: dono `root`, modo `0640`. Nada de segredos no repositório (`git grep -nE "password|secret"` sem valores reais).
- [ ] `pnpm db:seed` **não** foi executado; não existem utilizadores de demonstração (`comercial@exemplo.pt`, ..., palavra-passe `Demo-Pass-2026!`): `SELECT email FROM users;`.
- [ ] Administrador inicial com palavra-passe mudada; pelo menos 2 administradores ativos.
- [ ] `sudo ufw status verbose` ativo, política de entrada negar, só 22/80/443 **[Lacuna L5]**; SSH restrito a IPs de administração, sem palavra-passe (`PasswordAuthentication no`), `fail2ban` ativo (`systemctl status fail2ban`).
- [ ] Portas 3000, 3306, 6379 e 8081 não acessíveis a partir de fora: `nmap -p 22,80,443,3000,3306,6379,8081 <servidor>` a partir de outra rede.
- [ ] Cabeçalhos: `curl -skI https://propostas.exemplo.pt` mostra `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`; `http://` redireciona para HTTPS; TLS 1.0/1.1 recusados.
- [ ] Certificado com nomes DNS/IP corretos; impressão digital registada; alarme de expiração ativo (OPERACAO 8).
- [ ] MariaDB: só `127.0.0.1`, tabelas cifradas (`SELECT NAME, ENCRYPTION_SCHEME FROM information_schema.INNODB_TABLESPACES_ENCRYPTION LIMIT 5;`), `keys.enc`/`keys.pass` com cópia fora do servidor.
- [ ] Utilizador de BD da aplicação com palavra-passe forte e única; avaliar utilizadores separados de migração/runtime **[Lacuna L10]**.
- [ ] Documentos fora da raiz do Nginx e só acedidos via API; permissões da pasta `/srv/cpq` restritas ao utilizador do serviço.
- [ ] Logs Docker com rotação; `unattended-upgrades` ativo.
- [ ] Backups a correr (timers ativos), destino cifrado e **separado**, ensaio de restauro feito e registado.
- [ ] SMTP real configurado e testado; nenhum `.eml` a acumular.
- [ ] `pnpm audit --audit-level=high` limpo na versão a instalar (o CI já o faz); CodeQL sem alertas abertos.
- [ ] `ops:verify` sem problemas após a migração de dados.
- [ ] Políticas de aprovação revistas e aprovadas pela Direção Financeira **[Decisão]**; blocos jurídicos aprovados pelo Jurídico.

## 5. Migração de dados

Plano e ferramentas: [IMPORTACAO.md](IMPORTACAO.md) (tarefa 6.4, em curso, por outra equipa). Pontos operacionais:

1. Ensaiar a migração em QA com cópia dos dados reais; guardar o relatório de reconciliação.
2. **Backup completo manual imediatamente antes** da migração de produção (OPERACAO 7.2).
3. Executar a migração em janela combinada; durante ela, a aplicação está fechada aos utilizadores.
4. Reconciliar (contagens e amostras com o negócio) e correr `pnpm ops:verify`.
5. Se a reconciliação falhar: restaurar o backup do passo 2 (OPERACAO 7.4) e repetir.
6. Só depois de aceite, abrir a aplicação e criar os utilizadores.

## 6. Plano de comunicação

| Quando | Para quem | Conteúdo | Quem envia |
| --- | --- | --- | --- |
| 4 semanas antes | Piloto | Convite, objetivos, calendário, formação (ver PILOTO) | Gestor do projeto |
| 2 semanas antes | Todos os utilizadores | Data do go-live, o que muda, formação por perfil, onde pedir ajuda | Direção Comercial |
| 1 semana antes | Todos | Lembrete, ligação e primeiros passos (palavra-passe temporária e mudança obrigatória) | Gestor do projeto |
| Dia D | Todos | Sistema aberto; canal de suporte; horário de acompanhamento reforçado | Gestor do projeto |
| Dia D+1, D+7 | Todos | Estado, problemas conhecidos, correções | Gestor do projeto |
| Antes de comunicar a clientes | Clientes com propostas | Explicação do portal e da impressão digital do certificado; mensagem tipo para o contacto | Comerciais **[Decisão: texto e aprovação]** |

Canal de suporte, horário e tempos de resposta a definir **[Decisão]**. Em incidente: comunicação imediata aos utilizadores com estado e próxima atualização.

## 7. Plano de retorno (rollback)

Critério de decisão: o go-live é revertido se, nas primeiras horas, ocorrer qualquer defeito crítico (perda ou corrupção de dados, proposta enviada com valor/documento errado, impossibilidade de aprovar ou enviar, falha de segurança) sem correção prevista em 4 horas. Decisor: Direção do projeto **[Decisão: nomear]**.

| Situação | Retorno |
| --- | --- |
| Defeito na aplicação sem dano nos dados | Voltar à *tag* anterior das imagens (OPERACAO 6.3); aplicação nova nunca aplicou migração, ou a migração é compatível |
| Migração problemática | `pnpm db:migrate down` (se `down.sql` seguro, ver OPERACAO 6.3) ou restauro do backup tirado antes da migração |
| Dados corrompidos ou migração de dados falhada | Restauro do backup pré-migração (RTO alvo ≤ 4 h) e nova tentativa |
| Reversão total ao processo anterior | O processo manual atual (documentos e folhas atuais) mantém-se disponível durante o período de transição; propostas criadas entretanto no CPQ são exportadas (PDFs em `02_Enviado`) e continuadas manualmente |

Durante as duas primeiras semanas mantém-se o processo anterior como contingência, **[Decisão]** da Direção Comercial.

## 8. Critérios de aceitação de go-live

Todos obrigatórios, verificados e registados:

| # | Critério | Evidência |
| --- | --- | --- |
| 1 | Piloto concluído sem defeitos críticos abertos (e sem graves sem plano) | Registo de defeitos do PILOTO |
| 2 | Decisão formal de go-live assinada pela Direção Comercial, Financeira e TI | Ata |
| 3 | Ensaio de restauro completo feito, RTO ≤ 4 h e RPO ≤ 15 min medidos, `ops:verify` sem problemas | Registo 7.7 |
| 4 | Metas de desempenho medidas e cumpridas | [DESEMPENHO.md](DESEMPENHO.md) |
| 5 | Checklist de segurança (secção 4) integralmente cumprida e revisão de segurança sem achados críticos/altos abertos | [SEGURANCA.md](SEGURANCA.md) |
| 6 | Migração de dados reconciliada e aceite pelo negócio | Relatório de IMPORTACAO |
| 7 | Backups automáticos observados durante ≥ 7 dias seguidos sem falhas | Logs dos timers |
| 8 | Monitorização e alarmes testados | Registo dos testes |
| 9 | Utilizadores criados e formados (por perfil) | Lista de presenças |
| 10 | Políticas de aprovação e blocos jurídicos aprovados pelo negócio | Atas |
| 11 | Lacunas L2, L5, L6, L8, L9 resolvidas (ou decisão formal de risco aceite) | Registo |
| 12 | Plano de retorno e contactos de suporte comunicados | Comunicação |

## 9. Calendário-tipo (a ajustar)

| Semana | Atividade |
| --- | --- |
| S-6 a S-4 | Servidor, Ansible, lacunas de infraestrutura, primeiro ensaio de restauro, monitorização |
| S-4 a S-2 | Migração de dados em QA, formação do piloto, piloto (2 semanas, ver PILOTO) |
| S-2 | Correção de defeitos, reavaliação do dimensionamento, ensaio de restauro final, decisão de go-live |
| S-1 | Migração de produção, formação geral, comunicação |
| S0 | Go-live; acompanhamento reforçado; revisão a D+7 e D+30 (inclui revisão de custos, tarefa 6.7) |
