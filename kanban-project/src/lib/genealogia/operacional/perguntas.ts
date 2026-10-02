// src/lib/genealogia/operacional/perguntas.ts
//
// PERGUNTAS DA ÁRVORE — respostas determinísticas, com fonte.
//
// O pedido era "inteligência capaz de responder". A tentação seria mandar a
// árvore para um modelo de linguagem. Não é isso que está aqui, por três razões
// que não são de gosto:
//
//   1. Um modelo responde bonito quando não sabe. Numa pergunta como "quem
//      transmite cidadania?", uma resposta plausível e errada custa um processo.
//   2. As respostas abaixo já existem nos dados: o motor genealógico apura a
//      linha, o Sistema Documental apura a exigência, o Ledger apura o valor.
//      Perguntar a um terceiro o que a fonte já sabe é criar uma segunda verdade.
//   3. Enviar a genealogia de um cliente para fora do processo é decisão de
//      produto e de privacidade — não é efeito colateral de uma funcionalidade.
//
// Então cada resposta aqui é uma CONSULTA: sai de um fato, aponta as ENTIDADES
// REAIS envolvidas (a pessoa, o documento pelo nome do catálogo, a tarefa que já
// existe) e pode ser conferida clicando nelas. Quando não há dado, a resposta
// é "não dá para afirmar" — e diz o que falta para poder.
//
// REVISÃO DA ETAPA 5 — o que mudou e por quê:
//   • os TOTAIS vêm de `indicadores.ts`, a mesma função do cartão de resumo.
//     Antes, "O que falta?" somava `documental.necessarias` por pessoa e contava
//     a certidão de casamento uma vez por cônjuge — número diferente do
//     "Documentos X de Y" do cartão para a mesma linha;
//   • "O que falta/impede?" listam os DOCUMENTOS pelo nome e estado (a fila da
//     pessoa, a mesma da aba Operação), não só "N documentos";
//   • "Quem tem pendência?" conta divergência pela lista de achados (a da aba
//     Operação), não por um subconjunto;
//   • "Que documento precisará de retificação?" virou "Quais dados se
//     contradizem?": o motor aponta DADOS que se contradizem, não o documento a
//     retificar — responder com um documento seria inventar o mapeamento;
//   • PRAZO não aparece em nenhuma resposta: a Árvore não tem prazo/SLA
//     (decisão de 17/09/2026) e o prazo de certidão é projeção da Solicitação —
//     `Tarefa.dataPrazo` não é fonte dele. Sem fonte real, sem prazo.

import type { GrafoGenealogico } from "../motor/grafo"
import type { AnaliseArvore } from "../motor/tipos"
import type { Linhagem, MapaLinhagens } from "../motor/linhagens"
import { rotuloPais } from "../motor/regras/linhagem"
import { nomeCompleto } from "../motor/texto"
import type { ProjecaoDocumental } from "../documental/indicadores"
import type { DossiePessoa } from "./dossie"
import type { AchadoDoMotor } from "./achados-do-motor"
import { achadosDoMotorPorPessoa } from "./achados-do-motor"
import type { EstadoDocumento, FilaDaPessoa, ItemDocumento } from "./fila-da-pessoa"
import { indicadoresDoEscopo } from "./indicadores"
import { rascunhoDoDocumento, type RascunhoTarefa } from "./tarefa-do-passo"

export type ChavePergunta =
  | "o_que_falta"
  | "o_que_impede"
  | "quem_tem_pendencia"
  | "quem_transmite"
  | "o_que_retificar"

export interface Pergunta {
  chave: ChavePergunta
  texto: string
}

/** Documento citado numa resposta — nome do CATÁLOGO e estado oficial. */
export interface DocumentoCitado {
  necessidadeId: number
  nome: string
  estado: EstadoDocumento
  rotuloEstado: string
}

