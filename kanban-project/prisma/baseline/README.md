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

**Resolvido em 02/08/2026:** as migrations foram consolidadas em
`0000_baseline` e as 112 antigas foram arquivadas. Ver *Consolidação* abaixo.

## Quando usar

- **Recuperação de desastre** — recriar o schema quando não há backup utilizável
- **Criar staging/homologação novo** do zero
- **Provar que o schema é reconstruível**, num banco descartável

**Não use** para o dia a dia. Migrations continuam sendo o mecanismo normal:
`prisma migrate deploy`. Este arquivo não é aplicado por nada automático.

---

## Consolidação de 02/08/2026

**O que era.** `prisma/migrations` tinha 112 migrations e o ledger de produção
(`_prisma_migrations`) havia sido reduzido a uma única linha, `0000_baseline`,
registrada em 02/08/2026 23:13:05 UTC. Repositório e ledger discordavam: um
`prisma migrate deploy` tentaria reaplicar as 112 sobre um banco que já tinha o
schema completo — e quebraria na sétima.

**O que é agora.**

| | |
|---|---|
| migration oficial | `prisma/migrations/0000_baseline/migration.sql` |
| checksum (sha256) | `8e30b94b9fa9100f2c993f93dfdae320a06ddc836246a217345ae48c45a72a47` |
| ledger de produção | 1 linha: `0000_baseline`, mesmo checksum, `finished_at` preenchido |
| migrations antigas | `prisma/migrations-arquivo/` (112, preservadas, nunca executadas) |
| commit de origem | consolidação feita sobre `955866c4` |

**Produção já estava no schema final.** Nada foi criado, alterado ou apagado no
banco para chegar aqui: o `migration.sql` é uma cópia byte a byte do
`baseline.sql`, cujo sha256 já era exatamente o checksum que a linha do ledger
carregava. Por isso **não houve escrita nenhuma em `_prisma_migrations`** — o
arquivo foi feito para casar com o registro, não o contrário.

`prisma migrate status` responde **"Database schema is up to date!"**, com uma
migration encontrada e nenhuma pendente.

**Divergências conhecidas entre o baseline e produção** — todas cosméticas,
levantadas por `prisma migrate diff` e deliberadamente NÃO corrigidas:

- 18 colunas `atualizadoEm` têm `DEFAULT` no banco; o schema usa `@updatedAt`
  (aplicado pela aplicação). Comportamento idêntico na prática.
- `uq_cotacao_confidence` (produção) × nome gerado pelo Prisma (baseline) —
  mesmas colunas, mesma semântica.
- Três `DEFAULT` de texto com acento corrompido **no `schema.prisma`**
  (`"PortuguÃªs"`, `"MÃ©dia"`, `"averbaÃ§Ã£o"`); produção tem o texto correto.
  É sujeira antiga do schema, não do banco. Corrigir exige migration própria e
  avaliação de impacto — não entrou nesta consolidação.

### Como criar migrations a partir daqui

Fluxo normal do Prisma, sem nenhuma cerimônia extra:

```bash
# 1. altere o prisma/schema.prisma
# 2. gere a migration contra um banco de desenvolvimento/teste (NUNCA produção)
npx prisma migrate dev --name descricao_curta

# 3. regenere o baseline — ele passa a incluir a mudança
npm run baseline:gerar

# 4. commite os três juntos: schema, migration nova e baseline
```

A migration nova nasce em `prisma/migrations/<timestamp>_<nome>/` e convive com
`0000_baseline`. Em produção ela é aplicada pelo guard oficial
(`MIGRATE_ON_BUILD=1` + `EU_CONFIRMO_ESCRITA_EM_PRODUCAO`, ver
`scripts/prod-migrate-guard.mjs`), que roda `prisma migrate deploy`: o Prisma vê
`0000_baseline` já aplicada e executa **somente** o que veio depois.

⚠️ **Regenerar o baseline muda o checksum quando o conteúdo muda.** O guard
`npm run test:baseline` (que roda no build) reprova nesse caso e explica o
procedimento: fazer backup do ledger, atualizar o checksum da linha
`0000_baseline` de forma explícita e auditada — sem tocar em schema nem em
dados — e só então atualizar a constante no teste, no mesmo commit. Nunca mude
só a constante.

O cabeçalho do arquivo carrega a data de geração, mas ela **só anda quando o
conteúdo anda**: regerar sem mexer no schema preserva a data e, portanto, o
checksum.

---

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

O comando escreve **dois** arquivos idênticos: `prisma/baseline/baseline.sql` e
`prisma/migrations/0000_baseline/migration.sql`. Eles são a mesma verdade em
dois lugares — o guard reprova se divergirem.

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

---

## Reconciliação de 03/08/2026 — escopo e execução do motor de fases

**Motivo.** O schema ganhou três colunas aditivas
(`PhaseInternalWorkflow.execucao`, `PhaseInternalWorkflowStep.escopo`,
`PhaseWorkflowStepInstance.pessoaId` + FK), então o baseline mudou e, com ele,
o checksum.

| | |
|---|---|
| checksum anterior | `379c12b2858a949928c9738d032a4864fbc37c9a87014d2429497710da9a4bea` |
| checksum atual | `a76297512de9484bcf1b4fbe01e2b77510217f8fad465b1969d0175c89dd58b5` |
| linha do ledger | `0000_baseline` — apenas a coluna `checksum` foi atualizada |
| backup do ledger | tirado antes da escrita (1 linha, conteúdo integral) |
| migration nova | `20260803_workflow_escopo_execucao` (aditiva e idempotente) |

Na mesma data, `20260803b_cardinalidade_passo` renomeou
`PhaseInternalWorkflowStep.escopo` para `cardinalidade` (nullable, sem default) —
o nome anterior colava a cardinalidade operacional do passo ao rótulo
"global (compartilhado)", que é o compartilhamento do WORKFLOW. Checksum do
baseline passou a `8e30b94b9fa9100f2c993f93dfdae320a06ddc836246a217345ae48c45a72a47`,
reconciliado no ledger com backup e sem tocar schema ou dados.

Nada de schema ou de dado foi alterado nessa reconciliação: `started_at`,
`finished_at` e `applied_steps_count` seguem os originais de 02/08/2026.
