// src/components/kanban/ProcessoEstatisticas.tsx

"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import type { ProcessoWithStatus, Processo } from "@/src/types/kanban"

interface ProcessoEstatisticasProps {
  processo: ProcessoWithStatus | Processo
  /**
   * Callback para navegar para outra aba dentro do modal.
   * "arvore" já existe. "central" e "documentos" são placeholders pra futuras abas.
   */
  onNavigate?: (tab: "arvore" | "central" | "documentos") => void
}

// =========================================================
// MODELO DE DADOS (espelho do que o endpoint deve retornar)
// =========================================================
//
// TODO Marco: criar endpoint GET /api/processos/{id}/estatisticas
// retornando JSON com a mesma forma de `Estatisticas` abaixo.
//
// Sugestão de cálculo no backend (Prisma):
//
//   • linhagem.emLinhaDireta  = Pessoa.count({ where: { arvore: { processos: { some: { id } } }, numeroLinhagem: { not: null } } })
//   • linhagem.origem         = Pessoa onde numeroLinhagem é o MAIOR (italiano de origem)
//   • linhagem.requerentePrincipal = Pessoa onde requerente='maior'
//
//   • documentacao.total      = Documento.count({ where: { pessoa: { arvore: { processos: { some: { id } } } } } })
//   • documentacao.recebidos  = mesmo filtro + status='RECEBIDO'
//   • documentacao.percentual = round(recebidos/total * 100)
//
//   • risco e protocolo       = ainda não modelados no schema (divergências e
//                               protocol readiness). Por enquanto retornar 0/false.
//
//   • alertas                 = derivados das contagens acima
// =========================================================

type AlertaSev = 'crit' | 'warn' | 'info'

interface Estatisticas {
  linhagem: {
    emLinhaDireta: number
    origem?: string | null
    requerentePrincipal?: string | null
  }
  documentacao: {
    recebidos: number
    total: number
    percentual: number
  }
  risco: {
    bloqueantes: number
    graves: number
  }
  protocolo: {
    apto: boolean
    impeditivos: number
  }
  alertas: Array<{ sev: AlertaSev; label: string }>
}

const ESTATISTICAS_VAZIAS: Estatisticas = {
  linhagem: { emLinhaDireta: 0, origem: null, requerentePrincipal: null },
  documentacao: { recebidos: 0, total: 0, percentual: 0 },
  risco: { bloqueantes: 0, graves: 0 },
  protocolo: { apto: false, impeditivos: 0 },
  alertas: [],
}

