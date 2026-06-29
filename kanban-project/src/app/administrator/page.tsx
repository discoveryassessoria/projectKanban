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
  ProcTypesTab, MacroKanbanTab, HealthTab,
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
  IWTemplatesTab, IMTemplatesTab, AMTemplatesTab,
} from "@/src/components/gerenciamentoComponents/GerenciamentoScaffolds5"

// Lote 6 — Cadastros do Motor + Saúde do Sistema (telas que faltavam)
import {
  ExecMatrixTab, SystemHealthTab, PricingTableTab, RoleCatalogTab,
  PermProfilesTab, DocMatrixTab, ConfigVersionsTab, ConfigDiagnosisTab,
} from "@/src/components/gerenciamentoComponents/GerenciamentoScaffolds6"

// ============================================================
// MENU — 11 grupos (fiel ao mockup Operacional v4)
// ============================================================
const GRUPOS: { grupo: string; itens: [string, string][] }[] = [
  { grupo: "Painel", itens: [["overview", "Painel Geral"]] },
  { grupo: "Centro do Processo", itens: [
    ["proctypes", "Processos de Nacionalidade"], ["macrokanban", "Workflow Macro / Kanban"],
    ["iwtemplates", "Modelos de Workflow Interno"], ["phaseiwf", "Workflows Internos das Fases"],
    ["imtemplates", "Modelos Internos de Fase"], ["phasemodes", "Modos Internos das Fases"],
    ["amtemplates", "Modelos de Automação"], ["opauto", "Automações por Fase"],
    ["phasemap", "Regras de Disparo por Fase"],
  ]},
  { grupo: "Cadastros do Motor", itens: [
    ["rolecat", "Papéis e Responsáveis"], ["permprofiles", "Usuários e Permissões"],
    ["products", "Produtos e Serviços"],
    ["pricingtable", "Tabela de Valores"], ["doctypes", "Tipos de Documento"],
    ["docmatrix", "Matriz Documental"], ["organs", "Órgãos de Protocolo"],
    ["sla", "SLAs e Prazos"], ["templates", "Modelos de Documento"],
    ["notifications", "Notificações"], ["cfgversions", "Versionamento e Publicação"],
    ["cfgdiagnosis", "Diagnóstico de Configuração"],
  ]},
  { grupo: "Documentos", itens: [
    ["doctypes", "Tipos de Documento"], ["docrules", "Matriz Documental"], ["certtypes", "Tipos de Certidão"],
  ]},
  { grupo: "Financeiro", itens: [
    ["honorariums", "Honorários"], ["products", "Produtos e Serviços"], ["catalog", "Catálogo Financeiro"],
    ["pricing", "Regras de Preço"], ["finauto", "Regras de Disparo Financeiro"],
    ["currencies", "Moedas"], ["fx", "Câmbio"], ["methods", "Formas de Pagamento"],
    ["banks", "Bancos"], ["accounts", "Contas"], ["wallets", "Carteiras"], ["coa", "Plano de Contas"],
    ["categories", "Categorias"], ["costcenters", "Centros de Custo"],
    ["taxes", "Impostos e Taxas"], ["fees", "Taxas de Pagamento"],
  ]},
  { grupo: "Protocolo e Órgãos", itens: [
    ["organs", "Órgãos"], ["protocols", "Regras de Protocolo"], ["prottypes", "Tipos de Protocolo"],
  ]},
  { grupo: "Fornecedores", itens: [["suppliers", "Fornecedores"]] },
  { grupo: "Modelos", itens: [["templates", "Modelos"]] },
  { grupo: "Agenda e SLA", itens: [["sla", "Regras de SLA / Prazos"], ["notifications", "Alertas e Lembretes"]] },
  { grupo: "Segurança e Auditoria", itens: [
    ["users", "Usuários"], ["roles", "Perfis"], ["teams", "Equipes"],
    ["departments", "Departamentos"], ["audit", "Logs / Auditoria"],
  ]},
  { grupo: "Saúde do Sistema", itens: [
    ["mgmthealth", "Diagnóstico Executivo"], ["execmatrix", "Painel Executivo"],
    ["syshealth", "Taxonomia / Saúde"], ["countrycatalog", "Catálogo Técnico de Países"],
    ["settings", "Configurações"], ["impexp", "Importação / Exportação"],
    ["backup", "Backup"], ["diagnostics", "Diagnóstico"],
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

// cada catálogo do menu aponta pro CatalogTab com a chave do mockup
const cat = (k: string) => () => <CatalogTab catalogKey={k} />

const TELAS: Record<string, React.ComponentType> = {
  // reais
  overview: OverviewTab,
  users: UsersTab,
  roles: RolesTab,

  // catálogos (genérico CatalogTab)
  doctypes: cat("op_doctypes"),
  docrules: cat("op_docrules"),
  certtypes: cat("op_certtypes"),
  currencies: cat("fin_currencies"),
  fx: CambioTab,
  methods: cat("fin_methods"),
  banks: BancosTab,
  accounts: ContasTab,
  wallets: cat("fin_wallets"),
  coa: cat("fin_coa"),
  categories: CategoriasTab,
  costcenters: CentrosCustoTab,
  taxes: ImpostosTab,
  fees: cat("fin_fees"),
  organs: cat("op_organs"),
  prottypes: cat("op_prottypes"),
  suppliers: FornecedoresTab,
  departments: cat("acc_departments"),
  countrycatalog: cat("op_country_catalog"),

  // bespoke (lote 1)
  teams: TeamsTab,
  finauto: FinAutomationsTab,
  opauto: OpAutomationsTab,
  products: ProductsTab,
  protocols: ProtocolsTab,
  sla: SLATab,
  templates: TemplatesTab,
  notifications: NotificationsTab,
  audit: AuditTab,
  impexp: ImportExportTab,
  backup: BackupTab,
  settings: SettingsTab,

  // bespoke (lote 2)
  proctypes: ProcTypesTab,
  macrokanban: MacroKanbanTab,
  mgmthealth: HealthTab,

  // bespoke (lote 3)
  phaseiwf: PhaseIWFTab,
  phasemodes: PhaseModesTab,

  // bespoke (lote 4)
  catalog: FinCatalogTab,
  honorariums: HonorariumsTab,
  pricing: PricingRulesTab,
  phasemap: PhaseMapTab,
  diagnostics: DiagnosticsTab,

  // bespoke (lote 5) — bibliotecas de modelos
  iwtemplates: IWTemplatesTab,
  imtemplates: IMTemplatesTab,
  amtemplates: AMTemplatesTab,

  // bespoke (lote 6) — Cadastros do Motor + Saúde
  rolecat: RoleCatalogTab,
  permprofiles: PermProfilesTab,
  pricingtable: PricingTableTab,
  docmatrix: DocMatrixTab,
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
  const [projetos, setProjetos] = useState<any[]>([])
  const [processos, setProcessos] = useState<any[]>([])
  const [arvores, setArvores] = useState<any[]>([])

  const handleLogout = () => {
    localStorage.removeItem("authToken"); localStorage.removeItem("user"); router.push("/login")
  }

  const fetchHeaderData = useCallback(async () => {
    try {
      const [p, pr, a] = await Promise.all([fetch("/api/projetos"), fetch("/api/processos"), fetch("/api/arvore")])
      if (p.ok) setProjetos((await p.json()).projetos || [])
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
        projetos={projetos} processos={processos} arvores={arvores} onLogout={handleLogout}
      />

      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />

        <main className="relative px-4 md:px-6 py-6 max-w-[1400px] mx-auto">
          <div className="flex gap-4 items-start">
            {/* MENU LATERAL */}
            <aside className="w-[230px] flex-none sticky top-4 max-h-[calc(100vh-90px)] overflow-auto bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-3">
              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                <input
                  value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar cadastro…"
                  className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-white/30"
                />
              </div>
              {gruposFiltrados.map(g => (
                <div key={g.grupo} className="mb-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-white/40 px-2 mb-1">{g.grupo}</div>
                  {g.itens.map(([key, label]) => (
                    <button key={key} onClick={() => { setTab(key); setBusca("") }}
                      className={`block w-full text-left px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors ${tab === key ? "bg-white/15 text-white font-semibold" : "text-white/60 hover:text-white hover:bg-white/5"}`}>
                      {label}
                    </button>
                  ))}
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