// src/lib/process-stage/central-operacional-core.ts
//
// NÚCLEO PURO da Central Operacional (sem Prisma, sem I/O) — importável em teste
// via tsx. Responde a DUAS perguntas que a Central fazia errado:
//
//  1) QUEM são as pessoas do processo?
//     Antes a lista de pessoas era DERIVADA da fila de itens (Documento na Emissão,
//     NecessidadeDocumental na Genealogia). Processo sem documento obrigatório
//     configurado ⇒ fila vazia ⇒ "0 pessoa(s)", mesmo com a árvore populada. A
//     pessoa passa a vir do VÍNCULO OFICIAL (Pessoa.arvoreId = Processo.arvoreId) e
//     nunca depende de tarefa, documento, necessidade ou transmissão calculada.
//
//  2) QUAIS são as tarefas da fase?
//     Os passos operacionais (PhaseWorkflowStepInstance) são as tarefas. Aqui vive a
//     única régua status-do-passo → balde operacional (Pendentes / Em andamento /
//     Concluídas), para que contador e lista nunca divirjam.
//
// Determinístico: mesma entrada → mesma saída. A posição na linhagem NÃO é inventada
// nem lida de campo denormalizado: é calculada pelo motor genealógico oficial
// (calcularParentesco) a partir das relações de filiação reais.

import { construirGrafo } from "@/src/lib/genealogia/motor/grafo"
import { calcularParentesco } from "@/src/lib/genealogia/motor/parentesco"
import type { PessoaEntrada, UniaoEntrada } from "@/src/lib/genealogia/motor/tipos"
import { ehRequerente } from "@/lib/genealogia/requerente-flag"

// ============================================================
// 1) PESSOAS DO PROCESSO
// ============================================================

/**
 * Onde a pessoa é exibida na Central. Toda pessoa da árvore cai em EXATAMENTE uma
 * destas — nenhuma é descartada em silêncio (Regra 7 da tarefa).
 */
export type ClassificacaoPessoa =
  | "LINHA_PRINCIPAL"
  | "FORA_DA_LINHAGEM"
  | "PENDENTE_CLASSIFICACAO"

export interface PessoaDoProcesso {
  pessoaId: number
  publicCode: string | null
  nome: string
  iniciais: string
  /** É requerente na árvore (fonte única: ehRequerente). */
  requerente: boolean
  /** Declaração de cadastro (Pessoa.linhaReta) — NÃO é a classificação final. */
  linhaReta: boolean
  classificacao: ClassificacaoPessoa
  /**
   * Gerações acima do requerente: 0 = requerente, 1 = pai/mãe, 2 = avô/avó…
   * null quando a pessoa não é ascendente direto (cônjuge, colateral) ou quando a
   * árvore não tem requerente marcado.
   */
  geracao: number | null
  /** Rótulo da posição ("Requerente", "pai", "avó", "esposa"…) — motor de parentesco. */
  posicao: string
  /** Pendência ADMINISTRATIVA real (cadastro inconsistente). null = sem pendência. */
  pendencia: string | null
  /** Nº Linhagem (Pessoa.numeroLinhagem) — ordena a pasta documental. Fonte da ORDEM
   *  de exibição desta lista; `geracao` é outro eixo (grau a partir do requerente),
   *  usado só para o rótulo, nunca para ordenar. */
  numeroLinhagem: number | null
}

export interface PessoaBruta {
  id: number
  nome: string
  sobrenome: string | null
  sexo?: string | null
  publicCode?: string | null
  requerente: string | null
  linhaReta: boolean
  numeroLinhagem?: number | null
  paiId: number | null
  maeId: number | null
}

export interface UniaoBruta {
  id: number
  pessoa1Id: number | null
  pessoa2Id: number | null
}

export function nomeCompletoPessoa(p: { nome: string; sobrenome?: string | null }): string {
  return `${p.nome}${p.sobrenome ? " " + p.sobrenome : ""}`.trim()
}

