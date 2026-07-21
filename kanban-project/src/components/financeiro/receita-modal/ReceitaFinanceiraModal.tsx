// src/components/financeiro/receita-modal/ReceitaFinanceiraModal.tsx
// ============================================================================
// MODAL FINANCEIRO CENTRAL do lançamento de receita — experiência definitiva.
//
// Substitui integralmente o drawer lateral. Quatro áreas: cabeçalho, resumo
// executivo, navegação interna e conteúdo da aba ativa (+ rodapé quando há
// ação relevante).
//
// O modal NÃO calcula nada: valor, moeda, status, parcelas, câmbio e
// composição vêm do FinanceRuleEngine via /detalhe e da fonte única de
// apresentação (lib/financeiro/apresentacao-lancamento). Todas as operações
// reutilizam os endpoints já existentes — nenhuma API nova.
// ============================================================================
'use client'

import '@/src/styles/receita-modal.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fmtCambio,
  fmtData,
  fmtMoeda,
  num,
  parcelaEmAberto,
  statusDoLancamento,
  totaisDoLancamento,
  type ParcelaView,
} from '@/lib/financeiro/apresentacao-lancamento'
import { ABAS, cabecalhosAuth, type AbaId, type Detalhe } from './tipos'
import { ReceitaModalHeader } from './ReceitaModalHeader'
import { ReceitaResumoExecutivo } from './ReceitaResumoExecutivo'
import { ReceitaVisaoGeral } from './ReceitaVisaoGeral'
import { ReceitaParcelasTab } from './ReceitaParcelasTab'
import { ReceitaRecebimentosTab } from './ReceitaRecebimentosTab'
import { ReceitaHistoricoTab } from './ReceitaHistoricoTab'
import { ReceitaInformacoesTecnicasTab } from './ReceitaInformacoesTecnicasTab'
import { ReceitaAcoesMenu } from './ReceitaAcoesMenu'

export interface ReceitaFinanceiraModalProps {
  receitaId: number
  onClose: () => void
  onChanged?: () => void
}

