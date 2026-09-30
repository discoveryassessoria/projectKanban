// src/services/genealogia/simular-impacto.ts
//
// PREVIEW DE IMPACTO — o motor oficial roda de verdade, e nada é gravado.
//
// O PROBLEMA. Dizer ao operador "marcar Giuseppe como falecido vai gerar a
// Certidão de Óbito" exige saber o que as Regras Documentais publicadas
// decidem para aquele processo, naquela fase, com aquele sujeito. Reimplementar
// essa decisão aqui produziria um preview que MENTE assim que a regra mudar —
// e seria exatamente o segundo motor documental que a Constituição proíbe.
//
// A SOLUÇÃO. Aplicar a mudança proposta e rodar `materializarGenealogia` — o
// materializador OFICIAL, o mesmo que roda no save real — dentro de uma
// transação que termina em ROLLBACK. O delta entre o antes e o depois é o
// impacto. Zero lógica duplicada: se a regra mudar amanhã, o preview muda junto,
// porque é a mesma função.
//
// POR QUE O ROLLBACK É GARANTIDO, E NÃO UMA PROMESSA. A transação termina
// SEMPRE lançando `RollbackDaSimulacao`. Não existe caminho de saída que faça
// commit: mesmo que alguém acrescente uma escrita aqui dentro por engano, ela é
// desfeita. O resultado viaja dentro da própria exceção. É a diferença entre
// "não escrevemos" e "não é possível escrever".
//
// O QUE ESTE MÓDULO NÃO FAZ:
//   • não chama o motor financeiro. `aplicarHonorariosPorRequerente` usa o
//     `prisma` global internamente — chamá-lo daqui escreveria FORA da
//     transação, e o rollback não o alcançaria. O impacto financeiro é relatado
//     como aplicabilidade, sem valor inventado (ver `financeiro` abaixo);
//   • não chama `materializarExecucaoDaFase`: ele não recebe transaction client,
//     então não há como simulá-lo sem escrever;
//   • não decide nada sobre documento. Quem decide é a regra publicada.

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { materializarGenealogia } from "@/src/services/genealogia/materializar-genealogia"
import { removerNecessidadesDaUniao } from "@/src/services/necessidade-documental"

type DB = Prisma.TransactionClient

/**
 * Prazo da simulação. Generoso porque o materializador percorre todas as
 * pessoas da árvore contra um banco remoto — o mesmo motivo pelo qual a
 * exclusão de pessoa precisou de 60s.
 */
const PRAZO_SIMULACAO_MS = 60_000

/** Campos da Pessoa que a simulação aceita mudar. Lista fechada de propósito. */
export interface MudancasPropostas {
  vivo?: boolean
  data_obito?: string | null
  casado?: boolean
  paiId?: number | null
  maeId?: number | null
  requerente?: string | null
  linhaReta?: boolean
  documentacao?: boolean
}

export interface UniaoProposta {
  acao: "criar" | "remover"
  /** Para "criar": o cônjuge. Para "remover": a união existente. */
  conjugeId?: number
  uniaoId?: number
}

export interface EntradaSimulacao {
  processoId: number
  pessoaId: number
  mudancas?: MudancasPropostas
  uniao?: UniaoProposta
  /**
   * Simula a REMOÇÃO da pessoa da árvore. Dentro do rollback: as uniões dela saem
   * (com as necessidades de casamento, como na remoção real) e o nó é marcado
   * `removidaEm` — que é o recorte que o motor lê. Não reusa `removerPessoaDaArvore`
   * (abre transação própria e commitaria); o efeito que o motor enxerga é o mesmo.
   */
  removerPessoa?: boolean
}

/** Tarefa ABERTA que a mudança vai tirar da fila (ou marcar para decisão). */
export interface TarefaAfetada {
  tarefaId: number
  titulo: string
  pessoaNome: string | null
  responsavelNome: string | null
  /** CANCELADA = nunca iniciada, sai da fila. DECISAO = já iniciada: fica marcada para decisão humana, não é destruída. */
  efeito: "CANCELADA" | "DECISAO"
}

/** Documento que passará a NAO_EXIGIDO (a árvore deixou de exigi-lo). */
export interface DocumentoAfetado {
  documentoId: number
  documento: string
  pessoaNome: string | null
}

