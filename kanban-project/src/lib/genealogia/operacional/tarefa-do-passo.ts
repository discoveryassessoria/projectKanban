// src/lib/genealogia/operacional/tarefa-do-passo.ts
//
// "CRIAR TAREFA" A PARTIR DO QUE A ÁRVORE APONTA — o rascunho, não a escrita.
//
// A árvore diz o que fazer (próximo passo do motor, próxima ação do cartão,
// documento sem tarefa). Transformar isso em trabalho de alguém é criar uma
// TAREFA — e quem cria tarefa manual é UMA porta só:
// `POST /api/tarefas/manual` → `criarTarefaManual` (lib/operacional/tarefa-ciclo.ts),
// com permissão `tarefas.criar`, motivo obrigatório, auditoria e aviso de
// duplicidade. Este módulo NÃO escreve nada: monta o rascunho (título, descrição,
// pessoa/documento vinculados, chave de origem) e o corpo que essa porta espera.
//
// IDENTIDADE (CLAUDE.md §6): a duplicidade é decidida por ID canônico — a
// necessidade documental, quando o rascunho é de um documento; o FATO DE ORIGEM
// (`chaveOrigem` = id do achado do motor), quando é de um passo. Nunca pelo título.
//
// GRAIN: o rascunho é UMA tarefa. Documento e achado só a ORIGINAM/contextualizam
// (CLAUDE.md §4); não viram tarefa por si e não são somados como trabalho.
//
// PURO: sem prisma, sem rede, sem relógio.

import type { GrafoGenealogico } from "../motor/grafo"
import type { Insight, PassoSugerido } from "../motor/tipos"
import { nomeCompleto } from "../motor/texto"
import type { AcaoRecomendada } from "./diagnostico"
import type { ItemDocumento } from "./fila-da-pessoa"

/** Limite da coluna `Tarefa.titulo`. */
export const LIMITE_TITULO = 200
/** Limite de `Tarefa.correlationId`, onde a chave de origem é gravada. */
export const LIMITE_CHAVE_ORIGEM = 60

export interface RascunhoTarefa {
  titulo: string
  /** A descrição — vai no campo `motivo` da porta (obrigatório lá). Sempre tirada do dado. */
  motivo: string
  pessoaId: number | null
  pessoaNome: string | null
  /** Documento vinculado: o ITEM do catálogo (nome) e a necessidade que o originou. */
  necessidadeId: number | null
  documentoNome: string | null
  /** Fato de origem — a base da idempotência quando não há necessidade. */
  chaveOrigem: string | null
  /** De onde veio o pedido ("Próximo passo", "Próxima ação"...). Vai no modal. */
  origemRotulo: string
}

/** Chave de origem estável e dentro do limite da coluna (hash determinístico no excesso). */
export function chaveDeOrigem(prefixo: string, id: string): string {
  const inteira = `${prefixo}:${id}`
  if (inteira.length <= LIMITE_CHAVE_ORIGEM) return inteira
  let h = 5381
  for (let i = 0; i < inteira.length; i++) h = ((h << 5) + h + inteira.charCodeAt(i)) >>> 0
  const sufixo = h.toString(36)
  return `${inteira.slice(0, LIMITE_CHAVE_ORIGEM - sufixo.length - 1)}~${sufixo}`
}

function semPontoFinal(t: string): string {
  return t.trim().replace(/[.\s]+$/, "")
}

function cortarTitulo(t: string): string {
  return t.length <= LIMITE_TITULO ? t : `${t.slice(0, LIMITE_TITULO - 1)}…`
}

function nomeDe(grafo: GrafoGenealogico, id: number | null | undefined): string | null {
  if (id == null) return null
  const p = grafo.pessoa(id)
  return p ? nomeCompleto(p) : null
}

/**
 * Rascunho de um PRÓXIMO PASSO do motor. Descrição = o achado de origem
 * (título + explicação) e, quando houver, o motivo do passo — nada escrito à mão.
 */
export function rascunhoDoPasso(
  passo: Pick<PassoSugerido, "insightId" | "titulo" | "motivo" | "pessoaIds">,
  insight: Pick<Insight, "titulo" | "explicacao"> | null | undefined,
  grafo: GrafoGenealogico,
): RascunhoTarefa {
  const pessoaId = passo.pessoaIds[0] ?? null
  const pessoaNome = nomeDe(grafo, pessoaId)
  const acao = semPontoFinal(passo.titulo)
  const motivo = insight
    ? `${insight.titulo}. ${insight.explicacao}`.replace(/\s+/g, " ").trim()
    : passo.motivo
  return {
    titulo: cortarTitulo(pessoaNome ? `${acao} — ${pessoaNome}` : acao),
    motivo,
    pessoaId,
    pessoaNome,
    necessidadeId: null,
    documentoNome: null,
    chaveOrigem: chaveDeOrigem("arvore-achado", passo.insightId),
    origemRotulo: "Próximo passo da árvore",
  }
}

