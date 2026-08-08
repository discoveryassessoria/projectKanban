// src/lib/genealogia/operacional/auditor.ts
//
// MODO AUDITOR — "por que isso existe?", respondido com a cadeia causal.
//
// O sistema decide muita coisa sozinho: esta certidão é exigida, esta pessoa
// está na linhagem, este bloqueio impede o avanço. Quando o operador discorda —
// ou só não entende — hoje ele não tem para onde olhar. O Auditor é essa
// resposta: a sequência de fatos que levou àquela decisão, cada elo nomeando a
// ENTIDADE e o MOTOR responsáveis.
//
// TRÊS REGRAS QUE MANTÊM ISTO HONESTO:
//
// 1. NENHUM ELO SEM FONTE. Cada degrau da cadeia declara de onde saiu. Um elo
//    sem fonte é opinião com cara de auditoria — pior do que não explicar.
//
// 2. NÃO REEXPLICA A REGRA, APONTA PARA ELA. O Auditor não sabe por que a Regra
//    Documental decidiu o que decidiu; ele sabe QUE ela decidiu, e diz qual é.
//    Reconstruir o raciocínio dela aqui seria a segunda implementação da regra —
//    e ela mudaria de opinião sem o Auditor perceber.
//
// 3. ONDE O DADO NÃO SUSTENTA, O AUDITOR DIZ ISSO. "Não é possível afirmar" é
//    uma resposta legítima e frequente. Inventar o elo que falta é o único jeito
//    de a explicação ficar bonita e errada.
//
// PURO: sem rede, sem banco, sem relógio.

import type { GrafoGenealogico } from "../motor/grafo"
import type { AnaliseArvore } from "../motor/tipos"
import type { Linhagem, MapaLinhagens } from "../motor/linhagens"
import { calcularParentesco } from "../motor/parentesco"
import { nomeCompleto } from "../motor/texto"
import type { DossiePessoa } from "./dossie"
import type { Problema } from "./diagnostico"

/** Um degrau da cadeia causal. */
export interface EloCausal {
  /** O fato, em linguagem de operador. */
  fato: string
  /** A entidade/motor de onde ele saiu. Nunca vazio. */
  fonte: string
  /** Id da pessoa envolvida, quando há uma — para o clique navegar. */
  pessoaId?: number
}

export interface Explicacao {
  pergunta: string
  /** A resposta em uma frase. */
  resposta: string
  /** A cadeia, do fato mais concreto até o motor que decidiu. */
  cadeia: EloCausal[]
  /** true quando os dados não sustentam uma afirmação. */
  inconclusiva: boolean
}

export interface ContextoAuditor {
  grafo: GrafoGenealogico
  analise: AnaliseArvore | null
  mapa: MapaLinhagens
  dossies: Map<number, DossiePessoa>
  linhagem: Linhagem | null
}

const FONTE_GRAFO = "Filiação cadastrada (Pessoa.paiId / Pessoa.maeId)"
const FONTE_MOTOR = "Motor genealógico — regra determinística"
const FONTE_DOC = "NecessidadeDocumental (Sistema Documental)"
const FONTE_MATERIALIZADOR = "materializarExecucaoDaFase → materializarGenealogia"
const FONTE_TAREFA = "Tarefa do processo (projeção do passo de workflow)"

function nome(g: GrafoGenealogico, id: number): string {
  const p = g.pessoa(id)
  return p ? nomeCompleto(p) : `#${id}`
}

// ── POR QUE ESTA PESSOA ESTÁ NA LINHAGEM? ───────────────────────────────────

