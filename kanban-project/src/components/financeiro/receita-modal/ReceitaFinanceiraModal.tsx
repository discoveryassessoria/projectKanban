// src/components/financeiro/receita-modal/ReceitaFinanceiraModal.tsx
// ============================================================================
// CENTRAL OFICIAL DE OPERAÇÃO DO LANÇAMENTO FINANCEIRO.
//
// Todo o ciclo de vida do lançamento acontece aqui: consultar, parcelar,
// alterar vencimentos (individual e em lote), registrar e editar recebimentos,
// anexar/substituir comprovantes, estornar, cancelar, suprimir/revogar,
// exportar e imprimir — sem sair do modal e sem reload.
//
// O modal NÃO decide nada:
//   • valores, status, parcelas e composição → FinanceRuleEngine via /detalhe
//     e lib/financeiro/apresentacao-lancamento;
//   • quais ações existem agora → resolveAvailableFinancialActions (fonte única,
//     que cruza estado + autorização do backend + permissões do usuário).
//
// Nenhum endpoint novo: todas as operações reutilizam rotas já existentes, e o
// backend continua validando cada chamada por conta própria.
// ============================================================================
'use client'

import '@/src/styles/receita-modal.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fmtData,
  fmtMoeda,
  num,
  statusDoLancamento,
  totaisDoLancamento,
  type ParcelaView,
} from '@/lib/financeiro/apresentacao-lancamento'
import {
  parcelaAlvo as calcularParcelaAlvo,
  resolveAvailableFinancialActions,
  type PermissoesFinanceiras,
} from '@/lib/financeiro/acoes-lancamento'
import { usePermissoes } from '@/src/hooks/use-permissoes'
import { ABAS, cabecalhosAuth, type AbaId, type Detalhe } from './tipos'
import { ReceitaModalHeader } from './ReceitaModalHeader'
import { ReceitaResumoExecutivo } from './ReceitaResumoExecutivo'
import { ReceitaAcoesRapidas } from './ReceitaAcoesRapidas'
import { ReceitaVisaoGeral } from './ReceitaVisaoGeral'
import { ReceitaParcelasTab } from './ReceitaParcelasTab'
import { ReceitaRecebimentosTab } from './ReceitaRecebimentosTab'
import { ReceitaHistoricoTab } from './ReceitaHistoricoTab'
import { ReceitaInformacoesTecnicasTab, type SecaoTecnica } from './ReceitaInformacoesTecnicasTab'
import { ReceitaRecebimentoForm } from './ReceitaRecebimentoForm'
import { ReceitaAcoesMenu } from './ReceitaAcoesMenu'

export interface ReceitaFinanceiraModalProps {
  receitaId: number
  onClose: () => void
  onChanged?: () => void
  /** PARIDADE: o mesmo modal serve receita e custo. Muda a base da API e os rótulos. */
  natureza?: 'RECEITA' | 'CUSTO'
}

/** Rótulos por natureza — o fluxo é idêntico, o vocabulário não. */
const VOCAB = {
  RECEITA: { tipo: 'Receita', evento: 'Recebimento', verbo: 'Registrar recebimento', quitado: 'Lançamento quitado', recurso: 'receitas' },
  CUSTO: { tipo: 'Custo', evento: 'Pagamento', verbo: 'Registrar pagamento', quitado: 'Lançamento pago', recurso: 'custos' },
} as const

