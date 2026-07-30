/**
 * MRG — GUARDA DE ARQUITETURA e de NÃO-ALTERAÇÃO VISUAL.
 * Rodar: npx tsx scripts/mrg-arquitetura-guard.test.ts
 *
 * Este arquivo trava, em teste, as decisões que uma refatoração futura desfaz
 * sem perceber:
 *
 *  1. O VISUAL DA ÁRVORE NÃO MUDA. Os arquivos de interface da árvore têm
 *     hash registrado em `tests/manifesto-visual-arvore.json`. Qualquer byte
 *     alterado reprova — e a mensagem diz exatamente qual arquivo.
 *  2. O motor registral PURO não importa Prisma, React nem rede.
 *  3. A árvore NÃO duplica o Sistema Documental: nenhuma tabela nova guarda
 *     arquivo, status documental ou pasta paralela.
 *  4. Ninguém escreve status de necessidade fora do serviço oficial.
 *  5. A migração é ADITIVA (sem DROP/RENAME/TRUNCATE) e idempotente.
 *  6. Não há TODO/FIXME/stub/mock no código do motor.
 *  7. Toda permissão do motor existe no catálogo oficial de permissões.
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string, detalhe?: unknown) {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe)}` : ""}`)
  }
}

const RAIZ = join(__dirname, "..")
const APROVAR = process.argv.includes("--aprovar")

function ler(p: string): string {
  return readFileSync(join(RAIZ, p), "utf8")
}
function arquivos(dir: string, exts = [".ts", ".tsx"]): string[] {
  const out: string[] = []
  const abs = join(RAIZ, dir)
  if (!existsSync(abs)) return out
  const andar = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      if (e.isDirectory()) andar(full)
      else if (exts.some((x) => e.name.endsWith(x))) out.push(relative(RAIZ, full))
    }
  }
  andar(abs)
  return out.sort()
}
function sha(conteudo: string): string {
  return createHash("sha256").update(conteudo).digest("hex")
}

// ============================================================================
console.log("\n1) VISUAL DA ÁRVORE — nenhum byte alterado")

/**
 * Superfície visual da Árvore Genealógica. Se um arquivo entra aqui, ele é
 * intocável pelo motor registral: o motor conversa por API e por evento, nunca
 * mexendo em componente, layout, token ou texto de tela.
 */
const SUPERFICIE_VISUAL = [
  ...arquivos("src/components/arvore"),
  ...arquivos("src/lib/genealogia/layout"),
  ...arquivos("src/lib/genealogia/navegacao"),
  ...arquivos("src/app/arvore-render"),
  ...arquivos("src/app/genealogy"),
].filter((f) => !f.endsWith(".md"))

ok(SUPERFICIE_VISUAL.length > 10, `superfície visual localizada (${SUPERFICIE_VISUAL.length} arquivos)`)

const DIR_MANIFESTO = join(RAIZ, "tests")
const ARQ_MANIFESTO = join(DIR_MANIFESTO, "manifesto-visual-arvore.json")

const atual: Record<string, string> = {}
for (const f of SUPERFICIE_VISUAL) atual[f] = sha(ler(f))

if (APROVAR || !existsSync(ARQ_MANIFESTO)) {
  mkdirSync(DIR_MANIFESTO, { recursive: true })
  writeFileSync(
    ARQ_MANIFESTO,
    `${JSON.stringify(
      {
        _leiaMe:
          "Hash SHA-256 de cada arquivo da superfície visual da Árvore Genealógica. Regenerar SÓ quando a mudança visual for intencional e aprovada: npx tsx scripts/mrg-arquitetura-guard.test.ts --aprovar",
        arquivos: atual,
      },
      null,
      2,
    )}\n`,
  )
  console.log(`  ℹ️  manifesto ${APROVAR ? "REGRAVADO" : "criado"} com ${SUPERFICIE_VISUAL.length} arquivos`)
  ok(true, "manifesto visual da árvore registrado")
} else {
  const salvo = JSON.parse(readFileSync(ARQ_MANIFESTO, "utf8")) as { arquivos: Record<string, string> }
  const alterados = Object.keys(atual).filter((f) => salvo.arquivos[f] && salvo.arquivos[f] !== atual[f])
  const removidos = Object.keys(salvo.arquivos).filter((f) => !atual[f])
  const novos = Object.keys(atual).filter((f) => !salvo.arquivos[f])

  ok(alterados.length === 0, "nenhum arquivo visual da árvore foi alterado", alterados)
  ok(removidos.length === 0, "nenhum arquivo visual da árvore foi removido", removidos)
  ok(novos.length === 0, "nenhum arquivo visual novo foi introduzido na árvore", novos)
}

