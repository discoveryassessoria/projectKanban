// src/lib/genealogia/motor/eventos.ts
//
// EVENTOS DE VIDA — PROJEÇÃO, não entidade.
//
// O Discovery não tem modelo de evento genealógico. `model Evento` existe, mas
// é a AGENDA do processo (título, responsável, lembrete) — outro domínio. Os
// eventos de vida vivem hoje como colunas canônicas em `Pessoa` (nascimento,
// batismo, óbito, emigração, chegada, naturalização) e em `Uniao` (casamento,
// fim da união).
//
// Este módulo LÊ essas colunas e devolve uma lista ordenada. Ele não persiste,
// não cria tabela, não inventa dado e não é fonte de verdade: apagar este
// arquivo não perde informação nenhuma. É exatamente o que a Constituição pede
// — timeline como projeção do canônico, sem entidade paralela.

import type { GrafoGenealogico } from "./grafo"
import type { PessoaEntrada, UniaoEntrada } from "./tipos"
import { anoDe, nomeCompleto, tsDe } from "./texto"

export type TipoEvento =
  | "nascimento"
  | "batismo"
  | "casamento"
  | "fim_uniao"
  | "emigracao"
  | "chegada"
  | "naturalizacao"
  | "residencia"
  | "obito"

export const ROTULO_EVENTO: Record<TipoEvento, string> = {
  nascimento: "Nascimento",
  batismo: "Batismo",
  casamento: "Casamento",
  fim_uniao: "Fim da união",
  emigracao: "Emigração",
  chegada: "Chegada",
  naturalizacao: "Naturalização",
  residencia: "Residência",
  obito: "Falecimento",
}

/**
 * Precisão do que se sabe sobre a data.
 *  - `exata`     : há data no cadastro.
 *  - `ausente`   : o evento é sabido (a pessoa faleceu, o casal casou) mas a
 *                  data não foi localizada. É pendência de pesquisa, não vazio.
 *  - `conflito`  : a data existe mas contradiz outra data da própria árvore.
 */
export type PrecisaoEvento = "exata" | "ausente" | "conflito"

export interface EventoProjetado {
  /** Determinístico: mesma origem sempre gera o mesmo id (nada é persistido). */
  id: string
  tipo: TipoEvento
  /** Pessoa a quem o evento pertence. */
  pessoaId: number
  /** Segunda pessoa, quando o evento é de casal. */
  parceiroId?: number | null
  uniaoId?: number | null
  data: string | Date | null
  ano: number | null
  /** Ordenação estável: eventos sem data vão para o fim do ano conhecido. */
  ordenacao: number | null
  local: string | null
  precisao: PrecisaoEvento
  /** Campo canônico de origem — a UI mostra "de onde veio" sem inventar. */
  origem: string
  detalhe?: string | null
}

function juntar(...partes: Array<string | null | undefined>): string | null {
  const v = partes.map((p) => (p ?? "").trim()).filter(Boolean)
  return v.length ? v.join(", ") : null
}

function montar(
  base: Omit<EventoProjetado, "ano" | "ordenacao" | "precisao"> & { precisao?: PrecisaoEvento },
): EventoProjetado {
  const ano = anoDe(base.data)
  return {
    ...base,
    ano,
    ordenacao: tsDe(base.data),
    precisao: base.precisao ?? (base.data ? "exata" : "ausente"),
  }
}