export interface ItemResposta {
  /** Pessoa-alvo do clique (foco no mapa). */
  pessoaId: number | null
  texto: string
  /** Documento citado, quando o item é um documento. */
  documento?: DocumentoCitado
  /** Tarefa que JÁ existe para o documento — destino do "Abrir tarefa". */
  tarefa?: { id: number; processoId: number }
  /** Documento sem tarefa: o rascunho do "Criar tarefa". */
  rascunho?: RascunhoTarefa
}

export interface Resposta {
  chave: ChavePergunta
  /** A resposta em uma frase. Sempre presente, mesmo quando é "não dá para afirmar". */
  resumo: string
  /** Escopo da resposta: "Linhagem de Marcos" ou "Árvore inteira". */
  escopo: string
  /** Itens de apoio, já ordenados por relevância. Pode ser vazio. */
  itens: ItemResposta[]
  /** Quantos itens a resposta teria sem o corte de exibição. */
  totalItens: number
  /** De onde saiu a resposta. Aparece na tela — resposta sem fonte não é resposta. */
  fonte: string
}

export const PERGUNTAS: Pergunta[] = [
  { chave: "o_que_falta", texto: "O que falta para concluir este requerente?" },
  { chave: "o_que_impede", texto: "Qual documento está impedindo o avanço?" },
  { chave: "quem_tem_pendencia", texto: "Quais pessoas têm pendências?" },
  { chave: "quem_transmite", texto: "Quem transmite a cidadania?" },
  { chave: "o_que_retificar", texto: "Quais dados se contradizem e podem pedir retificação?" },
]

export interface ContextoPerguntas {
  grafo: GrafoGenealogico
  analise: AnaliseArvore | null
  mapa: MapaLinhagens
  dossies: Map<number, DossiePessoa>
  /** Linhagem em foco. Sem ela, as perguntas de requerente respondem sobre a árvore. */
  linhagem: Linhagem | null
  /** Projeção documental BRUTA — a mesma do cartão de resumo. */
  projecao: ProjecaoDocumental
  /** Fila da pessoa (documentos com estado + achados) — a MESMA função da aba Operação. */
  filaDe: (pessoaId: number) => FilaDaPessoa
  /** Achados do motor por pessoa — a mesma lista que a aba Operação mostra. */
  achadosPorPessoa: Map<number, AchadoDoMotor[]>
}

/**
 * Monta o contexto. Existe para o hook da tela e os testes montarem EXATAMENTE
 * a mesma coisa: ninguém monta um `ContextoPerguntas` à mão.
 */
export function contextoDePerguntas(base: {
  grafo: GrafoGenealogico
  analise: AnaliseArvore | null
  mapa: MapaLinhagens
  dossies: Map<number, DossiePessoa>
  linhagem: Linhagem | null
  projecao: ProjecaoDocumental
  filaDe: (pessoaId: number) => FilaDaPessoa
}): ContextoPerguntas {
  return { ...base, achadosPorPessoa: achadosDoMotorPorPessoa(base.analise) }
}

export function responder(chave: ChavePergunta, ctx: ContextoPerguntas): Resposta {
  switch (chave) {
    case "o_que_falta":
      return oQueFalta(ctx)
    case "o_que_impede":
      return oQueImpede(ctx)
    case "quem_tem_pendencia":
      return quemTemPendencia(ctx)
    case "quem_transmite":
      return quemTransmite(ctx)
    case "o_que_retificar":
      return oQueRetificar(ctx)
  }
}

export function responderTodas(ctx: ContextoPerguntas): Resposta[] {
  return PERGUNTAS.map((p) => responder(p.chave, ctx))
}

// ── implementações ──────────────────────────────────────────────────────────

/** Teto de itens listados por resposta; o total real continua em `totalItens`. */
const TETO_ITENS = 12

function escopo(ctx: ContextoPerguntas): number[] {
  if (ctx.linhagem) return [...ctx.linhagem.visivel]
  return ctx.grafo.pessoas.map((p) => p.id)
}

function rotuloEscopo(ctx: ContextoPerguntas): string {
  return ctx.linhagem ? `Linhagem de ${ctx.linhagem.nome}` : "Árvore inteira"
}

