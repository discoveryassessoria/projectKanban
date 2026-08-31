/**
 * CENTRO OPERACIONAL — guarda estática da Home (sem banco).
 * Rodar: tsx scripts/home-guard.test.ts
 *
 * Protege o CONCEITO da tela inicial:
 *  - Home = centro de operações (só ação executável), não dashboard/BI;
 *  - blocos removidos não voltam (receita, caixa, processos ativos, processos
 *    por fase, workflow macro, atividade recente, acesso rápido, gráficos…);
 *  - identidade visual IDÊNTICA ao módulo Financeiro (fundo europeu, overlay
 *    escuro, glassmorphism, HeaderBar, mesmos tokens de card);
 *  - alertas só existem quando há alerta; agenda só hoje/amanhã/próximos;
 *  - filas clicáveis abrem exatamente aquela fila (drill-down);
 *  - a API agrega e não duplica lógica (mesma coleta na Home e no drill-down);
 *  - câmbio é componente discreto da barra superior de todas as telas.
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8")
// As guardas de "bloco removido" devem olhar o código renderizado, não a prosa
// dos comentários que explicam o que saiu.
const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "")

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

function run() {
  console.log("CENTRO OPERACIONAL — guarda estática\n")

  const page = ler("src/app/dashboard/page.tsx")
  const content = ler("src/components/home/home-content.tsx")
  const shell = ler("src/components/home/home-shell.tsx")
  const primitivas = ler("src/components/home/home-primitives.tsx")
  const palette = ler("src/components/home/command-palette.tsx")
  const api = ler("src/app/api/home/route.ts")
  const apiFila = ler("src/app/api/home/fila/[key]/route.ts")
  const coleta = ler("src/lib/home/coleta.ts")
  const logic = ler("src/lib/home/home-logic.ts")
  const filaPage = ler("src/app/dashboard/fila/[key]/page.tsx")
  const header = ler("src/components/header-bar.tsx")
  const financeiro = ler("src/app/financeiro/page.tsx")
  const financeiroDash = ler("src/components/financeiro/dashboard-corporativo.tsx")

  const uiHome = semComentarios(page + "\n" + content + "\n" + shell)

  // ---- 1. Blocos que NÃO pertencem mais à Home ----
  console.log("Blocos removidos:")
  const proibidos: [RegExp, string][] = [
    [/Receita prevista|Receita realizada|receitaPrevista|receitaRealizada/i, "receita"],
    [/\bCaixa\b|caixaBRL/i, "caixa"],
    [/Financeiro resumido|resumoFinanceiro/i, "financeiro resumido"],
    [/Processos ativos|processosAtivos/i, "processos ativos"],
    [/Fam[ií]lias ativas|Pessoas na [áa]rvore/i, "famílias ativas / pessoas na árvore"],
    [/Processos por fase|processesByPhase|Processos em andamento/i, "processos por fase"],
    [/Workflow Macro|Fluxo Operacional|Indicadores Operacionais/i, "workflow macro / indicadores"],
    [/Atividade recente|recentActivity|[ÚU]ltimas movimenta/i, "atividade recente"],
    [/Acesso r[áa]pido|QuickActions/i, "acesso rápido"],
    [/Fila da equipe|teamQueue|Gargalos|bottlenecks/i, "fila da equipe / gargalos"],
    [/recharts|<svg[\s\S]*?<path|PieChart|BarChart|Funnel/i, "gráficos"],
  ]
  for (const [re, nome] of proibidos) ok(!re.test(uiHome), `Home não exibe: ${nome}`)
  ok(!/Cota[çc][õo]es de hoje/i.test(uiHome), "sem card grande de câmbio na Home")
  ok(!existsSync(join(ROOT, "src/components/home/cotacoes-hoje-card.tsx")), "card antigo de câmbio removido do repo")

  // ---- 2. Identidade visual do Financeiro ----
  console.log("\nIdentidade visual (idêntica ao Financeiro):")
  const fundoFinanceiro = /bg-\[url\('\/espanha\.jpg'\)\]/
  ok(fundoFinanceiro.test(financeiro) && fundoFinanceiro.test(shell), "mesma imagem europeia de fundo")
  // Overlay do ambiente — INTENTO ATUAL (aprovado em 28/08/2026, identidade AZUL).
  // 1ª rodada: véu chapado (bg-black/60) igual ao Financeiro.
  // 2ª rodada (02/08): véu em GRADIENTE, escrito à mão em cada página.
  // Agora: o gradiente é TOKEN — `--landscape-veil` em globals.css, uma fonte só.
  // A guarda deixa de ler a string na página e passa a exigir (a) que a página
  // consuma o token e (b) que o token seja gradiente vertical quase opaco no
  // topo, que é a faixa onde vive o conteúdo (§9/§10 da spec azul).
  const globais = ler("src/app/globals.css")
  ok(/var\(--landscape-veil\)/.test(shell), "ambiente consome o véu canônico (--landscape-veil)")
  const veuToken = (globais.match(/--landscape-veil:\s*linear-gradient\(\s*180deg,\s*rgba\([^)]*,\s*(0?\.\d+)\)/) || [])[1] || null
  ok(!!veuToken, "véu é gradiente vertical (foto vira horizonte, não textura sob o texto)")
  ok(!!veuToken && Number(veuToken) >= 0.95, `véu opaco onde há conteúdo (topo = ${veuToken ?? "—"})`)
  ok(!/blur-\[\d+px\]/.test(shell), "sem borrão uniforme na foto de ambiente")
  ok(/backdrop-blur/.test(primitivas), "glassmorphism nos cards")
  ok(shell.includes("<HeaderBar"), "mesma barra superior (HeaderBar)")
  // O card deixou de ser uma string de vidro escuro e virou token do DS: a
  // guarda continua exigindo que Home e Financeiro usem O MESMO card.
  const cardCompartilhado = 'rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-md'
  ok(financeiroDash.includes(cardCompartilhado) && primitivas.includes(cardCompartilhado), "mesmo token de card do Financeiro")
  // O acento também é token. Era dourado (#D2A948, depois #a17938); na identidade
  // azul é o azul de ação. A guarda trava o TOKEN COMPARTILHADO, não o hex, e
  // confere que o hex do token é azul — dourado aqui é regressão.
  ok(/var\(--accent-primary\)/.test(primitivas) && /var\(--accent-primary\)/.test(financeiroDash), "mesmo acento da marca (token)")
  ok(/--accent-primary:\s*#2875b7/i.test(globais), "acento da marca é o azul de ação (#2875b7)")
  ok(!/bg-slate-50|bg-white(?!\/)/.test(uiHome), "sem superfície clara (a Home é parte do mesmo sistema)")

  // ---- 3. Blocos obrigatórios ----
  console.log("\nBlocos obrigatórios:")
  ok(/saudacao\(/.test(content), "cabeçalho com saudação")
  ok(/toLocaleDateString\("pt-BR"/.test(content), "cabeçalho com data")
  ok(/status\.mensagem|s\.mensagem/.test(content), "cabeçalho com status operacional")
  // A busca continua OBRIGATÓRIA no cabeçalho — o que mudou (02/08/2026) é o
  // invólucro: virou comando (⌘K), em vez de um campo permanente ocupando meia
  // largura. Segue sendo o MESMO GlobalSearch e o mesmo endpoint; quem garante
  // isso é a checagem de dentro do CommandPalette, logo abaixo.
  ok(content.includes("<CommandPalette"), "busca global no cabeçalho (como comando ⌘K)")
  ok(
    palette.includes("<GlobalSearch") && /metaKey|ctrlKey/.test(palette),
    "⌘K abre a MESMA busca global (sem segunda implementação de busca)",
  )
  ok(content.includes("Central Operacional"), "bloco Central Operacional")
  ok(/titulo="Agenda"/.test(content), "bloco Agenda")
  ok(/Hoje/.test(content) && /Amanhã/.test(content) && /Próximos dias/.test(content), "agenda: hoje, amanhã, próximos dias")
  ok(/titulo="Alertas"/.test(content), "bloco Alertas")
  ok(/Opera[çc][ãa]o de hoje/.test(content), "bloco Resumo da operação do dia")

  // ---- 4. Regras de comportamento ----
  console.log("\nRegras do conceito:")
  // Alertas sem alerta — MUDOU DE INTENTO em 02/08/2026 (aprovado pelo usuário).
  // A regra original ("some") existia para o bloco não virar um vazio grande. A
  // densidade adaptativa resolve isso melhor: o bloco fica, mas encolhe para uma
  // LINHA discreta. O que a guarda protege agora é o custo de espaço — nada de
  // EmptyState de corpo inteiro para dizer que não há nada.
  ok(/<LinhaQuieta>Nenhum evento travando a opera/.test(content), "alertas vazios viram linha discreta, não bloco vazio")
  ok(
    !/EmptyState[^>]*>\s*Nenhum (evento|compromisso)/.test(content),
    "vazio de Alertas/Agenda não usa EmptyState de corpo inteiro",
  )
  // Densidade adaptativa do resumo do dia: dia zerado não pode ocupar o espaço
  // de um dia cheio (era o maior problema visual da tela antiga).
  ok(/semMovimento/.test(content), "resumo do dia colapsa quando não há movimento")
  ok(/filter\(\(f\) => f\.quantidade > 0\)/.test(logic), "fila zerada não aparece")
  ok(/href=\{fila\.href\}/.test(content), "cada fila é clicável")
  ok(/\/dashboard\/fila\/\$\{def\.key\}/.test(coleta), "clique abre exatamente aquela fila (drill-down)")
  ok(/\{fila\.quantidade\}/.test(content), "cada fila mostra quantidade")
  ok(/nivelStyle\(fila\.nivel\)/.test(content), "cada fila mostra prioridade")
  ok(/\{fila\.descricao\}/.test(content), "cada fila mostra descrição")
  ok(existsSync(join(ROOT, "src/app/dashboard/fila/[key]/page.tsx")), "tela da fila existe")
  ok(/useFila\(/.test(filaPage), "tela da fila consome o drill-down")

  // ---- 5. Arquitetura: agrega, não duplica ----
  console.log("\nArquitetura:")
  ok(/from "@\/src\/lib\/home\/coleta"/.test(api), "Home usa o coletor compartilhado")
  ok(/from "@\/src\/lib\/home\/coleta"/.test(apiFila), "drill-down usa o MESMO coletor (contagem = lista)")
  ok(/Promise\.all\(/.test(coleta), "coleta em paralelo (sem uma consulta por card)")
  ok(!/calcularPendencias|simulateAdvance|resolveOperationalProjection/.test(semComentarios(coleta)), "Home não roda o motor por processo (sem recalcular regra)")
  ok(/Cache-Control/.test(api) && /Cache-Control/.test(apiFila), "resposta com cache curto")
  ok(/extrairUsuarioComPermissoes/.test(api) && /extrairUsuarioComPermissoes/.test(apiFila), "autenticação e permissões respeitadas")
  for (const bloco of ["status", "filas", "agenda", "alertas", "resumoDia"]) {
    ok(new RegExp(`\\b${bloco}\\b`).test(api), `API /api/home expõe: ${bloco}`)
  }

  // ---- 6. Câmbio discreto em todas as telas ----
  console.log("\nCâmbio:")
  ok(existsSync(join(ROOT, "src/components/cambio/cambio-mini.tsx")), "componente discreto de câmbio existe")
  ok(header.includes("<CambioMini />"), "câmbio na barra superior de todas as telas")
  const mini = ler("src/components/cambio/cambio-mini.tsx")
  ok(/EUR/.test(mini) && /USD/.test(mini) && /consultadoEm/.test(mini), "mostra EUR/BRL, USD/BRL e última atualização")

  // ---- 7. Responsividade ----
  console.log("\nResponsividade:")
  ok(/lg:grid-cols-3/.test(content) && /grid-cols-1/.test(content), "malha responsiva na composição")
  ok(/sm:grid-cols-3|lg:grid-cols-5/.test(content), "resumo do dia se adapta a telas menores")
  ok(/md:px-6/.test(content), "espaçamento responsivo")

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
}
run()
