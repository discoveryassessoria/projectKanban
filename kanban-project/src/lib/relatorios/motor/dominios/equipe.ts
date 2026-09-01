// DOMÍNIO EQUIPE E PRODUTIVIDADE — 1 linha = 1 responsável.
//
// SÓ MÉTRICA CALCULÁVEL. Aqui não existe nota de desempenho, ranking nem
// pontuação: o sistema sabe quantas tarefas a pessoa tem, quantas concluiu,
// quantas estão atrasadas e quanto tempo levou. Qualquer número além disso seria
// inventado — e um número inventado sobre o trabalho de alguém é pior que
// nenhum.
//
// A linha é o RESPONSÁVEL, e as tarefas são agregadas nele. Quem quiser ver as
// tarefas em si tem o domínio Tarefas, que é o dono delas.

import { prisma } from "@/lib/prisma"
import type { DominioDef } from "../tipos"
import { contem, porCampo } from "./_comuns"

const INCLUDE = {
  perfil: { select: { id: true, nome: true } },
  tarefas: {
    select: { id: true, concluida: true, dataPrazo: true, dataConclusao: true, createdAt: true, statusTarefa: true },
  },
  _count: { select: { protocolosResponsavel: true, documentosResponsavel: true } },
} as const

const ts = (l: any) => l.tarefas ?? []
const abertas = (l: any) => ts(l).filter((t: any) => !t.concluida)
const concluidas = (l: any) => ts(l).filter((t: any) => t.concluida)
const atrasadas = (l: any) =>
  abertas(l).filter((t: any) => t.dataPrazo && new Date(t.dataPrazo) < new Date())

/** Tempo médio de execução das concluídas, em dias. */
function tempoMedio(l: any): number | null {
  const c = concluidas(l).filter((t: any) => t.dataConclusao && t.createdAt)
  if (!c.length) return null
  const soma = c.reduce((a: number, t: any) =>
    a + Math.max(0, (new Date(t.dataConclusao).getTime() - new Date(t.createdAt).getTime()) / 86_400_000), 0)
  return Math.round(soma / c.length)
}

/** Concluídas no prazo ÷ concluídas com prazo. Sem prazo não entra na conta. */
function noPrazoPct(l: any): number | null {
  const comPrazo = concluidas(l).filter((t: any) => t.dataPrazo && t.dataConclusao)
  if (!comPrazo.length) return null
  const dentro = comPrazo.filter((t: any) => new Date(t.dataConclusao) <= new Date(t.dataPrazo)).length
  return Math.round((dentro / comPrazo.length) * 100)
}

export const DOMINIO_EQUIPE: DominioDef = {
  key: "equipe",
  rotulo: "Equipe e Produtividade",
  descricao: "Carga de trabalho e entrega por responsável — só o que o sistema mede de fato.",
  grain: "1 linha = 1 responsável",
  permissao: "usuarios.gerenciar",
  ordem: 15,
  aceitaNacionalidade: true,
  ondeNacionalidade: (countryKey) => ({
    tarefas: { some: { processo: { paisCanonico: { countryKey } } } },
  }),

  filtros: [
    { key: "nome", rotulo: "Nome", tipo: "texto", paraWhere: contem("nome") },
    { key: "tipo", rotulo: "Tipo de usuário", tipo: "texto", paraWhere: contem("tipo") },
    { key: "com_backlog", rotulo: "Com tarefa em aberto", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { tarefas: { some: { concluida: false } } } : { tarefas: { none: { concluida: false } } }) },
    { key: "com_atraso", rotulo: "Com tarefa atrasada", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" || !v.valor ? null
        : { tarefas: { some: { concluida: false, dataPrazo: { lt: new Date() } } } }) },
    { key: "sem_tarefa", rotulo: "Sem nenhuma tarefa", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { tarefas: { none: {} } } : { tarefas: { some: {} } }) },
  ],

  agrupamentos: [
    porCampo("tipo", "Tipo de usuário", (l) => l.tipo),
    porCampo("perfil", "Perfil", (l) => l.perfil?.nome),
    porCampo("carga", "Situação da carga", (l) =>
      atrasadas(l).length ? "Com atraso" : abertas(l).length ? "Com backlog" : "Sem pendência"),
  ],

  colunas: [
    { key: "nome", rotulo: "Responsável", valor: (l) => l.nome },
    { key: "email", rotulo: "E-mail", valor: (l) => l.email },
    { key: "tipo", rotulo: "Tipo", valor: (l) => l.tipo },
    { key: "perfil", rotulo: "Perfil", valor: (l) => l.perfil?.nome ?? null },
    { key: "total", rotulo: "Tarefas (total)", valor: (l) => ts(l).length, alinhamento: "direita", somavel: true },
    { key: "abertas", rotulo: "Em aberto", valor: (l) => abertas(l).length, alinhamento: "direita", somavel: true },
    { key: "atrasadas", rotulo: "Atrasadas", valor: (l) => atrasadas(l).length, alinhamento: "direita", somavel: true },
    { key: "concluidas", rotulo: "Concluídas", valor: (l) => concluidas(l).length, alinhamento: "direita", somavel: true },
    { key: "tempo_medio", rotulo: "Execução média (dias)", valor: tempoMedio, alinhamento: "direita" },
    { key: "no_prazo", rotulo: "Concluídas no prazo (%)",
      valor: noPrazoPct, alinhamento: "direita" },
    { key: "protocolos", rotulo: "Protocolos", valor: (l) => l._count?.protocolosResponsavel ?? 0, alinhamento: "direita", somavel: true },
    { key: "documentos", rotulo: "Documentos", valor: (l) => l._count?.documentosResponsavel ?? 0, alinhamento: "direita", somavel: true },
  ],

  ordenacoes: [
    { key: "nome", rotulo: "Nome", orderBy: (d) => [{ nome: d }] },
  ],

  colunasIniciais: ["nome", "tipo", "total", "abertas", "atrasadas", "concluidas", "tempo_medio", "no_prazo"],
  ordenacaoPadrao: { key: "nome", direcao: "asc" },

  contar: (where) => prisma.usuario.count({ where }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.usuario.findMany({ where, orderBy, skip: pular, take: levar, include: INCLUDE }),

  visoesDoSistema: [
    { key: "com-atraso", nome: "Com tarefa atrasada",
      spec: { filtros: [{ key: "com_atraso", valor: { tipo: "booleano", valor: true } }] } },
    { key: "com-backlog", nome: "Com backlog",
      spec: { filtros: [{ key: "com_backlog", valor: { tipo: "booleano", valor: true } }] } },
    { key: "sem-tarefa", nome: "Sem nenhuma tarefa",
      spec: { filtros: [{ key: "sem_tarefa", valor: { tipo: "booleano", valor: true } }] } },
  ],
}
