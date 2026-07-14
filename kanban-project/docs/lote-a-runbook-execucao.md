# LOTE A — Runbook de execução (Categorias Documentais)

> **Este é o documento OPERACIONAL** (como aplicar). A decisão arquitetural e o
> estado por lote ficam em [`auditoria-refatoracao-mdm.md`](./auditoria-refatoracao-mdm.md).
>
> **Estado atual:** código pronto e validado (tsc/tests/build verdes). **Nada foi
> aplicado em banco, nada commitado, nada em produção.**

## Decisão arquitetural (canônica)
- **`CategoriaDocumental` = FONTE CANÔNICA** da classificação documental, consumida
  **por ID** (`categoriaDocumentalId`) ou **code estável** para lógica técnica.
  Agrupamento administrativo/estrutural do documento (ex.: "Registro Civil").
- **`nature` (naturezaDocumental) = eixo DISTINTO**: subtipo técnico dentro da
  categoria (ex.: `CERTIDAO_NASCIMENTO`). "Registro Civil" contém várias naturezas
  → não duplica a categoria. Se algum `nature` só repetir a categoria, é candidato a
  descontinuação (não remover neste lote; parar de usá-lo como fonte concorrente).
- **`category` (string legada) = compatibilidade transitória.** Não editável pela UI
  nova; mantido só enquanto houver consumidor legado.
- Ponte única legado↔code: `src/lib/document-category-map.ts` (usada por dual-write,
  resolver, backfill, proteção de exclusão e testes — nunca duplicar o mapa).

### Condições de descontinuação do legado
- **Remover DUAL-READ** (parar de ler `category`): quando 100% dos `TipoDocumento`
  tiverem `categoriaDocumentalId` e 100% das certidões tiverem `nature`.
- **Remover DUAL-WRITE** (parar de gravar `category`): quando nenhum consumidor
  legado ler mais a coluna (`document-type-resolver` já expõe a fonte canônica).
- **Remover a COLUNA `category`/`nature` legada**: só após dual-read e dual-write
  removidos, em migração destrutiva própria e autorizada.

## Pré-requisitos
- Definir as variáveis de conexão do banco ALVO no ambiente:
  - `PRISMA_DATABASE_URL` (datasource `url`)
  - `DIRECT_DATABASE_URL` (datasource `directUrl`, usado por `migrate deploy`)
- **Nunca** apontar para produção sem autorização explícita. Preferir staging.
- Backup recomendado antes de aplicar em qualquer banco com dados reais:
  `pg_dump "$DIRECT_DATABASE_URL" -Fc -f backup-pre-lote-a.dump`

## Passo 1 — Conferir o que será aplicado (sem aplicar)
```bash
# diff schema-a-schema (offline, não precisa de banco):
npx prisma migrate diff \
  --from-schema-datamodel <schema-sem-lote-a>.prisma \
  --to-schema-datamodel prisma/schema.prisma --script

# OU, com banco configurado, o status das migrations pendentes:
npx prisma migrate status
```
A migration `20260713120000_categoria_documental` deve aparecer como pendente.

## Passo 2 — Aplicar a migration (aditiva, não-destrutiva)

> ⚠️ **Drift do histórico:** a cadeia de migrations do repo NÃO replaya do zero
> (migration antiga `add_tipo_registro_custo` referencia `CustoPessoa`). Em bancos
> onde as migrations anteriores já constam aplicadas, `migrate deploy` aplica só a
> do LOTE A e funciona. Se `migrate deploy` reclamar de drift/pendências antigas,
> **use o caminho cirúrgico** (valida sem mexer no histórico quebrado):

**Opção A — canônica (se o histórico estiver limpo):**
```bash
npx prisma migrate deploy
```
**Opção B — cirúrgica (recomendada se houver drift):**
```bash
export PGURL='<DIRECT_DATABASE_URL do banco alvo>'
pg_dump "$PGURL" -Fc -f backup-pre-lote-a.dump   # backup antes (bancos com dados)
psql "$PGURL" -v ON_ERROR_STOP=1 -f prisma/migrations/20260713120000_categoria_documental/migration.sql
npx prisma migrate resolve --applied 20260713120000_categoria_documental  # registra sem reexecutar
```
Ambas aplicam: CREATE TABLE `CategoriaDocumental` (com `sistema`) + índice único de
`code` + seed das 7 categorias (`sistema=true`) + `ADD COLUMN categoriaDocumentalId`
(nullable) + índice + FK `ON DELETE RESTRICT`. **Não** remove a coluna legada
`category`. Gerar o client após aplicar (se necessário): `npx prisma generate`.

> Conexão via `prisma dev`/pooler pode exigir `?pgbouncer=true` na URL (evita o erro
> `42P05 prepared statement already exists`). Prisma Postgres/Accelerate de produção
> normalmente não precisa.

> **Ordem em produção:** migration (Passo 2) + backfill (Passos 3–4) **antes** de
> promover o deploy do código — o app novo referencia `categoriaDocumental`/`sistema`.

## Passo 3 — Backfill em DRY-RUN (não escreve nada)
```bash
npm run backfill:document-categories:dry
```
Lê `TipoDocumentoCadastro.category`, mapeia para `categoriaDocumentalId` e imprime o
relatório (total / já vinculados / a vincular / sem categoria / desconhecidos /
conflitos). **Aborta sem escrever** se houver qualquer valor fora dos 7 conhecidos.
Revisar o relatório antes de prosseguir.

## Passo 4 — Backfill REAL (dupla trava obrigatória)
```bash
BACKFILL_EXECUTE=1 npm run backfill:document-categories
```
Só grava `categoriaDocumentalId` (a FK); **não** toca `category`, `name`, `nature`,
status etc. Idempotente: reexecuções pulam registros já vinculados.

## Passo 5 — Validar
- API: `GET /api/gerenciamento/categorias-documentais` retorna as 7 categorias.
- Tela: Gerenciamento → Documentos → **Categorias Documentais** lista e permite CRUD.
- Tipos de Documento: o seletor de categoria carrega da API; salvar grava a FK e
  mantém `category` legado em sincronia (dual-write).

## Mapeamento legado → code (fonte única: `src/lib/document-category-map.ts`)
| category (legado) | CategoriaDocumental.code |
|---|---|
| civil_registry | REGISTRO_CIVIL |
| identity | IDENTIDADE |
| judicial | JUDICIAL |
| consular | CONSULAR |
| translation | TRADUCAO |
| apostille | APOSTILA |
| other | OUTRO |

## Rollback (se necessário)
SQL documentado no rodapé de
`prisma/migrations/20260713120000_categoria_documental/migration.sql`:
DROP CONSTRAINT → DROP INDEX → DROP COLUMN → DROP TABLE.
A coluna legada `category` permanece intacta → **zero perda de dados**.

## Restrições (mantidas)
Não usar `db push` nem `migrate reset`. Não apagar coluna legada, tabela ou
registros. Não aplicar em produção sem autorização explícita.
