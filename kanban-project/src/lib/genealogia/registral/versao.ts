// src/lib/genealogia/registral/versao.ts
//
// MRG — SNAPSHOT LÓGICO, HASH e COMPARAÇÃO DE VERSÕES (requisito 15). Puro.
//
// O snapshot é a base da reversão segura e da comparação entre versões. Ele é
// DETERMINÍSTICO: a mesma árvore produz sempre o mesmo JSON e o mesmo hash —
// ordenação fixa, nenhuma data de geração dentro do conteúdo, nenhuma
// propriedade em ordem de inserção.
//
// O snapshot é LÓGICO, não físico: guarda identidade, vínculos e fatos ativos.
// Não guarda arquivo, não guarda documento — só a referência.

import { hashSnapshot } from "./chaves"
import type { PessoaEntrada, UniaoEntrada } from "@/src/lib/genealogia/motor/tipos"
import type { CampoRegistral, EstadoFatoRegistral } from "./tipos"

export interface PessoaSnapshot {
  id: number
  nome: string
  sobrenome: string | null
  sexo: string | null
  dataNasc: string | null
  dataObito: string | null
  localNasc: string | null
  paisNasc: string | null
  paiId: number | null
  maeId: number | null
  requerente: string | null
  linhaReta: boolean
}

export interface UniaoSnapshot {
  id: number
  pessoa1Id: number
  pessoa2Id: number
  dataInicio: string | null
  tipo: string | null
}

export interface FatoSnapshot {
  pessoaId: number | null
  uniaoId: number | null
  campo: CampoRegistral
  valorNormalizado: string | null
  estado: EstadoFatoRegistral
  confianca: string
  versao: number
}

export interface AliasSnapshot {
  pessoaId: number
  nome: string
  sobrenome: string | null
  tipo: string
  principal: boolean
}

export interface SnapshotGenealogico {
  /** Versão do formato do snapshot — muda quando o conteúdo muda de forma. */
  formato: 1
  arvoreId: number
  pessoas: PessoaSnapshot[]
  unioes: UniaoSnapshot[]
  fatos: FatoSnapshot[]
  aliases: AliasSnapshot[]
  /** Linha de cidadania apurada no momento do snapshot. */
  linha: number[]
  ascendenteTransmissorId: number | null
  resultadoLinhagem: string | null
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null
  const s = typeof v === "string" ? v : v.toISOString()
  return s.slice(0, 10)
}

export function montarSnapshot(p: {
  arvoreId: number
  pessoas: PessoaEntrada[]
  unioes: UniaoEntrada[]
  fatos: FatoSnapshot[]
  aliases: AliasSnapshot[]
  linha: number[]
  ascendenteTransmissorId: number | null
  resultadoLinhagem: string | null
}): SnapshotGenealogico {
  return {
    formato: 1,
    arvoreId: p.arvoreId,
    pessoas: p.pessoas
      .map((x) => ({
        id: x.id,
        nome: x.nome,
        sobrenome: x.sobrenome ?? null,
        sexo: x.sexo ?? null,
        dataNasc: iso(x.data_nasc),
        dataObito: iso(x.data_obito),
        localNasc: x.local_nasc ?? null,
        paisNasc: x.pais_nasc ?? null,
        paiId: x.paiId ?? null,
        maeId: x.maeId ?? null,
        requerente: x.requerente ?? null,
        linhaReta: x.linhaReta !== false,
      }))
      .sort((a, b) => a.id - b.id),
    unioes: p.unioes
      .filter((u) => u.pessoa1Id != null && u.pessoa2Id != null)
      .map((u) => ({
        id: u.id,
        pessoa1Id: u.pessoa1Id as number,
        pessoa2Id: u.pessoa2Id as number,
        dataInicio: iso(u.data_inicio),
        tipo: u.tipo ?? null,
      }))
      .sort((a, b) => a.id - b.id),
    fatos: [...p.fatos].sort(
      (a, b) =>
        (a.pessoaId ?? 0) - (b.pessoaId ?? 0) ||
        (a.uniaoId ?? 0) - (b.uniaoId ?? 0) ||
        a.campo.localeCompare(b.campo) ||
        a.versao - b.versao,
    ),
    aliases: [...p.aliases].sort(
      (a, b) => a.pessoaId - b.pessoaId || a.tipo.localeCompare(b.tipo) || a.nome.localeCompare(b.nome),
    ),
    linha: [...p.linha],
    ascendenteTransmissorId: p.ascendenteTransmissorId,
    resultadoLinhagem: p.resultadoLinhagem,
  }
}

