# Checklist e plano do piloto

Piloto com um grupo reduzido de comerciais antes do go-live (tarefa 6.6 do [Planeamento](../Planeamento.md)). Complementa [IMPLANTACAO.md](IMPLANTACAO.md) e [OPERACAO.md](OPERACAO.md). Os nomes de botões e separadores são os da interface atual. Os valores marcados **[Decisão]** têm de ser fixados pelo negócio antes do arranque.

## 1. Objetivos

1. Confirmar que o percurso completo funciona com utilizadores reais e dados reais: cotar, gerar documento, aprovar, enviar, aceitação do cliente, comprovativo.
2. Medir se a ferramenta reduz o tempo para cotar e os erros face ao processo atual.
3. Apanhar defeitos e problemas de usabilidade antes de abrir a todos.
4. Treinar e validar a operação (formação, suporte, alarmes, backups) em condições reais.
5. Obter a decisão de go-live fundamentada.

## 2. Âmbito e organização

| Item | Proposta |
| --- | --- |
| Duração | 2 semanas úteis **[Decisão]** |
| Participantes | 4 a 6 comerciais (de pelo menos 2 equipas/regiões), 1 gestor comercial, 1 aprovador financeiro (+ substituto), 1 jurídico, 1 administrador. Nomes: ______ |
| Ambiente | Produção ou ambiente idêntico, com dados migrados (IMPORTACAO). Se for produção, as propostas reais do piloto seguem o fluxo completo |
| Propostas | Cada comercial cota no mínimo 5 propostas reais (ou cópias de propostas recentes) e 2 cenários de teste dedicados |
| Contingência | O processo atual continua disponível em paralelo; qualquer bloqueio é registado e, se urgente, resolvido pelo processo atual |
| Clientes | Só clientes avisados para propostas aceites em portal real **[Decisão]**; as restantes são testadas com contactos internos |
| Suporte | Canal único (ex.: grupo de mensagens + email), responsável de suporte por turno, resposta ≤ 2 h úteis **[Decisão]** |
| Reunião de ponto de situação | Diária, 15 minutos, na primeira semana; depois 2 vezes por semana |

## 3. Métricas

Registam-se numa folha partilhada, semanalmente.

| Métrica | Como medir | Meta do piloto **[Decisão]** |
| --- | --- | --- |
| Tempo para cotar | Cronometrar (o comercial) do início da cotação até «Bloquear versão» + documento gerado; comparar com o tempo médio atual (base de referência recolhida antes do piloto) | Redução ≥ ___ % |
| Tempo até ao envio | Da criação da proposta a `SENT` (data de criação vs `sent_at`; separador **Histórico**) | Mediana ≤ ___ |
| Tempo de aprovação | Do pedido à decisão, por nível | Dentro do SLA da política |
| Erros de preço | Cotações cujo valor difere do cálculo manual da Financeira (amostra de 20) | 0 |
| Erros de documento | Documentos com texto, valores ou formatação errados detetados antes/depois do envio | 0 depois do envio |
| Defeitos | Contagem por gravidade (secção 7) | 0 críticos; 0 graves abertos à saída |
| Disponibilidade | Tempo com a aplicação acessível em horário de expediente | ≥ 99,5 % |
| Geração de documentos | Tempo p95 (do pedido ao documento) e falhas | p95 < 60 s; falhas explicadas |
| Eventos `FAILED` | `SELECT COUNT(*) FROM outbox_events WHERE status='FAILED'` | 0 sem tratamento |
| Satisfação | Inquérito curto no fim (1 a 5): facilidade, rapidez, confiança nos preços, qualidade do documento; recomendação (sim/não) | Média ≥ 4 |
| Adoção | Propostas feitas na ferramenta / total de propostas dos participantes no período | ≥ ___ % |

## 4. Preparação (antes do arranque)

