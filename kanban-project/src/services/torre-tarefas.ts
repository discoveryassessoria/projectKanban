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
import { visaoGerencialComExtras, ordenarFila, type LinhaGerencial, type FiltrosGerenciais } from '@/lib/operacional/tarefa-projecoes'
import { ehCobravelVencido } from '@/lib/operacional/torre-predicados'
import { semFaseFutura } from '@/lib/operacional/fase-futura'
import { motivoDeNaoPoderIniciar } from '@/src/services/iniciar-envio'
import { idsDeProcessosPausados, semProcessosPausados } from '@/src/services/processo-pausa'
import { lerBolaEmLote, type CamposDaBola } from '@/lib/operacional/torre-bola'

/**
 * A linha da Torre = a linha da Operação (`LinhaGerencial`, que já traz `iniciouEm`) + o que a AÇÃO precisa + os campos
 * ADITIVOS da Torre nova (Etapa A): `bolaCom`, `bolaDesde`, `categoriaTerceiro`, `pedidaEm`, `cobrarEm`, `cobrarEmPadrao`
 * (`torre-bola.ts` — função única, leitura em lote). Nenhum campo existente muda.
 */
export interface LinhaDaTorre extends LinhaGerencial, CamposDaBola {
  orgaoId: number | null
  /** A fase em que o PROCESSO está (chave) — para "Iniciar" e para o Radar. */
  faseAtualKey: string | null
  podeIniciar: boolean
  /** Por que NÃO pode iniciar (só quando é candidata a "a iniciar"; senão `null`). */
  motivoNaoIniciar: string | null
  cobravelVencida: boolean
}

export interface OpcoesDaListaDaTorre {
  /**
   * Inclui as tarefas de processos PAUSADOS. Padrão `false`: processo pausado fica FORA da Torre (filtro canônico, M2).
   * Só o detalhe do Processo (Foco) liga isto — ele continua acessível e mostra "Pausado".
   */
  incluirPausados?: boolean
}

export async function listarTarefasDaTorre(
  filtros: Omit<FiltrosGerenciais, 'porPagina' | 'pagina'> = {}, agora = new Date(), opcoes: OpcoesDaListaDaTorre = {},
): Promise<{ linhas: LinhaDaTorre[]; total: number; cobrancasVencidas: number }> {
  // A primeira página diz o total; as demais (só existem acima de 500 tarefas) vão juntas, não uma depois da
  // outra. A ordem das páginas é preservada.
  const [primeira, pausados] = await Promise.all([
    visaoGerencialComExtras({ ...filtros, pagina: 1, porPagina: 500 }, agora),
    // Uma consulta, constante no volume: os processos com pausa vigente (nunca por linha).
    opcoes.incluirPausados ? Promise.resolve(new Set<number>()) : idsDeProcessosPausados(),
  ])
  const restantes = primeira.linhas.length === 0
    ? []
    : await Promise.all(
        Array.from({ length: Math.max(0, Math.ceil(primeira.total / 500) - 1) }, (_, i) =>
          visaoGerencialComExtras({ ...filtros, pagina: i + 2, porPagina: 500 }, agora)),
      )
  const paginas = [primeira, ...restantes]
  const todas: LinhaGerencial[] = paginas.flatMap((p) => p.linhas)
  // O órgão e a fase do processo vêm da MESMA leitura da projeção (uma ida só, sem reler Tarefa/Processo).
  const extras = new Map(paginas.flatMap((p) => [...p.extras]))
  // O mesmo recorte de `minhaFila`: encerradas não são fila.
  // E tarefa de FASE FUTURA também não é fila (regra única do Bloco F — `fase-futura.ts`): lista, KPIs,
  // Radar, Processos, Foco e Equipe leem daqui, então a exclusão vale para todos de uma vez.
  // E o processo PAUSADO fica fora da Torre inteira (filtro canônico `semProcessosPausados`): quem lê daqui — lista, KPIs,
  // Terceiros, Equipe, Radar, Processos, Foco (que liga `incluirPausados`) e a foto diária — herda a exclusão de uma vez.
  const abertas = ordenarFila(semProcessosPausados(semFaseFutura(todas.filter((l) => l.coluna !== 'CONCLUIDA')), pausados)) as LinhaGerencial[]
  // A BOLA COM (função única da Torre): uma leitura em lote para todas as linhas.
  const bolas = await lerBolaEmLote(abertas.map((l) => ({
    taskId: l.taskId, estadoOperacao: l.estadoOperacao, esperandoDe: l.esperandoDe, esperandoDesde: l.esperandoDesde,
    orgaoId: extras.get(l.taskId)?.orgaoId ?? null, passoId: extras.get(l.taskId)?.passoId ?? null,
  })))

  const linhas: LinhaDaTorre[] = abertas.map((l) => {
    const orgaoId = extras.get(l.taskId)?.orgaoId ?? null
    const faseAtualKey = l.processoId != null ? extras.get(l.taskId)?.faseAtualKey ?? null : null
    const motivo = motivoDeNaoPoderIniciar({
      statusTarefa: l.statusTarefa, aIniciar: l.aIniciar, faseMacroKey: l.faseMacroKey, faseAtualKey,
      aguardandoDependencia: l.aguardandoDependencia, temOrgao: orgaoId != null,
    })
    return {
      ...l, ...(bolas.get(l.taskId) as CamposDaBola), orgaoId, faseAtualKey,
      podeIniciar: motivo === null,
      // Só interessa explicar quem TERIA sentido iniciar (não iniciada e no ponto de entrada).
      motivoNaoIniciar: l.aIniciar && l.statusTarefa === 'NAO_INICIADA' ? motivo : null,
      cobravelVencida: ehCobravelVencido(l),
    }
  })
  return { linhas, total: linhas.length, cobrancasVencidas: linhas.filter((l) => l.cobravelVencida).length }
}
