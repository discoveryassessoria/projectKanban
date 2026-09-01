// DOMÍNIO FORNECEDORES — 1 linha = 1 organização com função de FORNECEDOR.
//
// Não existe cadastro separado de fornecedor: é a MESMA organização de Órgãos,
// com mais uma função. O cartório que recebe protocolo e cobra emolumento é um
// registro só. Por isso este domínio é um recorte por função — e não uma
// segunda lista que sairia do ar no dia em que alguém cadastrasse em um lugar e
// não no outro.
//
// Desempenho é medido pelo que o sistema realmente registra: solicitações
// feitas, quantas voltaram e quanto tempo levaram. Nada de nota inventada.

import { prisma } from "@/lib/prisma"
import type { DominioDef } from "../tipos"
import { cadastro, contem, dataBR, emLista, emListaId, porCampo } from "./_comuns"

const INCLUDE = {
  pais: { select: { id: true, countryKey: true, countryLabel: true } },
  solicitacaoDocumentos: {
    select: { id: true, status: true, dataEnvio: true, previsaoRetorno: true, custoPago: true, updatedAt: true },
  },
  _count: { select: { protocolos: true, documentosEmitidos: true } },
} as const

const sols = (l: any) => l.solicitacaoDocumentos ?? []
const respondidas = (l: any) => sols(l).filter((s: any) => s.status === "RESPONDIDA")
const emAberto = (l: any) => sols(l).filter((s: any) => s.status !== "RESPONDIDA" && s.status !== "CANCELADA")
const atrasadas = (l: any) =>
  emAberto(l).filter((s: any) => s.previsaoRetorno && new Date(s.previsaoRetorno) < new Date())

/** Prazo médio real: do envio até a última movimentação das respondidas. */
function prazoMedio(l: any): number | null {
  const r = respondidas(l).filter((s: any) => s.dataEnvio && s.updatedAt)
  if (!r.length) return null
  const soma = r.reduce((acc: number, s: any) =>
    acc + Math.max(0, (new Date(s.updatedAt).getTime() - new Date(s.dataEnvio).getTime()) / 86_400_000), 0)
  return Math.round(soma / r.length)
}

const SO_FORNECEDOR = { funcoes: { has: "FORNECEDOR" as never } }