function nomeDe(ctx: ContextoPerguntas, id: number): string {
  const p = ctx.grafo.pessoa(id)
  return p ? nomeCompleto(p) : `#${id}`
}

/** Números do escopo — a MESMA função que alimenta o cartão de resumo. */
function numerosDoEscopo(ctx: ContextoPerguntas) {
  const ids = new Set(escopo(ctx))
  return indicadoresDoEscopo({ ids, grafo: ctx.grafo, analise: ctx.analise, projecao: ctx.projecao })
}

/** Estados em que o documento ainda é trabalho. */
const ESTADOS_EM_ABERTO: ReadonlySet<EstadoDocumento> = new Set<EstadoDocumento>([
  "bloqueado", "a_localizar", "a_solicitar", "solicitado",
])

interface DocumentoNoEscopo {
  pessoaId: number
  item: ItemDocumento
}

/**
 * Documentos do escopo, na ordem de urgência da fila. A certidão de casamento é
 * da UNIÃO e aparece na fila dos dois cônjuges: entra UMA vez (pela necessidade).
 */
function documentosDoEscopo(ctx: ContextoPerguntas): DocumentoNoEscopo[] {
  const vistos = new Set<number>()
  const saida: DocumentoNoEscopo[] = []
  for (const id of escopo(ctx)) {
    for (const item of ctx.filaDe(id).itens) {
      if (item.tipo !== "documento" || vistos.has(item.necessidadeId)) continue
      vistos.add(item.necessidadeId)
      saida.push({ pessoaId: id, item })
    }
  }
  return saida.sort(
    (a, b) => a.item.ordem - b.item.ordem || a.item.necessidadeId - b.item.necessidadeId,
  )
}

function itemDeDocumento(ctx: ContextoPerguntas, d: DocumentoNoEscopo): ItemResposta {
  const nome = nomeDe(ctx, d.pessoaId)
  const abrir = d.item.acoes.find((a) => a.tipo === "abrir_tarefa")
  const resposta: ItemResposta = {
    pessoaId: d.pessoaId,
    texto: `${d.item.nome} — ${nome} · ${d.item.rotuloEstado}`,
    documento: {
      necessidadeId: d.item.necessidadeId,
      nome: d.item.nome,
      estado: d.item.estado,
      rotuloEstado: d.item.rotuloEstado,
    },
  }
  if (abrir && abrir.tipo === "abrir_tarefa") {
    resposta.tarefa = { id: abrir.tarefaId, processoId: abrir.processoId }
  } else {
    // Sem tarefa para executar: o botão certo é CRIAR uma (pela porta canônica).
    resposta.rascunho = rascunhoDoDocumento(d.item, d.pessoaId, nome)
  }
  return resposta
}

function oQueFalta(ctx: ContextoPerguntas): Resposta {
  const { documental, divergencias } = numerosDoEscopo(ctx)
  const resolvidos = documental.atendidas + documental.dispensadas
  const faltam = documental.necessarias - resolvidos

  const abertos = documentosDoEscopo(ctx).filter(
    (d) => !d.item.opcional && ESTADOS_EM_ABERTO.has(d.item.estado),
  )
  const impeditivas = divergencias.itens.filter((a) => a.impeditivo)

  const base = {
    chave: "o_que_falta" as const,
    escopo: rotuloEscopo(ctx),
    fonte: "NecessidadeDocumental (Sistema Documental) + motor genealógico",
  }

  if (documental.necessarias === 0) {
    return {
      ...base,
      resumo:
        "Ainda não há exigência documental materializada para esta linha. O que falta é a fase que gera as exigências ser executada.",
      itens: [],
      totalItens: 0,
      fonte: "NecessidadeDocumental do processo (Sistema Documental)",
    }
  }

  const itens: ItemResposta[] = [
    ...abertos.map((d) => itemDeDocumento(ctx, d)),
    ...impeditivas.map((a) => ({
      pessoaId: a.pessoaId,
      texto: `${a.titulo} — divergência crítica`,
    })),
  ]
  const partes: string[] = []
  partes.push(
    faltam === 0
      ? `Nenhum documento: as ${documental.necessarias} exigências estão atendidas ou dispensadas`
      : `Faltam ${faltam} de ${documental.necessarias} documentos exigidos`,
  )
  if (impeditivas.length > 0) partes.push(`${impeditivas.length} divergência(s) crítica(s) do motor impedem a conclusão`)
  return {
    ...base,
    resumo: `${partes.join("; ")}.`,
    itens: itens.slice(0, TETO_ITENS),
    totalItens: itens.length,
  }
}

