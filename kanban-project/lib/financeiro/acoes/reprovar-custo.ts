// lib/financeiro/acoes/reprovar-custo.ts
// ============================================================================
// F7.2 — REPROVAÇÃO de custo (permissão `financeiro.custo_reprovar`).
//
// Reprovar é o ato de RECUSAR um custo que ainda está em análise — o contraponto de
// Aprovar dentro da segregação de funções (criar ≠ aprovar ≠ reprovar ≠ pagar ≠ conciliar).
//
// NÃO cria um estado novo na máquina de domínio: a reprovação encerra o custo em
// CANCELADO (mesma saída documentada dos cancelamentos), reusando `cancelarObrigacao`
// — motor único, sem 2ª fonte de verdade. O que distingue reprovação de cancelamento
// é o REGISTRO: permissão própria, motivo obrigatório e auditoria REPROVAR (de qual
// estado veio, quem reprovou, por quê) — que a timeline financeira consome.
//
// Só é possível reprovar enquanto o custo NÃO virou compromisso executado:
// estado PREVISTO ou APROVADO e sem nenhum pagamento registrado.
// ============================================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { cancelarObrigacao } from '../extras/cancelar-lancamento'
import { resolverId } from '../leitura/receita-detalhe'
import { ROTULO_ESTADO_CUSTO, ehEstadoCusto, ESTADOS_REPROVAVEIS, type EstadoCusto } from '../dominio/estado-custo'

// Reexporta por compatibilidade: a definição canônica vive no domínio puro.
export { ESTADOS_REPROVAVEIS }

export type ResultadoReprovacao = {
  ok: boolean
  obrigacaoId?: number
  de?: EstadoCusto
  jaReprovado?: boolean
  erro?: string
}

/** Motivo da reprovação é OBRIGATÓRIO (é o registro que justifica a recusa). */
export function motivoReprovacaoValido(motivo: unknown): motivo is string {
  return typeof motivo === 'string' && motivo.trim().length >= 3
}

export async function reprovarCusto(
  ref: string | number,
  entrada: { motivo: string; usuarioId?: number | null },
): Promise<ResultadoReprovacao> {
  if (!motivoReprovacaoValido(entrada.motivo)) {
    return { ok: false, erro: 'Informe o motivo da reprovação (mínimo 3 caracteres).' }
  }
  const motivo = entrada.motivo.trim()

  const obrigacaoId = typeof ref === 'number' ? ref : await resolverId(String(ref))
  if (!obrigacaoId) return { ok: false, erro: 'Custo não encontrado.' }

  const obr = await prisma.obrigacaoEconomica.findUnique({
    where: { id: obrigacaoId },
    select: { id: true, natureza: true, estadoCusto: true, status: true },
  })
  if (!obr) return { ok: false, erro: 'Custo não encontrado.' }
  if (obr.natureza !== 'CUSTO') return { ok: false, erro: 'Reprovação existe apenas para custo (Contas a Pagar).' }
  if (obr.status === 'CANCELADO') return { ok: true, obrigacaoId, jaReprovado: true } // idempotente

  if (!ehEstadoCusto(obr.estadoCusto)) return { ok: false, erro: 'Custo sem estado de negócio — não é reprovável.' }
  const de = obr.estadoCusto
  if (!ESTADOS_REPROVAVEIS.includes(de)) {
    return {
      ok: false, de,
      erro: `Só é possível reprovar um custo em análise (${ESTADOS_REPROVAVEIS.map((e) => ROTULO_ESTADO_CUSTO[e]).join(' ou ')}). Este custo está ${ROTULO_ESTADO_CUSTO[de]} — use Cancelar custo.`,
    }
  }

  const proj = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId }, select: { recebidoBruto: true } })
  if (Number(proj?.recebidoBruto ?? 0) > 0) {
    return { ok: false, de, erro: 'Este custo já tem pagamento registrado — estorne o pagamento antes de reprovar.' }
  }

  // Encerramento pelo motor único (estorna ledger, status CANCELADO, estado CANCELADO).
  await cancelarObrigacao({ obrigacaoId, motivo: `Reprovado: ${motivo}`, criadoPorId: entrada.usuarioId ?? null })

  // Registro PRÓPRIO da reprovação (é isto que a diferencia de um cancelamento comum).
  await prisma.logAuditoria.create({
    data: {
      acao: 'REPROVAR', entidade: 'ObrigacaoEconomica', entidadeId: obrigacaoId,
      descricao: `Custo REPROVADO (estava ${ROTULO_ESTADO_CUSTO[de]}) — ${motivo}`.slice(0, 1000),
      detalhes: { de, para: 'CANCELADO', motivo, reprovacao: true } as Prisma.InputJsonValue,
      usuarioId: entrada.usuarioId ?? null,
    },
  }).catch(() => {})

  return { ok: true, obrigacaoId, de, jaReprovado: false }
}