type Confirmacao =
  | { tipo: 'recebimento'; parcela: ParcelaView }
  | { tipo: 'vencimento'; parcela: ParcelaView }
  | { tipo: 'cancelamento'; suprimirOrigem: boolean; aviso?: string }
  | { tipo: 'estorno' }
  | { tipo: 'revogacao' }

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ReceitaFinanceiraModal({ receitaId, onClose, onChanged }: ReceitaFinanceiraModalProps) {
  const [d, setD] = useState<Detalhe | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [aba, setAba] = useState<AbaId>('geral')
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null)
  const [motivo, setMotivo] = useState('')
  const [cambio, setCambio] = useState('')
  const [dataValor, setDataValor] = useState('')

  const shell = useRef<HTMLDivElement>(null)
  const focoAnterior = useRef<HTMLElement | null>(null)

  // ── carga ─────────────────────────────────────────────────────────────────
  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const res = await fetch(`/api/financeiro/receitas/${receitaId}/detalhe`, { headers: cabecalhosAuth() })
      if (!res.ok) {
        setErro(`Não foi possível carregar o lançamento (HTTP ${res.status}).`)
        return
      }
      setD((await res.json()) as Detalhe)
    } catch {
      setErro('Erro de conexão ao carregar o lançamento.')
    }
  }, [receitaId])

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    carregar().finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [carregar])

  // ── foco, Escape e trava do fundo ────────────────────────────────────────
  useEffect(() => {
    focoAnterior.current = document.activeElement as HTMLElement | null
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // foco inicial dentro do modal, sem roubar o scroll da lista atrás
    shell.current?.focus({ preventScroll: true })
    return () => {
      document.body.style.overflow = overflowAnterior
      focoAnterior.current?.focus?.({ preventScroll: true })
    }
  }, [])

  const fechar = useCallback(() => {
    if (confirmacao) { setConfirmacao(null); return }
    onClose()
  }, [confirmacao, onClose])

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); fechar(); return }
      if (e.key !== 'Tab' || !shell.current) return
      const alvos = Array.from(shell.current.querySelectorAll<HTMLElement>(FOCAVEIS))
        .filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (alvos.length === 0) return
      const primeiro = alvos[0]
      const ultimo = alvos[alvos.length - 1]
      const atual = document.activeElement as HTMLElement | null
      if (e.shiftKey && (atual === primeiro || !shell.current.contains(atual))) {
        e.preventDefault(); ultimo.focus()
      } else if (!e.shiftKey && atual === ultimo) {
        e.preventDefault(); primeiro.focus()
      }
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [fechar])

  // ── chamadas às APIs existentes ──────────────────────────────────────────
  const chamar = useCallback(
    async (url: string, init: RequestInit, sucesso: string) => {
      setSalvando(true)
      setAviso(null)
      try {
        const res = await fetch(url, { ...init, headers: cabecalhosAuth() })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setAviso(json?.mensagem || json?.error || `Falha (HTTP ${res.status}).`)
          return { ok: false as const, json }
        }
        setAviso(sucesso)
        await carregar()
        onChanged?.()
        return { ok: true as const, json }
      } catch {
        setAviso('Erro de conexão.')
        return { ok: false as const, json: {} as Record<string, unknown> }
      } finally {
        setSalvando(false)
      }
    },
    [carregar, onChanged],
  )

  // ── derivados (fonte única) ──────────────────────────────────────────────
  const r = d?.receita
  const totais = useMemo(() => (r ? totaisDoLancamento(r) : null), [r])
  const status = useMemo(() => (r ? statusDoLancamento(r) : null), [r])
  const parcelas = useMemo(() => (r?.parcelas ?? []).filter((p) => p.status !== 'CANCELADA'), [r])
  const proximaParcela = useMemo(() => {
    const abertas = parcelas.filter(parcelaEmAberto)
    if (abertas.length === 0) return null
    const comData = abertas.filter((p) => p.vencimento)
    if (comData.length === 0) return abertas[0]
    return comData.reduce((a, b) => (String(a.vencimento) <= String(b.vencimento) ? a : b))
  }, [parcelas])

  const contadores: Partial<Record<AbaId, number>> = {
    parcelas: parcelas.length,
    recebimentos: totais?.parcelasRecebidas ?? 0,
    historico: r?.eventos?.length ?? 0,
  }

  const podeReceber = !!d?.acoes.podeRegistrarRecebimento && (totais?.saldo ?? 0) > 0.004 && proximaParcela != null

  // ── abertura dos painéis de confirmação ──────────────────────────────────
  function abrirRecebimento(p: ParcelaView) {
    setMotivo('')
    setCambio(String(totais?.cambio ?? 1))
    setDataValor(new Date().toISOString().slice(0, 10))
    setConfirmacao({ tipo: 'recebimento', parcela: p })
  }
  function abrirVencimento(p: ParcelaView) {
    setDataValor(p.vencimento ? String(p.vencimento).slice(0, 10) : '')
    setConfirmacao({ tipo: 'vencimento', parcela: p })
  }
  function abrirCancelamento() {
    setMotivo('')
    setConfirmacao({ tipo: 'cancelamento', suprimirOrigem: false })
  }

  // ── operações ────────────────────────────────────────────────────────────
  async function alterarVencimento(p: ParcelaView, valorIso: string) {
    if (!valorIso) return
    await chamar(
      `/api/financeiro/parcelas/${p.id}`,
      { method: 'PATCH', body: JSON.stringify({ vencimento: valorIso }) },
      `Vencimento da parcela ${p.numero} atualizado.`,
    )
  }

  async function reparcelar(nParcelas: number) {
    await chamar(
      `/api/financeiro/receitas/${receitaId}/parcelas`,
      { method: 'PATCH', body: JSON.stringify({ nParcelas }) },
      `Parcelamento alterado para ${nParcelas}×. Total contratual preservado.`,
    )
  }

  async function confirmarRecebimento(p: ParcelaView) {
    const taxa = Number(cambio.replace(',', '.'))
    if (!isFinite(taxa) || taxa <= 0) { setAviso('Câmbio inválido — recebimento não registrado.'); return }
    const r0 = await chamar(
      `/api/financeiro/parcelas/${p.id}/lancamento`,
      {
        method: 'POST',
        body: JSON.stringify({
          cambioAplicado: taxa,
          dataPagamento: new Date(`${dataValor || new Date().toISOString().slice(0, 10)}T12:00:00`).toISOString(),
        }),
      },
      `Recebimento da parcela ${p.numero} registrado.`,
    )
    if (r0.ok) setConfirmacao(null)
  }

  async function confirmarCancelamento(suprimirOrigem: boolean) {
    if (motivo.trim().length < 3) { setAviso('Informe um motivo com ao menos 3 caracteres.'); return }
    const res = await chamar(
      `/api/financeiro/receitas/${receitaId}/cancelar`,
      { method: 'POST', body: JSON.stringify(suprimirOrigem ? { motivo, suprimirOrigem: true } : { motivo }) },
      suprimirOrigem ? 'Lançamento cancelado e supressão registrada.' : 'Lançamento cancelado.',
    )
    if (res.ok) { setConfirmacao(null); return }
    // A regra ativa recriaria o lançamento: confirma a supressão rastreável.
    if ((res.json as { error?: string })?.error === 'ORIGEM_ATIVA') {
      setConfirmacao({
        tipo: 'cancelamento',
        suprimirOrigem: true,
        aviso: String((res.json as { mensagem?: string })?.mensagem ?? ''),
      })
    }
  }

  async function confirmarEstorno() {
    if (motivo.trim().length < 3) { setAviso('Informe um motivo com ao menos 3 caracteres.'); return }
    const res = await chamar(
      `/api/financeiro/receitas/${receitaId}/estornar`,
      { method: 'POST', body: JSON.stringify({ motivo }) },
      'Estorno registrado — o lançamento e o recebimento originais foram preservados.',
    )
    if (res.ok) setConfirmacao(null)
  }

  async function confirmarRevogacao() {
    const res = await chamar(
      `/api/financeiro/receitas/${receitaId}/supressao`,
      { method: 'DELETE', body: JSON.stringify({ motivo }) },
      'Supressão revogada — a regra ativa volta a valer na próxima reconciliação.',
    )
    if (res.ok) setConfirmacao(null)
  }

  // ── ações secundárias locais (sem API nova) ──────────────────────────────
  function exportar() {
    if (!d || !r || !totais) return
    const linhas = [
      ['Lançamento', r.descricao],
      ['Código', r.codigo],
      ['Moeda', r.moeda],
      ['Valor contratual', String(totais.contratado)],
      ['Recebido', String(totais.recebido)],
      ['Saldo', String(totais.saldo)],
      [],
      ['Parcela', 'Vencimento', 'Valor', 'Status'],
      ...parcelas.map((p) => [String(p.numero), p.vencimento ? String(p.vencimento).slice(0, 10) : '', String(num(p.valor)), p.status]),
    ]
    const csv = linhas.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${r.codigo || `receita-${receitaId}`}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setAviso('Lançamento exportado.')
  }

  async function copiarReferencia() {
    if (!r) return
    try {
      await navigator.clipboard.writeText(r.codigo)
      setAviso('Referência copiada.')
    } catch {
      setAviso('Não foi possível copiar a referência.')
    }
  }

  const menu = (posicao: 'abaixo' | 'acima') => (
    <ReceitaAcoesMenu
      detalhe={d}
      posicao={posicao}
      desabilitado={salvando}
      onAlterarParcelamento={() => setAba('parcelas')}
      onAlterarVencimento={() => { if (proximaParcela) abrirVencimento(proximaParcela); else setAba('parcelas') }}
      onExportar={exportar}
      onCopiarReferencia={() => void copiarReferencia()}
      onCancelar={abrirCancelamento}
      onEstornar={() => { setMotivo(''); setConfirmacao({ tipo: 'estorno' }) }}
      onRevogarSupressao={() => { setMotivo(''); setConfirmacao({ tipo: 'revogacao' }) }}
    />
  )

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className="rfm-root">
      <button type="button" className="rfm-backdrop" aria-label="Fechar" tabIndex={-1} onClick={onClose} />

      <div
        className="rfm-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rfm-titulo"
        aria-busy={carregando}
        tabIndex={-1}
        ref={shell}
      >
        <ReceitaModalHeader
          detalhe={d}
          status={status}
          tituloFallback="Lançamento financeiro"
          menu={menu('abaixo')}
          onClose={onClose}
        />

        {r && totais && status && (
          <ReceitaResumoExecutivo totais={totais} moeda={r.moeda} status={status} />
        )}

        <nav className="rfm-abas" role="tablist" aria-label="Seções do lançamento">
          {ABAS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`rfm-aba-${t.id}`}
              aria-selected={aba === t.id}
              aria-controls={`rfm-painel-${t.id}`}
              className="rfm-aba"
              onClick={() => setAba(t.id)}
            >
              {t.label}
              {contadores[t.id] != null && contadores[t.id]! > 0 && (
                <span className="rfm-aba-contador">{contadores[t.id]}</span>
              )}
            </button>
          ))}
        </nav>

        <div
          className="rfm-corpo"
          role="tabpanel"
          id={`rfm-painel-${aba}`}
          aria-labelledby={`rfm-aba-${aba}`}
        >
          {carregando && <div className="rfm-carregando">Carregando lançamento…</div>}
          {erro && <div className="rfm-aviso erro">{erro}</div>}
          {aviso && <div className="rfm-aviso">{aviso}</div>}

          {d?.supressao?.ativa && (
            <div className="rfm-aviso atencao">
              <strong>Supressão ativa.</strong> O FinanceRuleEngine não recriará este lançamento.
              {' '}Motivo: {d.supressao.motivo} · {fmtData(d.supressao.suprimidoEm)}
            </div>
          )}

          {d && r && totais && status && (
            <>
              {aba === 'geral' && (
                <ReceitaVisaoGeral
                  detalhe={d}
                  totais={totais}
                  status={status}
                  proximaParcela={proximaParcela}
                  onIrParaAba={setAba}
                  onRegistrarRecebimento={abrirRecebimento}
                  onAlterarVencimento={abrirVencimento}
                />
              )}
              {aba === 'parcelas' && (
                <ReceitaParcelasTab
                  detalhe={d}
                  totais={totais}
                  moeda={r.moeda}
                  salvando={salvando}
                  onReparcelar={(n) => void reparcelar(n)}
                  onAlterarVencimento={(p, v) => void alterarVencimento(p, v)}
                  onRegistrarRecebimento={abrirRecebimento}
                />
              )}
              {aba === 'recebimentos' && (
                <ReceitaRecebimentosTab
                  detalhe={d}
                  totais={totais}
                  moeda={r.moeda}
                  proximaParcela={proximaParcela}
                  onRegistrarRecebimento={abrirRecebimento}
                />
              )}
              {aba === 'historico' && <ReceitaHistoricoTab detalhe={d} moeda={r.moeda} />}
              {aba === 'tecnico' && <ReceitaInformacoesTecnicasTab detalhe={d} />}
            </>
          )}
        </div>

        <footer className="rfm-rodape">
          {menu('acima')}
          <div className="rfm-rodape-dir">
            <button type="button" className="rfm-btn-sec" onClick={onClose}>Fechar</button>
            {/* Na Visão geral a ação principal já está em destaque na lateral. */}
            {podeReceber && aba !== 'geral' && (
              <button
                type="button"
                className="rfm-btn"
                disabled={salvando}
                onClick={() => proximaParcela && abrirRecebimento(proximaParcela)}
              >
                Registrar recebimento
              </button>
            )}
          </div>
        </footer>

        {/* ── Painéis de confirmação ──────────────────────────────────────── */}
        {confirmacao && r && totais && (
          <div className="rfm-confirm-fundo" role="presentation">
            <div className="rfm-confirm" role="dialog" aria-modal="true" aria-label="Confirmação">
              {confirmacao.tipo === 'recebimento' && (
                <>
                  <h3 className="rfm-confirm-titulo">Registrar recebimento</h3>
                  <p className="rfm-confirm-texto">
                    Parcela {confirmacao.parcela.numero} · {fmtMoeda(num(confirmacao.parcela.valor), r.moeda)}
                    {r.moeda !== 'BRL' && ` · câmbio de referência 1 ${r.moeda} = R$ ${fmtCambio(totais.cambio)}`}
                  </p>
                  <label className="rfm-campo">
                    <span className="rfm-campo-rotulo">Data do recebimento</span>
                    <input type="date" value={dataValor} onChange={(e) => setDataValor(e.target.value)} />
                  </label>
                  <label className="rfm-campo">
                    <span className="rfm-campo-rotulo">Câmbio aplicado no recebimento</span>
                    <input inputMode="decimal" value={cambio} onChange={(e) => setCambio(e.target.value)} />
                  </label>
                  <div className="rfm-confirm-acoes">
                    <button type="button" className="rfm-btn-sec" onClick={() => setConfirmacao(null)}>Cancelar</button>
                    <button type="button" className="rfm-btn" disabled={salvando} onClick={() => void confirmarRecebimento(confirmacao.parcela)}>
                      Confirmar recebimento
                    </button>
                  </div>
                </>
              )}

              {confirmacao.tipo === 'vencimento' && (
                <>
                  <h3 className="rfm-confirm-titulo">Alterar vencimento</h3>
                  <p className="rfm-confirm-texto">
                    Parcela {confirmacao.parcela.numero} · {fmtMoeda(num(confirmacao.parcela.valor), r.moeda)}
                  </p>
                  <label className="rfm-campo">
                    <span className="rfm-campo-rotulo">Novo vencimento</span>
                    <input type="date" value={dataValor} onChange={(e) => setDataValor(e.target.value)} />
                  </label>
                  <div className="rfm-confirm-acoes">
                    <button type="button" className="rfm-btn-sec" onClick={() => setConfirmacao(null)}>Cancelar</button>
                    <button
                      type="button"
                      className="rfm-btn"
                      disabled={salvando || !dataValor}
                      onClick={async () => { await alterarVencimento(confirmacao.parcela, dataValor); setConfirmacao(null) }}
                    >
                      Salvar vencimento
                    </button>
                  </div>
                </>
              )}

              {confirmacao.tipo === 'cancelamento' && (
                <>
                  <h3 className="rfm-confirm-titulo">Cancelar lançamento</h3>
                  <p className="rfm-confirm-texto">
                    {confirmacao.aviso
                      ? `${confirmacao.aviso} Confirmar registrando uma supressão autorizada? O motor deixará de recriar este lançamento até a supressão ser revogada.`
                      : 'O cancelamento é registrado com motivo e fica auditável.'}
                  </p>
                  <label className="rfm-campo">
                    <span className="rfm-campo-rotulo">Motivo</span>
                    <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  </label>
                  <div className="rfm-confirm-acoes">
                    <button type="button" className="rfm-btn-sec" onClick={() => setConfirmacao(null)}>Voltar</button>
                    <button
                      type="button"
                      className="rfm-btn-perigo"
                      disabled={salvando}
                      onClick={() => void confirmarCancelamento(confirmacao.suprimirOrigem)}
                    >
                      {confirmacao.suprimirOrigem ? 'Cancelar e suprimir origem' : 'Cancelar lançamento'}
                    </button>
                  </div>
                </>
              )}

              {confirmacao.tipo === 'estorno' && (
                <>
                  <h3 className="rfm-confirm-titulo">Estornar</h3>
                  <p className="rfm-confirm-texto">
                    O lançamento e o recebimento originais são preservados — o estorno é registrado como contrapartida.
                  </p>
                  <label className="rfm-campo">
                    <span className="rfm-campo-rotulo">Motivo</span>
                    <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  </label>
                  <div className="rfm-confirm-acoes">
                    <button type="button" className="rfm-btn-sec" onClick={() => setConfirmacao(null)}>Voltar</button>
                    <button type="button" className="rfm-btn-perigo" disabled={salvando} onClick={() => void confirmarEstorno()}>
                      Confirmar estorno
                    </button>
                  </div>
                </>
              )}

              {confirmacao.tipo === 'revogacao' && (
                <>
                  <h3 className="rfm-confirm-titulo">Revogar supressão</h3>
                  <p className="rfm-confirm-texto">
                    A regra ativa volta a valer e o lançamento pode ser recriado na próxima reconciliação.
                  </p>
                  <label className="rfm-campo">
                    <span className="rfm-campo-rotulo">Motivo (opcional)</span>
                    <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  </label>
                  <div className="rfm-confirm-acoes">
                    <button type="button" className="rfm-btn-sec" onClick={() => setConfirmacao(null)}>Voltar</button>
                    <button type="button" className="rfm-btn" disabled={salvando} onClick={() => void confirmarRevogacao()}>
                      Revogar supressão
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ReceitaFinanceiraModal
