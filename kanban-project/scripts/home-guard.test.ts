/**
 * CENTRAL OPERACIONAL — guarda estática da Home (sem banco).
 * Rodar: tsx scripts/home-guard.test.ts
 *
 * Protege os critérios de aceite da tela inicial:
 *  - a Home antiga foi substituída (sem "Processos por País", sem foto de fundo,
 *    sem glassmorphism, sem a frase genérica);
 *  - as seções obrigatórias existem;
 *  - a ordem das fases vem da configuração (CatalogoFase), não é fixada no código;
 *  - a API agregadora e a busca global existem e expõem os blocos esperados.
 */
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8")
// Remove comentários — as guardas de "UI antiga removida" devem checar o código
// renderizado, não a prosa que explica o que foi retirado.
const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

function run() {
  console.log("CENTRAL OPERACIONAL — guarda estática\n")

  const home = ler("src/app/dashboard/page.tsx")
  const content = ler("src/components/home/home-content.tsx")
  const api = ler("src/app/api/home/route.ts")
  const search = ler("src/app/api/home/search/route.ts")
  const logic = ler("src/lib/home/home-logic.ts")
  const homeAll = semComentarios(home + "\n" + content)
  const apiCode = semComentarios(api)

  // ---- Home antiga removida ----
  ok(!/Processos por Pa[íi]s/i.test(homeAll), "sem 'Processos por País' na Home")
  ok(!/Total de Processos/i.test(homeAll), "sem 'Total de Processos' como destaque")
  ok(!/Aqui está o resumo dos seus processos e tarefas/i.test(homeAll), "sem a frase genérica de boas-vindas")
  ok(!/espanha\.jpg|bg-\[url\(/.test(homeAll), "sem imagem de fundo atrás do conteúdo")
  ok(!/backdrop-blur/.test(homeAll), "sem glassmorphism (backdrop-blur) na Home")
  ok(!/PAISES_CONFIG|processosPorPais/.test(homeAll), "sem distribuição por país na Home")

  // ---- Seções obrigatórias presentes ----
  const secoes = [
    "Alertas prioritários",
    "Próximas ações",
    "Fila da equipe",
    "Processos por fase",
    "Gargalos",
    "Agenda de hoje",
    "Atividade recente",
  ]
  for (const s of secoes) ok(content.includes(s), `seção presente: ${s}`)
  ok(/itens? precisa/.test(content), "cabeçalho mostra resumo de atenção acionável")
  ok(content.includes("GlobalSearch"), "busca global integrada ao cabeçalho")

  // ---- Estados de carregamento / erro / vazio ----
  ok(home.includes("HomeSkeleton"), "estado de loading (skeleton)")
  ok(home.includes("ErrorState"), "estado de erro")
  ok(content.includes("EmptyState"), "estados vazios nas seções")
  ok(content.includes("Nenhum compromisso para hoje"), "estado vazio da agenda")

  // ---- API agregadora expõe todos os blocos numa resposta ----
  const blocos = [
    "attentionSummary",
    "priorityAlerts",
    "nextActions",
    "teamQueue",
    "processesByPhase",
    "bottlenecks",
    "todayAgenda",
    "recentActivity",
  ]
  for (const b of blocos) ok(api.includes(b), `API /api/home expõe: ${b}`)
  ok(/extrairUsuarioComPermissoes/.test(api), "API respeita autenticação/permissões")
  ok(/Promise\.all\(/.test(api), "API agrega em paralelo (sem 1 consulta por card)")

  // ---- Ordem de fases vem da configuração, não fixada no código ----
  ok(/catalogoFase\.findMany/.test(api), "fases lidas de CatalogoFase (Workflow Macro)")
  ok(/orderBy:\s*\{\s*ordemPadrao:\s*"asc"\s*\}/.test(api), "fases ordenadas por ordemPadrao")
  ok(/\.sort\(\(a, b\) => a\.ordem - b\.ordem\)/.test(logic), "agrupamento respeita a ordem configurada")

  // ---- Busca global real (integrada, não visual) ----
  for (const modelo of ["processo.findMany", "familia.findMany", "requerente.findMany", "contratante.findMany"]) {
    ok(search.includes(modelo), `busca global consulta: ${modelo}`)
  }

  // ---- Não reintroduz o motor por-processo na Home (evita N+1 pesado) ----
  ok(!/calcularPendencias|simulateAdvance/.test(apiCode), "Home não roda o motor de pendências por processo (perf)")

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
}
run()
