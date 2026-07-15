// prisma/_financeiro-checks.ts
// ============================================================================
// Checagens de saneamento financeiro — LÓGICA PURA (sem Prisma, sem I/O).
// Fonte única usada por: inventario-financeiro.ts (relatório) e
// validacao-financeira.ts (gate de cutover). Testável com fixtures (sem banco):
// ver scripts/financeiro-checks.test.ts.
//
// `gate: true`  → invariante que DEVE zerar após os lotes (bloqueia cutover).
// `gate: false` → informativo/limpeza (não bloqueia; ex.: espelhos a colapsar).
// ============================================================================

export type Row = Record<string, unknown>

export interface Achado {
  chave: string
  titulo: string
  gate: boolean
  total: number
  amostra: Row[]
}

export interface DadosFinanceiros {
  produtos: { id: number; codigo: string; nome: string; naturezaFinanceira: string | null; itemCatalogoId: number | null; valorPadrao: number | null; ativo: boolean }[]
  itens: { id: number; code: string; name: string; natureza: string; ativo: boolean; _count: { tiposDocumento: number; produtos: number; servicos: number; precos: number; tiposServico: number; necessidades: number } }[]
  precos: { id: number; name: string; valor: number; moeda: string; natureza: string | null; itemCatalogoId: number | null; arquivado: boolean }[]
  honorarios: { id: number; code: string; name: string; servico: string | null; valorPadrao: number | null; momentoCobranca: string; ativo: boolean }[]
  econRules: { id: number; documentTypeCode: string | null; custoProdutoCode: string | null; receitaProdutoCode: string | null; componentName: string; componentKey: string }[]
  triggerRules: { id: number; itemCode: string; financialItemId: number | null; name: string; active: boolean }[]
  tiposDoc: { id: number; code: string | null; name: string; legacyEnumKey: string | null; itemCatalogoId: number | null }[]
  servicos: { id: number; code: string; name: string; itemCatalogoId: number | null }[]
  tiposServico: { id: number; nome: string; itemCatalogoId: number | null }[]
}

