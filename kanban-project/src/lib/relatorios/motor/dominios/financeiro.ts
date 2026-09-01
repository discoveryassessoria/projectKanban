// DOMÍNIO FINANCEIRO — 1 linha = 1 obrigação econômica.
//
// SOMENTE LEITURA. Este domínio não calcula preço, não decide margem e não toca
// no motor V3: ele LÊ `ObrigacaoEconomica`, que já é o registro canônico do
// compromisso — de entrada (receita) ou de saída (custo).
//
// ─── O PREÇO NÃO NASCE AQUI ─────────────────────────────────────────────────
// A cadeia é preço canônico → override local, quando houver → valor efetivo, e
// ela acontece no motor financeiro, na hora do lançamento. `valorContratado` já
// é o valor efetivo congelado naquele momento. Recalcular aqui produziria um
// segundo número para a mesma obrigação — e no dia em que os dois divergissem,
// ninguém saberia qual é o da nota.

import { prisma } from "@/lib/prisma"
import type { DominioDef } from "../tipos"
import { cadastro, contem, dataBR, emLista, emListaId, igualId, periodo, porCampo, porMes } from "./_comuns"
/** Os processos de uma família, numa consulta só. */
async function idsDeProcessosDaFamilia(familiaId: number): Promise<number[]> {
  const r = await prisma.processo.findMany({ where: { familiaId }, select: { id: true } })
  return r.map((p) => p.id)
}

/** Os processos de uma nacionalidade, numa consulta só. */
async function idsDeProcessosDoPais(countryKey: string): Promise<number[]> {
  const r = await prisma.processo.findMany({ where: { paisCanonico: { countryKey } }, select: { id: true } })
  return r.map((p) => p.id)
}

// `ObrigacaoEconomica` guarda `processoId` e `itemCatalogoId` como escalares,
// SEM relação declarada no schema. Não invento a relação aqui: carrego as
// obrigações e, num SEGUNDO passo, busco de uma vez os processos e itens que
// elas citam. São duas consultas fixas — nunca uma por linha.
const INCLUDE = { fornecedor: { select: { id: true, nome: true } } } as const

