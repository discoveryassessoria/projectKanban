# Auditoria & Refatoração MDM — documento de trabalho

> Arquivo de trabalho (seção 2 da spec). NÃO precisa entrar no commit sem autorização.
> Nenhuma migration aplicada. Nenhum dado tocado. Execução **incremental por lote**.
> Contexto: branch `refactor/arquitetura-mdm`, HEAD `000f4fd`, working tree limpo no início.

## Regra máxima
Cadastro mestre **define** a entidade; **consumidores** configuram o uso e referenciam por ID.
Mestre nunca contém preço/custo/fornecedor/fase/gatilho/aplicabilidade.

---

## 1. Inventário (matriz canônica) — provado por grep/leitura

| Conceito | Model Prisma | Tabela | API | Tela | Screen key | Consumidores |
|---|---|---|---|---|---|---|
| **Tipo de Documento** (mestre ✅) | `TipoDocumentoCadastro` (schema:2221) | sim | `/api/gerenciamento/tipos-documento[/:id]` GET/POST/PUT/DELETE | `TiposDocumentoTab` | `doctypes` | Documento.documentTypeId, matriz-documental, aplicabilidade-economica, processos/custos, documentos API, `document-type-resolver`, `catalogo`, `necessidade-documental` (~11) |
| **Categoria Documental** | ❌ **não existe model** | ❌ | ❌ | select hardcoded | — | `TipoDocumentoCadastro.category` (String), `document-type-resolver` |
| Categoria (origem real) | — | — | — | array `CATEGORIES` em `TiposDocumentoTab.tsx:7` + `op_certtypes` (gerenciamentoCatalogs) | — | string livre |
| Natureza documental | col `TipoDocumentoCadastro.nature` (String, `documento\|certidao\|…`) | sim | retornada no GET (findMany) | — | `nature` já populada via `seed-lote-c-tipos.ts` |
| **Tipos de Certidão** (legado) | ❌ scaffold sem tabela | ❌ | ❌ (salvar() no-op) | `CatalogTab` (`op_certtypes`) | `certtypes` → **hidden + alias→doctypes** (feito) | NENHUM |
| Serviço | `TipoServico`(?) / `ServicoProduto`(1836) / `ProdutoFinanceiro`(1714) | a confirmar | a auditar | `ProdutosServicosTab` (`products`), `ProdutosTab` (`catalog`) | `products`,`catalog` | financeiro, workflow (a mapear) |
| Catálogo Mestre financeiro | `ItemCatalogo` (2391) | sim | catálogo API | `CatalogoMestreTab` | `catalogmestre` | TipoServico.itemCatalogoId, TipoDocumentoCadastro.itemCatalogoId, PhaseEconomicRule |
| Tabela de Preços | `TabelaValor`(1745)/`Custo`/`Receita`/`PhaseEconomicRule` | sim | financeiro | `TabelaValoresTab` | `pricingtable` | lançamentos financeiros |
| Fornecedor | `Fornecedor` (817) | sim | fornecedores API | `FornecedoresTab`/`FornecedoresConcentradoraTab` | `suppliers`/`fornecedoresconc` | ContaPagar, Custo, financeiro |
| Templates Diversos | `Template`? (a confirmar) | ? | ? | `TemplatesTab` | `templates` | a mapear |
| Perfis/Permissões | `Perfil`(1061)/`permissoes.ts` | sim | `/api/me/permissoes` | `RolesTab` (ambos `roles` e `permprofiles`) | `roles`,`permprofiles` | auth (usePermissoes) |

> Itens marcados "a confirmar/auditar" = **NÃO verificados** neste lote (ver seção F do relatório).

---

## 2. Decisões canônicas (direção-alvo)
- **Documentos**: `TipoDocumentoCadastro` é o mestre único. Categoria vira tabela `CategoriaDocumental` (hoje é string). Certidão = TipoDocumento com `nature="certidao"` (não cadastro paralelo — já consolidado).
- **Serviços**: um mestre de Serviço puro (sem itens financeiros/preço/nacionalidade-como-config). Produto só sobrevive se for entidade distinta comprovada. **Requer auditoria de `ProdutoFinanceiro`/`ServicoProduto`/`TipoServico` antes de mexer** (há 3 models candidatos — risco alto de consolidar errado).
- **Catálogo Mestre (`ItemCatalogo`)**: descontinuar a TELA, mas **tem consumidores ativos** (`TipoServico.itemCatalogoId`, `TipoDocumentoCadastro.itemCatalogoId`, `PhaseEconomicRule`) → **não pode ser escondido sem redirecionar consumidores**; só ocultar a tela + bloquear novo cadastro após mapear.
- **Tabela de Preços / Workflow financeiro / Lançamentos / Idempotência / Reversão**: mudanças de **schema financeiro central** — alto risco, exigem migration + backfill + testes dedicados; **não implementar sem lote próprio**.

---

## 3. LOTE A — CategoriaDocumental: MIGRATION PREPARADA (aditiva, NÃO aplicada)

**Fonte atual:** `TipoDocumentoCadastro.category String?` (valores: `civil_registry|identity|judicial|consular|translation|apostille|other`) + array hardcoded no front.

**Estratégia aditiva (seção 21):** tabela nova → coluna nullable → seed → backfill → FK → dual-read. Coluna `category` legada **mantida**.