function achado(chave: string, titulo: string, gate: boolean, rows: Row[], limite = 100): Achado {
  return { chave, titulo, gate, total: rows.length, amostra: rows.slice(0, limite) }
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const marca = (s?: string | null) => !!s && /\[(teste|ajustar)\]/i.test(s)
const precoValido = (v: number) => Number.isFinite(v) && v > 0

/** Roda TODAS as checagens sobre os dados já coletados. Puro/determinístico. */
export function analisarFinanceiro(d: DadosFinanceiros): Achado[] {
  const out: Achado[] = []

  // 1a) espelho custo+receita no mesmo item
  const porItem = new Map<number, DadosFinanceiros['produtos']>()
  for (const p of d.produtos) {
    if (p.itemCatalogoId == null) continue
    const arr = porItem.get(p.itemCatalogoId) ?? []
    arr.push(p)
    porItem.set(p.itemCatalogoId, arr)
  }
  const espelho: Row[] = []
  for (const [itemId, arr] of porItem) {
    const custo = arr.some((p) => (p.naturezaFinanceira ?? '').toLowerCase() === 'cost')
    const receita = arr.some((p) => (p.naturezaFinanceira ?? '').toLowerCase() === 'revenue')
    if (custo && receita) espelho.push({ itemCatalogoId: itemId, produtos: arr.map((p) => `${p.codigo}(${p.naturezaFinanceira})`).join(' + ') })
  }
  out.push(achado('espelho_custo_receita_por_item', 'ItemCatalogo com ProdutoFinanceiro CUSTO+RECEITA espelhados (→ colapsar em TabelaValor)', false, espelho))

  // 1b) pares por sufixo _CUSTO/_RECEITA
  const byBase = new Map<string, string[]>()
  for (const p of d.produtos) {
    const m = /^(.*?)[_-](CUSTO|RECEITA)$/i.exec(p.codigo ?? '')
    if (!m) continue
    const arr = byBase.get(m[1]) ?? []
    arr.push(p.codigo)
    byBase.set(m[1], arr)
  }
  out.push(achado('pares_sufixo_custo_receita', 'Pares de ProdutoFinanceiro com sufixo _CUSTO/_RECEITA', false,
    [...byBase.entries()].filter(([, v]) => v.length > 1).map(([base, v]) => ({ base, codigos: v.join(', ') }))))

  // 1c) codigo duplicado (falta @unique)
  const codigoCount = new Map<string, number>()
  for (const p of d.produtos) codigoCount.set(p.codigo, (codigoCount.get(p.codigo) ?? 0) + 1)
  out.push(achado('codigo_produto_duplicado', 'ProdutoFinanceiro.codigo duplicado (falta @unique)', true,
    [...codigoCount.entries()].filter(([, n]) => n > 1).map(([codigo, n]) => ({ codigo, ocorrencias: n }))))

  // 2) documento sobreposto no catálogo (DOC_* vs CERT_*_IT por nome)
  const docItens = d.itens.filter((i) => /^DOC_/i.test(i.code) || /^CERT_/i.test(i.code))
  const porNome = new Map<string, string[]>()
  for (const i of docItens) {
    const k = norm(i.name)
    const arr = porNome.get(k) ?? []
    arr.push(i.code)
    porNome.set(k, arr)
  }
  out.push(achado('documento_catalogo_sobreposto', 'ItemCatalogo de documento com nome duplicado (DOC_* vs CERT_*_IT)', false,
    [...porNome.entries()].filter(([, v]) => v.length > 1).map(([nome, v]) => ({ nome, codes: v.join(', ') }))))

  // 3) marcadores [TESTE]/[AJUSTAR]
  out.push(achado('marcadores_teste', 'Registros [TESTE]/[AJUSTAR]', false, [
    ...d.produtos.filter((p) => marca(p.nome)).map((p) => ({ tabela: 'ProdutoFinanceiro', id: p.id, texto: p.nome })),
    ...d.itens.filter((i) => marca(i.name)).map((i) => ({ tabela: 'ItemCatalogo', id: i.id, texto: i.name })),
    ...d.precos.filter((v) => marca(v.name)).map((v) => ({ tabela: 'TabelaValor', id: v.id, texto: v.name })),
    ...d.honorarios.filter((h) => marca(h.name)).map((h) => ({ tabela: 'Honorario', id: h.id, texto: h.name })),
    ...d.servicos.filter((s) => marca(s.name)).map((s) => ({ tabela: 'ServicoProduto', id: s.id, texto: s.name })),
  ]))

  // 4) valores suspeitos na TabelaValor
  out.push(achado('preco_zero', 'TabelaValor com valor <= 0 / não-finito (B2 — zero silencioso)', true,
    d.precos.filter((v) => !v.arquivado && !precoValido(v.valor)).map((v) => ({ id: v.id, name: v.name, valor: v.valor, natureza: v.natureza }))))
  out.push(achado('preco_invisivel_resolver', 'TabelaValor sem itemCatalogoId/natureza (B1 — invisível ao motor)', true,
    d.precos.filter((v) => !v.arquivado && (v.itemCatalogoId == null || v.natureza == null)).map((v) => ({ id: v.id, name: v.name, itemCatalogoId: v.itemCatalogoId, natureza: v.natureza }))))

  // 5) órfãos
  out.push(achado('produto_sem_item_mestre', 'ProdutoFinanceiro sem itemCatalogoId (sem mestre)', true,
    d.produtos.filter((p) => p.itemCatalogoId == null).map((p) => ({ id: p.id, codigo: p.codigo, nome: p.nome }))))
  out.push(achado('item_sem_consumidor', 'ItemCatalogo sem NENHUM consumidor', false,
    d.itens.filter((i) => i._count.tiposDocumento + i._count.produtos + i._count.servicos + i._count.precos + i._count.tiposServico + i._count.necessidades === 0)
      .map((i) => ({ id: i.id, code: i.code, name: i.name }))))
  out.push(achado('honorario_orfao_catalogo', 'Honorario não integrado ao catálogo (schema sem itemCatalogoId — resolver no M4)', false,
    d.honorarios.map((h) => ({ id: h.id, code: h.code, name: h.name, servicoTexto: h.servico, valorPadrao: h.valorPadrao, momentoCobranca: h.momentoCobranca }))))
  out.push(achado('tipodoc_sem_item', 'TipoDocumentoCadastro sem itemCatalogoId', false,
    d.tiposDoc.filter((t) => t.itemCatalogoId == null).map((t) => ({ id: t.id, code: t.code, name: t.name, legacyEnumKey: t.legacyEnumKey }))))
  out.push(achado('servico_sem_item', 'ServicoProduto sem itemCatalogoId', false,
    d.servicos.filter((s) => s.itemCatalogoId == null).map((s) => ({ id: s.id, code: s.code, name: s.name }))))
  out.push(achado('tiposervico_sem_item', 'TipoServico sem itemCatalogoId', false,
    d.tiposServico.filter((s) => s.itemCatalogoId == null).map((s) => ({ id: s.id, nome: s.nome }))))

  // 6) integridade de vínculos por TEXTO (o pior anti-padrão) — todos GATE
  const codigosProduto = new Set(d.produtos.map((p) => p.codigo))
  const codesDoc = new Set(d.tiposDoc.map((t) => t.code).filter(Boolean) as string[])
  out.push(achado('econ_documentTypeCode_quebrado', 'PhaseEconomicRule.documentTypeCode sem TipoDocumentoCadastro', true,
    d.econRules.filter((r) => r.documentTypeCode && !codesDoc.has(r.documentTypeCode)).map((r) => ({ id: r.id, documentTypeCode: r.documentTypeCode, componentName: r.componentName }))))
  out.push(achado('econ_produtoCode_quebrado', 'PhaseEconomicRule custo/receitaProdutoCode sem ProdutoFinanceiro', true,
    d.econRules.filter((r) => (r.custoProdutoCode && !codigosProduto.has(r.custoProdutoCode)) || (r.receitaProdutoCode && !codigosProduto.has(r.receitaProdutoCode)))
      .map((r) => ({ id: r.id, custo: r.custoProdutoCode, receita: r.receitaProdutoCode }))))
  out.push(achado('trigger_itemCode_quebrado', 'PhaseTriggerRule.itemCode sem ProdutoFinanceiro', true,
    d.triggerRules.filter((t) => t.itemCode && !codigosProduto.has(t.itemCode)).map((t) => ({ id: t.id, itemCode: t.itemCode, financialItemId: t.financialItemId, name: t.name }))))
  out.push(achado('trigger_sem_financialItemId', 'PhaseTriggerRule com itemCode mas financialItemId nulo (vínculo só por texto)', true,
    d.triggerRules.filter((t) => t.itemCode && t.financialItemId == null).map((t) => ({ id: t.id, itemCode: t.itemCode, name: t.name }))))

  return out
}

/** Achados que bloqueiam cutover (gate) com total > 0. */
export function violacoesDeGate(achados: Achado[]): Achado[] {
  return achados.filter((a) => a.gate && a.total > 0)
}