function oQueImpede(ctx: ContextoPerguntas): Resposta {
  const { divergencias } = numerosDoEscopo(ctx)

  // "Impedir" tem definição, não é sinônimo de "faltar": impede o que está
  // marcado como NÃO LOCALIZADO pelo Sistema Documental, e o que o motor
  // classificou como crítico. O resto é fila de trabalho, não bloqueio.
  const bloqueados = documentosDoEscopo(ctx).filter((d) => d.item.estado === "bloqueado")
  const criticos = divergencias.itens.filter((a) => a.impeditivo)

  const base = {
    chave: "o_que_impede" as const,
    escopo: rotuloEscopo(ctx),
    fonte: "NecessidadeDocumental (status NAO_LOCALIZADA) + motor genealógico",
  }

  if (bloqueados.length === 0 && criticos.length === 0) {
    return {
      ...base,
      resumo: "Nenhum documento está marcado como não localizado e não há conflito crítico nesta linha.",
      itens: [],
      totalItens: 0,
    }
  }

  const itens: ItemResposta[] = [
    ...bloqueados.map((d) => itemDeDocumento(ctx, d)),
    ...criticos.map((a) => ({ pessoaId: a.pessoaId, texto: `${a.titulo} — ${a.acao}` })),
  ]
  return {
    ...base,
    resumo: bloqueados.length
      ? `${bloqueados.length} documento(s) não localizado(s) — é o que trava a linha.`
      : `Nenhum documento faltando, mas há ${criticos.length} conflito(s) crítico(s) que invalidam o que vier.`,
    itens: itens.slice(0, TETO_ITENS),
    totalItens: itens.length,
  }
}

function quemTemPendencia(ctx: ContextoPerguntas): Resposta {
  const lista = escopo(ctx)
    .map((id) => {
      const d = ctx.dossies.get(id)
      const achados = ctx.achadosPorPessoa.get(id) ?? []
      const docs = d ? d.documental.pendentes + d.documental.naoLocalizadas + d.documental.emAtendimento : 0
      return { id, d, achados, docs }
    })
    // Pendência = documento em aberto OU achado do motor — a mesma definição
    // da aba Operação (a lista de achados, não um subconjunto dela).
    .filter((x) => x.d && (x.docs > 0 || x.achados.length > 0))
    .sort((a, b) => b.d!.urgencia - a.d!.urgencia || a.id - b.id)

  return {
    chave: "quem_tem_pendencia",
    escopo: rotuloEscopo(ctx),
    resumo: lista.length
      ? `${lista.length} pessoa(s) com pendência, em ordem de impacto sobre a cidadania.`
      : "Nenhuma pessoa desta linha tem pendência documental ou divergência.",
    itens: lista.slice(0, TETO_ITENS).map(({ id, d, achados }) => ({
      pessoaId: id,
      texto:
        `${d!.nome} — ${d!.rotuloSituacao}` +
        (achados.length ? ` · ${achados.length} divergência(s)` : "") +
        (d!.requerentesDependentes.length > 1
          ? ` · ${d!.requerentesDependentes.length} requerentes dependem dela`
          : ""),
    })),
    totalItens: lista.length,
    fonte: "NecessidadeDocumental + motor genealógico",
  }
}

