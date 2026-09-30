// lib/operacional/avisos-fatos.ts
// ============================================================================
// OS FATOS DO GESTOR QUE VIRAM AVISO — CHEGOU_TRABALHO e MUDOU_DE_MAO
// (redesenho do sino, 29/09/2026).
//
// Arquivo PROPOSITALMENTE leve (só `notificacao-canonica` e `navegacao`): as portas de
// escrita de Tarefa (`tarefa-canonica`, `tarefa-ciclo`, `tarefa-comandos`, materializador)
// importam daqui sem puxar as projeções gerenciais — nenhum ciclo de import. A varredura
// (`avisos-sino.ts`) re-exporta estas funções.
// ============================================================================
import type { Prisma, PrismaClient } from '@prisma/client'
import { urlOperacaoDaFamilia } from './navegacao'
import { somarAoAviso, rotuloDaFamilia, sincronizarAvisosDeTarefas, SELECT_ROTULO_FAMILIA } from './notificacao-canonica'

type Db = PrismaClient | Prisma.TransactionClient

interface TarefaDoFato { id: number; processoId: number | null }

async function rotulosDosProcessos(db: Db, ids: Array<number | null>): Promise<Map<number, string | null>> {
  const uniq = [...new Set(ids.filter((x): x is number => x != null))]
  if (uniq.length === 0) return new Map()
  const procs = await db.processo.findMany({ where: { id: { in: uniq } }, select: { id: true, ...SELECT_ROTULO_FAMILIA.select } })
  return new Map(procs.map((p) => [p.id, rotuloDaFamilia(p)]))
}

const porFamilia = (tarefas: TarefaDoFato[]) => {
  const m = new Map<number | null, number[]>()
  for (const t of tarefas) m.set(t.processoId, [...(m.get(t.processoId) ?? []), t.id])
  return m
}

/** "<Família> — N tarefas atribuídas a você" — soma no aviso aberto da família. */
export async function avisarChegouTrabalho(
  db: Db, args: { destinatarioId: number; tarefas: TarefaDoFato[]; autorId?: number | null },
): Promise<{ avisoIds: number[] }> {
  const rotulos = await rotulosDosProcessos(db, args.tarefas.map((t) => t.processoId))
  const avisoIds: number[] = []
  for (const [processoId, tarefaIds] of porFamilia(args.tarefas)) {
    const r = await somarAoAviso(db, {
      tipo: 'CHEGOU_TRABALHO', destinatarioId: args.destinatarioId, processoId,
      familiaNome: processoId != null ? rotulos.get(processoId) ?? null : null,
      tarefaIds, autorId: args.autorId ?? null,
      // `aba=fila`: as novas no topo, marcadas como novas (OperacaoV3 lê isto).
      link: urlOperacaoDaFamilia(processoId, 'fila'),
    })
    avisoIds.push(r.id)
  }
  return { avisoIds }
}

/** "<Família> — N tarefas saíram do seu A fazer". */
export async function avisarMudouDeMao(
  db: Db, args: { destinatarioId: number; tarefas: TarefaDoFato[]; autorId?: number | null },
): Promise<{ avisoIds: number[] }> {
  const rotulos = await rotulosDosProcessos(db, args.tarefas.map((t) => t.processoId))
  const avisoIds: number[] = []
  for (const [processoId, tarefaIds] of porFamilia(args.tarefas)) {
    const r = await somarAoAviso(db, {
      tipo: 'MUDOU_DE_MAO', destinatarioId: args.destinatarioId, processoId,
      familiaNome: processoId != null ? rotulos.get(processoId) ?? null : null,
      tarefaIds, autorId: args.autorId ?? null,
      link: urlOperacaoDaFamilia(processoId),
    })
    avisoIds.push(r.id)
  }
  return { avisoIds }
}

/**
 * A TAREFA MUDOU DE DONO (atribuir, transferir, remover para a fila, redistribuir).
 *
 * Na mesma transação da mudança: (1) os avisos da pessoa anterior sobre a tarefa
 * SOMEM (regra 5 — `sincronizarAvisosDeTarefas` lê o estado já gravado); (2) nasce o
 * MUDOU_DE_MAO para quem perdeu; (3) o CHEGOU_TRABALHO para quem recebeu. Quem
 * atribui a si mesmo não é avisado do que ele próprio fez.
 */
export async function aoMudarDeDono(
  db: Db,
  args: { tarefas: TarefaDoFato[]; de: number | null; para: number | null; autorId: number | null; avisarChegou?: boolean },
): Promise<{ chegouAvisoIds: number[] }> {
  await sincronizarAvisosDeTarefas(db, args.tarefas.map((t) => t.id))
  if (args.de != null && args.de !== args.para && args.de !== args.autorId) {
    await avisarMudouDeMao(db, { destinatarioId: args.de, tarefas: args.tarefas, autorId: args.autorId })
  }
  let chegouAvisoIds: number[] = []
  if (args.avisarChegou !== false && args.para != null && args.para !== args.autorId) {
    chegouAvisoIds = (await avisarChegouTrabalho(db, { destinatarioId: args.para, tarefas: args.tarefas, autorId: args.autorId })).avisoIds
  }
  return { chegouAvisoIds }
}

