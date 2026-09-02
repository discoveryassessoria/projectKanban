// DOMÍNIO ÓRGÃOS E ORGANIZAÇÕES — 1 linha = 1 organização.
//
// A organização é ÚNICA e acumula funções: o mesmo cartório é ÓRGÃO (recebe
// protocolo) e FORNECEDOR (cobra emolumento). Classificar nunca cria cadastro
// novo — por isso função é filtro, não domínio separado.
//
// O PAÍS AQUI É GEOGRAFIA. O Consolato d'Italia em Miami fica nos Estados
// Unidos e atende cidadania italiana. Filtrar Relatórios por nacionalidade
// Itália não pode esconder esse órgão — por isso o recorte de nacionalidade
// deste domínio passa pelos PROTOCOLOS que o órgão recebeu, não pelo país dele.

import { prisma } from "@/lib/prisma"
import type { DominioDef } from "../tipos"
import { cadastro, contem, dataBR, emLista, emListaId, porCampo } from "./_comuns"

const INCLUDE = {
  pais: { select: { id: true, countryKey: true, countryLabel: true } },
  categorias: { select: { categoria: { select: { nome: true } } } },
  _count: { select: { protocolos: true, solicitacaoDocumentos: true, documentosEmitidos: true, canais: true } },
} as const

