// lib/financeiro/leitura/receita-detalhe.ts
// ============================================================================
// DETALHE DA RECEITA (Motor Financeiro V3 · Fase 3) — dados para a tela oficial
// de Receita do Financeiro V3. Fonte EXCLUSIVA: Ledger/projeções + a Receita/
// Processo de origem (metadados). Espelha 1:1 o que a tela renderiza.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { cotacoesVivas, computeCambioAging, labelServico } from './cambio-aging'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface ReceitaDetalhe {
  obrigacaoId: number
  receitaId: number | null
  natureza: 'RECEITA' | 'CUSTO'
  codigo: string | null
  descricao: string | null
  statusLabel: string // A VENCER | QUITADO | ...
  processo: { id: number | null; codigo: string | null; nome: string | null }
  responsavel: { nome: string; papel: string } | null
  servico: string | null
  formaCobranca: string | null
  moeda: string
  valorContratado: number
  recebido: number
  saldo: number
  vencimento: string | null
  // câmbio + BRL + aging (mesmo núcleo/matemática da lista de receitas)
  moedaBase: string
  valorBase: number
  cotacaoAplicada: number | null
  tipoCambio: string
  dataCotacao: string | null
  valorContratadoBrl: number
  recebidoBrl: number
  saldoBrl: number
  aVencerBrl: number
  vencidoBrl: number
  parcelas: number
  parcelasRecebidas: number
  parcelasAVencer: number
  parcelasVencidas: number
  proximoVencimento: string | null
  parcelasDetalhe: { id: number; numero: number; totalParcelas: number; vencimento: string; valorBase: number; moedaBase: string; cotacao: number | null; tipoCambio: string; valorBrl: number; recebidoBrl: number; saldoBrl: number; status: string; forma: string | null; responsavel: string; diasAtraso: number }[]
  resumoParcelas: { pagas: { qtd: number; valor: number }; aVencer: { qtd: number; valor: number }; vencidas: { qtd: number; valor: number }; canceladas: { qtd: number; valor: number }; total: number }
  inadimplenciaPct: number
  distribuicaoRequerentes: { nome: string; requerenteId: number | null; percentual: number; valor: number }[]
  responsavelFinanceiro: { nome: string; requerenteId: number | null } | null
  ultimaMovimentacao: { data: string; titulo: string; ator: string } | null
  alertas: { tipo: string; severidade: string; label: string; valor: number | null }[]
  proximasAcoes: { acao: string; label: string; descricao: string; disponivel: boolean }[]
  criadoEm: string | null
  criadoPor: string | null
  pagamentos: { id: number; data: string; valor: number; formaLabel: string | null; banco: string | null; agencia: string | null; conta: string | null; referencia: string | null; status: string }[]
  historico: { id: number; data: string; tipo: string; titulo: string; descricao: string; ator: string }[]
  resumo: { contratado: number; recebido: number; saldo: number; descontos: number; ajustes: number; liquido: number; contratadoBrl: number; recebidoBrl: number; saldoBrl: number; descontosBrl: number; ajustesBrl: number; liquidoBrl: number; jurosBrl: number; multaBrl: number }
  distribuicao: { nome: string; percentual: number; valor: number }[]
  distribuicaoTotal: { percentual: number; valor: number }
  responsaveis: { id: number; nome: string }[]
  pagadores: { nome: string; valor: number }[]
  observacao: string | null
  documentos: { id: number; nome: string; tipo: string | null; url: string; tamanho: number | null; criadoEm: string }[]
  faturaEmitida: boolean
  fatura: { id: number; descricao: string; status: string; valor: number; url: string | null } | null
  cobrancas: { id: number; status: string; valorTotal: number; moeda: string; enviadaEm: string | null }[]
  cobrancaEnviada: boolean
}

// Detalhe CONSOLIDADO: agrega um grupo de obrigações por-requerente (mesma
// Receita legada: processo|config|regra|fase|ciclo) numa única visão.
// REAPROVEITA carregarReceitaDetalhe por obrigação (não duplica câmbio/parcelas).
export interface ReceitaParticipanteDetalhe {
  obrigacaoId: number
  pessoaId: number | null
  nome: string
  papel: string
  valorBase: number
  moedaBase: string
  participacaoPct: number
  valorContratadoBrl: number
  recebidoBrl: number
  saldoBrl: number
  aVencerBrl: number
  vencidoBrl: number
  proximoVencimento: string | null
  status: string
  parcelas: number
  parcelasRecebidas: number
}

