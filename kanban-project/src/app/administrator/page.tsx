// src/app/administrator/page.tsx
//
// GERENCIAMENTO GERAL — navegação lateral em ÁRVORE (padrão ERP). Sem mudança de
// regras de negócio, rotas de API ou dados. Duas views derivadas da URL:
//   • HOME  (sem parâmetro)          → visão geral opcional: módulos em CARDS + busca.
//   • TELA  (?screen=<key>)           → SHELL do Gerenciamento: uma ÚNICA árvore lateral
//                                       com TODOS os módulos (cada um expansível, itens
//                                       em lista) + a tela selecionada. A árvore é a
//                                       navegação principal e permanece visível ao trocar
//                                       de tela.
//
// Ao entrar num módulo (card da home, ?module=<grupo> legado, ou clique no título na
// árvore) abre-se DIRETAMENTE a primeira tela útil do módulo (defaultRoute) — sem página
// intermediária de cards. NÃO há mais a view de cards internos por módulo.
//
// FONTE ÚNICA de navegação: managementNavigation.tsx (módulos, seções, itens, ícones,
// descrições, keywords, permissão, status). Este arquivo apenas RENDERIZA. Deep-links
// ?screen= preservados (bookmarks continuam válidos); ?module= legado redireciona para a
// primeira tela do módulo; ALIAS de keys mantém compat.

"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { HeaderBar } from "@/src/components/header-bar"
import {
  Search, Loader2, Settings2, ChevronRight, Home,
  Menu, X, PanelLeftClose, PanelLeftOpen,
} from "lucide-react"
import dynamic from "next/dynamic"
import {
  MANAGEMENT_NAVIGATION,
  type ManagementNavigationItem,
} from "@/src/components/gerenciamentoComponents/managementNavigation"

// Lote 1 — 12 telas bespoke
import {
  TeamsTab, ProductsTab, ProtocolsTab,
  SLATab, TemplatesTab, NotificationsTab, AuditTab, ImportExportTab,
  BackupTab, SettingsTab,
} from "@/src/components/gerenciamentoComponents/GerenciamentoScaffolds"

// Lote 2 — Centro do Processo + Diagnóstico Executivo
import {
  ProcTypesTab, HealthTab,
} from "@/src/components/gerenciamentoComponents/GerenciamentoScaffolds2"

// Lote 3 — Centro do Processo (fases)
import {
  PhaseIWFTab, PhaseModesTab,
} from "@/src/components/gerenciamentoComponents/GerenciamentoScaffolds3"

// Lote 4 — Financeiro + Disparo por Fase + Diagnóstico
import {
  FinCatalogTab, HonorariumsTab, PricingRulesTab, PhaseMapTab, DiagnosticsTab,
} from "@/src/components/gerenciamentoComponents/GerenciamentoScaffolds4"

// Lote 5 — Bibliotecas de modelos (Centro do Processo)
import {
  IMTemplatesTab, AMTemplatesTab,
} from "@/src/components/gerenciamentoComponents/GerenciamentoScaffolds5"

// Lote 6 — Cadastros do Motor + Saúde do Sistema (telas que faltavam)
import {
  ExecMatrixTab, SystemHealthTab, PricingTableTab, RoleCatalogTab,
  PermProfilesTab, DocMatrixTab, ConfigVersionsTab, ConfigDiagnosisTab,
} from "@/src/components/gerenciamentoComponents/GerenciamentoScaffolds6"

// ============================================================
// MAPA DE TELAS (screen key → componente). Inalterado — só as views que o
// envolvem foram reorganizadas. As keys são as mesmas do deep-link ?screen=.
// ============================================================
const OverviewTab = dynamic(() => import("@/src/components/gerenciamentoComponents/OverviewTab"), {
  ssr: false, loading: () => <CarregandoTela />,
})
const UsersTab = dynamic(() => import("@/src/components/gerenciamentoComponents/UsersTab"), {
  ssr: false, loading: () => <CarregandoTela />,
})
const RolesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/RolesTab"), { ssr: false })
const PrecificacaoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/PrecificacaoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const FornecedoresConcentradoraTab = dynamic(() => import("@/src/components/gerenciamentoComponents/FornecedoresConcentradoraTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ComercialTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ComercialTab"), { ssr: false, loading: () => <CarregandoTela /> })
const PagamentosTab = dynamic(() => import("@/src/components/gerenciamentoComponents/PagamentosTab"), { ssr: false, loading: () => <CarregandoTela /> })
const IntegracaoFinanceiraTab = dynamic(() => import("@/src/components/gerenciamentoComponents/IntegracaoFinanceiraTab"), { ssr: false, loading: () => <CarregandoTela /> })
const EstruturaFinanceiraTab = dynamic(() => import("@/src/components/gerenciamentoComponents/EstruturaFinanceiraTab"), { ssr: false, loading: () => <CarregandoTela /> })
const AplicabilidadeEconomicaTab = dynamic(() => import("@/src/components/gerenciamentoComponents/AplicabilidadeEconomicaTab"), { ssr: false, loading: () => <CarregandoTela /> })
const CatalogoMestreTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CatalogoMestreTab"), { ssr: false, loading: () => <CarregandoTela /> })
const CatalogTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CatalogTab"), {
  ssr: false, loading: () => <CarregandoTela />,
})

const CentrosCustoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CentrosCustoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const CategoriasTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CategoriasTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ContasTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ContasTab"), { ssr: false, loading: () => <CarregandoTela /> })
const BancosTab = dynamic(() => import("@/src/components/gerenciamentoComponents/BancosTab"), { ssr: false, loading: () => <CarregandoTela /> })
const FornecedoresTab = dynamic(() => import("@/src/components/gerenciamentoComponents/FornecedoresTab"), { ssr: false, loading: () => <CarregandoTela /> })
const CambioTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CambioTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ImpostosTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ImpostosTab"), { ssr: false, loading: () => <CarregandoTela /> })
const PlanoContasTab = dynamic(() => import("@/src/components/gerenciamentoComponents/PlanoContasTab"), { ssr: false, loading: () => <CarregandoTela /> })
const CarteirasTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CarteirasTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ProdutosTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ProdutosTab"), { ssr: false, loading: () => <CarregandoTela /> })
const HonorariosTab = dynamic(() => import("@/src/components/gerenciamentoComponents/HonorariosTab"), { ssr: false, loading: () => <CarregandoTela /> })
const TabelaValoresTab = dynamic(() => import("@/src/components/gerenciamentoComponents/TabelaValoresTab"), { ssr: false, loading: () => <CarregandoTela /> })
const CondicoesPagamentoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CondicoesPagamentoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const RegrasComissaoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/RegrasComissaoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const RegrasDescontoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/RegrasDescontoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ProdutosServicosTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ProdutosServicosTab"), { ssr: false, loading: () => <CarregandoTela /> })
const MoedasTab = dynamic(() => import("@/src/components/gerenciamentoComponents/MoedasTab"), { ssr: false, loading: () => <CarregandoTela /> })
const FormasPagamentoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/FormasPagamentoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const TaxasPagamentoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/TaxasPagamentoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const TipoProcessoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/TipoProcessoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const MacroKanbanTab = dynamic(() => import("@/src/components/gerenciamentoComponents/MacroKanbanTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ModelosInternosFaseTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ModelosInternosFaseTab"), { ssr: false, loading: () => <CarregandoTela /> });
const ModelosWorkflowInternoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ModelosWorkflowInternoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ModelosAutomacaoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ModelosAutomacaoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ModosInternosFasesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ModosInternosFasesTab"), { ssr: false, loading: () => <CarregandoTela /> })
const PhaseWorkflowsFasesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/PhaseWorkflowsFasesTab"), { ssr: false, loading: () => <CarregandoTela /> })
const PhaseAutomationsFasesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/PhaseAutomationsFasesTab"), { ssr: false, loading: () => <CarregandoTela /> })
const PhaseTriggerRulesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/PhaseTriggerRulesTab"), { ssr: false, loading: () => <CarregandoTela /> })
const DepartamentosTab = dynamic(() => import("@/src/components/gerenciamentoComponents/DepartamentosTab"), { ssr: false, loading: () => <CarregandoTela /> })
const TiposDocumentoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/TiposDocumentoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const CategoriasDocumentaisTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CategoriasDocumentaisTab"), { ssr: false, loading: () => <CarregandoTela /> })
const RuntimeWorkflowDiagnostics = dynamic(() => import("@/src/components/gerenciamentoComponents/RuntimeWorkflowDiagnostics"), { ssr: false, loading: () => <CarregandoTela /> })
const OrgaosProtocoloTab = dynamic(() => import("@/src/components/gerenciamentoComponents/OrgaosProtocoloTab"), { ssr: false, loading: () => <CarregandoTela /> })
const MatrizDocumentalTab = dynamic(() => import("@/src/components/gerenciamentoComponents/MatrizDocumentalTab"), { ssr: false, loading: () => <CarregandoTela /> })
const LogAuditoriaTab = dynamic(() => import("@/src/components/gerenciamentoComponents/LogAuditoriaTab"), { ssr: false, loading: () => <CarregandoTela /> })
const SimulacaoFaseTab = dynamic(() => import("@/src/components/gerenciamentoComponents/SimulacaoFaseTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ExecutorMotorTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ExecutorMotorTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ModelosTarefaTransversalTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ModelosTarefaTransversalTab"), { ssr: false, loading: () => <CarregandoTela /> })
const RegrasTarefaTransversalTab = dynamic(() => import("@/src/components/gerenciamentoComponents/RegrasTarefaTransversalTab"), { ssr: false, loading: () => <CarregandoTela /> })
const WorkflowsFasesHubTab = dynamic(() => import("@/src/components/gerenciamentoComponents/WorkflowsFasesHubTab"), { ssr: false, loading: () => <CarregandoTela /> })
const PerfisPermissaoMotorTab = dynamic(() => import("@/src/components/gerenciamentoComponents/PerfisPermissaoMotorTab"), { ssr: false, loading: () => <CarregandoTela /> })