### 3.1 Schema (a adicionar em schema.prisma — NÃO aplicado neste turno)
```prisma
model CategoriaDocumental {
  id           Int      @id @default(autoincrement())
  code         String   @unique @db.VarChar(40)
  name         String   @db.VarChar(120)
  description  String?  @db.Text
  ordem        Int      @default(0)
  ativo        Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  tipos        TipoDocumentoCadastro[] // back-relation
}
// em TipoDocumentoCadastro: + categoriaDocumentalId Int?  + relação (FK nullable, ON DELETE SET NULL)
// coluna legada `category String?` PERMANECE (dual-read).
```

### 3.2 SQL da migration (aditivo, sem DROP)
```sql
CREATE TABLE "CategoriaDocumental" (
  "id" SERIAL PRIMARY KEY,
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "CategoriaDocumental_code_key" ON "CategoriaDocumental"("code");

-- seed das 7 categorias atuais (idempotente por code)
INSERT INTO "CategoriaDocumental" ("code","name","ordem","updatedAt") VALUES
  ('civil_registry','Registro civil',10,now()),
  ('identity','Identidade',20,now()),
  ('judicial','Judicial',30,now()),
  ('consular','Consular',40,now()),
  ('translation','Tradução',50,now()),
  ('apostille','Apostila',60,now()),
  ('other','Outro',70,now())
ON CONFLICT ("code") DO NOTHING;

-- coluna nullable + FK (nullable ⇒ linhas existentes com NULL são válidas)
ALTER TABLE "TipoDocumentoCadastro" ADD COLUMN "categoriaDocumentalId" INTEGER;
CREATE INDEX "TipoDocumentoCadastro_categoriaDocumentalId_idx" ON "TipoDocumentoCadastro"("categoriaDocumentalId");
ALTER TABLE "TipoDocumentoCadastro"
  ADD CONSTRAINT "TipoDocumentoCadastro_categoriaDocumentalId_fkey"
  FOREIGN KEY ("categoriaDocumentalId") REFERENCES "CategoriaDocumental"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```
> **FK = RESTRICT** (não SET NULL): alinha o banco à regra (categoria em uso não é
> excluível) e impede desclassificação silenciosa por SQL cru. A tabela tem `sistema`
> (7 sementes `sistema=true`, code imutável, não-excluíveis).

### 3.3 Backfill (dry-run default, idempotente, sem apagar)
```
npm run backfill:document-categories -- --dry-run   # relatório: mapeados/órfãos/conflitos, sem escrita
npm run backfill:document-categories                # escreve só categoriaDocumentalId (dupla trava BACKFILL_EXECUTE=1)
```
Regra: `UPDATE TipoDocumentoCadastro SET categoriaDocumentalId = (SELECT id FROM CategoriaDocumental WHERE code = TipoDocumentoCadastro.category) WHERE category IS NOT NULL AND categoriaDocumentalId IS NULL`. Valores de `category` sem categoria correspondente → **órfãos reportados** (nunca inventa). Contagens antes/depois; valida que 100% dos `category` conhecidos vincularam.

### 3.4 Rollback
`DROP CONSTRAINT ...fkey; DROP INDEX ...idx; ALTER TABLE ... DROP COLUMN "categoriaDocumentalId"; DROP TABLE "CategoriaDocumental";` (coluna `category` legada permanece intacta → zero perda).

### 3.5 App (após migration+backfill — próximo passo do LOTE A)
API `/api/gerenciamento/categorias-documentais` (CRUD + guardas: dup 409, em-uso 409, archive/reactivate); tela `CategoriasDocumentaisTab` + item `Categorias Documentais` na sidebar (Documentos); `DocumentCategorySelector` (API-driven) substitui o array hardcoded no modal de Tipo de Documento (dual-read: FK primeiro, `category` string como fallback).

---

> **Decisão canônica (definitiva):** `CategoriaDocumental` é a FONTE CANÔNICA da
> classificação, consumida **por ID/code** por toda a camada oficial de resolução
> (`document-type-resolver` expõe `categoriaDocumentalId`/`code`/`nome`). `nature` é
> eixo distinto (subtipo). `category` legado = compat transitória. Passo a passo de
> execução em [`lote-a-runbook-execucao.md`](./lote-a-runbook-execucao.md).

## 4. Status por lote
- **LOTE A**: código completo e validado (tsc/tests/build verdes); migration/backfill preparados; **nada aplicado**. Mestre ligado ao resolver oficial (consumo por ID); grade/seletor por FK; guardas de code/sistema/exclusão; filtro Certidões estruturado por `nature`. Falta só aplicar migration + backfill (autorização).
- **LOTE B (Serviços/Produto)**: **bloqueado até auditoria** de `ProdutoFinanceiro`/`ServicoProduto`/`TipoServico` (3 candidatos) e mapeamento de "itens financeiros vinculados" + consumidores. DECISÃO NECESSÁRIA.
- **LOTE C (Catálogo Mestre/Tabela de Preços/Unidades)**: **ItemCatalogo tem consumidores ativos** (não ocultar sem redirecionar). Refatorar Tabela de Preços mexe em financeiro central. Lote próprio.
- **LOTE D (efeitos financeiros no Workflow + idempotência + lançamentos)**: schema financeiro novo + reversão. Alto risco. Lote próprio com testes dedicados.
- **LOTE E (Templates/Fornecedores/Perfis)**: Perfis (`roles`/`permprofiles` = mesmo componente) e Fornecedores (`suppliers`/`fornecedoresconc`) precisam de decisão de consolidação por semântica; Templates precisa mapear consumidores antes de ocultar.
