// src/lib/genealogia/operacional/diagnostico.ts
//
// DIAGNÓSTICO DA ÁRVORE — o processo se explica sozinho.
//
// Uma pergunta, uma resposta: "este processo está saudável?". Abaixo dela, a
// lista ordenada do que impede dizer que sim — cada item com pessoa, categoria,
// motivo, impacto, FONTE e ação.
//
// TRÊS REGRAS QUE DEFINEM ESTE MÓDULO:
//
// 1. NÃO INVENTA PROBLEMA. Todo item nasce de um fato lido de fonte canônica:
//    NecessidadeDocumental (Sistema Documental), Tarefa (processo), SLA (engine
//    única) ou uma regra determinística do motor genealógico. Não há heurística
//    de "parece errado".
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
// PURO: sem prisma, sem rede, sem relógio interno. A data de referência entra
// por parâmetro, porque "tarefa vencida" depende de HOJE e um módulo que lê o
// relógio não é testável.

import type { GrafoGenealogico } from "../motor/grafo"
import type { AnaliseArvore, Insight, Severidade } from "../motor/tipos"
import type { Linhagem, MapaLinhagens } from "../motor/linhagens"
import { nomeCompleto } from "../motor/texto"
import type { DossiePessoa, PrazoDoProcesso, TarefaDaPessoa } from "./dossie"

export type NivelSaude = "saudavel" | "atencao" | "critico"

export const ROTULO_SAUDE: Record<NivelSaude, string> = {
  saudavel: "Saudável",
  atencao: "Atenção",
  critico: "Crítico",
}

export type CategoriaProblema =
  | "bloqueio_documental"
  | "linhagem"
  | "documento_ausente"
  | "tarefa_vencida"
  | "tarefa_aberta"
  | "divergencia"
  | "duplicidade"
  | "relacao"
  | "sla"

export const ROTULO_CATEGORIA: Record<CategoriaProblema, string> = {
  bloqueio_documental: "Documento não localizado",
  linhagem: "Linhagem",
  documento_ausente: "Documento obrigatório",
  tarefa_vencida: "Tarefa vencida",
  tarefa_aberta: "Tarefa aberta",
  divergencia: "Divergência de dados",
  duplicidade: "Possível duplicidade",
  relacao: "Relação incompleta",
  sla: "Prazo",
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
  prazo: PrazoDoProcesso | null
  /** Data de referência para vencimento. Injetada — o módulo não lê relógio. */
  agora: Date
}

const FONTE_DOCUMENTAL = "NecessidadeDocumental (Sistema Documental)"
const FONTE_TAREFA = "Tarefa do processo"
const FONTE_MOTOR = "Motor genealógico (regra determinística)"
const FONTE_SLA = "Projeção de SLA do processo"

/** Uma tarefa está vencida quando tem prazo e o prazo já passou. */
export function tarefaVencida(t: TarefaDaPessoa, agora: Date): boolean {
  if (t.concluida || !t.dataPrazo) return false
  const prazo = Date.parse(t.dataPrazo)
  return Number.isFinite(prazo) && prazo < agora.getTime()
}