export function porQueNaLinhagem(ctx: ContextoAuditor, pessoaId: number): Explicacao {
  const { grafo, mapa } = ctx
  const pergunta = `Por que ${nome(grafo, pessoaId)} está na linhagem?`
  const requerentes = mapa.compartilhadas.get(pessoaId) ?? []

  if (requerentes.length === 0) {
    // Cônjuge de quem está na linha é caso próprio: não transmite, mas a
    // certidão de casamento dele é exigida. Confundir os dois seria mentir.
    const conjugeDe = grafo.conjugesIds(pessoaId).filter((c) => mapa.emAlgumaLinha.has(c))
    if (conjugeDe.length > 0) {
      return {
        pergunta,
        resposta: `${nome(grafo, pessoaId)} NÃO está na cadeia de transmissão — está na tela por ser cônjuge de ${nome(grafo, conjugeDe[0])}, que está.`,
        cadeia: [
          { fato: `União cadastrada com ${nome(grafo, conjugeDe[0])}`, fonte: "Uniao (fato genealógico)", pessoaId: conjugeDe[0] },
          { fato: `${nome(grafo, conjugeDe[0])} pertence à cadeia de transmissão`, fonte: FONTE_MOTOR },
          { fato: "Cônjuge de quem está na linha entra na vista, mas não transmite", fonte: FONTE_MOTOR },
        ],
        inconclusiva: false,
      }
    }
    return {
      pergunta,
      resposta: `${nome(grafo, pessoaId)} não pertence a nenhuma linhagem hoje.`,
      cadeia: [
        { fato: "Nenhuma cadeia de requerente passa por esta pessoa", fonte: FONTE_MOTOR },
      ],
      inconclusiva: false,
    }
  }

  const reqId = requerentes[0]
  const linha = mapa.porRequerente.get(reqId)
  const cadeia: EloCausal[] = []

  if (linha) {
    const pos = linha.cadeia.indexOf(pessoaId)
    // Reconstrói o caminho degrau a degrau, cada um com o vínculo que o sustenta.
    for (let i = 0; i < Math.min(pos + 1, linha.cadeia.length); i++) {
      const id = linha.cadeia[i]
      if (i === 0) {
        cadeia.push({ fato: `${nome(grafo, id)} é requerente do processo`, fonte: "Requerente vinculado ao Processo", pessoaId: id })
        continue
      }
      const filho = linha.cadeia[i - 1]
      const p = grafo.pessoa(filho)
      const via = p?.paiId === id ? "pai" : p?.maeId === id ? "mãe" : "ascendente"
      cadeia.push({ fato: `${nome(grafo, id)} é ${via} de ${nome(grafo, filho)}`, fonte: FONTE_GRAFO, pessoaId: id })
    }
    if (linha.danteCausaId === pessoaId) {
      cadeia.push({
        fato: `${nome(grafo, pessoaId)} é o ascendente transmissor: é o mais próximo com país de nascimento ou nacionalidade do país-alvo`,
        fonte: FONTE_MOTOR,
      })
    }
  }

  const par = linha ? calcularParentesco(grafo, linha.requerenteId, pessoaId) : null
  return {
    pergunta,
    resposta:
      requerentes.length === 1
        ? `Porque é ${par?.rotulo ?? "ascendente"} de ${nome(grafo, reqId)}, na cadeia direta até o ascendente transmissor.`
        : `Porque está na cadeia direta de ${requerentes.length} requerentes: ${requerentes.map((r) => nome(grafo, r)).join(", ")}.`,
    cadeia,
    inconclusiva: cadeia.length === 0,
  }
}

// ── POR QUE ESTA EXIGÊNCIA DOCUMENTAL EXISTE? ───────────────────────────────

export function porQueExigencia(ctx: ContextoAuditor, pessoaId: number): Explicacao {
  const { grafo, dossies } = ctx
  const d = dossies.get(pessoaId)
  const pergunta = `Por que ${nome(grafo, pessoaId)} tem exigências documentais?`

  if (!d || d.documental.necessarias === 0) {
    return {
      pergunta,
      resposta: `Nenhuma exigência documental foi materializada para ${nome(grafo, pessoaId)}.`,
      cadeia: [
        { fato: "Sem NecessidadeDocumental para esta pessoa", fonte: FONTE_DOC },
        {
          fato: "Ou nenhuma Regra Documental publicada se aplica a ela, ou a fase que as materializa ainda não foi executada",
          fonte: FONTE_MATERIALIZADOR,
        },
      ],
      inconclusiva: true,
    }
  }

  const p = grafo.pessoa(pessoaId)
  // As CONDIÇÕES que a regra leu do cadastro. O Auditor não reavalia a regra:
  // ele mostra em que estado a pessoa estava quando o motor decidiu.
  const condicoes: string[] = []
  if (p?.casado) condicoes.push("está casada")
  if (p?.vivo === false) condicoes.push("está falecida")
  if (p?.requerente && p.requerente !== "nao") condicoes.push("é requerente")
  if (p?.linhaReta) condicoes.push("está na linha reta")
  if (p?.documentacao) condicoes.push("precisa de documentação")

  return {
    pergunta,
    resposta: `${d.documental.necessarias} exigência(s) — ${d.documental.atendidas + d.documental.dispensadas} resolvida(s), ${d.documental.pendentes} pendente(s).`,
    cadeia: [
      {
        fato: condicoes.length
          ? `No cadastro, ${nome(grafo, pessoaId)} ${condicoes.join(", ")}`
          : `${nome(grafo, pessoaId)} é pessoa da árvore do processo`,
        fonte: "Pessoa (Cadastro Mestre)",
        pessoaId,
      },
      { fato: "As Regras Documentais PUBLICADAS foram avaliadas contra esse estado", fonte: "MatrizDocumental (status PUBLICADA)" },
      { fato: "A fase Genealogia aceita a natureza destes documentos", fonte: "Política da fase (Catálogo de Fases)" },
      { fato: "As exigências aplicáveis foram materializadas", fonte: FONTE_MATERIALIZADOR },
      { fato: `Hoje: ${d.rotuloSituacao}`, fonte: FONTE_DOC },
    ],
    inconclusiva: false,
  }
}

