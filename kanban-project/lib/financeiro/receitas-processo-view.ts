// lib/financeiro/receitas-processo-view.ts
// ============================================================================
// View model PURO da tela de Receitas do Processo: compõe a hierarquia
// Fase → Requerente → Receita → Cobrança → Parcela e os totais/status, sem
// duplicar entidade nem tocar o banco. É a fonte única de organização da tela
// (e dos testes). Backend continua a fonte da verdade; aqui só agregamos leitura.
//
// Módulo PURO: sem Prisma, sem fetch, sem React.
// ============================================================================

export type StatusFinanceiro = 'SEM_COBRANCA' | 'A_VENCER' | 'PARCIAL' | 'RECEBIDO' | 'VENCIDO' | 'CANCELADO' | 'ESTORNADO'

export interface ParcelaRow { id: number; numero: number; vencimento: string | Date; valor: number | string; status: string }
export interface CobrancaRow {
  id: number; status: string; valorTotal: number | string
  formaPagamentoId?: number | null; condicaoPagamentoId?: number | null; carteiraId?: number | null
  parcelas: ParcelaRow[]; eventos?: { tipo: string; valor: number | string | null }[]
}
export interface ReceitaRow {
  id: number; codigo: string; descricao: string | null; categoria?: string | null
  phaseKey: string | null; valor: number | string; moeda: string; status?: string | null; cancelada?: boolean | null
  data1?: string | Date | null; estornoDeId?: number | null
  pessoa?: { id: number; nome: string; sobrenome?: string | null; createdAt?: string | Date | null } | null
  tipoServico?: { nome: string } | null
  cobrancas: CobrancaRow[]
}

export interface Catalogos {
  fases: Record<string, string> // phaseKey → label
  formas: Record<number, string>
  condicoes: Record<number, string>
  carteiras: Record<number, string>
}

const cent = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100
const pago = (status: string) => status === 'RECEBIDA' || status === 'PAGA'
const asTime = (v: string | Date | null | undefined) => { if (!v) return 0; const d = new Date(v); return isNaN(d.getTime()) ? 0 : d.getTime() }

export interface ParcelaVM { id: number; numero: number; vencimento: string | null; valor: number; pago: boolean; status: string }
export interface CobrancaVM {
  id: number; label: string; status: string
  forma: string | null; condicao: string | null; carteira: string | null
  valorTotal: number; pago: number; saldo: number
  nParcelas: number; parcelasPagas: number; proximoVencimento: string | null; proximaParcela: number | null
  parcelas: ParcelaVM[]
}
export interface ReceitaVM {
  id: number; codigo: string; descricao: string; servico: string | null
  faseKey: string | null; faseLabel: string; categoria: string | null; moeda: string
  valorContratual: number; recebido: number; saldo: number
  vencimento: string | null; status: StatusFinanceiro; temCobranca: boolean
  cobrancas: CobrancaVM[]
}
export interface RequerenteVM {
  pessoaId: number | null; nome: string; papel: 'principal' | 'adicional'
  moeda: string; totalReceitas: number; recebido: number; saldo: number; status: StatusFinanceiro
  qtdReceitas: number; receitas: ReceitaVM[]
}
export interface FaseVM {
  faseKey: string; faseLabel: string; moeda: string
  totalReceitas: number; recebido: number; saldo: number
  qtdRequerentes: number; qtdReceitas: number; qtdCobrancas: number; qtdParcelas: number; qtdPagamentos: number
  requerentes: RequerenteVM[]
}
export interface ResumoView {
  moeda: string
  totalContratado: number; totalRecebido: number; saldoAReceber: number; pctRecebido: number
  qtdReceitas: number; qtdCobrancas: number; qtdParcelas: number; qtdPagamentos: number
  parcelasPendentes: number; parcelasVencidas: number; receitasSemCobranca: number
  statusGeral: StatusFinanceiro
}
export interface ReceitasView { fases: FaseVM[]; resumo: ResumoView }

