// lib/financeiro/leitura/tabela-precos-projecao.ts
// ============================================================================
// TABELA DE PREÇOS — projeção por CADASTRO MESTRE. Módulo PURO.
//
// ─── O DEFEITO QUE ISTO CORRIGE ─────────────────────────────────────────────
// A listagem renderizava REGISTRO DE PREÇO, e o banco guarda um registro por
// natureza. Um item com custo e venda virava duas linhas na tela:
//
//   Certidão de Nascimento - Inteiro Teor   Papel: Custo    R$ 146,24
//   Certidão de Nascimento - Inteiro Teor   Papel: Venda    R$ 153,24
//
// Lido como dois itens. Não são: CUSTO e VENDA são duas DIMENSÕES FINANCEIRAS
// do MESMO cadastro — e é assim que o resto do sistema já as trata (a
// Configuração Financeira declara `possuiCusto`/`possuiReceita`, e o resolvedor
// pede a natureza como critério).
//
// ─── O QUE NÃO MUDA ─────────────────────────────────────────────────────────
// Nada no banco. Os registros continuam separados por natureza, fornecedor,
// moeda, contexto e estratégia — fundi-los para arrumar a tela seria destruir a
// granularidade que o motor de preços usa para resolver. A correção é de
// PROJEÇÃO: uma linha por item, duas colunas.
//
// ─── A CHAVE É ID, NUNCA NOME ───────────────────────────────────────────────
// O agrupamento usa `configuracaoFinanceiraItemId` — a Configuração Financeira,
// que é `@unique` por item do Catálogo e é exatamente o que o resolvedor de
// preço recebe. Agrupar por rótulo juntaria homônimos e separaria o mesmo item
// renomeado.
// ============================================================================

/** O que a projeção precisa de cada registro de preço. Nada além disso. */
export interface RegistroPreco {
  id: number
  configuracaoFinanceiraItemId: number | null
  natureza: string | null
  valor: unknown
  valorBase?: unknown
  valorAdicional?: unknown
  moeda: string
  modoCalculo: string
  unidade?: string | null
  quantidadeMinima?: unknown
  quantidadeMaxima?: unknown
  fornecedor?: { id: number; nome: string; publicCode?: string | null } | null
  arquivado?: boolean
}

/** Uma dimensão financeira (custo OU venda) de um cadastro. */
export interface DimensaoPreco<T extends RegistroPreco = RegistroPreco> {
  registro: T
  fornecedor: string | null
}

/** UMA LINHA DA TELA = UM CADASTRO MESTRE. */
export interface LinhaMestre<T extends RegistroPreco = RegistroPreco> {
  /** `configuracaoFinanceiraItemId` — a chave canônica do agrupamento. */
  configId: number
  /** Qualquer registro do grupo serve para ler nome/origem do mestre. */
  referencia: T
  custo: DimensaoPreco<T> | null
  venda: DimensaoPreco<T> | null
  /** Registros que não são nem custo nem venda (natureza legada/nula). */
  outros: T[]
}

/** VENDA e RECEITA são o mesmo papel comercial; RECEITA é o nome legado. */
function papel(natureza: string | null | undefined): 'CUSTO' | 'VENDA' | null {
  if (natureza === 'CUSTO') return 'CUSTO'
  if (natureza === 'VENDA' || natureza === 'RECEITA') return 'VENDA'
  return null
}

// SÓ O NOME AMIGÁVEL. O `publicCode` do fornecedor (FOR-1) identifica o
// FORNECEDOR — não o documento nem o serviço — e competia visualmente com o
// código canônico do cadastro mestre. Ele vive no cadastro do fornecedor.
const nomeFornecedor = (f: RegistroPreco['fornecedor']): string | null => f?.nome ?? null

/**
 * Agrupa registros de preço em UMA linha por cadastro mestre, preservando a
 * ordem de primeira aparição (a ordenação de quem chamou continua valendo).
 *
 * Registro sem `configuracaoFinanceiraItemId` vira a sua própria linha: ele não
 * tem mestre a que pertencer, e escondê-lo seria pior do que mostrá-lo sozinho.
 *
 * Dois registros da MESMA natureza no mesmo item: o primeiro ocupa a coluna e o
 * segundo vai para `outros`. Não é caso esperado — o conflito de preço bloqueia
 * antes —, mas a projeção não pode sumir com uma linha que existe no banco.
 */
export function agruparPorCadastroMestre<T extends RegistroPreco>(registros: T[]): LinhaMestre<T>[] {
  const porConfig = new Map<number, LinhaMestre<T>>()
  const soltos: LinhaMestre<T>[] = []
  const ordem: Array<{ configId: number } | { solto: LinhaMestre<T> }> = []

  for (const r of registros) {
    if (r.configuracaoFinanceiraItemId == null) {
      const linha: LinhaMestre<T> = { configId: -r.id, referencia: r, custo: null, venda: null, outros: [] }
      const p = papel(r.natureza)
      if (p === 'CUSTO') linha.custo = { registro: r, fornecedor: nomeFornecedor(r.fornecedor) }
      else if (p === 'VENDA') linha.venda = { registro: r, fornecedor: nomeFornecedor(r.fornecedor) }
      else linha.outros.push(r)
      soltos.push(linha)
      ordem.push({ solto: linha })
      continue
    }

    const cfg = r.configuracaoFinanceiraItemId
    let linha = porConfig.get(cfg)
    if (!linha) {
      linha = { configId: cfg, referencia: r, custo: null, venda: null, outros: [] }
      porConfig.set(cfg, linha)
      ordem.push({ configId: cfg })
    }

    const p = papel(r.natureza)
    const dim: DimensaoPreco<T> = { registro: r, fornecedor: nomeFornecedor(r.fornecedor) }
    if (p === 'CUSTO' && linha.custo == null) linha.custo = dim
    else if (p === 'VENDA' && linha.venda == null) linha.venda = dim
    else linha.outros.push(r)
  }

  return ordem.map((o) => ('configId' in o ? porConfig.get(o.configId)! : o.solto))
}

/** Quantos CADASTROS a tela mostra — nunca quantos registros existem por baixo. */
export function contarCadastros(registros: RegistroPreco[]): number {
  return agruparPorCadastroMestre(registros).length
}