- [ ] Ensaio de restauro feito e `ops:verify` limpo (OPERACAO 7.5).
- [ ] Backups automáticos ativos; alarmes testados (OPERACAO 12).
- [ ] Dados migrados e reconciliados; catálogo, listas de preços, IVA, câmbios e regras revistos pela Financeira.
- [ ] Blocos de conteúdo aprovados (incluindo os jurídicos) e modelo `.docx` base por língua.
- [ ] Políticas de aprovação configuradas (**Políticas**), com níveis, SLAs e escalonamento; delegações de ausência combinadas.
- [ ] Utilizadores criados com o papel certo, equipa e região; palavras-passe temporárias entregues por canal seguro.
- [ ] SMTP real a funcionar (cada aprovador recebe um email de teste).
- [ ] Impressão digital do certificado registada e explicada aos contactos de teste.
- [ ] Formação dada (secção 8); guiões distribuídos.
- [ ] Linha de base medida (tempo atual para cotar, erros) para comparação.
- [ ] Registo de defeitos aberto e canal de suporte comunicado.

## 5. Cenários de teste por papel

Cada cenário tem identificador, passos e resultado esperado. O testador regista: data, quem, resultado (OK / falha / bloqueado), notas e referência do defeito.

### 5.1 Comercial

| ID | Cenário | Passos | Resultado esperado |
| --- | --- | --- | --- |
| C1 | Iniciar sessão e mudar palavra-passe | Entrar com a temporária; é forçado a mudar; definir nova (10+ caracteres, três tipos) | Entra; a palavra-passe temporária deixa de funcionar |
| C2 | Criar cliente | **Clientes → Novo cliente**; preencher código, nome, NIF, país, contacto e email | Cliente criado e pesquisável |
| C3 | Criar proposta | **Propostas → Nova proposta**: cliente, título, moeda, validade | Proposta em `Rascunho` com código atribuído |
| C4 | Cotar | Separador **Cotação**: adicionar linhas do catálogo, quantidade, duração, desconto; ver totais, IVA, MRR, TCV | Totais coerentes com o cálculo manual da Financeira; avisos/erros de regras visíveis |
| C5 | Regras e avisos | Pôr um desconto acima do permitido ou combinação inválida | A aplicação mostra o aviso/erro em **Avisos e erros** e não deixa avançar quando é erro |
| C6 | Guardar e bloquear | **Guardar rascunho**; **Bloquear versão** | Versão `Bloqueada`; **Verificar integridade** mostra «Integridade verificada» |
| C7 | Nova versão | Com a versão bloqueada, **Nova versão**; alterar | Nova versão; a anterior fica no histórico |
| C8 | Montar documento | Separador **Documento**: **Adicionar da biblioteca** (blocos aprovados), **Secção em branco**, reordenar, editar texto | Secções gravadas; conflito de edição mostra o aviso «alterada por outra pessoa» se duas pessoas editarem |
| C9 | Gerar documento | **Gerar documento** | Indicação «A gerar…» e depois DOCX e PDF em **Documentos gerados**; tempo < 60 s; descarregar e abrir os dois |
| C10 | Variável em falta | Gerar com um dado em falta (ex.: contacto) | Aviso «Variáveis por resolver»; nada é gerado até corrigir |
| C11 | Submeter para revisão e aprovação | **Submeter para revisão**, depois **Submeter para aprovação** | Estado `Aguarda aprovação` (ou `Aprovada` se nenhuma política se aplicar); aprovadores recebem email |
| C12 | Edição manual | Descarregar o DOCX, alterar no Word, **Carregar versão editada** | Documento marcado «Editado à mão»; a submissão pede confirmação |
| C13 | Enviar ao cliente | Com a proposta `Aprovada`, **Enviar ao cliente** | Estado `Enviada`; PDF/DOCX copiados para «Enviado» |
| C14 | Portal do cliente | Separador **Portal do cliente**: **Criar e enviar** para o email de teste | O cliente recebe o email com a ligação **e** a impressão digital do certificado |
| C15 | Acompanhamento | Depois de o contacto abrir | «N aberturas» e notificação «O cliente abriu a proposta» |
| C16 | Aceitação | O contacto aceita no portal | Proposta `Aceite`; comprovativo PDF gerado; notificação ao comercial |
| C17 | Recusa e nova ligação | O contacto recusa noutra proposta; criar nova ligação a outra | Proposta `Rejeitada`; ligações anteriores revogadas |
| C18 | Rever após envio | **Rever após envio** com motivo | Pede confirmação; ligação do portal revogada; nova versão |
| C19 | Cancelar | **Cancelar proposta** com motivo | Estado `Cancelada`; ligações revogadas |
| C20 | Visibilidade | Procurar propostas de outro comercial | Não as vê; também não vê custos/margens |