/** Eventos de uma pessoa, incluindo os das uniões dela. */
export function eventosDaPessoa(g: GrafoGenealogico, pessoaId: number): EventoProjetado[] {
  const p = g.pessoa(pessoaId)
  if (!p) return []
  const eventos: EventoProjetado[] = []

  // ---- nascimento ----
  const localNasc = juntar(p.local_nasc, p.estado_nasc, p.pais_nasc)
  if (p.data_nasc || localNasc) {
    eventos.push(
      montar({
        id: `ev-nasc-${p.id}`,
        tipo: "nascimento",
        pessoaId: p.id,
        data: p.data_nasc ?? null,
        local: localNasc,
        origem: "Pessoa.data_nasc",
      }),
    )
  }

  // ---- batismo ----
  if (p.data_batismo || p.local_batismo || p.igreja_batismo) {
    eventos.push(
      montar({
        id: `ev-bat-${p.id}`,
        tipo: "batismo",
        pessoaId: p.id,
        data: p.data_batismo ?? null,
        local: juntar(p.igreja_batismo, p.local_batismo),
        origem: "Pessoa.data_batismo",
      }),
    )
  }

  // ---- migração ----
  if (p.data_emigracao || p.porto_embarque) {
    eventos.push(
      montar({
        id: `ev-emig-${p.id}`,
        tipo: "emigracao",
        pessoaId: p.id,
        data: p.data_emigracao ?? null,
        local: juntar(p.porto_embarque),
        origem: "Pessoa.data_emigracao",
      }),
    )
  }
  if (p.data_chegada || p.porto_chegada || p.navio) {
    eventos.push(
      montar({
        id: `ev-cheg-${p.id}`,
        tipo: "chegada",
        pessoaId: p.id,
        data: p.data_chegada ?? null,
        local: juntar(p.porto_chegada, p.pais_destino),
        origem: "Pessoa.data_chegada",
        detalhe: p.navio ? `Navio ${p.navio}` : null,
      }),
    )
  }
  if (p.data_naturalizacao || p.naturalizado) {
    eventos.push(
      montar({
        id: `ev-natz-${p.id}`,
        tipo: "naturalizacao",
        pessoaId: p.id,
        data: p.data_naturalizacao ?? null,
        local: juntar(p.pais_naturalizacao),
        origem: "Pessoa.data_naturalizacao",
      }),
    )
  }

  // ---- uniões (evento do casal, aparece nos dois) ----
  for (const u of g.unioesDe(p.id)) {
    const outroId = u.pessoa1Id === p.id ? u.pessoa2Id : u.pessoa1Id
    const local = juntar(u.local, u.pais)
    eventos.push(
      montar({
        id: `ev-cas-${u.id}-${p.id}`,
        tipo: "casamento",
        pessoaId: p.id,
        parceiroId: outroId ?? null,
        uniaoId: u.id,
        data: u.data_inicio ?? null,
        local,
        origem: "Uniao.data_inicio",
        detalhe: u.cartorio ? `Cartório ${u.cartorio}` : null,
      }),
    )
    if (u.data_fim) {
      eventos.push(
        montar({
          id: `ev-fim-${u.id}-${p.id}`,
          tipo: "fim_uniao",
          pessoaId: p.id,
          parceiroId: outroId ?? null,
          uniaoId: u.id,
          data: u.data_fim,
          local,
          origem: "Uniao.data_fim",
        }),
      )
    }
  }

  // ---- óbito ----
  // GOTCHA do modelo atual: o formulário grava o LOCAL do falecimento em
  // `local_emigracao` (o schema não tem `local_obito`). Lemos os dois para não
  // perder o dado, sem "corrigir" nada em disco.
  const falecida = p.vivo === false || !!p.data_obito
  if (falecida) {
    const localObito = juntar(
      (p as { local_obito?: string | null }).local_obito ?? null,
      p.data_emigracao ? null : p.local_emigracao,
    )
    eventos.push(
      montar({
        id: `ev-obito-${p.id}`,
        tipo: "obito",
        pessoaId: p.id,
        data: p.data_obito ?? null,
        local: localObito,
        origem: "Pessoa.data_obito",
      }),
    )
  }

  return ordenar(eventos)
}

