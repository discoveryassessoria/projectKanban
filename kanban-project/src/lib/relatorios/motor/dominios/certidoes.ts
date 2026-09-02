// DOMÍNIO CERTIDÕES — 1 linha = 1 necessidade documental de registro civil.
//
// ─── O QUE SEPARA CERTIDÃO DE DOCUMENTO ─────────────────────────────────────
// A separação NÃO é pelo nome do documento. Ela vem da CATEGORIA DOCUMENTAL do
// Cadastro Mestre: o tipo documental pertence a uma categoria, e "Registro
// Civil" é a das certidões. Se amanhã o cadastro mudar a categoria de um tipo,
// ele muda de domínio sozinho — nenhuma linha aqui precisa ser tocada.
//
// Nascimento, casamento e óbito são TIPOS dentro deste domínio, não relatórios
// diferentes. "Certidões faltantes" é este domínio com status PENDENTE.
//
// A unidade é a NECESSIDADE — o que a regra documental disse que precisa
// existir. É ela que permite responder "o que falta", que é a pergunta real; o
// documento entregue é uma das colunas.

import { prisma } from "@/lib/prisma"
import type { DominioDef } from "../tipos"
import { cadastro, contem, dataBR, diasEntre, emLista, emListaId, igualId, periodo, porCampo } from "./_comuns"

/** A categoria que define "certidão" — do Cadastro Mestre, não do nome. */
export const CATEGORIA_CERTIDAO = "REGISTRO_CIVIL"

const STATUS = ["PENDENTE", "EM_ATENDIMENTO", "ATENDIDA", "NAO_LOCALIZADA", "DISPENSADA"] as const

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
      id: true, status: true, cartorio: true, data_emissao: true, traduzido: true, apostilado: true,
      orgao: { select: { id: true, name: true, pais: { select: { countryLabel: true } } } },
      solicitacoes: {
        select: {
          id: true, status: true, dataEnvio: true, previsaoRetorno: true, custoPago: true,
          canal: true, orgao: { select: { name: true } }, criadoPor: { select: { nome: true } },
        },
        orderBy: { id: "desc" as const }, take: 1,
      },
    },
    take: 1,
  },
} as const

const doc = (l: any) => l.documentos?.[0] ?? null
const sol = (l: any) => doc(l)?.solicitacoes?.[0] ?? null

/** Só necessidades cujo item pertence à categoria de registro civil. */
const SO_CERTIDAO = {
  itemCatalogo: { tiposDocumento: { some: { categoriaDocumental: { code: CATEGORIA_CERTIDAO } } } },
}

