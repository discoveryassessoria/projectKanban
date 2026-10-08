// src/services/genealogia/dono-casamento.ts
// ============================================================================
// O DONO DA CERTIDÃO DE CASAMENTO É RECALCULADO, NÃO SÓ ESCOLHIDO NA CRIAÇÃO (08/10/2026).
// A necessidade de casamento é da UNIÃO; o Documento (e a tarefa) precisam de uma pessoa-titular — sempre o cônjuge da linha reta que MANTÉM o casamento
// (`titularDaUniao`, a regra única). A escolha só acontecia quando o documento nascia: se a classificação da linha reta ainda não estava gravada, o documento
// ficava no cônjuge errado para sempre (caso Fogli: certidão da Ilaine no nome do Sebastião, que não precisa de documento).
// Aqui: toda reconciliação (`materializarGenealogia`) reaponta, para o dono de hoje, o Documento e as tarefas ABERTAS ligadas a ele. SÓ O TITULAR muda:
// status, histórico, anexos, tarefas já concluídas e contagens (Briefing, recebida/validada) ficam como estão.
// ============================================================================
import type { Prisma, PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { SELECT_UNIAO_PARA_TITULAR, titularDaUniao } from "@/src/services/genealogia/titular-uniao"

type DB = PrismaClient | Prisma.TransactionClient

const TAREFA_ENCERRADA = ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] as const
const nomeDe = (p: { nome: string; sobrenome: string | null } | null | undefined): string => (p ? [p.nome, p.sobrenome].filter(Boolean).join(" ") : "—")

export interface ReapontamentoDoCasamento {
  documentoId: number
  necessidadeId: number
  de: { id: number; nome: string }
  para: { id: number; nome: string }
  tarefasReapontadas: number[]
}

/** Reaponta para o dono de hoje os casamentos do processo que estão no nome de outro cônjuge. Idempotente: sem divergência, não escreve nada. */
export async function reapontarDonoDoCasamento(
  processoId: number,
  db: DB = prisma,
  ctx: { motivo: string; autorId?: number | null; autorizadoPor?: string | null } = { motivo: "reconciliação: o dono da certidão de casamento é o cônjuge da linha reta que a mantém" },
): Promise<ReapontamentoDoCasamento[]> {
  const necessidades = await db.necessidadeDocumental.findMany({
    where: { processoId, uniaoId: { not: null }, status: { not: "DISPENSADA" } },
    select: { id: true, uniao: { select: SELECT_UNIAO_PARA_TITULAR }, documentos: { select: { id: true, pessoaId: true } } },
  })
  const feitos: ReapontamentoDoCasamento[] = []
  for (const n of necessidades) {
    const dono = titularDaUniao(n.uniao)
    if (dono == null) continue
    for (const d of n.documentos) {
      if (d.pessoaId === dono) continue
      const [antes, depois] = await Promise.all([
        db.pessoa.findUnique({ where: { id: d.pessoaId }, select: { nome: true, sobrenome: true } }),
        db.pessoa.findUnique({ where: { id: dono }, select: { nome: true, sobrenome: true } }),
      ])
      await db.documento.update({ where: { id: d.id }, data: { pessoaId: dono } })
      // Só as tarefas ABERTAS: a tarefa concluída é história (e a contagem de «ontem» não depende da pessoa).
      const abertas = await db.tarefa.findMany({
        where: { OR: [{ documentoId: d.id }, { necessidadeId: n.id }], statusTarefa: { notIn: [...TAREFA_ENCERRADA] }, pessoaId: { not: dono } },
        select: { id: true, titulo: true },
      })
      for (const t of abertas) {
        const sufixo = ` · ${nomeDe(antes)}`
        await db.tarefa.update({ where: { id: t.id }, data: { pessoaId: dono, ...(t.titulo.endsWith(sufixo) ? { titulo: `${t.titulo.slice(0, -sufixo.length)} · ${nomeDe(depois)}` } : {}) } })
      }
      const por = ctx.autorizadoPor ? ` Autorizado por ${ctx.autorizadoPor}.` : ""
      await db.logAuditoria.create({
        data: {
          acao: "CASAMENTO_DONO_REAPONTADO", entidade: "Documento", entidadeId: d.id, usuarioId: ctx.autorId ?? null,
          descricao: `Certidão de casamento (documento ${d.id}, necessidade ${n.id}): titular de «${nomeDe(antes)}» para «${nomeDe(depois)}» — ${ctx.motivo}.${por} Só o titular mudou (status e histórico intactos); ${abertas.length} tarefa(s) aberta(s) acompanharam.`,
          detalhes: { documentoId: d.id, necessidadeId: n.id, de: d.pessoaId, para: dono, tarefas: abertas.map((t) => t.id), motivo: ctx.motivo, autorizadoPor: ctx.autorizadoPor ?? null } as Prisma.InputJsonValue,
        },
      })
      feitos.push({ documentoId: d.id, necessidadeId: n.id, de: { id: d.pessoaId, nome: nomeDe(antes) }, para: { id: dono, nome: nomeDe(depois) }, tarefasReapontadas: abertas.map((t) => t.id) })
    }
  }
  return feitos
}

/** Casamentos fora do dono HOJE (somente leitura) — o vigia e o teste leem daqui. */
export async function casamentosForaDoDono(processoId: number, db: DB = prisma): Promise<Array<{ documentoId: number; necessidadeId: number; pessoaId: number; donoId: number }>> {
  const necessidades = await db.necessidadeDocumental.findMany({
    where: { processoId, uniaoId: { not: null }, status: { not: "DISPENSADA" } },
    select: { id: true, uniao: { select: SELECT_UNIAO_PARA_TITULAR }, documentos: { select: { id: true, pessoaId: true } } },
  })
  const fora: Array<{ documentoId: number; necessidadeId: number; pessoaId: number; donoId: number }> = []
  for (const n of necessidades) {
    const dono = titularDaUniao(n.uniao)
    if (dono == null) continue
    for (const d of n.documentos) if (d.pessoaId !== dono) fora.push({ documentoId: d.id, necessidadeId: n.id, pessoaId: d.pessoaId, donoId: dono })
  }
  return fora
}