export const DOMINIO_FINANCEIRO: DominioDef = {
  key: "financeiro",
  rotulo: "Financeiro",
  descricao: "Custos e receitas por processo, família, serviço e período — leitura do motor V3.",
  grain: "1 linha = 1 obrigação econômica (agregável por processo, família ou período)",
  permissao: "financeiro.ver",
  ordem: 11,
  aceitaNacionalidade: true,
  // Sem relação declarada para Processo, o recorte não pode atravessar. Ele é
  // feito por subconsulta explícita — o Prisma resolve num IN, sem N+1.
  ondeNacionalidade: async (countryKey) => ({ processoId: { in: await idsDeProcessosDoPais(countryKey) } }),

  filtros: [
    { key: "direcao", rotulo: "Direção", descricao: "Entrada é receita; saída é custo.",
      tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: [
        { valor: "ENTRADA", rotulo: "Receita (entrada)" }, { valor: "SAIDA", rotulo: "Custo (saída)" } ] },
      paraWhere: emLista("direcao") },
    { key: "natureza", rotulo: "Natureza", tipo: "texto", paraWhere: contem("natureza") },
    { key: "status", rotulo: "Status", tipo: "texto", paraWhere: contem("status") },
    { key: "periodo_vencimento", rotulo: "Período de vencimento", tipo: "intervalo_data",
      paraWhere: (v) => periodo("vencimento", v) },
    { key: "periodo_criacao", rotulo: "Período de lançamento", tipo: "intervalo_data",
      paraWhere: (v) => periodo("criadoEm", v) },
    { key: "processo", rotulo: "Processo", tipo: "entidade", opcoes: cadastro("processos"), paraWhere: igualId("processoId") },
    { key: "familia", rotulo: "Família", tipo: "entidade", opcoes: cadastro("familias"),
      // Sem relação declarada, a família é alcançada pelos processos dela,
      // resolvidos numa consulta só antes do filtro.
      paraWhere: async (v) => (v.tipo === "entidade"
        ? { processoId: { in: await idsDeProcessosDaFamilia(v.id) } } : null) },
    { key: "item", rotulo: "Item do catálogo", tipo: "multi_selecao", opcoes: cadastro("itens_documentais"),
      paraWhere: emListaId("itemCatalogoId") },
    { key: "fornecedor", rotulo: "Fornecedor", tipo: "entidade", opcoes: cadastro("fornecedores"),
      paraWhere: igualId("fornecedorId") },
    { key: "moeda", rotulo: "Moeda", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: [
        { valor: "BRL", rotulo: "BRL" }, { valor: "EUR", rotulo: "EUR" }, { valor: "USD", rotulo: "USD" } ] },
      paraWhere: emLista("moedaContratual") },
    { key: "arquivada", rotulo: "Arquivada", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { arquivadaEm: { not: null } } : { arquivadaEm: null }) },
    { key: "vencida", rotulo: "Vencida e em aberto", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" || !v.valor ? null
        : { vencimento: { lt: new Date() }, status: { notIn: ["LIQUIDADA", "CANCELADA"] } }) },
  ],

  agrupamentos: [
    porCampo("direcao", "Direção", (l) => (l.direcao === "ENTRADA" ? "Receita" : "Custo")),
    porCampo("natureza", "Natureza", (l) => l.natureza),
    porCampo("status", "Status", (l) => l.status),
    porCampo("processo", "Processo", (l) => (l.processo ? `${l.processo.codigo ?? l.processo.id} — ${l.processo.nome}` : null)),
    porCampo("familia", "Família", (l) => l.processo?.familia?.nome),
    porCampo("nacionalidade", "Nacionalidade", (l) => l.processo?.paisCanonico?.countryLabel),
    porCampo("item", "Item", (l) => l.itemCatalogo?.name),
    porCampo("moeda", "Moeda", (l) => l.moedaContratual),
    porMes("vencimento", "Mês do vencimento"),
  ],

  colunas: [
    { key: "codigo", rotulo: "Código", valor: (l) => l.codigoOperacional ?? `#${l.id}` },
    { key: "direcao", rotulo: "Direção", valor: (l) => (l.direcao === "ENTRADA" ? "Receita" : "Custo") },
    { key: "natureza", rotulo: "Natureza", valor: (l) => l.natureza },
    { key: "item", rotulo: "Item", valor: (l) => l.itemCatalogo?.name ?? null },
    { key: "valor", rotulo: "Valor contratado",
      valor: (l) => (l.valorContratado != null ? Number(l.valorContratado) : null),
      alinhamento: "direita", somavel: true },
    { key: "moeda", rotulo: "Moeda", valor: (l) => l.moedaContratual },
    { key: "status", rotulo: "Status", valor: (l) => l.status },
    { key: "estado_custo", rotulo: "Estado do custo", valor: (l) => l.estadoCusto ?? null },
    { key: "processo", rotulo: "Processo",
      valor: (l) => (l.processo ? `${l.processo.codigo ?? l.processo.id} — ${l.processo.nome}` : null),
      link: (l) => (l.processo ? `/processos/${l.processo.id}` : null) },
    { key: "familia", rotulo: "Família", valor: (l) => l.processo?.familia?.nome ?? null },
    { key: "nacionalidade", rotulo: "Nacionalidade", valor: (l) => l.processo?.paisCanonico?.countryLabel ?? null },
    { key: "vencimento", rotulo: "Vencimento", valor: (l) => dataBR(l.vencimento) },
    { key: "lancamento", rotulo: "Lançada em", valor: (l) => dataBR(l.criadoEm) },
    { key: "arquivada", rotulo: "Arquivada", valor: (l) => (l.arquivadaEm ? dataBR(l.arquivadaEm) : null) },
    { key: "observacoes", rotulo: "Observações", valor: (l) => l.observacoes ?? null },
  ],

  ordenacoes: [
    { key: "vencimento", rotulo: "Vencimento", orderBy: (d) => [{ vencimento: d }, { id: d }] },
    { key: "lancamento", rotulo: "Lançamento", orderBy: (d) => [{ criadoEm: d }, { id: d }] },
    { key: "valor", rotulo: "Valor", orderBy: (d) => [{ valorContratado: d }, { id: "desc" as const }] },
  ],

  colunasIniciais: ["codigo", "direcao", "natureza", "item", "valor", "moeda", "status", "processo", "vencimento"],
  ordenacaoPadrao: { key: "vencimento", direcao: "desc" },

  contar: (where) => prisma.obrigacaoEconomica.count({ where }),
  carregar: async (where, orderBy, pular, levar) => {
    const linhas = await prisma.obrigacaoEconomica.findMany({
      where, orderBy, skip: pular, take: levar, include: INCLUDE,
    })
    const processoIds = [...new Set(linhas.map((l) => l.processoId).filter((x): x is number => x != null))]
    const itemIds = [...new Set(linhas.map((l) => l.itemCatalogoId).filter((x): x is number => x != null))]
    const [processos, itens] = await Promise.all([
      processoIds.length
        ? prisma.processo.findMany({
            where: { id: { in: processoIds } },
            select: {
              id: true, codigo: true, nome: true,
              paisCanonico: { select: { countryKey: true, countryLabel: true } },
              familia: { select: { id: true, nome: true } },
            },
          })
        : Promise.resolve([]),
      itemIds.length
        ? prisma.itemCatalogo.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, code: true } })
        : Promise.resolve([]),
    ])
    const porProcesso = new Map(processos.map((p) => [p.id, p]))
    const porItem = new Map(itens.map((i) => [i.id, i]))
    return linhas.map((l) => ({
      ...l,
      processo: l.processoId != null ? porProcesso.get(l.processoId) ?? null : null,
      itemCatalogo: l.itemCatalogoId != null ? porItem.get(l.itemCatalogoId) ?? null : null,
    }))
  },

  visoesDoSistema: [
    { key: "receitas", nome: "Receitas",
      spec: { filtros: [{ key: "direcao", valor: { tipo: "multi_selecao", valores: ["ENTRADA"] } }] } },
    { key: "custos", nome: "Custos",
      spec: { filtros: [{ key: "direcao", valor: { tipo: "multi_selecao", valores: ["SAIDA"] } }] } },
    { key: "vencidas", nome: "Vencidas em aberto",
      spec: { filtros: [{ key: "vencida", valor: { tipo: "booleano", valor: true } }] } },
    { key: "por-processo", nome: "Por processo", spec: { filtros: [], agruparPor: "processo" } },
    { key: "por-mes", nome: "Por mês de vencimento", spec: { filtros: [], agruparPor: "mes_vencimento" } },
  ],
}
