"use client"

// src/components/gerenciamentoComponents/IntegracoesTab.tsx
// SISTEMA › INTEGRAÇÕES.
// Consulta do estado REAL de cada integração já existente (câmbio, armazenamento,
// motor de workflow, agendamentos). Somente leitura: as credenciais vivem em
// variáveis de ambiente e os parâmetros do motor têm tela própria — esta tela
// aponta para onde cada coisa é configurada, sem virar uma segunda porta.
// Backend: /api/gerenciamento/integracoes (GET)

import { useCallback, useEffect, useState } from "react"
import { useApi } from "@/src/lib/dados"

interface Integracao {
  chave: string
  nome: string
  descricao: string
  configurado: boolean
  estado: string
  detalhes: Record<string, unknown> | null
  ondeConfigurar: string
  telaRelacionada: string | null
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const CARD = "rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm"

// estados vindos do backend → cor e rótulo em português
const ESTADO: Record<string, { cls: string; label: string }> = {
  ATUALIZADO: { cls: "bg-[var(--surface-secondary)] text-green-700", label: "Atualizado" },
  ATIVO: { cls: "bg-[var(--surface-secondary)] text-green-700", label: "Ativo" },
  DECLARADO: { cls: "bg-[var(--surface-secondary)] text-green-700", label: "Declarado" },
  RUNTIME_V2_HABILITADO: { cls: "bg-[var(--surface-secondary)] text-green-700", label: "Runtime v2 habilitado" },
  RUNTIME_V2_DESABILITADO: { cls: "bg-[var(--surface-secondary)] text-amber-700", label: "Runtime v2 desabilitado" },
  SEM_NOVA_PUBLICACAO: { cls: "bg-[var(--surface-secondary)] text-amber-700", label: "Sem nova publicação" },
  DESATUALIZADO: { cls: "bg-[var(--surface-secondary)] text-amber-700", label: "Desatualizado" },
  SEGREDO_PENDENTE: { cls: "bg-[var(--surface-secondary)] text-amber-700", label: "Segredo pendente" },
  CONFIGURACAO_PENDENTE: { cls: "bg-[var(--surface-secondary)] text-red-700", label: "Configuração pendente" },
  INDISPONIVEL: { cls: "bg-[var(--surface-secondary)] text-red-700", label: "Indisponível" },
  SEM_DADOS: { cls: "bg-[var(--surface-primary)] text-[var(--text-secondary)]", label: "Sem dados" },
}
const estadoDe = (e: string) => ESTADO[e] ?? { cls: "bg-[var(--surface-primary)] text-[var(--text-secondary)]", label: e }

// rótulos amigáveis das chaves de detalhe (o resto cai no fallback legível)
const ROTULO: Record<string, string> = {
  overrideDeAmbiente: "Override de ambiente",
  par: "Par de moedas",
  taxa: "Taxa vigente",
  dataReferencia: "Data de referência",
  consultadoEm: "Consultado em",
  origem: "Origem",
  fonte: "Fonte",
  semNovaPublicacao: "Sem nova publicação",
  bucketDefinido: "Bucket definido",
  urlPublicaDefinida: "URL pública definida",
  runtimeV2Habilitado: "Runtime v2 habilitado",
  autoExecutarAoAvancar: "Executar motor ao avançar",
  atualizadoEm: "Atualizado em",
  segredoDefinido: "Segredo definido",
}
const rotulo = (k: string) => ROTULO[k] ?? k

function valorLegivel(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—"
  if (typeof v === "boolean") return v ? "sim" : "não"
  if (typeof v === "number") return String(v)
  if (typeof v === "string") {
    // ISO date → data/hora local
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString("pt-BR")
    return v
  }
  return JSON.stringify(v)
}

// Identidade estável para a ausência de dados (evita recomputar memos).
const SEM_ITENS: never[] = Object.freeze([]) as never[]

export default function IntegracoesTab() {

  // Consulta em cache (src/lib/dados): loading e erro derivam da camada.
  const { dados, carregando: loading, erro: erroCarregar, recarregar: load } =
    useApi<{ integracoes?: Integracao[]; ambiente?: string }>("/api/gerenciamento/integracoes")
  const itens = dados?.integracoes ?? SEM_ITENS
  const ambiente = dados?.ambiente ?? ""
  const erro = erroCarregar ? (erroCarregar.message || 'Não foi possível carregar o status das integrações.') : null

  if (loading) return <div className="py-24 text-center text-[var(--text-secondary)]">Carregando…</div>

  return (
    <div className="space-y-5">
      {erro && (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-red-700">
          {erro} <button onClick={() => void load()} className="ml-2 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      <div className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Integrações</h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--text-secondary)]">
              Estado real de cada integração do sistema. As credenciais vivem em variáveis de ambiente e não são
              exibidas aqui — esta tela mostra apenas se estão definidas e qual foi o último resultado.
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            {ambiente && (
              <span className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)]">
                ambiente: {ambiente}
              </span>
            )}
            <button onClick={() => void load()} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-xs text-white/80 hover:bg-[var(--surface-hover)]">
              Atualizar
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {itens.map((i) => {
          const est = estadoDe(i.estado)
          const detalhes = Object.entries(i.detalhes ?? {}).filter(([k]) => k !== "jobs")
          const jobs = (i.detalhes?.jobs as { path: string; schedule: string; descricao: string }[] | undefined) ?? []
          return (
            <div key={i.chave} className={`${CARD} p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-white">{i.nome}</h3>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">{i.descricao}</p>
                </div>
                <span className={`flex-none rounded-full px-2.5 py-1 text-[10px] font-medium ${est.cls}`}>{est.label}</span>
              </div>

              {detalhes.length > 0 && (
                <dl className="mt-4 grid gap-x-4 gap-y-2 border-t border-[var(--border-default)] pt-3 sm:grid-cols-2">
                  {detalhes.map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">{rotulo(k)}</dt>
                      <dd className="truncate text-sm text-white/80">{valorLegivel(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {jobs.length > 0 && (
                <div className="mt-4 border-t border-[var(--border-default)] pt-3">
                  <div className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">Rotinas</div>
                  <ul className="space-y-1 text-sm text-white/75">
                    {jobs.map((j) => (
                      <li key={j.path} className="flex flex-wrap items-baseline gap-x-2">
                        <code className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[11px] text-white/70">{j.path}</code>
                        <span className="text-[var(--text-secondary)]">{j.schedule}</span>
                        <span className="text-[var(--text-secondary)]">· {j.descricao}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 border-t border-[var(--border-default)] pt-3 text-[12px] text-[var(--text-secondary)]">
                Configurado em: <span className="text-white/65">{i.ondeConfigurar}</span>
                {i.telaRelacionada && <> · Tela relacionada: <span className="text-white/65">{i.telaRelacionada}</span></>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
