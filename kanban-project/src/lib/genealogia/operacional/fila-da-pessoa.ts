// src/lib/genealogia/operacional/fila-da-pessoa.ts
//
// FILA DE TRABALHO DA PESSOA — a aba Operação (Etapa 4 da reforma da árvore).
//
// Substitui os contadores (Exig./Receb./Pend./Diverg./Tarefas) por uma LISTA: cada
// documento real da pessoa, com o ESTADO que ele tem agora e a PRÓXIMA AÇÃO que
// leva ao alvo real. As divergências do motor genealógico entram na MESMA fila.
//
// ─── GRAIN ─────────────────────────────────────────────────────────────────
// Cada item é UM DOCUMENTO (uma NecessidadeDocumental) ou UM ACHADO DO MOTOR.
// Nada aqui é "tarefa": a tarefa só aparece como DESTINO do botão (deep-link),
// nunca como item, nunca somada (CLAUDE.md §4/§5/§15). Tarefa vencida/aberta
// continua NÃO sendo pendência de árvore.
//
// ─── DE ONDE VEM O ESTADO (nenhum é recalculado aqui) ──────────────────────
// A situação de uma certidão é PROJEÇÃO oficial (`situacaoDaSolicitacaoCertidao`,
// `src/lib/process-stage/situacao-solicitacao-certidao.ts`), calculada no servidor
// por `projecoesDeCertidaoPorNecessidade` e entregue em `situacaoCertidao`. Este
// módulo só TRADUZ a situação oficial para o rótulo da fila — mapeamento fechado:
//
//   status da necessidade     situação oficial    →  estado da fila   rótulo
//   ────────────────────────  ──────────────────     ───────────────  ─────────────
//   NAO_LOCALIZADA (marcada)  (qualquer)             bloqueado        Bloqueado
//   (outro)                   NAO_LOCALIZADA          a_localizar      A localizar
//   (outro)                   NAO_SOLICITADA          a_solicitar      A solicitar
//   (outro)                   PENDENTE  (enviado)     solicitado       Solicitado
//   (outro)                   SOLICITADO (cartório    solicitado       Solicitado
//                             confirmou)
//   (outro)                   RECEBIDA                recebido         Recebido
//   (outro)                   DISPENSADA              dispensado       Dispensado
//
// NÃO MAPEADO (e por isso NÃO inventado): "conferido". Conferir/validar a certidão
// é uma SUBTAREFA do mesmo passo (decisão 14-15/09/2026: nunca um quinto passo) e
// `situacaoDaSolicitacaoCertidao` não tem um estado para ela — uma certidão
// conferida continua "RECEBIDA" até o passo fechar. Criar o rótulo exigiria uma
// segunda fonte do mesmo fato. Fica registrado como lacuna da projeção oficial.
//
// "bloqueado" segue a MESMA régua de `documental/indicadores.ts` (status
// NAO_LOCALIZADA da necessidade = "há obrigatória marcada como não localizada"),
// que o resumo da linhagem e a saúde já usam.
//
// PURO: sem prisma, sem rede, sem relógio.

import { ehFaseAguardandoFechamento, ROTULO_AGUARDANDO_FECHAMENTO } from "../../process-stage/fase-pre-contrato"
import type { AchadoDoMotor } from "./achados-do-motor"
import { ROTULO_CATEGORIA_ACHADO } from "./achados-do-motor"
import type { NecessidadeOficial } from "../documental/indicadores"
import { PREFIXO_CONJUGE_AUSENTE, PREFIXO_UNIAO_IMPLICITA } from "../motor/regras/sugestoes"

// ── CONTRATOS ───────────────────────────────────────────────────────────────

/** A situação oficial da certidão (espelho de `SituacaoSolicitacaoCertidao`). */
export type SituacaoOficialCertidao =
  | "NAO_LOCALIZADA" | "NAO_SOLICITADA" | "PENDENTE" | "SOLICITADO" | "RECEBIDA" | "DISPENSADA"

