// src/app/financeiro/page.tsx
//
// FINANCEIRO GERAL (corporativo)
//
// Shell da tela: fundo, HeaderBar, navegação interna (Dashboard, Tesouraria,
// A Receber, A Pagar, Fluxo de Caixa — ativo com sublinhado dourado) e as abas.
// O conteúdo do Dashboard Corporativo vive em
// src/components/financeiro/dashboard-corporativo.tsx.

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { HeaderBar } from "@/src/components/header-bar"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { Loader2, FileText } from "lucide-react"
import dynamic from "next/dynamic"
import { DashboardCorporativo, OURO, type DashboardData } from "@/src/components/financeiro/dashboard-corporativo"
import { CentralFinanceira } from "@/src/components/financeiro/CentralFinanceira"
import { PagamentosView } from "@/src/components/financeiro/PagamentosView"
import { CreditosView } from "@/src/components/financeiro/CreditosView"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { useApi } from "@/src/lib/dados"
import type { ProcessoWithStatus } from "@/src/types/kanban"

const TesourariaTab = dynamic(() => import("@/src/components/financeiroComponents/TesourariaTab"), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>,
})
const ReceberTab = dynamic(() => import("@/src/components/financeiroComponents/ReceberTab"), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>,
})
const CobrancasTab = dynamic(() => import("@/src/components/financeiroComponents/CobrancasTab"), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>,
})
const PagarTab = dynamic(() => import("@/src/components/financeiroComponents/PagarTab"), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>,
})
const FluxoTab = dynamic(() => import("@/src/components/financeiroComponents/FluxoTab"), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>,
})
const DreTab = dynamic(() => import("@/src/components/financeiroComponents/DreTab"), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>,
})
const CcTab = dynamic(() => import("@/src/components/financeiroComponents/CcTab"), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>,
})
const ComissoesTab = dynamic(() => import("@/src/components/financeiroComponents/ComissoesTab"), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>,
})
const ImpostosTab = dynamic(() => import("@/src/components/financeiroComponents/ImpostosTab"), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>,
})
const AuditoriaTab = dynamic(() => import("@/src/components/financeiroComponents/AuditoriaTab"), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>,
})

// ============================================================
// ABAS
// ============================================================
// `avancada` = área sem dado real consolidado ainda → escondida da barra para não poluir.
// Reative removendo o flag quando a área tiver dado de verdade.
const TABS = [
  { key: "central", label: "Central" },
  { key: "dashboard", label: "Dashboard" },
  { key: "tesouraria", label: "Tesouraria" },
  { key: "receber", label: "A Receber" },
  { key: "cobrancas", label: "Cobranças" },
  { key: "pagamentos", label: "Pagamentos" },
  { key: "creditos", label: "Créditos" },
  { key: "pagar", label: "A Pagar" },
  { key: "fluxo", label: "Fluxo de Caixa" },
  { key: "dre", label: "DRE", avancada: true },
  { key: "cc", label: "Centros de Custo", avancada: true },
  { key: "comissoes", label: "Comissões", avancada: true },
  { key: "impostos", label: "Impostos", avancada: true },
  { key: "auditoria", label: "Auditoria", avancada: true },
] as const
type TabKey = (typeof TABS)[number]["key"]
const TABS_VISIVEIS = TABS.filter((t) => !("avancada" in t && t.avancada))

// ============================================================
// PAGE
// ============================================================
/** Forma mínima que o HeaderBar consome das árvores. */
interface ItemNomeado {
  id: number | string
  nome: string
  descricao?: string | null
}

