"use client"

// src/components/gerenciamentoComponents/ExportacoesTab.tsx
// RELATÓRIOS E INDICADORES › EXPORTAÇÕES.
// Exportação REAL: busca o cadastro na MESMA API que a tela dele usa e baixa o
// arquivo (CSV ou JSON) no navegador. Não existe endpoint de exportação paralelo
// nem cópia dos dados — a fonte é sempre a rota canônica do cadastro.
//
// Só leitura: esta tela nunca escreve. Importação não faz parte da arquitetura
// oficial do módulo (o dado entra pela tela dona de cada cadastro).

import { useCallback, useState } from "react"

interface Fonte {
  chave: string
  nome: string
  modulo: string
  url: string
  /** propriedade do JSON que contém a lista */
  raiz: string
}

// Cada fonte aponta para a rota CANÔNICA já usada pela tela do cadastro.
const FONTES: Fonte[] = [
  { chave: "tipos-processo", nome: "Tipos de Processo", modulo: "Processos", url: "/api/gerenciamento/tipos-processo", raiz: "tipos" },
  { chave: "paises", nome: "Países e Regiões", modulo: "Processos", url: "/api/gerenciamento/paises", raiz: "paises" },
  { chave: "catalogo-fases", nome: "Catálogo de Fases", modulo: "Processos", url: "/api/gerenciamento/catalogo-fases", raiz: "fases" },
  { chave: "tipos-documento", nome: "Tipos de Documento", modulo: "Documentos", url: "/api/gerenciamento/tipos-documento", raiz: "tipos" },
  { chave: "categorias-documentais", nome: "Categorias Documentais", modulo: "Documentos", url: "/api/gerenciamento/categorias-documentais", raiz: "categorias" },
  { chave: "regras-documentais", nome: "Regras Documentais", modulo: "Documentos", url: "/api/gerenciamento/regras-documentais", raiz: "regras" },
  { chave: "produtos-servicos", nome: "Catálogo de Serviços", modulo: "Serviços", url: "/api/gerenciamento/produtos-servicos", raiz: "servicos" },
  { chave: "produtos", nome: "Configurações Financeiras", modulo: "Financeiro", url: "/api/gerenciamento/produtos", raiz: "produtos" },
  { chave: "tabela-valores", nome: "Tabela de Valores", modulo: "Financeiro", url: "/api/gerenciamento/tabela-valores", raiz: "valores" },
  { chave: "moedas", nome: "Moedas", modulo: "Financeiro", url: "/api/gerenciamento/moedas", raiz: "moedas" },
  { chave: "formas-pagamento", nome: "Formas de Pagamento", modulo: "Financeiro", url: "/api/gerenciamento/formas-pagamento", raiz: "formas" },
  { chave: "condicoes-pagamento", nome: "Condições de Pagamento", modulo: "Financeiro", url: "/api/gerenciamento/condicoes-pagamento", raiz: "condicoes" },
  { chave: "impostos", nome: "Impostos", modulo: "Financeiro", url: "/api/gerenciamento/impostos", raiz: "impostos" },
  { chave: "orgaos-protocolo", nome: "Cartórios e Órgãos", modulo: "Órgãos", url: "/api/gerenciamento/orgaos-protocolo", raiz: "orgaos" },
  { chave: "fornecedores", nome: "Fornecedores", modulo: "Órgãos", url: "/api/gerenciamento/fornecedores", raiz: "fornecedores" },
  { chave: "departamentos", nome: "Departamentos", modulo: "Usuários", url: "/api/gerenciamento/departamentos", raiz: "departamentos" },
  { chave: "grupos", nome: "Equipes", modulo: "Usuários", url: "/api/gerenciamento/cadastros/grupos", raiz: "registros" },
  { chave: "cargos", nome: "Cargos", modulo: "Usuários", url: "/api/gerenciamento/cadastros/cargos", raiz: "registros" },
  { chave: "auditoria", nome: "Trilha de Auditoria", modulo: "Sistema", url: "/api/gerenciamento/auditoria?take=1000", raiz: "logs" },
]

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const CARD = "rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm"

/** Converte lista de objetos em CSV (separador ";", padrão pt-BR do Excel). */
function paraCSV(linhas: Record<string, unknown>[]): string {
  if (linhas.length === 0) return ""
  const colunas = [...new Set(linhas.flatMap((l) => Object.keys(l)))]
  const escapar = (v: unknown) => {
    if (v === null || v === undefined) return ""
    const s = typeof v === "object" ? JSON.stringify(v) : String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [colunas.join(";"), ...linhas.map((l) => colunas.map((c) => escapar(l[c])).join(";"))].join("\n")
}

function baixar(conteudo: string, nome: string, mime: string) {
  const blob = new Blob([conteudo], { type: `${mime};charset=utf-8;` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url; a.download = nome
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

export default function ExportacoesTab() {
  const [formato, setFormato] = useState<"csv" | "json">("csv")
  const [ocupada, setOcupada] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [flash, setFlash] = useState("")

  const exportar = useCallback(async (f: Fonte) => {
    setOcupada(f.chave); setErro(null)
    try {
      const res = await fetch(f.url, { headers: authHeaders(), cache: "no-store" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(j.error || `Não foi possível exportar ${f.nome}.`); return }
      const bruto = (j as Record<string, unknown>)[f.raiz]
      const linhas = Array.isArray(bruto) ? (bruto as Record<string, unknown>[]) : []
      if (linhas.length === 0) { setErro(`${f.nome} não tem registros para exportar.`); return }
      const carimbo = new Date().toISOString().slice(0, 10)
      if (formato === "json") baixar(JSON.stringify(linhas, null, 2), `${f.chave}-${carimbo}.json`, "application/json")
      else baixar(paraCSV(linhas), `${f.chave}-${carimbo}.csv`, "text/csv")
      setFlash(`${f.nome}: ${linhas.length} registro(s) exportado(s).`)
      setTimeout(() => setFlash(""), 3500)
    } catch {
      setErro(`Falha ao exportar ${f.nome}.`)
    } finally { setOcupada(null) }
  }, [formato])

  const modulos = [...new Set(FONTES.map((f) => f.modulo))]

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-400/30 bg-green-500/15 px-4 py-3 text-sm text-green-200">{flash}</div>}
      {erro && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{erro}</div>}

      <div className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Exportações</h2>
            <p className="mt-1 max-w-3xl text-sm text-white/60">
              Baixe qualquer cadastro do Gerenciamento em CSV ou JSON. Os dados vêm da mesma rota que a tela do
              cadastro usa — nada é recalculado nem duplicado aqui.
            </p>
          </div>
          <div className="flex flex-none items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] p-1">
            {(["csv", "json"] as const).map((f) => (
              <button key={f} onClick={() => setFormato(f)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition ${formato === f ? "bg-white/15 text-white" : "text-white/55 hover:text-white"}`}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {modulos.map((m) => (
        <div key={m} className={`overflow-hidden ${CARD}`}>
          <div className="border-b border-white/10 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">{m}</div>
          <ul className="divide-y divide-white/5">
            {FONTES.filter((f) => f.modulo === m).map((f) => (
              <li key={f.chave} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-white">{f.nome}</div>
                  <div className="truncate text-[11px] text-white/40">{f.url}</div>
                </div>
                <button
                  onClick={() => exportar(f)}
                  disabled={ocupada === f.chave}
                  className="flex-none rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-40"
                >
                  {ocupada === f.chave ? "Exportando…" : `Exportar ${formato.toUpperCase()}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
