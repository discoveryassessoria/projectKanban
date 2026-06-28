// ESTE ARQUIVO SUBSTITUI: src/app/administrator/page.tsx
//
// GERENCIAMENTO GERAL — casca com menu lateral (10 grupos, ~40 telas).
// Cada item do menu carrega um componente de src/components/gerenciamentoComponents/.
// Nesta Fatia 1, só "overview" (Painel Geral) está ligado; o resto mostra um
// placeholder "em breve". Cada fatia seguinte preenche um item no mapa TELAS.
//
// Preserva o sistema real de permissões: usePermissoes() + guarda usuarios.gerenciar.

"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { HeaderBar } from "@/src/components/header-bar"
import { Search, Loader2, Settings2 } from "lucide-react"
import dynamic from "next/dynamic"

// ============================================================
// MENU — 10 grupos, ~40 itens (fiel ao mockup Operacional)
// ============================================================
const GRUPOS: { grupo: string; itens: [string, string][] }[] = [
  { grupo: "Painel", itens: [["overview", "Painel Geral"]] },
  { grupo: "Centro do Processo", itens: [
    ["proctypes", "Processos de Nacionalidade"], ["macrokanban", "Workflow Macro / Kanban"],
    ["phaseiwf", "Workflows Internos das Fases"], ["phasemodes", "Modos Internos das Fases"],
    ["opauto", "Automações por Fase"], ["phasemap", "Regras de Disparo por Fase"],
  ]},
  { grupo: "Documentos", itens: [
    ["doctypes", "Tipos de Documento"], ["docrules", "Matriz Documental"], ["certtypes", "Tipos de Certidão"],
  ]},
  { grupo: "Financeiro", itens: [
    ["honorariums", "Honorários"], ["products", "Produtos e Serviços"], ["catalog", "Catálogo Financeiro"],
    ["pricing", "Regras de Preço"], ["finauto", "Regras de Disparo Financeiro"],
    ["currencies", "Moedas"], ["fx", "Câmbio"], ["methods", "Formas de Pagamento"],
    ["banks", "Bancos"], ["accounts", "Contas"], ["categories", "Categorias"],
    ["costcenters", "Centros de Custo"], ["taxes", "Impostos e Taxas"], ["fees", "Taxas de Pagamento"],
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
    ["health", "Diagnóstico Executivo"], ["settings", "Configurações"],
    ["impexp", "Importação / Exportação"], ["backup", "Backup"], ["diagnostics", "Diagnóstico"],
  ]},
]

// ============================================================
// MAPA DE TELAS — cada fatia adiciona um componente aqui.
// (Fatia 1: só overview. Próximas: users, roles, etc.)
// ============================================================
const OverviewTab = dynamic(() => import("@/src/components/gerenciamentoComponents/OverviewTab"), {
  ssr: false, loading: () => <CarregandoTela />,
})

const UsersTab = dynamic(() => import("@/src/components/gerenciamentoComponents/UsersTab"), {
  ssr: false, loading: () => <CarregandoTela />,
})

const TELAS: Record<string, React.ComponentType> = {
  overview: OverviewTab,
  users: UsersTab,
}

function CarregandoTela() {
  return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>
}

// placeholder elegante pros itens ainda não portados
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