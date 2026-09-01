// src/lib/relatorios/motor/executar.ts
//
// O MOTOR. Recebe uma pergunta declarada e devolve o resultado.
//
// ─── A REGRA DE CONSISTÊNCIA ────────────────────────────────────────────────
// Para os MESMOS filtros: o total exibido, o número de linhas de detalhe e o
// número de linhas exportadas têm de ser o mesmo número. Por isso o `total` sai
// de um COUNT sobre o mesmo `where` da listagem — nunca de `linhas.length`, que
// mente na primeira página que existir.
//
// ─── NADA FORA DA LISTA ─────────────────────────────────────────────────────
// Filtro, coluna, agrupamento e ordenação que o domínio não declarou são
// IGNORADOS, não interpretados. Um relatório não é uma porta de SQL: se a
// tradução coubesse ao cliente, bastaria uma chave a mais no JSON para ler o
// banco inteiro.

import { rotuloDeData } from "./datas"
import type { DominioDef, QuerySpec, ValorDeFiltro } from "./tipos"

export interface LinhaResultado {
  id: number
  celulas: { key: string; valor: string | number | null; link?: string | null }[]
}

export interface GrupoResultado {
  chave: string
  rotulo: string
  total: number
  linhas: LinhaResultado[]
}

export interface Resultado {
  dominio: string
  grain: string
  /** COUNT global — não muda com a paginação. */
  total: number
  pagina: number
  porPagina: number
  colunas: { key: string; rotulo: string; alinhamento?: string }[]
  linhas: LinhaResultado[]
  grupos: GrupoResultado[] | null
  /** O que efetivamente entrou na consulta, para a tela resumir. */
  aplicados: { key: string; rotulo: string; descricao: string }[]
  ignorados: string[]
}

/** Descreve o filtro para o resumo "Consulta atual" da tela. */
function descrever(rotulo: string, v: ValorDeFiltro): string {
  const d = rotuloDeData
  switch (v.tipo) {
    case "intervalo_data": return `${d(v.de)} – ${d(v.ate)}`
    case "data": return d(v.data)
    case "texto": return `"${v.texto}"`
    case "numero": return String(v.numero)
    case "intervalo_numero": return `${v.min ?? "…"} – ${v.max ?? "…"}`
    case "booleano": return v.valor ? "sim" : "não"
    case "selecao": return v.valor
    case "multi_selecao": return (v.rotulos?.length ? v.rotulos : v.valores).join(", ")
    case "entidade": return v.rotulo ?? `#${v.id}`
    default: return ""
  }
}

const MAX_POR_PAGINA = 200

export async function executar(dominio: DominioDef, spec: QuerySpec): Promise<Resultado> {
  const clausulas: Record<string, unknown>[] = []
  const aplicados: Resultado["aplicados"] = []
  const ignorados: string[] = []

  // CONTEXTO DE NACIONALIDADE — dimensão global, aplicada antes de tudo.
  if (spec.nacionalidade && dominio.aceitaNacionalidade) {
    clausulas.push(await dominio.ondeNacionalidade(spec.nacionalidade))
    aplicados.push({ key: "__nacionalidade", rotulo: "Nacionalidade", descricao: spec.nacionalidade })
  }

  for (const f of spec.filtros ?? []) {
    const def = dominio.filtros.find((x) => x.key === f.key)
    if (!def) { ignorados.push(f.key); continue }
    const clausula = await def.paraWhere(f.valor)
    // Filtro sem valor útil não vira cláusula vazia: sumiria o AND e passaria a
    // trazer tudo, que é o pior resultado possível — parece funcionar.
    if (!clausula) { ignorados.push(f.key); continue }
    clausulas.push(clausula)
    aplicados.push({ key: def.key, rotulo: def.rotulo, descricao: descrever(def.rotulo, f.valor) })
  }

  const where = clausulas.length ? { AND: clausulas } : {}

  const ordDef = dominio.ordenacoes.find((o) => o.key === spec.ordenarPor)
    ?? dominio.ordenacoes.find((o) => o.key === dominio.ordenacaoPadrao.key)
    ?? dominio.ordenacoes[0]
  const direcao = spec.direcao ?? dominio.ordenacaoPadrao.direcao
  const orderBy = ordDef.orderBy(direcao)

  const porPagina = Math.min(Math.max(spec.porPagina ?? 50, 1), MAX_POR_PAGINA)
  const pagina = Math.max(spec.pagina ?? 1, 1)

  // O TOTAL É O DO BANCO. Vem do mesmo `where`, e não da página carregada.
  const total = await dominio.contar(where)

  const chavesColunas = (spec.colunas?.length ? spec.colunas : dominio.colunasIniciais)
    .filter((k) => dominio.colunas.some((c) => c.key === k))
  const colunas = chavesColunas.map((k) => dominio.colunas.find((c) => c.key === k)!)

  const agrupamento = spec.agruparPor ? dominio.agrupamentos.find((a) => a.key === spec.agruparPor) ?? null : null
  if (spec.agruparPor && !agrupamento) ignorados.push(spec.agruparPor)

  const cruas = await dominio.carregar(where, orderBy, (pagina - 1) * porPagina, porPagina)

  const montar = (l: any): LinhaResultado => ({
    id: l.id,
    celulas: colunas.map((c) => ({ key: c.key, valor: c.valor(l), link: c.link?.(l) ?? null })),
  })
  const linhas = cruas.map(montar)

  // AGRUPAR NÃO É OUTRO RELATÓRIO: é a mesma consulta, com as linhas da página
  // organizadas em blocos. O total de cada grupo é o das linhas exibidas — e a
  // tela diz isso, para ninguém ler como total global.
  let grupos: GrupoResultado[] | null = null
  if (agrupamento) {
    const mapa = new Map<string, GrupoResultado>()
    for (const l of cruas) {
      const g = agrupamento.de(l)
      const atual = mapa.get(g.chave) ?? { chave: g.chave, rotulo: g.rotulo, total: 0, linhas: [] }
      atual.total += 1
      atual.linhas.push(montar(l))
      mapa.set(g.chave, atual)
    }
    grupos = [...mapa.values()].sort((a, b) => b.total - a.total)
  }

  return {
    dominio: dominio.key,
    grain: dominio.grain,
    total,
    pagina,
    porPagina,
    colunas: colunas.map((c) => ({ key: c.key, rotulo: c.rotulo, alinhamento: c.alinhamento })),
    linhas,
    grupos,
    aplicados,
    ignorados,
  }
}

/**
 * EXPORTAÇÃO — o MESMO caminho da tela, sem paginação. Se o export tivesse
 * consulta própria, ele acabaria trazendo linha que a tela não mostrou; é o
 * defeito clássico de relatório, e o motivo de ele reusar `executar`.
 */
export async function exportarCsv(dominio: DominioDef, spec: QuerySpec, teto = 20000): Promise<string> {
  const r = await executar(dominio, { ...spec, pagina: 1, porPagina: 1 })
  const total = Math.min(r.total, teto)
  const linhas: LinhaResultado[] = []
  const lote = 200
  for (let p = 1; (p - 1) * lote < total; p++) {
    const parte = await executar(dominio, { ...spec, pagina: p, porPagina: lote })
    linhas.push(...parte.linhas)
    if (parte.linhas.length === 0) break
  }
  const cab = r.colunas.map((c) => c.rotulo)
  const corpo = linhas.map((l) => l.celulas.map((c) => (c.valor ?? "")))
  const escapar = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`
  // BOM para o Excel abrir acentuação corretamente.
  return "﻿" + [cab, ...corpo].map((l) => l.map(escapar).join(";")).join("\n")
}
