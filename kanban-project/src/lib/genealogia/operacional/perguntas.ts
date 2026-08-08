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
// Então cada resposta aqui é uma CONSULTA: sai de um fato, aponta as pessoas
// envolvidas e pode ser conferida clicando nelas. Quando não há dado, a resposta
// é "não dá para afirmar" — e diz o que falta para poder.

import type { GrafoGenealogico } from "../motor/grafo"
import type { AnaliseArvore } from "../motor/tipos"
import type { Linhagem, MapaLinhagens } from "../motor/linhagens"
import { rotuloPais } from "../motor/regras/linhagem"
import { nomeCompleto } from "../motor/texto"
import type { DossiePessoa } from "./dossie"

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

export interface Resposta {
  chave: ChavePergunta
  /** A resposta em uma frase. Sempre presente, mesmo quando é "não dá para afirmar". */
  resumo: string
  /** Itens de apoio, já ordenados por relevância. Pode ser vazio. */
  itens: Array<{ pessoaId: number | null; texto: string }>
  /** De onde saiu a resposta. Aparece na tela — resposta sem fonte não é resposta. */
  fonte: string
}

export const PERGUNTAS: Pergunta[] = [
  { chave: "o_que_falta", texto: "O que falta para concluir este requerente?" },
  { chave: "o_que_impede", texto: "Qual documento está impedindo o avanço?" },
  { chave: "quem_tem_pendencia", texto: "Quais pessoas têm pendências?" },
  { chave: "quem_transmite", texto: "Quem transmite a cidadania?" },
  { chave: "o_que_retificar", texto: "Que documento provavelmente precisará de retificação?" },
]

