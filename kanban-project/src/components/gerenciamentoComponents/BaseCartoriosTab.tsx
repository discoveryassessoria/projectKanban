'use client'

// src/components/gerenciamentoComponents/BaseCartoriosTab.tsx
// BASE DE CARTÓRIOS — status da sincronização nacional automática (Registro
// Civil / Portal da Transparência). Só ADMINISTRADOR. Backend:
// GET  /api/gerenciamento/cartorios              → status
// POST /api/gerenciamento/cartorios/sincronizar-agora → dispara a MESMA porta do cron

import { useState } from 'react'
import { useApi } from "@/src/lib/dados"

interface SyncRun {
  id: number
  startedAt: string
  finishedAt: string | null
  status: string
  gatilho: string
  fetched: number
  inserted: number
  updated: number
  unchanged: number
  missing: number
  inactivated: number
  errors: number
  errorMessage: string | null
}

interface StatusResposta {
  fonte: string
  total: number
  ativos: number
  inativos: number
  ultimaSincronizacaoBemSucedida: SyncRun | null
  ultimaTentativa: SyncRun | null
}

const fmtDataHora = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

const ROTULO_STATUS: Record<string, { label: string; cls: string }> = {
  SUCESSO: { label: 'Sincronizado', cls: 'bg-[var(--surface-secondary)] text-green-800' },
  EXECUTANDO: { label: 'Executando', cls: 'bg-[var(--surface-secondary)] text-amber-800' },
  FALHA: { label: 'Falha', cls: 'bg-[var(--surface-secondary)] text-red-700' },
  BLOQUEADO_CONCORRENCIA: { label: 'Já em execução', cls: 'bg-[var(--surface-secondary)] text-amber-800' },
  ABORTADO_INCOMPLETO: { label: 'Abortado (resposta incompleta)', cls: 'bg-[var(--surface-secondary)] text-red-700' },
}

async function jsonFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string })?.error || `Erro ${res.status}`)
  return data
}

export default function BaseCartoriosTab() {
  const { dados, carregando: loading, erro, recarregar: carregar } = useApi<StatusResposta>('/api/gerenciamento/cartorios')
  const [sincronizando, setSincronizando] = useState(false)
  const [erroSync, setErroSync] = useState<string | null>(null)

  const sincronizarAgora = async () => {
    setSincronizando(true)
    setErroSync(null)
    try {
      await jsonFetch('/api/gerenciamento/cartorios/sincronizar-agora', { method: 'POST' })
      await carregar()
    } catch (e) {
      setErroSync(e instanceof Error ? e.message : 'Não foi possível sincronizar agora.')
    } finally {
      setSincronizando(false)
    }
  }

  const tentativa = dados?.ultimaTentativa ?? null
  const statusInfo = tentativa ? ROTULO_STATUS[tentativa.status] ?? { label: tentativa.status, cls: 'bg-[var(--surface-secondary)] text-[var(--text-secondary)]' } : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Base de Cartórios</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Base nacional de cartórios de Registro Civil, sincronizada automaticamente — nunca cadastrada à mão.
          </p>
        </div>
        <button
          onClick={sincronizarAgora}
          disabled={sincronizando}
          className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)] disabled:opacity-50"
        >
          {sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
        </button>
      </div>

      {loading && <div className="py-12 text-center text-sm text-[var(--text-muted)]">Carregando...</div>}

      {!loading && erro && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 text-sm text-red-700">
          Não foi possível carregar o status. <button onClick={() => void carregar()} className="ml-2 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {erroSync && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 text-sm text-red-700">{erroSync}</div>
      )}

      {!loading && !erro && dados && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Total</div>
              <div className="mt-1 text-2xl font-semibold text-white">{dados.total.toLocaleString('pt-BR')}</div>
            </div>
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Ativos</div>
              <div className="mt-1 text-2xl font-semibold text-green-800">{dados.ativos.toLocaleString('pt-BR')}</div>
            </div>
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Inativos</div>
              <div className="mt-1 text-2xl font-semibold text-[var(--text-secondary)]">{dados.inativos.toLocaleString('pt-BR')}</div>
            </div>
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Status</div>
              <div className="mt-1">
                {statusInfo ? (
                  <span className={`inline-block rounded px-2 py-0.5 text-[12px] font-medium ${statusInfo.cls}`}>{statusInfo.label}</span>
                ) : (
                  <span className="text-sm text-[var(--text-muted)]">Nunca sincronizado</span>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-4 backdrop-blur text-sm">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <span className="text-[var(--text-secondary)]">Fonte: </span>
                <span className="text-white">{dados.fonte}</span>
              </div>
              <div>
                <span className="text-[var(--text-secondary)]">Última sincronização bem-sucedida: </span>
                <span className="text-white">{fmtDataHora(dados.ultimaSincronizacaoBemSucedida?.finishedAt ?? null)}</span>
              </div>
              <div>
                <span className="text-[var(--text-secondary)]">Última tentativa: </span>
                <span className="text-white">{fmtDataHora(tentativa?.startedAt ?? null)}</span>
              </div>
              {tentativa && (
                <div>
                  <span className="text-[var(--text-secondary)]">Resultado da última tentativa: </span>
                  <span className="text-white">
                    {tentativa.fetched} obtidos · {tentativa.inserted} novos · {tentativa.updated} atualizados · {tentativa.unchanged} sem mudança
                    {tentativa.errors > 0 ? ` · ${tentativa.errors} erros` : ''}
                  </span>
                </div>
              )}
            </div>
            {tentativa?.errorMessage && (
              <div className="mt-3 rounded-md border border-[var(--border-default)] bg-[var(--surface-secondary)] p-2.5 text-[12.5px] text-red-700">
                {tentativa.errorMessage}
              </div>
            )}
          </div>

          <p className="text-[11.5px] text-[var(--text-muted)]">
            Sincroniza automaticamente todo dia às 03:00 (horário operacional). Se a fonte externa ficar
            indisponível, a busca de cartórios no sistema continua funcionando normalmente com a última base sincronizada.
          </p>
        </>
      )}
    </div>
  )
}