export default function FinanceiroPage() {
  const router = useRouter()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  // Usuário do localStorage pela abstração oficial (contrato de hidratação).
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string; email?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }
  const [tab, setTab] = useState<TabKey>("central")
  // As três leituras da tela pela camada oficial. Antes: um efeito de montagem com
  // `carregarDashboard()` mais dois `fetch().then()` soltos, quatro `useState` para
  // guardar o que o cache guarda, e o token montado à mão em cada chamada.
  const dashboard = useApi<DashboardData>("/api/financas/dashboard")
  const processosReq = useApi<{ processos?: ProcessoWithStatus[] }>("/api/processos")
  const arvoresReq = useApi<ItemNomeado[]>("/api/arvore")
  const dash = dashboard.dados ?? null
  // Processos e árvores alimentam a busca do HeaderBar: falha ali não pode derrubar
  // a tela, e é por isso que os `.catch(() => {})` originais existiam.
  const processos = processosReq.dados?.processos ?? []
  const arvores = Array.isArray(arvoresReq.dados) ? arvoresReq.dados : []
  const loading = dashboard.carregando


  const handleLogout = () => { void encerrarSessao("manual") }

  useEffect(() => {
    if (mounted && !carregando && !pode("financeiro.ver")) router.push("/")
  }, [mounted, carregando, pode, router])

  if (!mounted || carregando || !pode("financeiro.ver")) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div
          className="pointer-events-none fixed inset-0 -z-10"
          style={{
            background:
              "linear-gradient(180deg, rgba(8,9,11,.985) 0%, rgba(8,9,11,.975) 46%, rgba(8,9,11,.95) 60%," +
              " rgba(8,9,11,.86) 72%, rgba(8,9,11,.76) 86%, rgba(8,9,11,.88) 100%)",
          }}
        />
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando financeiro…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      {/* Fundo arquitetônico desfocado e escurecido (somente desta tela) */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, rgba(8,9,11,.985) 0%, rgba(8,9,11,.975) 46%, rgba(8,9,11,.95) 60%," +
            " rgba(8,9,11,.86) 72%, rgba(8,9,11,.76) 86%, rgba(8,9,11,.88) 100%)",
        }}
      />

      <HeaderBar
        title="Financeiro Geral"
        subtitle="Visão financeira corporativa do escritório"
        userName={user.nome}
        userRole={user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"}
        userEmail={user.email || ""}
        projetos={[]}
        processos={processos}
        arvores={arvores}
        onLogout={handleLogout}
      />

      <div className="min-h-screen relative">
        <main className="relative px-4 py-4 max-w-full">

          {/* NAV DE ABAS — ativa com sublinhado dourado */}
          <div className="relative mb-4">
            <div className="flex gap-1 overflow-x-auto relative z-10">
              {TABS_VISIVEIS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`relative px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors -mb-px border-b-2 border-transparent ${
                    tab === t.key ? "" : "text-white/55 hover:text-white"
                  }`}
                  style={tab === t.key ? { color: OURO, borderBottomColor: OURO } : undefined}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="h-px bg-white/10 w-full" />
          </div>

          {tab === "central" ? (
            <CentralFinanceira onIrPara={(t) => setTab(t as TabKey)} />
          ) : tab === "dashboard" ? (
            loading || !dash
              ? <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>
              : <DashboardCorporativo
                  dash={dash}
                  onGoTab={(t) => setTab(t as TabKey)}
                  onClickProcesso={(id, pais) => router.push(`/kanban?processoId=${id}&tab=faturas&pais=${pais}`)}
                />
          ) : tab === "tesouraria" ? (
            <TesourariaTab />
          ) : tab === "receber" ? (
            <ReceberTab />
          ) : tab === "cobrancas" ? (
            <CobrancasTab />
          ) : tab === "pagamentos" ? (
            <PagamentosView />
          ) : tab === "creditos" ? (
            <CreditosView />
          ) : tab === "pagar" ? (
            <PagarTab />
          ) : tab === "fluxo" ? (
            <FluxoTab />
          ) : tab === "dre" ? (
            <DreTab />
          ) : tab === "cc" ? (
            <CcTab />
          ) : tab === "comissoes" ? (
            <ComissoesTab />
          ) : tab === "impostos" ? (
            <ImpostosTab />
          ) : tab === "auditoria" ? (
            <AuditoriaTab />
          ) : (
            <EmConstrucao tab={tab} />
          )}

        </main>
      </div>
    </div>
  )
}

function EmConstrucao({ tab }: { tab: TabKey }) {
  const label = TABS.find(t => t.key === tab)?.label ?? tab
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.05] backdrop-blur-md p-16 text-center">
      <FileText className="h-10 w-10 text-white/30 mx-auto mb-3" />
      <h3 className="text-white font-semibold">{label}</h3>
      <p className="text-white/50 text-sm mt-1">Esta aba entra na próxima fatia da entrega.</p>
    </div>
  )
}
