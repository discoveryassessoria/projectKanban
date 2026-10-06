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
import { calcularGeracoes } from "@/src/lib/genealogia/geracao"
import { ordenarCertidoesDaFamilia } from "@/lib/operacional/ordem-certidoes"
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
  /**
   * A GERAÇÃO DE VERDADE (G1 = o ancestral que origina o direito; filhos G2…; cônjuge na geração do parceiro), calculada pela filiação —
   * `src/lib/genealogia/geracao.ts`. É ESTE o "G" que a tela mostra e que a ordem das certidões usa (nunca `numeroLinhagem`). `null` = sem geração derivável.
   */
  geracaoNaArvore: number | null
  /** Nomes dos requerentes de cuja LINHA esta pessoa faz parte (ela está no caminho de filiação até eles). Vazio fora da linha. */
  linhaDe: string[]
  /** A pessoa está na linha de TODOS os requerentes do processo (e há mais de um). */
  linhaDeTodos: boolean
  /**
   * Nome do requerente em relação a quem `posicao` foi escrita — preenchido só quando o processo tem requerentes de RAMOS diferentes
   * ("tia-avó" + posicaoEm "Maria Carolina" = "tia-avó de Maria Carolina"). `null` = um só ramo: a posição é em relação ao requerente.
   */
  posicaoEm: string | null
  /** Nº Linhagem (Pessoa.numeroLinhagem) — ordena a pasta documental. Fonte da ORDEM
   *  de exibição desta lista; `geracao` é outro eixo (grau a partir do requerente),
   *  usado só para o rótulo, nunca para ordenar. */
  numeroLinhagem: number | null
  /** Nascimento (ISO) — chave de ordem. */
  nascimento: string | null
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
  /** Nascimento da pessoa — entra na regra fixa de ordem (geração → linha reta → nascimento). Ausente = sem data. */
  data_nasc?: Date | string | null
  paiId: number | null
  maeId: number | null
}

export interface UniaoBruta {
  id: number
  pessoa1Id: number | null
  pessoa2Id: number | null
}