export interface ReceitaDetalheConsolidada extends ReceitaDetalhe {
  consolidado: boolean
  participantesCount: number
  metodoDistribuicao: string
  participantes: ReceitaParticipanteDetalhe[]
}

const TITULO: Record<string, string> = {
  OBRIGACAO_CRIADA: 'Receita criada', PAGAMENTO: 'Pagamento recebido', PAGAMENTO_PARCIAL: 'Pagamento recebido',
  DESCONTO: 'Desconto aplicado', JUROS: 'Juros aplicados', MULTA: 'Multa aplicada', ESTORNO: 'Estorno',
  ABERTURA: 'Abertura (data de corte)', AJUSTE: 'Ajuste',
}

export async function resolverId(ref: string): Promise<number | null> {
  if (/^\d+$/.test(ref)) {
    const porId = await prisma.obrigacaoEconomica.findUnique({ where: { id: Number(ref) }, select: { id: true } })
    if (porId) return porId.id
    const porReceita = await prisma.obrigacaoEconomica.findFirst({ where: { origemTipo: 'Receita', origemId: Number(ref) }, select: { id: true } })
    if (porReceita) return porReceita.id
  }
  const porCodigo = await prisma.obrigacaoEconomica.findFirst({ where: { codigoOperacional: decodeURIComponent(ref) }, select: { id: true } })
  return porCodigo?.id ?? null
}

