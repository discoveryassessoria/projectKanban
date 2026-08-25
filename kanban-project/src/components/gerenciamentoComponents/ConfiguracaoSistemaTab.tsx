"use client"

// src/components/gerenciamentoComponents/ConfiguracaoSistemaTab.tsx
//
// Duas telas sobre a MESMA configuração global (ConfiguracaoSistema), separadas
// por grupo — a forma dos campos vem do backend, não é duplicada aqui:
//   ConfiguracoesGeraisSistemaTab → Sistema › Configurações Gerais  (grupo "geral")
//   IdentidadeVisualTab           → Sistema › Identidade Visual     (grupo "identidade")
// Backend: /api/gerenciamento/configuracao-sistema (GET/PUT)
//
// A Identidade Visual mostra ainda, em leitura, o ambiente visual por país — que
// é gerado em build (motor de ambiente) e não é editável por tela.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useApi } from "@/src/lib/dados"

interface ChaveSpec {
  chave: string
  grupo: "geral" | "identidade"
  label: string
  tipo: "text" | "textarea" | "select" | "bool" | "cor"
  opcoes?: string[]
  ajuda?: string
  padrao?: string
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-[var(--text-secondary)]"
const CARD = "rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm"

const SEM_VALORES: Record<string, string> = {}
const SEM_CHAVES: ChaveSpec[] = []

function useConfiguracao(grupo: "geral" | "identidade") {
  // As configurações GRAVADAS vêm da camada oficial; o formulário é um rascunho sobre
  // elas. Antes havia dois estados espelhando a mesma resposta (`valores` para editar,
  // `inicial` para detectar alteração) e um efeito que preenchia os dois.
  const consulta = useApi<{ chaves?: ChaveSpec[]; valores?: Record<string, string>; atualizadoEm?: string | null }>(
    "/api/gerenciamento/configuracao-sistema",
  )
  const chaves = useMemo(
    () => (consulta.dados?.chaves ?? SEM_CHAVES).filter((c) => c.grupo === grupo),
    [consulta.dados, grupo],
  )
  const inicial = consulta.dados?.valores ?? SEM_VALORES
  const atualizadoEm = consulta.dados?.atualizadoEm ?? null

  // O rascunho carrega a versão gravada em que foi editado: se o servidor devolver
  // valores novos, o rascunho baseado nos antigos é descartado por construção.
  const base = JSON.stringify(inicial)
  const [rascunho, setRascunho] = useState<{ base: string; valores: Record<string, string> } | null>(null)
  const valores = rascunho?.base === base ? rascunho.valores : inicial
  const setValores = (proximos: Record<string, string>) => setRascunho({ base, valores: proximos })

  /**
   * Confirma o que acabou de ser gravado. É UMA escrita no cache, não duas: `valores` e
   * `atualizadoEm` mudam juntos, e dois `mutate` encadeados fariam o segundo sobrescrever
   * o primeiro com a versão anterior dos dados.
   */
  const marcarSalvo = (payload: Record<string, string>) => {
    void consulta.recarregar({
      ...consulta.dados,
      valores: { ...inicial, ...payload },
      atualizadoEm: new Date().toISOString(),
    })
  }

  const [erroLocal, setErro] = useState<string | null>(null)
  const erro = erroLocal ?? (consulta.erro ? consulta.erro.message : null)

  return {
    chaves, valores, setValores, inicial, atualizadoEm, marcarSalvo,
    loading: consulta.carregando, erro, setErro, load: consulta.recarregar,
  }
}

function FormularioConfig({
  titulo, descricao, grupo, extra,
}: { titulo: string; descricao: string; grupo: "geral" | "identidade"; extra?: (valores: Record<string, string>) => React.ReactNode }) {
  const { chaves, valores, setValores, inicial, atualizadoEm, marcarSalvo, loading, erro, setErro, load } = useConfiguracao(grupo)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")

  const sujo = chaves.some((c) => (valores[c.chave] ?? "") !== (inicial[c.chave] ?? ""))

  async function salvar() {
    setBusy(true); setErro(null)
    try {
      const payload = Object.fromEntries(chaves.map((c) => [c.chave, valores[c.chave] ?? ""]))
      const res = await fetch("/api/gerenciamento/configuracao-sistema", {
        method: "PUT", headers: authHeaders(), body: JSON.stringify({ valores: payload }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(j.error || "Erro ao salvar."); return }
      marcarSalvo(payload)
      setFlash("Configurações salvas."); setTimeout(() => setFlash(""), 3000)
    } finally { setBusy(false) }
  }

  if (loading) return <div className="py-24 text-center text-[var(--text-secondary)]">Carregando…</div>

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{flash}</div>}
      {erro && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {erro} <button onClick={() => { setErro(null); void load() }} className="ml-2 underline hover:text-white">Recarregar</button>
        </div>
      )}

      <div className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{titulo}</h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--text-secondary)]">{descricao}</p>
            {atualizadoEm && (
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">Última alteração: {new Date(atualizadoEm).toLocaleString("pt-BR")}</p>
            )}
          </div>
          <div className="flex flex-none items-center gap-2">
            {sujo && <span className="text-xs text-amber-700/80">alterações não salvas</span>}
            <button
              onClick={salvar} disabled={busy || !sujo}
              className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-40"
              title={sujo ? "" : "Nada alterado"}
            >
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>

      <div className={`${CARD} p-5`}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {chaves.map((c) => (
            <div key={c.chave} className={c.tipo === "textarea" ? "sm:col-span-2" : ""}>
              <label className={labelCls}>{c.label}</label>
              {c.tipo === "textarea" ? (
                <textarea rows={3} value={valores[c.chave] ?? ""} onChange={(e) => setValores({ ...valores, [c.chave]: e.target.value })} className={inputCls} />
              ) : c.tipo === "select" ? (
                <select value={valores[c.chave] ?? ""} onChange={(e) => setValores({ ...valores, [c.chave]: e.target.value })} className={inputCls}>
                  <option value="" className="bg-zinc-900">—</option>
                  {(c.opcoes ?? []).map((o) => <option key={o} value={o} className="bg-zinc-900">{o}</option>)}
                </select>
              ) : c.tipo === "cor" ? (
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(valores[c.chave] ?? "") ? valores[c.chave] : (c.padrao ?? "#38bdf8")}
                    onChange={(e) => setValores({ ...valores, [c.chave]: e.target.value })}
                    className="h-9 w-12 flex-none cursor-pointer rounded border border-[var(--border-default)] bg-transparent"
                  />
                  <input value={valores[c.chave] ?? ""} onChange={(e) => setValores({ ...valores, [c.chave]: e.target.value })} className={inputCls} placeholder={c.padrao} />
                </div>
              ) : (
                <input value={valores[c.chave] ?? ""} onChange={(e) => setValores({ ...valores, [c.chave]: e.target.value })} className={inputCls} placeholder={c.padrao} />
              )}
              {c.ajuda && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{c.ajuda}</p>}
            </div>
          ))}
        </div>
      </div>

      {extra?.(valores)}
    </div>
  )
}

