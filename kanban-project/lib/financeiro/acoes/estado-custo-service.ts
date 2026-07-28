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
import { transicionarEstadoCusto, ROTULO_ESTADO_CUSTO, ehEstadoCusto, type EstadoCusto } from '../dominio/estado-custo'

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