export async function carregarReceitaDetalhe(ref: string): Promise<ReceitaDetalhe | null> {
  const id = await resolverId(ref)
  if (!id) return null
  const obr = await prisma.obrigacaoEconomica.findUnique({
    where: { id },
    include: {
      ocorrencias: { orderBy: { data: 'asc' }, include: { aplicacoes: true } },
      distribuicoes: { orderBy: { versao: 'desc' }, include: { participacoes: true } },
    },
  })
  if (!obr) return null
  const proj = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: id } })

  // Receita/Processo de origem (metadados) + criador
  const receita = obr.origemTipo === 'Receita' && obr.origemId
    ? await prisma.receita.findUnique({ where: { id: obr.origemId }, select: { codigo: true, descricao: true, categoria: true, data1: true, createdAt: true, processoId: true, tipoServicoId: true, moeda: true, valor: true, fxEstimado: true, fxRule: true, fxFixo: true, fxData: true, valorBrlFixo: true } }).catch(() => null)
    : null
  const tipoServico = receita?.tipoServicoId ? await prisma.tipoServico.findUnique({ where: { id: receita.tipoServicoId }, select: { nome: true } }).catch(() => null) : null
  // Requerente REAL (nome em texto) da Receita legada — fonte confiável do vínculo.
  const reqLeg = (obr.origemTipo === 'Receita' && obr.origemId)
    ? await prisma.receitaRequerente.findMany({ where: { receitaId: obr.origemId }, orderBy: { idx: 'asc' }, select: { nome: true, percentual: true, requerenteId: true } }).catch(() => [])
    : []
  const reqNomeLegado = reqLeg.find((r) => r.nome?.trim())?.nome?.trim() || null
  // Item do Cadastro Mestre (fonte do lançamento manual) — preferido sobre o legado.
  const itemMestre = obr.itemCatalogoId ? await prisma.itemCatalogo.findUnique({ where: { id: obr.itemCatalogoId }, select: { name: true } }).catch(() => null) : null
  const processo = obr.processoId ? await prisma.processo.findUnique({ where: { id: obr.processoId }, select: { id: true, codigo: true, nome: true } }) : null
  const criador = obr.criadoPorId ? await prisma.usuario.findUnique({ where: { id: obr.criadoPorId }, select: { nome: true } }).catch(() => null) : null

  // nomes de pessoas (distribuição + pagadores)
  const dist = obr.distribuicoes[0]
  const parts = (dist?.participacoes ?? []).filter((p) => p.incluido)
  const pessoaIds = new Set<number>(parts.map((p) => p.pessoaId))
  const pagadorIds = obr.ocorrencias.map((o) => o.pagadorId).filter((v): v is number => v != null)
  const pagadores = pagadorIds.length ? await prisma.pagador.findMany({ where: { id: { in: pagadorIds } } }) : []
  pagadores.forEach((p) => { if (p.pessoaId != null) pessoaIds.add(p.pessoaId) })
  const parteIds = pagadores.map((p) => p.parteExternaId).filter((v): v is number => v != null)
  const partes = parteIds.length ? await prisma.parteExterna.findMany({ where: { id: { in: parteIds } } }) : []
  const pessoas = pessoaIds.size ? await prisma.pessoa.findMany({ where: { id: { in: [...pessoaIds] } }, select: { id: true, nome: true, sobrenome: true } }) : []
  const nome = (pid: number | null) => { const p = pessoas.find((x) => x.id === pid); const n = p ? [p.nome, p.sobrenome].filter(Boolean).join(' ').trim() : ''; return n || 'Não identificado' }

  const contratado = Number(obr.valorContratado)
  const recebido = proj ? Number(proj.recebidoBruto) : 0
  const saldo = proj ? Number(proj.saldo) : contratado
  const descontos = cent(obr.ocorrencias.filter((o) => o.tipo === 'DESCONTO').reduce((s, o) => s + Number(o.valor), 0))
  const ajustes = cent(obr.ocorrencias.filter((o) => o.tipo === 'AJUSTE').reduce((s, o) => s + Number(o.valor), 0))

  const pagamentos = obr.ocorrencias.filter((o) => o.tipo === 'PAGAMENTO' || o.tipo === 'PAGAMENTO_PARCIAL').map((o) => ({
    id: o.id, data: o.data.toISOString(), valor: Number(o.valor), formaLabel: o.formaLabel, banco: o.contaBanco, agencia: o.contaAgencia, conta: o.contaNumero,
    referencia: o.referencia, status: o.status === 'PROCESSADA' ? 'Confirmado' : o.status,
  }))

  const moeda = String(obr.moedaContratual)

  // câmbio + aging + BRL — MESMO núcleo da lista de receitas (números idênticos)
  const parcelasAll = obr.origemTipo === 'Receita' && obr.origemId
    ? await prisma.parcelaFinanceira.findMany({ where: { receitaId: obr.origemId }, orderBy: { numero: 'asc' }, select: { id: true, numero: true, vencimento: true, valor: true, status: true, cambioAplicado: true, valorBrl: true, formaPagamento: true } }).catch(() => [])
    : []
  const parcelasRec = parcelasAll.filter((p) => p.status !== 'CANCELADA')
  // Documentos vinculados à Receita (resiliente durante rollout: [] se a tabela não existir)
  const documentos = obr.origemTipo === 'Receita' && obr.origemId
    ? await prisma.receitaDocumento.findMany({ where: { receitaId: obr.origemId }, orderBy: { criadoEm: 'desc' } })
        .then((rows) => rows.map((r) => ({ id: r.id, nome: r.arquivoNome, tipo: r.tipo, url: r.arquivoUrl, tamanho: r.tamanho, criadoEm: r.criadoEm.toISOString() })))
        .catch(() => [] as { id: number; nome: string; tipo: string | null; url: string; tamanho: number | null; criadoEm: string }[])
    : []
  // Fatura vinculada à Receita (Fase C) — resiliente durante rollout (null se indisponível)
  const faturaRow = obr.origemTipo === 'Receita' && obr.origemId
    ? await prisma.fatura.findFirst({ where: { receitaId: obr.origemId }, orderBy: { createdAt: 'desc' } }).catch(() => null)
    : null
  const fatura = faturaRow
    ? { id: faturaRow.id, descricao: faturaRow.descricao, status: String(faturaRow.status), valor: Number(faturaRow.valor), url: null as string | null }
    : null
  const faturaEmitida = !!fatura
  const live = await cotacoesVivas()
  const ca = computeCambioAging({
    moedaBase: moeda, valorBase: contratado, saldoLedger: saldo, recebidoLedger: recebido,
    vencimento: obr.vencimento ?? receita?.data1 ?? null,
    receita: receita ? { fxRule: receita.fxRule, fxEstimado: receita.fxEstimado, fxFixo: receita.fxFixo, fxData: receita.fxData, valorBrlFixo: receita.valorBrlFixo } : null,
    parcelas: parcelasRec, live,
  })
  const descontosBrl = moeda === 'BRL' ? descontos : cent(descontos * (ca.cotacaoAplicada ?? 1))
  const ajustesBrl = moeda === 'BRL' ? ajustes : cent(ajustes * (ca.cotacaoAplicada ?? 1))
  const juros = cent(obr.ocorrencias.filter((o) => o.tipo === 'JUROS').reduce((s, o) => s + Number(o.valor), 0))
  const multa = cent(obr.ocorrencias.filter((o) => o.tipo === 'MULTA').reduce((s, o) => s + Number(o.valor), 0))
  const jurosBrl = moeda === 'BRL' ? juros : cent(juros * (ca.cotacaoAplicada ?? 1))
  const multaBrl = moeda === 'BRL' ? multa : cent(multa * (ca.cotacaoAplicada ?? 1))
  const liquidoBrl = cent(ca.valorContratadoBrl - descontosBrl + ajustesBrl)

  // ── Parcelas (aba Cobranças) — detalhe por parcela + resumo ──
  const agoraP = Date.now()
  const cotP = ca.cotacaoAplicada
  const reqNomeP = reqNomeLegado || (parts[0] ? nome(parts[0].pessoaId) : 'Requerente não identificado')
  const FORMA_P: Record<string, string> = { PIX: 'PIX', CARTAO_CREDITO: 'Cartão de crédito', CARTAO_DEBITO: 'Cartão de débito', BOLETO: 'Boleto', TRANSFERENCIA: 'Transferência', DINHEIRO: 'Dinheiro', CHEQUE: 'Cheque', WISE: 'Wise' }
  const parcelasDetalhe = parcelasAll.map((p) => {
    const vBrl = p.valorBrl != null ? Number(p.valorBrl) : (p.cambioAplicado ? Number(p.valor) * Number(p.cambioAplicado) : (cotP ? Number(p.valor) * cotP : Number(p.valor)))
    const pago = p.status === 'RECEBIDA' || p.status === 'PAGA'
    const cancel = p.status === 'CANCELADA'
    const overdue = !pago && !cancel && new Date(p.vencimento).getTime() < agoraP
    const status = cancel ? 'CANCELADA' : pago ? 'PAGA' : overdue ? 'VENCIDA' : 'A_VENCER'
    const recebidoBrlP = pago ? cent(vBrl) : 0
    return {
      id: p.id, numero: p.numero, totalParcelas: parcelasAll.length, vencimento: new Date(p.vencimento).toISOString(),
      valorBase: cent(Number(p.valor)), moedaBase: moeda, cotacao: cotP, tipoCambio: ca.tipoCambio,
      valorBrl: cent(vBrl), recebidoBrl: recebidoBrlP, saldoBrl: cancel ? 0 : cent(vBrl - recebidoBrlP),
      status, forma: p.formaPagamento ? (FORMA_P[p.formaPagamento] ?? String(p.formaPagamento)) : null,
      responsavel: reqNomeP, diasAtraso: overdue ? Math.floor((agoraP - new Date(p.vencimento).getTime()) / 86400000) : 0,
    }
  })
  const grpP = (st: string) => parcelasDetalhe.filter((p) => p.status === st)
  const resumoParcelas = {
    pagas: { qtd: grpP('PAGA').length, valor: cent(grpP('PAGA').reduce((s, p) => s + p.valorBrl, 0)) },
    aVencer: { qtd: grpP('A_VENCER').length, valor: cent(grpP('A_VENCER').reduce((s, p) => s + p.saldoBrl, 0)) },
    vencidas: { qtd: grpP('VENCIDA').length, valor: cent(grpP('VENCIDA').reduce((s, p) => s + p.saldoBrl, 0)) },
    canceladas: { qtd: grpP('CANCELADA').length, valor: 0 },
    total: parcelasAll.length,
  }
  const baseInad = parcelasAll.length - resumoParcelas.canceladas.qtd
  const inadimplenciaPct = baseInad > 0 ? Math.round((resumoParcelas.vencidas.qtd / baseInad) * 100) : 0

  const historico = obr.ocorrencias.map((o) => {
    const pg = o.pagadorId != null ? pagadores.find((p) => p.id === o.pagadorId) : undefined
    const quem = pg?.parteExternaId != null ? (partes.find((x) => x.id === pg.parteExternaId)?.nome ?? 'Externo') : (pg?.pessoaId != null ? nome(pg.pessoaId) : (criador?.nome ?? 'Usuário'))
    // valor na moeda-base + BRL entre parênteses (ex.: "€ 2.800,00 (R$ 16.800,00)")
    const comBrl = (v: number) => `${fmtMoeda(v, moeda)}${moeda !== 'BRL' && ca.cotacaoAplicada ? ` (${fmtMoeda(cent(v * ca.cotacaoAplicada), 'BRL')})` : ''}`
    let descricao = ''
    if (o.tipo === 'OBRIGACAO_CRIADA') descricao = `Receita criada no valor de ${comBrl(Number(o.valor))}.`
    else if (o.tipo === 'PAGAMENTO' || o.tipo === 'PAGAMENTO_PARCIAL') descricao = `Pagamento via ${o.formaLabel ?? 'recurso'} no valor de ${comBrl(Number(o.valor))}.`
    else descricao = `${TITULO[o.tipo] ?? o.tipo} — ${comBrl(Number(o.valor))}.`
    return { id: o.id, data: o.data.toISOString(), tipo: o.tipo, titulo: TITULO[o.tipo] ?? o.tipo, descricao, ator: quem }
  })

  const totalCota = cent(parts.reduce((s, p) => s + Number(p.valor ?? 0), 0)) || contratado
  const distribuicao = parts.map((p) => ({ nome: nome(p.pessoaId), percentual: totalCota ? cent((Number(p.valor ?? 0) / totalCota) * 100) : 0, valor: Number(p.valor ?? 0) }))

  const responsaveisSet = distribuicao.map((d, i) => ({ id: parts[i]?.pessoaId ?? i, nome: d.nome }))
  const pagadoresAgg = new Map<string, number>()
  for (const o of obr.ocorrencias) {
    if (o.tipo !== 'PAGAMENTO' && o.tipo !== 'PAGAMENTO_PARCIAL') continue
    const pg = o.pagadorId != null ? pagadores.find((p) => p.id === o.pagadorId) : undefined
    const quem = pg?.parteExternaId != null ? (partes.find((x) => x.id === pg.parteExternaId)?.nome ?? 'Externo') : (pg?.pessoaId != null ? nome(pg.pessoaId) : 'Empresa')
    pagadoresAgg.set(quem, cent((pagadoresAgg.get(quem) ?? 0) + Number(o.valor)))
  }

  const statusLabel = ca.statusLabel
  const primeiro = parts[0]

  // ── blocos do detalhe rico (#80), DERIVADOS (sem migration) ──
  const ultimaMovimentacao = historico[0] ? { data: historico[0].data, titulo: historico[0].titulo, ator: historico[0].ator } : null
  const distribuicaoRequerentes = reqLeg.map((r) => ({ nome: r.nome, requerenteId: r.requerenteId ?? null, percentual: Number(r.percentual ?? 0), valor: cent((Number(r.percentual ?? 0) / 100) * ca.valorContratadoBrl) }))
  const responsavelFinanceiro = reqLeg[0] ? { nome: reqLeg[0].nome, requerenteId: reqLeg[0].requerenteId ?? null } : (primeiro ? { nome: nome(primeiro.pessoaId), requerenteId: null } : null)
  const semPagamento = pagamentos.length === 0
  const alertas: { tipo: string; severidade: 'crit' | 'warn' | 'info'; label: string; valor: number | null }[] = []
  if (resumoParcelas.vencidas.qtd > 0) alertas.push({ tipo: 'PARCELA_VENCIDA', severidade: 'crit', label: `${resumoParcelas.vencidas.qtd} parcela(s) vencida(s)`, valor: resumoParcelas.vencidas.valor })
  if (!faturaEmitida) alertas.push({ tipo: 'FATURA_NAO_EMITIDA', severidade: 'warn', label: 'Fatura não emitida', valor: null })
  if (semPagamento) alertas.push({ tipo: 'SEM_PAGAMENTO', severidade: 'info', label: 'Nenhum pagamento registrado', valor: null })
  // Cobranças da Receita (Fase D) — resiliente durante rollout ([] se indisponível)
  const cobrancasRows = obr.origemTipo === 'Receita' && obr.origemId
    ? await prisma.cobranca.findMany({ where: { receitaId: obr.origemId }, orderBy: { criadoEm: 'desc' } }).catch(() => [])
    : []
  const cobrancas = cobrancasRows.map((c) => ({ id: c.id, status: String(c.status), valorTotal: Number(c.valorTotal), moeda: String(c.moeda), enviadaEm: c.enviadaEm?.toISOString() ?? null }))
  const cobrancaEnviada = cobrancas.some((c) => c.enviadaEm != null)

  const proximasAcoes = [
    ...(resumoParcelas.vencidas.qtd > 0 ? [{ acao: 'COBRAR_VENCIDA', label: `Existe ${resumoParcelas.vencidas.qtd} parcela vencida`, descricao: `Parcela de ${fmtMoeda(resumoParcelas.vencidas.valor, 'BRL')} vencida.`, disponivel: true }] : []),
    { acao: 'REGISTRAR_PAGAMENTO', label: 'Registrar pagamento', descricao: semPagamento ? 'Nenhum pagamento registrado ainda.' : 'Registrar novo pagamento recebido.', disponivel: true },
    { acao: 'EMITIR_FATURA', label: 'Emitir fatura', descricao: 'Fatura ainda não emitida para esta receita.', disponivel: true },
    { acao: 'ENVIAR_COBRANCA', label: 'Enviar cobrança', descricao: cobrancaEnviada ? 'Cobrança já enviada ao cliente.' : 'Cobrança ainda não enviada ao cliente.', disponivel: true },
  ]

  return {
    obrigacaoId: id, receitaId: obr.origemTipo === 'Receita' ? (obr.origemId ?? null) : null,
    natureza: obr.direcao === 'A_PAGAR' ? 'CUSTO' : 'RECEITA',
    codigo: obr.codigoOperacional, descricao: itemMestre?.name ?? receita?.descricao ?? obr.observacoes ?? null, statusLabel,
    processo: { id: processo?.id ?? null, codigo: processo?.codigo ?? null, nome: processo?.nome ?? null },
    responsavel: reqNomeLegado ? { nome: reqNomeLegado, papel: 'Principal' } : (primeiro ? { nome: nome(primeiro.pessoaId), papel: 'Principal' } : null),
    servico: itemMestre?.name ?? tipoServico?.nome ?? labelServico(receita?.categoria ? String(receita.categoria) : null),
    formaCobranca: 'À vista',
    moeda,
    valorContratado: contratado, recebido, saldo,
    vencimento: (obr.vencimento ?? receita?.data1)?.toISOString() ?? null,
    moedaBase: ca.moedaBase, valorBase: ca.valorBase, cotacaoAplicada: ca.cotacaoAplicada, tipoCambio: ca.tipoCambio, dataCotacao: ca.dataCotacao,
    valorContratadoBrl: ca.valorContratadoBrl, recebidoBrl: ca.recebidoBrl, saldoBrl: ca.saldoBrl, aVencerBrl: ca.aVencerBrl, vencidoBrl: ca.vencidoBrl,
    parcelas: ca.parcelas, parcelasRecebidas: ca.parcelasRecebidas, parcelasAVencer: ca.parcelasAVencer, parcelasVencidas: ca.parcelasVencidas, proximoVencimento: ca.proximoVencimento,
    parcelasDetalhe, resumoParcelas, inadimplenciaPct,
    distribuicaoRequerentes, responsavelFinanceiro, ultimaMovimentacao, alertas, proximasAcoes,
    criadoEm: obr.criadoEm.toISOString(), criadoPor: criador?.nome ?? 'Usuário',
    pagamentos, historico,
    resumo: { contratado, recebido, saldo, descontos, ajustes, liquido: cent(contratado - descontos + ajustes), contratadoBrl: ca.valorContratadoBrl, recebidoBrl: ca.recebidoBrl, saldoBrl: ca.saldoBrl, descontosBrl, ajustesBrl, liquidoBrl, jurosBrl, multaBrl },
    distribuicao, distribuicaoTotal: { percentual: cent(distribuicao.reduce((s, d) => s + d.percentual, 0)), valor: cent(distribuicao.reduce((s, d) => s + d.valor, 0)) },
    responsaveis: responsaveisSet, pagadores: [...pagadoresAgg.entries()].map(([nome, valor]) => ({ nome, valor })),
    observacao: obr.observacoes ?? null,
    documentos,
    faturaEmitida, fatura,
    cobrancas, cobrancaEnviada,
  }
}