// ── POR QUE ESTA TAREFA EXISTE? ─────────────────────────────────────────────

export function porQueTarefa(ctx: ContextoAuditor, pessoaId: number, tarefaId: number): Explicacao {
  const { grafo, dossies } = ctx
  const d = dossies.get(pessoaId)
  const t = d?.tarefasAbertas.find((x) => x.id === tarefaId)
  const pergunta = `Por que a tarefa "${t?.titulo ?? `#${tarefaId}`}" existe?`

  if (!t) {
    return {
      pergunta,
      resposta: "Tarefa não encontrada entre as abertas desta pessoa.",
      cadeia: [{ fato: "Sem tarefa aberta com este id", fonte: FONTE_TAREFA }],
      inconclusiva: true,
    }
  }

  const cadeia: EloCausal[] = [
    { fato: `Tarefa vinculada a ${nome(grafo, pessoaId)}`, fonte: FONTE_TAREFA, pessoaId },
  ]
  if (t.necessidadeId != null) {
    cadeia.push({ fato: `Originada da exigência documental #${t.necessidadeId}`, fonte: FONTE_DOC })
    cadeia.push({ fato: "A exigência gerou um passo de workflow; a tarefa é a projeção desse passo", fonte: "Motor de workflow" })
  } else {
    cadeia.push({ fato: "Sem necessidade de origem — é tarefa do processo, não desta pessoa", fonte: FONTE_TAREFA })
  }
  cadeia.push({
    fato: `Estado atual: ${t.statusTarefa ?? "sem status"}${t.dataPrazo ? ` · prazo ${t.dataPrazo.slice(0, 10)}` : ""}`,
    fonte: FONTE_TAREFA,
  })

  return {
    pergunta,
    resposta: t.necessidadeId != null
      ? "Porque uma exigência documental desta pessoa gerou um passo de workflow, e a tarefa é a projeção dele."
      : "Porque foi criada no processo, sem vínculo com exigência documental desta pessoa.",
    cadeia,
    inconclusiva: false,
  }
}

// ── POR QUE ESTA PENDÊNCIA / BLOQUEIO? ──────────────────────────────────────

export function porQueProblema(ctx: ContextoAuditor, problema: Problema): Explicacao {
  const cadeia: EloCausal[] = [
    { fato: problema.motivo, fonte: problema.fonte, pessoaId: problema.pessoaId ?? undefined },
    { fato: problema.impacto, fonte: "Motor genealógico — cadeias que passam por esta pessoa" },
  ]
  if (problema.impeditivo) {
    cadeia.push({
      fato: "Classificado como IMPEDITIVO: não é fila de trabalho, é o que trava a conclusão",
      fonte: "Diagnóstico da Árvore — critério fechado (crítico = bloqueio impeditivo)",
    })
  }
  cadeia.push({ fato: `Ação recomendada: ${problema.acao}`, fonte: problema.fonte })

  return {
    pergunta: `Por que "${problema.titulo}"?`,
    resposta: problema.impeditivo
      ? "É um impedimento: enquanto existir, a conclusão documental desta linha não fecha."
      : "É uma pendência de atenção: atrasa, mas não impede.",
    cadeia,
    inconclusiva: false,
  }
}

// ── POR QUE FALTAM DOCUMENTOS? ──────────────────────────────────────────────

