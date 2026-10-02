// src/lib/genealogia/operacional/diagnostico.ts
//
// DIAGNÓSTICO DA ÁRVORE — a lista do que trava a árvore, por trás da "Próxima ação".
//
// O PAINEL "Diagnóstico" saiu da tela (Etapa 2 da reforma da árvore). Este módulo
// ficou porque a "Próxima ação" do cartão de resumo ainda precisa de UMA fila
// ordenada de pendências da árvore — cada item com pessoa, categoria, motivo,
// impacto, FONTE e ação.
//
// QUATRO REGRAS QUE DEFINEM ESTE MÓDULO:
//
// 0. TAREFA NUNCA É PENDÊNCIA DE ÁRVORE (regra permanente, Etapa 2). Tarefa
//    vencida, aberta ou com dono é TRABALHO EM ANDAMENTO: já tem lugar na Torre de
//    Controle e em Tarefas. Listá-la aqui duplicaria a verdade operacional numa
//    tela que fala de estrutura familiar/documental. Por isso este módulo não lê
//    `tarefasAbertas`, não tem categoria de tarefa e a fila não tem faixa de
//    tarefa. `CATEGORIAS_DE_PENDENCIA` é o fecho dessa regra (testado).
//
// 1. NÃO INVENTA PROBLEMA. Todo item nasce de um fato lido de fonte canônica:
//    NecessidadeDocumental (Sistema Documental) ou um achado do motor genealógico
//    (`achados-do-motor.ts`, a fonte única). Não há heurística de "parece errado".
//
// 2. NÃO HÁ SCORE. A saúde tem três estados com definição fechada:
//    CRÍTICO = existe bloqueio impeditivo; ATENÇÃO = existe pendência ou
//    divergência não impeditiva; SAUDÁVEL = zero pendências conhecidas. Um
//    número de 0 a 100 esconderia justamente a diferença entre "falta muita
//    coisa fácil" e "tem uma coisa que impede tudo".
//
// 3. "CONHECIDAS" É LITERAL. Saudável não é "sem problemas": é "sem problemas
//    QUE ESTE MOTOR SABE VER". Quando não há Regra Documental publicada, não há
//    exigência para conferir — e o diagnóstico diz isso, em vez de exibir um
//    verde que o operador leria como aprovação.
//
// PURO: sem prisma, sem rede, sem relógio.

import type { GrafoGenealogico } from "../motor/grafo"
import type { AnaliseArvore, Severidade } from "../motor/tipos"
import type { Linhagem, MapaLinhagens } from "../motor/linhagens"
import { nomeCompleto } from "../motor/texto"
import type { DossiePessoa } from "./dossie"
import { achadosDoMotor, type CategoriaAchado } from "./achados-do-motor"

export type NivelSaude = "saudavel" | "atencao" | "critico"

export const ROTULO_SAUDE: Record<NivelSaude, string> = {
  saudavel: "Saudável",
  atencao: "Atenção",
  critico: "Crítico",
}

export type CategoriaProblema = "bloqueio_documental" | "documento_ausente" | CategoriaAchado

/**
 * As categorias que PODEM ser pendência de árvore. Fechado de propósito: tarefa
 * não está aqui e não pode entrar (ver regra 0 no topo do arquivo).
 */
export const CATEGORIAS_DE_PENDENCIA: readonly CategoriaProblema[] = [
  "bloqueio_documental",
  "documento_ausente",
  "divergencia",
  "duplicidade",
  "relacao",
  "linhagem",
]

export const ROTULO_CATEGORIA: Record<CategoriaProblema, string> = {
  bloqueio_documental: "Documento não localizado",
  linhagem: "Linhagem",
  documento_ausente: "Documento obrigatório",
  divergencia: "Divergência de dados",
  duplicidade: "Possível duplicidade",
  relacao: "Relação incompleta",
}

export interface Problema {
  id: string
  categoria: CategoriaProblema
  /** critico = impede; os demais graus = atenção. */
  severidade: Severidade
  /** true quando o problema IMPEDE a conclusão, não apenas atrasa. */
  impeditivo: boolean
  pessoaId: number | null
  pessoaNome: string | null
  titulo: string
  /** Por que isto é um problema. */
  motivo: string
  /** O que ele custa ao processo — em nomes de requerentes, quando aplicável. */
  impacto: string
  /** De onde o fato saiu. Problema sem fonte não entra na lista. */
  fonte: string
  /** O próximo passo concreto. */
  acao: string
  /** Ordem final: maior primeiro. Determinística. */
  peso: number
}

export interface Diagnostico {
  saude: NivelSaude
  rotuloSaude: string
  /** "Processo saudável" ou "7 pendências". Pronto para o topo da tela. */
  resumo: string
  problemas: Problema[]
  criticos: number
  atencao: number
  /**
   * true quando o motor NÃO tinha exigência documental para conferir. Saúde
   * verde com isto ligado significa "nada a apontar ainda", não "aprovado".
   */
  semExigenciaMaterializada: boolean
}

