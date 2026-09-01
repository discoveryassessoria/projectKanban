// DOMÍNIO TAREFAS — 1 linha = 1 Tarefa canônica.
//
// STEP DE WORKFLOW INTERNO NÃO É TAREFA. O passo é o estado da execução; a
// tarefa é a projeção do trabalho para a pessoa. Contar passo como tarefa
// inflaria o backlog de todo mundo — por isso a consulta é sobre `Tarefa`, e o
// passo aparece só como referência na coluna.
//
// Atraso é DERIVADO na leitura: prazo no passado sem conclusão. Gravar "está
// atrasada" cria um campo que precisa de alguém para atualizar todo dia.

import { prisma } from "@/lib/prisma"
import type { DominioDef } from "../tipos"
import { cadastro, contem, dataBR, diasEntre, emLista, igualId, periodo, porCampo, porMes } from "./_comuns"

const STATUS = [
  "NAO_INICIADA", "EM_ANDAMENTO", "AGUARDANDO_CLIENTE", "AGUARDANDO_TERCEIRO",
  "CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "BLOQUEADA", "SUPERSEDIDA", "CANCELADA",
] as const

const INCLUDE = {
  responsavel: { select: { id: true, nome: true } },
  processo: {
    select: {
      id: true, codigo: true, nome: true, faseAtualKey: true,
      paisCanonico: { select: { countryKey: true, countryLabel: true } },
      familia: { select: { id: true, nome: true } },
    },
  },
  necessidade: { select: { id: true, itemCatalogo: { select: { name: true } } } },
  workflowStepInstance: { select: { id: true, stepKey: true } },
} as const

/** Atrasada = tem prazo, o prazo passou e ela não foi concluída. */
const atrasada = (l: any) => !!l.dataPrazo && !l.concluida && new Date(l.dataPrazo) < new Date()

