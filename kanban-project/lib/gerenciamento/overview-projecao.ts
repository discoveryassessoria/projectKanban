// src/lib/gerenciamento/overview-projecao.ts
//
// Projeção PURA do Painel Geral do Gerenciamento — sem Prisma, sem DOM, testável.
// FONTE ÚNICA DOS RÓTULOS: `ROTULOS_CONTAGEM` alimenta tanto o KPI strip (API)
// quanto os cards (OverviewTab). Um número só pode ter um nome.
//
// REGRA DE DOMÍNIO — "última alteração" ≠ "último acesso":
// LOGIN/LOGIN_NEGADO são gravados em LogAuditoria com entidade "ACESSO"
// (ver src/app/api/auth/login/route.ts). Acesso NÃO é alteração de
// configuração e por isso é excluído da projeção por ENTIDADE — não por ação —
// para que novas ações de acesso continuem excluídas sem tocar aqui.

/** entidade usada pelo log de acesso (login). Não é alteração de configuração. */
export const ENTIDADE_ACESSO = "ACESSO"

export const ehEventoDeAcesso = (entidade?: string | null): boolean =>
  (entidade ?? "").trim().toUpperCase() === ENTIDADE_ACESSO

/** contagens reais do banco que alimentam cards e strip. */
export interface ContagensOverview {
  usuarios: number
  perfis: number
  contas: number
  categorias: number
  fornecedores: number
  centros: number
  statusCols: number
}

export interface ItemStrip {
  label: string
  value: number | string
  real: boolean
  isText?: boolean
  /**
   * true = este número JÁ é exibido como card na mesma tela.
   * Campo ADITIVO: consumidor antigo ignora e segue renderizando tudo
   * (comportamento anterior preservado).
   */
  duplicadoEmCards?: boolean
}

/**
 * Rótulo canônico de cada contagem. Os nomes carregam o recorte real da query:
 * `fornecedores` conta apenas ativos e `categorias` conta CategoriaFinanceira —
 * omitir isso no rótulo promete mais do que o número entrega.
 */
export const ROTULOS_CONTAGEM: Record<keyof ContagensOverview, string> = {
  usuarios: "Usuários",
  perfis: "Perfis",
  contas: "Contas bancárias",
  categorias: "Categorias financeiras",
  fornecedores: "Fornecedores ativos",
  centros: "Centros de custo",
  statusCols: "Colunas de status",
}

/** ordem de exibição — a mesma em cards e strip. */
export const ORDEM_CONTAGEM: (keyof ContagensOverview)[] = [
  "usuarios", "perfis", "contas", "categorias", "fornecedores", "centros", "statusCols",
]

export const formatarDataCurta = (em: Date | string | null | undefined): string =>
  em ? new Date(em).toLocaleDateString("pt-BR") : "—"

/**
 * Monta o KPI strip. As 7 contagens vão marcadas como `duplicadoEmCards`
 * porque aparecem como cards logo abaixo; "Última alteração" é exclusiva do
 * strip e por isso não é marcada.
 */
export function montarStrip(
  contagens: ContagensOverview,
  ultimaAlteracaoEm: Date | string | null | undefined,
): ItemStrip[] {
  return [
    ...ORDEM_CONTAGEM.map((chave) => ({
      label: ROTULOS_CONTAGEM[chave],
      value: contagens[chave],
      real: true,
      duplicadoEmCards: true,
    })),
    {
      label: "Última alteração",
      value: formatarDataCurta(ultimaAlteracaoEm),
      real: true,
      isText: true,
    },
  ]
}
