// DOMÍNIO DOCUMENTOS — 1 linha = 1 necessidade documental que NÃO é certidão.
//
// RG, CNH, procuração, comprovante: tudo que o processo exige e não é registro
// civil. A fronteira com Certidões é a mesma e única — a CATEGORIA DOCUMENTAL
// do Cadastro Mestre. Aqui ela é excluída; lá, exigida. Não existe lista de
// nomes em lugar nenhum, e um tipo reclassificado no cadastro troca de domínio
// sozinho.
//
// Tradução, apostilamento e validade são atributos do documento entregue, e por
// isso aparecem como coluna e filtro — mas a linha continua sendo a NECESSIDADE,
// porque a pergunta que importa é "o que falta", não "o que já temos".

import { prisma } from "@/lib/prisma"
import type { DominioDef } from "../tipos"
import { cadastro, dataBR, emLista, emListaId, igualId, periodo, porCampo } from "./_comuns"
import { CATEGORIA_CERTIDAO } from "./certidoes"

const STATUS_NEC = ["PENDENTE", "EM_ATENDIMENTO", "ATENDIDA", "NAO_LOCALIZADA", "DISPENSADA"] as const

const INCLUDE = {
  itemCatalogo: {
    select: {
      id: true, code: true, name: true,
      tiposDocumento: { select: { name: true, categoriaDocumental: { select: { code: true, name: true } } } },
    },
  },
  pessoa: { select: { id: true, nome: true, sobrenome: true, arvoreId: true } },
  processo: {
    select: {
      id: true, codigo: true, nome: true, faseAtualKey: true,
      paisCanonico: { select: { countryKey: true, countryLabel: true } },
      familia: { select: { id: true, nome: true } },
    },
  },
  documentos: {
    select: {
      id: true, status: true, numero: true, data_emissao: true, data_validade: true,
      traduzido: true, apostilado: true, arquivo_url: true,
      documentType: { select: { name: true, categoriaDocumental: { select: { code: true, name: true } } } },
      orgao: { select: { name: true, pais: { select: { countryLabel: true } } } },
    },
    take: 1,
  },
} as const

const doc = (l: any) => l.documentos?.[0] ?? null
const vencido = (l: any) => {
  const d = doc(l)?.data_validade
  return !!d && new Date(d) < new Date()
}

/** Tudo que NÃO é registro civil. A fronteira é cadastro, não nome. */
const NAO_CERTIDAO = {
  NOT: { itemCatalogo: { tiposDocumento: { some: { categoriaDocumental: { code: CATEGORIA_CERTIDAO } } } } },
}