// ── prioridade de status para agregação (maior = mais crítico) ──
const PESO: Record<StatusFinanceiro, number> = { CANCELADO: 0, ESTORNADO: 0, RECEBIDO: 1, SEM_COBRANCA: 2, A_VENCER: 3, PARCIAL: 4, VENCIDO: 5 }
function agregarStatus(lista: StatusFinanceiro[]): StatusFinanceiro {
  const ativos = lista.filter((s) => s !== 'CANCELADO' && s !== 'ESTORNADO')
  if (ativos.length === 0) return lista[0] ?? 'SEM_COBRANCA'
  return ativos.reduce((a, b) => (PESO[b] > PESO[a] ? b : a), ativos[0])
}

/** Constrói a Cobrança-VM (parcelas, pago, saldo, próximo vencimento). */
function montarCobranca(c: CobrancaRow, cat: Catalogos, hoje: number): CobrancaVM {
  const parcelas: ParcelaVM[] = (c.parcelas ?? []).slice().sort((a, b) => a.numero - b.numero).map((p) => ({
    id: p.id, numero: p.numero, vencimento: p.vencimento ? new Date(p.vencimento).toISOString() : null,
    valor: cent(p.valor), pago: pago(p.status), status: p.status,
  }))
  const valorTotal = cent(c.valorTotal)
  const pagoTotal = cent(parcelas.filter((p) => p.pago).reduce((s, p) => s + p.valor, 0))
  const pendentes = parcelas.filter((p) => !p.pago)
  const prox = pendentes.slice().sort((a, b) => asTime(a.vencimento) - asTime(b.vencimento))[0] ?? null
  return {
    id: c.id, label: `#CBR-${c.id}`, status: c.status,
    forma: c.formaPagamentoId ? cat.formas[c.formaPagamentoId] ?? null : null,
    condicao: c.condicaoPagamentoId ? cat.condicoes[c.condicaoPagamentoId] ?? null : null,
    carteira: c.carteiraId ? cat.carteiras[c.carteiraId] ?? null : null,
    valorTotal, pago: pagoTotal, saldo: cent(valorTotal - pagoTotal),
    nParcelas: parcelas.length, parcelasPagas: parcelas.filter((p) => p.pago).length,
    proximoVencimento: prox?.vencimento ?? null, proximaParcela: prox?.numero ?? null,
    parcelas,
  }
}

/** Deriva o status financeiro de uma receita a partir de suas cobranças/parcelas. */
function statusReceita(r: ReceitaRow, cobrancas: CobrancaVM[], hoje: number): StatusFinanceiro {
  if (r.estornoDeId) return 'ESTORNADO'
  if (r.cancelada || String(r.status ?? '').toUpperCase() === 'CANCELADA') return 'CANCELADO'
  const parcelas = cobrancas.flatMap((c) => c.parcelas)
  if (cobrancas.length === 0 || parcelas.length === 0) return 'SEM_COBRANCA'
  const total = parcelas.length
  const pagas = parcelas.filter((p) => p.pago).length
  if (pagas >= total) return 'RECEBIDO'
  const temVencida = parcelas.some((p) => !p.pago && p.vencimento && asTime(p.vencimento) < hoje)
  if (temVencida) return 'VENCIDO'
  if (pagas > 0) return 'PARCIAL'
  return 'A_VENCER'
}