export const DOMINIO_FORNECEDORES: DominioDef = {
  key: "fornecedores",
  rotulo: "Fornecedores",
  descricao: "Quem executa serviços para a operação: volume, entregas, pendências, prazo e custo.",
  grain: "1 linha = 1 fornecedor (a mesma organização de Órgãos, recortada pela função)",
  permissao: "usuarios.gerenciar",
  ordem: 12,
  aceitaNacionalidade: true,
  ondeNacionalidade: (countryKey) => ({
    solicitacaoDocumentos: { some: { documento: { pessoa: { arvore: { processos: { some: { paisCanonico: { countryKey } } } } } } } },
  }),

  filtros: [
    { key: "nome", rotulo: "Nome", tipo: "texto", paraWhere: contem("name") },
    { key: "pais", rotulo: "País do fornecedor", tipo: "multi_selecao", opcoes: cadastro("paises_geograficos"),
      paraWhere: emListaId("paisId") },
    { key: "tipo", rotulo: "Tipo", tipo: "multi_selecao", opcoes: cadastro("tipos_de_orgao"), paraWhere: emLista("type") },
    { key: "ativo", rotulo: "Ativo", tipo: "booleano", paraWhere: (v) => (v.tipo === "booleano" ? { ativo: v.valor } : null) },
    { key: "com_solicitacao", rotulo: "Já recebeu solicitação", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { solicitacaoDocumentos: { some: {} } } : { solicitacaoDocumentos: { none: {} } }) },
    { key: "com_pendencia", rotulo: "Com solicitação em aberto", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" || !v.valor ? null
        : { solicitacaoDocumentos: { some: { status: { notIn: ["RESPONDIDA", "CANCELADA"] } } } }) },
    { key: "com_atraso", rotulo: "Com retorno vencido", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" || !v.valor ? null
        : { solicitacaoDocumentos: { some: { previsaoRetorno: { lt: new Date() }, status: { notIn: ["RESPONDIDA", "CANCELADA"] } } } }) },
  ],

  agrupamentos: [
    porCampo("pais", "País", (l) => l.pais?.countryLabel),
    porCampo("tipo", "Tipo", (l) => l.type),
    porCampo("desempenho", "Situação das entregas", (l) =>
      atrasadas(l).length ? "Com atraso" : emAberto(l).length ? "Com pendência" : sols(l).length ? "Em dia" : "Sem histórico"),
  ],

  colunas: [
    { key: "nome", rotulo: "Fornecedor", valor: (l) => l.name,
      link: (l) => `/administrator?screen=organs&orgaoId=${l.id}` },
    { key: "codigo", rotulo: "Código", valor: (l) => l.publicCode ?? `#${l.id}` },
    { key: "tipo", rotulo: "Tipo", valor: (l) => l.type ?? null },
    { key: "pais", rotulo: "País", valor: (l) => l.pais?.countryLabel ?? null },
    { key: "cidade", rotulo: "Cidade", valor: (l) => l.city ?? null },
    { key: "solicitacoes", rotulo: "Solicitações", valor: (l) => sols(l).length, alinhamento: "direita", somavel: true },
    { key: "respondidas", rotulo: "Respondidas", valor: (l) => respondidas(l).length, alinhamento: "direita", somavel: true },
    { key: "em_aberto", rotulo: "Em aberto", valor: (l) => emAberto(l).length, alinhamento: "direita", somavel: true },
    { key: "atrasadas", rotulo: "Com retorno vencido", valor: (l) => atrasadas(l).length, alinhamento: "direita", somavel: true },
    { key: "prazo_medio", rotulo: "Prazo médio (dias)", valor: prazoMedio, alinhamento: "direita" },
    { key: "custo_total", rotulo: "Custo pago",
      valor: (l) => { const t = sols(l).reduce((a: number, s: any) => a + (s.custoPago ? Number(s.custoPago) : 0), 0)
        return t || null }, alinhamento: "direita", somavel: true },
    { key: "protocolos", rotulo: "Protocolos", valor: (l) => l._count?.protocolos ?? 0, alinhamento: "direita", somavel: true },
    { key: "documentos", rotulo: "Documentos emitidos", valor: (l) => l._count?.documentosEmitidos ?? 0, alinhamento: "direita", somavel: true },
    { key: "prazo_acordado", rotulo: "Prazo acordado (dias)", valor: (l) => l.prazoPagamentoDias ?? null, alinhamento: "direita" },
    { key: "status_financeiro", rotulo: "Situação financeira", valor: (l) => l.statusFinanceiro ?? null },
    { key: "ativo", rotulo: "Ativo", valor: (l) => (l.ativo ? "sim" : "não") },
    { key: "criado", rotulo: "Cadastrado em", valor: (l) => dataBR(l.criadoEm) },
  ],

  ordenacoes: [
    { key: "nome", rotulo: "Nome", orderBy: (d) => [{ name: d }] },
    { key: "criado", rotulo: "Cadastro", orderBy: (d) => [{ criadoEm: d }, { id: d }] },
  ],

  colunasIniciais: ["nome", "tipo", "pais", "solicitacoes", "respondidas", "em_aberto", "atrasadas", "prazo_medio"],
  ordenacaoPadrao: { key: "nome", direcao: "asc" },

  contar: (where) => prisma.orgaoProtocolo.count({ where: { AND: [where, SO_FORNECEDOR] } }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.orgaoProtocolo.findMany({ where: { AND: [where, SO_FORNECEDOR] }, orderBy, skip: pular, take: levar, include: INCLUDE }),

  visoesDoSistema: [
    { key: "com-atraso", nome: "Com retorno vencido",
      spec: { filtros: [{ key: "com_atraso", valor: { tipo: "booleano", valor: true } }] } },
    { key: "com-pendencia", nome: "Com solicitação em aberto",
      spec: { filtros: [{ key: "com_pendencia", valor: { tipo: "booleano", valor: true } }] } },
    { key: "sem-uso", nome: "Cadastrados sem nenhuma solicitação",
      spec: { filtros: [{ key: "com_solicitacao", valor: { tipo: "booleano", valor: false } }] } },
    { key: "por-pais", nome: "Por país", spec: { filtros: [], agruparPor: "pais" } },
  ],
}
