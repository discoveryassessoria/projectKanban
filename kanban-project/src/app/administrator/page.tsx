// ESTE ARQUIVO SUBSTITUI: src/app/administrator/page.tsx
//
// GERENCIAMENTO GERAL — casca com menu lateral (11 grupos), fiel ao mockup Operacional v4.
// Inclui grupo Cadastros do Motor, Financeiro completo e Saúde do Sistema completo.
// Todas as telas montadas (scaffold). Próximo passo: ligar dados/CRUD (wiring).

"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { HeaderBar } from "@/src/components/header-bar"
import { Search, Loader2, Settings2, ChevronRight, Menu, X } from "lucide-react"
import dynamic from "next/dynamic"
import {
  MANAGEMENT_NAVIGATION,
  type ManagementNavigationItem,
} from "@/src/components/gerenciamentoComponents/managementNavigation"

// Lote 1 — 12 telas bespoke
import {
  TeamsTab, FinAutomationsTab, OpAutomationsTab, ProductsTab, ProtocolsTab,
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
// MENU — 11 grupos (fiel ao mockup Operacional v4)
// ============================================================
// ============================================================
// LOTE D — Gerenciamento reorganizado nos 13 DOMÍNIOS do Marco.
// REUSA as telas existentes (mesmas keys); só muda a organização do menu.
// Nada de tela nova aqui — cada key já existe no MAPA DE TELAS abaixo.
// ============================================================
// Estrutura oficial aprovada — 11 domínios. Reorganização de MENU apenas:
// reusa as screen keys existentes (URLs preservadas); itens sem tela ainda
// caem no placeholder "Em breve" (padrão já existente no shell).
// A navegação (grupos, itens, ordem, ícones, keywords, status, permissão) agora
// vive na configuração central declarativa: managementNavigation.tsx. Este page
// apenas a RENDERIZA. As screen keys (deep-link ?screen=) são preservadas.

// ============================================================
// MAPA DE TELAS
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
  // O scaffold op_certtypes foi aposentado (removido de gerenciamentoCatalogs).
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
  finauto: FinAutomationsTab,
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
  return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>
}

// fallback de segurança (não deve mais aparecer — todas as telas estão registradas)
function EmBreve({ titulo }: { titulo: string }) {
  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-10 text-center">
      <Settings2 className="h-10 w-10 text-white/30 mx-auto mb-3" />
      <div className="text-white/80 font-semibold">{titulo}</div>
      <div className="text-white/40 text-sm mt-1">Esta área será portada em breve.</div>
    </div>
  )
}

interface UserData { nome: string; email?: string; tipo?: string }