### 5.2 Gestor comercial

| ID | Cenário | Passos | Resultado esperado |
| --- | --- | --- | --- |
| G1 | Ver propostas da equipa | **Propostas** | Vê as da equipa (e da região) e as suas; não vê as de outras equipas |
| G2 | Ver custos e margens | Abrir cotação de um comercial da equipa | Vê custo e margem (o comercial não vê) |
| G3 | Decidir aprovação comercial | **Aprovações**, abrir, rever cotação/margem/documento/histórico; **Aprovar**, **Rejeitar** ou **Devolver** com comentário | Decisão registada; o comercial é notificado; devolver exige comentário |
| G4 | Delegar ausência | **Aprovações → Delegações**: delegar num colega por período | O delegado recebe os pedidos; aparece «em nome de» |
| G5 | Cancelar proposta da equipa | **Cancelar proposta** com motivo | Cancelada; pedidos abertos cancelados |
| G6 | Blocos de conteúdo | **Conteúdos**: criar bloco e nova versão | Bloco em rascunho até ser aprovado |

### 5.3 Financeiro (Aprovador financeiro)

| ID | Cenário | Passos | Resultado esperado |
| --- | --- | --- | --- |
| F1 | Receber pedido | Submeter proposta que viole a política (desconto > limite, margem baixa, valor alto) | Email com ligação direta à página de decisão |
| F2 | Rever e decidir | Abrir **Aprovações**: ver valores, margem, TCV, desconto máximo, política aplicada, documentos (PDF/DOCX) e histórico | Informação completa; decisão com comentário |
| F3 | Dois níveis | Política sequencial com 2 níveis | O 2.º nível só é pedido depois do 1.º aprovar |
| F4 | Atraso e escalonamento | Deixar o pedido passar o prazo do SLA | Em ≤ 1 minuto após o prazo: «Em atraso», aviso ao papel de escalamento |
| F5 | Invalidação | Depois de aprovada, o comercial altera a cotação e tenta enviar | A aprovação deixa de valer; **o envio é bloqueado** |
| F6 | Casos de referência | Cotar 10 casos da lista de 50 de referência (tarefa 0.2) | Valores iguais ao cêntimo |
| F7 | Preços e regras | **Catálogo/Preços**: alterar uma lista de preços ou regra (se tem permissão) | Efeito nas novas cotações; as bloqueadas não mudam |

### 5.4 Jurídico

| ID | Cenário | Passos | Resultado esperado |
| --- | --- | --- | --- |
| J1 | Gerir blocos jurídicos | **Conteúdos**: criar bloco marcado «Jurídico», nova versão, **Aprovar**, **Retirar** | Só blocos aprovados aparecem na biblioteca das propostas |
| J2 | Alteração de bloco jurídico | O comercial altera o texto de um bloco jurídico numa proposta | Aviso «Bloco jurídico alterado: exigirá aprovação do Jurídico»; ao submeter surge pedido de âmbito Jurídica |
| J3 | Decidir pedido jurídico | **Aprovações**: abrir, ver o texto alterado, decidir com comentário | Decisão registada; só com todos os pedidos aprovados se pode enviar |
| J4 | Revisão de validade | Ver blocos com «Revisão em atraso» | Lista identifica blocos para rever |

### 5.5 Administrador

