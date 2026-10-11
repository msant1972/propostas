# Importação de dados (CSV)

Ferramenta para a migração inicial de **clientes**, **produtos** e **preços**. Valida tudo antes de gravar, é repetível (idempotente) e tem modo de simulação.

```bash
pnpm data:import <tipo> <ficheiro.csv> [opções]
```

| Tipo | O que importa | Chave natural (para atualizar sem duplicar) |
| --- | --- | --- |
| `clients` | Clientes e respetivo contacto | código do cliente |
| `products` | Catálogo de produtos e serviços | SKU |
| `price-list-items` | Preços e escalões de uma lista de preços | lista + SKU + escalão (quantidade mínima) |

## Opções

| Opção | Efeito |
| --- | --- |
| `--dry-run` | Simula: mostra o que criaria, atualizaria e deixaria igual, sem gravar nada |
| `--skip-invalid` | Grava as linhas válidas e ignora as inválidas (por omissão, **um erro cancela tudo**) |
| `--delimiter ;` | Força o delimitador (por omissão deteta `,`, `;` ou tabulação) |
| `--report ficheiro.json` | Escreve o relatório em JSON |
| `--price-list "Nome"` | (só `price-list-items`) lista de preços de destino |
| `--create-list --currency EUR --valid-from AAAA-MM-DD` | Cria a lista se não existir (recusa sobreposições com listas existentes com os mesmos critérios) |

O comando usa a base de dados de `DATABASE_URL` e termina com código 1 se houver erros (sem `--skip-invalid`).

## Ordem recomendada

1. **Clientes** → 2. **Produtos** → 3. **Lista de preços** (os preços referem SKUs que já têm de existir).

```bash
pnpm data:import clients docs/importacao/clients.csv --dry-run     # ver o que vai acontecer
pnpm data:import clients docs/importacao/clients.csv
pnpm data:import products docs/importacao/products.csv
pnpm data:import price-list-items docs/importacao/price-list-items.csv \
  --price-list "Geral EUR" --create-list --currency EUR --valid-from 2026-01-01
```

## Formato dos ficheiros

UTF-8 (com ou sem BOM), CRLF ou LF, campos entre aspas quando têm delimitador, aspas (`""`) ou mudanças de linha. A primeira linha são os **cabeçalhos**; podem estar em português ou inglês, em qualquer ordem e com maiúsculas, acentos ou espaços (`Modelo de Cobrança` = `modelo_cobranca`). Colunas desconhecidas são ignoradas.

**Números**: aceita `1.234,56`, `12,5`, `12.5` e `1,234.56` (o último separador é o decimal), com ou sem `€`.

### clients

| Coluna (alias) | Obrigatória | Regras |
| --- | --- | --- |
| `codigo` (`code`) | sim | até 50 caracteres; único |
| `nome` (`name`) | sim | |
| `pais` (`country`) | sim | 2 letras ISO (PT, ES…) |
| `nif` (`vat`, `vat_number`) | não | |
| `tier` | não | |
| `contacto_nome` (`contact_name`) | não | dado pessoal: só o necessário |
| `contacto_email` (`contact_email`) | não | email válido; guarda-se em minúsculas |
| `id_crm` (`crm_external_id`) | não | único; liga ao CRM |

### products

| Coluna (alias) | Obrigatória | Regras |
| --- | --- | --- |
| `sku` | sim | até 50 caracteres; único |
| `nome` (`name`) | sim | |
| `modelo_cobranca` (`billing_model`) | sim | `PONTUAL`, `RECORRENTE`, `CONSUMO`, `MARCOS` (ou `ONE_TIME`, `RECURRING`, `USAGE_BASED`, `MILESTONE`) |
| `periodo` (`billing_period`) | só se recorrente | `MES`, `TRIMESTRE`, `ANO` (ou `MONTH`, `QUARTER`, `YEAR`) |
| `descricao`, `unidade` | não | unidade por omissão `UN` |
| `custo` (`unit_cost`) | não | ≥ 0; por omissão 0 |
| `moeda_custo` | não | 3 letras; por omissão `EUR` |
| `categoria_fiscal` | não | `STANDARD`, `REDUCED`, `EXEMPT`, `OUTSIDE_SCOPE`; por omissão `STANDARD` |
| `ativo` (`active`) | não | `sim`/`não` (também `1`/`0`, `true`/`false`); por omissão sim |

### price-list-items

| Coluna (alias) | Obrigatória | Regras |
| --- | --- | --- |
| `sku` | sim | tem de existir nos produtos |
| `preco` (`unit_price`) | sim | ≥ 0 |
| `escalao_min_qtd` (`min_quantity`) | não | quantidade mínima do escalão; por omissão 0. Não pode repetir o mesmo escalão do mesmo SKU |

## Ler o relatório

```
Importação de clients
  linhas: 5  criadas: 5  atualizadas: 0  inalteradas: 0  ignoradas: 0
```

- **criadas / atualizadas / inalteradas**: o que aconteceu a cada linha. Reexecutar o mesmo ficheiro dá tudo "inalteradas".
- **ignoradas**: linhas inválidas (só com `--skip-invalid`).
- Cada erro indica a **linha do ficheiro** (a 1 é o cabeçalho) e a **coluna**, p.ex. `✗ linha 4, coluna countryCode: País tem de ter 2 letras`.

Os ficheiros em `docs/importacao/` servem de exemplo; `clients-com-erros.csv` mostra o relatório de erros.

## Boas práticas de migração

1. Corra sempre primeiro com `--dry-run` e reveja as contagens.
2. Importe para um ambiente de teste, confira com a origem e só depois repita em produção.
3. Faça um backup antes da importação em produção (ver `infra/RESTORE.md`) e corra `pnpm ops:verify` depois.
4. Reconciliação: compare o número de linhas do CSV com `criadas + atualizadas + inalteradas`, e confira por amostragem preços e custos.
5. A importação não apaga nada: para retirar um produto, marque-o `ativo = não`.