/** Eventos de várias pessoas (ramo, núcleo, caminho até o requerente). */
export function eventosDeVarios(g: GrafoGenealogico, pessoaIds: Iterable<number>): EventoProjetado[] {
  const vistos = new Set<string>()
  const todos: EventoProjetado[] = []
  for (const id of pessoaIds) {
    for (const e of eventosDaPessoa(g, id)) {
      // Evento de casal aparece nas duas pessoas: mantemos um por união+tipo.
      const chave = e.uniaoId != null ? `${e.tipo}:${e.uniaoId}` : e.id
      if (vistos.has(chave)) continue
      vistos.add(chave)
      todos.push(e)
    }
  }
  return ordenar(todos)
}

function ordenar(eventos: EventoProjetado[]): EventoProjetado[] {
  return [...eventos].sort((a, b) => {
    if (a.ordenacao != null && b.ordenacao != null) return a.ordenacao - b.ordenacao
    if (a.ordenacao != null) return -1
    if (b.ordenacao != null) return 1
    return a.id.localeCompare(b.id)
  })
}

/**
 * Marca como `conflito` os eventos cujas datas se contradizem dentro da própria
 * projeção. Não corrige nada — só sinaliza, para a timeline mostrar em vermelho
 * o que o motor de qualidade já explica por extenso.
 */
export function marcarConflitos(
  eventos: EventoProjetado[],
  idsComConflito: Set<number>,
): EventoProjetado[] {
  return eventos.map((e) => {
    if (e.precisao !== "exata") return e
    if (!idsComConflito.has(e.pessoaId)) return e
    return { ...e, precisao: "conflito" as const }
  })
}

export interface FiltroEventos {
  tipos?: Set<TipoEvento> | null
  pessoaIds?: Set<number> | null
  anoDe?: number | null
  anoAte?: number | null
  /** Quando false, esconde eventos cuja data não foi localizada. */
  incluirSemData?: boolean
}

export function filtrarEventos(eventos: EventoProjetado[], f: FiltroEventos): EventoProjetado[] {
  return eventos.filter((e) => {
    if (f.tipos && f.tipos.size > 0 && !f.tipos.has(e.tipo)) return false
    if (f.pessoaIds && f.pessoaIds.size > 0 && !f.pessoaIds.has(e.pessoaId)) return false
    if (e.ano == null) return f.incluirSemData !== false
    if (f.anoDe != null && e.ano < f.anoDe) return false
    if (f.anoAte != null && e.ano > f.anoAte) return false
    return true
  })
}

/**
 * Lacunas cronológicas: intervalos longos sem nenhum evento registrado na
 * linha analisada. É onde a pesquisa provavelmente precisa entrar.
 */
export interface LacunaCronologica {
  de: number
  ate: number
  anos: number
}

export function detectarLacunas(eventos: EventoProjetado[], minimoAnos = 25): LacunaCronologica[] {
  const anos = eventos
    .map((e) => e.ano)
    .filter((a): a is number => a != null)
    .sort((a, b) => a - b)
  const lacunas: LacunaCronologica[] = []
  for (let i = 1; i < anos.length; i++) {
    const salto = anos[i] - anos[i - 1]
    if (salto >= minimoAnos) lacunas.push({ de: anos[i - 1], ate: anos[i], anos: salto })
  }
  return lacunas
}

/** Resumo textual de um evento, para leitor de tela e tooltip. */
export function descreverEvento(g: GrafoGenealogico, e: EventoProjetado): string {
  const quem = g.pessoa(e.pessoaId)
  const nome = quem ? nomeCompleto(quem) : `#${e.pessoaId}`
  const parceiro = e.parceiroId != null ? g.pessoa(e.parceiroId) : null
  const partes: string[] = [ROTULO_EVENTO[e.tipo]]
  if (parceiro) partes.push(`de ${nome} e ${nomeCompleto(parceiro)}`)
  else partes.push(`de ${nome}`)
  if (e.ano) partes.push(`em ${e.ano}`)
  else partes.push("— data não localizada")
  if (e.local) partes.push(`· ${e.local}`)
  return partes.join(" ")
}
