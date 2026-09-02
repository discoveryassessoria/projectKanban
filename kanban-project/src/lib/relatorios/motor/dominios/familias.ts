// DOMÍNIO FAMÍLIAS — 1 linha = 1 família.
//
// A família é a unidade de ATENDIMENTO. Ela consolida seus requerentes e
// processos; ela NÃO tem documento, tarefa, certidão ou protocolo próprios.
// Esses pertencem aos domínios donos, e a família só os alcança por drill-down.
// Transformá-los em atributo de Família criaria uma segunda contagem — e o dia
// em que a soma da família divergir do domínio dono, ninguém sabe qual vale.

import { prisma } from "@/lib/prisma"
import type { DominioDef } from "../tipos"
import { cadastro, contem, dataBR, porCampo } from "./_comuns"

const INCLUDE = {
  processos: {
    select: {
      id: true, codigo: true, nome: true, faseAtualKey: true, dataConclusao: true, dataInicio: true,
      paisCanonico: { select: { countryKey: true, countryLabel: true } },
      _count: { select: { requerentes: true } },
    },
    orderBy: { id: "desc" as const },
  },
  arvores: { select: { id: true, nome: true, _count: { select: { pessoas: true } } } },
} as const

/** Requerentes distintos da família, somados pelos processos dela. */
const totalRequerentes = (l: any) =>
  (l.processos ?? []).reduce((s: number, p: any) => s + (p._count?.requerentes ?? 0), 0)

export const DOMINIO_FAMILIAS: DominioDef = {
  key: "familias",
  rotulo: "Famílias",
  descricao: "A família como unidade de atendimento: seus requerentes, processos e andamento geral.",
  grain: "1 linha = 1 família",
  permissao: "processos.ver",
  ordem: 3,
  grupo: "Operação",
  aceitaNacionalidade: true,
  ondeNacionalidade: (countryKey) => ({ processos: { some: { paisCanonico: { countryKey } } } }),

  filtros: [
    { key: "nome", rotulo: "Nome da família", tipo: "texto", paraWhere: contem("nome") },
    { key: "nacionalidade", rotulo: "Nacionalidade dos processos", tipo: "multi_selecao",
      opcoes: cadastro("nacionalidades_ofertadas"),
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length
        ? { processos: { some: { paisCanonico: { countryKey: { in: v.valores } } } } } : null) },
    { key: "fase", rotulo: "Fase de algum processo", tipo: "multi_selecao", opcoes: cadastro("fases"),
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length
        ? { processos: { some: { faseAtualKey: { in: v.valores } } } } : null) },
    { key: "sem_processo", rotulo: "Sem processo", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { processos: { none: {} } } : { processos: { some: {} } }) },
    { key: "com_processo_aberto", rotulo: "Com processo em andamento", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { processos: { some: { dataConclusao: null } } } : { processos: { none: { dataConclusao: null } } }) },
    { key: "sem_arvore", rotulo: "Sem árvore genealógica", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { arvores: { none: {} } } : { arvores: { some: {} } }) },
  ],

  agrupamentos: [
    porCampo("nacionalidade", "Nacionalidade", (l) => l.processos?.[0]?.paisCanonico?.countryLabel),
    porCampo("situacao", "Situação", (l) => {
      if (!l.processos?.length) return "Sem processo"
      return l.processos.some((p: any) => !p.dataConclusao) ? "Com processo em andamento" : "Todos concluídos"
    }),
    porCampo("fase", "Fase do processo mais recente", (l) => l.processos?.[0]?.faseAtualKey),
  ],

  colunas: [
    { key: "nome", rotulo: "Família", valor: (l) => l.nome, link: (l) => `/genealogy?familiaId=${l.id}` },
    { key: "descricao", rotulo: "Descrição", valor: (l) => l.descricao ?? null },
    { key: "qtd_processos", rotulo: "Processos", valor: (l) => l.processos?.length ?? 0, alinhamento: "direita", somavel: true },
    { key: "qtd_requerentes", rotulo: "Requerentes", valor: totalRequerentes, alinhamento: "direita", somavel: true },
    { key: "nacionalidades", rotulo: "Nacionalidades",
      valor: (l) => [...new Set((l.processos ?? []).map((p: any) => p.paisCanonico?.countryLabel).filter(Boolean))].join(" · ") || null },
    { key: "processos", rotulo: "Processos (códigos)",
      valor: (l) => (l.processos ?? []).map((p: any) => p.codigo ?? p.id).join(" · ") || null },
    { key: "em_andamento", rotulo: "Em andamento",
      valor: (l) => (l.processos ?? []).filter((p: any) => !p.dataConclusao).length, alinhamento: "direita", somavel: true },
    { key: "concluidos", rotulo: "Concluídos",
      valor: (l) => (l.processos ?? []).filter((p: any) => p.dataConclusao).length, alinhamento: "direita", somavel: true },
    { key: "fase", rotulo: "Fase (processo mais recente)", valor: (l) => l.processos?.[0]?.faseAtualKey ?? null },
    { key: "arvore", rotulo: "Árvore", valor: (l) => l.arvores?.[0]?.nome ?? null,
      link: (l) => (l.arvores?.[0] ? `/genealogy?arvoreId=${l.arvores[0].id}` : null) },
    { key: "pessoas_arvore", rotulo: "Pessoas na árvore",
      valor: (l) => (l.arvores ?? []).reduce((s: number, a: any) => s + (a._count?.pessoas ?? 0), 0),
      alinhamento: "direita", somavel: true },
    { key: "criada", rotulo: "Criada em", valor: (l) => dataBR(l.createdAt) },
  ],

  ordenacoes: [
    { key: "nome", rotulo: "Nome", orderBy: (d) => [{ nome: d }] },
    { key: "criada", rotulo: "Criação", orderBy: (d) => [{ createdAt: d }, { id: d }] },
  ],

  filtrosPrincipais: ["nome", "com_processo_aberto"],
  colunasIniciais: ["nome", "qtd_processos", "qtd_requerentes", "nacionalidades", "em_andamento", "fase", "arvore"],
  ordenacaoPadrao: { key: "nome", direcao: "asc" },

  contar: (where) => prisma.familia.count({ where }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.familia.findMany({ where, orderBy, skip: pular, take: levar, include: INCLUDE }),

  visoesDoSistema: [
    { key: "sem-processo", nome: "Sem processo",
      spec: { filtros: [{ key: "sem_processo", valor: { tipo: "booleano", valor: true } }] } },
    { key: "em-andamento", nome: "Com processo em andamento",
      spec: { filtros: [{ key: "com_processo_aberto", valor: { tipo: "booleano", valor: true } }] } },
    { key: "sem-arvore", nome: "Sem árvore genealógica",
      spec: { filtros: [{ key: "sem_arvore", valor: { tipo: "booleano", valor: true } }] } },
    { key: "por-nacionalidade", nome: "Por nacionalidade", spec: { filtros: [], agruparPor: "nacionalidade" } },
  ],
}
