// lib/financeiro/acoes/duplicar-receita.ts
// ============================================================================
// DUPLICAR RECEITA (Motor Financeiro V3). Cria uma NOVA Receita/Obrigação a partir
// de uma existente — mesmo item/valor/moeda/câmbio/distribuição/participantes —
// porém ZERADA: sem copiar pagamentos, cobranças ou Ledger da origem. A nova nasce
// ATIVA, com vencimento null (ou +30d se informado). Reusa o motor V3
// (criarObrigacaoEconomicaComLedger) e o gerador central de códigos.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { resolverId } from '@/lib/financeiro/leitura/receita-detalhe'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { gerarCodigoReceita, gerarCodigoCusto } from '@/lib/financeiro/codigos'
import { AcaoReceitaError } from './recibo'
import type { Natureza } from '@/lib/financeiro/dominio/obrigacao-economica'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface DuplicarOpts { usuarioId?: number | null; vencimentoEmDias?: number | null }
export interface DuplicarResultado { obrigacaoId: number; receitaId: number | null; codigo: string }

export async function duplicarReceita(ref: string, opts: DuplicarOpts = {}): Promise<DuplicarResultado> {
  const origemObrId = await resolverId(ref)
  if (!origemObrId) throw new AcaoReceitaError('Receita não encontrada.', 404)

  const origem = await prisma.obrigacaoEconomica.findUnique({
    where: { id: origemObrId },
    select: {
      id: true, natureza: true, moedaContratual: true, valorContratado: true, processoId: true, faseId: true,
      clienteId: true, fornecedorId: true, itemCatalogoId: true, regraFinanceiraId: true,
      origemTipo: true, origemId: true, observacoes: true,
      distribuicoes: { orderBy: { versao: 'desc' }, take: 1, include: { participacoes: true } },
    },
  })
  if (!origem) throw new AcaoReceitaError('Receita não encontrada.', 404)

  const criadoPorId = opts.usuarioId ?? null
  const valor = cent(Number(origem.valorContratado))
  const moeda = String(origem.moedaContratual)
  const vencimento = opts.vencimentoEmDias != null ? new Date(Date.now() + opts.vencimentoEmDias * 86400000) : null
  // Custo e Receita continuam domínios distintos — código com o prefixo correto.
  const isCusto = origem.natureza === 'CUSTO'
  const codigo = isCusto ? await gerarCodigoCusto() : await gerarCodigoReceita()

  // ── Receita de origem (para copiar snapshot de preço/câmbio/requerentes) ──
  const recOrigem = origem.origemTipo === 'Receita' && origem.origemId != null
    ? await prisma.receita.findUnique({
        where: { id: origem.origemId },
        select: {
          categoria: true, descricao: true, moeda: true, fxEstimado: true, fxRule: true, fxFixo: true, fxData: true, valorBrlFixo: true,
          periodicidade: true, naturezaPreco: true, configFinanceiraId: true, regraFinanceiraId: true, phaseKey: true, phaseCycle: true,
          tipoServicoId: true, origem: true, contextoAplicado: true, valorUnitario: true, quantidade: true,
          requerentes: { orderBy: { idx: 'asc' }, select: { idx: true, nome: true, requerenteId: true, percentual: true, statusFamiliar: true } },
        },
      }).catch(() => null)
    : null

  let novaReceitaId: number | null = null

  if (recOrigem) {
    const novaRec = await prisma.receita.create({ data: {
      codigo, processoId: origem.processoId ?? 0,
      categoria: recOrigem.categoria, descricao: `${recOrigem.descricao} (cópia)`.slice(0, 300),
      moeda: recOrigem.moeda, valor, valorUnitario: recOrigem.valorUnitario ?? valor, quantidade: recOrigem.quantidade ?? 1, valorTotalCongelado: valor,
      fxEstimado: recOrigem.fxEstimado, fxRule: recOrigem.fxRule, fxFixo: recOrigem.fxFixo ?? undefined, fxData: recOrigem.fxData ?? undefined, valorBrlFixo: recOrigem.valorBrlFixo ?? undefined,
      nParcelas: 1, data1: new Date(), periodicidade: recOrigem.periodicidade ?? 'Mensal', status: 'ATIVA', origem: recOrigem.origem ?? 'manual',
      origemLancamento: 'PROCESSO', naturezaLancamento: 'RECEITA', naturezaPreco: recOrigem.naturezaPreco ?? undefined,
      configFinanceiraId: recOrigem.configFinanceiraId ?? null, regraFinanceiraId: recOrigem.regraFinanceiraId ?? null,
      phaseKey: recOrigem.phaseKey ?? null, phaseCycle: recOrigem.phaseCycle ?? null, tipoServicoId: recOrigem.tipoServicoId ?? undefined,
      requerentes: recOrigem.requerentes.length ? { create: recOrigem.requerentes.map((r) => ({ idx: r.idx, nome: r.nome, requerenteId: r.requerenteId ?? undefined, percentual: r.percentual, statusFamiliar: r.statusFamiliar ?? undefined })) } : undefined,
    } })
    novaReceitaId = novaRec.id
  }

  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({
    natureza: (origem.natureza as Natureza) ?? 'RECEITA',
    valorContratado: valor, moedaContratual: moeda, codigoOperacional: codigo,
    processoId: origem.processoId ?? null, faseId: origem.faseId ?? null, clienteId: origem.clienteId ?? null,
    fornecedorId: origem.fornecedorId ?? null, itemCatalogoId: origem.itemCatalogoId ?? null,
    regraFinanceiraId: origem.regraFinanceiraId ?? null, vencimento,
    observacoes: novaReceitaId == null ? `${origem.observacoes ?? (isCusto ? 'Custo' : 'Receita')} (cópia)`.slice(0, 300) : null,
    origemTipo: novaReceitaId != null ? 'Receita' : 'nativo', origemId: novaReceitaId,
    criadoPorId,
  })

  // ── copia a distribuição econômica (participantes/cotas), sem pagamentos ──
  const distOrigem = origem.distribuicoes[0]
  if (distOrigem && distOrigem.participacoes.length) {
    const dist = await prisma.distribuicaoEconomica.create({ data: { obrigacaoId, modo: distOrigem.modo, versao: 1 } })
    await prisma.participacaoEconomica.createMany({ data: distOrigem.participacoes.map((p, i) => ({
      distribuicaoId: dist.id, pessoaId: p.pessoaId, incluido: p.incluido,
      percentual: p.percentual ?? null, valor: p.valor ?? null, moeda: p.moeda, ordem: p.ordem ?? i,
    })) })
  }

  if (novaReceitaId != null) {
    await prisma.eventoFinanceiro.create({ data: { receitaId: novaReceitaId, tipo: 'CRIACAO', usuarioId: criadoPorId, descricao: `Receita duplicada a partir de ${ref} (${codigo}). Sem pagamentos/cobranças da origem.`.slice(0, 500), dados: { acao: 'DUPLICAR', origemObrigacaoId: origemObrId, obrigacaoId } } }).catch(() => {})
  } else {
    // Custo (sem Receita): auditoria na fonte que a timeline financeira consome.
    await prisma.logAuditoria.create({ data: { acao: 'DUPLICAR', entidade: 'ObrigacaoEconomica', entidadeId: obrigacaoId, descricao: `Custo duplicado a partir de ${ref} (${codigo}). Sem pagamentos da origem.`.slice(0, 1000), detalhes: { acao: 'DUPLICAR', origemObrigacaoId: origemObrId, codigo } as never, usuarioId: criadoPorId } }).catch(() => {})
  }

  return { obrigacaoId, receitaId: novaReceitaId, codigo }
}
