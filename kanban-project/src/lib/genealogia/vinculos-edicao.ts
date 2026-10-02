// src/lib/genealogia/vinculos-edicao.ts
// ============================================================================
// REMOVER VÍNCULO NO CANVAS — classificação da aresta, texto do efeito e os
// COMANDOS (aplicar/desfazer) de remover vínculo e de mover cartões.
//
// Módulo PURO: a chamada HTTP entra por injeção (`Http`), então tudo é testável
// sem navegador. NÃO existe escrita nova aqui: cada comando fala com as rotas
// que já passam por `aplicarMudancaNaArvore`/`propagarNaTransacao` (§37):
//
//   filiação (pai/mãe) → PUT    /api/pessoas/:filhoId   { paiId|maeId }
//   união (casal)      → DELETE /api/unioes/:id        (desfazer: POST /api/unioes)
//
// Desfazer remover vínculo = RECRIAR o mesmo vínculo pela mesma porta. Se o
// servidor recusar (4xx — ex.: pessoa já removida, vínculo duplicado), o erro
// do servidor sobe inteiro e o comando é marcado como definitivo.
// ============================================================================
import type { ComandoEdicao, ResultadoComando } from "./historico-edicao"

export interface PessoaMin {
  id: number
  nome: string
  sobrenome?: string | null
  paiId?: number | null
  maeId?: number | null
}
export interface UniaoMin {
  id: number
  pessoa1Id?: number | null
  pessoa2Id?: number | null
}

export type VinculoRemovivel =
  | { tipo: "pai" | "mae"; filhoId: number; filhoNome: string; progenitorId: number; progenitorNome: string }
  | { tipo: "uniao"; uniaoId: number; pessoa1Id: number; pessoa2Id: number; pessoa1Nome: string; pessoa2Nome: string }

export const nomeCompleto = (p: Pick<PessoaMin, "nome" | "sobrenome">) =>
  [p.nome, p.sobrenome].filter(Boolean).join(" ").trim() || "Pessoa sem nome"

const idDoNo = (no: string): number | null => {
  const m = /^person-(\d+)$/.exec(no)
  return m ? Number(m[1]) : null
}

/**
 * Traduz uma aresta do canvas no vínculo real que ela desenha. `null` = a aresta
 * não é um vínculo removível (ex.: o tracejado "+N irmãos", que é só interface).
 * As arestas de filiação vão SEMPRE do filho ao progenitor.
 */
export function classificarVinculo(
  aresta: { id: string; source: string; target: string },
  pessoas: readonly PessoaMin[],
  unioes: readonly UniaoMin[],
): VinculoRemovivel | null {
  if (aresta.id.startsWith("edge-grupo-")) return null
  const a = idDoNo(aresta.source)
  const b = idDoNo(aresta.target)
  if (a == null || b == null) return null
  const pa = pessoas.find((p) => p.id === a)
  const pb = pessoas.find((p) => p.id === b)
  if (!pa || !pb) return null

  if (aresta.id.startsWith("edge-marriage-")) {
    const uniao = unioes.find(
      (u) => (u.pessoa1Id === a && u.pessoa2Id === b) || (u.pessoa1Id === b && u.pessoa2Id === a),
    )
    if (!uniao) return null
    return {
      tipo: "uniao",
      uniaoId: uniao.id,
      pessoa1Id: a,
      pessoa2Id: b,
      pessoa1Nome: nomeCompleto(pa),
      pessoa2Nome: nomeCompleto(pb),
    }
  }

  if (pa.paiId === b) return { tipo: "pai", filhoId: a, filhoNome: nomeCompleto(pa), progenitorId: b, progenitorNome: nomeCompleto(pb) }
  if (pa.maeId === b) return { tipo: "mae", filhoId: a, filhoNome: nomeCompleto(pa), progenitorId: b, progenitorNome: nomeCompleto(pb) }
  return null
}

export interface EfeitoDoVinculo {
  titulo: string
  afetados: string[]
  efeitos: string[]
}

/** O que o operador precisa ler ANTES de confirmar: quem é afetado e o que muda na documentação. */
export function efeitoDoVinculo(v: VinculoRemovivel): EfeitoDoVinculo {
  if (v.tipo === "uniao") {
    return {
      titulo: "Remover união",
      afetados: [`${v.pessoa1Nome} e ${v.pessoa2Nome} deixam de constar como casados.`],
      efeitos: [
        "A certidão de casamento deixa de ser exigida: o documento fica como não exigido e a tarefa aberta é cancelada, com o motivo registrado.",
        "Se a certidão de casamento já estiver em atendimento ou atendida, o sistema recusa a remoção (fato acontecido não se desfaz por um clique).",
        "Nada é apagado de anexos e histórico. Se o vínculo voltar, os mesmos registros são reativados.",
      ],
    }
  }
  const papel = v.tipo === "pai" ? "pai" : "mãe"
  return {
    titulo: `Remover vínculo com ${papel}`,
    afetados: [`${v.progenitorNome} deixa de ser ${papel} de ${v.filhoNome}.`],
    efeitos: [
      "A árvore é recalculada na mesma operação: certidões, necessidades e tarefas que dependiam desse parentesco deixam de ser exigidas (nada é apagado; anexos e histórico ficam).",
      "A linha reta e o número de linhagem são recalculados.",
      "Se o vínculo voltar, os mesmos registros são reativados.",
    ],
  }
}

