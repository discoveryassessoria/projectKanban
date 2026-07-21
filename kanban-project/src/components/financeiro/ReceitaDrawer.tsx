// src/components/financeiro/ReceitaDrawer.tsx
// ============================================================================
// Drawer lateral de DETALHES do lançamento de receita do Processo.
//
// O lançamento nasce do FinanceRuleEngine e permanece OPERÁVEL: parcelas,
// vencimentos, recebimentos, cancelamento com supressão e estorno. O que é
// calculado pelo motor (valor, moeda, requerentes, regra, preço) é somente
// leitura e marcado como tal — nunca editável aqui.
//
// Seções: A Resumo · B Composição · C Origem · D Requerentes · E Parcelas
//         F Recebimentos · G Campos operacionais · Histórico
// ============================================================================
'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  type LancamentoView,
  type ParcelaView,
  STATUS_LABEL,
  fmtMoeda,
  fmtBRL,
  fmtCambio,
  fmtData,
  statusDoLancamento,
  totaisDoLancamento,
  parcelaQuitada,
  parcelaVencida,
  num,
} from '@/lib/financeiro/apresentacao-lancamento'

// ── tipos do payload /detalhe ────────────────────────────────────────────────

interface Composicao {
  linhas: Array<{ rotulo: string; detalhe?: string; valor: number }>
  total: number
  moeda: string
  requerentes?: number
  regra?: string
}

interface Detalhe {
  receita: LancamentoView & {
    observacoes?: string | null
    createdAt?: string
    updatedAt?: string
    valorUnitario?: number | string | null
    quantidade?: number | string | null
    composicao: Composicao | null
    eventos?: Array<{ id: number; tipo: string; descricao: string; valor?: number | string | null; createdAt: string }>
  }
  requerentesConsiderados: Array<{ id: number; nome: string; statusFamiliar?: string | null; percentual: number }>
  origem: {
    processo: { id: number; codigo: string | null; nome: string; pais: string; tipo: string | null } | null
    phaseKey: string | null
    faseLabel: string | null
    servico: string | null
    documento: { id: number; tipo: string | null } | null
    configuracaoFinanceira: { id: number; nome: string; moedaPadrao: string } | null
    tabelaPrecos: { id: number; modoCalculo: string; natureza: string | null; vigenciaInicio: string | null; vigenciaFim: string | null; arquivado: boolean } | null
    regraFinanceira: { descricao: string; ruleKind: string; ruleSource: string; ruleId: number | null } | null
    eventoOperacional: string | null
    criadoEm: string
    atualizadoEm: string
    dataReferencia: string | null
    tecnico: Record<string, unknown>
  }
  supressao: { ativa: boolean; motivo: string; suprimidoEm: string; usuarioId: number | null } | null
  origemAtiva: boolean
  cancelamento: { em: string; motivo: string | null; por: string | null } | null
  estorno: { em: string; motivo: string | null } | null
  acoes: {
    podeCancelar: boolean
    exigeSupressao: boolean
    podeEstornar: boolean
    podeEditarParcelas: boolean
    podeRegistrarRecebimento: boolean
    podeRevogarSupressao: boolean
    motivoBloqueioCancelamento: string | null
    motivoBloqueioParcelas: string | null
  }
}

export interface ReceitaDrawerProps {
  receitaId: number
  onClose: () => void
  onChanged?: () => void
}

