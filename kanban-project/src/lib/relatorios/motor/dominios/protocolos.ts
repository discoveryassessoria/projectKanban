// src/lib/relatorios/motor/dominios/protocolos.ts
//
// DOMÍNIO PROTOCOLOS — 1 linha = 1 protocolo.
//
// ─── O GRAIN NÃO É DETALHE ──────────────────────────────────────────────────
// Um protocolo cobre N requerentes (o ricorso italiano cobre a família inteira)
// e pode ter N exigências. Se a linha fosse o requerente, "327 protocolos"
// viraria 900 e ninguém saberia por quê. A linha é o PROTOCOLO; requerentes e
// exigências entram achatados na célula.
//
// ─── DUAS DIMENSÕES DE PAÍS, E ELAS SÃO DIFERENTES ──────────────────────────
// NACIONALIDADE é do PROCESSO: a cidadania requerida. PAÍS DO ÓRGÃO é geografia:
// onde fica o consulado ou o tribunal. O Consolato d'Italia em Miami atende
// cidadania italiana e fica nos Estados Unidos — as duas coisas ao mesmo tempo,
// e as duas legítimas. Por isso são filtros separados, com fontes separadas.

import { prisma } from "@/lib/prisma"
import { FINALIDADES_DE_PROTOCOLO, SITUACOES_DE_PROTOCOLO } from "@/src/services/protocolo-canonico"
import { fimDoDia, inicioDoDia } from "../datas"
import type { DominioDef, ValorDeFiltro } from "../tipos"

const dataBR = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("pt-BR") : null

