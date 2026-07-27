// lib/financeiro/acoes/recibo.ts
// ============================================================================
// AÇÃO "Gerar Recibo" (Mais Ações · detalhe da Receita, Financeiro V3).
// REGRA: só emite recibo se houver ao menos um pagamento CONFIRMADO na Receita.
// Persiste um Recibo real (model Recibo + numeração via CounterRecibo), somando
// os pagamentos confirmados. Idempotente por (processo, código da Receita):
// se já existe recibo dessa Receita, retorna o existente sem duplicar.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { carregarContextoReceita, registrarEventoReceita, type ContextoReceita } from './receita-contexto'

export class AcaoReceitaError extends Error {
  constructor(message: string, public status: number, public motivos?: string[]) {
    super(message)
    this.name = 'AcaoReceitaError'
  }
}

// Marcador estável na descrição p/ dedupe (não há receitaId no model Recibo).
const marcador = (codigo: string | null, obrigacaoId: number) => `[REC:${codigo ?? `OBR-${obrigacaoId}`}]`

export interface GerarReciboResultado {
  criado: boolean
  recibo: { id: number; numero: string; valorTotal: number; descricao: string; data: string }
  totalConfirmado: number
  moeda: string
}

export async function gerarRecibo(ref: string, opts: { usuarioId?: number | null } = {}): Promise<GerarReciboResultado> {
  const ctx = await carregarContextoReceita(ref)
  if (!ctx) throw new AcaoReceitaError('Receita não encontrada.', 404)
  if (!ctx.temPagamentoConfirmado) throw new AcaoReceitaError('Recibo exige pagamento confirmado', 422)
  if (ctx.processoId == null) throw new AcaoReceitaError('Receita sem processo de origem; não é possível emitir recibo.', 422)

  const marca = marcador(ctx.codigo, ctx.obrigacaoId)

  // Idempotência: reaproveita um recibo já emitido para esta Receita/obrigação.
  const existente = await prisma.recibo
    .findFirst({ where: { processoId: ctx.processoId, descricao: { contains: marca } }, orderBy: { createdAt: 'desc' } })
    .catch(() => null)
  if (existente) {
    return {
      criado: false,
      recibo: { id: existente.id, numero: existente.numero, valorTotal: Number(existente.valorTotal), descricao: existente.descricao, data: existente.data.toISOString() },
      totalConfirmado: ctx.totalConfirmado,
      moeda: ctx.moeda,
    }
  }

  const numero = await proximoNumeroRecibo(ctx.processoId)
  const descricao = montarDescricao(ctx, marca)

  const recibo = await prisma.recibo.create({
    data: {
      processoId: ctx.processoId,
      numero,
      data: new Date(),
      valorTotal: ctx.totalConfirmado,
      descricao,
      pagadorNome: null,
      emitidoPorId: opts.usuarioId ?? null,
    },
  })

  await registrarEventoReceita({
    receitaId: ctx.receitaId,
    tipo: 'RECEBIMENTO',
    descricao: `Recibo ${numero} emitido no valor de ${ctx.moeda} ${ctx.totalConfirmado.toFixed(2)} (${ctx.pagamentosConfirmados.length} pagamento(s) confirmado(s)).`,
    valor: ctx.totalConfirmado,
    usuarioId: opts.usuarioId ?? null,
    dados: { acao: 'GERAR_RECIBO', reciboId: recibo.id, numero, obrigacaoId: ctx.obrigacaoId, pagamentoIds: ctx.pagamentosConfirmados.map((p) => p.id) },
  })

  return {
    criado: true,
    recibo: { id: recibo.id, numero: recibo.numero, valorTotal: Number(recibo.valorTotal), descricao: recibo.descricao, data: recibo.data.toISOString() },
    totalConfirmado: ctx.totalConfirmado,
    moeda: ctx.moeda,
  }
}

function montarDescricao(ctx: ContextoReceita, marca: string): string {
  const base = ctx.descricao || ctx.codigo || `Receita ${ctx.receitaId ?? ctx.obrigacaoId}`
  return `${marca} Recibo referente a ${base}`.slice(0, 300)
}

async function proximoNumeroRecibo(processoId: number): Promise<string> {
  const counter = await prisma.counterRecibo.upsert({
    where: { processoId },
    update: { proximoNumero: { increment: 1 } },
    create: { processoId, proximoNumero: 2 },
  })
  const numeroAtual = counter.proximoNumero - 1
  return `RCB-${String(numeroAtual).padStart(4, '0')}`
}
