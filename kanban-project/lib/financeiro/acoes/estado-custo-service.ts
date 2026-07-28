// lib/financeiro/acoes/estado-custo-service.ts
// ============================================================================
// F4.2 — Aplicação transacional de transições de ESTADO DE NEGÓCIO do custo,
// dirigidas pelas ações do ciclo de vida (pagamento, estorno, conciliação,
// cancelamento, arquivamento). Server-side, validada pela máquina de estados,
// idempotente e AUDITADA (LogAuditoria, fonte que a timeline financeira consome).
// Só atua em obrigações de CUSTO (estadoCusto != null); no-op para Receita.
// Transição inválida = no-op seguro (nunca quebra a mutação financeira).
// ============================================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { transicionarEstadoCusto, ROTULO_ESTADO_CUSTO, ehEstadoCusto, type EstadoCusto } from '../dominio/estado-custo'
import { resolverId } from '../leitura/receita-detalhe'

type Tx = Prisma.TransactionClient

export async function aplicarTransicaoEstadoCustoTx(
  tx: Tx, obrigacaoId: number, novoEstado: EstadoCusto,
  ctx: { motivo?: string | null; usuarioId?: number | null } = {},
): Promise<{ aplicada: boolean; de: EstadoCusto | null; para: EstadoCusto }> {
  const obr = await tx.obrigacaoEconomica.findUnique({ where: { id: obrigacaoId }, select: { natureza: true, estadoCusto: true } })
  if (!obr || obr.natureza !== 'CUSTO' || !ehEstadoCusto(obr.estadoCusto)) return { aplicada: false, de: null, para: novoEstado }
  const de = obr.estadoCusto
  if (de === novoEstado) return { aplicada: false, de, para: novoEstado } // idempotente
  const r = transicionarEstadoCusto(de, novoEstado)
  if (!r.ok) return { aplicada: false, de, para: novoEstado } // transição inválida → no-op seguro
  await tx.obrigacaoEconomica.update({ where: { id: obrigacaoId }, data: { estadoCusto: novoEstado } })
  await tx.logAuditoria.create({ data: {
    acao: 'ESTADO_CUSTO', entidade: 'ObrigacaoEconomica', entidadeId: obrigacaoId,
    descricao: `Estado do custo: ${ROTULO_ESTADO_CUSTO[de]} → ${ROTULO_ESTADO_CUSTO[novoEstado]}${ctx.motivo ? ` — ${ctx.motivo}` : ''}`.slice(0, 1000),
    detalhes: { de, para: novoEstado, motivo: ctx.motivo ?? null } as Prisma.InputJsonValue,
    usuarioId: ctx.usuarioId ?? null,
  } }).catch(() => {})
  return { aplicada: true, de, para: novoEstado }
}

/**
 * F4.3 — Ação manual de mudança de estado do custo (Aprovar/Contratar/Executar…).
 * Resolve a referência, valida a transição pela máquina de estados e aplica de forma
 * transacional e auditada. Retorna erro compreensível em transição inválida (não lança).
 */
export async function mudarEstadoCusto(
  ref: string, novoEstado: EstadoCusto,
  ctx: { motivo?: string | null; usuarioId?: number | null } = {},
): Promise<{ ok: boolean; de: EstadoCusto | null; para: EstadoCusto; erro?: string }> {
  const obrigacaoId = await resolverId(ref)
  if (!obrigacaoId) return { ok: false, de: null, para: novoEstado, erro: 'Custo não encontrado.' }
  const obr = await prisma.obrigacaoEconomica.findUnique({ where: { id: obrigacaoId }, select: { natureza: true, estadoCusto: true } })
  if (!obr || obr.natureza !== 'CUSTO' || !ehEstadoCusto(obr.estadoCusto)) return { ok: false, de: null, para: novoEstado, erro: 'Registro não é um custo com estado de negócio.' }
  const de = obr.estadoCusto
  const t = transicionarEstadoCusto(de, novoEstado)
  if (!t.ok) return { ok: false, de, para: novoEstado, erro: t.erro }
  await prisma.$transaction(async (tx) => { await aplicarTransicaoEstadoCustoTx(tx, obrigacaoId, novoEstado, ctx) })
  return { ok: true, de, para: novoEstado }
}