/** Monta o view model completo. `hojeMs` deve vir do chamador (determinismo/teste). */
export function montarReceitasView(rows: ReceitaRow[], cat: Catalogos, hojeMs: number): ReceitasView {
  const fasesMap = new Map<string, FaseVM>()
  // ordem de requerente do processo: por createdAt da pessoa, depois id (= classificacao-requerente)
  const pessoas = Array.from(new Map(rows.filter((r) => r.pessoa).map((r) => [r.pessoa!.id, r.pessoa!])).values())
  pessoas.sort((a, b) => asTime(a.createdAt) - asTime(b.createdAt) || a.id - b.id)
  const papelDe = new Map<number, 'principal' | 'adicional'>()
  pessoas.forEach((p, i) => papelDe.set(p.id, i === 0 ? 'principal' : 'adicional'))

  for (const r of rows) {
    const faseKey = r.phaseKey ?? 'sem_fase'
    const faseLabel = cat.fases[faseKey] ?? rotularFallback(faseKey)
    if (!fasesMap.has(faseKey)) fasesMap.set(faseKey, {
      faseKey, faseLabel, moeda: r.moeda, totalReceitas: 0, recebido: 0, saldo: 0,
      qtdRequerentes: 0, qtdReceitas: 0, qtdCobrancas: 0, qtdParcelas: 0, qtdPagamentos: 0, requerentes: [],
    })
    const fase = fasesMap.get(faseKey)!

    const cobrancas = (r.cobrancas ?? []).map((c) => montarCobranca(c, cat, hojeMs))
    const recebido = cent(cobrancas.reduce((s, c) => s + c.pago, 0))
    const valorContratual = cent(r.valor)
    const status = statusReceita(r, cobrancas, hojeMs)
    const vencimento = cobrancas.flatMap((c) => c.parcelas).filter((p) => !p.pago).map((p) => p.vencimento)
      .filter(Boolean).sort((a, b) => asTime(a) - asTime(b))[0] ?? (r.data1 ? new Date(r.data1).toISOString() : null)

    const receita: ReceitaVM = {
      id: r.id, codigo: r.codigo, descricao: r.descricao ?? r.codigo, servico: r.tipoServico?.nome ?? null,
      faseKey: r.phaseKey, faseLabel, categoria: r.categoria ?? null, moeda: r.moeda,
      valorContratual, recebido, saldo: cent(valorContratual - recebido),
      vencimento, status, temCobranca: cobrancas.length > 0, cobrancas,
    }

    const pid = r.pessoa?.id ?? null
    const nome = r.pessoa ? `${r.pessoa.nome}${r.pessoa.sobrenome ? ` ${r.pessoa.sobrenome}` : ''}` : 'Sem requerente'
    let req = fase.requerentes.find((x) => x.pessoaId === pid)
    if (!req) {
      req = { pessoaId: pid, nome, papel: (pid != null ? papelDe.get(pid) : undefined) ?? 'adicional', moeda: r.moeda, totalReceitas: 0, recebido: 0, saldo: 0, status: 'SEM_COBRANCA', qtdReceitas: 0, receitas: [] }
      fase.requerentes.push(req)
    }
    req.receitas.push(receita)
  }

  // consolidação
  const fases = Array.from(fasesMap.values())
  for (const fase of fases) {
    for (const req of fase.requerentes) {
      req.qtdReceitas = req.receitas.length
      req.totalReceitas = cent(req.receitas.reduce((s, r) => s + r.valorContratual, 0))
      req.recebido = cent(req.receitas.reduce((s, r) => s + r.recebido, 0))
      req.saldo = cent(req.totalReceitas - req.recebido)
      req.status = agregarStatus(req.receitas.map((r) => r.status))
    }
    // principal primeiro, depois por nome
    fase.requerentes.sort((a, b) => (a.papel === b.papel ? a.nome.localeCompare(b.nome) : a.papel === 'principal' ? -1 : 1))
    const receitas = fase.requerentes.flatMap((r) => r.receitas)
    fase.qtdRequerentes = fase.requerentes.length
    fase.qtdReceitas = receitas.length
    fase.totalReceitas = cent(receitas.reduce((s, r) => s + r.valorContratual, 0))
    fase.recebido = cent(receitas.reduce((s, r) => s + r.recebido, 0))
    fase.saldo = cent(fase.totalReceitas - fase.recebido)
    const cobrancas = receitas.flatMap((r) => r.cobrancas)
    fase.qtdCobrancas = cobrancas.length
    const parcelas = cobrancas.flatMap((c) => c.parcelas)
    fase.qtdParcelas = parcelas.length
    fase.qtdPagamentos = parcelas.filter((p) => p.pago).length
  }
  fases.sort((a, b) => a.faseLabel.localeCompare(b.faseLabel))

  // resumo global (moeda predominante; a UI nunca soma moedas diferentes na mesma linha)
  const todasReceitas = fases.flatMap((f) => f.requerentes.flatMap((r) => r.receitas))
  const moeda = todasReceitas[0]?.moeda ?? 'BRL'
  const totalContratado = cent(todasReceitas.reduce((s, r) => s + r.valorContratual, 0))
  const totalRecebido = cent(todasReceitas.reduce((s, r) => s + r.recebido, 0))
  const parcelas = todasReceitas.flatMap((r) => r.cobrancas.flatMap((c) => c.parcelas))
  const resumo: ResumoView = {
    moeda, totalContratado, totalRecebido, saldoAReceber: cent(totalContratado - totalRecebido),
    pctRecebido: totalContratado > 0 ? Math.round((totalRecebido / totalContratado) * 1000) / 10 : 0,
    qtdReceitas: todasReceitas.length, qtdCobrancas: todasReceitas.reduce((s, r) => s + r.cobrancas.length, 0),
    qtdParcelas: parcelas.length, qtdPagamentos: parcelas.filter((p) => p.pago).length,
    parcelasPendentes: parcelas.filter((p) => !p.pago).length,
    parcelasVencidas: parcelas.filter((p) => !p.pago && p.vencimento && asTime(p.vencimento) < hojeMs).length,
    receitasSemCobranca: todasReceitas.filter((r) => !r.temCobranca && r.status !== 'CANCELADO').length,
    statusGeral: agregarStatus(todasReceitas.map((r) => r.status)),
  }
  return { fases, resumo }
}

