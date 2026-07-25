/**
 * Gerenciamento — GUARDA da arquitetura oficial da navegação (reestruturação 25/07).
 * Rodar: npm run test:nav
 *
 * O que este teste garante:
 *  1. os 11 módulos oficiais, com os nomes e NA ORDEM obrigatória;
 *  2. a árvore interna de cada módulo (itens soltos e agrupamentos), na ordem;
 *  3. sidebar em LISTA VERTICAL com accordion — módulo sem submenu não tem seta;
 *  4. INVENTÁRIO ANTI-ÓRFÃO: toda tela que existia antes continua com destino
 *     (item do menu, item oculto acessível por ?screen= ou alias de URL);
 *  5. nenhuma nomenclatura antiga sobrando; nenhum conceito duplicado no menu;
 *  6. todo item navegável tem componente registrado no mapa TELAS do page.tsx;
 *  7. todo item da estrutura oficial ainda sem tela é honesto (coming_soon + nota).
 */
import {
  MANAGEMENT_NAVIGATION,
  entradasOficiais,
  moduloEhDireto,
  itensAtivosDoModulo,
  itensVisiveisDoModulo,
  primeiraTelaDoModulo,
  moduloDaScreen,
} from "../src/components/gerenciamentoComponents/managementNavigation"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const pageSrc = readFileSync(join(ROOT, "src/app/administrator/page.tsx"), "utf8")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

const todosItens = MANAGEMENT_NAVIGATION.flatMap((g) => g.children ?? [])
const itemDe = (key: string) => todosItens.find((i) => i.key === key)
const moduloDe = (key: string) => MANAGEMENT_NAVIGATION.find((g) => (g.children ?? []).some((c) => c.key === key))?.key
const gDe = (k: string) => MANAGEMENT_NAVIGATION.find((g) => g.key === k)

// keys registradas no mapa TELAS do page.tsx (screen → componente)
const blocoTelas = pageSrc.split("const TELAS: Record<string, React.ComponentType>")[1]?.split("\n}")[0] ?? ""
const TELAS_KEYS = new Set(
  Array.from(blocoTelas.matchAll(/^\s{2}([a-zA-Z_][\w]*):/gm)).map((m) => m[1]),
)
// aliases de URL declarados no page.tsx (key antiga → tela real)
const blocoAlias = pageSrc.match(/ALIAS_TELAS: Record<string, string> = \{([^}]*)\}/)?.[1] ?? ""
const ALIAS_KEYS = new Set(Array.from(blocoAlias.matchAll(/(\w+)\s*:/g)).map((m) => m[1]))

// ═══════════════ 1) OS 11 MÓDULOS OFICIAIS, NA ORDEM OBRIGATÓRIA ═══════════════
console.log("\n1) Módulos oficiais e ordem obrigatória")
const ORDEM_OFICIAL: [string, string][] = [
  ["grp_visao", "Visão Geral"],
  ["grp_processos", "Processos"],
  ["grp_workflow", "Workflow"],
  ["grp_automacoes", "Automações"],
  ["grp_documentos", "Documentos e Protocolos"],
  ["grp_servicos", "Serviços"],
  ["grp_financeiro", "Financeiro"],
  ["grp_orgaos", "Órgãos e Organizações"],
  ["grp_usuarios", "Usuários e Acessos"],
  ["grp_sistema", "Sistema"],
  ["grp_relatorios", "Relatórios e Indicadores"],
]
const visiveis = MANAGEMENT_NAVIGATION
  .filter((g) => !g.hiddenAsModule && (!!g.screen || itensVisiveisDoModulo(g).length > 0))
  .sort((x, y) => x.order - y.order)
ok(
  JSON.stringify(visiveis.map((g) => g.key)) === JSON.stringify(ORDEM_OFICIAL.map(([k]) => k)),
  `sidebar = exatamente os 11 módulos oficiais, na ordem (got: ${visiveis.map((g) => g.key).join(", ")})`,
)
ok(
  ORDEM_OFICIAL.every(([k, nome]) => { const g = gDe(k); return !!g && (g.fullLabel || g.label) === nome }),
  "nomes oficiais dos módulos exatos (fullLabel usado no menu e no breadcrumb)",
)
const orders = MANAGEMENT_NAVIGATION.map((g) => g.order)
ok(orders.every((o, i) => i === 0 || o > orders[i - 1]), "ordem declarada é ascendente (não reordenável por acidente)")
ok(!MANAGEMENT_NAVIGATION.some((g) => g.hiddenAsModule), "nenhum módulo oficial escondido do menu")