/** Catálogo FECHADO do negócio (não é cadastro): vem do módulo canônico. */
const opcoesDe = (o: Record<string, string>) =>
  Object.values(o).map((v) => ({ valor: v, rotulo: v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ") }))

/** Intervalo de datas → cláusula Prisma, com `ate` inclusivo até 23:59:59. */
function periodo(campo: string, v: ValorDeFiltro) {
  if (v.tipo !== "intervalo_data" || (!v.de && !v.ate)) return null
  return { [campo]: { ...(v.de ? { gte: inicioDoDia(v.de) } : {}), ...(v.ate ? { lte: fimDoDia(v.ate) } : {}) } }
}

const INCLUDE = {
  tipo: { select: { id: true, code: true, nome: true } },
  orgao: {
    select: {
      id: true, publicCode: true, name: true, type: true, city: true,
      paisId: true, pais: { select: { id: true, countryKey: true, countryLabel: true } },
    },
  },
  responsavel: { select: { id: true, nome: true } },
  processo: {
    select: {
      id: true, codigo: true, nome: true,
      paisCanonico: { select: { id: true, countryKey: true, countryLabel: true, flag: true } },
      familia: { select: { id: true, nome: true } },
      enquadramentoLegal: {
        select: { nome: true, modalidadeLegal: { select: { nome: true, cardinalidadeRequerimento: true } } },
      },
    },
  },
  requerentesCobertos: {
    select: { requerente: { select: { id: true, publicCode: true, nome: true } } },
    orderBy: { requerenteId: "asc" as const },
  },
  exigencias: { select: { id: true, descricao: true, prazo: true, cumpridaEm: true } },
} as const

export const DOMINIO_PROTOCOLOS: DominioDef = {
  key: "protocolos",
  rotulo: "Protocolos",
  descricao: "O que foi protocolado, em qual órgão, de qual família e quando — com o que está em exigência.",
  grain: "1 linha = 1 protocolo",

  // A UNIDADE REAL depende da cardinalidade do requerimento daquela
  // nacionalidade — que é CADASTRO (ModalidadeLegal), não país escrito no if.
  // Itália é judicial e COLETIVA: um ricorso, a família inteira, uma linha.
  // Espanha é consular e INDIVIDUAL: cinco requerentes protocolados são cinco
  // protocolos, e por isso cinco linhas. A consulta é a mesma nos dois casos;
  // o que muda é o dado, porque o protocolo espanhol JÁ nasce por pessoa.
  grainNoContexto: async (countryKey) => {
    if (!countryKey) return "1 linha = 1 protocolo"
    const modalidades = await prisma.modalidadeLegal.findMany({
      where: { ativo: true, pais: { countryKey } },
      select: { nome: true, cardinalidadeRequerimento: true },
      orderBy: { ordem: "asc" },
    })
    if (modalidades.length === 0) {
      // Sem base jurídica cadastrada não dá para afirmar a unidade. Dizer
      // "1 protocolo" seria um palpite com cara de fato.
      return "1 linha = 1 protocolo — este país ainda não tem modalidade legal cadastrada"
    }
    const cards = new Set(modalidades.map((m) => m.cardinalidadeRequerimento))
    if (cards.size === 1) {
      return cards.has("COLETIVO")
        ? "1 linha = 1 protocolo do processo — cobre os requerentes, sem multiplicá-los"
        : "1 linha = 1 protocolo individual — um por requerente"
    }
    // DUAS ROTAS NÃO É AMBIGUIDADE. A Itália tem ricorso judicial (coletivo, um
    // R.G. para a família) E via administrativa consular (individual, um
    // expediente por pessoa). As duas são legítimas e convivem: o que decide é a
    // modalidade DAQUELE processo, e a linha continua sendo o protocolo.
    const porCard = (c: string) => modalidades.filter((m) => m.cardinalidadeRequerimento === c).map((m) => m.nome)
    return `1 linha = 1 protocolo · ${porCard("COLETIVO").join(", ")} cobre a família; ` +
      `${porCard("INDIVIDUAL").join(", ")} é por requerente`
  },
  permissao: "processos.ver_paginas",
  ordem: 8,
  grupo: "Andamento",
  aceitaNacionalidade: true,

  // A nacionalidade recorta pelo PROCESSO, e por identidade: `paisCanonico` é a
  // FK do Cadastro Mestre, não a grafia do nome.
  ondeNacionalidade: (countryKey) => ({ processo: { paisCanonico: { countryKey } } }),

  filtros: [
    {
      key: "periodo_protocolo",
      rotulo: "Período do protocolo",
      descricao: "A data em que o ato foi entregue ao órgão.",
      tipo: "intervalo_data",
      paraWhere: (v) => periodo("dataProtocolo", v),
    },
    {
      key: "periodo_situacao",
      rotulo: "Período da decisão",
      descricao: "Quando a situação dada pelo órgão passou a valer.",
      tipo: "intervalo_data",
      paraWhere: (v) => periodo("situacaoEm", v),
    },
    {
      key: "orgao",
      rotulo: "Órgão",
      tipo: "entidade",
      opcoes: { tipo: "cadastro", chave: "orgaos" },
      paraWhere: (v) => (v.tipo === "entidade" ? { orgaoId: v.id } : null),
    },
    {
      key: "orgao_tipo",
      rotulo: "Tipo de órgão",
      tipo: "multi_selecao",
      opcoes: { tipo: "cadastro", chave: "tipos_de_orgao" },
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length ? { orgao: { type: { in: v.valores } } } : null),
    },
    {
      key: "orgao_pais",
      rotulo: "País do órgão",
      descricao: "GEOGRAFIA: onde o órgão fica. Não é a cidadania do processo.",
      tipo: "multi_selecao",
      opcoes: { tipo: "cadastro", chave: "paises_geograficos" },
      paraWhere: (v) =>
        v.tipo === "multi_selecao" && v.valores.length
          ? { orgao: { paisId: { in: v.valores.map(Number).filter(Number.isInteger) } } }
          : null,
    },
    {
      key: "nacionalidade",
      rotulo: "Nacionalidade do processo",
      descricao: "A cidadania requerida. Só nacionalidades OFERTADAS aparecem.",
      tipo: "multi_selecao",
      opcoes: { tipo: "cadastro", chave: "nacionalidades_ofertadas" },
      paraWhere: (v) =>
        v.tipo === "multi_selecao" && v.valores.length
          ? { processo: { paisCanonico: { countryKey: { in: v.valores } } } }
          : null,
    },
    {
      key: "familia",
      rotulo: "Família",
      tipo: "entidade",
      opcoes: { tipo: "cadastro", chave: "familias" },
      paraWhere: (v) => (v.tipo === "entidade" ? { processo: { familiaId: v.id } } : null),
    },
    {
      key: "processo",
      rotulo: "Processo",
      tipo: "entidade",
      opcoes: { tipo: "cadastro", chave: "processos" },
      paraWhere: (v) => (v.tipo === "entidade" ? { processoId: v.id } : null),
    },
    {
      key: "requerente",
      rotulo: "Requerente",
      descricao: "Atravessa o escopo: serve ao consulado (1 pessoa) e ao tribunal (a família).",
      tipo: "entidade",
      opcoes: { tipo: "cadastro", chave: "requerentes" },
      paraWhere: (v) => (v.tipo === "entidade" ? { requerentesCobertos: { some: { requerenteId: v.id } } } : null),
    },
    {
      key: "responsavel",
      rotulo: "Responsável",
      tipo: "entidade",
      opcoes: { tipo: "cadastro", chave: "usuarios" },
      paraWhere: (v) => (v.tipo === "entidade" ? { responsavelId: v.id } : null),
    },
    {
      key: "finalidade",
      rotulo: "Finalidade",
      tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: opcoesDe(FINALIDADES_DE_PROTOCOLO) },
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length ? { finalidade: { in: v.valores } } : null),
    },
    {
      key: "situacao",
      rotulo: "Situação no órgão",
      descricao: "O que o ÓRGÃO respondeu — não é a fase do nosso workflow.",
      tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: opcoesDe(SITUACOES_DE_PROTOCOLO) },
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length ? { situacao: { in: v.valores } } : null),
    },
    {
      key: "tipo_protocolo",
      rotulo: "Tipo de protocolo",
      tipo: "multi_selecao",
      opcoes: { tipo: "cadastro", chave: "tipos_de_protocolo" },
      paraWhere: (v) =>
        v.tipo === "multi_selecao" && v.valores.length
          ? { tipoProtocoloId: { in: v.valores.map(Number).filter(Number.isInteger) } }
          : null,
    },
    {
      key: "exigencia_aberta",
      rotulo: "Com exigência em aberto",
      tipo: "booleano",
      paraWhere: (v) =>
        v.tipo !== "booleano" ? null
          : v.valor ? { exigencias: { some: { cumpridaEm: null } } }
          : { exigencias: { none: { cumpridaEm: null } } },
    },
    {
      key: "sem_movimentacao_dias",
      rotulo: "Sem movimentação há (dias)",
      descricao: "Nada foi atualizado neste protocolo desde então.",
      tipo: "numero",
      paraWhere: (v) => {
        if (v.tipo !== "numero" || !Number.isFinite(v.numero)) return null
        const limite = new Date()
        limite.setDate(limite.getDate() - v.numero)
        return { updatedAt: { lt: limite } }
      },
    },
    {
      key: "numero",
      rotulo: "Número (protocolo ou processo no órgão)",
      tipo: "texto",
      paraWhere: (v) =>
        v.tipo === "texto" && v.texto.trim()
          ? {
              OR: [
                { numeroProtocolo: { contains: v.texto.trim(), mode: "insensitive" } },
                { numeroProcesso: { contains: v.texto.trim(), mode: "insensitive" } },
                { publicCode: { contains: v.texto.trim(), mode: "insensitive" } },
              ],
            }
          : null,
    },
  ],

  agrupamentos: [
    { key: "mes", rotulo: "Mês do protocolo", de: (l) => {
      if (!l.dataProtocolo) return { chave: "sem-data", rotulo: "— sem data —" }
      const d = new Date(l.dataProtocolo)
      const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      return { chave, rotulo: d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) }
    } },
    { key: "ano", rotulo: "Ano do protocolo", de: (l) => {
      if (!l.dataProtocolo) return { chave: "sem-data", rotulo: "— sem data —" }
      const a = String(new Date(l.dataProtocolo).getFullYear())
      return { chave: a, rotulo: a }
    } },
    { key: "nacionalidade", rotulo: "Nacionalidade", de: (l) => ({
      chave: l.processo?.paisCanonico?.countryKey ?? "sem",
      rotulo: l.processo?.paisCanonico?.countryLabel ?? "— sem nacionalidade —",
    }) },
    { key: "orgao", rotulo: "Órgão", de: (l) => ({
      chave: String(l.orgao?.id ?? "sem"), rotulo: l.orgao?.name ?? "— sem órgão —",
    }) },
    { key: "orgao_pais", rotulo: "País do órgão", de: (l) => ({
      chave: String(l.orgao?.paisId ?? "sem"), rotulo: l.orgao?.pais?.countryLabel ?? "— sem país —",
    }) },
    { key: "orgao_tipo", rotulo: "Tipo de órgão", de: (l) => ({
      chave: l.orgao?.type ?? "sem", rotulo: l.orgao?.type ?? "— sem tipo —",
    }) },
    { key: "familia", rotulo: "Família", de: (l) => ({
      chave: String(l.processo?.familia?.id ?? "sem"), rotulo: l.processo?.familia?.nome ?? "— sem família —",
    }) },
    { key: "responsavel", rotulo: "Responsável", de: (l) => ({
      chave: String(l.responsavel?.id ?? "sem"), rotulo: l.responsavel?.nome ?? "— sem responsável —",
    }) },
    { key: "situacao", rotulo: "Situação", de: (l) => ({ chave: l.situacao, rotulo: l.situacao }) },
    { key: "finalidade", rotulo: "Finalidade", de: (l) => ({ chave: l.finalidade, rotulo: l.finalidade }) },
  ],

  colunas: [
    { key: "data", rotulo: "Data", valor: (l) => dataBR(l.dataProtocolo) },
    { key: "numero", rotulo: "Nº do protocolo", valor: (l) => l.numeroProtocolo ?? l.publicCode ?? null },
    { key: "numero_processo", rotulo: "Nº no órgão", valor: (l) => l.numeroProcesso ?? null },
    { key: "processo", rotulo: "Processo", valor: (l) => l.processo ? `${l.processo.codigo ?? l.processo.id} — ${l.processo.nome}` : null,
      link: (l) => (l.processo ? `/processos/${l.processo.id}` : null) },
    { key: "familia", rotulo: "Família", valor: (l) => l.processo?.familia?.nome ?? null,
      link: (l) => (l.processo?.familia ? `/genealogy?familiaId=${l.processo.familia.id}` : null) },
    { key: "requerentes", rotulo: "Requerentes", valor: (l) => l.requerentes?.map((r: any) => r.nome).join(" · ") ?? null },
    { key: "qtd_requerentes", rotulo: "Nº de requerentes", valor: (l) => l.requerentes?.length ?? 0, alinhamento: "direita", somavel: true },
    { key: "nacionalidade", rotulo: "Nacionalidade", valor: (l) => l.processo?.paisCanonico?.countryLabel ?? null },
    { key: "orgao", rotulo: "Órgão", valor: (l) => l.orgao?.name ?? null,
      link: (l) => (l.orgao ? `/administrator?screen=organs&orgaoId=${l.orgao.id}` : null) },
    { key: "orgao_tipo", rotulo: "Tipo de órgão", valor: (l) => l.orgao?.type ?? null },
    { key: "orgao_pais", rotulo: "País do órgão", valor: (l) => l.orgao?.pais?.countryLabel ?? null },
    { key: "orgao_cidade", rotulo: "Cidade do órgão", valor: (l) => l.orgao?.city ?? null },
    { key: "responsavel", rotulo: "Responsável", valor: (l) => l.responsavel?.nome ?? null },
    { key: "modalidade", rotulo: "Modalidade legal", valor: (l) => l.processo?.enquadramentoLegal?.modalidadeLegal?.nome ?? null },
    { key: "finalidade", rotulo: "Finalidade", valor: (l) => l.finalidade },
    { key: "situacao", rotulo: "Situação", valor: (l) => l.situacao },
    { key: "situacao_em", rotulo: "Data da situação", valor: (l) => dataBR(l.situacaoEm) },
    { key: "tipo", rotulo: "Tipo", valor: (l) => l.tipo?.nome ?? null },
    { key: "exigencias_abertas", rotulo: "Exigências abertas", valor: (l) => l.exigenciasAbertas ?? 0, alinhamento: "direita", somavel: true },
    { key: "ultima_movimentacao", rotulo: "Última movimentação", valor: (l) => dataBR(l.updatedAt) },
  ],

  ordenacoes: [
    { key: "data", rotulo: "Data do protocolo", orderBy: (d) => [{ dataProtocolo: d }, { id: d }] },
    { key: "situacao_em", rotulo: "Data da situação", orderBy: (d) => [{ situacaoEm: d }, { id: d }] },
    { key: "ultima_movimentacao", rotulo: "Última movimentação", orderBy: (d) => [{ updatedAt: d }, { id: d }] },
  ],

  filtrosPrincipais: ["periodo_protocolo", "orgao", "situacao", "responsavel"],
  colunasIniciais: ["data", "processo", "familia", "requerentes", "nacionalidade", "orgao", "orgao_pais", "responsavel", "situacao"],
  ordenacaoPadrao: { key: "data", direcao: "desc" },

  contar: (where) => prisma.protocolo.count({ where }),
  carregar: async (where, orderBy, pular, levar) => {
    const linhas = await prisma.protocolo.findMany({ where, orderBy, skip: pular, take: levar, include: INCLUDE })
    // ACHATA o 1:N na própria linha. Assim o grain continua sendo o protocolo e
    // a contagem da tela nunca diverge da contagem do banco.
    return linhas.map((p) => ({
      ...p,
      requerentes: p.requerentesCobertos.map((r) => r.requerente),
      exigenciasAbertas: p.exigencias.filter((e) => e.cumpridaEm == null).length,
    }))
  },

  visoesDoSistema: [
    { key: "com-exigencia", nome: "Com exigência em aberto",
      spec: { filtros: [{ key: "exigencia_aberta", valor: { tipo: "booleano", valor: true } }] } },
    { key: "aguardando-decisao", nome: "Aguardando decisão",
      spec: { filtros: [{ key: "situacao", valor: { tipo: "multi_selecao", valores: ["PROTOCOLADO", "EM_ANALISE"] } }] } },
    { key: "deferidos", nome: "Deferidos",
      spec: { filtros: [{ key: "situacao", valor: { tipo: "multi_selecao", valores: ["DEFERIDO"] } }] } },
    { key: "parados-60", nome: "Sem movimentação há 60 dias",
      spec: { filtros: [{ key: "sem_movimentacao_dias", valor: { tipo: "numero", numero: 60 } }] } },
    { key: "por-orgao", nome: "Por órgão",
      spec: { filtros: [], agruparPor: "orgao" } },
    { key: "por-familia", nome: "Por família",
      spec: { filtros: [], agruparPor: "familia" } },
    { key: "por-mes", nome: "Por mês",
      spec: { filtros: [], agruparPor: "mes" } },
  ],
}
