// DOMÍNIO GENEALOGIA — 1 linha = 1 pessoa da árvore.
//
// SÓ ESTRUTURA. Certidão faltante e documento pendente NÃO entram aqui: eles são
// de Certidões e Documentos, e repeti-los criaria duas contagens da mesma
// pendência. Aqui a pergunta é sobre PARENTESCO: quem descende de quem, onde a
// linhagem quebra, quem está solto na árvore.
//
// A geração é DERIVADA subindo por pai/mãe a partir da pessoa. Gravar geração
// seria criar um número que precisa ser recalculado toda vez que alguém corrige
// uma filiação — e que ninguém lembra de recalcular.

import { prisma } from "@/lib/prisma"
import type { DominioDef } from "../tipos"
import { cadastro, contem, dataBR, igualId, periodo, porCampo } from "./_comuns"

const INCLUDE = {
  arvore: { select: { id: true, nome: true, familia: { select: { id: true, nome: true } }, pessoaPrincipalId: true } },
  pai: { select: { id: true, nome: true, sobrenome: true } },
  mae: { select: { id: true, nome: true, sobrenome: true } },
  _count: { select: { filhosComoPai: true, filhosComoMae: true, necessidades: true } },
} as const

const nomeCompleto = (p: any) => (p ? `${p.nome} ${p.sobrenome ?? ""}`.trim() : null)
const filhos = (l: any) => (l._count?.filhosComoPai ?? 0) + (l._count?.filhosComoMae ?? 0)