/** Necessidade como o endpoint a entrega: o oficial + a situação projetada. */
export interface NecessidadeDaFila extends NecessidadeOficial {
  /** Projeção oficial (`projecoesDeCertidaoPorNecessidade`). null = não projetada. */
  situacaoCertidao?: SituacaoOficialCertidao | null
}

export interface TarefaDaFila {
  id: number
  titulo: string
  concluida: boolean
  statusTarefa?: string | null
  necessidadeId?: number | null
}

export type EstadoDocumento =
  | "bloqueado" | "a_localizar" | "a_solicitar" | "solicitado" | "recebido" | "dispensado"

export const ROTULO_ESTADO_DOCUMENTO: Record<EstadoDocumento, string> = {
  bloqueado: "Bloqueado",
  a_localizar: "A localizar",
  a_solicitar: "A solicitar",
  solicitado: "Solicitado",
  recebido: "Recebido",
  dispensado: "Dispensado",
}

/** O que o botão do item faz. Cada tipo tem UM handler real na tela. */
export type AcaoFila =
  | { tipo: "abrir_tarefa"; rotulo: string; tarefaId: number; processoId: number }
  | { tipo: "abrir_pessoa"; rotulo: string; pessoaId: number }
  | { tipo: "ver_no_mapa"; rotulo: string; pessoaId: number }
  | { tipo: "vincular_conjuge"; rotulo: string; pessoaId: number; outraPessoaId: number | null }

export interface ItemDocumento {
  tipo: "documento"
  chave: string
  necessidadeId: number
  nome: string
  estado: EstadoDocumento
  rotuloEstado: string
  /** Texto de apoio tirado do dado (ex.: previsão de retorno). Nunca inventado. */
  detalhe: string | null
  opcional: boolean
  /** Ordem de exibição (menor = mais urgente). */
  ordem: number
  acoes: AcaoFila[]
}

export interface ItemDivergencia {
  tipo: "divergencia"
  chave: string
  achadoId: string
  titulo: string
  explicacao: string
  /** "Crítico · Divergência de dados" — rótulo oficial da categoria. */
  rotuloEstado: string
  impeditivo: boolean
  ordem: number
  acoes: AcaoFila[]
}

export type ItemFila = ItemDocumento | ItemDivergencia

export interface FilaDaPessoa {
  /**
   * true quando o processo ainda está na antessala (fase "Aguardando fechamento")
   * e a pessoa não tem exigência: nada nasce antes de entrar em Genealogia.
   * A tela diz isso em vez de "Sem exigência" com zeros.
   */
  antesDaGenealogia: boolean
  itens: ItemFila[]
  /** Primeiro item que pede ação (com botão). null = nada pendente. */
  proximo: ItemFila | null
}

export interface EntradaFila {
  pessoaId: number
  processoId: number
  /** `Processo.faseAtualKey`. */
  faseAtualKey: string | null
  necessidades: NecessidadeDaFila[]
  tarefas: TarefaDaFila[]
  /** Ids das uniões da pessoa — a certidão de casamento é da UNIÃO. */
  uniaoIdsDaPessoa: number[]
  /** "com Maria Silva" — para distinguir duas uniões da mesma pessoa. */
  nomeDoConjugeDaUniao?: (uniaoId: number) => string | null
  achados: AchadoDoMotor[]
  /** Nome de pessoa para o botão "Abrir <nome>". */
  nomeDePessoa?: (pessoaId: number) => string
}

// ── MAPEAMENTO ──────────────────────────────────────────────────────────────

/**
 * Estado do documento na fila, ou null quando a projeção oficial não veio
 * (nesse caso o item NÃO é inventado: o chamador o descarta com aviso — ver
 * `montarFilaDaPessoa`).
 */
export function estadoDoDocumento(n: Pick<NecessidadeDaFila, "status" | "situacaoCertidao">): EstadoDocumento | null {
  if (n.status === "NAO_LOCALIZADA") return "bloqueado"
  switch (n.situacaoCertidao) {
    case "NAO_LOCALIZADA": return "a_localizar"
    case "NAO_SOLICITADA": return "a_solicitar"
    case "PENDENTE":
    case "SOLICITADO": return "solicitado"
    case "RECEBIDA": return "recebido"
    case "DISPENSADA": return "dispensado"
    default: return null
  }
}