export default function GerenciamentoPage() {
  const router = useRouter()
  const { pode, carregando: permLoading } = usePermissoes()
  const isAdmin = pode("usuarios.gerenciar")

  // LOTE D — deep-link + compatibilidade: a tela ativa vem da URL (?screen=).
  // ALIASES: keys antigas (substituídas pelas concentradoras) → nova tela, pra
  // links salvos continuarem funcionando (o "redirect" que o Marco pediu, no
  // modelo real do sistema, que é navegação por state e não por rota).
  // Estrutura oficial (menu por domínio): as keys financeiras agora são itens
  // planos e resolvem para suas próprias telas. Aliases das concentradoras foram
  // removidos (as concentradoras seguem acessíveis por suas keys próprias em
  // TELAS: estruturafin, precificacao, comercial, pagamentos, integracaofin,
  // fornecedoresconc). Bookmarks antigos continuam resolvendo (nenhuma key sumiu).
  // Consolidação: "Tipos de Certidão" foi unificado em "Tipos de Documento" (cadastro
  // mestre). Links antigos (?screen=certtypes) continuam funcionando, redirecionando
  // para a tela real do mestre (doctypes). Nenhuma rota/API/entidade alterada.
  const ALIAS_TELAS: Record<string, string> = { certtypes: "doctypes" }
  const resolverTela = (k: string | null): string => {
    if (!k) return "overview"
    return ALIAS_TELAS[k] || k
  }

  const [tab, setTab] = useState("overview")
  // colapso da sidebar: só UM grupo aberto por vez (persistido em localStorage).
  const [openGroup, setOpenGroup] = useState<string | null>(null)

  const grupoDaKey = (key: string): string | undefined =>
    MANAGEMENT_NAVIGATION.find((g) => (g.children ?? []).some((it) => it.key === key))?.key

  const persistirGrupo = (g: string | null) => {
    if (typeof window === "undefined") return
    if (g) localStorage.setItem("mgmt_open_group", g)
    else localStorage.removeItem("mgmt_open_group")
  }

  // lê a tela da URL na montagem (deep-link) + restaura o grupo aberto salvo
  useEffect(() => {
    if (typeof window === "undefined") return
    const screen = new URLSearchParams(window.location.search).get("screen")
    const telaInicial = screen ? resolverTela(screen) : "overview"
    if (screen) setTab(telaInicial)
    const salvo = localStorage.getItem("mgmt_open_group")
    setOpenGroup(salvo || grupoDaKey(telaInicial) || MANAGEMENT_NAVIGATION[0]?.key || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // troca de tela: atualiza state E URL (?screen=), mantém o grupo do item aberto
  const irParaTela = (key: string) => {
    setTab(key); setBusca("")
    const g = grupoDaKey(key)
    if (g) { setOpenGroup(g); persistirGrupo(g) }
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)
      url.searchParams.set("screen", key)
      url.searchParams.delete("tab") // a nova tela define sua própria aba
      window.history.replaceState({}, "", url.toString())
    }
  }
  // recolher/expandir um grupo (fecha os demais → só um aberto)
  const toggleGroup = (gkey: string) => {
    const nv = openGroup === gkey ? null : gkey
    setOpenGroup(nv); persistirGrupo(nv)
  }
  const [busca, setBusca] = useState("")
  const [mobileOpen, setMobileOpen] = useState(false)
  const [user, setUser] = useState<UserData>({ nome: "Usuário" })
  const [processos, setProcessos] = useState<any[]>([])
  const [arvores, setArvores] = useState<any[]>([])

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
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-4" />
            <p className="text-lg">Verificando permissões...</p>
          </div>
        </div>
      </div>
    )
  }
  if (!isAdmin) return null

  // ── grupos VISÍVEIS (status + permissão + busca normalizada sem acento) ─────
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  const q = norm(busca.trim())
  const grupoDoAtivo = grupoDaKey(tab)
  const itemRenderavel = (it: ManagementNavigationItem) =>
    it.status !== "hidden" && (!it.permission || pode(it.permission))
  const casaBusca = (it: ManagementNavigationItem, g: ManagementNavigationItem) => {
    if (!q) return true
    const hay = norm(
      [it.label, it.fullLabel ?? "", it.key, g.label, g.fullLabel ?? "", ...(it.keywords ?? [])].join(" "),
    )
    return hay.includes(q)
  }
  const gruposVisiveis = MANAGEMENT_NAVIGATION
    .filter((g) => !g.permission || pode(g.permission)) // grupo técnico só com permissão
    .map((g) => ({
      key: g.key,
      grupo: g.label,
      fullLabel: g.fullLabel || g.label,
      icon: g.icon,
      itens: (g.children ?? [])
        .filter((it) => itemRenderavel(it) && casaBusca(it, g))
        .sort((x, y) => x.order - y.order),
    }))
    .filter((g) => g.itens.length > 0)

  const flatItens = MANAGEMENT_NAVIGATION.flatMap((g) =>
    (g.children ?? []).map((it) => ({ ...it, grupo: g.fullLabel || g.label })))
  const TelaAtiva = TELAS[tab]
  const labelAtivo = flatItens.find((it) => it.key === tab)?.label || "Gerenciamento"
  const grupoAtivo = flatItens.find((it) => it.key === tab)?.grupo

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      <HeaderBar
        title="Gerenciamento Geral"
        subtitle="Cadastros, regras, valores, automações, permissões e configurações"
        userName={user.nome} userRole={user.tipo || "Usuário"} userEmail={user.email || ""}
        projetos={[]} processos={processos} arvores={arvores} onLogout={handleLogout}
      />

      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />

        <main className="relative px-4 md:px-6 py-6 max-w-[1400px] mx-auto">
          {/* Abrir menu em viewport menor */}
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu do Gerenciamento"
            className="md:hidden mb-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <Menu className="h-4 w-4" /> Menu
          </button>

          {/* Backdrop — só quando a sidebar está aberta em mobile */}
          {mobileOpen ? (
            <div
              className="fixed inset-0 z-30 bg-black/50 md:hidden"
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
          ) : null}

          <div className="flex gap-4 items-start">
            {/* MENU LATERAL */}
            <aside
              aria-label="Navegação do Gerenciamento"
              className={`mgmt-scroll w-[240px] flex-none overflow-y-auto overflow-x-hidden bg-white/[0.06] backdrop-blur-md border border-white/10 p-2.5 fixed top-0 left-0 z-40 h-full rounded-none transition-transform duration-200 motion-reduce:transition-none ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:sticky md:top-4 md:z-auto md:h-auto md:max-h-[calc(100vh-90px)] md:rounded-xl md:translate-x-0`}
            >
              {/* BUSCA — fixa no topo ao rolar */}
              <div className="sticky top-0 z-10 -mt-0.5 mb-2 pb-2 bg-white/[0.06] backdrop-blur-md">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar configuração…"
                    aria-label="Buscar configuração"
                    className="w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-7 py-1.5 text-xs text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  />
                  {busca ? (
                    <button
                      onClick={() => setBusca("")}
                      aria-label="Limpar busca"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>

              {gruposVisiveis.length === 0 ? (
                <div className="px-1 py-3 text-[12px] text-white/40">Nada encontrado.</div>
              ) : null}

              {gruposVisiveis.map((g) => {
                const aberto = !!q || openGroup === g.key
                const contemAtivo = grupoDoAtivo === g.key
                const Icon = g.icon
                const painelId = `grp-items-${g.key}`
                return (
                  <div key={g.key} className="mb-0.5">
                    {/* CABEÇALHO DO GRUPO — recolhível */}
                    <button
                      onClick={() => toggleGroup(g.key)}
                      aria-expanded={aberto}
                      aria-controls={painelId}
                      aria-label={g.fullLabel}
                      title={g.fullLabel}
                      className={`w-full flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${contemAtivo ? "bg-white/[0.06]" : ""}`}
                    >
                      {Icon ? <Icon className={`h-4 w-4 flex-none ${contemAtivo ? "text-white/80" : "text-white/50"}`} /> : null}
                      <span className={`flex-1 min-w-0 text-left text-[11px] font-bold uppercase tracking-[0.12em] ${contemAtivo ? "text-white/80" : "text-white/50"}`}>
                        {g.grupo}
                      </span>
                      <ChevronRight className={`h-3.5 w-3.5 flex-none text-white/40 transition-transform duration-200 motion-reduce:transition-none ${aberto ? "rotate-90" : ""}`} />
                    </button>

                    {/* PÁGINAS DO GRUPO — animação de altura (grid-rows) */}
                    <div
                      id={painelId}
                      aria-hidden={!aberto}
                      className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${aberto ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div className={`space-y-px pl-1 pt-0.5 pb-0.5 transition-opacity duration-200 motion-reduce:transition-none ${aberto ? "opacity-100" : "opacity-0"}`}>
                          {g.itens.map((it) => {
                            const ativo = tab === it.key
                            const soon = it.status === "coming_soon"
                            return (
                              <button
                                key={it.key}
                                disabled={soon}
                                tabIndex={aberto ? undefined : -1}
                                onClick={() => { if (!soon) { irParaTela(it.key); setMobileOpen(false) } }}
                                title={it.label}
                                aria-current={ativo ? "page" : undefined}
                                className={`w-full flex items-center gap-2 rounded-md border-l-2 pl-2 pr-2.5 py-1.5 text-left text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                                  ativo
                                    ? "border-white/70 bg-white/[0.12] font-semibold text-white"
                                    : soon
                                    ? "border-transparent text-white/30 cursor-not-allowed"
                                    : "border-transparent text-white/60 hover:bg-white/5 hover:text-white"
                                }`}
                              >
                                <span className="flex-1 min-w-0 truncate">{it.label}</span>
                                {soon ? (
                                  <span className="text-[9px] uppercase tracking-wide text-white/30 flex-none">Em breve</span>
                                ) : null}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </aside>

            {/* CONTEÚDO */}
            <section className="flex-1 min-w-0">
              {/* Breadcrumb: Gerenciamento › Grupo › Item */}
              <div className="mb-3 text-[12px] text-white/50">
                Gerenciamento{grupoAtivo ? ` › ${grupoAtivo}` : ""} › {labelAtivo}
              </div>
              {TelaAtiva ? <TelaAtiva /> : <EmBreve titulo={labelAtivo} />}
            </section>
          </div>

          <style>{`
            .mgmt-scroll{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent}
            .mgmt-scroll::-webkit-scrollbar{width:8px}
            .mgmt-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:8px}
            .mgmt-scroll::-webkit-scrollbar-track{background:transparent}
          `}</style>
        </main>
      </div>
    </div>
  )
}