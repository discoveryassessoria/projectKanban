// lib/operacional/identidade-da-tarefa.ts
// ============================================================================
// O QUE FAZ DUAS TAREFAS SEREM A MESMA TAREFA.
//
// Esta pergunta tinha DUAS respostas no sistema, e foi a divergência entre elas
// que produziu o caso do Ademir: a mesma certidão (documento 2111) virou duas
// tarefas vivas, atribuídas à mesma pessoa, dizendo a mesma coisa.
//
//   #3358  tarefa::proc:523::nec:190::pes:2692::ciclo:1     (reconciliador)
//   #3359  unidade|proc523|doc2111|pes0|roleprincipal|c1    (mudança de fase)
//
// Nenhuma das duas conseguia enxergar a outra. Três defeitos somados:
//
//   1. DOIS FORMATOS. Chaves diferentes para a mesma pergunta — quem procura em
//      um formato nunca encontra o que foi escrito no outro.
//
//   2. IDENTIDADE POR CADEIA DE FALLBACK. "necessidade se houver, senão
//      documento" faz a MESMA unidade ter identidades diferentes conforme o
//      escritor soubesse ou não da necessidade. Documento 2111 pertence à
//      necessidade 190: `nec190` e `doc2111` são a mesma coisa dita de dois
//      jeitos, e a chave tratava como duas.
//
//   3. PAPEL DENTRO DA IDENTIDADE. `role` faz a mesma obrigação render uma
//      tarefa por papel — e a regra do domínio é "uma obrigação real, uma
//      tarefa". Papel é atributo do trabalho, não o trabalho.
//
// Aqui a resposta é UMA, e ela é NORMALIZADA antes de virar chave: qualquer que
// seja o lado por onde o escritor conhece a unidade — a necessidade, o
// documento, a pessoa —, a identidade resultante é a mesma.
// ============================================================================

import type { Prisma, PrismaClient } from '@prisma/client'

/** Aceita o cliente global e o `tx` de uma transação — ambos leem igual. */
type Leitor = PrismaClient | Prisma.TransactionClient

/**
 * A UNIDADE DE TRABALHO — o que a tarefa representa.
 *
 * `ciclo` faz parte: remateralizar a fase num ciclo novo é trabalho novo, e
 * confundir os dois faria a tarefa do ciclo anterior ser reaproveitada para uma
 * exigência que já é outra.
 */
export interface UnidadeDeTrabalho {
  processoId: number
  necessidadeId?: number | null
  documentoId?: number | null
  pessoaId?: number | null
  /**
   * O ciclo DA OBRIGAÇÃO — não o da fase.
   *
   * A distinção não é sutil: o ciclo da fase sobe toda vez que alguém volta e
   * avança de novo, e usá-lo na identidade fazia a MESMA certidão virar uma
   * tarefa por ida e volta. O ciclo da obrigação sobe quando a exigência é
   * outra — e aí o trabalho é mesmo outro.
   *
   * Quem chama passa o ciclo que tiver; a normalização troca pelo da obrigação
   * quando existe uma.
   */
  ciclo: number
  /**
   * Último recurso: passo administrativo de fase, que não pertence a documento
   * nem a pessoa nenhuma. Sem isto ele não teria identidade alguma.
   */
  stepInstanceId?: number | null
}

/**
 * A UNIDADE, DITA DO MESMO JEITO POR TODO MUNDO.
 *
 * Completa o que o chamador não sabia a partir do que ele sabia: o documento
 * conhece a sua necessidade e o seu dono; a necessidade conhece o seu sujeito.
 * Depois disto, dois escritores que conhecem a mesma unidade por lados
 * diferentes produzem exatamente o mesmo objeto.
 *
 * NÃO INVENTA VÍNCULO: o que o banco não relaciona continua nulo.
 */
