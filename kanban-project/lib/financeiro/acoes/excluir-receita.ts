// lib/financeiro/acoes/excluir-receita.ts
// ============================================================================
// EXCLUSÃO SEGURA da Receita (Motor Financeiro V3). Diferente de Cancelar/Arquivar:
// remove a Receita da operação SÓ quando é seguro — e ainda assim de forma LÓGICA
// (soft-delete): o Ledger/histórico NUNCA é apagado.
//
//   podeExcluir(ref)  → { permitido, motivos[] } — bloqueia quando há vínculo real.
//   excluirReceita(ref, ctx) → executa a exclusão lógica (só se podeExcluir), auditada.
//
// BLOQUEIA quando houver:
//   - pagamento (ocorrência PAGAMENTO/PAGAMENTO_PARCIAL PROCESSADA ou recebido>0 no Ledger);
//   - lançamento consolidado (entries de liquidação no Ledger — movimento em Caixa/Banco);
//   - documento fiscal (Fatura/Recibo emitido vinculado);
//   - integração concluída (LancamentoBancario CONCILIADO referenciando a obrigação);
//   - obrigação legal (marcador em contextoAplicado.obrigacaoLegal ou observações).
//
// A exclusão lógica reusa a infra de ocultação do Arquivar (Receita.arquivadaEm) +
// um marcador próprio em contextoAplicado.exclusao (distingue "excluída" de "arquivada").
// Reversível; o Ledger e as ocorrências permanecem intactos.
// ============================================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolverId } from '@/lib/financeiro/leitura/receita-detalhe'
import { CONTA } from '@/lib/financeiro/ledger/plano-contas'
import { registrarEventoReceita } from './receita-contexto'
import { AcaoReceitaError } from './recibo'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface PodeExcluirResultado {
  permitido: boolean
  motivos: string[]
  obrigacaoId: number
  receitaId: number | null
}

const TIPOS_PAGAMENTO = ['PAGAMENTO', 'PAGAMENTO_PARCIAL'] as const

export async function podeExcluir(ref: string): Promise<PodeExcluirResultado> {
  const obrigacaoId = await resolverId(ref)
  if (!obrigacaoId) throw new AcaoReceitaError('Receita não encontrada.', 404)

  const obr = await prisma.obrigacaoEconomica.findUnique({
    where: { id: obrigacaoId },
    select: { id: true, origemTipo: true, origemId: true, observacoes: true },
  })
  if (!obr) throw new AcaoReceitaError('Receita não encontrada.', 404)
  const receitaId = obr.origemTipo === 'Receita' ? obr.origemId ?? null : null

  const motivos: string[] = []

  // 1) pagamento — ocorrência de pagamento PROCESSADA ou recebido>0 no Ledger.
  const [pagCount, proj] = await Promise.all([
    prisma.ocorrenciaFinanceira.count({ where: { obrigacaoId, tipo: { in: [...TIPOS_PAGAMENTO] }, status: 'PROCESSADA' } }).catch(() => 0),
    prisma.saldoProjecao.findUnique({ where: { obrigacaoId }, select: { recebidoBruto: true } }).catch(() => null),
  ])
  const recebido = cent(Number(proj?.recebidoBruto ?? 0))
  if (pagCount > 0 || recebido > 0.005) motivos.push(`Possui pagamento registrado (${recebido > 0.005 ? recebido : pagCount} confirmado). Estorne o pagamento antes de excluir.`)

  // 2) lançamento consolidado — movimento de liquidação no Ledger (Caixa/Banco).
  const liquidacoes = await prisma.ledgerEntry.count({ where: { obrigacaoId, contaContabil: CONTA.CAIXA_BANCO } }).catch(() => 0)
  if (liquidacoes > 0) motivos.push('Há lançamento consolidado no Ledger (movimento de caixa/liquidação). Exclusão bloqueada.')

  // 3) documento fiscal — Fatura/Recibo emitido vinculado.
  if (receitaId != null) {
    const faturas = await prisma.fatura.count({ where: { receitaId } }).catch(() => 0)
    if (faturas > 0) motivos.push('Existe documento fiscal (Fatura/Recibo) emitido vinculado. Exclusão bloqueada.')
  }

  // 4) integração concluída — conciliação bancária concluída referenciando a obrigação.
  const conciliados = await prisma.lancamentoBancario.count({ where: { obrigacaoId, status: 'CONCILIADO' } }).catch(() => 0)
  if (conciliados > 0) motivos.push('Há integração/conciliação bancária concluída. Exclusão bloqueada.')

  // 5) obrigação legal — marcador explícito (contexto/observações).
  if (await temObrigacaoLegal(receitaId, obr.observacoes)) motivos.push('Marcada como obrigação legal. Exclusão bloqueada.')

  return { permitido: motivos.length === 0, motivos, obrigacaoId, receitaId }
}