function fmtMoeda(v: number, moeda = 'BRL') { return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: moeda }) }

// remove o sufixo "— Primeiro requerente — {nome}" / "— Requerente adicional — {nome}" → rótulo base.
// (réplica do baseLabel de receitas-lista.ts — dado de exibição)
function baseLabelDetalhe(desc: string | null): string | null {
  if (!desc) return null
  const cut = desc.replace(/\s*[—–-]\s*(Primeiro requerente|Requerente adicional|Requerente principal)\b.*$/i, '').trim()
  return cut || null
}

// ============================================================================
// DETALHE CONSOLIDADO — agrega o grupo por-requerente numa única Receita.
// ============================================================================
export async function carregarReceitaConsolidada(ref: string): Promise<ReceitaDetalheConsolidada | null> {
  const id = await resolverId(ref)
  if (!id) return null

  // Obrigação representante (mínima) — origem/processo p/ montar o grupo.
  const base = await prisma.obrigacaoEconomica.findUnique({
    where: { id },
    select: { id: true, origemTipo: true, origemId: true, processoId: true },
  })
  if (!base) return null

  // ── Descobrir o GRUPO de obrigações (mesma Receita legada consolidada) ──
  let groupIds: number[] = [id]
  if (base.origemTipo === 'Receita' && base.origemId != null) {
    const rec = await prisma.receita.findUnique({
      where: { id: base.origemId },
      select: { configFinanceiraId: true, regraFinanceiraId: true, phaseKey: true, phaseCycle: true },
    }).catch(() => null)
    if (rec && rec.configFinanceiraId != null) {
      // Receitas irmãs: mesma (processo, config, regra, fase, ciclo). null casa com null.
      const irmas = await prisma.receita.findMany({
        where: {
          processoId: base.processoId ?? undefined,
          configFinanceiraId: rec.configFinanceiraId,
          regraFinanceiraId: rec.regraFinanceiraId,
          phaseKey: rec.phaseKey,
          phaseCycle: rec.phaseCycle,
        },
        select: { id: true },
      }).catch(() => [] as { id: number }[])
      const receitaIds = irmas.map((r) => r.id)
      if (receitaIds.length) {
        const irmasObr = await prisma.obrigacaoEconomica.findMany({
          where: { origemTipo: 'Receita', origemId: { in: receitaIds }, status: { not: 'CANCELADO' } },
          select: { id: true },
        }).catch(() => [] as { id: number }[])
        const set = new Set<number>(irmasObr.map((o) => o.id))
        set.add(id)
        groupIds = [...set]
      }
    }
  }

  // ── Carregar cada obrigação REUSANDO o loader por-obrigação ──
  const rawSlices = await Promise.all(groupIds.map((oid) => carregarReceitaDetalhe(String(oid))))
  const slices = rawSlices.filter((s): s is ReceitaDetalhe => s != null)
  if (!slices.length) return null

  // Representante = a própria obrigação do ref (fallback: 'Primeiro'/'Principal', senão a 1ª).
  const rep = slices.find((s) => s.obrigacaoId === id)
    ?? slices.find((s) => s.responsavel?.papel === 'Primeiro' || s.responsavel?.papel === 'Principal')
    ?? slices[0]

  // Somatórios BRL (cent-round).
  const sumBrl = (f: (s: ReceitaDetalhe) => number) => cent(slices.reduce((acc, s) => acc + (f(s) || 0), 0))
  const valorContratadoBrl = sumBrl((s) => s.valorContratadoBrl)
  const recebidoBrl = sumBrl((s) => s.recebidoBrl)
  const saldoBrl = sumBrl((s) => s.saldoBrl)
  const aVencerBrl = sumBrl((s) => s.aVencerBrl)
  const vencidoBrl = sumBrl((s) => s.vencidoBrl)

  // valorBase só soma se todas as moedas-base coincidem; senão mantém o representante.
  const moedasBase = [...new Set(slices.map((s) => s.moedaBase))]
  const valorBase = moedasBase.length === 1 ? cent(slices.reduce((a, s) => a + (s.valorBase || 0), 0)) : rep.valorBase

  const parcelas = slices.reduce((a, s) => a + s.parcelas, 0)
  const parcelasRecebidas = slices.reduce((a, s) => a + s.parcelasRecebidas, 0)
  const parcelasAVencer = slices.reduce((a, s) => a + s.parcelasAVencer, 0)
  const parcelasVencidas = slices.reduce((a, s) => a + s.parcelasVencidas, 0)

  const proximosVenc = slices.map((s) => s.proximoVencimento).filter((v): v is string => !!v).sort()
  const proximoVencimento = proximosVenc[0] ?? null

  // Resumo (soma de todos os campos numéricos — inclui *Brl).
  const sumResumo = (f: (r: ReceitaDetalhe['resumo']) => number) => cent(slices.reduce((a, s) => a + (f(s.resumo) || 0), 0))
  const resumo: ReceitaDetalhe['resumo'] = {
    contratado: sumResumo((r) => r.contratado), recebido: sumResumo((r) => r.recebido), saldo: sumResumo((r) => r.saldo),
    descontos: sumResumo((r) => r.descontos), ajustes: sumResumo((r) => r.ajustes), liquido: sumResumo((r) => r.liquido),
    contratadoBrl: sumResumo((r) => r.contratadoBrl), recebidoBrl: sumResumo((r) => r.recebidoBrl), saldoBrl: sumResumo((r) => r.saldoBrl),
    descontosBrl: sumResumo((r) => r.descontosBrl), ajustesBrl: sumResumo((r) => r.ajustesBrl), liquidoBrl: sumResumo((r) => r.liquidoBrl),
    jurosBrl: sumResumo((r) => r.jurosBrl), multaBrl: sumResumo((r) => r.multaBrl),
  }

  // Resumo de parcelas (soma qtd+valor; total = Σ).
  const sumRP = (f: (r: ReceitaDetalhe['resumoParcelas']) => number) => slices.reduce((a, s) => a + (f(s.resumoParcelas) || 0), 0)
  const resumoParcelas: ReceitaDetalhe['resumoParcelas'] = {
    pagas: { qtd: sumRP((r) => r.pagas.qtd), valor: cent(sumRP((r) => r.pagas.valor)) },
    aVencer: { qtd: sumRP((r) => r.aVencer.qtd), valor: cent(sumRP((r) => r.aVencer.valor)) },
    vencidas: { qtd: sumRP((r) => r.vencidas.qtd), valor: cent(sumRP((r) => r.vencidas.valor)) },
    canceladas: { qtd: sumRP((r) => r.canceladas.qtd), valor: cent(sumRP((r) => r.canceladas.valor)) },
    total: sumRP((r) => r.total),
  }
  const baseInad = resumoParcelas.total - resumoParcelas.canceladas.qtd
  const inadimplenciaPct = baseInad > 0 ? Math.round((resumoParcelas.vencidas.qtd / baseInad) * 100) : 0

  // Campos-array concatenados (dado de exibição).
  const parcelasDetalhe = slices.flatMap((s) => s.parcelasDetalhe)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
  const pagamentos = slices.flatMap((s) => s.pagamentos)
  const historico = slices.flatMap((s) => s.historico).sort((a, b) => b.data.localeCompare(a.data))
  const documentos = slices.flatMap((s) => s.documentos)
  const cobrancas = slices.flatMap((s) => s.cobrancas)

  // Status consolidado.
  const statusLabel = vencidoBrl > 0.005
    ? 'VENCIDO'
    : saldoBrl <= 0.005
      ? 'QUITADO'
      : recebidoBrl > 0.005
        ? 'PARCIAL'
        : 'A VENCER'

  // Participantes (um por slice) + participacaoPct (soma ~100).
  const participantes: ReceitaParticipanteDetalhe[] = slices.map((s) => ({
    obrigacaoId: s.obrigacaoId,
    pessoaId: s.responsavelFinanceiro?.requerenteId ?? null,
    nome: s.responsavel?.nome ?? 'Participante não identificado',
    papel: s.responsavel?.papel ?? 'Participante',
    valorBase: s.valorBase,
    moedaBase: s.moedaBase,
    participacaoPct: valorContratadoBrl > 0 ? cent((s.valorContratadoBrl / valorContratadoBrl) * 100) : 0,
    valorContratadoBrl: s.valorContratadoBrl,
    recebidoBrl: s.recebidoBrl,
    saldoBrl: s.saldoBrl,
    aVencerBrl: s.aVencerBrl,
    vencidoBrl: s.vencidoBrl,
    proximoVencimento: s.proximoVencimento,
    status: s.statusLabel,
    parcelas: s.parcelas,
    parcelasRecebidas: s.parcelasRecebidas,
  }))
  // Ajuste do resto de arredondamento no maior, p/ somar exatamente 100.
  if (participantes.length && valorContratadoBrl > 0) {
    const somaPct = cent(participantes.reduce((a, p) => a + p.participacaoPct, 0))
    const resto = cent(100 - somaPct)
    if (Math.abs(resto) >= 0.01) {
      let maiorIdx = 0
      for (let i = 1; i < participantes.length; i++) {
        if (participantes[i].valorContratadoBrl > participantes[maiorIdx].valorContratadoBrl) maiorIdx = i
      }
      participantes[maiorIdx].participacaoPct = cent(participantes[maiorIdx].participacaoPct + resto)
    }
  }

  return {
    ...rep,
    descricao: baseLabelDetalhe(rep.descricao) ?? rep.servico ?? rep.descricao,
    statusLabel,
    responsavel: null,
    valorBase,
    valorContratadoBrl, recebidoBrl, saldoBrl, aVencerBrl, vencidoBrl,
    parcelas, parcelasRecebidas, parcelasAVencer, parcelasVencidas, proximoVencimento,
    parcelasDetalhe, resumoParcelas, inadimplenciaPct,
    pagamentos, historico, documentos, cobrancas,
    resumo,
    consolidado: slices.length > 1,
    participantesCount: slices.length,
    metodoDistribuicao: 'Distribuição personalizada',
    participantes,
  }
}