export function porQueFaltamDocumentos(ctx: ContextoAuditor, pessoaId: number): Explicacao {
  const { grafo, dossies } = ctx
  const d = dossies.get(pessoaId)
  const pergunta = `Por que faltam documentos de ${nome(grafo, pessoaId)}?`

  if (!d || d.documental.necessarias === 0) {
    return {
      pergunta,
      resposta: "Não faltam: nenhuma exigência foi materializada para esta pessoa.",
      cadeia: [{ fato: "Zero NecessidadeDocumental para este sujeito", fonte: FONTE_DOC, pessoaId }],
      inconclusiva: true,
    }
  }

  const doc = d.documental
  const faltam = doc.necessarias - (doc.atendidas + doc.dispensadas)
  if (faltam <= 0) {
    return {
      pergunta,
      resposta: `Não faltam: as ${doc.necessarias} exigências estão atendidas ou dispensadas.`,
      cadeia: [
        { fato: `${doc.atendidas} atendida(s) e ${doc.dispensadas} dispensada(s)`, fonte: FONTE_DOC, pessoaId },
        { fato: "Dispensada conta como resolvida — o Sistema Documental decidiu que não se aplica", fonte: FONTE_DOC },
      ],
      inconclusiva: false,
    }
  }

  // A decomposição é o que responde "por quê": faltar por não ter começado é
  // diferente de faltar porque a busca já foi feita e o registro não apareceu.
  const cadeia: EloCausal[] = [
    { fato: `${doc.necessarias} exigência(s) materializada(s) para esta pessoa`, fonte: FONTE_DOC, pessoaId },
  ]
  if (doc.pendentes > 0) {
    cadeia.push({ fato: `${doc.pendentes} ainda não iniciada(s) — trabalho parado, não bloqueio`, fonte: FONTE_DOC })
  }
  if (doc.emAtendimento > 0) {
    cadeia.push({ fato: `${doc.emAtendimento} em atendimento — já em andamento`, fonte: FONTE_DOC })
  }
  if (doc.naoLocalizadas > 0) {
    cadeia.push({
      fato: `${doc.naoLocalizadas} marcada(s) como NÃO LOCALIZADA — a busca foi feita e o registro não apareceu`,
      fonte: FONTE_DOC,
    })
  }
  cadeia.push({ fato: `Situação consolidada: ${d.rotuloSituacao}`, fonte: FONTE_DOC })

  return {
    pergunta,
    resposta: `Faltam ${faltam} de ${doc.necessarias}: ${doc.pendentes} sem início, ${doc.emAtendimento} em atendimento, ${doc.naoLocalizadas} não localizada(s).`,
    cadeia,
    inconclusiva: false,
  }
}

// ── O QUE IMPEDE ESTE REQUERENTE DE AVANÇAR? ────────────────────────────────

export function oQueImpedeAvancar(ctx: ContextoAuditor, problemas: readonly Problema[]): Explicacao {
  const { linhagem } = ctx
  const alvo = linhagem?.nome ?? "esta linha"
  const impeditivos = problemas.filter((p) => p.impeditivo)

  if (impeditivos.length === 0) {
    const atencao = problemas.length
    return {
      pergunta: `O que impede ${alvo} de avançar?`,
      // A distinção que o operador precisa: nada IMPEDE ≠ está tudo pronto.
      resposta:
        atencao > 0
          ? `Nada impede. Há ${atencao} pendência(s) de atenção — atrasam, mas não travam.`
          : "Nada impede e não há pendência conhecida nesta linha.",
      cadeia: [
        { fato: "Nenhum problema classificado como impeditivo", fonte: "Diagnóstico da Árvore — critério fechado" },
        ...(atencao > 0
          ? [{ fato: `${atencao} item(ns) de atenção na fila de trabalho`, fonte: FONTE_DOC }]
          : []),
      ],
      inconclusiva: false,
    }
  }

  return {
    pergunta: `O que impede ${alvo} de avançar?`,
    resposta:
      impeditivos.length === 1
        ? impeditivos[0].titulo
        : `${impeditivos.length} impedimentos, começando por: ${impeditivos[0].titulo}`,
    cadeia: impeditivos.slice(0, 5).map((p) => ({
      fato: `${p.titulo} — ${p.impacto}`,
      fonte: p.fonte,
      pessoaId: p.pessoaId ?? undefined,
    })),
    inconclusiva: false,
  }
}

// ── EXPLIQUE ESTA DIVERGÊNCIA ───────────────────────────────────────────────