export function iniciaisDe(nome: string): string {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

/**
 * Roster oficial das pessoas do processo, classificado e ordenado.
 *
 * ORDEM (Regra 8): requerente primeiro, depois a sequência genealógica real
 * (pai/mãe → avô/avó → bisavô/bisavó → …). Quem não tem posição derivável vai ao
 * fim do próprio grupo, em ordem alfabética — nunca some.
 */
export function montarPessoasDoProcesso(
  pessoas: PessoaBruta[],
  unioes: UniaoBruta[],
): PessoaDoProcesso[] {
  if (pessoas.length === 0) return []

  const entradas: PessoaEntrada[] = pessoas.map((p) => ({
    id: p.id,
    nome: p.nome,
    sobrenome: p.sobrenome,
    sexo: p.sexo ?? null,
    requerente: p.requerente,
    linhaReta: p.linhaReta,
    numeroLinhagem: p.numeroLinhagem ?? null,
    paiId: p.paiId,
    maeId: p.maeId,
  }))
  const unioesEntrada: UniaoEntrada[] = unioes.map((u) => ({
    id: u.id,
    pessoa1Id: u.pessoa1Id,
    pessoa2Id: u.pessoa2Id,
  }))
  const grafo = construirGrafo(entradas, unioesEntrada)

  // Âncora da linhagem = requerente da árvore. Sem âncora nada pode ser posicionado,
  // e isso é uma pendência REAL de cadastro — não um motivo para esconder pessoas.
  const requerentes = pessoas.filter((p) => ehRequerente(p.requerente))
  const ancora = requerentes[0] ?? null

  const linhas: PessoaDoProcesso[] = pessoas.map((p) => {
    const nome = nomeCompletoPessoa(p)
    const eRequerente = ehRequerente(p.requerente)

    let geracao: number | null = null
    let posicao = "—"
    let ascendenteDireto = false

    if (ancora && p.id === ancora.id) {
      geracao = 0
      posicao = "Requerente"
      ascendenteDireto = true
    } else if (ancora) {
      const par = calcularParentesco(grafo, ancora.id, p.id)
      if (par) {
        posicao = par.rotulo
        // Ascendente DIRETO do requerente: sobe N gerações e não desce nenhuma.
        if (!par.porAfinidade && par.abaixo === 0 && par.acima >= 1) {
          geracao = par.acima
          ascendenteDireto = true
        }
      }
    }

    // CLASSIFICAÇÃO
    //  • Requerente e ascendentes diretos declarados na linha reta → linha principal.
    //  • Declarado FORA da linha reta (cônjuge/apoio) → fora da linhagem, sempre.
    //  • Declarado NA linha reta mas sem filiação que chegue ao requerente →
    //    inconsistência real de cadastro: fica visível, em pendência.
    let classificacao: ClassificacaoPessoa
    let pendencia: string | null = null

    if (eRequerente) {
      classificacao = "LINHA_PRINCIPAL"
      if (!p.linhaReta) {
        pendencia = "Requerente marcado fora da linha reta — revisar cadastro da pessoa."
      }
    } else if (!p.linhaReta) {
      classificacao = "FORA_DA_LINHAGEM"
    } else if (ascendenteDireto) {
      classificacao = "LINHA_PRINCIPAL"
    } else {
      classificacao = "PENDENTE_CLASSIFICACAO"
      pendencia = ancora
        ? "Marcada na linha reta, mas sem filiação que chegue ao requerente."
        : "Nenhum requerente marcado na árvore — posição na linhagem não pode ser determinada."
    }

    return {
      pessoaId: p.id,
      publicCode: p.publicCode ?? null,
      nome,
      iniciais: iniciaisDe(nome),
      requerente: eRequerente,
      linhaReta: p.linhaReta,
      classificacao,
      geracao,
      posicao,
      pendencia,
      numeroLinhagem: p.numeroLinhagem ?? null,
    }
  })

  // ORDEM DE EXIBIÇÃO = Nº Linhagem (pasta documental — a mesma régua em toda
  // tela que lista a "linha reta"). `geracao` continua existindo só para o
  // rótulo (G1/G2/…); quem não tem numeroLinhagem calculado ainda vai ao fim,
  // por nome — nunca some.
  const ordem = (l: PessoaDoProcesso) => (l.numeroLinhagem == null ? Number.MAX_SAFE_INTEGER : l.numeroLinhagem)
  return linhas.sort((a, b) => {
    const d = ordem(a) - ordem(b)
    if (d !== 0) return d
    return a.nome.localeCompare(b.nome, "pt-BR")
  })
}

// ============================================================
// 2) TAREFAS DA FASE
// ============================================================

/** Balde operacional exibido na Central. */
export type BaldeTarefa = "PENDENTE" | "EM_ANDAMENTO" | "CONCLUIDA"

/**
 * Régua ÚNICA StepInstanceStatus → balde. Contador e lista da Central usam esta
 * função, então não podem divergir. Passos terminais fora do fluxo (CANCELADO/
 * SUPERSEDIDO) não chegam aqui: a consulta já os exclui.
 */
export function baldeDoPasso(status: string): BaldeTarefa {
  switch (String(status).toUpperCase()) {
    case "CONCLUIDO":
    case "EXECUTADO":
    case "DISPENSADO":
      return "CONCLUIDA"
    case "EM_ANDAMENTO":
    case "AGUARDANDO":
    case "AGUARDANDO_APROVACAO":
      return "EM_ANDAMENTO"
    default:
      // PENDENTE, DISPONIVEL, BLOQUEADO, FALHOU — trabalho ainda por fazer. O rótulo
      // exato do status segue visível na linha; nada é escondido pelo agrupamento.
      return "PENDENTE"
  }
}

/** Rótulo humano do status bruto do passo (o balde agrupa; isto informa). */
export function rotuloStatusPasso(status: string): string {
  switch (String(status).toUpperCase()) {
    case "PENDENTE": return "Pendente"
    case "DISPONIVEL": return "Disponível"
    case "EM_ANDAMENTO": return "Em andamento"
    case "AGUARDANDO": return "Aguardando terceiro"
    case "AGUARDANDO_APROVACAO": return "Aguardando aprovação"
    case "BLOQUEADO": return "Bloqueado"
    case "EXECUTADO": return "Executado"
    case "CONCLUIDO": return "Concluído"
    case "DISPENSADO": return "Dispensado"
    case "FALHOU": return "Falhou"
    default: return String(status)
  }
}