export interface ItemDocumental {
  necessidadeId: number
  pessoaId: number | null
  pessoaNome: string | null
  /** Nome do item no Cadastro Mestre — nunca um código técnico na tela. */
  documento: string
  obrigatoriedade: string
  status: string
}

export interface DeltaDocumental {
  /** Obrigações que passam a existir. */
  adicionados: ItemDocumental[]
  /**
   * Obrigações que deixam de ser aplicáveis. O motor as DISPENSA (reversível) e
   * só quando ainda estavam PENDENTE — o que já começou preserva histórico.
   */
  dispensados: ItemDocumental[]
  /** Obrigações dispensadas que voltam a ser aplicáveis. */
  reativados: ItemDocumental[]
  inalterados: number
}

export interface DeltaOperacional {
  /** Passos de workflow que nascem (é deles que a tarefa é projetada). */
  passosAdicionados: number
  /**
   * Tarefas PREVISTAS. O materializador da genealogia cria o passo; a tarefa é
   * projeção dele. O número é o de passos que geram tarefa — não se cria tarefa
   * nenhuma aqui.
   */
  tarefasPrevistas: number
  bloqueiosAdicionados: number
  bloqueiosRemovidos: number
}

export interface DeltaLinhagem {
  /** Requerentes cuja cadeia muda. Nomes, não ids, para a tela. */
  requerentesAfetados: Array<{ pessoaId: number; nome: string }>
  entramNaLinha: number[]
  saemDaLinha: number[]
  /** true quando o ascendente transmissor de alguma linha muda. */
  transmissorAlterado: boolean
  caminhoInterrompido: boolean
}

export interface DeltaFinanceiro {
  /** false quando o usuário não tem `financeiro.ver`. */
  visivel: boolean
  /** true quando a mudança dispara o recálculo financeiro canônico. */
  recalculoPrevisto: boolean
  /**
   * Explicação honesta. NUNCA um valor: o valor é resolvido pela Tabela de
   * Preços no momento da execução, pelo motor financeiro — não por aqui.
   */
  observacao: string
}

export interface ResultadoSimulacao {
  processoId: number
  pessoaId: number
  documental: DeltaDocumental
  operacional: DeltaOperacional
  /** Tarefas abertas que serão canceladas / marcadas para decisão — o que o operador precisa ver ANTES de confirmar. */
  tarefasAfetadas: TarefaAfetada[]
  /** Documentos que passarão a "Não exigido". */
  documentosNaoExigidos: DocumentoAfetado[]
  financeiro: DeltaFinanceiro
  /** Avisos do materializador (regra não publicada, item sem catálogo etc.). */
  pendencias: string[]
  /** true quando nada muda em documento, passo ou tarefa. */
  semImpacto: boolean
  /** Prova de que a simulação não gravou. Sempre true — ver o rollback. */
  somenteLeitura: true
}

/** Sentinela que carrega o resultado e garante o rollback. */
class RollbackDaSimulacao extends Error {
  constructor(readonly payload: Omit<ResultadoSimulacao, "somenteLeitura">) {
    super("simulação concluída — transação revertida por desenho")
    this.name = "RollbackDaSimulacao"
  }
}

interface TarefaRetrato {
  id: number; titulo: string; pessoaNome: string | null; responsavelNome: string | null
  statusTarefa: string; causaRemovidaEm: Date | null
}
interface DocumentoRetrato { id: number; status: string; documento: string; pessoaNome: string | null }

interface Retrato {
  tarefas: Map<number, TarefaRetrato>
  documentos: Map<number, DocumentoRetrato>
  necessidades: Map<number, ItemDocumental>
  passos: Set<number>
  passosQueGeramTarefa: number
  bloqueios: number
}