export function porQueDivergencia(ctx: ContextoAuditor, pessoaId: number, insightId: string): Explicacao {
  const { grafo, dossies } = ctx
  const d = dossies.get(pessoaId)
  const i = d?.divergencias.find((x) => x.id === insightId)
  const pergunta = "Por que esta divergência foi apontada?"

  if (!i) {
    return {
      pergunta,
      resposta: "Divergência não encontrada para esta pessoa.",
      cadeia: [{ fato: "Sem insight com este id", fonte: FONTE_MOTOR }],
      inconclusiva: true,
    }
  }

  const envolvidos = i.pessoaIds.map((id) => nome(grafo, id)).join(" e ")
  const cadeia: EloCausal[] = [
    { fato: `Envolve ${envolvidos}`, fonte: "Pessoa (Cadastro Mestre)", pessoaId },
    { fato: i.explicacao, fonte: FONTE_MOTOR },
  ]
  // Confiança < 1 é SUSPEITA, não fato. Apresentar as duas do mesmo jeito é o
  // que treina o operador a ignorar alerta.
  if (typeof i.confianca === "number" && i.confianca < 1) {
    cadeia.push({
      fato: `Confiança ${Math.round(i.confianca * 100)}% — é suspeita a confirmar, não fato provado`,
      fonte: FONTE_MOTOR,
    })
  } else {
    cadeia.push({ fato: "Contradição provada pelos dados, não estimada", fonte: FONTE_MOTOR })
  }
  if (i.acao) cadeia.push({ fato: `Ação: ${i.acao}`, fonte: FONTE_MOTOR })

  return { pergunta, resposta: i.titulo, cadeia, inconclusiva: false }
}

// ── POR QUE ESTE CUSTO/RECEITA ESTÁ PREVISTO? ───────────────────────────────

export function porQueValor(ctx: ContextoAuditor, pessoaId: number, financeiroVisivel: boolean): Explicacao {
  const { grafo, dossies } = ctx
  const d = dossies.get(pessoaId)
  const pergunta = `Por que ${nome(grafo, pessoaId)} tem valores lançados?`

  if (!financeiroVisivel) {
    return {
      pergunta,
      resposta: "Sem permissão para ver valores.",
      cadeia: [{ fato: "O servidor omitiu o bloco financeiro (falta financeiro.ver)", fonte: "Autorização do processo" }],
      inconclusiva: true,
    }
  }
  const total = (d?.custos.length ?? 0) + (d?.receitas.length ?? 0)
  if (!d || total === 0) {
    return {
      pergunta,
      resposta: "Nenhum lançamento econômico está vinculado a esta pessoa.",
      cadeia: [{ fato: "Sem ObrigacaoEconomica com personId desta pessoa", fonte: "Motor Financeiro V3", pessoaId }],
      inconclusiva: false,
    }
  }

  return {
    pergunta,
    resposta: `${d.custos.length} linha(s) de custo e ${d.receitas.length} de receita vinculadas a esta pessoa.`,
    cadeia: [
      { fato: "Existe ObrigacaoEconomica com esta pessoa no vínculo documental", fonte: "Motor Financeiro V3", pessoaId },
      { fato: "O valor foi congelado no lançamento pela Tabela de Preços vigente", fonte: "Tabela de Preços — fonte única de preço" },
      { fato: "Recebido e saldo vêm do Ledger — a árvore não soma movimento", fonte: "LedgerFinanceiro (única verdade do movimento)" },
      { fato: "Somas por moeda, sem conversão: taxa é do motor de câmbio", fonte: "Motor de câmbio" },
    ],
    inconclusiva: false,
  }
}

// ── POR QUE ESTA É A PRÓXIMA AÇÃO? ──────────────────────────────────────────

const FILA = [
  "bloqueio crítico",
  "divergência impeditiva",
  "documento obrigatório ausente",
  "tarefa vencida",
  "tarefa aberta",
  "próxima obrigação documental",
  "nenhuma ação necessária",
]

export function porQueProximaAcao(prioridade: number, fonte: string, motivo: string): Explicacao {
  const idx = Math.max(1, Math.min(prioridade, FILA.length)) - 1
  const acimaNaFila = FILA.slice(0, idx)

  return {
    pergunta: "Por que esta é a próxima ação?",
    resposta: `Porque é o item mais alto da fila fixa de prioridade que existe hoje: ${FILA[idx]} (${prioridade}/7).`,
    cadeia: [
      { fato: motivo, fonte },
      {
        fato: acimaNaFila.length
          ? `Nada acima na fila está pendente: ${acimaNaFila.join(", ")}`
          : "É o topo da fila — não há categoria mais urgente",
        fonte: "Diagnóstico da Árvore — fila FIXA de 7 prioridades, não heurística",
      },
      {
        fato: "Dentro da mesma faixa, desempata o peso — que já multiplica pelos requerentes que dependem da pessoa",
        fonte: "Motor genealógico — pessoas compartilhadas entre linhagens",
      },
    ],
    inconclusiva: false,
  }
}