// Reforço independente do manifesto: o próprio git.
try {
  const saida = execFileSync("git", ["status", "--porcelain", "--", "src/components/arvore", "src/app/arvore-render", "src/lib/genealogia/layout", "src/lib/genealogia/navegacao"], {
    cwd: RAIZ,
    encoding: "utf8",
  }).trim()
  const linhas = saida ? saida.split("\n").filter((l) => l.trim() && !l.trim().endsWith(".md")) : []
  ok(linhas.length === 0, "git confirma: nenhuma modificação nos diretórios visuais da árvore", linhas)
} catch {
  console.log("  ℹ️  git não disponível neste ambiente — checagem por manifesto permanece válida")
}

// ============================================================================
console.log("\n2) MOTOR PURO — sem Prisma, sem React, sem rede")
const PUROS = arquivos("src/lib/genealogia/registral")
ok(PUROS.length >= 12, `motor puro tem ${PUROS.length} módulos`)

for (const f of PUROS) {
  const src = ler(f)
  ok(!/from ["']@prisma\/client["']/.test(src) && !/from ["']@\/lib\/prisma["']/.test(src), `${f}: sem Prisma`)
  ok(!/from ["']react["']/.test(src) && !/from ["']next\//.test(src), `${f}: sem React/Next`)
  ok(!/\bfetch\(/.test(src) && !/from ["']node:/.test(src), `${f}: sem rede e sem API de nó`)
}

// Determinismo: os módulos puros não podem depender de tempo nem de aleatório.
for (const f of PUROS) {
  const src = ler(f)
  ok(!/Math\.random\(/.test(src), `${f}: sem Math.random (quebraria idempotência)`)
  ok(!/Date\.now\(/.test(src), `${f}: sem Date.now (o instante entra por parâmetro)`)
}

// ============================================================================
console.log("\n3) A ÁRVORE NÃO DUPLICA O SISTEMA DOCUMENTAL")
const schema = ler("prisma/schema.prisma")
const blocoMrg = schema.slice(schema.indexOf("MRG — MOTOR REGISTRAL GENEALOGICO"))
ok(blocoMrg.length > 1000, "bloco MRG localizado no schema")

for (const proibido of ["arquivo_url", "arquivo_nome", "arquivo_tamanho", "arquivo_mime_type", "StatusDocumento"]) {
  ok(!blocoMrg.includes(proibido), `nenhuma entidade do MRG guarda ${proibido}`)
}
ok(!/model\s+\w*Pasta\w*Registral/.test(blocoMrg), "nenhuma pasta documental paralela")
ok(!/model\s+DocumentoRegistral/.test(blocoMrg), "nenhuma cópia de Documento")
ok(blocoMrg.includes("documentoId"), "as entidades do MRG apenas REFERENCIAM o documento")
ok(blocoMrg.includes("necessidadeId"), "e referenciam a NecessidadeDocumental")
ok(blocoMrg.includes("itemCatalogoId"), "e o Documento Mestre (ItemCatalogo)")

// Transcrição pertence ao Documento (Sistema Documental), não a uma tabela da árvore.
ok(
  /model Documento \{[\s\S]*?transcricaoTexto/.test(schema),
  "a transcrição mora no Documento, não numa tabela da árvore",
)
ok(!/model\s+TranscricaoDocumento/.test(schema), "nenhuma tabela de transcrição paralela")

// ============================================================================
console.log("\n4) STATUS DOCUMENTAL — só pelo serviço oficial")
const SERVICOS = arquivos("src/services/registral")
ok(SERVICOS.length >= 10, `camada de serviço tem ${SERVICOS.length} módulos`)

for (const f of SERVICOS) {
  const src = ler(f)
  // Escrever status de necessidade direto é o atalho que cria a segunda fonte de verdade.
  const escreveStatusNecessidade = /necessidadeDocumental\.(update|updateMany|upsert|create)\s*\(/.test(src)
  ok(
    !escreveStatusNecessidade,
    `${f}: não escreve NecessidadeDocumental direto (usa o serviço do domínio)`,
  )
}
const reconc = ler("src/services/registral/reconciliacao-documental.ts")
ok(
  reconc.includes("atenderNecessidade") && reconc.includes("@/src/services/necessidade-documental"),
  "a reconciliação documental usa os serviços oficiais do Sistema Documental",
)
const aplicar = ler("src/services/registral/aplicar.ts")
ok(
  aplicar.includes("garantirNecessidade") && aplicar.includes("reabrir"),
  "o aplicador cria/reabre necessidade pelo serviço oficial",
)
ok(
  aplicar.includes("adicionarNome") && aplicar.includes("cadastro-mestre/nome-pessoa"),
  "alias é gravado pelo serviço oficial de nomes (MDM-5), não direto na tabela",
)

// ============================================================================
console.log("\n5) MIGRAÇÃO ADITIVA E IDEMPOTENTE")
const DIR_MIG = "prisma/migrations/20260830100000_mrg_motor_registral_genealogico"
ok(existsSync(join(RAIZ, DIR_MIG, "migration.sql")), "migração do MRG existe")
const sqlBruto = ler(`${DIR_MIG}/migration.sql`)
// Comentários citam as palavras proibidas (é o cabeçalho que documenta a garantia);
// a verificação tem de olhar só as INSTRUÇÕES.
const sql = sqlBruto.replace(/^\s*--.*$/gm, "")

const DESTRUTIVOS = [
  /DROP\s+TABLE/i,
  /DROP\s+COLUMN/i,
  /DROP\s+CONSTRAINT/i,
  /DROP\s+INDEX/i,
  /DROP\s+TYPE/i,
  /TRUNCATE/i,
  /\bDELETE\s+FROM\b/i,
  /ALTER\s+COLUMN\s+\w+\s+TYPE/i,
  /RENAME\s+(TO|COLUMN)/i,
  /ALTER\s+TABLE\s+"?\w+"?\s+RENAME/i,
]
for (const re of DESTRUTIVOS) {
  ok(!re.test(sql), `migração sem ${re.source}`)
}
ok(sqlBruto.includes("MRG - MOTOR REGISTRAL GENEALOGICO"), "migração documenta a garantia aditiva no cabeçalho")
ok(sql.includes("CREATE TABLE IF NOT EXISTS"), "tabelas criadas com IF NOT EXISTS")
ok(sql.includes("ADD COLUMN IF NOT EXISTS"), "colunas adicionadas com IF NOT EXISTS")
ok(sql.includes("CREATE INDEX IF NOT EXISTS") || sql.includes("CREATE UNIQUE INDEX IF NOT EXISTS"), "índices idempotentes")
ok(/IF NOT EXISTS \(SELECT 1 FROM pg_type/.test(sql), "enums criados de forma idempotente")
ok(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint/.test(sql), "constraints criadas de forma idempotente")

// A ÚNICA tabela existente tocada é Documento, e só com colunas nullable.
const alters = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1])
const alvosDeAdd = [...sql.matchAll(/ALTER TABLE "(\w+)" ADD COLUMN IF NOT EXISTS/g)].map((m) => m[1])
ok(new Set(alvosDeAdd).size <= 1 && (alvosDeAdd.length === 0 || alvosDeAdd[0] === "Documento"), "só Documento recebeu coluna nova", [...new Set(alvosDeAdd)])
ok(!/ADD COLUMN IF NOT EXISTS\s+"\w+"[^,;]*NOT NULL(?!\s+DEFAULT)/i.test(sql), "nenhuma coluna nova é NOT NULL sem default")
ok(alters.length > 0, "migração contém as instruções esperadas")

// ============================================================================
console.log("\n5b) ANÁLISE DE RISCO DA MIGRATION — sem falso positivo, sem buraco")
// `analisarRisco` é a fonte única do aviso do guard de produção. Um alerta que
// dispara à toa treina quem lê o log a ignorá-lo — e um que não dispara deixa
// passar o que importa. Os dois lados ficam travados aqui.
const { analisarRisco, semComentarios } = require("../lib/db/leitura-migrations.mjs") as {
  analisarRisco: (sql: string) => string[]
  semComentarios: (sql: string) => string
}

const CASOS: Array<[string, boolean, string]> = [
  ["-- esta migration nao contem DROP TABLE\nCREATE TABLE x();", false, "comentário de linha citando DROP não é destrutivo"],
  ["/* DROP COLUMN documentado */ ALTER TABLE a ADD COLUMN IF NOT EXISTS b int;", false, "comentário de bloco citando DROP não é destrutivo"],
  ["CREATE TABLE IF NOT EXISTS x (id serial);", false, "criação de tabela é segura"],
  ["ALTER TABLE a ADD COLUMN IF NOT EXISTS b int;", false, "coluna nova é segura"],
  ["DROP TABLE x;", true, "DROP TABLE real é detectado"],
  ["DROP INDEX i;", true, "DROP INDEX é detectado"],
  ["ALTER TABLE a DROP CONSTRAINT c;", true, "DROP CONSTRAINT é detectado"],
  ["ALTER TABLE a RENAME COLUMN b TO c;", true, "RENAME é detectado"],
  ["ALTER TABLE a ALTER COLUMN b TYPE text;", true, "troca de tipo é detectada"],
  ["TRUNCATE x;", true, "TRUNCATE é detectado"],
  ["DELETE FROM x WHERE 1=1;", true, "DELETE FROM é detectado"],
  ["UPDATE x SET y = 1;", true, "UPDATE de dado é detectado"],
  ["DO $$ BEGIN DROP TABLE x; END $$;", true, "DROP dentro de bloco DO NÃO escapa"],
  ["EXECUTE 'DROP TABLE x';", true, "SQL dinâmico destrutivo NÃO escapa"],
]
for (const [sql, arriscado, nome] of CASOS) {
  ok(analisarRisco(sql).length > 0 === arriscado, nome, analisarRisco(sql))
}
ok(
  semComentarios("DO $$ BEGIN DROP TABLE x; END $$;").includes("DROP"),
  "semComentarios NÃO remove bloco $$ (removê-lo abriria um buraco)",
)
ok(
  semComentarios("EXECUTE 'DROP TABLE x';").includes("DROP"),
  "semComentarios NÃO remove literal entre aspas (idem)",
)
ok(
  analisarRisco(ler(`${DIR_MIG}/migration.sql`)).length === 0,
  "a migration do MRG é classificada como NÃO arriscada",
  analisarRisco(ler(`${DIR_MIG}/migration.sql`)),
)
const smokeProd = ler("scripts/prod-smoke-registral.ts")
ok(smokeProd.includes("withRetry") && smokeProd.includes("db-retry"), "o smoke de produção usa retry de conexão")
ok(
  !/await prisma\.\$queryRaw</.test(smokeProd),
  "nenhuma consulta do smoke roda fora do retry (deploy correto não cai por saturação)",
)

const guardProd = ler("scripts/prod-migrate-guard.mjs")
ok(guardProd.includes("analisarRisco"), "o guard de produção usa a fonte única de análise")
ok(!/const DESTRUTIVO\s*=/.test(guardProd), "e não mantém uma cópia própria da regex")

// ============================================================================
console.log("\n6) SEM TODO / STUB / MOCK no código do motor")
const TODO_CODIGO = [...PUROS, ...SERVICOS, ...arquivos("src/app/api/registral"), ...arquivos("src/app/api/cron/registral")]
for (const f of TODO_CODIGO) {
  const src = ler(f)
  for (const marca of ["TODO", "FIXME", "HACK", "XXX", "NOT IMPLEMENTED", "@ts-ignore", "@ts-nocheck"]) {
    // Fronteira de palavra: "TODOS os caminhos" não é um TODO pendente.
    const re = new RegExp(`\\b${marca.replace(/[@]/g, "@")}\\b`)
    ok(!re.test(src), `${f}: sem "${marca}"`)
  }
  ok(!/\bany\b\s*[;),=]/.test(src.replace(/\/\/.*$/gm, "")), `${f}: sem tipo any solto`)
  ok(!/=>\s*\{\s*\}/.test(src), `${f}: sem função vazia`)
  ok(!/console\.log\(/.test(src), `${f}: sem console.log (log estruturado é logRegistral)`)
}

// ============================================================================
console.log("\n7) PERMISSÕES — todas declaradas no catálogo oficial")
const permissoes = ler("src/lib/permissoes.ts")
const ESPERADAS = [
  "registral.ver_evidencias",
  "registral.revisar",
  "registral.aprovar",
  "registral.alterar_filiacao",
  "registral.mesclar_pessoas",
  "registral.reverter",
  "registral.reprocessar",
  "registral.administrar_regras",
]
for (const p of ESPERADAS) {
  ok(permissoes.includes(`'${p}'`), `permissão ${p} declarada`)
}
ok(
  /PERMISSOES_OPT_IN[\s\S]*?registral\.mesclar_pessoas/.test(permissoes),
  "fusão de pessoas é OPT-IN (fora dos perfis padrão)",
)
ok(
  /modulo: 'Árvore — Motor Registral'/.test(permissoes),
  "as permissões aparecem como módulo próprio na tela de perfis",
)

// Toda permissão usada no código tem de existir no catálogo.
const usadas = new Set<string>()
for (const f of [...SERVICOS, ...arquivos("src/app/api/registral"), ...PUROS]) {
  for (const m of ler(f).matchAll(/["'](registral\.[a-z_]+)["']/g)) usadas.add(m[1])
}
const orfas = [...usadas].filter((p) => !permissoes.includes(`'${p}'`))
ok(orfas.length === 0, "nenhuma permissão usada fora do catálogo", orfas)

// Toda rota de escrita do motor exige permissão.
const ROTAS = [...arquivos("src/app/api/registral"), ...arquivos("src/app/api/processos/[processoId]/registral")]
for (const f of ROTAS) {
  const src = ler(f)
  const temEscrita = /export async function (POST|PATCH|PUT|DELETE)/.test(src)
  if (!temEscrita) continue
  ok(/exigir\(|exigirAlguma\(/.test(src), `${f}: rota de escrita exige permissão`)
}
for (const f of ROTAS) {
  const src = ler(f)
  if (!/export async function GET/.test(src)) continue
  ok(/exigir\(|exigirAlguma\(/.test(src), `${f}: rota de leitura também autoriza`)
}

// ============================================================================
console.log("\n7b) MATRIZ DE PERFIS — uma fonte, não duas")
// A matriz do seed de produção e os PERFIS_PADRAO do catálogo têm de concordar.
// Divergir significa: o teste jura que o Assistente não aprova correção, e em
// produção ele aprova.
import { MATRIZ_REGISTRAL, CHAVE_REGISTRAL, OPERACOES_REGISTRAIS } from "../lib/genealogia/permissoes-registral"
import { PERFIS_PADRAO, PERMISSOES_OPT_IN, calcularPermissoes } from "../src/lib/permissoes"

for (const perfil of PERFIS_PADRAO) {
  const daMatriz = MATRIZ_REGISTRAL[perfil.nome]
  if (!daMatriz) {
    ok(false, `perfil padrão "${perfil.nome}" está ausente da matriz registral`)
    continue
  }
  const doPadrao = OPERACOES_REGISTRAIS.filter(
    (op) => (perfil.permissoes as Record<string, boolean>)[CHAVE_REGISTRAL[op]] === true,
  )
  const iguais =
    doPadrao.length === daMatriz.length && doPadrao.every((op) => daMatriz.includes(op))
  ok(iguais, `matriz registral de "${perfil.nome}" bate com PERFIS_PADRAO`, {
    padrao: doPadrao,
    matriz: daMatriz,
  })
}
ok(
  Object.values(MATRIZ_REGISTRAL).every((ops) => !ops.includes("mesclar_pessoas")),
  "nenhum perfil da matriz concede fusão de pessoas (OPT-IN)",
)
ok(PERMISSOES_OPT_IN.has("registral.mesclar_pessoas"), "fusão está declarada como OPT-IN no catálogo")
ok(
  calcularPermissoes("admin")["registral.mesclar_pessoas"] === true,
  "usuário tipo=admin recebe a fusão (é a exceção documentada do catálogo)",
)
ok(
  calcularPermissoes("usuario")["registral.aprovar"] === false,
  "usuário comum sem perfil não recebe nenhuma permissão registral",
)

// ============================================================================
console.log("\n7c) INTERFACE E OCR — sem duplicar domínio, sem botão morto")

const UI = arquivos("src/components/registral")
ok(UI.length >= 3, `interface registral tem ${UI.length} módulos`)

// A tela não pode reimplementar regra nem falar com o banco.
for (const f of UI) {
  const src = ler(f)
  ok(!/from ["']@prisma\/client["']/.test(src) && !/@\/lib\/prisma/.test(src), `${f}: a tela não fala com o banco`)
  ok(!/criticidadeDaAlteracao|estadoDoFato|verificarIntegridade|apurarElegibilidade/.test(src), `${f}: a tela não reimplementa regra do motor`)
}

// Design System: a tela usa o kit e os tokens, nunca cor/valor cravado.
const telas = [...UI, "src/app/registral/page.tsx"]
for (const f of telas) {
  const src = ler(f)
  const hexForaDeComentario = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .match(/#[0-9a-fA-F]{6}\b/g)
  ok(!hexForaDeComentario, `${f}: sem cor cravada (tudo vem de token)`, hexForaDeComentario)
  ok(!/z-\[\d+\]/.test(src), `${f}: sem z-index cravado (usa o SSOT de layers)`)
}
const painel = ler("src/components/registral/painel-proposta.tsx")
ok(painel.includes("LAYER.aboveProcessDrawer"), "o drawer usa a camada do SSOT")
ok(painel.includes("SURFACE_OVERLAY"), "e superfície OPACA de overlay (token global do DS)")
ok(painel.includes("createPortal"), "e é portal em body (abre por cima do modal do processo)")

// Sem botão morto: toda ação da tela chama uma rota que existe.
const central = ler("src/components/registral/central-registral.tsx")
const ROTAS_USADAS = [
  ...central.matchAll(/["'`]\/api\/([a-z0-9\-\/\[\]$~{}.]+)/gi),
  ...painel.matchAll(/["'`]\/api\/([a-z0-9\-\/\[\]$~{}.]+)/gi),
].map((m) => m[0].replace(/["'`]/g, ""))
ok(ROTAS_USADAS.length >= 5, `a tela consome ${ROTAS_USADAS.length} rota(s) do motor`)
ok(
  ROTAS_USADAS.every((r) => r.startsWith("/api/registral") || r.startsWith("/api/processos")),
  "e todas são rotas do motor ou do processo",
  ROTAS_USADAS,
)
ok(central.includes("motivo"), "decisão pela tela sempre manda motivo")
ok(painel.includes("desbloqueioExplicito"), "bloqueio exige desbloqueio explícito também na tela")

// A entrada no menu existe e é gated por permissão.
const sidebar = ler("src/components/bitrix-sidebar.tsx")
ok(sidebar.includes('url: "/registral"'), "a tela tem entrada na navegação")
ok(/url: "\/registral"[\s\S]{0,200}permissao: "registral\.ver_evidencias"/.test(sidebar), "e a entrada é gated por permissão")

// OCR: provedores reais, sem simulação.
const OCR = arquivos("src/services/registral/ocr")
ok(OCR.length >= 4, `camada de transcrição tem ${OCR.length} módulos`)
const orquestrador = ler("src/services/registral/ocr/index.ts")
ok(orquestrador.includes("documento.update"), "a transcrição é gravada NO DOCUMENTO")
ok(!/model\s+Transcricao/.test(schema), "e não existe tabela de transcrição paralela")
ok(orquestrador.includes("jaTinha"), "transcrever é idempotente")
const externo = ler("src/services/registral/ocr/http-externo.ts")
ok(externo.includes("OCR_ENDPOINT"), "o provedor externo é configurável por ambiente")
ok(/disponivel\(\)[\s\S]{0,400}motivo/.test(externo), "e declara o motivo quando indisponível")
for (const f of OCR) {
  const src = ler(f)
  ok(!/texto simulado|lorem ipsum|FAKE|dummy/i.test(src), `${f}: sem texto simulado`)
}
const pipelineSrc = ler("src/services/registral/pipeline.ts")
ok(pipelineSrc.includes("transcreverDocumento"), "o pipeline tenta transcrever antes de desistir")
const loteSrc = ler("src/services/registral/lote.ts")
ok(loteSrc.includes("garantirTranscricoes"), "o lote transcreve antes de ler")

// ============================================================================
console.log("\n8) IDEMPOTÊNCIA — toda escrita nova passa por chave")
const MODELOS_COM_CHAVE = [
  "LoteRegistral",
  "ExecucaoRegistral",
  "OcorrenciaDocumental",
  "FatoRegistral",
  "EvidenciaRegistral",
  "CorrespondenciaIdentidade",
  "PropostaReconciliacao",
  "ConflitoRegistral",
  "ImpactoAplicacaoRegistral",
  "DecisaoRevisaoRegistral",
]
for (const m of MODELOS_COM_CHAVE) {
  const bloco = blocoMrg.slice(blocoMrg.indexOf(`model ${m} {`))
  const corpo = bloco.slice(0, bloco.indexOf("\n}"))
  ok(/chaveIdempotencia\s+String\s+@unique/.test(corpo), `${m} tem chaveIdempotencia @unique`)
}
ok(
  /model VersaoGenealogica[\s\S]*?@@unique\(\[arvoreId, versao\]\)/.test(blocoMrg),
  "VersaoGenealogica é única por (árvore, versão)",
)
ok(
  /model MetricaRegistral[\s\S]*?@@unique\(\[chave, escopo, janelaInicio\]\)/.test(blocoMrg),
  "MetricaRegistral acumula por janela sem duplicar",
)

// ============================================================================
console.log("\n9) O MOTOR NÃO APLICA O QUE É BLOQUEIO")
ok(
  /ehMotor[\s\S]{0,400}BLOQUEADA_SEM_DESBLOQUEIO/.test(aplicar),
  "o aplicador recusa bloqueio para o ator MOTOR",
)
ok(
  /if \(p\.ator\.ehMotor && !proposta\.aplicavelAutomaticamente\)/.test(aplicar),
  "o motor só aplica proposta marcada como automática",
)
ok(aplicar.includes("prisma.$transaction"), "aplicação é transacional")
ok(aplicar.includes("ErroRevalidacao"), "falha de revalidação lança e reverte a transação")
ok(/throw new Error\(\s*\n?\s*`?\$?\{?tipo\}?[\s\S]{0,80}exige serviço de fusão/.test(aplicar) || aplicar.includes("exige serviço de fusão"), "fusão/separação são recusadas explicitamente")

const lote = ler("src/services/registral/lote.ts")
ok(lote.includes("ehMotor: true"), "as automáticas são aplicadas com o ator MOTOR")
ok(lote.includes("criticidade: \"AUTOMATICA\""), "e o filtro é a criticidade da matriz")
ok(/updateMany\([\s\S]{0,400}reservadoEm/.test(lote), "claim atômico por execução (concorrência)")

const dispatcher = ler("src/services/outbox-dispatcher.ts")
ok(dispatcher.includes("registral.reconciliar.processo"), "a reconciliação contínua está ligada à outbox existente")

const cron = ler("src/app/api/cron/registral/route.ts")
ok(
  cron.includes("x-vercel-cron"),
  "o worker aceita o header de cron da Vercel (sem isto, nunca roda agendado)",
)
ok(cron.includes("CRON_SECRET"), "e também o segredo de cron")
ok(cron.includes('registral.reprocessar'), "e o operador com permissão pode disparar manualmente")
const vercelJson = ler("vercel.json")
ok(vercelJson.includes("/api/cron/registral"), "o worker está registrado no cron da Vercel")

// ============================================================================
console.log(`\n${"=".repeat(60)}`)
console.log(`MRG guarda de arquitetura: ${passed} passou, ${failed} falhou`)
if (failed) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