| ID | Cenário | Passos | Resultado esperado |
| --- | --- | --- | --- |
| A1 | Criar utilizador | **Utilizadores → Novo utilizador** sem palavra-passe | Palavra-passe temporária mostrada uma vez; o utilizador tem de a mudar |
| A2 | Alterar papéis | Mudar o papel de um utilizador com sessão aberta | A sessão dele termina de imediato |
| A3 | Bloqueio e desbloqueio | Errar a palavra-passe 5 vezes; **Desbloquear** | Conta bloqueada («423»), depois desbloqueada |
| A4 | Repor palavra-passe | **Repor palavra-passe** | Nova temporária; sessões terminadas; mudança obrigatória |
| A5 | Último administrador | Tentar desativar o único administrador | Recusado |
| A6 | Políticas | **Políticas**: criar/alterar política (condição, níveis, SLA, escalamento) | Aplicada às novas submissões |
| A7 | Chave de API do CRM | **Integrações**: criar chave, testar `POST .../integrations/crm/clients` e `GET .../proposals`, revogar | Chave mostrada uma só vez; após revogar devolve 401 |
| A8 | RGPD | **Direitos do titular**: exportar e anonimizar um titular de teste | JSON gerado; anonimização irreversível, decisão e hashes mantidos |
| A9 | Operação | Verificar saúde, filas e outbox; provocar um `FAILED` e reprocessá-lo (OPERACAO 4.4–4.5) | Procedimento funciona; `last_error` percetível |
| A10 | Backup e restauro | Confirmar backup da noite; restauro em servidor de teste (OPERACAO 7.5) | RTO/RPO dentro das metas; `ops:verify` sem problemas |
| A11 | Atualização | Aplicar uma versão de correção com migração (se houver) com o procedimento 6.2 | Sem perda de dados, tempo de paragem conforme planeado |
| A12 | Integridade e auditoria | `pnpm ops:verify` | «Integridade verificada: sem problemas» |

### 5.6 Transversais (equipa do piloto)

| ID | Cenário | Resultado esperado |
| --- | --- | --- |
| T1 | Pico de geração: 5 comerciais a gerar documentos ao mesmo tempo | Todos concluem; p95 < 60 s |
| T2 | Cotação de 200 linhas | Cálculo e gravação < 500 ms no servidor; interface fluida |
| T3 | Reiniciar o worker a meio de uma geração | Nada se perde; o evento é repetido |
| T4 | Cliente abre o portal com o aviso do certificado e compara a impressão digital | Impressão digital igual à do certificado; cliente consegue continuar |
| T5 | Link do portal expirado/revogado | «Ligação inválida ou expirada»; não aceita resposta |
| T6 | Tentativa de enviar com documento alterado em disco (pelo administrador, em ambiente de teste) | Envio bloqueado: «O ficheiro ... foi alterado em disco» |
| T7 | Browsers e dispositivos usados pelo grupo (incluindo o do cliente no telemóvel) | Funciona; sem erros visuais graves |

## 6. Critérios de saída do piloto

Todos obrigatórios:

- [ ] Todos os cenários dos papéis executados pelo menos uma vez, com resultado registado.
- [ ] **Sem defeitos críticos abertos**; defeitos graves resolvidos ou com contorno aceite pelo negócio.
- [ ] Zero erros de preço na amostra (secção 3) e zero documentos errados enviados.
- [ ] Nenhuma proposta com hash/documento divergente enviada ao cliente.
- [ ] Metas de tempo e satisfação atingidas ou desvio justificado e aceite **[Decisão]**.
- [ ] Nenhum evento `FAILED` por tratar; backups OK durante todo o piloto; ensaio de restauro final feito.
- [ ] Pelo menos uma proposta de ponta a ponta com cliente real em portal (aceite ou recusada) com comprovativo.
- [ ] Participantes confirmam que sabem trabalhar (inquérito) e que os guiões bastam.
- [ ] Dimensionamento revisto com a utilização observada (IMPLANTACAO secção 2).

## 7. Registo de defeitos

Gravidade:

| Nível | Definição | Exemplo | Tratamento |
| --- | --- | --- | --- |
| Crítico | Perda/corrupção de dados, valor ou documento errado enviado ao cliente, bloqueio total de um fluxo, falha de segurança | Total diferente do cálculo; aprovação contornada | Bloqueia o go-live; correção imediata |
| Grave | Função importante falha sem contorno aceitável | Email de aprovação não sai | Corrigir antes do go-live |
| Médio | Função falha mas há contorno | Ordenação errada | Corrigir ou planear |
| Menor | Cosmético ou texto | Gralha numa etiqueta | Backlog |

Modelo de registo (uma linha por defeito, folha partilhada):

| ID | Data | Reportado por | Cenário | Gravidade | Passos para reproduzir | Esperado / obtido | Proposta/ecrã (anexo) | Responsável | Estado (novo, em análise, corrigido, verificado, recusado) | Versão corrigida |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P-001 | | | | | | | | | | |

Para o suporte técnico, junte sempre: hora (UTC), utilizador, código da proposta, mensagem de erro e, se existir, o evento em `outbox_events` (`last_error`).

## 8. Formação por perfil (guiões curtos)