/** Rascunho da PRÓXIMA AÇÃO do cartão de resumo. */
export function rascunhoDaProximaAcao(acao: AcaoRecomendada): RascunhoTarefa | null {
  // Sem pessoa ou sem problema de origem não há alvo: "Nenhuma ação necessária"
  // não vira tarefa.
  if (acao.pessoaId == null || acao.problemaId == null) return null
  const base = semPontoFinal(acao.acao)
  return {
    titulo: cortarTitulo(acao.pessoaNome ? `${base} — ${acao.pessoaNome}` : base),
    motivo: acao.motivo,
    pessoaId: acao.pessoaId,
    pessoaNome: acao.pessoaNome,
    necessidadeId: null,
    documentoNome: null,
    chaveOrigem: chaveDeOrigem("arvore-problema", acao.problemaId),
    origemRotulo: "Próxima ação da árvore",
  }
}

/**
 * Rascunho de um DOCUMENTO que ainda não tem tarefa. A duplicidade aqui é
 * decidida pela NECESSIDADE (a porta já faz isso), por isso não há chave de origem.
 */
export function rascunhoDoDocumento(
  item: Pick<ItemDocumento, "necessidadeId" | "nome" | "rotuloEstado">,
  pessoaId: number | null,
  pessoaNome: string | null,
  /** Sugestão de onde localizar (tirada do motor), anexada à descrição. */
  dica?: string | null,
): RascunhoTarefa {
  const base = `Documento ${item.nome}${pessoaNome ? ` de ${pessoaNome}` : ""} está "${item.rotuloEstado}" e não há tarefa aberta para ele.`
  return {
    titulo: cortarTitulo(pessoaNome ? `${item.nome} — ${pessoaNome}` : item.nome),
    motivo: dica ? `${base} ${dica}` : base,
    pessoaId,
    pessoaNome,
    necessidadeId: item.necessidadeId,
    documentoNome: item.nome,
    chaveOrigem: null,
    origemRotulo: "Documento sem tarefa",
  }
}

export interface OpcoesCriacao {
  responsavelId?: number | null
  /** yyyy-mm-dd. */
  dataPrazo?: string | null
  confirmarDuplicidade?: boolean
}

/** Corpo EXATO que `POST /api/tarefas/manual` espera. */
export function corpoDaCriacao(
  r: RascunhoTarefa,
  processoId: number,
  o: OpcoesCriacao & { titulo?: string; motivo?: string } = {},
): Record<string, unknown> {
  return {
    processoId,
    titulo: (o.titulo ?? r.titulo).trim(),
    motivo: (o.motivo ?? r.motivo).trim(),
    pessoaId: r.pessoaId,
    necessidadeId: r.necessidadeId,
    chaveOrigem: r.chaveOrigem,
    ...(o.responsavelId != null ? { responsavelId: o.responsavelId } : {}),
    ...(o.dataPrazo ? { dataPrazo: o.dataPrazo } : {}),
    ...(o.confirmarDuplicidade ? { confirmarDuplicidade: true } : {}),
  }
}

/**
 * Rascunho da certidão de NATURALIZAÇÃO do ascendente transmissor. A duplicidade é
 * decidida pelo fato de origem (o id do achado), nunca pelo título.
 */
export function rascunhoDaNaturalizacao(
  n: { id: string; titulo: string; explicacao: string; acao: string },
  pessoaId: number,
  pessoaNome: string | null,
): RascunhoTarefa {
  return {
    titulo: cortarTitulo(pessoaNome ? `Certidão de naturalização — ${pessoaNome}` : semPontoFinal(n.acao)),
    motivo: `${semPontoFinal(n.titulo)}. ${n.explicacao}`.replace(/\s+/g, " ").trim(),
    pessoaId,
    pessoaNome,
    necessidadeId: null,
    documentoNome: null,
    chaveOrigem: chaveDeOrigem("arvore-achado", n.id),
    origemRotulo: "Naturalização do ascendente transmissor",
  }
}