export function diagnosticar(ctx: ContextoDiagnostico): Diagnostico {
  const { grafo, analise, mapa, dossies, linhagem, prazo, agora } = ctx
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

  // ── 2. Tarefas (fonte: Tarefa do processo) ────────────────────────────────
  for (const id of escopo) {
    const d = dossies.get(id)
    if (!d) continue
    const vencidas = d.tarefasAbertas.filter((t) => tarefaVencida(t, agora))
    const abertasNoPrazo = d.tarefasAbertas.length - vencidas.length

    if (vencidas.length > 0) {
      problemas.push({
        id: `diag-tarefa-vencida-${id}`,
        categoria: "tarefa_vencida",
        severidade: "alto",
        impeditivo: false,
        pessoaId: id,
        pessoaNome: d.nome,
        titulo: `${vencidas.length} tarefa(s) vencida(s) — ${d.nome}`,
        motivo: `Prazo mais antigo: ${vencidas[0].dataPrazo?.slice(0, 10) ?? "sem data"}. A tarefa tem dono e passou da data.`,
        impacto: impactoDe(id),
        fonte: FONTE_TAREFA,
        acao: `Cobrar ou reprogramar “${vencidas[0].titulo}”.`,
        peso: 700 + vencidas.length,
      })
    }
    if (abertasNoPrazo > 0) {
      problemas.push({
        id: `diag-tarefa-aberta-${id}`,
        categoria: "tarefa_aberta",
        severidade: "medio",
        impeditivo: false,
        pessoaId: id,
        pessoaNome: d.nome,
        titulo: `${abertasNoPrazo} tarefa(s) aberta(s) — ${d.nome}`,
        motivo: "Trabalho em andamento, dentro do prazo.",
        impacto: impactoDe(id),
        fonte: FONTE_TAREFA,
        acao: "Acompanhar a tarefa na aba Operação da pessoa.",
        peso: 300,
      })
    }
  }

  // ── 3. Motor genealógico (divergência, duplicidade, relação, linhagem) ────
  // Os insights JÁ vêm priorizados e explicados pelo motor. Aqui eles só são
  // traduzidos para a linguagem do diagnóstico — reclassificar severidade seria
  // criar uma segunda opinião sobre o mesmo fato.
  for (const i of analise?.insights ?? []) {
    const tocaEscopo = i.pessoaIds.length === 0 || i.pessoaIds.some((id) => noEscopo.has(id))
    if (!tocaEscopo) continue

    const categoria = categoriaDoInsight(i)
    if (!categoria) continue
    const pessoaId = i.pessoaIds.find((id) => noEscopo.has(id)) ?? i.pessoaIds[0] ?? null

    problemas.push({
      id: `diag-${i.id}`,
      categoria,
      severidade: i.severidade,
      // Só é impeditivo o que o motor classificou como crítico: uma grafia
      // divergente atrasa, não impede.
      impeditivo: i.severidade === "critico",
      pessoaId,
      pessoaNome: pessoaId != null ? nomeDe(pessoaId) : null,
      titulo: i.titulo,
      motivo: i.explicacao,
      impacto: pessoaId != null ? impactoDe(pessoaId) : "Afeta a estrutura da árvore.",
      fonte: FONTE_MOTOR,
      acao: i.acao ?? "Abrir a pessoa e conferir o cadastro.",
      peso: (i.severidade === "critico" ? 900 : 400) + Math.min(i.peso, 99),
    })
  }

  // ── 4. SLA (fonte: engine única) ──────────────────────────────────────────
  // Só entra quando há projeção configurada e o prazo já venceu ou está por
  // vencer. Sem SLA configurado não há prazo a cobrar — e não se inventa um.
  if (prazo?.configurado && prazo.diasParaVencimento != null) {
    const dias = prazo.diasParaVencimento
    if (dias < 0) {
      problemas.push({
        id: "diag-sla-vencido",
        categoria: "sla",
        severidade: "alto",
        impeditivo: false,
        pessoaId: null,
        pessoaNome: null,
        titulo: `Prazo do processo vencido — ${prazo.rotuloDias}`,
        motivo: `O SLA do processo indica ${prazo.rotuloStatus.toLowerCase()}.`,
        impacto: "Afeta o processo inteiro, não uma pessoa isolada.",
        fonte: FONTE_SLA,
        acao: "Verificar a fase responsável pelo atraso na Central Operacional.",
        peso: 750,
      })
    } else if (dias <= 7) {
      problemas.push({
        id: "diag-sla-risco",
        categoria: "sla",
        severidade: "medio",
        impeditivo: false,
        pessoaId: null,
        pessoaNome: null,
        titulo: `Prazo do processo em risco — ${prazo.rotuloDias}`,
        motivo: "O prazo vence em até 7 dias.",
        impacto: "Afeta o processo inteiro, não uma pessoa isolada.",
        fonte: FONTE_SLA,
        acao: "Priorizar as pendências desta linha antes do vencimento.",
        peso: 350,
      })
    }
  }

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

function categoriaDoInsight(i: Insight): CategoriaProblema | null {
  switch (i.categoria) {
    case "conflito":
      return "divergencia"
    case "duplicidade":
      return "duplicidade"
    case "sobrenome":
      return "divergencia"
    case "relacao":
      return "relacao"
    case "risco":
      return "linhagem"
    // Lacuna de cadastro e sugestão de pesquisa não são pendência operacional:
    // aparecem no painel de Análise, não na lista do que trava o processo.
    case "lacuna":
    case "pesquisa":
    case "migracao":
      return null
  }
}

// ── PRÓXIMA MELHOR AÇÃO ─────────────────────────────────────────────────────

export interface AcaoRecomendada {
  pessoaId: number | null
  pessoaNome: string | null
  /** O que fazer. */
  acao: string
  /** Por que é ESTA a próxima, e não outra. */
  motivo: string
  fonte: string
  /** Posição na fila fixa de prioridade (1..7). 7 = nada a fazer. */
  prioridade: number
  /** Problema de origem — o link de navegação da tela. */
  problemaId: string | null
}

/**
 * A fila é FIXA e declarada, não negociável por heurística:
 *
 *   1. bloqueio crítico          — o que impede
 *   2. divergência impeditiva    — o que invalida o documento que vier
 *   3. documento obrigatório ausente
 *   4. tarefa vencida
 *   5. tarefa aberta
 *   6. próxima obrigação documental (em atendimento)
 *   7. nenhuma ação necessária
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
    { prioridade: 4, casa: (p) => p.categoria === "tarefa_vencida" },
    { prioridade: 5, casa: (p) => p.categoria === "tarefa_aberta" },
    { prioridade: 6, casa: () => true },
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
    prioridade: 7,
    problemaId: null,
  }
}
