// src/lib/relatorios/motor/opcoes.ts
//
// DE ONDE VÊM OS VALORES DOS FILTROS.
//
// ─── A CAUSA DO DEFEITO QUE ESTE ARQUIVO CORRIGE ────────────────────────────
// A tela antiga montava o seletor de NACIONALIDADE com `/api/gerenciamento/paises`
// — o registro GEOGRÁFICO. Resultado: Argentina, Brasil, Estados Unidos, França,
// Paraguai e Reino Unido apareciam como se a empresa vendesse essas cidadanias.
// Eles estão no cadastro porque são o país de um consulado, de um cartório, de um
// fornecedor. Existir não é ser ofertado.
//
// Aqui os dois conceitos têm fontes DIFERENTES e nomes diferentes:
//
//   nacionalidades_ofertadas → CatalogoPais QUE TEM tipo de processo ativo
//   paises_geograficos       → CatalogoPais, todos
//
// A regra da oferta não é uma flag nova: é a existência de um Tipo de Processo
// ativo apontando para o país. É a mesma que o Kanban usa para decidir que abas
// existem — uma fonte, não duas.

import { prisma } from "@/lib/prisma"

export interface Opcao {
  /** O que trafega. ID quando existe entidade; chave canônica quando é cadastro. */
  valor: string
  rotulo: string
  detalhe?: string | null
}

/** Nacionalidades OFERTADAS. Só entra país com oferta ativa configurada. */
export async function nacionalidadesOfertadas(): Promise<Opcao[]> {
  const paises = await prisma.catalogoPais.findMany({
    where: { ativo: true, tiposDeProcesso: { some: { ativo: true, arquivado: false } } },
    orderBy: { countryLabel: "asc" },
    select: { countryKey: true, countryLabel: true, flag: true },
  })
  return paises.map((p) => ({ valor: p.countryKey, rotulo: p.countryLabel, detalhe: p.flag }))
}

/** Países GEOGRÁFICOS. Serve ao país do órgão — e ali o Brasil é legítimo. */
export async function paisesGeograficos(): Promise<Opcao[]> {
  const paises = await prisma.catalogoPais.findMany({
    where: { ativo: true },
    orderBy: { countryLabel: "asc" },
    select: { id: true, countryLabel: true, flag: true },
  })
  return paises.map((p) => ({ valor: String(p.id), rotulo: p.countryLabel, detalhe: p.flag }))
}

/**
 * Catálogos consultados por chave. Cada um vai à FONTE CANÔNICA do conceito —
 * nenhum array escrito aqui.
 */
export async function opcoesDoCadastro(chave: string, busca?: string | null): Promise<Opcao[]> {
  const q = (busca ?? "").trim()
  const contem = q ? { contains: q, mode: "insensitive" as const } : undefined

  switch (chave) {
    case "nacionalidades_ofertadas":
      return nacionalidadesOfertadas()

    case "paises_geograficos":
      return paisesGeograficos()

    case "orgaos": {
      const r = await prisma.orgaoProtocolo.findMany({
        where: { ativo: true, ...(contem ? { name: contem } : {}) },
        orderBy: [{ pais: { countryLabel: "asc" } }, { name: "asc" }],
        take: 50,
        select: { id: true, name: true, type: true, pais: { select: { countryLabel: true } } },
      })
      return r.map((o) => ({
        valor: String(o.id),
        rotulo: o.name,
        detalhe: [o.type, o.pais?.countryLabel].filter(Boolean).join(" · ") || null,
      }))
    }

    case "tipos_de_orgao": {
      // Vem dos DADOS: o conjunto de tipos que os órgãos cadastrados realmente
      // usam. Uma lista fixa envelheceria no dia em que alguém criasse um tipo.
      const r = await prisma.orgaoProtocolo.findMany({
        where: { type: { not: null } }, distinct: ["type"], select: { type: true }, orderBy: { type: "asc" },
      })
      return r.filter((x) => x.type).map((x) => ({ valor: x.type!, rotulo: x.type! }))
    }

    case "tipos_de_protocolo": {
      const r = await prisma.tipoProtocoloCadastro.findMany({
        where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, code: true },
      })
      return r.map((t) => ({ valor: String(t.id), rotulo: t.nome, detalhe: t.code }))
    }

    case "familias": {
      const r = await prisma.familia.findMany({
        where: contem ? { nome: contem } : {}, orderBy: { nome: "asc" }, take: 50,
        select: { id: true, nome: true },
      })
      return r.map((f) => ({ valor: String(f.id), rotulo: f.nome }))
    }

    case "processos": {
      const r = await prisma.processo.findMany({
        where: contem ? { OR: [{ nome: contem }, { codigo: contem }] } : {},
        orderBy: { id: "desc" }, take: 50,
        select: { id: true, nome: true, codigo: true, paisCanonico: { select: { countryLabel: true } } },
      })
      return r.map((p) => ({ valor: String(p.id), rotulo: `${p.codigo ?? p.id} — ${p.nome}`, detalhe: p.paisCanonico?.countryLabel }))
    }

    case "requerentes": {
      const r = await prisma.requerente.findMany({
        where: contem ? { nome: contem } : {}, orderBy: { nome: "asc" }, take: 50,
        select: { id: true, nome: true, publicCode: true },
      })
      return r.map((x) => ({ valor: String(x.id), rotulo: x.nome, detalhe: x.publicCode }))
    }

    case "usuarios": {
      const r = await prisma.usuario.findMany({
        where: contem ? { nome: contem } : {}, orderBy: { nome: "asc" }, take: 50,
        select: { id: true, nome: true, tipo: true },
      })
      return r.map((u) => ({ valor: String(u.id), rotulo: u.nome, detalhe: u.tipo }))
    }

    default:
      return []
  }
}