// ── HTTP injetável ─────────────────────────────────────────────────────────
export type Http = (
  metodo: "GET" | "PUT" | "POST" | "DELETE",
  url: string,
  corpo?: unknown,
) => Promise<{ ok: boolean; status: number; corpo: unknown }>

const mensagemDe = (corpo: unknown, padrao: string): string => {
  const e = (corpo as { error?: unknown } | null | undefined)?.error
  return typeof e === "string" && e.trim() ? e : padrao
}

/** 4xx = o servidor recusou de propósito (não adianta repetir); rede/5xx = pode tentar de novo. */
const ehDefinitivo = (status: number) => status >= 400 && status < 500 && status !== 408 && status !== 429

async function chamar(
  http: Http,
  metodo: "GET" | "PUT" | "POST" | "DELETE",
  url: string,
  corpo: unknown,
  padrao: string,
): Promise<{ r: ResultadoComando; corpo: unknown }> {
  try {
    const resp = await http(metodo, url, corpo)
    if (resp.ok) return { r: { ok: true }, corpo: resp.corpo }
    return { r: { ok: false, erro: mensagemDe(resp.corpo, padrao), definitivo: ehDefinitivo(resp.status) }, corpo: resp.corpo }
  } catch {
    return { r: { ok: false, erro: "Falha de conexão com o servidor. Tente novamente." }, corpo: null }
  }
}

/** Remover pai/mãe: o inverso grava de volta o MESMO progenitor, pela mesma rota. */
export function comandoRemoverFiliacao(v: Extract<VinculoRemovivel, { tipo: "pai" | "mae" }>, http: Http): ComandoEdicao {
  const campo = v.tipo === "pai" ? "paiId" : "maeId"
  const url = `/api/pessoas/${v.filhoId}`
  const papel = v.tipo === "pai" ? "pai" : "mãe"
  return {
    rotulo: `vínculo de ${v.filhoNome} com ${papel} ${v.progenitorNome}`,
    aplicar: async () => (await chamar(http, "PUT", url, { [campo]: null }, "Não foi possível remover o vínculo.")).r,
    desfazer: async () =>
      (await chamar(http, "PUT", url, { [campo]: v.progenitorId }, `Não foi possível restaurar o vínculo com ${papel}.`)).r,
  }
}

const CAMPOS_UNIAO = [
  "data_inicio", "data_fim", "tipo", "local", "estado", "pais", "cartorio", "livro", "folha", "termo",
  "numero_registro", "data_registro", "observacoes",
] as const

/**
 * Remover união. Antes de apagar, LÊ a união inteira (GET) — o desfazer precisa
 * recriá-la com os mesmos dados (cartório, livro, folha…), não vazia. Sem esse
 * retrato o comando não é criado e nada é apagado.
 */
export async function comandoRemoverUniao(
  v: Extract<VinculoRemovivel, { tipo: "uniao" }>,
  http: Http,
): Promise<{ ok: true; comando: ComandoEdicao } | { ok: false; erro: string }> {
  const lida = await chamar(http, "GET", `/api/unioes/${v.uniaoId}`, undefined, "Não foi possível ler a união antes de removê-la.")
  if (!lida.r.ok) return { ok: false, erro: lida.r.erro }
  const retrato = (lida.corpo ?? {}) as Record<string, unknown>
  const corpoRecriar: Record<string, unknown> = { pessoa1Id: v.pessoa1Id, pessoa2Id: v.pessoa2Id }
  for (const c of CAMPOS_UNIAO) if (retrato[c] !== undefined) corpoRecriar[c] = retrato[c]

  // A união recriada tem OUTRO id: o comando guarda o id vivo.
  let idVivo = v.uniaoId
  return {
    ok: true,
    comando: {
      rotulo: `união de ${v.pessoa1Nome} e ${v.pessoa2Nome}`,
      aplicar: async () => (await chamar(http, "DELETE", `/api/unioes/${idVivo}`, undefined, "Não foi possível remover a união.")).r,
      desfazer: async () => {
        const c = await chamar(http, "POST", "/api/unioes", corpoRecriar, "Não foi possível restaurar a união.")
        if (!c.r.ok) return c.r
        const novoId = (c.corpo as { id?: unknown } | null)?.id
        if (typeof novoId !== "number") {
          return { ok: false, erro: "A união foi restaurada, mas o servidor não devolveu o identificador dela.", definitivo: true }
        }
        idVivo = novoId
        return { ok: true }
      },
    },
  }
}

