/**
 * SLA DE FASEMACRO/PROCESSO — guarda estática de arquitetura (sem banco).
 * Rodar: tsx scripts/sla-guard.test.ts
 *
 * Reescrito em 17/09/2026: o conceito de "prazo do processo" (FaseMacro,
 * `sla-core.ts`) foi REMOVIDO de toda tela operacional — era um terceiro
 * relógio de prazo concorrente com os dois oficiais do Discovery, Tarefa
 * (macro) e Subtarefa (operacional) — ver
 * `lib/operacional/tempo-operacional.ts` e a memória
 * [[prazo-tarefa-subtarefa-dois-relogios]].
 *
 * A engine em si (sla-core.ts/sla-projection.ts) FICOU: tem um consumidor
 * legítimo restante, o painel de inteligência da Árvore Genealógica
 * (congelada — [[arvore-layout-definitivo]]). Este guard agora protege DUAS
 * coisas ao mesmo tempo:
 *
 *  1. A engine continua correta e isolada (núcleo puro, config intocada,
 *     sem coluna derivada, batch sem N+1) — pro único consumidor que sobrou.
 *  2. NENHUMA tela operacional (Home, Kanban, Lista, detalhe do processo)
 *     voltou a apresentar "prazo do processo" — essa é a regressão que mais
 *     importa impedir, porque foi exatamente o que motivou a remoção.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join, relative } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8")
const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "")

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

/** Todos os .ts/.tsx de src/ e scripts/. */
function arquivosDeCodigo(): string[] {
  const out: string[] = []
  const anda = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      if (nome === "node_modules" || nome === ".next") continue
      const caminho = join(dir, nome)
      if (statSync(caminho).isDirectory()) anda(caminho)
      else if (/\.tsx?$/.test(nome)) out.push(relative(ROOT, caminho))
    }
  }
  anda(join(ROOT, "src"))
  anda(join(ROOT, "scripts"))
  return out
}