export interface ContextoPerguntas {
  grafo: GrafoGenealogico
  analise: AnaliseArvore | null
  mapa: MapaLinhagens
  dossies: Map<number, DossiePessoa>
  /** Linhagem em foco. Sem ela, as perguntas de requerente respondem sobre a árvore. */
  linhagem: Linhagem | null
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

function escopo(ctx: ContextoPerguntas): number[] {
  if (ctx.linhagem) return [...ctx.linhagem.visivel]
  return ctx.grafo.pessoas.map((p) => p.id)
}

function dossiesDoEscopo(ctx: ContextoPerguntas): DossiePessoa[] {
  return escopo(ctx)
    .map((id) => ctx.dossies.get(id))
    .filter((d): d is DossiePessoa => Boolean(d))
}

function oQueFalta(ctx: ContextoPerguntas): Resposta {
  const lista = dossiesDoEscopo(ctx)
  const comPendencia = lista
    .filter((d) => d.documental.pendentes + d.documental.naoLocalizadas + d.documental.emAtendimento > 0)
    .sort((a, b) => b.urgencia - a.urgencia || a.pessoaId - b.pessoaId)

  const totalExigido = lista.reduce((s, d) => s + d.documental.necessarias, 0)
  const totalResolvido = lista.reduce((s, d) => s + d.documental.atendidas + d.documental.dispensadas, 0)

  if (totalExigido === 0) {
    return {
      chave: "o_que_falta",
      resumo:
        "Ainda não há exigência documental materializada para esta linha. O que falta é a fase que gera as exigências ser executada.",
      itens: [],
      fonte: "NecessidadeDocumental do processo (Sistema Documental)",
    }
  }

  const faltando = totalExigido - totalResolvido
  return {
    chave: "o_que_falta",
    resumo:
      faltando === 0
        ? `Nada: as ${totalExigido} exigências desta linha estão atendidas ou dispensadas.`
        : `Faltam ${faltando} de ${totalExigido} exigências, distribuídas em ${comPendencia.length} pessoa(s).`,
    itens: comPendencia.slice(0, 8).map((d) => ({
      pessoaId: d.pessoaId,
      texto: `${d.nome} — ${d.proximaAcao ?? d.rotuloSituacao}`,
    })),
    fonte: "NecessidadeDocumental do processo (Sistema Documental)",
  }
}

function oQueImpede(ctx: ContextoPerguntas): Resposta {
  const lista = dossiesDoEscopo(ctx)

  // "Impedir" tem definição, não é sinônimo de "faltar": impede o que está
  // marcado como NÃO LOCALIZADO pelo Sistema Documental, e o que o motor
  // classificou como crítico. O resto é fila de trabalho, não bloqueio.
  const bloqueados = lista
    .filter((d) => d.documental.naoLocalizadas > 0)
    .sort((a, b) => b.documental.naoLocalizadas - a.documental.naoLocalizadas || a.pessoaId - b.pessoaId)

  const criticos = lista
    .flatMap((d) => d.divergencias.filter((i) => i.severidade === "critico").map((i) => ({ d, i })))
    .sort((a, b) => b.i.peso - a.i.peso)

  if (bloqueados.length === 0 && criticos.length === 0) {
    return {
      chave: "o_que_impede",
      resumo: "Nenhum documento está marcado como não localizado e não há conflito crítico nesta linha.",
      itens: [],
      fonte: "NecessidadeDocumental (status NAO_LOCALIZADA) + motor genealógico",
    }
  }

  return {
    chave: "o_que_impede",
    resumo: bloqueados.length
      ? `${bloqueados.length} pessoa(s) com documento não localizado — é o que trava a linha.`
      : `Nenhum documento faltando, mas há ${criticos.length} conflito(s) crítico(s) que invalidam o que vier.`,
    itens: [
      ...bloqueados.slice(0, 6).map((d) => ({
        pessoaId: d.pessoaId,
        texto: `${d.nome} — ${d.documental.naoLocalizadas} documento(s) não localizado(s)`,
      })),
      ...criticos.slice(0, 4).map(({ d, i }) => ({ pessoaId: d.pessoaId, texto: `${d.nome} — ${i.titulo}` })),
    ],
    fonte: "NecessidadeDocumental (status NAO_LOCALIZADA) + motor genealógico",
  }
}

function quemTemPendencia(ctx: ContextoPerguntas): Resposta {
  const lista = dossiesDoEscopo(ctx)
    .filter((d) => d.urgencia > 0)
    .sort((a, b) => b.urgencia - a.urgencia || a.pessoaId - b.pessoaId)

  return {
    chave: "quem_tem_pendencia",
    resumo: lista.length
      ? `${lista.length} pessoa(s) com pendência, em ordem de impacto sobre a cidadania.`
      : "Nenhuma pessoa desta linha tem pendência documental, tarefa aberta ou divergência.",
    itens: lista.slice(0, 10).map((d) => ({
      pessoaId: d.pessoaId,
      texto:
        `${d.nome} — ${d.rotuloSituacao}` +
        (d.tarefasAbertas.length ? ` · ${d.tarefasAbertas.length} tarefa(s)` : "") +
        (d.divergencias.length ? ` · ${d.divergencias.length} divergência(s)` : "") +
        (d.requerentesDependentes.length > 1
          ? ` · ${d.requerentesDependentes.length} requerentes dependem dela`
          : ""),
    })),
    fonte: "NecessidadeDocumental + Tarefa do processo + motor genealógico",
  }
}

function quemTransmite(ctx: ContextoPerguntas): Resposta {
  const { grafo, mapa, linhagem, analise } = ctx
  const alvo = linhagem ?? mapa.linhagens[0] ?? null

  if (!alvo || alvo.cadeia.length <= 1) {
    return {
      chave: "quem_transmite",
      resumo:
        "Não dá para afirmar: não há cadeia de ascendentes cadastrada a partir do requerente. Cadastre pai/mãe subindo a linha.",
      itens: [],
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
    fonte: "Motor genealógico — cadeia ascendente + país de nascimento/nacionalidade",
  }
}

function oQueRetificar(ctx: ContextoPerguntas): Resposta {
  const lista = dossiesDoEscopo(ctx)

  // Retificação é hipótese, e hipótese precisa de sinal. O sinal aqui são as
  // divergências que o motor já classifica: grafia de sobrenome entre gerações,
  // conflito de data, duplicidade de ficha. A árvore NÃO decide que houve erro
  // no registro — ela aponta onde a contradição está e quem confere é o operador.
  const candidatos = lista
    .flatMap((d) =>
      d.divergencias
        .filter((i) => i.categoria === "sobrenome" || i.categoria === "conflito")
        .map((i) => ({ d, i })),
    )
    .sort((a, b) => b.i.peso - a.i.peso || a.d.pessoaId - b.d.pessoaId)

  // Dedup: o mesmo insight aparece nas duas pessoas que ele envolve.
  const vistos = new Set<string>()
  const unicos = candidatos.filter(({ i }) => {
    if (vistos.has(i.id)) return false
    vistos.add(i.id)
    return true
  })

  return {
    chave: "o_que_retificar",
    resumo: unicos.length
      ? `${unicos.length} ponto(s) onde os dados se contradizem — cada um é um candidato a retificação, a confirmar na certidão.`
      : "Nenhuma contradição de nome ou data foi encontrada nesta linha.",
    itens: unicos.slice(0, 8).map(({ d, i }) => ({
      pessoaId: d.pessoaId,
      texto: `${i.titulo}${i.acao ? ` → ${i.acao}` : ""}`,
    })),
    fonte: "Motor genealógico — regras de cronologia e de variação de sobrenome",
  }
}