export const DOMINIO_ORGAOS: DominioDef = {
  key: "orgaos",
  rotulo: "Órgãos e Organizações",
  descricao: "Tribunais, consulados, comunes, cartórios e demais organizações — com o volume que passou por elas.",
  grain: "1 linha = 1 organização",
  permissao: "usuarios.gerenciar",
  ordem: 14,
  aceitaNacionalidade: true,
  // Pela nacionalidade dos PROCESSOS que protocolaram aqui — não pelo país do
  // órgão. É o que permite ver o consulado italiano em Miami sob "Itália".
  ondeNacionalidade: (countryKey) => ({
    protocolos: { some: { processo: { paisCanonico: { countryKey } } } },
  }),

  filtros: [
    { key: "nome", rotulo: "Nome", tipo: "texto", paraWhere: contem("name") },
    { key: "tipo", rotulo: "Tipo de órgão", tipo: "multi_selecao", opcoes: cadastro("tipos_de_orgao"),
      paraWhere: emLista("type") },
    { key: "pais", rotulo: "País do órgão", descricao: "GEOGRAFIA: onde a organização fica.",
      tipo: "multi_selecao", opcoes: cadastro("paises_geograficos"), paraWhere: emListaId("paisId") },
    { key: "funcao", rotulo: "Função", descricao: "A mesma organização pode ter várias.",
      tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: [
        { valor: "ORGAO", rotulo: "Órgão" }, { valor: "FORNECEDOR", rotulo: "Fornecedor" },
        { valor: "PARCEIRO", rotulo: "Parceiro" }, { valor: "CORRESPONDENTE", rotulo: "Correspondente" },
        { valor: "CLIENTE_CORPORATIVO", rotulo: "Cliente corporativo" },
      ] },
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length ? { funcoes: { hasSome: v.valores as never } } : null) },
    { key: "cidade", rotulo: "Cidade", tipo: "texto", paraWhere: contem("city") },
    { key: "estado", rotulo: "Estado / Região", tipo: "texto", paraWhere: contem("state") },
    { key: "ativo", rotulo: "Ativo", tipo: "booleano",
      paraWhere: (v) => (v.tipo === "booleano" ? { ativo: v.valor } : null) },
    { key: "com_protocolo", rotulo: "Recebeu algum protocolo", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { protocolos: { some: {} } } : { protocolos: { none: {} } }) },
    { key: "sem_pais", rotulo: "Sem país cadastrado",
      descricao: "Cadastro incompleto: contraria a regra de que tudo referencia o Cadastro Mestre.",
      tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { paisId: null } : { paisId: { not: null } }) },
    { key: "sem_codigo", rotulo: "Sem código público", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { publicCode: null } : { publicCode: { not: null } }) },
  ],

  agrupamentos: [
    porCampo("pais", "País do órgão", (l) => l.pais?.countryLabel),
    porCampo("tipo", "Tipo", (l) => l.type),
    porCampo("cidade", "Cidade", (l) => l.city),
    porCampo("situacao", "Situação", (l) => (l.ativo ? "Ativo" : "Inativo")),
  ],

  colunas: [
    { key: "codigo", rotulo: "Código", valor: (l) => l.publicCode ?? `#${l.id}` },
    { key: "nome", rotulo: "Nome oficial", valor: (l) => l.name,
      link: (l) => `/administrator?screen=organs&orgaoId=${l.id}` },
    { key: "fantasia", rotulo: "Nome fantasia", valor: (l) => l.nomeFantasia ?? null },
    { key: "tipo", rotulo: "Tipo", valor: (l) => l.type ?? null },
    { key: "funcoes", rotulo: "Funções", valor: (l) => (l.funcoes ?? []).join(" · ") || null },
    { key: "categorias", rotulo: "Categorias",
      valor: (l) => (l.categorias ?? []).map((c: any) => c.categoria?.nome).filter(Boolean).join(" · ") || null },
    { key: "pais", rotulo: "País do órgão", valor: (l) => l.pais?.countryLabel ?? null },
    { key: "cidade", rotulo: "Cidade", valor: (l) => l.city ?? null },
    { key: "estado", rotulo: "Estado / Região", valor: (l) => l.state ?? null },
    { key: "provincia", rotulo: "Província", valor: (l) => l.provincia ?? null },
    { key: "protocolos", rotulo: "Protocolos recebidos", valor: (l) => l._count?.protocolos ?? 0, alinhamento: "direita", somavel: true },
    { key: "solicitacoes", rotulo: "Solicitações", valor: (l) => l._count?.solicitacaoDocumentos ?? 0, alinhamento: "direita", somavel: true },
    { key: "documentos", rotulo: "Documentos emitidos", valor: (l) => l._count?.documentosEmitidos ?? 0, alinhamento: "direita", somavel: true },
    { key: "canais", rotulo: "Canais", valor: (l) => l._count?.canais ?? 0, alinhamento: "direita" },
    { key: "email", rotulo: "E-mail", valor: (l) => l.email ?? null },
    { key: "telefone", rotulo: "Telefone", valor: (l) => l.telefone ?? null },
    { key: "site", rotulo: "Site", valor: (l) => l.site ?? null, link: (l) => l.site ?? null },
    { key: "idioma", rotulo: "Idioma", valor: (l) => l.idioma ?? null },
    { key: "ativo", rotulo: "Situação", valor: (l) => (l.ativo ? "Ativo" : "Inativo") },
    { key: "criado", rotulo: "Cadastrado em", valor: (l) => dataBR(l.criadoEm) },
  ],

  ordenacoes: [
    { key: "nome", rotulo: "Nome", orderBy: (d) => [{ name: d }] },
    { key: "pais", rotulo: "País", orderBy: (d) => [{ pais: { countryLabel: d } }, { name: "asc" as const }] },
    { key: "criado", rotulo: "Cadastro", orderBy: (d) => [{ criadoEm: d }, { id: d }] },
  ],

  filtrosPrincipais: ["nome", "tipo", "pais"],
  colunasIniciais: ["codigo", "nome", "tipo", "funcoes", "pais", "cidade", "protocolos", "ativo"],
  ordenacaoPadrao: { key: "nome", direcao: "asc" },

  contar: (where) => prisma.orgaoProtocolo.count({ where }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.orgaoProtocolo.findMany({ where, orderBy, skip: pular, take: levar, include: INCLUDE }),

  visoesDoSistema: [
    { key: "com-protocolo", nome: "Que já receberam protocolo",
      spec: { filtros: [{ key: "com_protocolo", valor: { tipo: "booleano", valor: true } }] } },
    { key: "fornecedores", nome: "Com função de fornecedor",
      spec: { filtros: [{ key: "funcao", valor: { tipo: "multi_selecao", valores: ["FORNECEDOR"] } }] } },
    { key: "sem-pais", nome: "Cadastro incompleto — sem país",
      spec: { filtros: [{ key: "sem_pais", valor: { tipo: "booleano", valor: true } }] } },
    { key: "por-pais", nome: "Por país do órgão", spec: { filtros: [], agruparPor: "pais" } },
    { key: "por-tipo", nome: "Por tipo", spec: { filtros: [], agruparPor: "tipo" } },
  ],
}