// cada catálogo do menu aponta pro CatalogTab com a chave do mockup
const cat = (k: string) => () => <CatalogTab catalogKey={k} />

const TELAS: Record<string, React.ComponentType> = {
  // reais
  overview: OverviewTab,
  users: UsersTab,
  roles: RolesTab,

  // catálogos (genérico CatalogTab)
  doctypes: TiposDocumentoTab,
  doccats: CategoriasDocumentaisTab,
  docrules: cat("op_docrules"),
  // certtypes NÃO tem tela própria: consolidado em doctypes (Tipos de Documento).
  // O deep-link ?screen=certtypes é resolvido por ALIAS_TELAS → doctypes (abaixo).
  currencies: MoedasTab,
  fx: CambioTab,
  methods: FormasPagamentoTab,
  banks: BancosTab,
  accounts: ContasTab,
  wallets: CarteirasTab,
  coa: PlanoContasTab,
  estruturafin: EstruturaFinanceiraTab,
  precificacao: PrecificacaoTab,
  fornecedoresconc: FornecedoresConcentradoraTab,
  comercial: ComercialTab,
  pagamentos: PagamentosTab,
  integracaofin: IntegracaoFinanceiraTab,
  categories: CategoriasTab,
  costcenters: CentrosCustoTab,
  taxes: ImpostosTab,
  fees: TaxasPagamentoTab,
  organs: OrgaosProtocoloTab,
  prottypes: cat("op_prottypes"),
  suppliers: FornecedoresTab,
  departments: DepartamentosTab,
  countrycatalog: cat("op_country_catalog"),

  // bespoke (lote 1)
  teams: TeamsTab,
  opauto: PhaseAutomationsFasesTab,
  workflowsphases: WorkflowsFasesHubTab,
  protocols: ProtocolsTab,
  sla: SLATab,
  templates: TemplatesTab,
  notifications: NotificationsTab,
  audit: LogAuditoriaTab,
  impexp: ImportExportTab,
  backup: BackupTab,
  settings: SettingsTab,

  // bespoke (lote 2)
  proctypes: TipoProcessoTab,
  macrokanban: MacroKanbanTab,
  mgmthealth: HealthTab,

  // bespoke (lote 3)
  phaseiwf: PhaseWorkflowsFasesTab,
  phasemodes: ModosInternosFasesTab,

  // bespoke (lote 4)
  catalog: ProdutosTab,
  catalogmestre: CatalogoMestreTab,
  products: ProdutosServicosTab,
  honorariums: HonorariosTab,
  paycond: CondicoesPagamentoTab,
  commrules: RegrasComissaoTab,
  discrules: RegrasDescontoTab,
  pricing: AplicabilidadeEconomicaTab,
  phasemap: PhaseTriggerRulesTab,
  crosstpl: ModelosTarefaTransversalTab,
  crossrules: RegrasTarefaTransversalTab,
  simfase: SimulacaoFaseTab,
  execmotor: ExecutorMotorTab,
  runtimediag: RuntimeWorkflowDiagnostics,
  diagnostics: DiagnosticsTab,

  // bespoke (lote 5) — bibliotecas de modelos
  iwtemplates: ModelosWorkflowInternoTab,
  imtemplates: ModelosInternosFaseTab,
  amtemplates: ModelosAutomacaoTab,

  // bespoke (lote 6) — Cadastros do Motor + Saúde
  rolecat: RoleCatalogTab,
  permprofiles: RolesTab,
  pricingtable: TabelaValoresTab,
  docmatrix: MatrizDocumentalTab,
  cfgversions: ConfigVersionsTab,
  cfgdiagnosis: ConfigDiagnosisTab,
  execmatrix: ExecMatrixTab,
  syshealth: SystemHealthTab,
}