export const DOMINIO_CERTIDOES: DominioDef = {
  key: "certidoes",
  rotulo: "Certidões",
  descricao: "Nascimento, casamento e óbito: o que precisa existir, o que foi solicitado e o que chegou.",
  grain: "1 linha = 1 certidão necessária (a necessidade, não o pedido)",
  permissao: "processos.ver",
  ordem: 5,
  grupo: "Documentação",
  aceitaNacionalidade: true,
  ondeNacionalidade: (countryKey) => ({ processo: { paisCanonico: { countryKey } } }),

  filtros: [
    { key: "tipo", rotulo: "Tipo de certidão",
      descricao: "Só registro civil — a mesma categoria do Cadastro Mestre que define este domínio.",
      tipo: "multi_selecao", opcoes: cadastro("itens_certidao"), paraWhere: emListaId("itemCatalogoId") },
    { key: "status", rotulo: "Situação", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: STATUS.map((s) => ({ valor: s, rotulo: s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") })) },
      paraWhere: emLista("status") },
    { key: "obrigatoriedade", rotulo: "Obrigatoriedade", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: [
        { valor: "OBRIGATORIA", rotulo: "Obrigatória" }, { valor: "OPCIONAL", rotulo: "Opcional" } ] },
      paraWhere: emLista("obrigatoriedade") },
    { key: "processo", rotulo: "Processo", tipo: "entidade", opcoes: cadastro("processos"), paraWhere: igualId("processoId") },
    { key: "familia", rotulo: "Família", tipo: "entidade", opcoes: cadastro("familias"),
      paraWhere: (v) => (v.tipo === "entidade" ? { processo: { familiaId: v.id } } : null) },
    { key: "orgao_emissor", rotulo: "Órgão emissor (cartório/comune)", tipo: "entidade", opcoes: cadastro("orgaos"),
      paraWhere: (v) => (v.tipo === "entidade" ? { documentos: { some: { orgaoId: v.id } } } : null) },
    { key: "orgao_pais", rotulo: "País do emissor", tipo: "multi_selecao", opcoes: cadastro("paises_geograficos"),
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length
        ? { documentos: { some: { orgao: { paisId: { in: v.valores.map(Number).filter(Number.isInteger) } } } } } : null) },
    { key: "solicitada", rotulo: "Já solicitada", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { documentos: { some: { solicitacoes: { some: {} } } } }
        : { documentos: { none: { solicitacoes: { some: {} } } } }) },
    { key: "periodo_solicitacao", rotulo: "Período da solicitação", tipo: "intervalo_data",
      paraWhere: (v) => {
        const p = periodo("dataEnvio", v)
        return p ? { documentos: { some: { solicitacoes: { some: p } } } } : null
      } },
    { key: "atrasada", rotulo: "Solicitação com retorno vencido", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" || !v.valor ? null
        : { documentos: { some: { solicitacoes: { some: { previsaoRetorno: { lt: new Date() }, status: { not: "RESPONDIDA" } } } } } }) },
    { key: "canal", rotulo: "Canal da solicitação", tipo: "multi_selecao", opcoes: cadastro("canais"),
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length
        ? { documentos: { some: { solicitacoes: { some: { canal: { in: v.valores as never } } } } } } : null) },
    { key: "pessoa", rotulo: "Pessoa (nome contém)", tipo: "texto",
      paraWhere: (v) => (v.tipo === "texto" && v.texto.trim() ? { pessoa: { nome: { contains: v.texto.trim(), mode: "insensitive" } } } : null) },
  ],

  agrupamentos: [
    porCampo("tipo", "Tipo de certidão", (l) => l.itemCatalogo?.name),
    porCampo("status", "Situação", (l) => l.status),
    porCampo("familia", "Família", (l) => l.processo?.familia?.nome),
    porCampo("nacionalidade", "Nacionalidade", (l) => l.processo?.paisCanonico?.countryLabel),
    porCampo("orgao", "Órgão emissor", (l) => doc(l)?.orgao?.name),
    porCampo("orgao_pais", "País do emissor", (l) => doc(l)?.orgao?.pais?.countryLabel),
    porCampo("pessoa", "Pessoa", (l) => (l.pessoa ? `${l.pessoa.nome} ${l.pessoa.sobrenome ?? ""}`.trim() : null)),
  ],

  colunas: [
    { key: "tipo", rotulo: "Certidão", valor: (l) => l.itemCatalogo?.name ?? null },
    { key: "status", rotulo: "Situação", valor: (l) => l.status },
    { key: "obrigatoriedade", rotulo: "Obrigatoriedade", valor: (l) => l.obrigatoriedade },
    { key: "pessoa", rotulo: "Pessoa", valor: (l) => (l.pessoa ? `${l.pessoa.nome} ${l.pessoa.sobrenome ?? ""}`.trim() : null),
      link: (l) => (l.pessoa?.arvoreId ? `/genealogy?arvoreId=${l.pessoa.arvoreId}&pessoaId=${l.pessoa.id}` : null) },
    { key: "familia", rotulo: "Família", valor: (l) => l.processo?.familia?.nome ?? null },
    { key: "processo", rotulo: "Processo",
      valor: (l) => (l.processo ? `${l.processo.codigo ?? l.processo.id} — ${l.processo.nome}` : null),
      link: (l) => (l.processo ? `/processos/${l.processo.id}` : null) },
    { key: "nacionalidade", rotulo: "Nacionalidade", valor: (l) => l.processo?.paisCanonico?.countryLabel ?? null },
    { key: "orgao", rotulo: "Órgão emissor", valor: (l) => doc(l)?.orgao?.name ?? doc(l)?.cartorio ?? null },
    { key: "orgao_pais", rotulo: "País do emissor", valor: (l) => doc(l)?.orgao?.pais?.countryLabel ?? null },
    { key: "canal", rotulo: "Canal", valor: (l) => sol(l)?.canal ?? null },
    { key: "solicitada_em", rotulo: "Solicitada em", valor: (l) => dataBR(sol(l)?.dataEnvio) },
    { key: "previsao", rotulo: "Previsão de retorno", valor: (l) => dataBR(sol(l)?.previsaoRetorno) },
    { key: "atraso_dias", rotulo: "Atraso (dias)",
      valor: (l) => { const s = sol(l); if (!s?.previsaoRetorno || s.status === "RESPONDIDA") return null
        const d = diasEntre(s.previsaoRetorno); return d != null && d > 0 ? d : null }, alinhamento: "direita" },
    { key: "situacao_solicitacao", rotulo: "Situação da solicitação", valor: (l) => sol(l)?.status ?? null },
    { key: "custo", rotulo: "Custo pago", valor: (l) => (sol(l)?.custoPago != null ? Number(sol(l).custoPago) : null),
      alinhamento: "direita", somavel: true },
    { key: "responsavel", rotulo: "Solicitada por", valor: (l) => sol(l)?.criadoPor?.nome ?? null },
    { key: "emissao", rotulo: "Data de emissão", valor: (l) => dataBR(doc(l)?.data_emissao) },
    { key: "traduzida", rotulo: "Traduzida", valor: (l) => (doc(l) ? (doc(l).traduzido ? "sim" : "não") : null) },
    { key: "apostilada", rotulo: "Apostilada", valor: (l) => (doc(l) ? (doc(l).apostilado ? "sim" : "não") : null) },
    { key: "motivo", rotulo: "Por que é exigida", valor: (l) => l.motivoAplicabilidade ?? null },
    { key: "fase", rotulo: "Fase do processo", valor: (l) => l.processo?.faseAtualKey ?? null },
  ],

  ordenacoes: [
    { key: "criacao", rotulo: "Criação da necessidade", orderBy: (d) => [{ createdAt: d }, { id: d }] },
    { key: "status", rotulo: "Situação", orderBy: (d) => [{ status: d }, { id: "desc" as const }] },
  ],

  filtrosPrincipais: ["status", "tipo", "periodo_solicitacao", "orgao_emissor"],
  colunasIniciais: ["tipo", "status", "pessoa", "familia", "processo", "orgao", "solicitada_em", "atraso_dias"],
  ordenacaoPadrao: { key: "criacao", direcao: "desc" },

  contar: (where) => prisma.necessidadeDocumental.count({ where: { AND: [where, SO_CERTIDAO, { supersedePorId: null }] } }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.necessidadeDocumental.findMany({
      where: { AND: [where, SO_CERTIDAO, { supersedePorId: null }] },
      orderBy, skip: pular, take: levar, include: INCLUDE,
    }),

  visoesDoSistema: [
    { key: "faltantes", nome: "Certidões faltantes",
      spec: { filtros: [{ key: "status", valor: { tipo: "multi_selecao", valores: ["PENDENTE"] } }] } },
    { key: "em-atendimento", nome: "Em atendimento",
      spec: { filtros: [{ key: "status", valor: { tipo: "multi_selecao", valores: ["EM_ATENDIMENTO"] } }] } },
    { key: "nao-localizadas", nome: "Não localizadas",
      spec: { filtros: [{ key: "status", valor: { tipo: "multi_selecao", valores: ["NAO_LOCALIZADA"] } }] } },
    { key: "atrasadas", nome: "Com retorno vencido",
      spec: { filtros: [{ key: "atrasada", valor: { tipo: "booleano", valor: true } }] } },
    { key: "nao-solicitadas", nome: "Pendentes ainda não solicitadas",
      spec: { filtros: [
        { key: "status", valor: { tipo: "multi_selecao", valores: ["PENDENTE"] } },
        { key: "solicitada", valor: { tipo: "booleano", valor: false } },
      ] } },
    { key: "por-orgao", nome: "Por órgão emissor", spec: { filtros: [], agruparPor: "orgao" } },
    { key: "por-familia", nome: "Por família", spec: { filtros: [], agruparPor: "familia" } },
  ],
}