export function ProcessoEstatisticas({ processo, onNavigate }: ProcessoEstatisticasProps) {
  const [stats, setStats] = useState<Estatisticas>(ESTATISTICAS_VAZIAS)
  const [loading, setLoading] = useState(true)
  const [endpointDisponivel, setEndpointDisponivel] = useState(true)

  useEffect(() => {
    let cancelled = false

    const carregar = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/processos/${processo.id}/estatisticas`, {
          headers: {
            Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem("authToken") : ''}`,
          },
        })

        if (res.status === 404) {
          // Endpoint ainda não foi criado — degrade gracioso
          if (!cancelled) setEndpointDisponivel(false)
          return
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }

        const data: Estatisticas = await res.json()
        if (!cancelled) {
          setStats({ ...ESTATISTICAS_VAZIAS, ...data })
          setEndpointDisponivel(true)
        }
      } catch (e) {
        console.warn('[ProcessoEstatisticas] falha ao buscar estatísticas:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    carregar()
    return () => { cancelled = true }
  }, [processo.id])

  const { linhagem, documentacao, risco, protocolo, alertas } = stats

  const riscoValor = risco.bloqueantes || risco.graves || 'OK'
  const riscoCor =
    risco.bloqueantes ? 'text-red-600' :
    risco.graves      ? 'text-amber-600' :
                        'text-green-600'

  const protocoloCor = protocolo.apto ? 'text-green-600' : 'text-amber-600'

  return (
    <div className="h-full overflow-y-auto p-6">

      {/* ============== 4 CARDS ESTATÍSTICOS (grid 2x2) ============== */}
      <div className="grid grid-cols-2 gap-3.5 mb-5">

        {/* Card 1: Linhagem */}
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3.5">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em] mb-1.5">
            Linhagem
          </div>
          <div className="text-[22px] font-bold text-gray-900 leading-tight tracking-tight">
            {linhagem.emLinhaDireta}
            <span className="text-[11px] text-gray-500 font-medium block mt-0.5">em linha direta</span>
          </div>
          <div className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
            {linhagem.origem ? (
              <>Origem: <strong className="text-gray-900 font-semibold">{linhagem.origem}</strong></>
            ) : (
              'Sem origem definida'
            )}
            <br/>
            {linhagem.requerentePrincipal ? (
              <>Requerente: <strong className="text-gray-900 font-semibold">{linhagem.requerentePrincipal}</strong></>
            ) : (
              'Sem requerente definido'
            )}
          </div>
        </div>

        {/* Card 2: Documentação */}
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3.5">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em] mb-1.5">
            Documentação
          </div>
          <div className="text-[22px] font-bold text-gray-900 leading-tight tracking-tight">
            {documentacao.percentual}%
          </div>
          <div className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
            {documentacao.recebidos} de {documentacao.total} documentos recebidos
          </div>
        </div>

        {/* Card 3: Risco */}
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3.5">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em] mb-1.5">
            Risco
          </div>
          <div className={`text-[22px] font-bold leading-tight tracking-tight ${riscoCor}`}>
            {riscoValor}
          </div>
          <div className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
            {risco.bloqueantes ? `${risco.bloqueantes} bloqueante(s) · ` : ''}
            {risco.graves ? `${risco.graves} grave(s)` : (!risco.bloqueantes ? 'Sem divergências críticas' : '')}
          </div>
        </div>

        {/* Card 4: Protocolo */}
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3.5">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em] mb-1.5">
            Protocolo
          </div>
          <div className={`text-[22px] font-bold leading-tight tracking-tight ${protocoloCor}`}>
            {protocolo.apto ? 'Apto' : 'Não apto'}
          </div>
          <div className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
            {protocolo.impeditivos} impeditivo(s)
          </div>
        </div>

      </div>

      {/* ============== ALERTAS EXECUTIVOS ============== */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3.5 mb-4">
        <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.08em] mb-2.5">
          Alertas executivos
        </div>
        {alertas.length === 0 ? (
          <div className="text-xs text-gray-400 italic">Nenhum alerta executivo no momento.</div>
        ) : (
          <div className="space-y-0">
            {alertas.map((a, i) => {
              const corTag =
                a.sev === 'crit' ? 'bg-red-600 ring-red-600/15' :
                a.sev === 'warn' ? 'bg-amber-500 ring-amber-500/15' :
                                    'bg-blue-500 ring-blue-500/15'
              return (
                <div key={i} className="flex items-center gap-2.5 text-[12.5px] text-gray-900 py-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ring-[3px] ${corTag}`}></span>
                  {a.label}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ============== AVISO TEMPORÁRIO (endpoint pendente) ============== */}
      {!loading && !endpointDisponivel && (
        <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800">
          ⚠ Endpoint <code className="font-mono">/api/processos/{processo.id}/estatisticas</code> ainda não existe — cards mostrando valores zerados.
        </div>
      )}

      {/* ============== ATALHOS DE NAVEGAÇÃO ============== */}
      <div className="flex gap-2 pt-3.5 border-t border-gray-200">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNavigate?.('arvore')}
        >
          → Árvore Genealógica
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled
          title="Aba ainda não implementada"
        >
          → Central Operacional
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled
          title="Aba ainda não implementada"
        >
          → Documentos
        </Button>
      </div>

    </div>
  )
}