export const DOMINIO_TAREFAS: DominioDef = {
  key: "tarefas",
  rotulo: "Tarefas",
  descricao: "O trabalho operacional da equipe: responsável, prazo, atraso, conclusão e backlog.",
  grain: "1 linha = 1 tarefa canônica (passo de workflow NÃO é tarefa)",
  permissao: "tarefas.ver",
  ordem: 9,
  aceitaNacionalidade: true,
  ondeNacionalidade: (countryKey) => ({ processo: { paisCanonico: { countryKey } } }),

  filtros: [
    { key: "responsavel", rotulo: "Responsável", tipo: "entidade", opcoes: cadastro("usuarios"),
      paraWhere: igualId("responsavelId") },
    { key: "sem_responsavel", rotulo: "Sem responsável", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { responsavelId: null } : { responsavelId: { not: null } }) },
    { key: "status", rotulo: "Status", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: STATUS.map((s) => ({ valor: s, rotulo: s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") })) },
      paraWhere: emLista("statusTarefa") },
    { key: "concluida", rotulo: "Concluída", tipo: "booleano",
      paraWhere: (v) => (v.tipo === "booleano" ? { concluida: v.valor } : null) },
    { key: "atrasada", rotulo: "Atrasada",
      descricao: "Prazo no passado e ainda não concluída.", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { concluida: false, dataPrazo: { lt: new Date() } }
        : { OR: [{ concluida: true }, { dataPrazo: null }, { dataPrazo: { gte: new Date() } }] }) },
    { key: "sem_prazo", rotulo: "Sem prazo", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { dataPrazo: null } : { dataPrazo: { not: null } }) },
    { key: "prioridade", rotulo: "Prioridade", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: [
        { valor: "BAIXA", rotulo: "Baixa" }, { valor: "MEDIA", rotulo: "Média" },
        { valor: "ALTA", rotulo: "Alta" }, { valor: "URGENTE", rotulo: "Urgente" },
      ] },
      paraWhere: emLista("prioridade") },
    { key: "periodo_criacao", rotulo: "Período de criação", tipo: "intervalo_data", paraWhere: (v) => periodo("createdAt", v) },
    { key: "periodo_prazo", rotulo: "Período do prazo", tipo: "intervalo_data", paraWhere: (v) => periodo("dataPrazo", v) },
    { key: "periodo_conclusao", rotulo: "Período de conclusão", tipo: "intervalo_data", paraWhere: (v) => periodo("dataConclusao", v) },
    { key: "processo", rotulo: "Processo", tipo: "entidade", opcoes: cadastro("processos"), paraWhere: igualId("processoId") },
    { key: "familia", rotulo: "Família", tipo: "entidade", opcoes: cadastro("familias"),
      paraWhere: (v) => (v.tipo === "entidade" ? { processo: { familiaId: v.id } } : null) },
    { key: "fase", rotulo: "Fase do processo", tipo: "multi_selecao", opcoes: cadastro("fases"),
      paraWhere: emLista("faseMacroKey") },
    { key: "titulo", rotulo: "Título contém", tipo: "texto", paraWhere: contem("titulo") },
    { key: "de_workflow", rotulo: "Nascida de workflow", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { workflowStepInstanceId: { not: null } } : { workflowStepInstanceId: null }) },
  ],

  agrupamentos: [
    porCampo("responsavel", "Responsável", (l) => l.responsavel?.nome),
    porCampo("status", "Status", (l) => l.statusTarefa),
    porCampo("prioridade", "Prioridade", (l) => l.prioridade),
    porCampo("fase", "Fase", (l) => l.faseMacroKey),
    porCampo("nacionalidade", "Nacionalidade", (l) => l.processo?.paisCanonico?.countryLabel),
    porCampo("familia", "Família", (l) => l.processo?.familia?.nome),
    porCampo("atraso", "Atraso", (l) => (atrasada(l) ? "Atrasada" : l.concluida ? "Concluída" : "No prazo")),
    porMes("dataPrazo", "Mês do prazo"),
  ],

  colunas: [
    { key: "codigo", rotulo: "Código", valor: (l) => l.publicCode ?? `#${l.id}` },
    { key: "titulo", rotulo: "Tarefa", valor: (l) => l.titulo,
      link: (l) => (l.processoId ? `/processos/${l.processoId}` : "/tarefas") },
    { key: "responsavel", rotulo: "Responsável", valor: (l) => l.responsavel?.nome ?? "— sem responsável —" },
    { key: "status", rotulo: "Status", valor: (l) => l.statusTarefa },
    { key: "prioridade", rotulo: "Prioridade", valor: (l) => l.prioridade },
    { key: "processo", rotulo: "Processo",
      valor: (l) => (l.processo ? `${l.processo.codigo ?? l.processo.id} — ${l.processo.nome}` : null),
      link: (l) => (l.processo ? `/processos/${l.processo.id}` : null) },
    { key: "familia", rotulo: "Família", valor: (l) => l.processo?.familia?.nome ?? null },
    { key: "nacionalidade", rotulo: "Nacionalidade", valor: (l) => l.processo?.paisCanonico?.countryLabel ?? null },
    { key: "fase", rotulo: "Fase", valor: (l) => l.faseMacroKey ?? null },
    { key: "criada", rotulo: "Criada em", valor: (l) => dataBR(l.createdAt) },
    { key: "prazo", rotulo: "Prazo", valor: (l) => dataBR(l.dataPrazo) },
    { key: "conclusao", rotulo: "Concluída em", valor: (l) => dataBR(l.dataConclusao) },
    { key: "atraso_dias", rotulo: "Atraso (dias)",
      valor: (l) => (atrasada(l) ? diasEntre(l.dataPrazo) : null), alinhamento: "direita" },
    { key: "aberta_dias", rotulo: "Aberta há (dias)",
      valor: (l) => (l.concluida ? null : diasEntre(l.createdAt)), alinhamento: "direita" },
    { key: "execucao_dias", rotulo: "Execução (dias)",
      valor: (l) => diasEntre(l.createdAt, l.dataConclusao), alinhamento: "direita" },
    { key: "necessidade", rotulo: "Documento relacionado", valor: (l) => l.necessidade?.itemCatalogo?.name ?? null },
    { key: "passo", rotulo: "Passo do workflow", valor: (l) => l.workflowStepInstance?.stepKey ?? null },
    { key: "ciclo", rotulo: "Ciclo", valor: (l) => l.ciclo ?? null, alinhamento: "direita" },
    { key: "cobrancas", rotulo: "Cobranças", valor: (l) => l.quantidadeCobrancas ?? 0, alinhamento: "direita", somavel: true },
  ],

  ordenacoes: [
    { key: "prazo", rotulo: "Prazo", orderBy: (d) => [{ dataPrazo: d }, { id: d }] },
    { key: "criada", rotulo: "Criação", orderBy: (d) => [{ createdAt: d }, { id: d }] },
    { key: "conclusao", rotulo: "Conclusão", orderBy: (d) => [{ dataConclusao: d }, { id: d }] },
  ],

  colunasIniciais: ["codigo", "titulo", "responsavel", "status", "processo", "fase", "prazo", "atraso_dias"],
  ordenacaoPadrao: { key: "prazo", direcao: "asc" },

  contar: (where) => prisma.tarefa.count({ where }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.tarefa.findMany({ where, orderBy, skip: pular, take: levar, include: INCLUDE }),

  visoesDoSistema: [
    { key: "atrasadas", nome: "Atrasadas", spec: { filtros: [{ key: "atrasada", valor: { tipo: "booleano", valor: true } }] } },
    { key: "sem-responsavel", nome: "Sem responsável",
      spec: { filtros: [{ key: "sem_responsavel", valor: { tipo: "booleano", valor: true } }] } },
    { key: "backlog", nome: "Backlog (não concluídas)",
      spec: { filtros: [{ key: "concluida", valor: { tipo: "booleano", valor: false } }] } },
    { key: "sem-prazo", nome: "Sem prazo definido",
      spec: { filtros: [{ key: "sem_prazo", valor: { tipo: "booleano", valor: true } }] } },
    { key: "por-responsavel", nome: "Por responsável", spec: { filtros: [], agruparPor: "responsavel" } },
    { key: "por-fase", nome: "Por fase", spec: { filtros: [], agruparPor: "fase" } },
  ],
}