export async function normalizarUnidade(db: Leitor, u: UnidadeDeTrabalho): Promise<UnidadeDeTrabalho> {
  let { necessidadeId = null, documentoId = null, pessoaId = null } = u

  let ciclo = u.ciclo

  if (documentoId != null) {
    const doc = await db.documento.findUnique({
      where: { id: documentoId },
      select: { necessidadeId: true, pessoaId: true },
    })
    necessidadeId = necessidadeId ?? doc?.necessidadeId ?? null
    pessoaId = pessoaId ?? doc?.pessoaId ?? null
  }

  if (necessidadeId != null) {
    const nec = await db.necessidadeDocumental.findUnique({
      where: { id: necessidadeId },
      select: { pessoaId: true, ciclo: true },
    })
    pessoaId = pessoaId ?? nec?.pessoaId ?? null
    // O CICLO PASSA A SER O DA OBRIGAÇÃO. Voltar e avançar de fase abre um ciclo
    // NOVO da fase sobre a MESMA exigência: com o ciclo da fase na identidade,
    // cada ida e volta rendia mais uma tarefa para a mesma certidão.
    if (nec) ciclo = nec.ciclo
  }

  return { ...u, necessidadeId, documentoId, pessoaId, ciclo }
}

/**
 * A CHAVE — derivada de uma unidade JÁ NORMALIZADA.
 *
 * A obrigação vence o documento porque ela é a razão do trabalho: o documento é
 * onde o trabalho se materializa e pode ser trocado (um arquivo substituído,
 * uma segunda via) sem que o trabalho mude. Só quando não existe obrigação
 * registrada o documento responde por ela.
 *
 * Sem título e sem etapa, de propósito: o título é rótulo e muda; a etapa
 * corrente muda sete vezes durante a mesma tarefa.
 */
export function chaveDaUnidade(u: UnidadeDeTrabalho): string {
  const obrigacao =
    u.necessidadeId != null ? `nec${u.necessidadeId}`
    : u.documentoId != null ? `doc${u.documentoId}`
    : `stepinst${u.stepInstanceId ?? 0}`
  return `unidade|proc${u.processoId}|${obrigacao}|pes${u.pessoaId ?? 0}|c${u.ciclo}`
}

/** Normalizar e chavear numa chamada — o caminho que os escritores usam. */
export async function identidadeDaUnidade(
  db: Leitor,
  u: UnidadeDeTrabalho,
): Promise<{ chave: string; unidade: UnidadeDeTrabalho }> {
  const unidade = await normalizarUnidade(db, u)
  return { chave: chaveDaUnidade(unidade), unidade }
}

/** Estados em que a tarefa já não representa trabalho aberto. */
export const TERMINAIS_DA_UNIDADE = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA'] as const

/**
 * A TAREFA QUE JÁ EXISTE PARA ESTA UNIDADE — procurada pelo VÍNCULO, não pela
 * chave.
 *
 * Procurar por chave só encontra o que foi escrito no formato de hoje. As
 * tarefas de ontem carregam os formatos de ontem, e é justamente contra elas
 * que a busca precisa funcionar: encontrar "não existe" é o que faz nascer a
 * segunda tarefa da mesma obrigação.
 *
 * As colunas, ao contrário da chave, sempre estiveram lá. `processoId` +
 * obrigação + ciclo respondem à pergunta sem depender de arqueologia de string.
 *
 * Só devolve trabalho ABERTO: uma tarefa concluída no mesmo ciclo é história, e
 * história não é reaproveitada como se fosse pendência.
 */
export async function tarefaVivaDaUnidade(
  db: Leitor,
  u: UnidadeDeTrabalho,
): Promise<{ id: number; workflowInstanceId: number | null; workflowStepInstanceId: number | null; statusTarefa: string; chaveIdempotencia: string | null } | null> {
  const porObrigacao: Prisma.TarefaWhereInput[] = []
  if (u.necessidadeId != null) porObrigacao.push({ necessidadeId: u.necessidadeId })
  if (u.documentoId != null) porObrigacao.push({ documentoId: u.documentoId })
  // Sem obrigação identificável, a unidade é o próprio passo — e o passo já é
  // único por construção. Não há o que procurar.
  if (porObrigacao.length === 0) return null

  const achada = await db.tarefa.findFirst({
    where: {
      processoId: u.processoId,
      ciclo: u.ciclo,
      statusTarefa: { notIn: [...TERMINAIS_DA_UNIDADE] },
      OR: porObrigacao,
    },
    // A MAIS ANTIGA vence: ela é a identidade original do trabalho, e é o
    // histórico dela que as pessoas reconhecem.
    orderBy: { id: 'asc' },
    select: { id: true, workflowInstanceId: true, workflowStepInstanceId: true, statusTarefa: true, chaveIdempotencia: true },
  })
  return achada
}