// Estado → ordem (menor primeiro). Mesma ordem em que o trabalho trava e em que
// `decidirProximaAcao` decide: bloqueio, contradição de dado, exigência parada,
// espera de terceiro, e só então o que já está resolvido.
const ORDEM_ESTADO: Record<EstadoDocumento, number> = {
  bloqueado: 0, a_localizar: 20, a_solicitar: 30, solicitado: 40, recebido: 70, dispensado: 80,
}
const ORDEM_DIVERGENCIA_CRITICA = 10
const ORDEM_DIVERGENCIA_LEVE = 50

const ROTULO_ACAO_DO_ESTADO: Record<EstadoDocumento, string> = {
  bloqueado: "Resolver",
  a_localizar: "Localizar",
  a_solicitar: "Solicitar",
  solicitado: "Acompanhar",
  recebido: "Abrir",
  dispensado: "Abrir",
}

const STATUS_TAREFA_FORA = new Set(["CANCELADA", "SUPERSEDIDA"])

/** A tarefa-destino de um documento: a aberta mais recente; senão a concluída mais recente. */
export function tarefaDestinoDaNecessidade(
  necessidadeId: number,
  tarefas: readonly TarefaDaFila[],
): TarefaDaFila | null {
  let aberta: TarefaDaFila | null = null
  let fechada: TarefaDaFila | null = null
  for (const t of tarefas) {
    if (t.necessidadeId !== necessidadeId) continue
    if (t.statusTarefa && STATUS_TAREFA_FORA.has(t.statusTarefa)) continue
    if (t.concluida) {
      if (!fechada || t.id > fechada.id) fechada = t
    } else if (!aberta || t.id > aberta.id) aberta = t
  }
  return aberta ?? fechada
}

/**
 * Deep-link canônico para a tarefa na Central Operacional do processo (o mesmo
 * formato dos avisos: `/kanban?processoId=X&tab=central&taskId=Y`). Quem é ADMIN
 * passa o link por `linkDoAvisoParaAdmin` (Torre de Controle) na tela.
 */
export function linkDaTarefaNaCentral(processoId: number, tarefaId: number): string {
  return `/kanban?processoId=${processoId}&tab=central&taskId=${tarefaId}`
}

function detalheDoDocumento(estado: EstadoDocumento, n: NecessidadeDaFila): string | null {
  // Sem prazo/previsão de propósito: a Árvore não tem prazo/SLA (decisão de 17/09/2026).
  // Os dois relógios oficiais são Tarefa e Subtarefa — vivem na Torre e em Tarefas.
  if (estado === "solicitado") {
    return n.situacaoCertidao === "SOLICITADO" ? "cartório confirmou o pedido" : "aguardando a confirmação do pedido"
  }
  if (estado === "bloqueado") return "marcado como não localizado"
  return null
}

// ── ACHADOS ─────────────────────────────────────────────────────────────────

function acoesDoAchado(a: AchadoDoMotor, pessoaId: number, nomeDe?: (id: number) => string): AcaoFila[] {
  const nome = (id: number) => (nomeDe ? nomeDe(id) : `#${id}`)
  const outros = a.pessoaIds.filter((id) => id !== pessoaId)
  const acoes: AcaoFila[] = []

  // O fato de cônjuge tem ação própria, que GRAVA pela porta oficial (modal de
  // vincular cônjuge): casal com filho em comum e sem união registrada.
  if (a.id.startsWith(PREFIXO_UNIAO_IMPLICITA) && outros.length === 1) {
    acoes.push({ tipo: "vincular_conjuge", rotulo: "Registrar união", pessoaId, outraPessoaId: outros[0] })
  } else if (a.id.startsWith(PREFIXO_CONJUGE_AUSENTE)) {
    acoes.push({ tipo: "vincular_conjuge", rotulo: "Vincular cônjuge", pessoaId, outraPessoaId: null })
  }

  for (const id of outros.slice(0, 3)) {
    acoes.push({ tipo: "abrir_pessoa", rotulo: `Abrir ${nome(id)}`, pessoaId: id })
  }
  if (outros.length === 0) acoes.push({ tipo: "ver_no_mapa", rotulo: "Ver no mapa", pessoaId })
  return acoes
}