function quemTransmite(ctx: ContextoPerguntas): Resposta {
  const { grafo, mapa, linhagem, analise } = ctx
  const alvo = linhagem ?? mapa.linhagens[0] ?? null

  if (!alvo || alvo.cadeia.length <= 1) {
    return {
      chave: "quem_transmite",
      escopo: rotuloEscopo(ctx),
      resumo:
        "Não dá para afirmar: não há cadeia de ascendentes cadastrada a partir do requerente. Cadastre pai/mãe subindo a linha.",
      itens: [],
      totalItens: 0,
      fonte: "Filiação cadastrada (Pessoa.paiId / Pessoa.maeId)",
    }
  }

  const dc = alvo.danteCausaId != null ? grafo.pessoa(alvo.danteCausaId) : null
  const pais = analise?.paisAlvo ? rotuloPais(analise.paisAlvo) : null

  // Sem país-alvo a cadeia é a ascendência mais profunda: é uma cadeia, não uma
  // transmissão comprovada. A resposta precisa dizer isso.
  const temPaisAlvo = Boolean(analise?.paisAlvo)
  const danteCausaComprovado =
    temPaisAlvo && dc != null && analise?.danteCausaId != null

  return {
    chave: "quem_transmite",
    escopo: rotuloEscopo(ctx),
    resumo: dc
      ? danteCausaComprovado
        ? `${nomeCompleto(dc)} — ascendente registrado como ${pais ? `nascido/nacional de ${pais}` : "estrangeiro"}, ${alvo.geracoes} geração(ões) acima de ${alvo.nome}.`
        : `A cadeia mais profunda de ${alvo.nome} chega a ${nomeCompleto(dc)}, mas nenhum ascendente tem país de nascimento ou nacionalidade do país-alvo registrado — a transmissão ainda não está comprovada pelos dados.`
      : `A cadeia de ${alvo.nome} não chega a nenhum ascendente.`,
    itens: alvo.cadeia.map((id, i) => {
      const p = grafo.pessoa(id)
      const dependentes = mapa.compartilhadas.get(id)?.length ?? 0
      return {
        pessoaId: id,
        texto:
          `${i === 0 ? "Requerente" : `${i}ª geração acima`}: ${p ? nomeCompleto(p) : `#${id}`}` +
          (dependentes > 1 ? ` · compartilhado por ${dependentes} requerentes` : ""),
      }
    }),
    totalItens: alvo.cadeia.length,
    fonte: "Motor genealógico — cadeia ascendente + país de nascimento/nacionalidade",
  }
}

function oQueRetificar(ctx: ContextoPerguntas): Resposta {
  const { divergencias } = numerosDoEscopo(ctx)

  // Retificação é hipótese, e hipótese precisa de sinal. O sinal aqui são as
  // divergências que o motor já classifica como CONTRADIÇÃO DE DADO (data
  // impossível, grafia de sobrenome entre gerações). A árvore NÃO decide que
  // houve erro no registro nem QUAL documento o contém — ela aponta onde a
  // contradição está e quem confere é o operador. Por isso a pergunta fala em
  // dados, não em documento.
  const candidatos = divergencias.itens.filter((a) => a.categoria === "divergencia")

  return {
    chave: "o_que_retificar",
    escopo: rotuloEscopo(ctx),
    resumo: candidatos.length
      ? `${candidatos.length} ponto(s) onde os dados se contradizem — cada um é um candidato a retificação, a confirmar na certidão.`
      : "Nenhuma contradição de nome ou data foi encontrada nesta linha.",
    itens: candidatos.slice(0, TETO_ITENS).map((a) => {
      const outros = a.pessoaIds.filter((id) => id !== a.pessoaId).map((id) => nomeDe(ctx, id))
      return {
        pessoaId: a.pessoaId,
        texto:
          `${a.titulo} → ${a.acao}` + (outros.length ? ` (envolve também: ${outros.join(", ")})` : ""),
      }
    }),
    totalItens: candidatos.length,
    fonte: "Motor genealógico — regras de cronologia e de variação de sobrenome",
  }
}