function run() {
  console.log("SLA DE FASEMACRO/PROCESSO — guarda estática\n")

  const CORE = "src/lib/motor/sla-core.ts"
  const RESOLVER = "src/lib/process-stage/sla-projection.ts"
  const TIPOS = "src/types/sla.ts"
  const UI = "src/components/sla/sla-ui.tsx"
  const CARD_REMOVIDO = "src/components/kanban/ProcessoSlaCard.tsx"
  const ROTA_REMOVIDA = "src/app/api/processos/[processoId]/sla/route.ts"
  const ARVORE_CONSUMIDOR = "src/components/arvore/inteligencia/barra-linhagem.tsx"

  console.log("Camadas da engine (mantida — consumidor da Árvore):")
  for (const f of [CORE, RESOLVER, TIPOS, UI]) {
    ok(existsSync(join(ROOT, f)), `existe ${f}`)
  }

  console.log("\nRemovido das telas operacionais (17/09/2026):")
  ok(!existsSync(join(ROOT, CARD_REMOVIDO)), `NÃO existe mais ${CARD_REMOVIDO}`)
  ok(!existsSync(join(ROOT, ROTA_REMOVIDA)), `NÃO existe mais ${ROTA_REMOVIDA}`)

  const core = ler(CORE)
  const resolver = ler(RESOLVER)

  // ---- Núcleo puro ----
  console.log("\nNúcleo puro:")
  ok(!/from ["']@\/lib\/prisma["']|from ["']@prisma\/client["']/.test(core), "sla-core não conhece o banco")
  ok(!/new Date\(\)/.test(semComentarios(core)), "sla-core não lê o relógio: o 'agora' é injetado (determinismo)")
  ok(/export function buildSlaProjection/.test(core), "buildSlaProjection é a função-base exportada")
  ok(/export const DIAS_ATENCAO_SLA = 7/.test(core), "limiar de atenção (7 dias) declarado no núcleo")

  // ---- Engine única, agora com UM consumidor operacional (a Árvore) ----
  console.log("\nEngine única — só a Árvore (congelada) consome:")
  const codigo = arquivosDeCodigo()
  const importamCore = codigo.filter(
    (f) => f !== CORE && /from ["'][^"']*motor\/sla-core["']/.test(ler(f)),
  )
  ok(
    importamCore.every((f) => f === RESOLVER || f.startsWith("scripts/")),
    `só o resolver (e testes) usa o núcleo — encontrados: ${importamCore.join(", ") || "nenhum"}`,
  )
  const importamResolver = codigo.filter(
    (f) => f !== RESOLVER && /from ["'][^"']*process-stage\/sla-projection["']/.test(ler(f)),
  )
  ok(
    importamResolver.every((f) => f.startsWith("scripts/") || f.startsWith("src/components/arvore/") || f.startsWith("src/app/api/processos/[processoId]/genealogia/")),
    `quem chama o resolver é só a Árvore (congelada) ou teste — encontrados: ${importamResolver.join(", ") || "nenhum"}`,
  )
  const declaramPrazo = codigo.filter(
    (f) =>
      f !== CORE &&
      f !== RESOLVER &&
      !f.startsWith("scripts/") &&
      /buildSlaProjection|classificarSla\s*\(|faixaSla\s*\(/.test(semComentarios(ler(f))),
  )
  ok(declaramPrazo.length === 0, `nenhuma tela/rota recalcula o SLA — encontrados: ${declaramPrazo.join(", ") || "nenhum"}`)
  const outrosLimiares = codigo.filter(
    (f) => f !== CORE && !f.startsWith("scripts/") && /DIAS_ATENCAO_SLA\s*=/.test(ler(f)),
  )
  ok(outrosLimiares.length === 0, "o limiar de 7 dias não é redeclarado em lugar nenhum")

  // ---- Configuração intocada ----
  console.log("\nConfiguração de SLA intocada:")
  const escritas = /prisma\.(faseMacro|catalogoFase|macroWorkflow|phaseInternalWorkflowStep)\.(create|update|upsert|delete|createMany|updateMany|deleteMany)/
  ok(!escritas.test(core) && !escritas.test(resolver), "a camada operacional não escreve na configuração")
  ok(
    !/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(resolver),
    "o resolver é somente leitura",
  )
  ok(/prisma\.macroWorkflow\.findMany/.test(resolver), "o prazo é LIDO do Workflow Macro (cadastro = fonte de verdade)")
  ok(/required \? soma \+ Math\.max\(0, f\.slaDays\)/.test(core), "prazo total = soma dos SLAs das fases obrigatórias")

  // ---- Sem persistência derivada ----
  console.log("\nSem coluna derivada no banco:")
  const schema = ler("prisma/schema.prisma")
  ok(
    !/slaStatus|slaCalculado|prazoPrevistoSla|diasAtrasoSla/.test(schema),
    "nada de campo derivado de SLA no schema — a projeção é calculada na leitura",
  )

  // ---- Batch, sem N+1 ----
  console.log("\nDesempenho:")
  ok(/export async function resolveSlaProjectionBatch/.test(resolver), "existe resolver em LOTE")
  ok(/resolveSlaProjectionBatch\(\[processId\]\)/.test(resolver), "o single delega ao batch (mesma lógica)")
  const queries = (resolver.match(/await prisma\./g) ?? []).length
  ok(queries <= 3, `o batch usa no máximo 3 queries agregadas (usa ${queries})`)

  // ---- Home: nem cálculo, nem apresentação ----
  console.log("\nHome — SLA de FaseMacro fora do bloco Prazos:")
  const logic = ler("src/lib/home/home-logic.ts")
  const coleta = ler("src/lib/home/coleta.ts")
  const apiHome = ler("src/app/api/home/route.ts")
  const homeContent = ler("src/components/home/home-content.tsx")
  const apiHomeProcessos = ler("src/app/api/home/processos/route.ts")
  const processosAndamento = ler("src/components/home/processos-andamento.tsx")

  // semComentarios: as próprias explicações desta reescrita citam os nomes
  // removidos ("FILAS_SLA foi removido") — sem tirar comentário, o guard
  // acharia a si mesmo.
  ok(!/FILAS_SLA/.test(semComentarios(logic)), "FILAS_SLA não existe mais no catálogo de filas")
  ok(!/faixaDaFilaSla/.test(semComentarios(logic)) && !/faixaDaFilaSla/.test(semComentarios(coleta)) && !/faixaDaFilaSla/.test(semComentarios(homeContent)),
    "faixaDaFilaSla não existe mais em lugar nenhum")
  ok(/TODAS_FILAS: FilaDef\[\] = \[\.\.\.FILAS_PASSO, \.\.\.FILAS_ESTADO, \.\.\.FILAS_PRAZO_TAREFA, \.\.\.FILAS_PRAZO_SUBTAREFA\]/.test(logic),
    "o catálogo de filas tem só passo/estado/prazo-Tarefa/prazo-Subtarefa — sem FaseMacro")
  ok(!/montarSla/.test(semComentarios(coleta)) && !/montarSla/.test(semComentarios(apiHome)), "montarSla não existe mais — Home não monta painel de SLA de processo")
  ok(!/resolveSlaProjectionBatch/.test(coleta), "coleta.ts da Home não chama mais a engine de FaseMacro")
  ok(!/\bsla:\s*Map</.test(coleta), "BaseOperacional não carrega mais Map de SLA por processo")
  ok(!/"processo-sla"/.test(coleta), "o tipo Membro não tem mais variante processo-sla")
  ok(!/data\.sla\b/.test(homeContent) && !/PainelSla/.test(homeContent), "a Home não renderiza mais painel de SLA de processo")
  ok(!/resolveSlaProjectionBatch/.test(apiHomeProcessos), "a tabela 'Processos em andamento' não busca mais SLA de FaseMacro")
  ok(!processosAndamento.includes(">SLA<"), "a tabela 'Processos em andamento' não tem mais coluna SLA")
  ok(
    /membrosDaFila\(def\.key, base, ctx\.agora\)\.length/.test(coleta),
    "a contagem dos cards de prazo (Tarefa/Subtarefa) sai da MESMA definição de membros do drill-down",
  )
  ok(/href={fila\.href}/.test(homeContent) && /function LinhaDeChip/.test(homeContent), "os cards de prazo (Tarefa/Subtarefa) continuam clicáveis")
  ok(/\/dashboard\/fila\/\$\{def\.key\}/.test(coleta), "o clique abre a lista já filtrada daquela faixa")

  // ---- Listagem e Kanban de processos ----
  console.log("\nListagem e Kanban de processos — sem SLA de FaseMacro:")
  const lista = ler("src/components/processos-lista.tsx")
  const apiProcessos = ler("src/app/api/processos/route.ts")
  const kanbanCard = ler("src/components/kanban/kanban-card.tsx")
  ok(!/resolveSlaProjectionBatch/.test(apiProcessos), "GET /api/processos não busca mais SLA de FaseMacro")
  ok(!/\bsla:\s*slaByProc/.test(apiProcessos), "cada processo não carrega mais projeção de SLA de FaseMacro")
  ok(!lista.includes(">Status SLA<") && !lista.includes(">Dias<"), "a listagem não tem mais coluna Status SLA / Dias")
  ok(!/FILTROS_SLA/.test(lista) && !/setFiltroSla/.test(lista), "a listagem não tem mais filtro por status de SLA")
  ok(!/\.sla\b/.test(semComentarios(kanbanCard)), "o card do Kanban não lê mais .sla do processo")

  // ---- Detalhe do processo ----
  console.log("\nDetalhe do processo — card SLA removido:")
  const modal = ler("src/components/kanban/atividade-details-modal.tsx")
  ok(!/ProcessoSlaCard/.test(modal), "o modal de detalhe do processo não monta mais o card de SLA")

  // ---- Único consumidor legítimo restante: a Árvore (congelada) ----
  console.log("\nÚnico consumidor operacional restante — Árvore Genealógica (congelada):")
  ok(existsSync(join(ROOT, ARVORE_CONSUMIDOR)), `existe ${ARVORE_CONSUMIDOR}`)
  const arvoreRota = ler("src/app/api/processos/[processoId]/genealogia/operacional/route.ts")
  ok(/resolveSlaProjection\(/.test(arvoreRota), "a rota de inteligência da Árvore ainda lê a engine de FaseMacro (consumidor legítimo, congelado)")

  // ---- Paleta compartilhada (mantida — reaproveitada pelos 2 relógios oficiais) ----
  console.log("\nPaleta de tom — CORES_SLA sobrevive, reaproveitada pelos relógios oficiais:")
  const ui = ler(UI)
  ok(/export const CORES_SLA/.test(ui), "CORES_SLA continua existindo — é a paleta que Tarefa/Subtarefa reaproveitam")
  ok(!/ESTILO_STATUS_SLA/.test(semComentarios(ui)) && !/ESTILO_FAIXA_SLA/.test(semComentarios(ui)) && !/function SlaBadge/.test(semComentarios(ui)),
    "ESTILO_STATUS_SLA/ESTILO_FAIXA_SLA/SlaBadge (específicos do SLA de FaseMacro) foram removidos")
  ok(/CORES_SLA/.test(homeContent) && /ESTILO_FAIXA_PRAZO/.test(homeContent),
    "a Home monta o semáforo de Tarefa/Subtarefa a partir de CORES_SLA — uma paleta só")

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
}
run()