export function ConfiguracoesGeraisSistemaTab() {
  return (
    <FormularioConfig
      grupo="geral"
      titulo="Configurações Gerais"
      descricao="Parâmetros globais e técnicos transversais do sistema. Regras de domínio continuam em cada módulo — aqui só o que vale para o sistema inteiro."
    />
  )
}

export function IdentidadeVisualTab() {
  return (
    <FormularioConfig
      grupo="identidade"
      titulo="Identidade Visual"
      descricao="Marca, logotipo e cores institucionais usados nas comunicações e documentos gerados. O fundo por país das telas operacionais é o motor de ambiente e continua definido em build."
      extra={(valores) => (
        <div className={`${CARD} p-5`}>
          <div className="mb-3 text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">Pré-visualização</div>
          <div className="flex flex-wrap items-center gap-4">
            <div
              className="flex h-16 min-w-[220px] items-center gap-3 rounded-xl px-4"
              style={{ backgroundColor: valores["identidade.corDestaque"] || "#38bdf8", color: valores["identidade.corTexto"] || "#0b1220" }}
            >
              {valores["identidade.logoUrl"] ? (
                <img src={valores["identidade.logoUrl"]} alt="" className="h-9 w-9 rounded object-contain" />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded bg-black/15 text-sm font-bold">
                  {(valores["identidade.marca"] || "D").slice(0, 1).toUpperCase()}
                </div>
              )}
              <span className="text-base font-semibold">{valores["identidade.marca"] || "Marca"}</span>
            </div>
            <p className="max-w-md text-[12px] text-[var(--text-secondary)]">
              É assim que a marca aparece nos materiais gerados pelo sistema. O tema das telas operacionais
              (fundo por nacionalidade) é decidido pelo processo, não por esta tela.
            </p>
          </div>
        </div>
      )}
    />
  )
}