function CarregandoTela() {
  return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/60" /></div>
}

// fallback de segurança (não deve aparecer — todas as telas estão registradas)
function EmBreve({ titulo }: { titulo: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-10 text-center">
      <Settings2 className="mx-auto mb-3 h-10 w-10 text-white/40" />
      <div className="font-semibold text-white/90">{titulo}</div>
      <div className="mt-1 text-sm text-white/50">Esta área será portada em breve.</div>
    </div>
  )
}

// ── helpers puros de navegação (derivam tudo da FONTE ÚNICA) ─────────────────
type Pode = (p: string) => boolean
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

const grupoDaKey = (key: string): ManagementNavigationItem | undefined =>
  MANAGEMENT_NAVIGATION.find((g) => (g.children ?? []).some((it) => it.key === key))

const itensAtivos = (g: ManagementNavigationItem, pode: Pode): ManagementNavigationItem[] =>
  (g.children ?? []).filter((it) => it.status === "active" && (!it.permission || pode(it.permission)))

// seções (blocos visuais) na ORDEM em que aparecem no array — reflete a intenção
// editorial de managementNavigation.tsx (ex.: Financeiro → Configuração, Precificação…).
interface Secao { nome: string; itens: ManagementNavigationItem[] }
const secoesDoModulo = (g: ManagementNavigationItem, pode: Pode): Secao[] => {
  const ordem: string[] = []
  const mapa = new Map<string, ManagementNavigationItem[]>()
  for (const it of itensAtivos(g, pode)) {
    const s = it.section || "Itens"
    if (!mapa.has(s)) { mapa.set(s, []); ordem.push(s) }
    mapa.get(s)!.push(it)
  }
  return ordem.map((nome) => ({ nome, itens: mapa.get(nome)! }))
}
// primeira tela útil do módulo (defaultRoute): 1º item ATIVO na ordem editorial do array.
const primeiraTelaDoModulo = (g: ManagementNavigationItem, pode: Pode): string | undefined =>
  itensAtivos(g, pode)[0]?.key

interface UserData { nome: string; email?: string; tipo?: string }

type View = "home" | "screen"