// ── VINCULAR CÔNJUGES ──────────────────────────────────────────────────────
export interface DadosDoVinculoConjugal {
  pessoa1Id: number
  pessoa2Id: number
  pessoa1Nome: string
  pessoa2Nome: string
  /** ISO (data do casamento) ou null. */
  dataCasamento: string | null
  /** Local do casamento ou null. */
  localCasamento: string | null
}

/**
 * Vincular dois cônjuges que já existem na árvore (casal sem filho cadastrado).
 * Aplicar = `POST /api/unioes` com `marcarCasados` (a união E o estado civil das
 * duas pessoas, mais a reavaliação documental, na MESMA transação — §37) e
 * `idempotente` (repetir não cria nem dá erro). Desfazer = remover a união pela
 * rota oficial e devolver a cada pessoa o estado civil que tinha ANTES (o servidor
 * informa em `casadoAntes`) — sem deixar "casada sem cônjuge" para trás.
 */
export function comandoVincularConjuges(d: DadosDoVinculoConjugal, http: Http): ComandoEdicao {
  let idVivo: number | null = null
  let casadoAntes: { pessoa1: boolean; pessoa2: boolean } | null = null
  return {
    rotulo: `casamento de ${d.pessoa1Nome} e ${d.pessoa2Nome}`,
    aplicar: async () => {
      const c = await chamar(
        http,
        "POST",
        "/api/unioes",
        {
          pessoa1Id: d.pessoa1Id,
          pessoa2Id: d.pessoa2Id,
          tipo: "casamento",
          data_inicio: d.dataCasamento,
          local: d.localCasamento,
          marcarCasados: true,
          idempotente: true,
        },
        "Não foi possível vincular os cônjuges.",
      )
      if (!c.r.ok) return c.r
      const corpo = (c.corpo ?? {}) as { id?: unknown; jaExistia?: unknown; casadoAntes?: { pessoa1?: unknown; pessoa2?: unknown } }
      if (typeof corpo.id !== "number") {
        return { ok: false, erro: "A união foi gravada, mas o servidor não devolveu o identificador dela.", definitivo: true }
      }
      idVivo = corpo.id
      // Já existia: nada foi criado por este comando, então nada será desfeito por ele.
      casadoAntes = corpo.jaExistia === true || !corpo.casadoAntes
        ? null
        : { pessoa1: corpo.casadoAntes.pessoa1 === true, pessoa2: corpo.casadoAntes.pessoa2 === true }
      if (corpo.jaExistia === true) idVivo = null
      return { ok: true }
    },
    desfazer: async () => {
      if (idVivo == null) return { ok: true }
      const del = await chamar(http, "DELETE", `/api/unioes/${idVivo}`, undefined, "Não foi possível desfazer o vínculo conjugal.")
      if (!del.r.ok) return del.r
      idVivo = null
      const restaurar: Array<[number, boolean]> = []
      if (casadoAntes && !casadoAntes.pessoa1) restaurar.push([d.pessoa1Id, false])
      if (casadoAntes && !casadoAntes.pessoa2) restaurar.push([d.pessoa2Id, false])
      for (const [id, casado] of restaurar) {
        const r = await chamar(http, "PUT", `/api/pessoas/${id}`, { casado }, "A união foi removida, mas não foi possível restaurar o estado civil.")
        if (!r.r.ok) return r.r
      }
      return { ok: true }
    },
  }
}

// ── MOVER CARTÕES ──────────────────────────────────────────────────────────
export interface Posicao { x: number; y: number }
export interface MovimentoNo { pessoaId: number; antes: Posicao; depois: Posicao }

/**
 * Mover cartão: a posição é só layout (persistida por árvore, por modo, em
 * `Arvore.posicoesNodes`). Não toca em pessoa, vínculo nem documento — por isso
 * o inverso é gravar a posição anterior. `aplicarPosicoes` é a porta do canvas.
 */
export function comandoMoverNos(
  modo: string,
  movimentos: readonly MovimentoNo[],
  aplicarPosicoes: (modo: string, posicoes: Record<string, Posicao>) => void,
): ComandoEdicao {
  const mapa = (campo: "antes" | "depois") => {
    const m: Record<string, Posicao> = {}
    for (const mv of movimentos) m[String(mv.pessoaId)] = { ...mv[campo] }
    return m
  }
  const executar = (campo: "antes" | "depois"): ResultadoComando => {
    try {
      aplicarPosicoes(modo, mapa(campo))
      return { ok: true }
    } catch {
      return { ok: false, erro: "Não foi possível reposicionar o cartão." }
    }
  }
  return {
    rotulo: movimentos.length === 1 ? "movimento de cartão" : `movimento de ${movimentos.length} cartões`,
    afetaDados: false,
    aplicar: async () => executar("depois"),
    desfazer: async () => executar("antes"),
  }
}

/** Deslocamento zero não é ação: não entra na pilha. */
export function houveMovimento(movimentos: readonly MovimentoNo[]): MovimentoNo[] {
  return movimentos.filter((m) => Math.abs(m.antes.x - m.depois.x) > 0.5 || Math.abs(m.antes.y - m.depois.y) > 0.5)
}