Formato: sessão prática de 45 a 60 minutos por perfil, em pequenos grupos, no ambiente do piloto, com um guia de uma página. Todos começam por: entrar, mudar a palavra-passe, navegar (menu **Catálogo, Clientes, Propostas, Conteúdos, Aprovações**).

### 8.1 Comercial (60 min)

1. (10 min) O percurso: Rascunho → Em revisão → Aguarda aprovação → Aprovada → Enviada → Aceite/Rejeitada. Porque é que se bloqueia a versão.
2. (20 min) Cotar: criar proposta, adicionar linhas, descontos, avisos e erros; guardar; bloquear; nova versão.
3. (15 min) Documento: secções da biblioteca, edição, variáveis em falta, **Gerar documento**, descarregar. Regra de ouro: **não editar ficheiros diretamente na pasta do servidor**; para afinar o texto, descarregar, editar e **Carregar versão editada**.
4. (10 min) Submeter, acompanhar aprovação, **Enviar ao cliente**, portal, aberturas, aceitação, comprovativo. O que dizer ao cliente sobre o aviso do certificado e a impressão digital.
5. (5 min) A quem pedir ajuda e como reportar um defeito.

### 8.2 Gestor comercial (45 min)

Tudo o do comercial resumido, mais: ver a equipa, custos e margens, decidir aprovações (aprovar, rejeitar, devolver; comentário obrigatório), delegar nas ausências, cancelar propostas, entender SLAs e escalonamento.

### 8.3 Aprovador financeiro (30 min)

Receber o email, abrir a página de decisão, ler valores/margem/TCV/desconto máximo/política, abrir o documento, decidir com comentário; níveis sequenciais; delegação; o que acontece se a cotação ou o documento mudar depois de aprovado (aprovação invalidada). Como rever listas de preços e regras.

### 8.4 Jurídico (30 min)

Biblioteca de blocos: criar, versionar, aprovar, retirar, marcar «Jurídico», revisão obrigatória; como chega um pedido jurídico (bloco jurídico alterado numa proposta); decidir com comentário.

### 8.5 Administrador (90 min)

Utilizadores e papéis; desbloquear e repor palavras-passe; equipas; políticas de aprovação; chaves de API do CRM; RGPD (exportar/anonimizar); estado do sistema, filas e eventos `FAILED`; backups, ensaio de restauro e `ops:verify`; atualizações e rollback; certificado e impressão digital; incidentes de auditoria. Material: [OPERACAO.md](OPERACAO.md).

### 8.6 Material de apoio

Guia de uma página por perfil; vídeo curto do percurso comercial (opcional); lista de perguntas frequentes alimentada pelo piloto; contactos de suporte.

## 9. Calendário do piloto

| Dia | Atividade |
| --- | --- |
| D-5 a D-1 | Preparação (secção 4), formação por perfil, linha de base |
| D1 | Arranque; acompanhamento presencial/remoto |
| D1 a D5 | Ponto de situação diário; correção rápida de defeitos |
| D6 a D10 | Uso normal; recolha de métricas; um ensaio de restauro; um teste de atualização |
| D10 | Inquérito de satisfação; fecho do registo de defeitos |
| D11 | Reunião de decisão de go-live |

## 10. Decisão de go-live

Reunião com Direção Comercial, Financeira, Jurídico, TI e responsável do projeto.

| Item | Verificação | Resultado |
| --- | --- | --- |
| Critérios de saída (secção 6) | Todos cumpridos | Sim / Não |
| Métricas (secção 3) | Metas atingidas | Sim / Não / Parcial |
| Defeitos críticos | 0 abertos | Sim / Não |
| Defeitos graves | 0 abertos ou contorno aceite | Sim / Não |
| Critérios de aceitação de [IMPLANTACAO.md](IMPLANTACAO.md) secção 8 | Todos cumpridos | Sim / Não |
| Lacunas L2, L5, L6, L8, L9 do manual | Resolvidas ou risco aceite | Sim / Não |

Decisão: ☐ **Go** ☐ **Go condicionado** (condições e prazos: ______) ☐ **No-go** (novo piloto/correções, nova data: ______).

Assinaturas e data: Direção Comercial ______ · Direção Financeira ______ · Jurídico ______ · TI/Operação ______ · Gestor do projeto ______.
