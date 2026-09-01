// DOMÍNIO SERVIÇOS E PREÇOS — 1 linha = 1 preço vigente do Cadastro Mestre.
//
// NÃO CRIA PREÇO. A Tabela de Preços é a fonte única; aqui ela é LIDA. A linha é
// a entrada de preço porque é ela que carrega vigência, moeda, modo de cálculo e
// fornecedor — e é onde o override de um processo aparece como outra linha, com
// `processoId` preenchido, em vez de virar um número mágico numa célula.
//
// A cadeia preço canônico → override → valor efetivo é resolvida pelo motor
// financeiro na hora do lançamento. Aqui as duas pontas ficam visíveis lado a
// lado, para conferir — nunca recalculadas.

import { prisma } from "@/lib/prisma"
import type { DominioDef } from "../tipos"
import { cadastro, contem, emLista, emListaId, igualId, porCampo } from "./_comuns"

const INCLUDE = {
  itemCatalogo: { select: { id: true, name: true, code: true, natureza: true, categoria: { select: { nome: true } } } },
  fornecedor: { select: { id: true, nome: true } },
  modalidade: { select: { modalityKey: true, modalityLabel: true, pais: { select: { countryLabel: true, countryKey: true } } } },
} as const

export const DOMINIO_SERVICOS: DominioDef = {
  key: "servicos",
  rotulo: "Serviços e Preços",
  descricao: "O que a operação usa e quanto custa: item, modalidade, vigência, fornecedor e overrides.",
  grain: "1 linha = 1 preço cadastrado (override de processo aparece como linha própria)",
  permissao: "financeiro.ver",
  ordem: 13,
  aceitaNacionalidade: true,
  // O preço é de uma MODALIDADE, e a modalidade é de um país. É por aí que o
  // recorte anda — não por um campo de país no preço, que não existe.
  ondeNacionalidade: (countryKey) => ({ modalidade: { pais: { countryKey } } }),

  filtros: [
    { key: "nome", rotulo: "Nome do preço", tipo: "texto", paraWhere: contem("name") },
    { key: "item", rotulo: "Item do catálogo", tipo: "multi_selecao", opcoes: cadastro("itens_documentais"),
      paraWhere: emListaId("itemCatalogoId") },
    { key: "natureza", rotulo: "Natureza", descricao: "Custo é o que se paga; receita é o que se cobra.",
      tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: [
        { valor: "CUSTO", rotulo: "Custo" }, { valor: "RECEITA", rotulo: "Receita" } ] },
      paraWhere: emLista("natureza") },
    { key: "moeda", rotulo: "Moeda", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: [
        { valor: "BRL", rotulo: "BRL" }, { valor: "EUR", rotulo: "EUR" }, { valor: "USD", rotulo: "USD" } ] },
      paraWhere: emLista("moeda") },
    { key: "modo", rotulo: "Modo de cálculo", tipo: "texto", paraWhere: contem("modoCalculo") },
    { key: "fornecedor", rotulo: "Fornecedor", tipo: "entidade", opcoes: cadastro("fornecedores"),
      paraWhere: igualId("fornecedorId") },
    { key: "override", rotulo: "É override de um processo",
      descricao: "Preço específico de um processo, acima do canônico.", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { processoId: { not: null } } : { processoId: null }) },
    { key: "arquivado", rotulo: "Arquivado", tipo: "booleano",
      paraWhere: (v) => (v.tipo === "booleano" ? { arquivado: v.valor } : null) },
    { key: "sem_item", rotulo: "Sem item canônico vinculado",
      descricao: "Preço solto: não referencia o Cadastro Mestre.", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { itemCatalogoId: null } : { itemCatalogoId: { not: null } }) },
  ],

  agrupamentos: [
    porCampo("item", "Item", (l) => l.itemCatalogo?.name),
    porCampo("categoria", "Categoria", (l) => l.itemCatalogo?.categoria?.nome),
    porCampo("natureza", "Natureza", (l) => l.natureza),
    porCampo("moeda", "Moeda", (l) => l.moeda),
    porCampo("modalidade", "Modalidade", (l) => l.modalidade?.modalityLabel),
    porCampo("nacionalidade", "Nacionalidade", (l) => l.modalidade?.pais?.countryLabel),
    porCampo("origem", "Origem do preço", (l) => (l.processoId ? "Override de processo" : "Canônico")),
  ],

  colunas: [
    { key: "nome", rotulo: "Preço", valor: (l) => l.name },
    { key: "codigo", rotulo: "Código", valor: (l) => l.publicCode ?? `#${l.id}` },
    { key: "item", rotulo: "Item", valor: (l) => l.itemCatalogo?.name ?? null },
    { key: "categoria", rotulo: "Categoria", valor: (l) => l.itemCatalogo?.categoria?.nome ?? null },
    { key: "natureza", rotulo: "Natureza", valor: (l) => l.natureza ?? null },
    { key: "valor", rotulo: "Valor", valor: (l) => (l.valor != null ? Number(l.valor) : null),
      alinhamento: "direita", somavel: true },
    { key: "valor_base", rotulo: "1º requerente", valor: (l) => (l.valorBase != null ? Number(l.valorBase) : null), alinhamento: "direita" },
    { key: "valor_adicional", rotulo: "Adicional", valor: (l) => (l.valorAdicional != null ? Number(l.valorAdicional) : null), alinhamento: "direita" },
    { key: "moeda", rotulo: "Moeda", valor: (l) => l.moeda },
    { key: "modo", rotulo: "Modo de cálculo", valor: (l) => l.modoCalculo },
    { key: "unidade", rotulo: "Unidade", valor: (l) => l.unidade ?? null },
    { key: "modalidade", rotulo: "Modalidade", valor: (l) => l.modalidade?.modalityLabel ?? null },
    { key: "nacionalidade", rotulo: "Nacionalidade", valor: (l) => l.modalidade?.pais?.countryLabel ?? null },
    { key: "fornecedor", rotulo: "Fornecedor", valor: (l) => l.fornecedor?.nome ?? null },
    { key: "vigencia", rotulo: "Vigência",
      valor: (l) => [l.vigenciaInicio, l.vigenciaFim].filter(Boolean).join(" até ") || "sem vigência declarada" },
    { key: "origem", rotulo: "Origem", valor: (l) => (l.processoId ? `Override do processo #${l.processoId}` : "Canônico"),
      link: (l) => (l.processoId ? `/processos/${l.processoId}` : null) },
    { key: "prioridade", rotulo: "Prioridade", valor: (l) => l.prioridade, alinhamento: "direita" },
    { key: "arquivado", rotulo: "Arquivado", valor: (l) => (l.arquivado ? "sim" : "não") },
  ],

  ordenacoes: [
    { key: "nome", rotulo: "Nome", orderBy: (d) => [{ name: d }] },
    { key: "valor", rotulo: "Valor", orderBy: (d) => [{ valor: d }, { id: "desc" as const }] },
    { key: "criado", rotulo: "Cadastro", orderBy: (d) => [{ criadoEm: d }, { id: d }] },
  ],

  colunasIniciais: ["nome", "item", "natureza", "valor", "moeda", "modo", "modalidade", "vigencia", "origem"],
  ordenacaoPadrao: { key: "nome", direcao: "asc" },

  contar: (where) => prisma.tabelaValor.count({ where }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.tabelaValor.findMany({ where, orderBy, skip: pular, take: levar, include: INCLUDE }),

  visoesDoSistema: [
    { key: "vigentes", nome: "Vigentes (não arquivados)",
      spec: { filtros: [{ key: "arquivado", valor: { tipo: "booleano", valor: false } }] } },
    { key: "overrides", nome: "Overrides de processo",
      spec: { filtros: [{ key: "override", valor: { tipo: "booleano", valor: true } }] } },
    { key: "sem-item", nome: "Sem item canônico — cadastro incompleto",
      spec: { filtros: [{ key: "sem_item", valor: { tipo: "booleano", valor: true } }] } },
    { key: "por-item", nome: "Por item", spec: { filtros: [], agruparPor: "item" } },
    { key: "por-natureza", nome: "Custo × receita", spec: { filtros: [], agruparPor: "natureza" } },
  ],
}