async function temObrigacaoLegal(receitaId: number | null, observacoes: string | null | undefined): Promise<boolean> {
  if ((observacoes ?? '').toLowerCase().includes('obrigação legal') || (observacoes ?? '').toLowerCase().includes('obrigacao legal')) return true
  if (receitaId == null) return false
  const rec = await prisma.receita.findUnique({ where: { id: receitaId }, select: { contextoAplicado: true, observacoes: true } }).catch(() => null)
  if (!rec) return false
  if ((rec.observacoes ?? '').toLowerCase().includes('obriga') && (rec.observacoes ?? '').toLowerCase().includes('legal')) return true
  const ctx = rec.contextoAplicado
  if (ctx && typeof ctx === 'object' && !Array.isArray(ctx)) {
    const c = ctx as Record<string, unknown>
    if (c.obrigacaoLegal === true) return true
  }
  return false
}

export interface ExcluirResultado {
  receitaId: number | null
  obrigacaoId: number
  excluida: boolean
}

export async function excluirReceita(ref: string, ctx: { usuarioId?: number | null; motivo?: string | null } = {}): Promise<ExcluirResultado> {
  const check = await podeExcluir(ref)
  if (!check.permitido) throw new AcaoReceitaError(check.motivos.join(' '), 422, check.motivos)

  const motivo = ctx.motivo?.trim() || null

  // Exclusão LÓGICA (soft-delete): oculta + marca de origem. Ledger intacto.
  // Receita → Receita.arquivadaEm + contextoAplicado.exclusao (fonte do filtro de receitas).
  // Custo (sem Receita) → ObrigacaoEconomica.arquivadaEm (fonte do filtro de obrigações).
  const isCusto = check.receitaId == null
  if (!isCusto) {
    const rec = await prisma.receita.findUnique({ where: { id: check.receitaId! }, select: { contextoAplicado: true } })
    const ctxBase = (rec?.contextoAplicado && typeof rec.contextoAplicado === 'object' && !Array.isArray(rec.contextoAplicado)) ? (rec.contextoAplicado as Record<string, unknown>) : {}
    const contextoAplicado = { ...ctxBase, exclusao: { em: new Date().toISOString(), porId: ctx.usuarioId ?? null, motivo } } as Prisma.InputJsonValue
    await prisma.receita.update({ where: { id: check.receitaId! }, data: { arquivadaEm: new Date(), contextoAplicado } })
  } else {
    await prisma.obrigacaoEconomica.update({ where: { id: check.obrigacaoId }, data: { arquivadaEm: new Date() } })
  }

  // Auditoria: Receita usa o EventoFinanceiro legado; Custo grava no LogAuditoria
  // (fonte que a timeline financeira consome para obrigações — fonte única, sem tabela morta).
  await registrarEventoReceita({
    receitaId: check.receitaId,
    tipo: 'CANCELAMENTO',
    descricao: `Receita excluída (exclusão lógica).${motivo ? ` Motivo: ${motivo}` : ''} Ledger e histórico preservados.`,
    usuarioId: ctx.usuarioId ?? null,
    dados: { acao: 'EXCLUIR', obrigacaoId: check.obrigacaoId, motivo },
  })
  await prisma.logAuditoria.create({
    data: {
      acao: 'EXCLUIR', entidade: 'ObrigacaoEconomica', entidadeId: check.obrigacaoId,
      descricao: `${isCusto ? 'Custo' : 'Receita'} excluído (exclusão lógica).${motivo ? ` Motivo: ${motivo}` : ''} Ledger preservado.`.slice(0, 1000),
      detalhes: { acao: 'EXCLUIR', natureza: isCusto ? 'CUSTO' : 'RECEITA', receitaId: check.receitaId, motivo } as Prisma.InputJsonValue,
      usuarioId: ctx.usuarioId ?? null,
    },
  }).catch(() => {})

  return { receitaId: check.receitaId, obrigacaoId: check.obrigacaoId, excluida: true }
}
