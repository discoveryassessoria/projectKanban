// lib/operacional/torre-foco.ts
// ============================================================================
// FOCO DA FAMÍLIA — Bloco I3 (30/09/2026).
//
// Tudo é LEITURA das fontes que já existem — nenhum número recalculado, nada de exemplo:
//   • os 4 números e a tabela vêm das MESMAS linhas da aba Tarefas (`listarTarefasDaTorre`),
//     recortadas pelo processo — por isso batem com ela;
//   • "X de Y certidões recebidas" é o progresso real do Bloco E9 (`progressoRealDoProcesso`,
//     a mesma completude documental da Central);
//   • a linha do tempo junta o que o banco REALMENTE registrou: LogAuditoria (processo e suas
//     tarefas), avanços de fase (`PhaseAdvanceLog`) e contatos com terceiros (`ContatoTerceiro`).
// Comentários e "Relatório de controle" reaproveitam /api/comentarios e o motor de Relatórios.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { labelDaFasePorPhaseKey } from '@/src/lib/process-stage/fases-catalog'
import { listarTarefasDaTorre, type LinhaDaTorre } from '@/src/services/torre-tarefas'
import { progressoRealDoProcesso, diasNaFaseAtual } from './metricas-processo'

export interface EventoDoFoco {
  id: string
  quando: string
  tipo: 'AUDITORIA' | 'FASE' | 'CONTATO'
  autor: string | null
  titulo: string
  texto: string | null
  tarefaId: number | null
}

export interface FocoDaFamilia {
  processoId: number
  familiaId: number | null
  familiaNome: string
  pais: string | null
  codigo: string | null
  faseAtual: { key: string | null; label: string | null; dias: number | null }
  certidoes: { recebidas: number; requeridas: number }
  numeros: { abertas: number; vencidas: number; comCartorio: number; semResponsavel: number }
  tarefas: LinhaDaTorre[]
  linhaDoTempo: EventoDoFoco[]
}

/** Os 4 números do Foco — a MESMA definição dos filtros da aba Tarefas (Vencidas / Com o cartório / Sem responsável). */
export function numerosDoFoco(linhas: Array<Pick<LinhaDaTorre, 'atrasada' | 'estadoOperacao' | 'responsavelId'>>) {
  return {
    abertas: linhas.length,
    vencidas: linhas.filter((l) => l.atrasada).length,
    comCartorio: linhas.filter((l) => l.estadoOperacao === 'AGUARDANDO').length,
    semResponsavel: linhas.filter((l) => l.responsavelId == null).length,
  }
}

export async function focoDaFamilia(processoId: number, agora = new Date(), limiteLinhaDoTempo = 60): Promise<FocoDaFamilia | null> {
  const proc = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, nome: true, codigo: true, faseAtualKey: true, familiaId: true, familia: { select: { nome: true } }, paisCanonico: { select: { countryLabel: true } } },
  })
  if (!proc) return null

  const [{ linhas }, progresso, dias] = await Promise.all([
    listarTarefasDaTorre({ processoId }, agora),
    progressoRealDoProcesso(processoId),
    diasNaFaseAtual(processoId, agora),
  ])

  // TODAS as tarefas do processo (inclusive encerradas) para a linha do tempo contar a história inteira.
  const tarefasDoProcesso = await prisma.tarefa.findMany({ where: { processoId }, select: { id: true, titulo: true } })
  const ids = tarefasDoProcesso.map((t) => t.id)
  const tituloDe = new Map(tarefasDoProcesso.map((t) => [t.id, t.titulo]))

  const [logs, avancos, contatos] = await Promise.all([
    prisma.logAuditoria.findMany({
      where: { OR: [{ entidade: 'Tarefa', entidadeId: { in: ids } }, { entidade: 'Processo', entidadeId: processoId }] },
      orderBy: { criadoEm: 'desc' }, take: limiteLinhaDoTempo,
      select: { id: true, acao: true, entidade: true, entidadeId: true, descricao: true, criadoEm: true, usuario: { select: { nome: true } } },
    }),
    prisma.phaseAdvanceLog.findMany({
      where: { processoId }, orderBy: { criadoEm: 'desc' }, take: limiteLinhaDoTempo,
      select: { id: true, faseAtual: true, fasePretendida: true, resultado: true, justificativa: true, criadoEm: true, solicitadoPorId: true },
    }),
    ids.length
      ? prisma.contatoTerceiro.findMany({
          where: { tarefaId: { in: ids } }, orderBy: { registradoEm: 'desc' }, take: limiteLinhaDoTempo,
          select: { id: true, tarefaId: true, canal: true, resultado: true, observacao: true, registradoEm: true, registradoPor: { select: { nome: true } }, orgao: { select: { name: true, nomeFantasia: true } } },
        })
      : Promise.resolve([]),
  ])
  const solicitantes = [...new Set(avancos.map((a) => a.solicitadoPorId).filter((x): x is number => x != null))]
  const nomes = new Map(
    (solicitantes.length ? await prisma.usuario.findMany({ where: { id: { in: solicitantes } }, select: { id: true, nome: true } }) : []).map((u) => [u.id, u.nome]),
  )
  const rot = (k: string | null) => (k ? labelDaFasePorPhaseKey(k) ?? k : '—')

  const eventos: EventoDoFoco[] = [
    ...logs.map((l): EventoDoFoco => ({
      id: `log:${l.id}`, quando: l.criadoEm.toISOString(), tipo: 'AUDITORIA', autor: l.usuario?.nome ?? null,
      titulo: l.acao, texto: l.descricao, tarefaId: l.entidade === 'Tarefa' && l.entidadeId ? l.entidadeId : null,
    })),
    ...avancos.map((a): EventoDoFoco => ({
      id: `fase:${a.id}`, quando: a.criadoEm.toISOString(), tipo: 'FASE', autor: a.solicitadoPorId != null ? nomes.get(a.solicitadoPorId) ?? null : null,
      titulo: `Fase: ${rot(a.faseAtual)}${a.fasePretendida ? ` → ${rot(a.fasePretendida)}` : ''} (${a.resultado})`, texto: a.justificativa, tarefaId: null,
    })),
    ...contatos.map((c): EventoDoFoco => ({
      id: `contato:${c.id}`, quando: c.registradoEm.toISOString(), tipo: 'CONTATO', autor: c.registradoPor?.nome ?? null,
      titulo: `${c.canal === 'TELEFONE' ? 'Ligação' : 'Cobrança'} ao terceiro${c.orgao ? ` · ${c.orgao.nomeFantasia || c.orgao.name}` : ''}`,
      texto: `${c.canal} · ${c.resultado}${c.observacao ? ` — ${c.observacao}` : ''}${tituloDe.get(c.tarefaId) ? ` (${tituloDe.get(c.tarefaId)})` : ''}`, tarefaId: c.tarefaId,
    })),
  ].sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, limiteLinhaDoTempo)

  return {
    processoId, familiaId: proc.familiaId, familiaNome: proc.familia?.nome ?? proc.nome,
    pais: proc.paisCanonico?.countryLabel ?? null, codigo: proc.codigo,
    faseAtual: { key: proc.faseAtualKey, label: rot(proc.faseAtualKey), dias: dias.dias },
    certidoes: { recebidas: progresso.completed, requeridas: progresso.required },
    numeros: numerosDoFoco(linhas), tarefas: linhas, linhaDoTempo: eventos,
  }
}