// ── MONTAGEM ────────────────────────────────────────────────────────────────

export function montarFilaDaPessoa(e: EntradaFila): FilaDaPessoa {
  const uniaoIds = new Set(e.uniaoIdsDaPessoa)
  const itens: ItemFila[] = []

  const dela = e.necessidades.filter(
    (n) => n.pessoaId === e.pessoaId || (n.pessoaId == null && n.uniaoId != null && uniaoIds.has(n.uniaoId)),
  )

  // Uniões da pessoa com mais de uma certidão de casamento precisam do cônjuge no nome.
  const unioesComNecessidade = new Set(dela.filter((n) => n.uniaoId != null).map((n) => n.uniaoId as number))
  const desambiguar = unioesComNecessidade.size > 1

  for (const n of dela) {
    const estado = estadoDoDocumento(n)
    // Sem projeção oficial o estado seria palpite: o item não entra. O endpoint
    // sempre projeta; a ausência é falha do chamador e o teste pega.
    if (!estado) continue

    const base = n.itemCatalogo?.name?.trim() || `Documento #${n.id}`
    const conjuge = desambiguar && n.uniaoId != null ? e.nomeDoConjugeDaUniao?.(n.uniaoId) : null
    const nome = conjuge ? `${base} · com ${conjuge}` : base

    const acoes: AcaoFila[] = []
    const destino = tarefaDestinoDaNecessidade(n.id, e.tarefas)
    if (destino && estado !== "dispensado") {
      acoes.push({
        tipo: "abrir_tarefa",
        rotulo: ROTULO_ACAO_DO_ESTADO[estado],
        tarefaId: destino.id,
        processoId: e.processoId,
      })
    }

    itens.push({
      tipo: "documento",
      chave: `nec-${n.id}`,
      necessidadeId: n.id,
      nome,
      estado,
      rotuloEstado: ROTULO_ESTADO_DOCUMENTO[estado],
      detalhe: detalheDoDocumento(estado, n),
      opcional: n.obrigatoriedade === "OPCIONAL",
      ordem: ORDEM_ESTADO[estado],
      acoes,
    })
  }

  for (const a of e.achados) {
    itens.push({
      tipo: "divergencia",
      chave: `ach-${a.id}`,
      achadoId: a.id,
      titulo: a.titulo,
      explicacao: a.explicacao,
      rotuloEstado: `${a.impeditivo || a.severidade === "alto" ? "Crítico" : "Atenção"} · ${ROTULO_CATEGORIA_ACHADO[a.categoria]}`,
      impeditivo: a.impeditivo,
      ordem: a.impeditivo || a.severidade === "alto" ? ORDEM_DIVERGENCIA_CRITICA : ORDEM_DIVERGENCIA_LEVE,
      acoes: acoesDoAchado(a, e.pessoaId, e.nomeDePessoa),
    })
  }

  // Ordem determinística: urgência (ordem), depois a chave estável do item.
  itens.sort((a, b) => a.ordem - b.ordem || a.chave.localeCompare(b.chave, "en", { numeric: true }))

  const proximo =
    itens.find((i) => i.ordem < ORDEM_ESTADO.recebido && i.acoes.length > 0) ?? null

  return {
    antesDaGenealogia: ehFaseAguardandoFechamento(e.faseAtualKey) && dela.length === 0,
    itens,
    proximo,
  }
}

/**
 * Texto de "antes da Genealogia". O nome da fase destino vem do CADASTRO
 * (`CatalogoFase.label`), nunca de literal; sem ele, a mensagem cita a fase em que
 * o processo está (rótulo oficial da antessala).
 */
export function mensagemAntesDaGenealogia(rotuloFaseDestino: string | null | undefined): string {
  const destino = rotuloFaseDestino?.trim()
  return destino
    ? `As exigências serão geradas quando o processo entrar em ${destino}.`
    : `As exigências serão geradas quando o processo sair de ${ROTULO_AGUARDANDO_FECHAMENTO}.`
}
