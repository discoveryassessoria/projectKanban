/**
 * SLA DE FASEMACRO/PROCESSO — guarda estática de arquitetura (sem banco).
 * Rodar: tsx scripts/sla-guard.test.ts
 *
 * Reescrito em 17/09/2026 (segunda rodada, mesmo dia): a rodada anterior
 * tinha removido o conceito de "prazo do processo" de toda tela operacional
 * (Home, Kanban, Lista, detalhe do processo) mas MANTIDO a engine
 * (`sla-core.ts`/`sla-projection.ts`) e `FaseMacro.slaDays` porque a Árvore
 * Genealógica ainda consumia — era o único consumidor legítimo restante.
 *
 * Decisão definitiva do usuário: a Árvore Genealógica NÃO tem prazo/SLA — ela
 * representa estrutura familiar/linhagem, não é unidade operacional de
 * execução. Com esse último consumidor removido, a engine inteira e
 * `FaseMacro.slaDays`/`CatalogoFase.slaDiasPadrao` foram eliminados por
 * completo — sem substituto, e sem tocar no motor de avanço/recuo,
 * materialização, ownership, conclusão ou nos prazos canônicos de Tarefa e
 * Subtarefa (`lib/operacional/tempo-operacional.ts` — ver
 * [[prazo-tarefa-subtarefa-dois-relogios]]).
 *
 * A arquitetura final é inequívoca:
 *   TAREFA          = prazo macro da entrega
 *   SUBTAREFA       = prazo próprio da execução
 *   PROCESSO        = sem prazo
 *   FASE MACRO      = sem prazo
 *   ÁRVORE GENEALÓGICA = sem prazo
 *
 * Este guard prova, em conjunto com `arvore-inteligencia-guard.test.ts` e
 * `arvore-motor-operacional.test.ts` (que travam a Árvore especificamente):
 *
 *  1. A engine de SLA de FaseMacro/Processo NÃO EXISTE MAIS em disco.
 *  2. `FaseMacro.slaDays`/`CatalogoFase.slaDiasPadrao` NÃO EXISTEM MAIS no
 *     schema, nem em nenhuma tela de Gerenciamento (Workflow Macro, Fases,
 *     Configurações › SLA/Transições).
 *  3. A Árvore Genealógica não lê, não recebe e não apresenta prazo em
 *     lugar nenhum — nem no painel de inteligência, nem no diagnóstico.
 *  4. Nenhuma tela operacional (Home, Kanban, Lista, detalhe do processo)
 *     apresenta "prazo do processo" — a regressão que mais importa impedir.
 *  5. O SLA de passo/step (fonte real dos dois relógios oficiais) e o SLA
 *     por órgão/cartório (`lib/operacional/sla-por-orgao.ts`, domínio
 *     inteiramente diferente) continuam intocados.
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
  console.log("SLA DE FASEMACRO/PROCESSO — guarda estática (eliminação total)\n")

  const CORE_REMOVIDO = "src/lib/motor/sla-core.ts"
  const RESOLVER_REMOVIDO = "src/lib/process-stage/sla-projection.ts"
  const TIPOS_REMOVIDO = "src/types/sla.ts"
  const CARD_REMOVIDO = "src/components/kanban/ProcessoSlaCard.tsx"
  const ROTA_REMOVIDA = "src/app/api/processos/[processoId]/sla/route.ts"
  const UI = "src/components/sla/sla-ui.tsx"

  console.log("Engine de SLA de FaseMacro/Processo — eliminada por completo:")
  for (const f of [CORE_REMOVIDO, RESOLVER_REMOVIDO, TIPOS_REMOVIDO, CARD_REMOVIDO, ROTA_REMOVIDA]) {
    ok(!existsSync(join(ROOT, f)), `NÃO existe mais ${f}`)
  }

  // ---- Ninguém importa o que foi apagado ----
  console.log("\nNenhum arquivo importa a engine removida:")
  const codigo = arquivosDeCodigo()
  const importamCoreRemovido = codigo.filter((f) => /from ["'][^"']*motor\/sla-core["']/.test(ler(f)))
  ok(importamCoreRemovido.length === 0, `nenhum import de sla-core — encontrados: ${importamCoreRemovido.join(", ") || "nenhum"}`)
  const importamResolverRemovido = codigo.filter((f) => /from ["'][^"']*process-stage\/sla-projection["']/.test(ler(f)))
  ok(importamResolverRemovido.length === 0, `nenhum import de sla-projection — encontrados: ${importamResolverRemovido.join(", ") || "nenhum"}`)
  const importamTiposRemovidos = codigo.filter((f) => /from ["'][^"']*types\/sla["']/.test(ler(f)))
  ok(importamTiposRemovidos.length === 0, `nenhum import de types/sla — encontrados: ${importamTiposRemovidos.join(", ") || "nenhum"}`)
  // Restrito a src/: scripts/ inclui os próprios guards, que citam o nome da
  // função removida como PADRÃO DE BUSCA (não como chamada real).
  const chamamResolveSlaProjection = codigo.filter((f) => f.startsWith("src/") && /resolveSlaProjection/.test(semComentarios(ler(f))))
  ok(chamamResolveSlaProjection.length === 0, `resolveSlaProjection não é chamado em lugar nenhum — encontrados: ${chamamResolveSlaProjection.join(", ") || "nenhum"}`)

  // ---- FaseMacro.slaDays / CatalogoFase.slaDiasPadrao fora do schema ----
  console.log("\nSchema — FaseMacro/CatalogoFase sem prazo:")
  const schema = ler("prisma/schema.prisma")
  const faseMacroBloco = schema.slice(schema.indexOf("model FaseMacro"), schema.indexOf("model PhaseInternalWorkflow"))
  ok(!/slaDays/.test(faseMacroBloco), "FaseMacro não tem mais coluna slaDays")
  const catalogoFaseBloco = schema.slice(schema.indexOf("model CatalogoFase"), schema.indexOf("model CatalogoFase") + 1200)
  ok(!/slaDiasPadrao/.test(catalogoFaseBloco), "CatalogoFase não tem mais coluna slaDiasPadrao")
  ok(existsSync(join(ROOT, "prisma/migrations/20260917161750_remove_fasemacro_sla/migration.sql")), "existe a migration que dropa as duas colunas")

  // ---- Gerenciamento: nenhuma tela escreve/mostra slaDays de FaseMacro ----
  console.log("\nGerenciamento — sem SLA de Fase Macro:")
  const macroKanbanTab = ler("src/components/gerenciamentoComponents/MacroKanbanTab.tsx")
  ok(!/slaDays|slaDiasPadrao/.test(semComentarios(macroKanbanTab)), "MacroKanbanTab não lê, edita nem envia slaDays/slaDiasPadrao")
  const catalogoFasesTab = ler("src/components/gerenciamentoComponents/CatalogoFasesTab.tsx")
  ok(!/slaDiasPadrao/.test(catalogoFasesTab), "CatalogoFasesTab não tem mais campo SLA padrão")
  const wfMacroRoute = ler("src/app/api/gerenciamento/workflow-macro/route.ts")
  const wfMacroIdRoute = ler("src/app/api/gerenciamento/workflow-macro/[id]/route.ts")
  ok(!/slaDays|slaDiasPadrao/.test(wfMacroRoute) && !/slaDays|slaDiasPadrao/.test(wfMacroIdRoute),
    "as rotas de Workflow Macro (POST/PUT) não persistem mais slaDays")
  const catalogoFasesRoute = ler("src/app/api/gerenciamento/catalogo-fases/route.ts")
  const catalogoFasesIdRoute = ler("src/app/api/gerenciamento/catalogo-fases/[id]/route.ts")
  ok(!/slaDiasPadrao/.test(catalogoFasesRoute) && !/slaDiasPadrao/.test(catalogoFasesIdRoute),
    "as rotas do catálogo de fases não persistem mais slaDiasPadrao")

  // A tela "Processos › Configurações › SLA" continua existindo — mas agora só
  // mostra o SLA do PASSO (canônico), nunca o da fase.
  const configViews = ler("src/components/gerenciamentoComponents/ConfiguracaoProcessoViews.tsx")
  ok(!/f\.slaDays/.test(configViews), "a tela de Configurações não lê mais slaDays da FASE")
  ok(/p\.slaDays/.test(configViews), "a tela de Configurações continua mostrando o SLA do PASSO (canônico, intocado)")
  ok(!configViews.includes(">SLA da fase<") && !configViews.includes(">Acumulado<") && !configViews.includes("Prazo total (fases obrigatórias)"),
    "a aba SLA não mostra mais SLA/acumulado de fase")
  const configRoute = ler("src/app/api/gerenciamento/configuracao-processo/route.ts")
  ok(!/slaDays: f\.slaDays/.test(configRoute), "o read-model de configuração não projeta mais slaDays da fase")

  // ---- Configuração de SLA de passo intocada (fonte real do prazo canônico) ----
  console.log("\nSLA de passo (canônico, fonte de Tarefa/Subtarefa) — intocado:")
  ok(/slaDays\s*Int\s*@default\(0\)/.test(schema), "PhaseInternalWorkflowStep.slaDays continua no schema")
  ok(/model RegraTemporalOrgao/.test(schema) && /slaDays Int/.test(schema), "SLA por órgão/cartório (domínio diferente) continua intacto")

  // ---- Home: nem cálculo, nem apresentação ----
  console.log("\nHome — sem SLA de FaseMacro:")
  const logic = ler("src/lib/home/home-logic.ts")
  const coleta = ler("src/lib/home/coleta.ts")
  const apiHome = ler("src/app/api/home/route.ts")
  const homeContent = ler("src/components/home/home-content.tsx")
  const apiHomeProcessos = ler("src/app/api/home/processos/route.ts")
  const processosAndamento = ler("src/components/home/processos-andamento.tsx")

  ok(!/FILAS_SLA/.test(semComentarios(logic)), "FILAS_SLA não existe mais no catálogo de filas")
  ok(!/faixaDaFilaSla/.test(semComentarios(logic)) && !/faixaDaFilaSla/.test(semComentarios(coleta)) && !/faixaDaFilaSla/.test(semComentarios(homeContent)),
    "faixaDaFilaSla não existe mais em lugar nenhum")
  ok(/TODAS_FILAS: FilaDef\[\] = \[\.\.\.FILAS_PASSO, \.\.\.FILAS_ESTADO, \.\.\.FILAS_PRAZO_TAREFA, \.\.\.FILAS_PRAZO_SUBTAREFA\]/.test(logic),
    "o catálogo de filas tem só passo/estado/prazo-Tarefa/prazo-Subtarefa — sem FaseMacro")
  ok(!/montarSla/.test(semComentarios(coleta)) && !/montarSla/.test(semComentarios(apiHome)), "montarSla não existe mais — Home não monta painel de SLA de processo")
  ok(!/\bsla:\s*Map</.test(coleta), "BaseOperacional não carrega mais Map de SLA por processo")
  ok(!/"processo-sla"/.test(coleta), "o tipo Membro não tem mais variante processo-sla")
  ok(!/data\.sla\b/.test(homeContent) && !/PainelSla/.test(homeContent), "a Home não renderiza mais painel de SLA de processo")
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
  ok(!lista.includes(">Status SLA<") && !lista.includes(">Dias<"), "a listagem não tem mais coluna Status SLA / Dias")
  ok(!/FILTROS_SLA/.test(lista) && !/setFiltroSla/.test(lista), "a listagem não tem mais filtro por status de SLA")
  ok(!/\.sla\b/.test(semComentarios(kanbanCard)), "o card do Kanban não lê mais .sla do processo")
  ok(!/\bsla:\s*slaByProc/.test(apiProcessos), "GET /api/processos não projeta mais SLA de FaseMacro")

  // ---- Detalhe do processo ----
  console.log("\nDetalhe do processo — card SLA removido:")
  const modal = ler("src/components/kanban/atividade-details-modal.tsx")
  ok(!/ProcessoSlaCard/.test(modal), "o modal de detalhe do processo não monta mais o card de SLA")

  // ---- Árvore Genealógica — sem prazo, em lugar nenhum ----
  console.log("\nÁrvore Genealógica — sem prazo/SLA (decisão do usuário, 17/09/2026):")
  const arvoreRota = ler("src/app/api/processos/[processoId]/genealogia/operacional/route.ts")
  ok(!/\bprazo\b/i.test(semComentarios(arvoreRota)), "a rota de inteligência da Árvore não computa mais prazo")
  const dossie = ler("src/lib/genealogia/operacional/dossie.ts")
  ok(!/PrazoDoProcesso/.test(dossie), "PrazoDoProcesso não existe mais em dossie.ts")
  ok(!/prazo:\s*PrazoDoProcesso/.test(dossie), "ResumoLinhagem não tem mais campo prazo")
  const diagnostico = ler("src/lib/genealogia/operacional/diagnostico.ts")
  ok(!/PrazoDoProcesso/.test(diagnostico) && !/FONTE_SLA/.test(diagnostico), "o diagnóstico não conhece mais PrazoDoProcesso/FONTE_SLA")
  ok(!/categoria:\s*"sla"/.test(diagnostico), "o diagnóstico não gera mais problema de categoria sla")
  const barraLinhagem = ler("src/components/arvore/inteligencia/barra-linhagem.tsx")
  ok(!/resumo\.prazo/.test(barraLinhagem) && !barraLinhagem.includes("Prazo do processo"), "a barra de linhagem não mostra mais prazo do processo")
  const useArvoreOperacional = ler("src/components/arvore/inteligencia/use-arvore-operacional.ts")
  ok(!/PrazoDoProcesso/.test(useArvoreOperacional), "use-arvore-operacional.ts não importa mais PrazoDoProcesso")

  console.log("\n(a Árvore em si — layout, foco, dossiê, demais 5 painéis — continua EXATAMENTE como estava;")
  console.log(" ver arvore-inteligencia-guard.test.ts e arvore-motor-operacional.test.ts para a fronteira completa)")

  // ---- Busca global: zero "prazo do processo" em qualquer tela ----
  console.log("\nBusca global — nenhuma tela apresenta \"prazo do processo\":")
  const dizemPrazoDoProcesso = codigo.filter((f) => f.startsWith("src/") && /prazo do processo/i.test(semComentarios(ler(f))))
  ok(dizemPrazoDoProcesso.length === 0, `nenhum arquivo apresenta o texto "prazo do processo" fora de comentário — encontrados: ${dizemPrazoDoProcesso.join(", ") || "nenhum"}`)

  // ---- Paleta compartilhada (mantida — reaproveitada pelos 2 relógios oficiais) ----
  console.log("\nPaleta de tom — CORES_SLA sobrevive, reaproveitada pelos relógios oficiais:")
  const ui = ler(UI)
  ok(/export const CORES_SLA/.test(ui), "CORES_SLA continua existindo — é a paleta que Tarefa/Subtarefa reaproveitam")
  ok(!/ESTILO_STATUS_SLA/.test(semComentarios(ui)) && !/ESTILO_FAIXA_SLA/.test(semComentarios(ui)) && !/function SlaBadge/.test(semComentarios(ui)),
    "ESTILO_STATUS_SLA/ESTILO_FAIXA_SLA/SlaBadge (específicos do SLA de FaseMacro) continuam removidos")
  ok(/CORES_SLA/.test(homeContent) && /ESTILO_FAIXA_PRAZO/.test(homeContent),
    "a Home monta o semáforo de Tarefa/Subtarefa a partir de CORES_SLA — uma paleta só")

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
}
run()
