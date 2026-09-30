// src/services/torre-tarefas.ts
// ============================================================================
// A LISTA DE TAREFAS DA TORRE — Bloco G (30/09/2026).
//
// NÃO É UMA CONSULTA NOVA: é a MESMA projeção que a Operação lê
// (`visaoGerencial` → `LinhaGerencial`), sem o corte de 500 linhas de
// `minhaFila` (pagina até esgotar) e sem tarefa encerrada — o mesmo recorte
// "aberta" da Operação. Acrescenta, por linha, só o que a AÇÃO precisa e a
// projeção não traz: o órgão (id) e `podeIniciar`.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { visaoGerencial, ordenarFila, type LinhaGerencial, type FiltrosGerenciais } from '@/lib/operacional/tarefa-projecoes'
import { ehCobravelVencido } from '@/lib/operacional/torre-predicados'
import { motivoDeNaoPoderIniciar } from '@/src/services/iniciar-envio'

export interface LinhaDaTorre extends LinhaGerencial {
  orgaoId: number | null
  /** A fase em que o PROCESSO está (chave) — para "Iniciar" e para o Radar. */
  faseAtualKey: string | null
  podeIniciar: boolean
  /** Por que NÃO pode iniciar (só quando é candidata a "a iniciar"; senão `null`). */
  motivoNaoIniciar: string | null
  cobravelVencida: boolean
}

export async function listarTarefasDaTorre(
  filtros: Omit<FiltrosGerenciais, 'porPagina' | 'pagina'> = {}, agora = new Date(),
): Promise<{ linhas: LinhaDaTorre[]; total: number; cobrancasVencidas: number }> {
  const todas: LinhaGerencial[] = []
  for (let pagina = 1; ; pagina++) {
    const { linhas, total } = await visaoGerencial({ ...filtros, pagina, porPagina: 500 }, agora)
    todas.push(...linhas)
    if (pagina * 500 >= total || linhas.length === 0) break
  }
  // O mesmo recorte de `minhaFila`: encerradas não são fila.
  const abertas = ordenarFila(todas.filter((l) => l.coluna !== 'CONCLUIDA')) as LinhaGerencial[]

  const tarefaIds = abertas.map((l) => l.taskId)
  const processoIds = [...new Set(abertas.map((l) => l.processoId).filter((id): id is number => id != null))]
  const [orgaos, processos] = await Promise.all([
    tarefaIds.length
      ? prisma.tarefa.findMany({ where: { id: { in: tarefaIds } }, select: { id: true, orgaoId: true, documento: { select: { orgaoId: true } } } })
      : Promise.resolve([]),
    processoIds.length
      ? prisma.processo.findMany({ where: { id: { in: processoIds } }, select: { id: true, faseAtualKey: true } })
      : Promise.resolve([]),
  ])
  const orgaoDaTarefa = new Map(orgaos.map((t) => [t.id, t.orgaoId ?? t.documento?.orgaoId ?? null]))
  const faseDoProcesso = new Map(processos.map((p) => [p.id, p.faseAtualKey]))

  const linhas: LinhaDaTorre[] = abertas.map((l) => {
    const orgaoId = orgaoDaTarefa.get(l.taskId) ?? null
    const faseAtualKey = l.processoId != null ? faseDoProcesso.get(l.processoId) ?? null : null
    const motivo = motivoDeNaoPoderIniciar({
      statusTarefa: l.statusTarefa, aIniciar: l.aIniciar, faseMacroKey: l.faseMacroKey, faseAtualKey,
      aguardandoDependencia: l.aguardandoDependencia, temOrgao: orgaoId != null,
    })
    return {
      ...l, orgaoId, faseAtualKey,
      podeIniciar: motivo === null,
      // Só interessa explicar quem TERIA sentido iniciar (não iniciada e no ponto de entrada).
      motivoNaoIniciar: l.aIniciar && l.statusTarefa === 'NAO_INICIADA' ? motivo : null,
      cobravelVencida: ehCobravelVencido(l),
    }
  })
  return { linhas, total: linhas.length, cobrancasVencidas: linhas.filter((l) => l.cobravelVencida).length }
}