async function retratar(db: DB, processoId: number): Promise<Retrato> {
  const nomeDe = (p: { nome: string; sobrenome: string | null } | null | undefined) =>
    p ? `${p.nome}${p.sobrenome ? ` ${p.sobrenome}` : ""}` : null
  const proc = await db.processo.findUnique({ where: { id: processoId }, select: { arvoreId: true } })
  const tarefasRaw = await db.tarefa.findMany({
    where: { processoId, statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] }, OR: [{ necessidadeId: { not: null } }, { documentoId: { not: null } }] },
    select: { id: true, titulo: true, pessoaId: true, statusTarefa: true, causaRemovidaEm: true, responsavel: { select: { nome: true } } },
  })
  const pessoasDasTarefas = tarefasRaw.length
    ? await db.pessoa.findMany({ where: { id: { in: tarefasRaw.map((t) => t.pessoaId).filter((x): x is number => x != null) } }, select: { id: true, nome: true, sobrenome: true } })
    : []
  const pessoaPorId = new Map(pessoasDasTarefas.map((p) => [p.id, p]))
  const docsRaw = proc?.arvoreId
    ? await db.documento.findMany({
        where: { pessoa: { arvoreId: proc.arvoreId } },
        select: { id: true, status: true, descricao: true, documentType: { select: { name: true } }, pessoa: { select: { nome: true, sobrenome: true } } },
      })
    : []
  const [necessidades, passos] = await Promise.all([
    db.necessidadeDocumental.findMany({
      where: { processoId },
      select: {
        id: true,
        pessoaId: true,
        status: true,
        obrigatoriedade: true,
        itemCatalogo: { select: { name: true, code: true } },
        pessoa: { select: { nome: true, sobrenome: true } },
      },
    }),
    db.phaseWorkflowStepInstance.findMany({
      where: { processoId },
      select: { id: true, geraTarefa: true },
    }),
  ])

  const mapa = new Map<number, ItemDocumental>()
  let bloqueios = 0
  for (const n of necessidades) {
    if (n.status === "NAO_LOCALIZADA") bloqueios++
    mapa.set(n.id, {
      necessidadeId: n.id,
      pessoaId: n.pessoaId,
      pessoaNome: n.pessoa
        ? `${n.pessoa.nome}${n.pessoa.sobrenome ? ` ${n.pessoa.sobrenome}` : ""}`
        : null,
      // Nome do Cadastro Mestre primeiro; o code é o último recurso, e mesmo
      // assim é o código do CATÁLOGO, não um identificador interno.
      documento: n.itemCatalogo?.name ?? n.itemCatalogo?.code ?? `Item #${n.id}`,
      obrigatoriedade: n.obrigatoriedade,
      status: n.status,
    })
  }

  return {
    tarefas: new Map(tarefasRaw.map((t) => [t.id, {
      id: t.id, titulo: t.titulo, pessoaNome: nomeDe(t.pessoaId != null ? pessoaPorId.get(t.pessoaId) : null),
      responsavelNome: t.responsavel?.nome ?? null, statusTarefa: t.statusTarefa, causaRemovidaEm: t.causaRemovidaEm,
    }])),
    documentos: new Map(docsRaw.map((d) => [d.id, {
      id: d.id, status: d.status, documento: d.documentType?.name ?? d.descricao ?? `Documento #${d.id}`, pessoaNome: nomeDe(d.pessoa),
    }])),
    necessidades: mapa,
    passos: new Set(passos.map((p) => p.id)),
    passosQueGeramTarefa: passos.filter((p) => p.geraTarefa).length,
    bloqueios,
  }
}

/**
 * Simula o impacto de uma alteração de pessoa. READ-ONLY por construção.
 *
 * `financeiroVisivel` chega de fora (da rota, que checou a permissão): decidir
 * permissão aqui duplicaria a autorização que já existe no servidor.
 */
