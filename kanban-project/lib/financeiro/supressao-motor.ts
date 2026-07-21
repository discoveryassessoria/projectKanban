// lib/financeiro/supressao-motor.ts
// ============================================================================
// SUPRESSÃO FINANCEIRA RASTREÁVEL — quebra o ciclo
//   usuário cancela → motor reconcilia → motor recria → usuário cancela de novo.
//
// Evolução ADITIVA sobre a estrutura oficial: a supressão vive no próprio
// MotorArtefato que registra a origem do lançamento (status='suppressed' +
// detalhes.supressao). NÃO existe tabela financeira paralela e nada é apagado.
//
// A supressão está vinculada a: processo, regra financeira (ruleKind/ruleSource/
// ruleId), lançamento (targetTable/targetId), origem operacional (phaseKey/event/
// automaticKey), motivo, usuário, data e estado ativo|revogado.
//
// O motor (aplicarHonorariosCidadaniaItaliana e a reconciliação de fase) respeita
// artefato suprimido e NÃO recria o lançamento enquanto a supressão estiver ativa.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export const STATUS_SUPRIMIDO = 'suppressed'

export type TipoLancamento = 'receita' | 'custo'

export interface SupressaoRegistro {
  ativa: boolean
  motivo: string
  usuarioId: number | null
  suprimidoEm: string
  revogadoEm?: string | null
  revogadoPorId?: number | null
  revogadoMotivo?: string | null
}

export interface OrigemOperacional {
  artefatoId: number
  /** processo a que a supressão está vinculada */
  processoId: number
  automaticKey: string
  phaseKey: string
  event: string
  ruleKind: string
  ruleSource: string
  ruleId: number | null
  descricao: string
  /** true = a regra ainda exige este lançamento (motor recriaria na reconciliação). */
  ativa: boolean
  supressao: SupressaoRegistro | null
  detalhes: Prisma.JsonValue | null
}

function tabelaDe(tipo: TipoLancamento): string {
  return tipo === 'receita' ? 'Receita' : 'Custo'
}

function lerSupressao(detalhes: Prisma.JsonValue | null | undefined): SupressaoRegistro | null {
  if (!detalhes || typeof detalhes !== 'object' || Array.isArray(detalhes)) return null
  const s = (detalhes as Record<string, unknown>).supressao
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null
  return s as unknown as SupressaoRegistro
}

/**
 * Origem operacional que mantém um lançamento vivo. Devolve null quando o
 * lançamento não nasceu do motor (não há o que suprimir — cancelar já basta).
 */
export async function origemOperacionalDoLancamento(
  tipo: TipoLancamento,
  lancamentoId: number,
): Promise<OrigemOperacional | null> {
  const artefato = await prisma.motorArtefato.findFirst({
    where: { targetTable: tabelaDe(tipo), targetId: lancamentoId },
    orderBy: { criadoEm: 'desc' },
  })
  if (!artefato) return null
  const supressao = lerSupressao(artefato.detalhes)
  return {
    artefatoId: artefato.id,
    processoId: artefato.processoId,
    automaticKey: artefato.automaticKey,
    phaseKey: artefato.phaseKey,
    event: artefato.event,
    ruleKind: artefato.ruleKind,
    ruleSource: artefato.ruleSource,
    ruleId: artefato.ruleId,
    descricao: artefato.descricao,
    ativa: artefato.status === 'active',
    supressao: supressao?.ativa ? supressao : null,
    detalhes: artefato.detalhes ?? null,
  }
}

export interface ResultadoSupressao {
  ok: boolean
  status: 'suprimido' | 'ja_suprimido' | 'revogado' | 'nao_aplicavel' | 'nao_encontrado'
  artefatoId?: number
  motivo?: string
}

/**
 * Registra a supressão da origem automática. Idempotente: suprimir duas vezes
 * devolve 'ja_suprimido' sem sobrescrever o registro original.
 */
export async function suprimirOrigem(
  tipo: TipoLancamento,
  lancamentoId: number,
  opts: { motivo: string; usuarioId?: number | null },
  tx?: Prisma.TransactionClient,
): Promise<ResultadoSupressao> {
  const db = tx ?? prisma
  const artefato = await db.motorArtefato.findFirst({
    where: { targetTable: tabelaDe(tipo), targetId: lancamentoId },
    orderBy: { criadoEm: 'desc' },
  })
  // Lançamento sem origem no motor: não há regra que o recrie.
  if (!artefato) return { ok: true, status: 'nao_aplicavel' }

  const atual = lerSupressao(artefato.detalhes)
  if (atual?.ativa && artefato.status === STATUS_SUPRIMIDO) {
    return { ok: true, status: 'ja_suprimido', artefatoId: artefato.id }
  }

  const base = (artefato.detalhes && typeof artefato.detalhes === 'object' && !Array.isArray(artefato.detalhes))
    ? (artefato.detalhes as Record<string, unknown>)
    : {}

  const registro: SupressaoRegistro = {
    ativa: true,
    motivo: opts.motivo.slice(0, 500),
    usuarioId: opts.usuarioId ?? null,
    suprimidoEm: new Date().toISOString(),
    revogadoEm: null,
    revogadoPorId: null,
    revogadoMotivo: null,
  }

  await db.motorArtefato.update({
    where: { id: artefato.id },
    data: {
      status: STATUS_SUPRIMIDO,
      detalhes: { ...base, supressao: registro } as unknown as Prisma.InputJsonValue,
    },
  })
  return { ok: true, status: 'suprimido', artefatoId: artefato.id }
}

/**
 * Revoga a supressão: a próxima reconciliação volta a aplicar a regra ativa
 * (sem duplicar — a chave de idempotência continua a mesma).
 */
export async function revogarSupressao(
  tipo: TipoLancamento,
  lancamentoId: number,
  opts: { motivo?: string; usuarioId?: number | null } = {},
): Promise<ResultadoSupressao> {
  const artefato = await prisma.motorArtefato.findFirst({
    where: { targetTable: tabelaDe(tipo), targetId: lancamentoId },
    orderBy: { criadoEm: 'desc' },
  })
  if (!artefato) return { ok: false, status: 'nao_encontrado', motivo: 'sem origem no motor' }

  const atual = lerSupressao(artefato.detalhes)
  if (!atual?.ativa) return { ok: true, status: 'nao_aplicavel', artefatoId: artefato.id }

  const base = (artefato.detalhes && typeof artefato.detalhes === 'object' && !Array.isArray(artefato.detalhes))
    ? (artefato.detalhes as Record<string, unknown>)
    : {}

  const registro: SupressaoRegistro = {
    ...atual,
    ativa: false,
    revogadoEm: new Date().toISOString(),
    revogadoPorId: opts.usuarioId ?? null,
    revogadoMotivo: (opts.motivo ?? 'Supressão revogada').slice(0, 500),
  }

  await prisma.motorArtefato.update({
    where: { id: artefato.id },
    data: {
      // Volta a 'removed': o lançamento segue cancelado, mas a regra pode reaplicar.
      status: 'removed',
      detalhes: { ...base, supressao: registro } as unknown as Prisma.InputJsonValue,
    },
  })
  return { ok: true, status: 'revogado', artefatoId: artefato.id }
}

/** O motor deve pular a criação enquanto houver supressão ativa para esta chave. */
export function artefatoEstaSuprimido(
  artefato: { status: string; detalhes?: Prisma.JsonValue | null } | null | undefined,
): boolean {
  if (!artefato) return false
  if (artefato.status !== STATUS_SUPRIMIDO) return false
  return lerSupressao(artefato.detalhes)?.ativa === true
}