const auth = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('authToken') || '' : ''}`,
})

const STATUS_TOM: Record<string, string> = {
  RECEBIDO: 'var(--fpag-success, #16a34a)',
  VENCIDO: '#dc2626',
  CANCELADO: '#64748b',
  ESTORNADO: '#64748b',
  PARCIALMENTE_RECEBIDO: '#0284c7',
  A_VENCER: '#475569',
  SEM_VENCIMENTO: '#b45309',
  PREVISTO: '#475569',
}

/** Campo calculado pelo motor — exibido, jamais editável. */
function Calculado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="rdw-campo">
      <span className="rdw-campo-rotulo">
        {rotulo}
        <span className="rdw-lock" title="Definido automaticamente pelo FinanceRuleEngine">🔒</span>
      </span>
      <span className="rdw-campo-valor">{children}</span>
    </div>
  )
}

function Secao({ titulo, children, acao }: { titulo: string; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <section className="rdw-secao">
      <header className="rdw-secao-head">
        <h3>{titulo}</h3>
        {acao}
      </header>
      {children}
    </section>
  )
}

export function ReceitaDrawer({ receitaId, onClose, onChanged }: ReceitaDrawerProps) {
  const [d, setD] = useState<Detalhe | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [tecnicoAberto, setTecnicoAberto] = useState(false)
  const [reparcelando, setReparcelando] = useState(false)
  const [nParcelas, setNParcelas] = useState(1)
  const [observacoes, setObservacoes] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/financeiro/receitas/${receitaId}/detalhe`, { headers: auth() })
      if (!res.ok) {
        setErro(`Não foi possível carregar o lançamento (HTTP ${res.status}).`)
        return
      }
      const json: Detalhe = await res.json()
      setD(json)
      setNParcelas(json.receita.parcelas?.length || 1)
      setObservacoes(json.receita.observacoes ?? '')
    } catch {
      setErro('Erro de conexão ao carregar o lançamento.')
    } finally {
      setCarregando(false)
    }
  }, [receitaId])

  useEffect(() => { void carregar() }, [carregar])

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  async function chamar(url: string, init: RequestInit, sucesso: string) {
    setSalvando(true)
    setAviso(null)
    try {
      const res = await fetch(url, { ...init, headers: auth() })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAviso(json?.mensagem || json?.error || `Falha (HTTP ${res.status}).`)
        return { ok: false, json }
      }
      setAviso(sucesso)
      await carregar()
      onChanged?.()
      return { ok: true, json }
    } catch {
      setAviso('Erro de conexão.')
      return { ok: false, json: {} }
    } finally {
      setSalvando(false)
    }
  }

  async function alterarVencimento(p: ParcelaView, valorIso: string) {
    if (!valorIso) return
    await chamar(
      `/api/financeiro/parcelas/${p.id}`,
      { method: 'PATCH', body: JSON.stringify({ vencimento: valorIso }) },
      `Vencimento da parcela ${p.numero} atualizado.`,
    )
  }

  async function aplicarReparcelamento() {
    const r = await chamar(
      `/api/financeiro/receitas/${receitaId}/parcelas`,
      { method: 'PATCH', body: JSON.stringify({ nParcelas }) },
      `Parcelamento alterado para ${nParcelas}×. Total contratual preservado.`,
    )
    if (r.ok) setReparcelando(false)
  }

  async function salvarOperacionais() {
    await chamar(
      `/api/financeiro/receitas/${receitaId}`,
      { method: 'PATCH', body: JSON.stringify({ observacoes }) },
      'Campos operacionais salvos.',
    )
  }

  async function registrarRecebimento(p: ParcelaView) {
    const cambio = d ? totaisDoLancamento(d.receita).cambio : 1
    const entrada = window.prompt(
      `Registrar recebimento da parcela ${p.numero} (${fmtMoeda(num(p.valor), d!.receita.moeda)}).\n\nCâmbio aplicado no recebimento:`,
      String(cambio),
    )
    if (entrada == null) return
    const cambioAplicado = Number(entrada.replace(',', '.'))
    if (!isFinite(cambioAplicado) || cambioAplicado <= 0) {
      setAviso('Câmbio inválido — recebimento não registrado.')
      return
    }
    await chamar(
      `/api/financeiro/parcelas/${p.id}/lancamento`,
      {
        method: 'POST',
        body: JSON.stringify({ cambioAplicado, dataPagamento: new Date().toISOString() }),
      },
      `Recebimento da parcela ${p.numero} registrado.`,
    )
  }

  async function cancelar() {
    const motivo = window.prompt('Motivo do cancelamento deste lançamento:')
    if (!motivo || motivo.trim().length < 3) return
    const r = await chamar(
      `/api/financeiro/receitas/${receitaId}/cancelar`,
      { method: 'POST', body: JSON.stringify({ motivo }) },
      'Lançamento cancelado.',
    )
    // Origem ainda ativa: confirma a supressão rastreável antes de cancelar.
    if (!r.ok && r.json?.error === 'ORIGEM_ATIVA') {
      const ok = window.confirm(
        `${r.json.mensagem}\n\nConfirmar o cancelamento registrando uma supressão autorizada? O motor deixará de recriar este lançamento até a supressão ser revogada.`,
      )
      if (!ok) return
      await chamar(
        `/api/financeiro/receitas/${receitaId}/cancelar`,
        { method: 'POST', body: JSON.stringify({ motivo, suprimirOrigem: true }) },
        'Lançamento cancelado e supressão registrada.',
      )
    }
  }

  async function estornar() {
    const motivo = window.prompt('Motivo do estorno:')
    if (!motivo || motivo.trim().length < 3) return
    await chamar(
      `/api/financeiro/receitas/${receitaId}/estornar`,
      { method: 'POST', body: JSON.stringify({ motivo }) },
      'Estorno registrado — o lançamento e o recebimento originais foram preservados.',
    )
  }

  async function revogarSupressao() {
    const motivo = window.prompt('Motivo para revogar a supressão:') ?? ''
    await chamar(
      `/api/financeiro/receitas/${receitaId}/supressao`,
      { method: 'DELETE', body: JSON.stringify({ motivo }) },
      'Supressão revogada — a regra ativa volta a valer na próxima reconciliação.',
    )
  }

  // ── render ─────────────────────────────────────────────────────────────────

  const r = d?.receita
  const t = r ? totaisDoLancamento(r) : null
  const status = r ? statusDoLancamento(r) : null
  const parcelas = r?.parcelas ?? []
  const recebimentos = parcelas.filter(parcelaQuitada)

  return (
    <div className="rdw-overlay" role="dialog" aria-modal="true" aria-label="Detalhes do lançamento">
      <button type="button" className="rdw-backdrop" aria-label="Fechar" onClick={onClose} />
      <aside className="rdw-painel">
        {/* ── Cabeçalho fixo ── */}
        <header className="rdw-head">
          <div className="rdw-head-texto">
            <h2>{r?.descricao ?? 'Lançamento'}</h2>
            <div className="rdw-badges">
              <span className="rdw-badge rdw-badge-tipo">Receita</span>
              {r && <span className="rdw-badge rdw-badge-moeda">{r.moeda}</span>}
              {status && (
                <span className="rdw-badge" style={{ background: STATUS_TOM[status], color: '#fff' }}>
                  {STATUS_LABEL[status]}
                </span>
              )}
            </div>
            <div className="rdw-head-sub">
              {d?.origem.processo?.codigo ?? d?.origem.processo?.nome ?? ''}
              {d?.origem.faseLabel ? ` · ${d.origem.faseLabel}` : ''}
              {r?.origem === 'motor' ? ' · Gerado automaticamente' : ''}
            </div>
          </div>
          <button type="button" className="rdw-fechar" onClick={onClose} aria-label="Fechar">×</button>
        </header>

        {/* ── Conteúdo rolável ── */}
        <div className="rdw-corpo">
          {carregando && <div className="rdw-vazio">Carregando lançamento…</div>}
          {erro && <div className="rdw-alerta rdw-alerta-erro">{erro}</div>}
          {aviso && <div className="rdw-alerta">{aviso}</div>}

          {d?.supressao?.ativa && (
            <div className="rdw-alerta rdw-alerta-atencao">
              <strong>Supressão ativa.</strong> O FinanceRuleEngine não recriará este lançamento.
              <br />Motivo: {d.supressao.motivo} · {fmtData(d.supressao.suprimidoEm)}
            </div>
          )}

          {r && t && (
            <>
              {/* ── A · RESUMO FINANCEIRO ── */}
              <Secao titulo="Resumo financeiro">
                <div className="rdw-destaque">
                  <span className="rdw-destaque-rotulo">Valor contratual</span>
                  <span className="rdw-destaque-valor">{fmtMoeda(t.contratado, r.moeda)}</span>
                </div>
                <div className="rdw-grid2">
                  <Calculado rotulo="Recebido">{fmtMoeda(t.recebido, r.moeda)}</Calculado>
                  <Calculado rotulo="Saldo">{fmtMoeda(t.saldo, r.moeda)}</Calculado>
                </div>
                {r.moeda !== 'BRL' && (
                  <div className="rdw-conversao">
                    <div className="rdw-conversao-linha">
                      <span>Conversão {t.conversaoEstimada ? 'estimada' : 'congelada'}</span>
                      <strong>{fmtBRL(t.contratadoBrl)}</strong>
                    </div>
                    <div className="rdw-conversao-linha rdw-fraco">
                      <span>Câmbio</span>
                      <span>1 {r.moeda} = {fmtCambio(t.cambio)} BRL</span>
                    </div>
                    {r.fxData && (
                      <div className="rdw-conversao-linha rdw-fraco">
                        <span>Data do câmbio</span><span>{fmtData(r.fxData)}</span>
                      </div>
                    )}
                    <p className="rdw-nota">
                      A moeda contratual é {r.moeda}. O valor em BRL é conversão auxiliar
                      {t.conversaoEstimada ? ' estimada' : ''} e não altera o valor contratado.
                    </p>
                  </div>
                )}
              </Secao>

              {/* ── B · COMPOSIÇÃO DO CÁLCULO ── */}
              <Secao titulo="Composição do cálculo">
                {r.composicao ? (
                  <>
                    <ul className="rdw-composicao">
                      {r.composicao.linhas.map((l, i) => (
                        <li key={i}>
                          <span>
                            {l.rotulo}
                            {l.detalhe ? <em className="rdw-fraco"> ({l.detalhe})</em> : null}
                          </span>
                          <strong>{fmtMoeda(l.valor, r.moeda)}</strong>
                        </li>
                      ))}
                      <li className="rdw-composicao-total">
                        <span>Total contratual</span>
                        <strong>{fmtMoeda(r.composicao.total, r.moeda)}</strong>
                      </li>
                    </ul>
                    <div className="rdw-grid2">
                      {r.composicao.requerentes != null && (
                        <Calculado rotulo="Requerentes">{r.composicao.requerentes}</Calculado>
                      )}
                      {r.composicao.regra && <Calculado rotulo="Regra de cálculo">{r.composicao.regra}</Calculado>}
                      {d.origem.tabelaPrecos && (
                        <>
                          <Calculado rotulo="Tabela de preços">#{d.origem.tabelaPrecos.id} · {d.origem.tabelaPrecos.modoCalculo}</Calculado>
                          <Calculado rotulo="Vigência">
                            {d.origem.tabelaPrecos.vigenciaInicio ?? '—'} → {d.origem.tabelaPrecos.vigenciaFim ?? 'sem fim'}
                          </Calculado>
                        </>
                      )}
                      {d.origem.dataReferencia && (
                        <Calculado rotulo="Data de aplicação">{fmtData(d.origem.dataReferencia)}</Calculado>
                      )}
                    </div>
                    <p className="rdw-nota">Composição congelada pelo FinanceRuleEngine. Somente leitura.</p>
                  </>
                ) : (
                  <p className="rdw-fraco">O motor não registrou composição detalhada para este lançamento.</p>
                )}
              </Secao>

              {/* ── C · ORIGEM ── */}
              <Secao titulo="Origem do lançamento">
                <div className="rdw-grid2">
                  <Calculado rotulo="Processo">{d.origem.processo?.codigo ?? d.origem.processo?.nome ?? '—'}</Calculado>
                  <Calculado rotulo="País">{d.origem.processo?.pais ?? '—'}</Calculado>
                  <Calculado rotulo="Tipo do processo">{d.origem.processo?.tipo ?? '—'}</Calculado>
                  <Calculado rotulo="Fase de origem">{d.origem.faseLabel ?? '—'}</Calculado>
                  <Calculado rotulo="Serviço">{d.origem.servico ?? d.origem.configuracaoFinanceira?.nome ?? '—'}</Calculado>
                  <Calculado rotulo="Regra financeira">{d.origem.regraFinanceira?.descricao ?? '—'}</Calculado>
                  <Calculado rotulo="Evento operacional">{d.origem.eventoOperacional ?? '—'}</Calculado>
                  <Calculado rotulo="Documento relacionado">
                    {d.origem.documento ? `#${d.origem.documento.id} ${d.origem.documento.tipo ?? ''}` : '—'}
                  </Calculado>
                  <Calculado rotulo="Criado em">{fmtData(d.origem.criadoEm)}</Calculado>
                  <Calculado rotulo="Última reconciliação">{fmtData(d.origem.atualizadoEm)}</Calculado>
                </div>
                <button type="button" className="rdw-link" onClick={() => setTecnicoAberto((v) => !v)}>
                  {tecnicoAberto ? '▾' : '▸'} Informações técnicas (suporte)
                </button>
                {tecnicoAberto && (
                  <pre className="rdw-tecnico">{JSON.stringify(d.origem.tecnico, null, 2)}</pre>
                )}
              </Secao>

              {/* ── D · REQUERENTES CONSIDERADOS ── */}
              {d.requerentesConsiderados.length > 0 && (
                <Secao titulo="Requerentes considerados">
                  <ul className="rdw-lista">
                    {d.requerentesConsiderados.map((q) => (
                      <li key={q.id}>
                        <span>{q.nome}</span>
                        <span className="rdw-fraco">{q.statusFamiliar === 'menor' ? 'Menor' : 'Adulto'}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="rdw-nota">Adulto ou menor é informativo — ambos contam igualmente no cálculo.</p>
                </Secao>
              )}

              {/* ── E · PARCELAS ── */}
              <Secao
                titulo="Parcelas"
                acao={
                  d.acoes.podeEditarParcelas ? (
                    <button type="button" className="rdw-btn-sec" onClick={() => setReparcelando((v) => !v)}>
                      {reparcelando ? 'Cancelar' : 'Alterar parcelamento'}
                    </button>
                  ) : null
                }
              >
                {reparcelando && (
                  <div className="rdw-reparcelar">
                    <label>
                      Número de parcelas
                      <input
                        type="number" min={1} max={120} value={nParcelas}
                        onChange={(e) => setNParcelas(Math.max(1, Number(e.target.value) || 1))}
                      />
                    </label>
                    <button type="button" className="rdw-btn" disabled={salvando} onClick={aplicarReparcelamento}>
                      Redistribuir {fmtMoeda(t.contratado, r.moeda)}
                    </button>
                    <p className="rdw-nota">
                      O total contratual não muda — apenas a divisão. A última parcela absorve o arredondamento.
                    </p>
                  </div>
                )}
                {d.acoes.motivoBloqueioParcelas && (
                  <p className="rdw-bloqueio">{d.acoes.motivoBloqueioParcelas}</p>
                )}
                {parcelas.length === 0 ? (
                  <p className="rdw-fraco">Sem parcelas geradas.</p>
                ) : (
                  <ul className="rdw-parcelas">
                    {parcelas.map((p) => {
                      const quitada = parcelaQuitada(p)
                      const vencida = parcelaVencida(p)
                      return (
                        <li key={p.id} className={quitada ? 'quitada' : vencida ? 'vencida' : ''}>
                          <div className="rdw-parcela-topo">
                            <strong>Parcela {p.numero} de {parcelas.length}</strong>
                            <strong>{fmtMoeda(num(p.valor), r.moeda)}</strong>
                          </div>
                          <div className="rdw-parcela-linha">
                            <span>Vencimento</span>
                            {p.status === 'PENDENTE' && d.acoes.podeEditarParcelas ? (
                              <input
                                type="date"
                                defaultValue={p.vencimento ? String(p.vencimento).slice(0, 10) : ''}
                                onChange={(e) => void alterarVencimento(p, e.target.value)}
                                disabled={salvando}
                              />
                            ) : (
                              <span>{fmtData(p.vencimento)}</span>
                            )}
                          </div>
                          <div className="rdw-parcela-linha">
                            <span>Status</span>
                            <span>{quitada ? 'Recebida' : vencida ? 'Vencida' : p.vencimento ? 'A vencer' : 'Vencimento não definido'}</span>
                          </div>
                          <div className="rdw-parcela-linha">
                            <span>Recebido</span>
                            <span>{quitada ? fmtMoeda(num(p.valor), r.moeda) : fmtMoeda(0, r.moeda)}</span>
                          </div>
                          {quitada && (
                            <div className="rdw-parcela-linha rdw-fraco">
                              <span>Data do recebimento</span><span>{fmtData(p.dataPagamento)}</span>
                            </div>
                          )}
                          {!quitada && d.acoes.podeRegistrarRecebimento && (
                            <button type="button" className="rdw-btn-sec" disabled={salvando} onClick={() => void registrarRecebimento(p)}>
                              Registrar recebimento
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Secao>

              {/* ── F · RECEBIMENTOS ── */}
              <Secao titulo="Recebimentos">
                {recebimentos.length === 0 ? (
                  <p className="rdw-fraco">Nenhum recebimento registrado.</p>
                ) : (
                  <ul className="rdw-lista">
                    {recebimentos.map((p) => (
                      <li key={p.id}>
                        <span>
                          Parcela {p.numero} · {fmtData(p.dataPagamento)}
                          {p.formaPagamento ? ` · ${p.formaPagamento}` : ''}
                          {p.banco ? ` · ${p.banco}` : ''}
                        </span>
                        <span>
                          {fmtMoeda(num(p.valor), r.moeda)}
                          {p.valorBrl ? <em className="rdw-fraco"> ({fmtBRL(num(p.valorBrl))})</em> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="rdw-nota">
                  O recebimento usa o fluxo financeiro oficial e reflete no Financeiro Corporativo — não há caixa paralelo no Processo.
                </p>
              </Secao>

              {/* ── G · CAMPOS OPERACIONAIS ── */}
              <Secao titulo="Campos operacionais">
                <label className="rdw-label">
                  Observações internas
                  <textarea
                    rows={3}
                    value={observacoes}
                    onChange={(e) => setObservacoes(e.target.value)}
                    disabled={salvando || !!d.cancelamento}
                    placeholder="Anotação operacional deste lançamento"
                  />
                </label>
                <p className="rdw-nota">
                  Valor, moeda, requerentes, regra, tabela de preços e fase são definidos automaticamente pelo
                  FinanceRuleEngine e não podem ser editados aqui.
                </p>
              </Secao>

              {/* ── HISTÓRICO ── */}
              <Secao titulo="Histórico">
                {!r.eventos?.length ? (
                  <p className="rdw-fraco">Sem eventos registrados.</p>
                ) : (
                  <ol className="rdw-historico">
                    {r.eventos.map((e) => (
                      <li key={e.id}>
                        <span className="rdw-historico-data">{fmtData(e.createdAt)}</span>
                        <span className="rdw-historico-texto">{e.descricao}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Secao>
            </>
          )}
        </div>

        {/* ── Rodapé fixo: só ações disponíveis ── */}
        <footer className="rdw-rodape">
          {d?.acoes.motivoBloqueioCancelamento && !d.acoes.podeCancelar && (
            <p className="rdw-bloqueio">{d.acoes.motivoBloqueioCancelamento}</p>
          )}
          <div className="rdw-rodape-botoes">
            {d && (
              <button type="button" className="rdw-btn" disabled={salvando || !!d.cancelamento} onClick={salvarOperacionais}>
                Salvar alterações operacionais
              </button>
            )}
            {d?.acoes.podeEstornar && (
              <button type="button" className="rdw-btn-perigo" disabled={salvando} onClick={estornar}>
                Estornar
              </button>
            )}
            {d?.acoes.podeCancelar && (
              <button type="button" className="rdw-btn-perigo" disabled={salvando} onClick={cancelar}>
                Cancelar lançamento
              </button>
            )}
            {d?.acoes.podeRevogarSupressao && (
              <button type="button" className="rdw-btn-sec" disabled={salvando} onClick={revogarSupressao}>
                Revogar supressão
              </button>
            )}
            <button type="button" className="rdw-btn-sec" onClick={onClose}>Fechar</button>
          </div>
        </footer>
      </aside>

      <style jsx>{`
        .rdw-overlay { position: fixed; inset: 0; z-index: 1200; display: flex; justify-content: flex-end; }
        .rdw-backdrop { position: absolute; inset: 0; background: rgba(15, 23, 42, 0.35); border: 0; padding: 0; cursor: pointer; }
        .rdw-painel {
          position: relative; display: flex; flex-direction: column;
          width: min(620px, 100vw); max-width: 100vw; height: 100%;
          background: #fff; box-shadow: -8px 0 32px rgba(15, 23, 42, 0.18);
        }
        @media (max-width: 640px) { .rdw-painel { width: 100vw; } }
        .rdw-head {
          flex: 0 0 auto; display: flex; gap: 12px; align-items: flex-start;
          padding: 18px 20px 14px; border-bottom: 1px solid #e2e8f0; background: #fff;
        }
        .rdw-head-texto { flex: 1; min-width: 0; }
        .rdw-head h2 { margin: 0 0 8px; font-size: 17px; line-height: 1.3; color: #0f172a; }
        .rdw-head-sub { margin-top: 8px; font-size: 12px; color: #64748b; }
        .rdw-badges { display: flex; flex-wrap: wrap; gap: 6px; }
        .rdw-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #475569; }
        .rdw-badge-tipo { background: #ecfdf5; color: #047857; }
        .rdw-badge-moeda { background: #eff6ff; color: #1d4ed8; }
        .rdw-fechar { flex: 0 0 auto; width: 32px; height: 32px; border: 0; border-radius: 8px; background: #f1f5f9; color: #475569; font-size: 20px; line-height: 1; cursor: pointer; }
        .rdw-corpo { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding: 4px 20px 20px; }
        .rdw-secao { padding: 16px 0; border-bottom: 1px solid #f1f5f9; }
        .rdw-secao-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
        .rdw-secao-head h3 { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #64748b; }
        .rdw-destaque { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
        .rdw-destaque-rotulo { font-size: 12px; color: #64748b; }
        .rdw-destaque-valor { font-size: 28px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em; }
        .rdw-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px 16px; }
        .rdw-campo { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .rdw-campo-rotulo { font-size: 11px; color: #94a3b8; display: inline-flex; align-items: center; gap: 4px; }
        .rdw-campo-valor { font-size: 14px; color: #0f172a; overflow-wrap: anywhere; }
        .rdw-lock { font-size: 9px; opacity: .55; }
        .rdw-conversao { margin-top: 14px; padding: 10px 12px; background: #f8fafc; border-radius: 8px; }
        .rdw-conversao-linha { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; padding: 2px 0; color: #334155; }
        .rdw-fraco { color: #94a3b8; font-style: normal; }
        .rdw-nota { margin: 8px 0 0; font-size: 11px; color: #94a3b8; line-height: 1.5; }
        .rdw-composicao { list-style: none; margin: 0 0 12px; padding: 0; }
        .rdw-composicao li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; font-size: 13px; color: #334155; border-bottom: 1px dashed #e2e8f0; }
        .rdw-composicao-total { border-bottom: 0 !important; border-top: 2px solid #e2e8f0; margin-top: 4px; padding-top: 8px !important; font-size: 14px !important; color: #0f172a !important; }
        .rdw-lista { list-style: none; margin: 0; padding: 0; }
        .rdw-lista li { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; font-size: 13px; color: #334155; border-bottom: 1px solid #f1f5f9; }
        .rdw-parcelas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
        .rdw-parcelas li { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; }
        .rdw-parcelas li.quitada { border-color: #bbf7d0; background: #f0fdf4; }
        .rdw-parcelas li.vencida { border-color: #fecaca; background: #fef2f2; }
        .rdw-parcela-topo { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; font-size: 14px; color: #0f172a; }
        .rdw-parcela-linha { display: flex; justify-content: space-between; gap: 12px; align-items: center; font-size: 12px; color: #475569; padding: 3px 0; }
        .rdw-parcela-linha input { font: inherit; padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 6px; }
        .rdw-reparcelar { margin-bottom: 12px; padding: 12px; background: #f8fafc; border-radius: 8px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
        .rdw-reparcelar label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569; }
        .rdw-reparcelar input { font: inherit; width: 100px; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 6px; }
        .rdw-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569; }
        .rdw-label textarea { font: inherit; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; resize: vertical; }
        .rdw-historico { list-style: none; margin: 0; padding: 0; }
        .rdw-historico li { display: flex; gap: 10px; padding: 6px 0; font-size: 12px; border-bottom: 1px solid #f8fafc; }
        .rdw-historico-data { flex: 0 0 84px; color: #94a3b8; }
        .rdw-historico-texto { color: #334155; overflow-wrap: anywhere; }
        .rdw-tecnico { margin: 8px 0 0; padding: 10px; background: #0f172a; color: #e2e8f0; border-radius: 8px; font-size: 11px; overflow-x: auto; }
        .rdw-link { border: 0; background: none; padding: 6px 0 0; color: #2563eb; font-size: 12px; cursor: pointer; }
        .rdw-alerta { margin: 12px 0; padding: 10px 12px; border-radius: 8px; background: #eff6ff; color: #1e40af; font-size: 13px; }
        .rdw-alerta-erro { background: #fef2f2; color: #b91c1c; }
        .rdw-alerta-atencao { background: #fffbeb; color: #92400e; }
        .rdw-bloqueio { margin: 0 0 10px; padding: 8px 10px; border-radius: 6px; background: #fef2f2; color: #b91c1c; font-size: 12px; line-height: 1.5; }
        .rdw-vazio { padding: 32px 0; text-align: center; color: #94a3b8; font-size: 13px; }
        .rdw-rodape { flex: 0 0 auto; padding: 12px 20px; border-top: 1px solid #e2e8f0; background: #fff; }
        .rdw-rodape-botoes { display: flex; flex-wrap: wrap; gap: 8px; }
        .rdw-btn, .rdw-btn-sec, .rdw-btn-perigo {
          font: inherit; font-size: 13px; font-weight: 600; padding: 8px 14px;
          border-radius: 8px; cursor: pointer; border: 1px solid transparent;
        }
        .rdw-btn { background: #2563eb; color: #fff; }
        .rdw-btn-sec { background: #fff; color: #475569; border-color: #cbd5e1; }
        .rdw-btn-perigo { background: #fff; color: #b91c1c; border-color: #fecaca; }
        .rdw-btn:disabled, .rdw-btn-sec:disabled, .rdw-btn-perigo:disabled { opacity: .5; cursor: not-allowed; }
      `}</style>
    </div>
  )
}

export default ReceitaDrawer