export const DOMINIO_DOCUMENTOS: DominioDef = {
  key: "documentos",
  rotulo: "Documentos",
  descricao: "Os demais documentos exigidos: identidade, procurações, comprovantes — existência, validade e tratamentos.",
  grain: "1 linha = 1 necessidade documental (excluídas as certidões)",
  permissao: "processos.ver",
  ordem: 6,
  grupo: "Documentação",
  aceitaNacionalidade: true,
  ondeNacionalidade: (countryKey) => ({ processo: { paisCanonico: { countryKey } } }),

  filtros: [
    { key: "tipo", rotulo: "Tipo documental", tipo: "multi_selecao", opcoes: cadastro("itens_documentais"),
      paraWhere: emListaId("itemCatalogoId") },
    { key: "categoria", rotulo: "Categoria documental", tipo: "multi_selecao", opcoes: cadastro("categorias_documentais"),
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length
        ? { itemCatalogo: { tiposDocumento: { some: { categoriaDocumental: { code: { in: v.valores } } } } } } : null) },
    { key: "status", rotulo: "Situação da necessidade", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: STATUS_NEC.map((s) => ({ valor: s, rotulo: s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") })) },
      paraWhere: emLista("status") },
    { key: "obrigatoriedade", rotulo: "Obrigatoriedade", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: [
        { valor: "OBRIGATORIA", rotulo: "Obrigatória" }, { valor: "OPCIONAL", rotulo: "Opcional" } ] },
      paraWhere: emLista("obrigatoriedade") },
    { key: "processo", rotulo: "Processo", tipo: "entidade", opcoes: cadastro("processos"), paraWhere: igualId("processoId") },
    { key: "familia", rotulo: "Família", tipo: "entidade", opcoes: cadastro("familias"),
      paraWhere: (v) => (v.tipo === "entidade" ? { processo: { familiaId: v.id } } : null) },
    { key: "existe", rotulo: "Documento entregue", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { documentos: { some: {} } } : { documentos: { none: {} } }) },
    { key: "com_arquivo", rotulo: "Com arquivo anexado", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { documentos: { some: { arquivo_url: { not: null } } } }
        : { documentos: { none: { arquivo_url: { not: null } } } }) },
    { key: "vencido", rotulo: "Vencido", descricao: "Validade no passado.", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" || !v.valor ? null
        : { documentos: { some: { data_validade: { lt: new Date() } } } }) },
    { key: "traduzido", rotulo: "Traduzido", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : { documentos: { some: { traduzido: v.valor } } }) },
    { key: "apostilado", rotulo: "Apostilado", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : { documentos: { some: { apostilado: v.valor } } }) },
    { key: "periodo_validade", rotulo: "Período de validade", tipo: "intervalo_data",
      paraWhere: (v) => { const p = periodo("data_validade", v); return p ? { documentos: { some: p } } : null } },
    { key: "fase", rotulo: "Fase do processo", tipo: "multi_selecao", opcoes: cadastro("fases"),
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length ? { processo: { faseAtualKey: { in: v.valores } } } : null) },
  ],

  agrupamentos: [
    porCampo("tipo", "Tipo documental", (l) => l.itemCatalogo?.name),
    porCampo("categoria", "Categoria", (l) => doc(l)?.documentType?.categoriaDocumental?.name ?? l.itemCatalogo?.tiposDocumento?.[0]?.categoriaDocumental?.name),
    porCampo("status", "Situação", (l) => l.status),
    porCampo("familia", "Família", (l) => l.processo?.familia?.nome),
    porCampo("nacionalidade", "Nacionalidade", (l) => l.processo?.paisCanonico?.countryLabel),
    porCampo("tratamento", "Tratamento", (l) => {
      const d = doc(l)
      if (!d) return "Sem documento"
      if (d.apostilado) return "Apostilado"
      if (d.traduzido) return "Traduzido"
      return "Sem tratamento"
    }),
  ],

  colunas: [
    { key: "tipo", rotulo: "Documento", valor: (l) => l.itemCatalogo?.name ?? null },
    { key: "categoria", rotulo: "Categoria",
      valor: (l) => l.itemCatalogo?.tiposDocumento?.[0]?.categoriaDocumental?.name ?? null },
    { key: "status", rotulo: "Situação", valor: (l) => l.status },
    { key: "obrigatoriedade", rotulo: "Obrigatoriedade", valor: (l) => l.obrigatoriedade },
    { key: "pessoa", rotulo: "Pessoa", valor: (l) => (l.pessoa ? `${l.pessoa.nome} ${l.pessoa.sobrenome ?? ""}`.trim() : null) },
    { key: "familia", rotulo: "Família", valor: (l) => l.processo?.familia?.nome ?? null },
    { key: "processo", rotulo: "Processo",
      valor: (l) => (l.processo ? `${l.processo.codigo ?? l.processo.id} — ${l.processo.nome}` : null),
      link: (l) => (l.processo ? `/processos/${l.processo.id}` : null) },
    { key: "nacionalidade", rotulo: "Nacionalidade", valor: (l) => l.processo?.paisCanonico?.countryLabel ?? null },
    { key: "entregue", rotulo: "Entregue", valor: (l) => (doc(l) ? "sim" : "não") },
    { key: "status_documento", rotulo: "Situação do documento", valor: (l) => doc(l)?.status ?? null },
    { key: "numero", rotulo: "Número", valor: (l) => doc(l)?.numero ?? null },
    { key: "emissao", rotulo: "Emissão", valor: (l) => dataBR(doc(l)?.data_emissao) },
    { key: "validade", rotulo: "Validade", valor: (l) => dataBR(doc(l)?.data_validade) },
    { key: "vencido", rotulo: "Vencido", valor: (l) => (doc(l)?.data_validade ? (vencido(l) ? "sim" : "não") : null) },
    { key: "traduzido", rotulo: "Traduzido", valor: (l) => (doc(l) ? (doc(l).traduzido ? "sim" : "não") : null) },
    { key: "apostilado", rotulo: "Apostilado", valor: (l) => (doc(l) ? (doc(l).apostilado ? "sim" : "não") : null) },
    { key: "arquivo", rotulo: "Arquivo", valor: (l) => (doc(l)?.arquivo_url ? "anexado" : "sem arquivo") },
    { key: "orgao", rotulo: "Órgão emissor", valor: (l) => doc(l)?.orgao?.name ?? null },
    { key: "fase", rotulo: "Fase do processo", valor: (l) => l.processo?.faseAtualKey ?? null },
    { key: "motivo", rotulo: "Por que é exigido", valor: (l) => l.motivoAplicabilidade ?? null },
  ],

  ordenacoes: [
    { key: "criacao", rotulo: "Criação da necessidade", orderBy: (d) => [{ createdAt: d }, { id: d }] },
    { key: "status", rotulo: "Situação", orderBy: (d) => [{ status: d }, { id: "desc" as const }] },
  ],

  filtrosPrincipais: ["status", "tipo", "vencido"],
  colunasIniciais: ["tipo", "categoria", "status", "pessoa", "processo", "entregue", "validade", "vencido"],
  ordenacaoPadrao: { key: "criacao", direcao: "desc" },

  contar: (where) => prisma.necessidadeDocumental.count({ where: { AND: [where, NAO_CERTIDAO, { supersedePorId: null }] } }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.necessidadeDocumental.findMany({
      where: { AND: [where, NAO_CERTIDAO, { supersedePorId: null }] },
      orderBy, skip: pular, take: levar, include: INCLUDE,
    }),

  visoesDoSistema: [
    { key: "faltando", nome: "Faltando",
      spec: { filtros: [{ key: "status", valor: { tipo: "multi_selecao", valores: ["PENDENTE"] } }] } },
    { key: "vencidos", nome: "Vencidos", spec: { filtros: [{ key: "vencido", valor: { tipo: "booleano", valor: true } }] } },
    { key: "sem-arquivo", nome: "Entregues sem arquivo",
      spec: { filtros: [
        { key: "existe", valor: { tipo: "booleano", valor: true } },
        { key: "com_arquivo", valor: { tipo: "booleano", valor: false } },
      ] } },
    { key: "a-traduzir", nome: "A traduzir",
      spec: { filtros: [{ key: "traduzido", valor: { tipo: "booleano", valor: false } }] } },
    { key: "por-tipo", nome: "Por tipo", spec: { filtros: [], agruparPor: "tipo" } },
  ],
}