/**
 * Serialização canônica: chaves em ordem alfabética em todos os níveis. Sem
 * isso, dois snapshots idênticos teriam hashes diferentes só pela ordem em que
 * o Prisma devolveu as colunas.
 */
export function serializarCanonico(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(serializarCanonico).join(",")}]`
  const obj = v as Record<string, unknown>
  const chaves = Object.keys(obj).sort()
  return `{${chaves.map((k) => `${JSON.stringify(k)}:${serializarCanonico(obj[k])}`).join(",")}}`
}

export function hashDoSnapshot(s: SnapshotGenealogico): string {
  return hashSnapshot(serializarCanonico(s))
}

// ---------------------------------------------------------------- comparação

export type TipoMudanca = "ADICIONADO" | "REMOVIDO" | "ALTERADO"

export interface MudancaVersao {
  entidade: "PESSOA" | "UNIAO" | "FATO" | "ALIAS" | "LINHA"
  tipo: TipoMudanca
  id: number | string
  campo: string | null
  de: string | null
  para: string | null
  descricao: string
}

export interface ComparacaoVersoes {
  iguais: boolean
  mudancas: MudancaVersao[]
  resumo: string
}

/** Comparação entre duas versões — é o que a tela de auditoria e a reversão leem. */
export function compararSnapshots(
  a: SnapshotGenealogico,
  b: SnapshotGenealogico,
): ComparacaoVersoes {
  const mudancas: MudancaVersao[] = []

  // pessoas
  const pa = new Map(a.pessoas.map((p) => [p.id, p]))
  const pb = new Map(b.pessoas.map((p) => [p.id, p]))
  for (const [id, atual] of pb) {
    const antigo = pa.get(id)
    if (!antigo) {
      mudancas.push({
        entidade: "PESSOA",
        tipo: "ADICIONADO",
        id,
        campo: null,
        de: null,
        para: nomeDe(atual),
        descricao: `Pessoa adicionada: ${nomeDe(atual)}`,
      })
      continue
    }
    for (const campo of [
      "nome",
      "sobrenome",
      "sexo",
      "dataNasc",
      "dataObito",
      "localNasc",
      "paisNasc",
      "paiId",
      "maeId",
      "requerente",
      "linhaReta",
    ] as Array<keyof PessoaSnapshot>) {
      const de = antigo[campo]
      const para = atual[campo]
      if (String(de ?? "") === String(para ?? "")) continue
      mudancas.push({
        entidade: "PESSOA",
        tipo: "ALTERADO",
        id,
        campo: String(campo),
        de: de == null ? null : String(de),
        para: para == null ? null : String(para),
        descricao: `${nomeDe(atual)}: ${String(campo)} de “${de ?? "vazio"}” para “${para ?? "vazio"}”`,
      })
    }
  }
  for (const [id, antigo] of pa) {
    if (pb.has(id)) continue
    mudancas.push({
      entidade: "PESSOA",
      tipo: "REMOVIDO",
      id,
      campo: null,
      de: nomeDe(antigo),
      para: null,
      descricao: `Pessoa removida do snapshot: ${nomeDe(antigo)}`,
    })
  }

  // uniões
  const ua = new Map(a.unioes.map((u) => [u.id, u]))
  const ub = new Map(b.unioes.map((u) => [u.id, u]))
  for (const [id, atual] of ub) {
    const antigo = ua.get(id)
    if (!antigo) {
      mudancas.push({
        entidade: "UNIAO",
        tipo: "ADICIONADO",
        id,
        campo: null,
        de: null,
        para: `${atual.pessoa1Id}+${atual.pessoa2Id}`,
        descricao: `União adicionada entre ${atual.pessoa1Id} e ${atual.pessoa2Id}`,
      })
    } else if (antigo.dataInicio !== atual.dataInicio || antigo.tipo !== atual.tipo) {
      mudancas.push({
        entidade: "UNIAO",
        tipo: "ALTERADO",
        id,
        campo: "dataInicio/tipo",
        de: `${antigo.dataInicio ?? "-"}/${antigo.tipo ?? "-"}`,
        para: `${atual.dataInicio ?? "-"}/${atual.tipo ?? "-"}`,
        descricao: `União ${id} alterada`,
      })
    }
  }
  for (const [id, antigo] of ua) {
    if (ub.has(id)) continue
    mudancas.push({
      entidade: "UNIAO",
      tipo: "REMOVIDO",
      id,
      campo: null,
      de: `${antigo.pessoa1Id}+${antigo.pessoa2Id}`,
      para: null,
      descricao: `União removida entre ${antigo.pessoa1Id} e ${antigo.pessoa2Id}`,
    })
  }

  // fatos
  const chaveFatoSnap = (f: FatoSnapshot) => `${f.pessoaId ?? "u" + f.uniaoId}|${f.campo}`
  const fa = new Map(a.fatos.map((f) => [chaveFatoSnap(f), f]))
  const fb = new Map(b.fatos.map((f) => [chaveFatoSnap(f), f]))
  for (const [k, atual] of fb) {
    const antigo = fa.get(k)
    if (!antigo) {
      mudancas.push({
        entidade: "FATO",
        tipo: "ADICIONADO",
        id: k,
        campo: atual.campo,
        de: null,
        para: atual.valorNormalizado,
        descricao: `Fato registral novo: ${atual.campo} = “${atual.valorNormalizado ?? "vazio"}” (${atual.estado})`,
      })
    } else if (
      antigo.valorNormalizado !== atual.valorNormalizado ||
      antigo.estado !== atual.estado ||
      antigo.versao !== atual.versao
    ) {
      mudancas.push({
        entidade: "FATO",
        tipo: "ALTERADO",
        id: k,
        campo: atual.campo,
        de: `${antigo.valorNormalizado ?? "vazio"} (${antigo.estado} v${antigo.versao})`,
        para: `${atual.valorNormalizado ?? "vazio"} (${atual.estado} v${atual.versao})`,
        descricao: `Fato ${atual.campo} alterado`,
      })
    }
  }
  for (const [k, antigo] of fa) {
    if (fb.has(k)) continue
    mudancas.push({
      entidade: "FATO",
      tipo: "REMOVIDO",
      id: k,
      campo: antigo.campo,
      de: antigo.valorNormalizado,
      para: null,
      descricao: `Fato registral deixou de estar ativo: ${antigo.campo}`,
    })
  }

  // aliases
  const chaveAlias = (x: AliasSnapshot) => `${x.pessoaId}|${x.tipo}|${x.nome}|${x.sobrenome ?? ""}`
  const aa = new Set(a.aliases.map(chaveAlias))
  for (const al of b.aliases) {
    if (aa.has(chaveAlias(al))) continue
    mudancas.push({
      entidade: "ALIAS",
      tipo: "ADICIONADO",
      id: al.pessoaId,
      campo: al.tipo,
      de: null,
      para: [al.nome, al.sobrenome].filter(Boolean).join(" "),
      descricao: `Forma de nome adicionada para ${al.pessoaId}: ${[al.nome, al.sobrenome].filter(Boolean).join(" ")} (${al.tipo})`,
    })
  }

  // linha
  if (a.linha.join(">") !== b.linha.join(">")) {
    mudancas.push({
      entidade: "LINHA",
      tipo: "ALTERADO",
      id: "linha",
      campo: "caminho",
      de: a.linha.join(" → ") || "vazio",
      para: b.linha.join(" → ") || "vazio",
      descricao: "A linha de cidadania mudou",
    })
  }
  if (a.ascendenteTransmissorId !== b.ascendenteTransmissorId) {
    mudancas.push({
      entidade: "LINHA",
      tipo: "ALTERADO",
      id: "transmissor",
      campo: "ascendenteTransmissorId",
      de: a.ascendenteTransmissorId == null ? null : String(a.ascendenteTransmissorId),
      para: b.ascendenteTransmissorId == null ? null : String(b.ascendenteTransmissorId),
      descricao: "O ascendente transmissor mudou",
    })
  }

  return {
    iguais: mudancas.length === 0,
    mudancas,
    resumo: mudancas.length
      ? `${mudancas.length} mudança(s): ${contar(mudancas)}`
      : "nenhuma diferença entre as versões",
  }
}

function contar(m: MudancaVersao[]): string {
  const porEntidade = new Map<string, number>()
  for (const x of m) porEntidade.set(x.entidade, (porEntidade.get(x.entidade) ?? 0) + 1)
  return [...porEntidade.entries()].map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ")
}

/**
 * Plano de REVERSÃO: o que precisa voltar para o snapshot anterior valer de novo.
 * Devolve operações declarativas — quem aplica é o serviço transacional.
 */
export interface OperacaoReversao {
  entidade: "PESSOA" | "UNIAO" | "FATO" | "ALIAS"
  acao: "RESTAURAR_CAMPO" | "DESATIVAR_FATO" | "REATIVAR_FATO" | "DESATIVAR_ALIAS" | "REMOVER_UNIAO" | "RESTAURAR_UNIAO"
  id: number | string
  campo: string | null
  valor: string | null
  descricao: string
}

export function planejarReversao(
  atual: SnapshotGenealogico,
  alvo: SnapshotGenealogico,
): { operacoes: OperacaoReversao[]; impossivel: string[] } {
  const operacoes: OperacaoReversao[] = []
  const impossivel: string[] = []

  const comparacao = compararSnapshots(alvo, atual) // alvo -> atual = o que foi feito
  for (const m of comparacao.mudancas) {
    if (m.entidade === "PESSOA" && m.tipo === "ALTERADO" && m.campo) {
      operacoes.push({
        entidade: "PESSOA",
        acao: "RESTAURAR_CAMPO",
        id: m.id,
        campo: m.campo,
        valor: m.de,
        descricao: `Restaurar ${m.campo} da pessoa ${m.id} para “${m.de ?? "vazio"}”`,
      })
    } else if (m.entidade === "PESSOA" && m.tipo === "ADICIONADO") {
      // Reverter criação de pessoa NÃO apaga a pessoa (nenhuma exclusão
      // automática de pessoa, por princípio). Vira pendência humana.
      impossivel.push(
        `A pessoa ${m.id} foi criada depois da versão alvo. Exclusão automática de pessoa é proibida: desvincule manualmente se for o caso.`,
      )
    } else if (m.entidade === "PESSOA" && m.tipo === "REMOVIDO") {
      impossivel.push(
        `A pessoa ${m.id} existia na versão alvo e não existe mais. Recriar identidade humana automaticamente é proibido.`,
      )
    } else if (m.entidade === "UNIAO" && m.tipo === "ADICIONADO") {
      operacoes.push({
        entidade: "UNIAO",
        acao: "REMOVER_UNIAO",
        id: m.id,
        campo: null,
        valor: null,
        descricao: `Remover a união ${m.id}, criada após a versão alvo`,
      })
    } else if (m.entidade === "UNIAO" && m.tipo === "REMOVIDO") {
      operacoes.push({
        entidade: "UNIAO",
        acao: "RESTAURAR_UNIAO",
        id: m.id,
        campo: null,
        valor: m.de,
        descricao: `Restaurar a união ${m.id} (${m.de})`,
      })
    } else if (m.entidade === "FATO" && m.tipo === "ADICIONADO") {
      operacoes.push({
        entidade: "FATO",
        acao: "DESATIVAR_FATO",
        id: m.id,
        campo: m.campo,
        valor: null,
        descricao: `Desativar o fato ${m.campo} criado após a versão alvo (histórico preservado)`,
      })
    } else if (m.entidade === "FATO" && (m.tipo === "ALTERADO" || m.tipo === "REMOVIDO")) {
      operacoes.push({
        entidade: "FATO",
        acao: "REATIVAR_FATO",
        id: m.id,
        campo: m.campo,
        valor: m.de,
        descricao: `Reativar a versão anterior do fato ${m.campo} (“${m.de ?? "vazio"}”)`,
      })
    } else if (m.entidade === "ALIAS" && m.tipo === "ADICIONADO") {
      operacoes.push({
        entidade: "ALIAS",
        acao: "DESATIVAR_ALIAS",
        id: m.id,
        campo: m.campo,
        valor: m.para,
        descricao: `Desativar a forma de nome “${m.para}” adicionada após a versão alvo`,
      })
    }
  }

  return { operacoes, impossivel }
}

function nomeDe(p: PessoaSnapshot): string {
  return [p.nome, p.sobrenome].filter(Boolean).join(" ")
}