export async function simularImpactoPessoa(
  entrada: EntradaSimulacao,
  financeiroVisivel: boolean,
): Promise<ResultadoSimulacao> {
  try {
    await prisma.$transaction(
      async (tx) => {
        const antes = await retratar(tx, entrada.processoId)

        await aplicarMudancaProposta(tx, entrada)

        // O MOTOR OFICIAL. Mesma função do save real, com o tx no lugar do prisma.
        const relatorio = await materializarGenealogia(entrada.processoId, tx, { motivo: "simulação de impacto (nada é gravado)" })

        const depois = await retratar(tx, entrada.processoId)
        const { tarefasAfetadas, documentosNaoExigidos } = compararTarefasEDocumentos(antes, depois)

        throw new RollbackDaSimulacao({
          processoId: entrada.processoId,
          pessoaId: entrada.pessoaId,
          documental: compararDocumental(antes, depois),
          operacional: {
            passosAdicionados: relatorio.stepsCriados,
            tarefasPrevistas: Math.max(
              0,
              depois.passosQueGeramTarefa - antes.passosQueGeramTarefa,
            ),
            bloqueiosAdicionados: Math.max(0, depois.bloqueios - antes.bloqueios),
            bloqueiosRemovidos: Math.max(0, antes.bloqueios - depois.bloqueios),
          },
          tarefasAfetadas,
          documentosNaoExigidos,
          financeiro: avaliarFinanceiro(entrada, financeiroVisivel),
          pendencias: relatorio.pendencias,
          semImpacto: false, // recalculado abaixo, com o delta em mãos
        })
      },
      { timeout: PRAZO_SIMULACAO_MS, maxWait: 10_000 },
    )
  } catch (e) {
    if (e instanceof RollbackDaSimulacao) {
      const p = e.payload
      const semImpacto =
        p.documental.adicionados.length === 0 &&
        p.documental.dispensados.length === 0 &&
        p.documental.reativados.length === 0 &&
        p.operacional.passosAdicionados === 0 &&
        p.operacional.bloqueiosAdicionados === 0 &&
        p.operacional.bloqueiosRemovidos === 0 &&
        p.tarefasAfetadas.length === 0 &&
        p.documentosNaoExigidos.length === 0
      return { ...p, semImpacto, somenteLeitura: true }
    }
    throw e
  }

  // Inalcançável: o bloco acima sempre lança. Existe para o tipo fechar e para
  // que uma refatoração que remova o `throw` quebre aqui, em vez de silenciosamente
  // passar a COMMITAR a simulação.
  throw new Error("simulação não produziu resultado — o rollback foi removido?")
}

/**
 * Tarefa aberta ANTES que sumiu da fila (CANCELADA) ou ganhou `causaRemovidaEm`
 * (já iniciada — marcada para decisão) DEPOIS; e Documento que virou NAO_EXIGIDO.
 * Delta do MESMO motor — nenhuma regra recalculada aqui.
 */
function compararTarefasEDocumentos(antes: Retrato, depois: Retrato): { tarefasAfetadas: TarefaAfetada[]; documentosNaoExigidos: DocumentoAfetado[] } {
  const tarefasAfetadas: TarefaAfetada[] = []
  for (const [id, t] of antes.tarefas) {
    const d = depois.tarefas.get(id)
    if (!d) tarefasAfetadas.push({ tarefaId: id, titulo: t.titulo, pessoaNome: t.pessoaNome, responsavelNome: t.responsavelNome, efeito: "CANCELADA" })
    else if (t.causaRemovidaEm == null && d.causaRemovidaEm != null) {
      tarefasAfetadas.push({ tarefaId: id, titulo: t.titulo, pessoaNome: t.pessoaNome, responsavelNome: t.responsavelNome, efeito: "DECISAO" })
    }
  }
  const documentosNaoExigidos: DocumentoAfetado[] = []
  for (const [id, d] of depois.documentos) {
    const a = antes.documentos.get(id)
    if (a && a.status !== "NAO_EXIGIDO" && d.status === "NAO_EXIGIDO") {
      documentosNaoExigidos.push({ documentoId: id, documento: d.documento, pessoaNome: d.pessoaNome })
    }
  }
  tarefasAfetadas.sort((x, y) => x.titulo.localeCompare(y.titulo) || x.tarefaId - y.tarefaId)
  documentosNaoExigidos.sort((x, y) => x.documento.localeCompare(y.documento) || x.documentoId - y.documentoId)
  return { tarefasAfetadas, documentosNaoExigidos }
}

function compararDocumental(antes: Retrato, depois: Retrato): DeltaDocumental {
  const adicionados: ItemDocumental[] = []
  const dispensados: ItemDocumental[] = []
  const reativados: ItemDocumental[] = []
  let inalterados = 0

  for (const [id, item] of depois.necessidades) {
    const anterior = antes.necessidades.get(id)
    if (!anterior) {
      adicionados.push(item)
      continue
    }
    if (anterior.status !== item.status) {
      if (item.status === "DISPENSADA") dispensados.push(item)
      else if (anterior.status === "DISPENSADA") reativados.push(item)
      else inalterados++
      continue
    }
    inalterados++
  }

  // Ordem estável para a tela e para o teste.
  const porNome = (a: ItemDocumental, b: ItemDocumental) =>
    a.documento.localeCompare(b.documento) || a.necessidadeId - b.necessidadeId
  adicionados.sort(porNome)
  dispensados.sort(porNome)
  reativados.sort(porNome)

  return { adicionados, dispensados, reativados, inalterados }
}

