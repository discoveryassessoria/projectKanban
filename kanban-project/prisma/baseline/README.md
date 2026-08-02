# Baseline consolidado

`baseline.sql` recria o banco do Discovery **do zero**, num Postgres vazio.

## Por que isto existe

O histórico de migrations **não reconstrói o banco**. Testado em 02/08/2026 num
banco virgem: o replay das 111 migrations morre na sétima —

```
Applying migration `20260113180000_add_tipo_registro_custo`
Error: P3018 · 42P01 · relation "CustoPessoa" does not exist
```

Ela faz `ALTER TABLE "CustoPessoa"`, e **nenhuma migration do repositório cria
essa tabela**. Não é caso isolado: 81 das 165 tabelas de produção não têm
`CREATE TABLE` versionado. O histórico é um log incremental escrito sobre um
banco que já existia — nunca foi um build a partir do zero.

Enquanto isso não for resolvido de vez (consolidar as migrations num
`0000_baseline`), este arquivo é o único caminho de reconstrução.

## Quando usar

- **Recuperação de desastre** — recriar o schema quando não há backup utilizável
- **Criar staging/homologação novo** do zero
- **Provar que o schema é reconstruível**, num banco descartável

**Não use** para o dia a dia. Migrations continuam sendo o mecanismo normal:
`prisma migrate deploy`. Este arquivo não é aplicado por nada automático.

## Como aplicar

```bash
npx prisma db execute --url "<URL_DO_BANCO_VAZIO>" --file prisma/baseline/baseline.sql
```

O alvo precisa estar **vazio**. Prove antes:

```bash
PRISMA_DATABASE_URL="<URL>" node scripts/db-guard.mjs --url-env PRISMA_DATABASE_URL --exigir nao-producao
```

O baseline instala `btree_gist` sozinho — não precisa preparar nada.

## Como regenerar

```bash
npm run baseline:gerar
```

Sempre que o `prisma/schema.prisma` mudar. Se esquecer, o build falha com
instruções — ver `scripts/baseline-verificar.test.ts`.

## Estrutura

O `baseline.sql` é **derivado**. Não edite à mão: será sobrescrito.

```
cabeçalho        gerado por scripts/baseline-gerar.mjs (data + versão do Prisma)
corpo            gerado do schema.prisma via `prisma migrate diff --from-empty`
bloco manual     conteúdo de bloco-manual.sql  ← EDITE AQUI
```

`bloco-manual.sql` guarda o que o Prisma não consegue expressar:

| objeto | por quê |
|---|---|
| `btree_gist` | extensão exigida pela exclusion constraint |
| `discovery_iso_to_date()` | função usada pela exclusion constraint |
| `NomePessoa_um_principal_ativo` | unique **parcial** (`WHERE principal AND ativo`) |
| `TabelaValor_config_contexto_ativo_key` | unique parcial com `COALESCE` |
| `TabelaValor_vigencia_sem_sobreposicao_excl` | **exclusion constraint** GiST |
| `CustoPessoa_..._key` | `UNIQUE NULLS NOT DISTINCT` — o Prisma só gera `NULLS DISTINCT` |

O gerador **nunca lê** o `baseline.sql`, só escreve. Por isso o bloco manual não
pode ser perdido numa regeneração: a fonte dele é outro arquivo.

A **ordem importa**: extensão → função → índices → constraints.

## Validar

Depois de regenerar, vale provar num banco descartável:

1. Crie um Postgres vazio e prove que está virgem (0 tabelas, sem `btree_gist`)
2. Aplique o `baseline.sql` **inteiro, numa passada** — se precisar de duas, não
   serve como artefato de recuperação
3. Compare com produção: tabelas, enums, campos, tipos, FKs, exclusion
   constraint, funções e índices

O passo 3 precisa ir além de contagens. Na validação de 02/08/2026, models,
campos, tipos, FKs e o total de índices batiam — e ainda assim o baseline estava
**mais fraco** que produção: faltava o `NULLS NOT DISTINCT` num unique, o que só
apareceu comparando a definição textual do índice. Compare `indexdef`, não só
nomes.

Foram necessários quatro bancos virgens para chegar ao arquivo atual. Cada um
pegou algo que o anterior não pegava.

## Divergência conhecida

Produção tem o unique de `CotacaoCambio` sob o nome manual
`uq_cotacao_confidence`; o baseline o cria como
`CotacaoCambio_moedaDe_moedaPara_dataReferencia_modalidade_o_key`. **Mesmas
colunas, mesma ordem, mesma semântica** — só o nome difere. É cosmético.

Renomear é trivial (`ALTER INDEX ... RENAME`, sem rebuild), mas o nome legado
pode aparecer em `DROP INDEX IF EXISTS` de migrations idempotentes ou em
`ON CONFLICT ON CONSTRAINT`. Grepe antes de mexer.

## Não incluído de propósito

As extensões `pg_stat_statements`, `pgcrypto` e `uuid-ossp` existem em produção
mas ficam fora. Nenhuma coluna usa `gen_random_uuid()`, `uuid_generate_v4()` ou
`crypt()` — são observabilidade e legado do provedor, não dependência do schema.