type Painel =
  | { tipo: 'recebimento'; modo: 'registrar' | 'editar'; parcela: ParcelaView }
  | { tipo: 'vencimento'; parcela: ParcelaView }
  | { tipo: 'vencimento-lote'; parcelas: ParcelaView[] }
  | { tipo: 'recebimento-lote'; parcelas: ParcelaView[] }
  | { tipo: 'observacoes' }
  | { tipo: 'cancelamento'; suprimirOrigem: boolean; aviso?: string }
  | { tipo: 'estorno' }
  | { tipo: 'revogacao' }

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ReceitaFinanceiraModal({ receitaId, onClose, onChanged, natureza = 'RECEITA' }: ReceitaFinanceiraModalProps) {
  const vocab = VOCAB[natureza]
  const base = `/api/financeiro/${vocab.recurso}/${receitaId}`
  const [d, setD] = useState<Detalhe | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [aba, setAba] = useState<AbaId>('geral')
  const [secaoTecnica, setSecaoTecnica] = useState<SecaoTecnica | null>(null)
  const [painel, setPainel] = useState<Painel | null>(null)
  const [reparcelarAberto, setReparcelarAberto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [dataValor, setDataValor] = useState('')
  const [escalonar, setEscalonar] = useState(true)
  const [observacoes, setObservacoes] = useState('')

  const shell = useRef<HTMLDivElement>(null)
  const focoAnterior = useRef<HTMLElement | null>(null)
  const { pode, isAdmin, carregando: carregandoPerm } = usePermissoes()

  // ── carga ─────────────────────────────────────────────────────────────────
  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const res = await fetch(`${base}/detalhe`, { headers: cabecalhosAuth() })
      if (!res.ok) {
        setErro(`Não foi possível carregar o lançamento (HTTP ${res.status}).`)
        return
      }
      const json = (await res.json()) as Detalhe
      setD(json)
      setObservacoes(json.receita.observacoes ?? '')
    } catch {
      setErro('Erro de conexão ao carregar o lançamento.')
    }
  }, [base])

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
    shell.current?.focus({ preventScroll: true })
    return () => {
      document.body.style.overflow = overflowAnterior
      focoAnterior.current?.focus?.({ preventScroll: true })
    }
  }, [])

  const fechar = useCallback(() => {
    if (painel) { setPainel(null); return }
    onClose()
  }, [painel, onClose])

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
    async (url: string, init: RequestInit, sucesso: string, recarregar = true) => {
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
        if (recarregar) {
          await carregar()
          onChanged?.()
        }
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

  // ── derivados: fonte única de apresentação + fonte única de ações ────────
  const r = d?.receita
  const totais = useMemo(() => (r ? totaisDoLancamento(r) : null), [r])
  const status = useMemo(() => (r ? statusDoLancamento(r) : null), [r])
  const parcelaAlvo = useMemo(() => (r ? calcularParcelaAlvo(r) : null), [r])

  const permissoes: PermissoesFinanceiras = useMemo(
    () => ({
      // Enquanto as permissões carregam, nada operacional é oferecido.
      ver: carregandoPerm ? false : pode('financeiro.ver') || isAdmin,
      criarRecebimento: carregandoPerm ? false : pode('financeiro.pagamento_criar') || isAdmin,
      editarRecebimento: carregandoPerm ? false : pode('financeiro.pagamento_editar') || isAdmin,
      excluirRecebimento: carregandoPerm ? false : pode('financeiro.pagamento_excluir') || isAdmin,
      isAdmin,
    }),
    [pode, isAdmin, carregandoPerm],
  )

  const acoes = useMemo(() => {
    if (!d || !r) return null
    return resolveAvailableFinancialActions({
      lancamento: r,
      backend: d.acoes,
      supressaoAtiva: !!d.supressao?.ativa,
      cancelado: !!d.cancelamento,
      estornado: !!d.estorno,
      permissoes,
    })
  }, [d, r, permissoes])

  const parcelas = useMemo(
    () => (r?.parcelas ?? []).filter((p) => p.status !== 'CANCELADA'),
    [r],
  )

  const contadores: Partial<Record<AbaId, number>> = {
    parcelas: parcelas.length,
    recebimentos: totais?.parcelasRecebidas ?? 0,
    historico: r?.eventos?.length ?? 0,
  }

  // ── operações (todas em endpoints já existentes) ─────────────────────────
  async function alterarVencimento(p: ParcelaView, valorIso: string) {
    if (!valorIso) return
    await chamar(
      `/api/financeiro/parcelas/${p.id}`,
      { method: 'PATCH', body: JSON.stringify({ vencimento: valorIso }) },
      `Vencimento da parcela ${p.numero} atualizado.`,
    )
  }

  async function reparcelar(nParcelas: number) {
    const res = await chamar(
      `${base}/parcelas`,
      { method: 'PATCH', body: JSON.stringify({ nParcelas }) },
      `Parcelamento alterado para ${nParcelas}×. Total contratual preservado.`,
    )
    if (res.ok) setReparcelarAberto(false)
  }

  async function registrarRecebimento(p: ParcelaView, dados: Record<string, unknown>) {
    const res = await chamar(
      `/api/financeiro/parcelas/${p.id}/lancamento`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...dados,
          dataPagamento: new Date(`${String(dados.dataPagamento ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10)}T12:00:00`).toISOString(),
        }),
      },
      `Recebimento da parcela ${p.numero} registrado.`,
    )
    if (res.ok) setPainel(null)
  }

  async function editarRecebimento(p: ParcelaView, dados: Record<string, unknown>) {
    const res = await chamar(
      `/api/financeiro/parcelas/${p.id}`,
      { method: 'PATCH', body: JSON.stringify(dados) },
      `Recebimento da parcela ${p.numero} atualizado.`,
    )
    if (res.ok) setPainel(null)
  }

  /** Lote: mesma operação, uma chamada por parcela, com recarga única no fim. */
  async function emLote<T>(itens: T[], fn: (item: T, i: number) => Promise<Response>, sucesso: string) {
    setSalvando(true)
    setAviso(null)
    let ok = 0
    let falhas = 0
    for (let i = 0; i < itens.length; i++) {
      try {
        const res = await fn(itens[i], i)
        if (res.ok) ok++
        else falhas++
      } catch {
        falhas++
      }
    }
    await carregar()
    onChanged?.()
    setSalvando(false)
    setPainel(null)
    setAviso(falhas === 0 ? `${sucesso} (${ok}).` : `${sucesso} (${ok}). ${falhas} não puderam ser processadas.`)
  }

  function dataEscalonada(base: string, i: number): string {
    if (!escalonar || i === 0) return base
    const d0 = new Date(`${base}T12:00:00`)
    const alvo = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + i, 1))
    const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
    alvo.setUTCDate(Math.min(d0.getUTCDate(), ultimo))
    return alvo.toISOString().slice(0, 10)
  }

  async function salvarObservacoes() {
    const res = await chamar(
      base,
      { method: 'PATCH', body: JSON.stringify({ observacoes }) },
      'Observações salvas.',
    )
    if (res.ok) setPainel(null)
  }

  async function confirmarCancelamento(suprimirOrigem: boolean) {
    if (motivo.trim().length < 3) { setAviso('Informe um motivo com ao menos 3 caracteres.'); return }
    const res = await chamar(
      `${base}/cancelar`,
      { method: 'POST', body: JSON.stringify(suprimirOrigem ? { motivo, suprimirOrigem: true } : { motivo }) },
      suprimirOrigem ? 'Lançamento cancelado e supressão registrada.' : 'Lançamento cancelado.',
    )
    if (res.ok) { setPainel(null); return }
    if ((res.json as { error?: string })?.error === 'ORIGEM_ATIVA') {
      setPainel({ tipo: 'cancelamento', suprimirOrigem: true, aviso: String((res.json as { mensagem?: string })?.mensagem ?? '') })
    }
  }

  async function confirmarEstorno() {
    if (motivo.trim().length < 3) { setAviso('Informe um motivo com ao menos 3 caracteres.'); return }
    const res = await chamar(
      `${base}/estornar`,
      { method: 'POST', body: JSON.stringify({ motivo }) },
      'Estorno registrado — o lançamento e o recebimento originais foram preservados.',
    )
    if (res.ok) setPainel(null)
  }

  async function confirmarRevogacao() {
    const res = await chamar(
      `${base}/supressao`,
      { method: 'DELETE', body: JSON.stringify({ motivo }) },
      'Supressão revogada — a regra ativa volta a valer na próxima reconciliação.',
    )
    if (res.ok) setPainel(null)
  }

  // ── saídas de dados (sem endpoint) ───────────────────────────────────────
  const exportarCsv = useCallback((selecionadas?: ParcelaView[]) => {
    if (!r || !totais) return
    const alvo = selecionadas?.length ? selecionadas : parcelas
    const linhas = [
      ['Lançamento', r.descricao],
      ['Código', r.codigo],
      ['Moeda', r.moeda],
      ['Valor contratual', String(totais.contratado)],
      ['Recebido', String(totais.recebido)],
      ['Saldo', String(totais.saldo)],
      [],
      ['Parcela', 'Vencimento', 'Valor', 'Status', 'Recebida em', 'Forma', 'Conta'],
      ...alvo.map((p) => [
        String(p.numero),
        p.vencimento ? String(p.vencimento).slice(0, 10) : '',
        String(num(p.valor)),
        p.status,
        p.dataPagamento ? String(p.dataPagamento).slice(0, 10) : '',
        p.formaPagamento ?? '',
        p.banco ?? '',
      ]),
    ]
    const csv = linhas.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${r.codigo || `receita-${receitaId}`}.csv`
    link.click()
    URL.revokeObjectURL(url)
    setAviso(selecionadas?.length ? `${selecionadas.length} parcela(s) exportada(s).` : 'Lançamento exportado.')
  }, [r, totais, parcelas, receitaId])

  const copiar = useCallback(async (texto: string, rotulo: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      setAviso(`${rotulo} copiado.`)
    } catch {
      setAviso(`Não foi possível copiar ${rotulo.toLowerCase()}.`)
    }
  }, [])

  const irParaTecnico = useCallback((secao: SecaoTecnica) => {
    setSecaoTecnica(secao)
    setAba('tecnico')
  }, [])

  const abrirRecebimento = useCallback((p: ParcelaView) => {
    setPainel({ tipo: 'recebimento', modo: 'registrar', parcela: p })
  }, [])
  const abrirEdicaoRecebimento = useCallback((p: ParcelaView) => {
    setPainel({ tipo: 'recebimento', modo: 'editar', parcela: p })
  }, [])
  const abrirVencimento = useCallback((p: ParcelaView) => {
    setDataValor(p.vencimento ? String(p.vencimento).slice(0, 10) : '')
    setPainel({ tipo: 'vencimento', parcela: p })
  }, [])

  const menu = (posicao: 'abaixo' | 'acima') => (
    <ReceitaAcoesMenu
      acoes={acoes}
      posicao={posicao}
      desabilitado={salvando}
      onAlterarParcelamento={() => { setAba('parcelas'); setReparcelarAberto(true) }}
      onAlterarVencimento={() => { if (parcelaAlvo) abrirVencimento(parcelaAlvo); else setAba('parcelas') }}
      onEditarObservacoes={() => setPainel({ tipo: 'observacoes' })}
      onExportarCsv={() => exportarCsv()}
      onImprimir={() => window.print()}
      onCopiarReferencia={() => { if (r) void copiar(r.codigo, 'Referência') }}
      onCopiarId={() => { if (r) void copiar(String(r.id), 'ID interno') }}
      onVerRegra={() => irParaTecnico('regra')}
      onVerServico={() => irParaTecnico('servico')}
      onVerHistorico={() => setAba('historico')}
      onCancelar={() => { setMotivo(''); setPainel({ tipo: 'cancelamento', suprimirOrigem: false }) }}
      onEstornar={() => { setMotivo(''); setPainel({ tipo: 'estorno' }) }}
      onRevogarSupressao={() => { setMotivo(''); setPainel({ tipo: 'revogacao' }) }}
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
          tituloFallback={`${vocab.tipo} financeira`}
          natureza={natureza}
          menu={menu('abaixo')}
          onClose={onClose}
        />

        {r && totais && status && (
          <ReceitaResumoExecutivo totais={totais} moeda={r.moeda} status={status} />
        )}

        {acoes && (
          <ReceitaAcoesRapidas
            acoes={acoes}
            onRegistrarRecebimento={() => { if (parcelaAlvo) abrirRecebimento(parcelaAlvo) }}
            onAlterarParcelamento={() => { setAba('parcelas'); setReparcelarAberto(true) }}
            onAlterarVencimento={() => { if (parcelaAlvo) abrirVencimento(parcelaAlvo); else setAba('parcelas') }}
            onEditarObservacoes={() => setPainel({ tipo: 'observacoes' })}
            onExportar={() => exportarCsv()}
            onImprimir={() => window.print()}
            onCopiarReferencia={() => { if (r) void copiar(r.codigo, 'Referência') }}
          />
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

        <div className="rfm-corpo" role="tabpanel" id={`rfm-painel-${aba}`} aria-labelledby={`rfm-aba-${aba}`}>
          {carregando && <div className="rfm-carregando">Carregando lançamento…</div>}
          {erro && <div className="rfm-aviso erro">{erro}</div>}
          {aviso && <div className="rfm-aviso" role="status">{aviso}</div>}

          {d?.supressao?.ativa && (
            <div className="rfm-aviso atencao">
              <strong>Supressão ativa.</strong> O FinanceRuleEngine não recriará este lançamento.
              {' '}Motivo: {d.supressao.motivo} · {fmtData(d.supressao.suprimidoEm)}
            </div>
          )}

          {d && r && totais && status && acoes && (
            <>
              {aba === 'geral' && (
                <ReceitaVisaoGeral
                  detalhe={d}
                  acoes={acoes}
                  totais={totais}
                  status={status}
                  proximaParcela={parcelaAlvo}
                  onIrParaAba={setAba}
                  onRegistrarRecebimento={abrirRecebimento}
                  onAlterarVencimento={abrirVencimento}
                  onVerTecnico={(s) => irParaTecnico(s as SecaoTecnica)}
                />
              )}
              {aba === 'parcelas' && (
                <ReceitaParcelasTab
                  detalhe={d}
                  acoes={acoes}
                  totais={totais}
                  moeda={r.moeda}
                  salvando={salvando}
                  reparcelarAberto={reparcelarAberto}
                  onToggleReparcelar={setReparcelarAberto}
                  onReparcelar={(n) => void reparcelar(n)}
                  onAlterarVencimento={abrirVencimento}
                  onRegistrarRecebimento={abrirRecebimento}
                  onEditarRecebimento={abrirEdicaoRecebimento}
                  onEstornar={() => { setMotivo(''); setPainel({ tipo: 'estorno' }) }}
                  onVencimentoEmLote={(ps) => { setDataValor(new Date().toISOString().slice(0, 10)); setPainel({ tipo: 'vencimento-lote', parcelas: ps }) }}
                  onRecebimentoEmLote={(ps) => { setDataValor(new Date().toISOString().slice(0, 10)); setPainel({ tipo: 'recebimento-lote', parcelas: ps }) }}
                  onExportarSelecionadas={(ps) => exportarCsv(ps)}
                />
              )}
              {aba === 'recebimentos' && (
                <ReceitaRecebimentosTab
                  detalhe={d}
                  acoes={acoes}
                  totais={totais}
                  moeda={r.moeda}
                  parcelaAlvo={parcelaAlvo}
                  onRegistrarRecebimento={abrirRecebimento}
                  onEditarRecebimento={abrirEdicaoRecebimento}
                  onEstornar={() => { setMotivo(''); setPainel({ tipo: 'estorno' }) }}
                />
              )}
              {aba === 'historico' && <ReceitaHistoricoTab detalhe={d} moeda={r.moeda} />}
              {aba === 'tecnico' && (
                <ReceitaInformacoesTecnicasTab
                  detalhe={d}
                  secaoInicial={secaoTecnica}
                  onCopiar={(texto, rotulo) => void copiar(texto, rotulo)}
                />
              )}
            </>
          )}
        </div>

        <footer className="rfm-rodape">
          {menu('acima')}
          <div className="rfm-rodape-dir">
            <button type="button" className="rfm-btn-sec" onClick={onClose}>Fechar</button>
            {acoes?.lancamento.registrarRecebimento.disponivel && parcelaAlvo && aba !== 'geral' && (
              <button
                type="button"
                className="rfm-btn"
                disabled={salvando}
                onClick={() => abrirRecebimento(parcelaAlvo)}
              >
                {vocab.verbo}
              </button>
            )}
            {acoes?.quitado && aba !== 'geral' && <span className="rfm-selo ok">{vocab.quitado}</span>}
          </div>
        </footer>

        {/* ── Painéis internos ────────────────────────────────────────────── */}
        {painel && r && totais && acoes && (
          <div className="rfm-confirm-fundo" role="presentation">
            <div className="rfm-confirm" role="dialog" aria-modal="true" aria-label="Operação do lançamento">
              {painel.tipo === 'recebimento' && (
                <ReceitaRecebimentoForm
                  modo={painel.modo}
                  parcela={painel.parcela}
                  moeda={r.moeda}
                  cambioReferencia={totais.cambio}
                  salvando={salvando}
                  podeAlterarComprovante={acoes.parcela(painel.parcela).substituirComprovante.disponivel}
                  podeExcluirComprovante={acoes.parcela(painel.parcela).excluirComprovante.disponivel}
                  onCancelar={() => setPainel(null)}
                  onConfirmar={(dados) => {
                    if (painel.modo === 'registrar') void registrarRecebimento(painel.parcela, dados)
                    else void editarRecebimento(painel.parcela, dados)
                  }}
                />
              )}

              {painel.tipo === 'vencimento' && (
                <>
                  <h3 className="rfm-confirm-titulo">Alterar vencimento</h3>
                  <p className="rfm-confirm-texto">
                    Parcela {painel.parcela.numero} · {fmtMoeda(num(painel.parcela.valor), r.moeda)}
                  </p>
                  <label className="rfm-campo">
                    <span className="rfm-campo-rotulo">Novo vencimento</span>
                    <input type="date" value={dataValor} onChange={(e) => setDataValor(e.target.value)} />
                  </label>
                  <div className="rfm-confirm-acoes">
                    <button type="button" className="rfm-btn-sec" onClick={() => setPainel(null)}>Cancelar</button>
                    <button
                      type="button"
                      className="rfm-btn"
                      disabled={salvando || !dataValor}
                      onClick={async () => { await alterarVencimento(painel.parcela, dataValor); setPainel(null) }}
                    >
                      Salvar vencimento
                    </button>
                  </div>
                </>
              )}

              {painel.tipo === 'vencimento-lote' && (
                <>
                  <h3 className="rfm-confirm-titulo">Alterar vencimentos em lote</h3>
                  <p className="rfm-confirm-texto">
                    {painel.parcelas.length} parcelas selecionadas. O total contratual não muda.
                  </p>
                  <label className="rfm-campo">
                    <span className="rfm-campo-rotulo">Vencimento da primeira parcela</span>
                    <input type="date" value={dataValor} onChange={(e) => setDataValor(e.target.value)} />
                  </label>
                  <label className="rfm-check">
                    <input type="checkbox" checked={escalonar} onChange={(e) => setEscalonar(e.target.checked)} />
                    <span>Escalonar mensalmente (+1 mês por parcela)</span>
                  </label>
                  <div className="rfm-confirm-acoes">
                    <button type="button" className="rfm-btn-sec" onClick={() => setPainel(null)}>Cancelar</button>
                    <button
                      type="button"
                      className="rfm-btn"
                      disabled={salvando || !dataValor}
                      onClick={() =>
                        void emLote(
                          painel.parcelas,
                          (p, i) =>
                            fetch(`/api/financeiro/parcelas/${p.id}`, {
                              method: 'PATCH',
                              headers: cabecalhosAuth(),
                              body: JSON.stringify({ vencimento: dataEscalonada(dataValor, i) }),
                            }),
                          'Vencimentos atualizados',
                        )
                      }
                    >
                      Aplicar
                    </button>
                  </div>
                </>
              )}

              {painel.tipo === 'recebimento-lote' && (
                <>
                  <h3 className="rfm-confirm-titulo">Registrar recebimentos em lote</h3>
                  <p className="rfm-confirm-texto">
                    {painel.parcelas.length} parcelas selecionadas · câmbio de referência {totais.cambio.toFixed(4)}.
                    Cada parcela é registrada pelo fluxo oficial, com seu próprio evento.
                  </p>
                  <label className="rfm-campo">
                    <span className="rfm-campo-rotulo">Data do recebimento</span>
                    <input type="date" value={dataValor} onChange={(e) => setDataValor(e.target.value)} />
                  </label>
                  <div className="rfm-confirm-acoes">
                    <button type="button" className="rfm-btn-sec" onClick={() => setPainel(null)}>Cancelar</button>
                    <button
                      type="button"
                      className="rfm-btn"
                      disabled={salvando || !dataValor}
                      onClick={() =>
                        void emLote(
                          painel.parcelas,
                          (p) =>
                            fetch(`/api/financeiro/parcelas/${p.id}/lancamento`, {
                              method: 'POST',
                              headers: cabecalhosAuth(),
                              body: JSON.stringify({
                                cambioAplicado: totais.cambio,
                                dataPagamento: new Date(`${dataValor}T12:00:00`).toISOString(),
                              }),
                            }),
                          'Recebimentos registrados',
                        )
                      }
                    >
                      Registrar
                    </button>
                  </div>
                </>
              )}

              {painel.tipo === 'observacoes' && (
                <>
                  <h3 className="rfm-confirm-titulo">Observações do lançamento</h3>
                  <p className="rfm-confirm-texto">
                    Anotação operacional. Valor, moeda, regra e parcelas seguem definidos pelo motor.
                  </p>
                  <label className="rfm-campo">
                    <span className="rfm-campo-rotulo">Observações</span>
                    <textarea rows={4} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
                  </label>
                  <div className="rfm-confirm-acoes">
                    <button type="button" className="rfm-btn-sec" onClick={() => setPainel(null)}>Cancelar</button>
                    <button type="button" className="rfm-btn" disabled={salvando} onClick={() => void salvarObservacoes()}>
                      Salvar
                    </button>
                  </div>
                </>
              )}

              {painel.tipo === 'cancelamento' && (
                <>
                  <h3 className="rfm-confirm-titulo">Cancelar lançamento</h3>
                  <p className="rfm-confirm-texto">
                    {painel.aviso
                      ? `${painel.aviso} Confirmar registrando uma supressão autorizada? O motor deixará de recriar este lançamento até a supressão ser revogada.`
                      : 'O cancelamento é registrado com motivo e fica auditável.'}
                  </p>
                  <label className="rfm-campo">
                    <span className="rfm-campo-rotulo">Motivo</span>
                    <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  </label>
                  <div className="rfm-confirm-acoes">
                    <button type="button" className="rfm-btn-sec" onClick={() => setPainel(null)}>Voltar</button>
                    <button
                      type="button"
                      className="rfm-btn-perigo"
                      disabled={salvando}
                      onClick={() => void confirmarCancelamento(painel.suprimirOrigem)}
                    >
                      {painel.suprimirOrigem ? 'Cancelar e suprimir origem' : 'Cancelar lançamento'}
                    </button>
                  </div>
                </>
              )}

              {painel.tipo === 'estorno' && (
                <>
                  <h3 className="rfm-confirm-titulo">Estornar</h3>
                  <p className="rfm-confirm-texto">
                    Valor {fmtMoeda(totais.recebido, r.moeda)} · recebido em{' '}
                    {parcelas.filter((p) => p.dataPagamento).map((p) => fmtData(p.dataPagamento)).join(', ') || '—'}.
                    O lançamento e o recebimento originais são preservados — o estorno é registrado como contrapartida.
                  </p>
                  <label className="rfm-campo">
                    <span className="rfm-campo-rotulo">Motivo</span>
                    <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  </label>
                  <div className="rfm-confirm-acoes">
                    <button type="button" className="rfm-btn-sec" onClick={() => setPainel(null)}>Voltar</button>
                    <button type="button" className="rfm-btn-perigo" disabled={salvando} onClick={() => void confirmarEstorno()}>
                      Confirmar estorno
                    </button>
                  </div>
                </>
              )}

              {painel.tipo === 'revogacao' && (
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
                    <button type="button" className="rfm-btn-sec" onClick={() => setPainel(null)}>Voltar</button>
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

/** Central de Operação do CUSTO — mesmo componente, vocabulário e API de custo. */
export function CustoFinanceiroModal(props: Omit<ReceitaFinanceiraModalProps, 'natureza'>) {
  return <ReceitaFinanceiraModal {...props} natureza="CUSTO" />
}

export default ReceitaFinanceiraModal