export interface ContextoDiagnostico {
  grafo: GrafoGenealogico
  analise: AnaliseArvore | null
  mapa: MapaLinhagens
  dossies: Map<number, DossiePessoa>
  /** Escopo: uma linhagem, ou a árvore inteira quando null. */
  linhagem: Linhagem | null
}

const FONTE_DOCUMENTAL = "NecessidadeDocumental (Sistema Documental)"

export function diagnosticar(ctx: ContextoDiagnostico): Diagnostico {
  const { grafo, analise, mapa, dossies, linhagem } = ctx
  const problemas: Problema[] = []

  const escopo = linhagem ? [...linhagem.visivel] : grafo.pessoas.map((p) => p.id)
  const noEscopo = new Set(escopo)

  const nomeDe = (id: number) => {
    const p = grafo.pessoa(id)
    return p ? nomeCompleto(p) : `#${id}`
  }

  /** Requerentes que dependem de uma pessoa, em nomes. É o impacto real. */
  const impactoDe = (pessoaId: number): string => {
    const dependentes = mapa.compartilhadas.get(pessoaId) ?? []
    if (dependentes.length === 0) return "Não afeta nenhuma linha de transmissão."
    const nomes = dependentes.map(nomeDe)
    return dependentes.length === 1
      ? `Impede a conclusão documental da linhagem de ${nomes[0]}.`
      : `Impede a conclusão documental de ${dependentes.length} linhagens: ${nomes.join(", ")}.`
  }

  let exigenciasTotais = 0

  // ── 1. Documental (fonte: Sistema Documental) ─────────────────────────────
  for (const id of escopo) {
    const d = dossies.get(id)
    if (!d) continue
    exigenciasTotais += d.documental.necessarias

    if (d.documental.naoLocalizadas > 0) {
      problemas.push({
        id: `diag-bloqueio-${id}`,
        categoria: "bloqueio_documental",
        severidade: "critico",
        impeditivo: true,
        pessoaId: id,
        pessoaNome: d.nome,
        titulo: `${d.documental.naoLocalizadas} documento(s) não localizado(s) — ${d.nome}`,
        motivo:
          "O Sistema Documental marcou a exigência como NÃO LOCALIZADA: a busca foi feita e o registro não apareceu.",
        impacto: impactoDe(id),
        fonte: FONTE_DOCUMENTAL,
        acao: "Abrir a pessoa e decidir o caminho alternativo (busca ampliada, retificação ou dispensa).",
        peso: 1000 + d.documental.naoLocalizadas,
      })
    }

    if (d.documental.pendentes > 0) {
      problemas.push({
        id: `diag-pendente-${id}`,
        categoria: "documento_ausente",
        severidade: "alto",
        impeditivo: false,
        pessoaId: id,
        pessoaNome: d.nome,
        titulo: `${d.documental.pendentes} exigência(s) documental(is) sem início — ${d.nome}`,
        motivo: "A exigência existe e ainda não foi iniciada.",
        impacto: impactoDe(id),
        fonte: FONTE_DOCUMENTAL,
        acao: "Abrir a pessoa e iniciar a solicitação do documento.",
        peso: 600 + d.documental.pendentes,
      })
    }
  }

  // ── 2. Motor genealógico (divergência, duplicidade, relação, linhagem) ────
  // Os achados JÁ vêm priorizados e explicados pelo motor, e a seleção de quais
  // insights são pendência de árvore mora em UM lugar (`achados-do-motor.ts`).
  // Aqui eles só ganham o impacto em requerentes — reclassificar severidade seria
  // criar uma segunda opinião sobre o mesmo fato.
  for (const a of achadosDoMotor(analise, noEscopo)) {
    problemas.push({
      id: `diag-${a.id}`,
      categoria: a.categoria,
      severidade: a.severidade,
      // Só é impeditivo o que o motor classificou como crítico: uma grafia
      // divergente atrasa, não impede.
      impeditivo: a.impeditivo,
      pessoaId: a.pessoaId,
      pessoaNome: a.pessoaId != null ? nomeDe(a.pessoaId) : null,
      titulo: a.titulo,
      motivo: a.explicacao,
      impacto: a.pessoaId != null ? impactoDe(a.pessoaId) : "Afeta a estrutura da árvore.",
      fonte: a.fonte,
      acao: a.acao,
      peso: (a.impeditivo ? 900 : 400) + Math.min(a.peso, 99),
    })
  }

  // A Árvore Genealógica NÃO tem prazo/SLA (decisão do usuário, 17/09/2026):
  // existiu aqui uma categoria "sla" alimentada pela engine de SLA de
  // FaseMacro/Processo (removida) — eliminada por completo, sem substituto.
  // E NÃO tem tarefa (Etapa 2, regra 0): tarefa é trabalho, não pendência.

  // Ordem determinística: peso, depois id. Duas leituras da mesma árvore
  // produzem a mesma lista, na mesma ordem.
  problemas.sort((a, b) => b.peso - a.peso || a.id.localeCompare(b.id))

  const criticos = problemas.filter((p) => p.impeditivo).length
  const atencao = problemas.length - criticos
  const saude: NivelSaude = criticos > 0 ? "critico" : problemas.length > 0 ? "atencao" : "saudavel"
  const semExigenciaMaterializada = exigenciasTotais === 0

  return {
    saude,
    rotuloSaude: ROTULO_SAUDE[saude],
    resumo: montarResumo(saude, problemas.length, semExigenciaMaterializada),
    problemas,
    criticos,
    atencao,
    semExigenciaMaterializada,
  }
}