export const DOMINIO_GENEALOGIA: DominioDef = {
  key: "genealogia",
  rotulo: "Genealogia",
  descricao: "A estrutura da árvore: ascendência, descendência, vínculos e inconsistências de parentesco.",
  grain: "1 linha = 1 pessoa da árvore",
  permissao: "arvore.ver",
  ordem: 4,
  grupo: "Operação",
  aceitaNacionalidade: true,
  // A pessoa não tem nacionalidade ofertada; a ÁRVORE pertence a processos que
  // têm. O recorte atravessa a árvore, não um campo da pessoa.
  ondeNacionalidade: (countryKey) => ({ arvore: { processos: { some: { paisCanonico: { countryKey } } } } }),

  filtros: [
    { key: "nome", rotulo: "Nome", tipo: "texto",
      paraWhere: (v) => (v.tipo === "texto" && v.texto.trim()
        ? { OR: [{ nome: { contains: v.texto.trim(), mode: "insensitive" } }, { sobrenome: { contains: v.texto.trim(), mode: "insensitive" } }] }
        : null) },
    { key: "arvore", rotulo: "Árvore", tipo: "entidade", opcoes: cadastro("arvores"), paraWhere: igualId("arvoreId") },
    { key: "familia", rotulo: "Família", tipo: "entidade", opcoes: cadastro("familias"),
      paraWhere: (v) => (v.tipo === "entidade" ? { arvore: { familiaId: v.id } } : null) },
    { key: "sem_pai", rotulo: "Sem pai vinculado",
      descricao: "Quebra de linhagem: a ascendência para aqui.", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { paiId: null } : { paiId: { not: null } }) },
    { key: "sem_mae", rotulo: "Sem mãe vinculada", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { maeId: null } : { maeId: { not: null } }) },
    { key: "sem_filiacao", rotulo: "Sem pai NEM mãe", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" || !v.valor ? null : { paiId: null, maeId: null }) },
    { key: "sem_arvore", rotulo: "Fora de qualquer árvore", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { arvoreId: null } : { arvoreId: { not: null } }) },
    { key: "vivo", rotulo: "Vivo", tipo: "booleano",
      paraWhere: (v) => (v.tipo === "booleano" ? { vivo: v.valor } : null) },
    { key: "nascimento", rotulo: "Período de nascimento", tipo: "intervalo_data", paraWhere: (v) => periodo("data_nasc", v) },
    { key: "obito", rotulo: "Período de óbito", tipo: "intervalo_data", paraWhere: (v) => periodo("data_obito", v) },
    { key: "pais_nasc", rotulo: "País de nascimento (texto do registro)",
      descricao: "Campo do próprio registro civil da pessoa — é dado histórico, não o Cadastro Mestre.",
      tipo: "texto", paraWhere: contem("pais_nasc") },
    { key: "sem_data_nasc", rotulo: "Sem data de nascimento", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { data_nasc: null } : { data_nasc: { not: null } }) },
    { key: "naturalizado", rotulo: "Naturalizado", tipo: "booleano",
      paraWhere: (v) => (v.tipo === "booleano" ? { naturalizado: v.valor } : null) },
    { key: "requerente", rotulo: "É requerente", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { requerentesVinculados: { some: {} } } : { requerentesVinculados: { none: {} } }) },
  ],

  agrupamentos: [
    porCampo("arvore", "Árvore", (l) => l.arvore?.nome),
    porCampo("familia", "Família", (l) => l.arvore?.familia?.nome),
    porCampo("pais_nasc", "País de nascimento", (l) => l.pais_nasc),
    porCampo("vivo", "Situação", (l) => (l.vivo ? "Vivo" : "Falecido")),
    porCampo("filiacao", "Filiação", (l) => {
      if (l.paiId && l.maeId) return "Pai e mãe"
      if (l.paiId) return "Só pai"
      if (l.maeId) return "Só mãe"
      return "Sem filiação"
    }),
  ],

  colunas: [
    { key: "nome", rotulo: "Pessoa", valor: (l) => nomeCompleto(l),
      link: (l) => (l.arvoreId ? `/genealogy?arvoreId=${l.arvoreId}&pessoaId=${l.id}` : null) },
    { key: "codigo", rotulo: "Código", valor: (l) => l.publicCode ?? `#${l.id}` },
    { key: "arvore", rotulo: "Árvore", valor: (l) => l.arvore?.nome ?? null,
      link: (l) => (l.arvoreId ? `/genealogy?arvoreId=${l.arvoreId}` : null) },
    { key: "familia", rotulo: "Família", valor: (l) => l.arvore?.familia?.nome ?? null },
    { key: "pai", rotulo: "Pai", valor: (l) => nomeCompleto(l.pai) },
    { key: "mae", rotulo: "Mãe", valor: (l) => nomeCompleto(l.mae) },
    { key: "filhos", rotulo: "Filhos", valor: filhos, alinhamento: "direita", somavel: true },
    { key: "nascimento", rotulo: "Nascimento", valor: (l) => dataBR(l.data_nasc) },
    { key: "local_nasc", rotulo: "Local de nascimento",
      valor: (l) => [l.local_nasc, l.estado_nasc, l.pais_nasc].filter(Boolean).join(", ") || null },
    { key: "obito", rotulo: "Óbito", valor: (l) => dataBR(l.data_obito) },
    { key: "vivo", rotulo: "Situação", valor: (l) => (l.vivo ? "Vivo" : "Falecido") },
    { key: "sexo", rotulo: "Sexo", valor: (l) => l.sexo ?? null },
    { key: "nacionalidade_registro", rotulo: "Nacionalidade (registro)", valor: (l) => l.nacionalidade ?? null },
    { key: "naturalizado", rotulo: "Naturalizado", valor: (l) => (l.naturalizado ? "sim" : "não") },
    { key: "principal", rotulo: "Raiz da árvore",
      valor: (l) => (l.arvore?.pessoaPrincipalId === l.id ? "sim" : null) },
    { key: "quebra", rotulo: "Quebra de linhagem",
      valor: (l) => (!l.paiId && !l.maeId ? "sem pai nem mãe" : !l.paiId ? "sem pai" : !l.maeId ? "sem mãe" : null) },
    { key: "necessidades", rotulo: "Necessidades documentais",
      valor: (l) => l._count?.necessidades ?? 0, alinhamento: "direita", somavel: true },
  ],

  ordenacoes: [
    { key: "nome", rotulo: "Nome", orderBy: (d) => [{ nome: d }, { sobrenome: d }] },
    { key: "nascimento", rotulo: "Nascimento", orderBy: (d) => [{ data_nasc: d }, { id: d }] },
  ],

  filtrosPrincipais: ["nome", "arvore", "sem_filiacao"],
  colunasIniciais: ["nome", "arvore", "familia", "pai", "mae", "filhos", "nascimento", "quebra"],
  ordenacaoPadrao: { key: "nome", direcao: "asc" },

  contar: (where) => prisma.pessoa.count({ where }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.pessoa.findMany({ where, orderBy, skip: pular, take: levar, include: INCLUDE }),

  visoesDoSistema: [
    { key: "sem-filiacao", nome: "Quebras de linhagem (sem pai nem mãe)",
      spec: { filtros: [{ key: "sem_filiacao", valor: { tipo: "booleano", valor: true } }] } },
    { key: "sem-arvore", nome: "Fora de qualquer árvore",
      spec: { filtros: [{ key: "sem_arvore", valor: { tipo: "booleano", valor: true } }] } },
    { key: "sem-data", nome: "Sem data de nascimento",
      spec: { filtros: [{ key: "sem_data_nasc", valor: { tipo: "booleano", valor: true } }] } },
    { key: "requerentes", nome: "Que são requerentes",
      spec: { filtros: [{ key: "requerente", valor: { tipo: "booleano", valor: true } }] } },
    { key: "por-arvore", nome: "Por árvore", spec: { filtros: [], agruparPor: "arvore" } },
  ],
}