// Matriz de AÇÕES contextuais do dossiê (pura). Nunca mostra ação impossível
// para o estado. temCobrancaAtiva = existe cobrança ABERTA/PARCIAL.
export interface AcoesReceita {
  gerarCobranca: boolean; registrarPagamento: boolean; enviarCobranca: boolean
  emitirRecibo: boolean; emitirNotaFiscal: boolean; editarReceita: boolean
  cancelarReceita: boolean; cancelarCobranca: boolean; reabrir: boolean
}
export function acoesReceita(o: { status: StatusFinanceiro; temCobrancaAtiva: boolean }): AcoesReceita {
  const cancelada = o.status === 'CANCELADO' || o.status === 'ESTORNADO'
  const quitada = o.status === 'RECEBIDO'
  return {
    gerarCobranca: !cancelada && !o.temCobrancaAtiva && !quitada,
    registrarPagamento: !cancelada && o.temCobrancaAtiva,
    enviarCobranca: !cancelada && o.temCobrancaAtiva,
    emitirRecibo: quitada,
    emitirNotaFiscal: quitada || o.temCobrancaAtiva,
    editarReceita: !cancelada,
    cancelarReceita: !cancelada,
    cancelarCobranca: o.temCobrancaAtiva,
    reabrir: cancelada,
  }
}

function rotularFallback(phaseKey: string): string {
  if (!phaseKey || phaseKey === 'sem_fase') return 'Sem fase'
  return phaseKey.split(/[_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// ── filtros/busca (aplicados sobre o view model, sem novo fetch) ──
export function filtrarView(view: ReceitasView, opts: { fase?: string | null; status?: StatusFinanceiro | null; busca?: string | null }): FaseVM[] {
  const q = (opts.busca ?? '').trim().toLowerCase()
  const fases = view.fases.filter((f) => !opts.fase || f.faseKey === opts.fase)
  return fases.map((f) => {
    const requerentes = f.requerentes.map((req) => {
      const receitas = req.receitas.filter((r) => {
        if (opts.status && r.status !== opts.status) return false
        if (!q) return true
        return [req.nome, r.descricao, r.servico ?? '', r.codigo, ...r.cobrancas.map((c) => c.label)].some((s) => String(s).toLowerCase().includes(q))
      })
      return { ...req, receitas }
    }).filter((req) => req.receitas.length > 0)
    return { ...f, requerentes }
  }).filter((f) => f.requerentes.length > 0)
}
