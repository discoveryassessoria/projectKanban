// lib/financeiro/leitura/planilha-matriz.ts
// ============================================================================
// A MATRIZ DA PLANILHA DOCUMENTAL — módulo PURO.
//
// ─── AS DUAS DIMENSÕES ──────────────────────────────────────────────────────
// LINHA  = registro civil da pessoa (nascimento, casamento, óbito)
// COLUNA = etapa/serviço documental (certidão inteiro teor, apostilamento…)
// CÉLULA = a interseção — o item canônico que aquela etapa produz SOBRE aquele
//          registro, e o preço dele.
//
// ─── O ERRO QUE ISTO CORRIGE ────────────────────────────────────────────────
// A configuração amarrava uma coluna a UM item do Cadastro Mestre. Como
// "Certidão de Nascimento - Inteiro Teor" e "Certidão de Casamento - Inteiro
// Teor" são itens distintos, viravam DUAS COLUNAS:
//
//   Registro    | Certidão Nascimento | Certidão Casamento |
//   Nascimento  | R$ 146,24           | —                  |
//   Casamento   | —                   | R$ 146,24          |
//
// Uma matriz diagonal: metade das células estruturalmente vazia, porque a
// mesma informação estava sendo dita duas vezes — uma na linha, outra na
// coluna. É UMA coluna ("Certidão Inteiro Teor") em três linhas.
//
// ─── COMO A INTERSEÇÃO É RESOLVIDA, SEM UM ÚNICO MATCH POR TEXTO ────────────
// O Cadastro Mestre já liga o tipo documental ao item do catálogo:
//
//   TipoDocumentoCadastro #2 "Certidão de nascimento - Inteiro Teor"
//     └─ itemCatalogoId 1 → ItemCatalogo CERT_NASCIMENTO_IT (categoria REGCIV)
//          └─ ProdutoFinanceiro #182 → Tabela de Preços
//
// Então a coluna "Certidão Inteiro Teor" não precisa saber nada sobre o
// nascimento: ela declara a CATEGORIA (REGCIV) e a linha entrega o item. Nenhum
// rótulo é comparado em lugar nenhum — o caminho é FK a FK.
//
// Colunas de serviço (tradução, apostilamento) usam o mesmo item em todas as
// linhas; para elas a estratégia é SERVICO_FIXO e a resolução é direta.
// ============================================================================

/** Como a célula descobre o item canônico daquela interseção. */
export type EstrategiaColuna = 'SERVICO_FIXO' | 'ITEM_DO_REGISTRO'

export const ESTRATEGIAS: readonly EstrategiaColuna[] = ['SERVICO_FIXO', 'ITEM_DO_REGISTRO'] as const

export function ehEstrategia(v: unknown): v is EstrategiaColuna {
  return v === 'SERVICO_FIXO' || v === 'ITEM_DO_REGISTRO'
}

/** A coluna, como a matriz precisa dela. */
export interface ColunaMatriz {
  id: number
  estrategia: EstrategiaColuna
  /** SERVICO_FIXO: a Configuração Financeira única da coluna. */
  configId: number | null
  /** ITEM_DO_REGISTRO: a categoria do catálogo que delimita os itens aceitos. */
  categoriaItemId: number | null
}

/** O registro civil da linha, já com o item que o Cadastro Mestre lhe deu. */
export interface RegistroMatriz {
  tipoDocumentoId: number
  itemCatalogoId: number | null
}

/** Uma Configuração Financeira candidata, indexada pelo item que ela precifica. */
export interface ConfigCandidata {
  configId: number
  itemCatalogoId: number | null
  /** Categoria do ITEM, lida do mestre — nunca guardada na configuração. */
  categoriaItemId: number | null
}

/**
 * Por que esta célula não tem item — a resposta vai para a tela, não para o log.
 *
 * `AMBIGUO` é deliberadamente um resultado, não uma exceção: duas
 * configurações candidatas para a mesma interseção é erro de cadastro, e
 * escolher uma delas (ou somar as duas) esconderia o erro dentro de um número
 * que parece certo.
 */
export type ResolucaoMatriz =
  | { tipo: 'RESOLVIDO'; configId: number }
  | { tipo: 'SEM_ITEM'; motivo: string }
  | { tipo: 'AMBIGUO'; motivo: string; candidatos: number[] }

/**
 * O ITEM CANÔNICO DE UMA INTERSEÇÃO — o único lugar do sistema que responde
 * "que serviço é 'Certidão Inteiro Teor' na linha do casamento?".
 *
 * `porItem` é o índice pré-carregado de Configurações Financeiras por
 * `itemCatalogoId`; ele existe para que a matriz inteira seja resolvida em
 * memória, sem uma consulta por célula.
 */
export function resolverIntersecao(
  coluna: ColunaMatriz,
  registro: RegistroMatriz,
  porItem: Map<number, ConfigCandidata[]>,
): ResolucaoMatriz {
  if (coluna.estrategia === 'SERVICO_FIXO') {
    if (coluna.configId == null) {
      return { tipo: 'SEM_ITEM', motivo: 'Coluna de serviço sem Configuração Financeira vinculada.' }
    }
    return { tipo: 'RESOLVIDO', configId: coluna.configId }
  }

  // ITEM_DO_REGISTRO: quem entrega o item é a LINHA.
  if (registro.itemCatalogoId == null) {
    return {
      tipo: 'SEM_ITEM',
      motivo: 'O tipo documental deste registro não está ligado a um item do Catálogo no Cadastro Mestre.',
    }
  }

  const candidatos = porItem.get(registro.itemCatalogoId) ?? []
  // A categoria da coluna é o filtro: sem ela, uma coluna resolveria qualquer
  // item que a linha apontasse, e "Certidão Inteiro Teor" passaria a valer para
  // um registro cujo item é de outra natureza.
  const naCategoria =
    coluna.categoriaItemId == null
      ? candidatos
      : candidatos.filter((c) => c.categoriaItemId === coluna.categoriaItemId)

  if (naCategoria.length === 0) {
    return {
      tipo: 'SEM_ITEM',
      motivo:
        candidatos.length > 0
          ? 'O item deste registro existe, mas está fora da categoria desta coluna.'
          : 'Não há Configuração Financeira para o item deste registro.',
    }
  }
  if (naCategoria.length > 1) {
    return {
      tipo: 'AMBIGUO',
      motivo: 'Mais de uma Configuração Financeira precifica o item deste registro.',
      candidatos: naCategoria.map((c) => c.configId),
    }
  }
  return { tipo: 'RESOLVIDO', configId: naCategoria[0].configId }
}

/** A chave da célula: a interseção inteira, por IDs. Nome nunca entra aqui. */
export function chaveDaCelula(args: {
  processoId: number
  pessoaId: number
  tipoDocumentoId: number
  colunaId: number
}): string {
  return `${args.processoId}::${args.pessoaId}::${args.tipoDocumentoId}::${args.colunaId}`
}