/**
 * Aplica a mudança proposta DENTRO da transação que será revertida.
 * Só toca Pessoa e Uniao — os dois cadastros cujos atributos as Regras
 * Documentais leem. Nada de necessidade, documento, tarefa ou lançamento.
 */
async function aplicarMudancaProposta(db: DB, entrada: EntradaSimulacao): Promise<void> {
  const { pessoaId, mudancas, uniao } = entrada

  if (mudancas && Object.keys(mudancas).length > 0) {
    const data: Prisma.PessoaUpdateInput = {}
    if (mudancas.vivo !== undefined) data.vivo = mudancas.vivo
    if (mudancas.data_obito !== undefined) {
      data.data_obito = mudancas.data_obito ? new Date(mudancas.data_obito) : null
    }
    if (mudancas.casado !== undefined) data.casado = mudancas.casado
    if (mudancas.requerente !== undefined) data.requerente = mudancas.requerente
    if (mudancas.linhaReta !== undefined) data.linhaReta = mudancas.linhaReta
    if (mudancas.documentacao !== undefined) data.documentacao = mudancas.documentacao
    if (mudancas.paiId !== undefined) {
      data.pai = mudancas.paiId ? { connect: { id: mudancas.paiId } } : { disconnect: true }
    }
    if (mudancas.maeId !== undefined) {
      data.mae = mudancas.maeId ? { connect: { id: mudancas.maeId } } : { disconnect: true }
    }
    if (Object.keys(data).length > 0) {
      await db.pessoa.update({ where: { id: pessoaId }, data })
    }
  }

  if (uniao?.acao === "criar" && uniao.conjugeId) {
    await db.uniao.create({
      data: { pessoa1Id: pessoaId, pessoa2Id: uniao.conjugeId, tipo: "casamento_civil" },
    })
    // Casar é mudar estado civil: a flag que as Regras Documentais leem precisa
    // acompanhar, senão a simulação diria que criar união não gera exigência.
    await db.pessoa.updateMany({
      where: { id: { in: [pessoaId, uniao.conjugeId] } },
      data: { casado: true },
    })
  }

  if (uniao?.acao === "remover" && uniao.uniaoId) {
    // Como na remoção real: as necessidades da união saem ANTES (o CHECK
    // `sujeito_xor` recusaria apagar a união com necessidade apontando para ela).
    await removerNecessidadesDaUniao(uniao.uniaoId, db)
    await db.uniao.delete({ where: { id: uniao.uniaoId } })
  }

  if (entrada.removerPessoa) {
    const unioes = await db.uniao.findMany({ where: { OR: [{ pessoa1Id: pessoaId }, { pessoa2Id: pessoaId }] }, select: { id: true } })
    for (const u of unioes) {
      await removerNecessidadesDaUniao(u.id, db)
      await db.uniao.delete({ where: { id: u.id } })
    }
    await db.pessoa.update({ where: { id: pessoaId }, data: { removidaEm: new Date(), requerente: "nao" } })
  }
}

/**
 * Impacto financeiro: aplicabilidade, nunca valor.
 *
 * O motor financeiro canônico dispara no evento de requerente. Dizer SE ele vai
 * disparar é fato conhecido; dizer QUANTO exigiria resolver a Tabela de Preços,
 * que é do motor financeiro e roda na execução real. Um número estimado aqui
 * seria um número que a fatura depois contradiz.
 */
function avaliarFinanceiro(entrada: EntradaSimulacao, visivel: boolean): DeltaFinanceiro {
  const mexeEmRequerente = entrada.mudancas?.requerente !== undefined

  if (!visivel) {
    return {
      visivel: false,
      recalculoPrevisto: mexeEmRequerente,
      observacao: "Sem permissão para ver impacto financeiro.",
    }
  }
  if (!mexeEmRequerente) {
    return {
      visivel: true,
      recalculoPrevisto: false,
      observacao: "Nenhum impacto financeiro previsto.",
    }
  }
  return {
    visivel: true,
    recalculoPrevisto: true,
    observacao:
      "Mudar o vínculo de requerente dispara o recálculo dos honorários pelo motor financeiro. O valor é resolvido pela Tabela de Preços na execução — não é estimado aqui.",
  }
}