/** "A" · "A e B" · "A, B e C": vírgulas e "e" só no último. */
export function juntarNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? ""
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`
}

/** O texto da linha da Central: "linha de todos os requerentes" ou "linha de José Roberto e Alessandra". `null` quando não há o que dizer. */
export function textoDaLinha(p: Pick<PessoaDoProcesso, "linhaDe" | "linhaDeTodos" | "requerente">): string | null {
  if (p.requerente || p.linhaDe.length === 0) return null
  return p.linhaDeTodos ? "linha de todos os requerentes" : `linha de ${juntarNomes(p.linhaDe)}`
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

  // Requerentes da árvore: PODE haver vários, de ramos diferentes (Salvarani: Maria Carolina; José Roberto Junior e Alessandra, filhos de Silvia Helena).
  // Sem requerente nada pode ser posicionado — pendência REAL de cadastro, não motivo para esconder pessoas.
  const requerentes = pessoas.filter((p) => ehRequerente(p.requerente))
  const ancora = requerentes[0] ?? null
  const porIdPessoa = new Map(pessoas.map((p) => [p.id, p]))

  // LINHA RETA = o caminho de filiação entre o ancestral que origina o direito e PELO MENOS UM requerente. Para cada requerente, o conjunto dos
  // seus ascendentes; a pessoa está na linha quando está no de algum — não só no do primeiro requerente.
  const ascendentesDe = (id: number): Set<number> => {
    const vistos = new Set<number>(), fila = [id]
    while (fila.length) {
      const x = porIdPessoa.get(fila.pop()!)
      if (!x) continue
      for (const pai of [x.paiId, x.maeId]) if (pai != null && porIdPessoa.has(pai) && !vistos.has(pai)) { vistos.add(pai); fila.push(pai) }
    }
    return vistos
  }
  const ascendentesPorRequerente = new Map(requerentes.map((r) => [r.id, ascendentesDe(r.id)]))
  const nomeCurtoDoRequerente = (r: PessoaBruta): string => {
    const homonimo = requerentes.some((o) => o.id !== r.id && o.nome === r.nome)
    return homonimo ? nomeCompletoPessoa(r) : r.nome
  }
  // Ramos diferentes: algum requerente NÃO está na linha de outro (nem é ascendente dele).
  const variosRamos = requerentes.length > 1 && requerentes.some((r) => requerentes.some((o) => o.id !== r.id && !ascendentesPorRequerente.get(o.id)!.has(r.id) && !ascendentesPorRequerente.get(r.id)!.has(o.id)))
  const geracoes = calcularGeracoes(
    pessoas.map((p) => ({ id: p.id, paiId: p.paiId, maeId: p.maeId, linhaReta: p.linhaReta, requerente: p.requerente })),
    unioes,
  )

  const linhas: PessoaDoProcesso[] = pessoas.map((p) => {
    const nome = nomeCompletoPessoa(p)
    const eRequerente = ehRequerente(p.requerente)

    let geracao: number | null = null
    let posicao = "—"
    let posicaoEm: string | null = null
    // Os requerentes de cuja linha esta pessoa faz parte (ela é o requerente ou está acima dele).
    const requerentesDaLinha = requerentes.filter((r) => r.id === p.id || ascendentesPorRequerente.get(r.id)!.has(p.id))
    const linhaDe = requerentesDaLinha.map(nomeCurtoDoRequerente)
    const ascendenteDireto = linhaDe.length > 0

    if (ancora && p.id === ancora.id) {
      geracao = 0
      posicao = "Requerente"
    } else if (ancora) {
      // `posicao`/`geracao` (grau a partir do requerente) em relação ao requerente MAIS PRÓXIMO: o de menor distância de parentesco.
      let melhor: { par: NonNullable<ReturnType<typeof calcularParentesco>>; ref: PessoaBruta } | null = null
      // Quem está na linha de algum requerente: o parentesco é dito em relação a ELES (mãe de Maria Carolina), não a quem só é parente por afinidade.
      for (const r of requerentesDaLinha.length > 0 ? requerentesDaLinha : requerentes) {
        if (r.id === p.id) continue
        const par = calcularParentesco(grafo, r.id, p.id)
        if (!par) continue
        const dist = par.acima + par.abaixo + (par.porAfinidade ? 0.5 : 0)
        const distMelhor = melhor ? melhor.par.acima + melhor.par.abaixo + (melhor.par.porAfinidade ? 0.5 : 0) : Infinity
        if (dist < distMelhor) melhor = { par, ref: r }
      }
      if (eRequerente && !melhor) { posicao = "Requerente" }
      if (melhor) {
        posicao = melhor.par.rotulo
        if (variosRamos) posicaoEm = nomeCurtoDoRequerente(melhor.ref)
        if (!melhor.par.porAfinidade && melhor.par.abaixo === 0 && melhor.par.acima >= 1) geracao = melhor.par.acima
      }
      if (eRequerente && posicao === "—") posicao = "Requerente"
    }

    // Ascendente de VÁRIOS requerentes: não se escolhe um ao acaso para dizer o parentesco — mostra-se só a geração e a linha (`linhaDe`).
    if (!eRequerente && linhaDe.length > 1) { posicao = "—"; posicaoEm = null }

    // CLASSIFICAÇÃO
    //  • Requerente e ascendentes (de QUALQUER requerente) declarados na linha reta → linha principal.
    //  • Declarado FORA da linha reta (cônjuge/apoio) → fora da linhagem, sempre.
    //  • Declarado NA linha reta mas sem filiação que chegue a NENHUM requerente →
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
        ? "Marcada na linha reta, mas sem filiação que chegue a nenhum requerente."
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
      geracaoNaArvore: geracoes.get(p.id) ?? null,
      linhaDe,
      linhaDeTodos: requerentes.length > 1 && linhaDe.length === requerentes.length,
      posicaoEm,
      posicao,
      pendencia,
      numeroLinhagem: p.numeroLinhagem ?? null,
      nascimento: p.data_nasc ? (p.data_nasc instanceof Date ? p.data_nasc.toISOString() : String(p.data_nasc)) : null,
    }
  })

  // ORDEM DE EXIBIÇÃO = a REGRA FIXA (`lib/operacional/ordem-certidoes.ts`): geração calculada (G1…) → linha reta → nascimento → pessoa. Nunca
  // `numeroLinhagem` (número de sequência: irmãos diferem). Quem não tem geração vai ao fim, por nome — nunca some.
  return ordenarCertidoesDaFamilia(linhas, (l) => ({
    geracao: l.geracaoNaArvore, linhaReta: l.linhaReta, pessoaNascimento: l.nascimento, pessoaId: l.pessoaId, desempate: l.nome,
  }))
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
    case "AGUARDANDO": return "Aguardando terceiros"
    case "AGUARDANDO_APROVACAO": return "Aguardando aprovação"
    case "BLOQUEADO": return "Bloqueado"
    case "EXECUTADO": return "Executado"
    case "CONCLUIDO": return "Concluído"
    case "DISPENSADO": return "Dispensado"
    case "FALHOU": return "Falhou"
    default: return String(status)
  }
}