// ═══════════════ 2) ÁRVORE INTERNA DE CADA MÓDULO (ordem oficial) ═══════════════
console.log("\n2) Estrutura interna obrigatória de cada módulo")
const ARVORE_OFICIAL: Record<string, string[]> = {
  grp_visao: [],
  grp_processos: ["Cadastros", "Estrutura", "Configurações"],
  grp_workflow: ["Fluxos", "Transições", "Configurações"],
  grp_automacoes: ["Financeiras", "Eventos", "Configurações"],
  grp_documentos: ["Documentos", "Protocolos", "Regras"],
  grp_servicos: ["Catálogo de Serviços", "Categorias"],
  grp_financeiro: [
    "Configurações Financeiras", "Classificação", "Tabela de Valores", "Tesouraria",
    "Moedas", "Cobrança", "Crédito", "Fiscal", "Comissões", "Documentos Financeiros", "Governança",
  ],
  grp_orgaos: ["Organizações", "Categorias"],
  grp_usuarios: ["Usuários", "Perfis", "Permissões", "Grupos", "Auditoria de Acessos"],
  grp_sistema: [
    "Configurações Gerais", "Cadastros Auxiliares", "Identidade Visual",
    "Comunicações", "Integrações", "Auditoria e Logs",
  ],
  grp_relatorios: ["Relatórios", "Indicadores", "Dashboards", "Exportações"],
}
for (const [k, esperado] of Object.entries(ARVORE_OFICIAL)) {
  const g = gDe(k)!
  const got = entradasOficiais(g)
  ok(JSON.stringify(got) === JSON.stringify(esperado), `${k}: árvore oficial exata (got: ${got.join(" | ") || "—"})`)
}

// conteúdo dos agrupamentos que reaproveitam telas existentes
const itensDaSecao = (gk: string, secao: string) =>
  (gDe(gk)?.children ?? []).filter((c) => c.section === secao && c.status !== "hidden").map((c) => c.key)
ok(JSON.stringify(itensDaSecao("grp_processos", "Cadastros")) === JSON.stringify(["proctypes", "modalidades", "countrycatalog"]), "Processos › Cadastros = Tipos de Processo, Modalidades, Países e Regiões")
ok(JSON.stringify(itensDaSecao("grp_processos", "Estrutura")) === JSON.stringify(["fases", "phasemodes", "marcos"]), "Processos › Estrutura = Fases, Variações da Fase, Marcos")
ok(JSON.stringify(itensDaSecao("grp_processos", "Configurações")) === JSON.stringify(["sla", "cfgversions", "proccfg"]), "Processos › Configurações = SLA, Versões, Configurações Gerais")
ok(JSON.stringify(itensDaSecao("grp_workflow", "Fluxos")) === JSON.stringify(["macrokanban", "phaseiwf"]), "Workflow › Fluxos = Workflow Macro + Workflow Interno")
ok(JSON.stringify(itensDaSecao("grp_financeiro", "Classificação")) === JSON.stringify(["categories", "coa", "costcenters"]), "Financeiro › Classificação = Categorias, Plano de Contas, Centros de Custo")
ok(JSON.stringify(itensDaSecao("grp_financeiro", "Tesouraria")) === JSON.stringify(["accounts", "banks", "wallets"]), "Financeiro › Tesouraria = Contas, Bancos, Carteiras")
ok(JSON.stringify(itensDaSecao("grp_financeiro", "Cobrança")) === JSON.stringify(["methods", "paycond", "fees"]), "Financeiro › Cobrança = Formas, Condições, Taxas")
ok(JSON.stringify(itensDaSecao("grp_financeiro", "Tabela de Valores")) === JSON.stringify(["pricingtable", "discrules", "pricing"]), "Financeiro › Tabela de Valores = Tabelas de Preços, Regras de Precificação, Aplicabilidade")
ok(JSON.stringify(itensDaSecao("grp_orgaos", "Organizações")) === JSON.stringify(["organs", "suppliers"]), "Órgãos › Organizações = Cartórios e Órgãos + Fornecedores")
ok(JSON.stringify(itensDaSecao("grp_usuarios", "Grupos")) === JSON.stringify(["teams", "departments", "rolecat"]), "Usuários › Grupos = Equipes, Departamentos, Cargos")

