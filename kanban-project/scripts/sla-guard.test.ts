/**
 * SLA OPERACIONAL — guarda estática de arquitetura (sem banco).
 * Rodar: tsx scripts/sla-guard.test.ts
 *
 * Protege as regras que a entrega assumiu:
 *  - ENGINE ÚNICA: um núcleo puro (sla-core) + um resolver de I/O
 *    (sla-projection). Ninguém mais calcula prazo, dias ou cor;
 *  - a CONFIGURAÇÃO de SLA não é tocada: a camada operacional só LÊ
 *    (nada de create/update/delete sobre FaseMacro/CatalogoFase);
 *  - Central Operacional, listagem e detalhe do processo consomem a MESMA
 *    projeção — nenhum recálculo em tela;
 *  - o limiar de 7 dias existe em UM lugar só;
 *  - as quatro faixas de SLA são clicáveis e abrem a lista filtrada;
 *  - a listagem tem coluna de status, coluna de dias e filtro;
 *  - o card do detalhe mostra os oito campos exigidos.
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
  console.log("SLA OPERACIONAL — guarda estática\n")

  const CORE = "src/lib/motor/sla-core.ts"
  const RESOLVER = "src/lib/process-stage/sla-projection.ts"
  const TIPOS = "src/types/sla.ts"
  const UI = "src/components/sla/sla-ui.tsx"
  const CARD = "src/components/kanban/ProcessoSlaCard.tsx"
  const ROTA = "src/app/api/processos/[processoId]/sla/route.ts"

  console.log("Camadas:")
  for (const f of [CORE, RESOLVER, TIPOS, UI, CARD, ROTA]) {
    ok(existsSync(join(ROOT, f)), `existe ${f}`)
  }

  const core = ler(CORE)
  const resolver = ler(RESOLVER)

  // ---- Núcleo puro ----
  console.log("\nNúcleo puro:")
  ok(!/from ["']@\/lib\/prisma["']|from ["']@prisma\/client["']/.test(core), "sla-core não conhece o banco")
  ok(!/new Date\(\)/.test(semComentarios(core)), "sla-core não lê o relógio: o 'agora' é injetado (determinismo)")
  ok(/export function buildSlaProjection/.test(core), "buildSlaProjection é a função-base exportada")
  ok(/export const DIAS_ATENCAO_SLA = 7/.test(core), "limiar de atenção (7 dias) declarado no núcleo")

  // ---- Engine única ----
  console.log("\nEngine única:")
  const codigo = arquivosDeCodigo()
  const importamCore = codigo.filter(
    (f) => f !== CORE && /from ["'][^"']*motor\/sla-core["']/.test(ler(f)),
  )
  ok(
    importamCore.every((f) => f === RESOLVER || f.startsWith("scripts/")),
    `só o resolver (e testes) usa o núcleo — encontrados: ${importamCore.join(", ") || "nenhum"}`,
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

  // ---- Central Operacional ----
  console.log("\nCentral Operacional:")
  const logic = ler("src/lib/home/home-logic.ts")
  const coleta = ler("src/lib/home/coleta.ts")
  const apiHome = ler("src/app/api/home/route.ts")
  const homeContent = ler("src/components/home/home-content.tsx")

  for (const key of ["sla-atrasados", "sla-vencem-hoje", "sla-proximos-7", "sla-no-prazo"]) {
    ok(logic.includes(`"${key}"`), `faixa "${key}" declarada`)
  }
  ok(/TODAS_FILAS: FilaDef\[\] = \[\.\.\.FILAS_PASSO, \.\.\.FILAS_ESTADO, \.\.\.FILAS_SLA\]/.test(logic),
    "as filas de SLA entram no catálogo (drill-down funciona)")
  ok(
    /for \(const def of \[\.\.\.FILAS_PASSO, \.\.\.FILAS_ESTADO\]\)/.test(coleta),
    "SLA não polui a lista de trabalho executável da Central",
  )
  ok(/resolveSlaProjectionBatch/.test(coleta), "a Home consome a engine — não recalcula prazo")
  ok(/montarSla/.test(apiHome), "a resposta de /api/home entrega o painel de SLA")
  ok(
    /membrosDaFila\(def\.key, base, ctx\.agora\)\.length/.test(coleta),
    "a contagem do card sai da MESMA definição de membros do drill-down",
  )
  ok(/href={fila\.href}/.test(homeContent) && /CardSla/.test(homeContent), "os quatro cards são clicáveis")
  ok(/\/dashboard\/fila\/\$\{def\.key\}/.test(coleta), "o clique abre a lista já filtrada daquela faixa")

  // ---- Listagem de processos ----
  console.log("\nListagem de processos:")
  const lista = ler("src/components/processos-lista.tsx")
  const apiProcessos = ler("src/app/api/processos/route.ts")
  ok(/resolveSlaProjectionBatch/.test(apiProcessos), "a listagem recebe o SLA em lote da engine")
  ok(/sla: slaByProc\.get\(p\.id\) \?\? null/.test(apiProcessos), "cada processo carrega sua projeção de SLA")
  ok(lista.includes(">Status SLA<"), "coluna Status SLA")
  ok(lista.includes(">Dias<"), "coluna Dias")
  ok(/FILTROS_SLA/.test(lista) && /setFiltroSla/.test(lista), "filtro por status de SLA")
  ok(
    /no_prazo/.test(lista) && /proximo_vencimento/.test(lista) && /atrasado/.test(lista),
    "os três status do conceito estão no filtro",
  )
  ok(/processo\.sla\?\.rotuloDias/.test(lista), "a coluna Dias exibe o rótulo da engine (não recalcula)")
  ok(!/86_400_000|86400000/.test(lista), "a listagem não faz aritmética de data")

  // ---- Detalhe do processo ----
  console.log("\nDetalhe do processo:")
  const card = ler(CARD)
  const modal = ler("src/components/kanban/atividade-details-modal.tsx")
  ok(/ProcessoSlaCard/.test(modal), "o card SLA está montado no detalhe do processo")
  for (const campo of [
    "Prazo previsto",
    "Tempo decorrido",
    "Dias restantes",
    "Dias em atraso",
    "Fase atual",
    "Fase responsável pelo atraso",
    "Próximo vencimento",
  ]) {
    ok(card.includes(campo), `card exibe "${campo}"`)
  }
  ok(/SlaBadge/.test(card), "card exibe o status (selo)")
  ok(!/86_400_000|86400000/.test(card), "o card não faz aritmética de data")
  ok(/Tentar novamente/.test(card), "o card tem estado de erro com nova tentativa")

  // ---- Semáforo único ----
  console.log("\nSemáforo único:")
  const ui = ler(UI)
  ok(/ESTILO_STATUS_SLA/.test(ui) && /ESTILO_FAIXA_SLA/.test(ui), "uma paleta serve status e faixa")
  const primitivas = ler("src/components/home/home-primitives.tsx")
  ok(!/SLA_STYLE\s*[:=]/.test(primitivas), "a Home não mantém cópia da paleta de SLA")
  ok(/ESTILO_FAIXA_SLA/.test(homeContent), "a Home importa a paleta compartilhada")

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
}
run()
