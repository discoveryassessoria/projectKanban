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
import { Search, Loader2, Settings2 } from "lucide-react"
import dynamic from "next/dynamic"

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
const GRUPOS: { grupo: string; itens: [string, string][] }[] = [
  { grupo: "Painel", itens: [["overview", "Painel Geral"]] },

  { grupo: "Processos e Workflows", itens: [
    ["proctypes", "Tipos de Processo"],
    ["workflowsphases", "Workflows e Fases"],
    ["phasemodes", "Modos Internos"],
    ["phasemap", "Regras do Processo"],
    ["simfase", "Configurações Aplicadas"],
  ]},

  { grupo: "Catálogo Mestre", itens: [
    ["catalogmestre", "Itens"],
    ["doctypes", "Tipos de Documento"],
    ["categories", "Categorias"],
    ["currencies", "Unidades"],
    ["products", "Composições"],
  ]},

  { grupo: "Matrizes e Aplicabilidade", itens: [
    ["docmatrix", "Matriz Documental"],
    ["docrules", "Aplicabilidade Operacional"],
    ["pricing", "Aplicabilidade Econômica"],
    ["imtemplates", "Pacotes"],
  ]},

  { grupo: "Biblioteca Operacional", itens: [
    ["iwtemplates", "Passos"],
    ["crosstpl", "Tarefas"],
    ["certtypes", "Checklists"],
    ["sla", "SLAs e Prazos"],
    ["notifications", "Eventos"],
  ]},

  { grupo: "Automações", itens: [
    ["amtemplates", "Biblioteca"],
    ["opauto", "Regras Aplicadas"],
    ["finauto", "Gatilhos e Condições"],
    ["simfase", "Simulador"],
    ["execmotor", "Conflitos"],
  ]},

  { grupo: "Tarefas Transversais", itens: [
    ["crosstpl", "Biblioteca"],
    ["crossrules", "Regras"],
    ["crossrules", "Regularização"],
  ]},

  { grupo: "Financeiro e Precificação", itens: [
    ["precificacao", "Precificação"],
    ["fornecedoresconc", "Fornecedores"],
    ["comercial", "Comercial"],
    ["pagamentos", "Pagamentos"],
    ["estruturafin", "Estrutura Financeira"],
    ["integracaofin", "Integração Financeira"],
  ]},

  { grupo: "Usuários e Acesso", itens: [
    ["users", "Usuários"],
    ["teams", "Perfis e Equipes"],
    ["permprofiles", "Permissões"],
    ["roles", "Permissões de Tarefas"],
    ["departments", "Delegações e Ausências"],
  ]},

  { grupo: "Protocolos e Órgãos", itens: [
    ["organs", "Órgãos"],
    ["prottypes", "Tipos de Protocolo"],
    ["protocols", "Regras"],
    ["docrules", "Exigências"],
  ]},

  { grupo: "Governança", itens: [
    ["cfgversions", "Aprovações"],
    ["commrules", "Alçadas"],
    ["cfgversions", "Versionamento"],
    ["cfgdiagnosis", "Publicação"],
    ["audit", "Auditoria"],
  ]},

  { grupo: "Motor e Saúde", itens: [
    ["execmatrix", "Execuções"],
    ["mgmthealth", "Falhas e Retry"],
    ["diagnostics", "Reconciliação"],
    ["syshealth", "Diagnóstico"],
    ["audit", "Logs"],
  ]},

  { grupo: "Sistema", itens: [
    ["settings", "Configurações"],
    ["impexp", "Importação e Exportação"],
    ["backup", "Backup"],
    ["countrycatalog", "Integrações"],
  ]},
]

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
  docrules: cat("op_docrules"),
  certtypes: cat("op_certtypes"),
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

  const [tab, setTab] = useState("overview")
  const [busca, setBusca] = useState("")
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

  // filtro da busca do menu
  const gruposFiltrados = busca
    ? GRUPOS.map(g => ({ ...g, itens: g.itens.filter(([, label]) => label.toLowerCase().includes(busca.toLowerCase())) })).filter(g => g.itens.length)
    : GRUPOS

  const TelaAtiva = TELAS[tab]
  const labelAtivo = GRUPOS.flatMap(g => g.itens).find(([k]) => k === tab)?.[1] || "Gerenciamento"

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
          <div className="flex gap-4 items-start">
            {/* MENU LATERAL */}
            <aside className="w-[230px] flex-none sticky top-4 max-h-[calc(100vh-90px)] overflow-auto bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-3">
              {/* busca */}
              <div className="relative mb-4">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                <input
                  value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar cadastro…"
                  className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-white/30"
                />
              </div>

              {gruposFiltrados.map((g, gi) => (
                <div key={g.grupo} className={gi === 0 ? "" : "mt-6"}>
                  {/* TÍTULO DA CATEGORIA */}
                  <div className="mb-2 border-b border-white/10 px-1 pb-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">
                      {g.grupo}
                    </span>
                  </div>

                  {/* PÁGINAS */}
                  <div className="space-y-0.5">
                    {g.itens.map(([key, label]) => {
                      const ativo = tab === key
                      return (
                        <button
                          key={key}
                          onClick={() => { setTab(key); setBusca("") }}
                          className={`block w-full rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                            ativo
                              ? "bg-white/15 font-semibold text-white"
                              : "text-white/60 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </aside>

            {/* CONTEÚDO */}
            <section className="flex-1 min-w-0">
              {TelaAtiva ? <TelaAtiva /> : <EmBreve titulo={labelAtivo} />}
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}