// ═══════════════ 3) COMPORTAMENTO DA SIDEBAR (lista vertical + accordion) ═══════
console.log("\n3) Sidebar em lista vertical, accordion e módulo direto")
ok(moduloEhDireto(gDe("grp_visao")!) && gDe("grp_visao")!.screen === "overview", "Visão Geral navega direto (sem submenu) para o painel geral")
ok(MANAGEMENT_NAVIGATION.filter((g) => moduloEhDireto(g)).length === 1, "só Visão Geral é módulo direto (os demais têm submenu)")
ok(/direto \? null : \(/.test(pageSrc), "seta (chevron) só é renderizada quando o módulo TEM submenu")
ok(/aria-expanded=\{direto \? undefined : moduloAberto\}/.test(pageSrc) && /aria-controls=/.test(pageSrc), "a11y: aria-expanded/aria-controls só no módulo com submenu")
ok(/toggleAccordion/.test(pageSrc), "accordion: 1 módulo aberto por vez (regra única importada da fonte)")
ok(/setExpandedModule\(g\?\.key \?\? null\)/.test(pageSrc), "acesso direto por URL já entra com o módulo pai expandido")
ok(/uppercase tracking-\[0\.12em\]/.test(pageSrc), "agrupamentos internos renderizados em caixa alta (padrão visual preservado)")
ok(/ml-\[13px\][^"]*border-l/.test(pageSrc), "subitens com recuo e linha vertical (padrão visual preservado)")
ok(/mgmt-scroll/.test(pageSrc) && /overflow-y-auto/.test(pageSrc), "sidebar mantém rolagem interna")
ok(!/view === "module"/.test(pageSrc), "sem página intermediária de seleção de módulo")

// ═══════════════ 4) INVENTÁRIO ANTI-ÓRFÃO ══════════════════════════════════════
console.log("\n4) Inventário: nenhuma tela antiga ficou órfã")
// telas que estavam ATIVAS no menu antes da reestruturação
const ANTES_ATIVAS = [
  "overview", "proctypes", "countrycatalog", "cfgversions",
  "macrokanban", "phaseiwf", "phasemodes", "opauto", "simfase", "execmatrix",
  "doctypes", "doccats", "docrules", "prottypes", "products",
  "catalog", "categories", "coa", "costcenters", "suppliers",
  "pricingtable", "discrules", "pricing", "accounts", "banks", "wallets",
  "currencies", "fx", "methods", "paycond", "fees", "taxes", "commrules",
  "organs", "mgmthealth", "diagnostics", "cfgdiagnosis",
  "users", "teams", "departments", "rolecat", "roles",
]
// telas que existiam registradas (deep-link) e não podem sumir do mapa TELAS
const ANTES_REGISTRADAS = [
  "certtypes", "docmatrix", "honorariums", "catalogmestre", "estruturafin",
  "precificacao", "comercial", "pagamentos", "fornecedoresconc", "integracaofin",
  "permprofiles", "syshealth", "execmotor", "runtimediag", "audit", "protocols",
  "sla", "templates", "notifications", "impexp", "backup", "settings",
]
const temDestino = (k: string) => !!moduloDaScreen(k) || ALIAS_KEYS.has(k) || TELAS_KEYS.has(k)
const semDestino = [...ANTES_ATIVAS, ...ANTES_REGISTRADAS].filter((k) => !temDestino(k))
ok(semDestino.length === 0, `toda tela anterior tem destino na nova arquitetura (órfãs: ${semDestino.join(", ") || "nenhuma"})`)

const semRota = [...ANTES_ATIVAS, ...ANTES_REGISTRADAS].filter((k) => !TELAS_KEYS.has(k) && !ALIAS_KEYS.has(k))
ok(semRota.length === 0, `toda rota ?screen= anterior continua resolvendo (quebradas: ${semRota.join(", ") || "nenhuma"})`)

// simula o resolverTela() do page.tsx: key antiga → alias → tela real registrada
const ALIAS_MAP = Object.fromEntries(
  Array.from(blocoAlias.matchAll(/(\w+):\s*"(\w+)"/g)).map((m) => [m[1], m[2]]),
)
const resolve = (k: string) => ALIAS_MAP[k] ?? k
const quebradas = [...ANTES_ATIVAS, ...ANTES_REGISTRADAS].filter((k) => !TELAS_KEYS.has(resolve(k)))
ok(quebradas.length === 0, `toda rota antiga resolve para um COMPONENTE real (quebradas: ${quebradas.join(", ") || "nenhuma"})`)
const semModulo = [...ANTES_ATIVAS, ...ANTES_REGISTRADAS].filter((k) => !moduloDaScreen(resolve(k)))
ok(semModulo.length === 0, `toda rota antiga resolve para um MÓDULO (breadcrumb/estado ativo ok; sem módulo: ${semModulo.join(", ") || "nenhuma"})`)

// nenhuma tela registrada pode ficar sem entrada na navegação: sem módulo, o shell
// não renderiza (tela em branco). Cobre também as ocultas/deep-link.
const telasSemNav = Array.from(TELAS_KEYS).filter((k) => !moduloDaScreen(k))
ok(telasSemNav.length === 0, `toda tela do mapa TELAS tem entrada na navegação (sem nav: ${telasSemNav.join(", ") || "nenhuma"})`)

// keys renomeadas/aposentadas precisam de alias explícito
ok(ALIAS_KEYS.has("certtypes"), "alias preservado: ?screen=certtypes → Tipos de Documento")
ok(ALIAS_KEYS.has("opauto"), "alias criado: ?screen=opauto (Automações por Fase) → Automações › Financeiras")
ok(/ALIAS_MODULOS[\s\S]{0,160}grp_pessoas: "grp_orgaos"/.test(pageSrc), "alias de módulo: ?module=grp_pessoas → Órgãos e Organizações")

// telas que eram órfãs (sem item de menu) e ganharam casa oficial
ok(moduloDe("execmotor") === "grp_workflow" && itemDe("execmotor")?.status === "active", "Executor do Motor deixou de ser órfão (Workflow › Configurações)")
ok(moduloDe("runtimediag") === "grp_workflow" && itemDe("runtimediag")?.status === "active", "Diagnóstico de Runtime deixou de ser órfão (Workflow › Configurações)")
ok(moduloDe("migmotor") === "grp_workflow" && TELAS_KEYS.has("migmotor"), "Migração do Motor deixou de ser órfã (registrada + no menu)")
ok(moduloDe("permmotor") === "grp_usuarios" && TELAS_KEYS.has("permmotor"), "Perfis de Permissão do Motor deixou de ser órfão (Usuários › Permissões)")
ok(moduloDe("catalogmestre") === "grp_sistema" && itemDe("catalogmestre")?.status === "active", "Catálogo Mestre deixou de ser órfão (Sistema › Cadastros Auxiliares)")
ok(moduloDe("audit") === "grp_sistema" && itemDe("audit")?.status === "active", "Auditoria e Logs tem casa oficial (Sistema)")

// ═══════════════ 5) SEM DUPLICAÇÃO E SEM NOMENCLATURA ANTIGA ═══════════════════
console.log("\n5) Sem duplicação de conceito e sem nomenclatura antiga")
const keysNaoOcultas = todosItens.filter((i) => i.status !== "hidden").map((i) => i.key)
ok(new Set(keysNaoOcultas).size === keysNaoOcultas.length, "nenhuma tela aparece duas vezes no menu (sem conceito duplicado)")
const gkeys = MANAGEMENT_NAVIGATION.map((g) => g.key)
ok(new Set(gkeys).size === gkeys.length, "chaves de módulo únicas")
const rotulos = [
  ...MANAGEMENT_NAVIGATION.map((g) => `${g.label} ${g.fullLabel ?? ""}`),
  ...todosItens.filter((i) => i.status !== "hidden").map((i) => i.label),
].join(" | ")
for (const proibido of ["Pessoas e Organizações", "Produtos Financeiros", "Produtos e Serviços"]) {
  ok(!rotulos.includes(proibido), `nomenclatura antiga ausente do menu: "${proibido}"`)
}
ok(!/(^|\|)\s*Produtos\s*(\||$)/.test(rotulos), 'nenhum item chamado "Produtos" (a empresa vende Serviços)')
ok(!(gDe("grp_servicos")?.children ?? []).some((c) => c.status !== "hidden" && /preç|preco|precifica/i.test(c.label)), "Serviços não tem precificação (preço só na Tabela de Valores)")
ok(!(gDe("grp_documentos")?.children ?? []).some((c) => c.status !== "hidden" && c.section === "Configurações"), 'Documentos e Protocolos NÃO tem submenu "Configurações"')
ok(!(gDe("grp_workflow")?.children ?? []).some((c) => c.status !== "hidden" && /^fases?$/i.test(c.label)), "Workflow NÃO cadastra fases (só referencia)")
ok(moduloDe("fases") === "grp_processos" && itemDe("fases")?.status === "active", "Fases são cadastradas EXCLUSIVAMENTE em Processos › Estrutura")
ok(todosItens.filter((i) => i.key === "fases").length === 1, "cadastro de fases existe uma única vez em toda a navegação")
ok(!(gDe("grp_automacoes")?.children ?? []).some((c) => c.status !== "hidden" && /tarefa|documento/i.test(c.label)), "Automações não recria motor de tarefas/documentos")

// ═══════════════ 6) TODA ROTA VÁLIDA ABRE TELA ═════════════════════════════════
console.log("\n6) Toda rota válida abre uma tela registrada")
const ativosSemTela = MANAGEMENT_NAVIGATION
  .flatMap((g) => itensAtivosDoModulo(g).map((i) => i.key))
  .filter((k) => !TELAS_KEYS.has(k))
ok(ativosSemTela.length === 0, `todo item navegável tem componente no mapa TELAS (faltando: ${ativosSemTela.join(", ") || "nenhum"})`)
const diretosSemTela = MANAGEMENT_NAVIGATION.filter((g) => g.screen && !TELAS_KEYS.has(g.screen))
ok(diretosSemTela.length === 0, "módulo direto aponta para tela registrada")
ok(MANAGEMENT_NAVIGATION.every((g) => !!primeiraTelaDoModulo(g) || itensVisiveisDoModulo(g).length === 0), "todo módulo visível abre em alguma tela útil")
ok(/\?screen=/.test(pageSrc) && /searchParams\.set\("screen"/.test(pageSrc), "deep-link ?screen= preservado (bookmarks continuam válidos)")

// ═══════════════ 7) ITENS SEM TELA SÃO HONESTOS ════════════════════════════════
console.log("\n7) Itens da estrutura oficial ainda sem tela própria")
const soon = todosItens.filter((i) => i.status === "coming_soon")
ok(soon.every((i) => !!i.note && i.note.length > 20), "todo item sem tela traz nota honesta explicando onde a função vive hoje")
ok(/disabled=\{indisponivel\}/.test(pageSrc) && /aria-disabled=\{indisponivel/.test(pageSrc), "item sem tela é renderizado DESABILITADO (nunca botão morto)")
console.log(`     (${soon.length} itens oficiais ainda sem tela própria: ${soon.map((i) => i.label).join(", ")})`)

// ═══════════════ 8) BUSCA ══════════════════════════════════════════════════════
console.log("\n8) Busca")
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
const matches = (kw: string) =>
  todosItens.filter((i) => i.status === "active" && norm([i.label, ...(i.keywords ?? [])].join(" ")).includes(norm(kw)))
ok(matches("preço").length >= 2 && matches("preco").length === matches("preço").length, "busca de preço funciona com e sem acento")
ok(matches("certidão").some((i) => i.key === "doctypes"), 'busca "certidão" alcança Tipos de Documento')
ok(matches("tradutor").some((i) => i.key === "suppliers"), 'busca "tradutor" alcança Fornecedores (Órgãos e Organizações)')
ok(matches("fase").some((i) => i.key === "fases"), 'busca "fase" alcança o catálogo de Fases')
ok(matches("permissao").some((i) => i.key === "permmotor" || i.key === "roles"), 'busca "permissao" alcança Perfis/Permissões')
ok(/moduloEhDireto\(g, pode\)/.test(pageSrc), "busca também alcança módulo sem submenu (Visão Geral)")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("Navegação do Gerenciamento: arquitetura oficial validada ✅")
