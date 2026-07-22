// GET /api/financeiro/receitas/[id]/dossie?processoId=N
// Agregador do DOSSIÊ da Receita (página central). Uma composição, sem N+1:
// receita + cobranças/parcelas/eventos + catálogos + auditoria. Valida o vínculo
// receita↔processo (bloqueia acesso cruzado). Reusa o view model PURO para
// totais/status/cobrança; o backend calcula tudo (frontend nunca decide regra).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { montarReceitasView, acoesReceita, type ReceitaRow, type Catalogos, type StatusFinanceiro } from '@/lib/financeiro/receitas-processo-view'
import { historicoDe } from '@/lib/gerenciamento/auditoria'

const n = (v: unknown) => (v == null ? null : Number(v))

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const id = Number((await params).id)
  const processoIdParam = Number(new URL(req.url).searchParams.get('processoId')) || null

  const receita = await prisma.receita.findUnique({
    where: { id },
    include: {
      pessoa: { select: { id: true, nome: true, sobrenome: true, createdAt: true } },
      tipoServico: { select: { id: true, nome: true } },
      processo: { select: { id: true, nome: true, codigo: true } },
      documento: { select: { id: true, tipo: true } },
      eventos: { orderBy: { createdAt: 'desc' }, include: { usuario: { select: { nome: true } } } },
      cobrancas: {
        orderBy: { criadoEm: 'asc' },
        include: {
          parcelas: { orderBy: { numero: 'asc' } },
          eventos: { select: { tipo: true, valor: true } },
        },
      },
    },
  })
  if (!receita) return NextResponse.json({ error: 'Receita não encontrada' }, { status: 404 })
  // impede acesso a receita de outro processo
  if (processoIdParam && receita.processoId !== processoIdParam) {
    return NextResponse.json({ error: 'Receita não pertence a este processo' }, { status: 403 })
  }

  const [fase, formas, condicoes, carteiras, configFin, ordemPessoas, historico] = await Promise.all([
    receita.phaseKey ? prisma.catalogoFase.findUnique({ where: { phaseKey: receita.phaseKey }, select: { label: true } }) : Promise.resolve(null),
    prisma.formaPagamentoCadastro.findMany({ select: { id: true, name: true } }),
    prisma.condicaoPagamento.findMany({ select: { id: true, name: true } }),
    prisma.carteiraRecebimento.findMany({ select: { id: true, nome: true } }),
    receita.configFinanceiraId ? prisma.produtoFinanceiro.findUnique({ where: { id: receita.configFinanceiraId }, select: { nome: true } }).catch(() => null) : Promise.resolve(null),
    prisma.receita.findMany({ where: { processoId: receita.processoId, personId: { not: null } }, select: { personId: true, pessoa: { select: { createdAt: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    historicoDe('Receita', id).catch(() => []),
  ])

  const cat: Catalogos = {
    fases: fase && receita.phaseKey ? { [receita.phaseKey]: fase.label } : {},
    formas: Object.fromEntries(formas.map((f) => [f.id, f.name])),
    condicoes: Object.fromEntries(condicoes.map((c) => [c.id, c.name])),
    carteiras: Object.fromEntries(carteiras.map((c) => [c.id, c.nome])),
  }
  const row = JSON.parse(JSON.stringify(receita)) as ReceitaRow
  const view = montarReceitasView([row], cat, Date.now())
  const rvm = view.fases[0]?.requerentes[0]?.receitas[0]
  if (!rvm) return NextResponse.json({ error: 'Falha ao compor a receita' }, { status: 500 })
  const cob = rvm.cobrancas[0] ?? null

  // papel do requerente no PROCESSO (principal = primeira pessoa por createdAt/id)
  const ordem = Array.from(new Set(ordemPessoas.map((r) => r.personId).filter((x): x is number => x != null)))
  const papel = receita.personId != null && ordem[0] === receita.personId ? 'principal' : (receita.personId != null ? 'adicional' : null)

  // criado por: usuário do evento de CRIAÇÃO, senão o motor
  const criacao = receita.eventos.find((e) => e.tipo === 'CRIACAO')
  const criadoPor = criacao?.usuario?.nome ?? (receita.origem === 'motor' ? 'Motor financeiro' : '—')

  // comprovantes existentes (anexos reais = ParcelaFinanceira.comprovante*)
  const anexos = receita.cobrancas.flatMap((c) => c.parcelas).filter((p) => p.comprovanteUrl).map((p) => ({ parcelaId: p.id, numero: p.numero, url: p.comprovanteUrl, nome: p.comprovanteNome }))

  const temCobrancaAtiva = receita.cobrancas.some((c) => ['ABERTA', 'PARCIAL'].includes(c.status))
  const cancelada = rvm.status === 'CANCELADO' || rvm.status === 'ESTORNADO'
  const cobRuntime = receita.cobrancas.find((c) => ['ABERTA', 'PARCIAL', 'QUITADA'].includes(c.status)) ?? null
  const acoes = acoesReceita({ status: rvm.status, temCobrancaAtiva })

  // alertas contextuais (só quando existem)
  const alertas: { tipo: string; nivel: 'info' | 'warn' | 'erro'; texto: string }[] = []
  if (!rvm.temCobranca && !cancelada) alertas.push({ tipo: 'SEM_COBRANCA', nivel: 'info', texto: 'Receita sem cobrança — gere uma cobrança para operacionalizar.' })
  if (rvm.status === 'VENCIDO') alertas.push({ tipo: 'VENCIDO', nivel: 'erro', texto: 'Há parcela vencida em aberto.' })
  if (rvm.status === 'PARCIAL') alertas.push({ tipo: 'PARCIAL', nivel: 'warn', texto: 'Pagamento parcial registrado.' })
  if (cobRuntime && cobRuntime.moedaOrigem && String(cobRuntime.moeda) !== 'BRL') {
    alertas.push({ tipo: 'COTACAO', nivel: 'info', texto: cobRuntime.congeladaEm ? 'Cotação congelada na confirmação.' : 'Cotação estimada.' })
  }

  const dados = {
    servico: receita.tipoServico?.nome ?? '—',
    regraFinanceira: configFin?.nome ?? receita.tipoServico?.nome ?? '—',
    fase: rvm.faseLabel,
    requerente: receita.pessoa ? `${receita.pessoa.nome}${receita.pessoa.sobrenome ? ` ${receita.pessoa.sobrenome}` : ''}` : '—',
    papel,
    moeda: String(receita.moeda),
    cotacao: n(receita.fxEstimado), cotacaoData: receita.fxData,
    centroCusto: null, // sem FK no schema — dado ausente
    criadoEm: receita.createdAt, criadoPor,
    observacoes: receita.observacoes ?? null,
    origemReceita: receita.origem,
    processo: receita.processo ? { id: receita.processo.id, nome: receita.processo.nome, codigo: receita.processo.codigo } : null,
    documento: receita.documento ? { id: receita.documento.id, tipo: receita.documento.tipo } : null,
  }

  // cobrança expandida (runtime congelado, quando houver)
  const cobrancaBloco = cob && cobRuntime ? {
    ...cob,
    moeda: String(cobRuntime.moeda),
    politicaTaxas: cobRuntime.politicaTaxas, valorBase: n(cobRuntime.valorBase), valorTaxa: n(cobRuntime.valorTaxa),
    valorRepassado: n(cobRuntime.valorRepassado), valorAbsorvido: n(cobRuntime.valorAbsorvido), valorLiquido: n(cobRuntime.valorLiquido),
    moedaOrigem: cobRuntime.moedaOrigem, cotacao: n(cobRuntime.cotacao), cotacaoFonte: cobRuntime.cotacaoFonte, congeladaEm: cobRuntime.congeladaEm,
    memoria: (cobRuntime.memoriaCalculo as any)?.memoria ?? null,
  } : cob

  const timeline = receita.eventos.map((e) => ({ tipo: e.tipo, descricao: e.descricao, valor: n(e.valor), em: e.createdAt, usuario: e.usuario?.nome ?? (receita.origem === 'motor' ? 'Sistema' : null) }))

  return NextResponse.json({
    receita: {
      id: receita.id, codigo: receita.codigo, descricao: rvm.descricao, status: rvm.status as StatusFinanceiro,
      valorContratual: rvm.valorContratual, recebido: rvm.recebido, saldo: rvm.saldo,
      pctRecebido: rvm.valorContratual > 0 ? Math.round((rvm.recebido / rvm.valorContratual) * 1000) / 10 : 0,
      proximoVencimento: rvm.vencimento, moeda: rvm.moeda,
    },
    dados, cobranca: cobrancaBloco, anexos, timeline, historico, acoes, alertas,
    relacionamentos: {
      processo: dados.processo, fase: rvm.faseLabel, requerente: dados.requerente,
      servico: dados.servico, regraFinanceira: dados.regraFinanceira, documento: dados.documento,
    },
  })
}