export default function GerenciamentoPage() {
  const router = useRouter()
  const { pode, carregando: permLoading } = usePermissoes()
  const isAdmin = pode("usuarios.gerenciar")

  // ALIASES: keys antigas → tela real (bookmarks continuam funcionando).
  // Consolidação: "Tipos de Certidão" foi unificado em "Tipos de Documento".
  const ALIAS_TELAS: Record<string, string> = { certtypes: "doctypes" }
  const resolverTela = useCallback((k: string | null): string => {
    if (!k) return "overview"
    return ALIAS_TELAS[k] || k
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── estado derivado da URL ─────────────────────────────────────────────────
  const [view, setView] = useState<View>("home")
  const [activeModule, setActiveModule] = useState<string | null>(null) // group key
  const [activeScreen, setActiveScreen] = useState<string | null>(null) // screen key
  const [busca, setBusca] = useState("")                                 // busca da home
  const [expandedModule, setExpandedModule] = useState<string | null>(null) // árvore: 1 módulo aberto
  const [navCollapsed, setNavCollapsed] = useState(false)                // árvore recolhida (rail)
  const [mobileNav, setMobileNav] = useState(false)

  const [user, setUser] = useState<UserData>({ nome: "Usuário" })
  const [processos, setProcessos] = useState<any[]>([])
  const [arvores, setArvores] = useState<any[]>([])

  // resolve a primeira tela útil de um módulo (defaultRoute). Se o módulo não tiver
  // tela ativa (não deveria, entre os visíveis), devolve null.
  const primeiraTela = useCallback((gkey: string): string | null => {
    const g = MANAGEMENT_NAVIGATION.find((x) => x.key === gkey)
    return g ? primeiraTelaDoModulo(g, pode) ?? null : null
  }, [pode])

  // lê a view atual a partir da URL (deep-link ?screen= ; ?module= legado → 1ª tela)
  const sincronizarDaURL = useCallback(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const screen = params.get("screen")
    const moduleKey = params.get("module")
    if (screen) {
      const key = resolverTela(screen)
      const g = grupoDaKey(key)
      setActiveScreen(key)
      setActiveModule(g?.key ?? null)
      setExpandedModule(g?.key ?? null)
      setView("screen")
    } else if (moduleKey && MANAGEMENT_NAVIGATION.some((g) => g.key === moduleKey)) {
      // ?module= legado → abre direto a 1ª tela útil (sem página intermediária de cards).
      const g = MANAGEMENT_NAVIGATION.find((x) => x.key === moduleKey)!
      const first = primeiraTelaDoModulo(g, pode)
      if (first) {
        setActiveScreen(first); setActiveModule(moduleKey); setExpandedModule(moduleKey); setView("screen")
      } else {
        setView("home"); setActiveModule(null); setActiveScreen(null)
      }
    } else {
      setView("home"); setActiveModule(null); setActiveScreen(null)
    }
  }, [pode, resolverTela])

  // navegação: atualiza URL (pushState → botão voltar do browser funciona) + estado
  const pushURL = (params: { screen?: string }) => {
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    url.searchParams.delete("screen"); url.searchParams.delete("module"); url.searchParams.delete("tab")
    if (params.screen) url.searchParams.set("screen", params.screen)
    window.history.pushState({}, "", url.toString())
  }

  const irParaHome = () => {
    pushURL({}); setView("home"); setActiveModule(null); setActiveScreen(null); setBusca(""); setMobileNav(false)
  }
  // clique no TÍTULO do módulo (árvore ou card da home): abre a 1ª tela útil + expande.
  const irParaModulo = (gkey: string) => {
    const first = primeiraTela(gkey)
    if (first) { irParaTela(first); return }
    // módulo sem tela ativa: apenas expande na árvore (não deve ocorrer entre visíveis).
    setExpandedModule(gkey); setActiveModule(gkey)
  }
  const irParaTela = (key: string) => {
    const k = resolverTela(key)
    const g = grupoDaKey(k)
    pushURL({ screen: k })
    setActiveScreen(k); setActiveModule(g?.key ?? null); setExpandedModule(g?.key ?? null)
    setView("screen"); setBusca(""); setMobileNav(false)
  }
  // árvore: expandir/recolher um módulo SEM navegar (peek). Accordion — 1 por vez.
  const toggleModulo = (gkey: string) => {
    setExpandedModule((prev) => (prev === gkey ? null : gkey))
  }

  const handleLogout = () => {
    localStorage.removeItem("authToken"); localStorage.removeItem("user"); router.push("/login")
  }

  const fetchHeaderData = useCallback(async () => {
    try {
      const [pr, a] = await Promise.all([fetch("/api/processos"), fetch("/api/arvore")])
      if (pr.ok) setProcessos((await pr.json()).processos || [])
      if (a.ok) { const ad = await a.json(); setArvores(Array.isArray(ad) ? ad : []) }
    } catch { /* silencioso */ }
  }, [])

  // montagem: deep-link + sincronização com botão voltar/avançar do browser
  useEffect(() => {
    sincronizarDaURL()
    window.addEventListener("popstate", sincronizarDaURL)
    return () => window.removeEventListener("popstate", sincronizarDaURL)
  }, [sincronizarDaURL])

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("user")
      if (stored) { try { setUser(JSON.parse(stored)) } catch { setUser({ nome: "Usuário" }) } }
    }
    const token = localStorage.getItem("authToken")
    if (!token) { router.push("/login"); return }
    if (!permLoading && !isAdmin) { router.push("/dashboard"); return }
    fetchHeaderData()
  }, [isAdmin, permLoading, router, fetchHeaderData])

  if (permLoading) {
    return (
      <div className="relative min-h-screen text-white">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center" />
        <div className="flex min-h-screen items-center justify-center bg-slate-950/70">
          <div className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white" />
            <p className="text-lg">Verificando permissões…</p>
          </div>
        </div>
      </div>
    )
  }
  if (!isAdmin) return null

  // ── módulos visíveis (cards da home): com item ativo, permitidos, não ocultos ─
  const modulosVisiveis = MANAGEMENT_NAVIGATION
    .filter((g) => !g.hiddenAsModule)
    .filter((g) => !g.permission || pode(g.permission))
    .map((g) => ({ g, itens: itensAtivos(g, pode) }))
    .filter((m) => m.itens.length > 0)
    .sort((x, y) => x.g.order - y.g.order)

  // ── busca global (home): módulos + telas ────────────────────────────────────
  const q = norm(busca.trim())
  const resultados = q
    ? MANAGEMENT_NAVIGATION
        .filter((g) => !g.permission || pode(g.permission))
        .flatMap((g) =>
          itensAtivos(g, pode).map((it) => ({
            key: it.key,
            label: it.label,
            modulo: g.fullLabel || g.label,
            secao: it.section || "",
            hay: norm([it.label, it.fullLabel ?? "", it.key, g.label, g.fullLabel ?? "", it.section ?? "", ...(it.keywords ?? [])].join(" ")),
          })),
        )
        .filter((r) => r.hay.includes(q))
        .slice(0, 40)
    : []

  const moduloAtivo = activeModule ? MANAGEMENT_NAVIGATION.find((g) => g.key === activeModule) : undefined
  const TelaAtiva = activeScreen ? TELAS[activeScreen] : undefined
  const labelTela = activeScreen
    ? moduloAtivo?.children?.find((it) => it.key === activeScreen)?.label || "Tela"
    : ""

  // classes de superfície — contraste real (fundo semissólido, blur discreto)
  const PANEL = "rounded-2xl border border-white/10 bg-slate-900/75 backdrop-blur-sm"

  return (
    <div className="relative min-h-screen overflow-x-hidden text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      {/* Scrim sólido: garante leitura sobre o fundo (menos transparência/blur excessivo) */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-slate-950/72" />

      <HeaderBar
        title="Gerenciamento Geral"
        subtitle="Cadastros, regras, valores, automações, permissões e configurações"
        userName={user.nome} userRole={user.tipo || "Usuário"} userEmail={user.email || ""}
        projetos={[]} processos={processos} arvores={arvores} onLogout={handleLogout}
      />

      <main className="relative mx-auto max-w-[1560px] px-5 py-7 md:px-9 md:pt-8">
        {/* ══════════════════════ HOME — MÓDULOS EM CARDS ══════════════════════ */}
        {view === "home" ? (
          <section aria-label="Módulos do Gerenciamento">
            <header className="mb-6">
              <h1 className="text-[30px] font-bold tracking-tight text-white md:text-[32px]">Gerenciamento Geral</h1>
              <p className="mt-1.5 max-w-3xl text-[15px] text-white/60">
                Cadastros, regras, valores, automações, permissões e configurações.
              </p>
              {/* Busca global */}
              <div className="relative mt-5 max-w-2xl">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/45" />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar configuração, módulo ou tela…"
                  aria-label="Buscar configuração, módulo ou tela"
                  className="w-full rounded-xl border border-white/12 bg-slate-900/70 py-3.5 pl-12 pr-11 text-[15px] text-white placeholder:text-white/45 focus:border-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                />
                {busca ? (
                  <button
                    onClick={() => setBusca("")}
                    aria-label="Limpar busca"
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </header>

            {q ? (
              // ── resultados da busca ──────────────────────────────────────────
              <div className={`${PANEL} p-2.5`}>
                {resultados.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm text-white/50">Nada encontrado para “{busca}”.</div>
                ) : (
                  <ul className="divide-y divide-white/5">
                    {resultados.map((r) => (
                      <li key={`${r.modulo}-${r.key}`}>
                        <button
                          onClick={() => irParaTela(r.key)}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium text-white">{r.label}</span>
                            <span className="mt-0.5 block truncate text-[12.5px] text-white/50">
                              {r.modulo}{r.secao ? ` › ${r.secao}` : ""}
                            </span>
                          </span>
                          <ChevronRight className="h-4 w-4 flex-none text-white/40" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              // ── grid de cards de módulo ──────────────────────────────────────
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {modulosVisiveis.map(({ g }) => {
                  const Icon = g.icon
                  return (
                    <button
                      key={g.key}
                      onClick={() => irParaModulo(g.key)}
                      className="group flex min-h-[188px] flex-col rounded-2xl border border-white/10 bg-slate-900/75 p-5 text-left backdrop-blur-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-white/25 hover:bg-slate-900/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                    >
                      <div className="mb-3.5 flex h-12 w-12 flex-none items-center justify-center rounded-xl border border-white/10 bg-white/[0.07] text-white/85 transition-colors group-hover:bg-white/[0.12]">
                        {Icon ? <Icon className="h-6 w-6" /> : <Settings2 className="h-6 w-6" />}
                      </div>
                      <h2 className="text-[19px] font-semibold leading-tight text-white">{g.fullLabel || g.label}</h2>
                      <p className="mt-1.5 flex-1 text-[14px] leading-snug text-white/55">{g.description || ""}</p>
                      <span className="mt-4 inline-flex items-center gap-1 text-[14px] font-medium text-white/80 group-hover:text-white">
                        Acessar <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        ) : null}

        {/* ═══════════ SHELL DO GERENCIAMENTO — ÁRVORE LATERAL ÚNICA + CONTEÚDO ═══════════ */}
        {/* Um ÚNICO layout: a árvore lateral (fonte única: managementNavigation) lista
            TODOS os módulos, cada um expansível com seus itens em LISTA. É a navegação
            principal e permanece visível/fixa ao trocar de tela. O conteúdo é sempre a
            tela selecionada — NÃO há página intermediária de cards por módulo. */}
        {view === "screen" && moduloAtivo ? (
          <section aria-label="Gerenciamento">
            {/* abrir árvore em mobile */}
            <button
              onClick={() => setMobileNav(true)}
              aria-label="Abrir navegação do Gerenciamento"
              className="mb-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.08] px-3 py-2 text-[13px] md:hidden"
            >
              <Menu className="h-4 w-4" /> {moduloAtivo.fullLabel || moduloAtivo.label}
            </button>

            {mobileNav ? (
              <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setMobileNav(false)} aria-hidden="true" />
            ) : null}

            <div className="flex items-start gap-5">
              {/* ÁRVORE LATERAL — TODOS os módulos; accordion (1 módulo aberto por vez) */}
              <aside
                aria-label="Navegação do Gerenciamento"
                className={`mgmt-scroll fixed left-0 top-0 z-40 h-full flex-none overflow-y-auto overflow-x-hidden border-r border-white/10 bg-slate-900/95 p-3 transition-transform duration-200 motion-reduce:transition-none md:sticky md:top-4 md:z-auto md:h-auto md:max-h-[calc(100vh-96px)] md:rounded-2xl md:border md:bg-slate-900/80 md:backdrop-blur-sm ${mobileNav ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 ${navCollapsed ? "md:w-[60px]" : "w-[280px] md:w-[272px]"}`}
              >
                {navCollapsed ? (
                  // modo recolhido (rail com ícones de TODOS os módulos)
                  <div className="hidden flex-col items-center gap-2 md:flex">
                    <button
                      onClick={() => setNavCollapsed(false)}
                      aria-label="Expandir navegação"
                      title="Expandir navegação"
                      className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                    >
                      <PanelLeftOpen className="h-5 w-5" />
                    </button>
                    {modulosVisiveis.map(({ g }) => {
                      const Icon = g.icon
                      const ativo = activeModule === g.key
                      return (
                        <button
                          key={g.key}
                          onClick={() => irParaModulo(g.key)}
                          title={g.fullLabel || g.label}
                          aria-label={g.fullLabel || g.label}
                          aria-current={ativo ? "true" : undefined}
                          className={`flex h-10 w-10 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                            ativo ? "bg-white/[0.14] text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                          }`}
                        >
                          {Icon ? <Icon className="h-5 w-5" /> : <Settings2 className="h-5 w-5" />}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <>
                    <div className="mb-2 flex items-center justify-between gap-2 px-1">
                      <button
                        onClick={irParaHome}
                        className="flex min-w-0 items-center gap-2 text-left text-[13px] font-bold uppercase tracking-wide text-white/75 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        title="Início do Gerenciamento"
                      >
                        <Home className="h-4 w-4 flex-none text-white/60" />
                        <span className="truncate">Gerenciamento</span>
                      </button>
                      <button
                        onClick={() => setNavCollapsed(true)}
                        aria-label="Recolher navegação"
                        title="Recolher navegação"
                        className="hidden flex-none rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 md:block"
                      >
                        <PanelLeftClose className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setMobileNav(false)}
                        aria-label="Fechar navegação"
                        className="flex-none rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white md:hidden"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Árvore: cada MÓDULO é expansível; itens em lista, agrupados por seção */}
                    <nav aria-label="Módulos do Gerenciamento" className="space-y-0.5">
                      {modulosVisiveis.map(({ g }) => {
                        const Icon = g.icon
                        const moduloAberto = expandedModule === g.key
                        const moduloEhAtivo = activeModule === g.key
                        const secoesG = secoesDoModulo(g, pode)
                        const mostrarSecoes = secoesG.length > 1
                        const painelId = `mod-${g.key}`
                        return (
                          <div key={g.key}>
                            {/* linha do módulo: título (navega p/ 1ª tela) + chevron (expande) */}
                            <div
                              className={`flex items-stretch rounded-lg transition-colors ${
                                moduloEhAtivo ? "bg-white/[0.06]" : "hover:bg-white/[0.05]"
                              }`}
                            >
                              <button
                                onClick={() => {
                                  // acordeão: aberto → recolhe; fechado-mas-ativo → só expande
                                  // (sem re-navegar); outro módulo → abre + vai à 1ª tela útil.
                                  if (moduloAberto) toggleModulo(g.key)
                                  else if (moduloEhAtivo) setExpandedModule(g.key)
                                  else irParaModulo(g.key)
                                }}
                                aria-current={moduloEhAtivo ? "true" : undefined}
                                aria-expanded={moduloAberto}
                                aria-controls={painelId}
                                title={g.fullLabel || g.label}
                                className="flex min-w-0 flex-1 items-center gap-2 rounded-l-lg py-2.5 pl-2.5 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                              >
                                {Icon ? (
                                  <Icon className={`h-4 w-4 flex-none ${moduloEhAtivo ? "text-white/85" : "text-white/55"}`} />
                                ) : null}
                                <span className={`min-w-0 flex-1 truncate text-[13.5px] font-semibold ${moduloEhAtivo ? "text-white" : "text-white/80"}`}>
                                  {g.fullLabel || g.label}
                                </span>
                              </button>
                              <button
                                onClick={() => toggleModulo(g.key)}
                                aria-expanded={moduloAberto}
                                aria-controls={painelId}
                                aria-label={moduloAberto ? `Recolher ${g.fullLabel || g.label}` : `Expandir ${g.fullLabel || g.label}`}
                                className="flex flex-none items-center rounded-r-lg px-2 text-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                              >
                                <ChevronRight className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${moduloAberto ? "rotate-90" : ""}`} />
                              </button>
                            </div>

                            {/* itens do módulo */}
                            <div
                              id={painelId}
                              aria-hidden={!moduloAberto}
                              className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${moduloAberto ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                            >
                              <div className="min-h-0 overflow-hidden">
                                <div className={`ml-[13px] space-y-0.5 border-l border-white/10 pb-1 pl-2 pt-1 transition-opacity duration-200 motion-reduce:transition-none ${moduloAberto ? "opacity-100" : "opacity-0"}`}>
                                  {secoesG.map((s) => (
                                    <div key={s.nome}>
                                      {mostrarSecoes ? (
                                        <div className="px-2 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/40">
                                          {s.nome}
                                        </div>
                                      ) : null}
                                      {s.itens.map((it) => {
                                        const ativo = activeScreen === it.key
                                        return (
                                          <button
                                            key={it.key}
                                            tabIndex={moduloAberto ? undefined : -1}
                                            onClick={() => irParaTela(it.key)}
                                            title={it.fullLabel || it.label}
                                            aria-current={ativo ? "page" : undefined}
                                            className={`flex min-h-[38px] w-full items-center gap-2 rounded-lg border-l-2 py-2 pl-3 pr-2.5 text-left text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                                              ativo
                                                ? "border-sky-400/80 bg-white/[0.12] font-semibold text-white"
                                                : "border-transparent text-white/65 hover:bg-white/[0.06] hover:text-white"
                                            }`}
                                          >
                                            <span className="min-w-0 flex-1 truncate">{it.label}</span>
                                          </button>
                                        )
                                      })}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </nav>
                  </>
                )}
              </aside>

              {/* CONTEÚDO — a tela selecionada (sem página intermediária de cards) */}
              <div className="min-w-0 flex-1">
                <Breadcrumb
                  trilha={[
                    { label: "Gerenciamento", onClick: irParaHome },
                    { label: moduloAtivo.fullLabel || moduloAtivo.label, onClick: () => irParaModulo(moduloAtivo.key) },
                    { label: labelTela },
                  ]}
                />

                <div className="mb-4 mt-1 flex items-center gap-3">
                  <h1 className="text-[22px] font-bold tracking-tight text-white md:text-[24px]">{labelTela}</h1>
                </div>
                {TelaAtiva ? <TelaAtiva /> : <EmBreve titulo={labelTela} />}
              </div>
            </div>
          </section>
        ) : null}

        <style>{`
          .mgmt-scroll{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}
          .mgmt-scroll::-webkit-scrollbar{width:8px}
          .mgmt-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:8px}
          .mgmt-scroll::-webkit-scrollbar-track{background:transparent}
        `}</style>
      </main>
    </div>
  )
}

// ── Breadcrumb com links (Gerenciamento › Módulo › Tela) ─────────────────────
function Breadcrumb({ trilha }: { trilha: { label: string; onClick?: () => void }[] }) {
  return (
    <nav aria-label="Trilha de navegação" className="flex flex-wrap items-center gap-1 text-[13px] text-white/50">
      <Home className="mr-0.5 h-3.5 w-3.5 text-white/40" />
      {trilha.map((c, i) => {
        const ultimo = i === trilha.length - 1
        return (
          <span key={i} className="inline-flex items-center gap-1">
            {c.onClick && !ultimo ? (
              <button
                onClick={c.onClick}
                className="rounded px-0.5 text-white/60 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {c.label}
              </button>
            ) : (
              <span className={ultimo ? "font-medium text-white/85" : "text-white/60"}>{c.label}</span>
            )}
            {!ultimo ? <ChevronRight className="h-3.5 w-3.5 text-white/30" /> : null}
          </span>
        )
      })}
    </nav>
  )
}