function montarResumo(saude: NivelSaude, total: number, semExigencia: boolean): string {
  if (saude === "saudavel") {
    // Honestidade sobre cobertura: sem exigência materializada não há dossiê
    // para conferir, e chamar isso de "saudável" seco seria enganoso.
    return semExigencia
      ? "Nada a apontar — nenhuma exigência documental materializada ainda"
      : "Processo saudável"
  }
  return `${total} ${total === 1 ? "pendência" : "pendências"}`
}

// ── PRÓXIMA MELHOR AÇÃO ─────────────────────────────────────────────────────

/**
 * A fila é FIXA e declarada, não negociável por heurística. Os rótulos moram
 * AQUI (fonte única) e o Modo Auditor os lê — nada de lista paralela.
 *
 * TAREFA NÃO TEM FAIXA: tarefa vencida/aberta é trabalho, não pendência de árvore
 * (regra 0 no topo do arquivo). Havia duas faixas de tarefa (4 e 5) até a Etapa 2.
 */
export const FILA_DE_PRIORIDADE = [
  "bloqueio crítico",
  "divergência impeditiva",
  "documento obrigatório ausente",
  "outra pendência da árvore (divergência, duplicidade ou relação)",
  "nenhuma ação necessária",
] as const

export const TOTAL_PRIORIDADES = FILA_DE_PRIORIDADE.length

export interface AcaoRecomendada {
  pessoaId: number | null
  pessoaNome: string | null
  /** O que fazer. */
  acao: string
  /** Por que é ESTA a próxima, e não outra. */
  motivo: string
  fonte: string
  /** Posição na fila fixa de prioridade (1..TOTAL_PRIORIDADES). A última = nada a fazer. */
  prioridade: number
  /** Problema de origem — o link de navegação da tela. */
  problemaId: string | null
}

/**
 * Faixas, na ordem de `FILA_DE_PRIORIDADE`:
 *
 *   1. bloqueio crítico          — o que impede
 *   2. divergência impeditiva    — o que invalida o documento que vier
 *   3. documento obrigatório ausente
 *   4. qualquer outra pendência da árvore
 *   5. nenhuma ação necessária
 *
 * Dentro de cada faixa desempata o peso do problema — que já considera quantos
 * requerentes dependem da pessoa. Por isso, entre dois bloqueios iguais, vence o
 * que destrava mais gente.
 */
export function resolveNextGenealogyAction(diag: Diagnostico): AcaoRecomendada {
  const faixas: Array<{ prioridade: number; casa: (p: Problema) => boolean }> = [
    { prioridade: 1, casa: (p) => p.impeditivo && p.categoria === "bloqueio_documental" },
    { prioridade: 2, casa: (p) => p.impeditivo },
    { prioridade: 3, casa: (p) => p.categoria === "documento_ausente" },
    { prioridade: 4, casa: () => true },
  ]

  for (const faixa of faixas) {
    // `problemas` já está ordenado por peso: o primeiro que casa é o mais pesado.
    const alvo = diag.problemas.find(faixa.casa)
    if (!alvo) continue
    return {
      pessoaId: alvo.pessoaId,
      pessoaNome: alvo.pessoaNome,
      acao: alvo.acao,
      motivo: alvo.motivo,
      fonte: alvo.fonte,
      prioridade: faixa.prioridade,
      problemaId: alvo.id,
    }
  }

  return {
    pessoaId: null,
    pessoaNome: null,
    acao: "Nenhuma ação necessária.",
    motivo: diag.semExigenciaMaterializada
      ? "Nenhuma exigência documental foi materializada para esta linha ainda."
      : "Nenhuma pendência conhecida nesta linha.",
    fonte: FONTE_DOCUMENTAL,
    prioridade: TOTAL_PRIORIDADES,
    problemaId: null,
  }
}
