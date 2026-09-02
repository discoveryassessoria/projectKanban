// DOMÍNIO WORKFLOW E PRAZOS — 1 linha = 1 execução de fase.
//
// A pergunta é sobre o PERCURSO: quantos processos estão em cada fase, há quanto
// tempo, e onde eles param. Por isso a linha não é o processo — é a passagem
// dele por uma fase. O mesmo processo que entrou duas vezes em Emissão tem duas
// linhas, e é assim que retrabalho fica visível; se a linha fosse o processo, a
// segunda passagem sumiria e o gargalo com ela.
//
// Permanência é DERIVADA: do início ao fim, ou até agora quando a fase ainda
// está aberta.

import { prisma } from "@/lib/prisma"
import type { DominioDef } from "../tipos"
import { antesDeNDias, cadastro, dataBR, diasEntre, emLista, igualId, periodo, porCampo } from "./_comuns"

const INCLUDE = {
  processo: {
    select: {
      id: true, codigo: true, nome: true, dataConclusao: true,
      paisCanonico: { select: { countryKey: true, countryLabel: true } },
      familia: { select: { id: true, nome: true } },
    },
  },
  _count: { select: { steps: true, tarefas: true } },
} as const

const aberta = (l: any) => !l.completedAt && !l.cancelledAt && !l.supersededAt

export const DOMINIO_WORKFLOW: DominioDef = {
  key: "workflow",
  rotulo: "Workflow e Prazos",
  descricao: "Como os processos percorrem as fases: permanência, gargalos, parados e retrabalho.",
  grain: "1 linha = 1 execução de fase (a mesma fase reaberta conta de novo)",
  permissao: "processos.ver",
  ordem: 10,
  aceitaNacionalidade: true,
  ondeNacionalidade: (countryKey) => ({ processo: { paisCanonico: { countryKey } } }),

  filtros: [
    { key: "fase", rotulo: "Fase", tipo: "multi_selecao", opcoes: cadastro("fases"), paraWhere: emLista("faseMacroKey") },
    { key: "status", rotulo: "Situação da execução", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: [
        { valor: "ATIVA", rotulo: "Ativa" }, { valor: "CONCLUIDA", rotulo: "Concluída" },
        { valor: "CANCELADA", rotulo: "Cancelada" }, { valor: "SUPERSEDIDA", rotulo: "Supersedida" } ] },
      paraWhere: emLista("status") },
    { key: "aberta", rotulo: "Ainda aberta", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { completedAt: null, cancelledAt: null, supersededAt: null }
        : { OR: [{ completedAt: { not: null } }, { cancelledAt: { not: null } }, { supersededAt: { not: null } }] }) },
    { key: "parada_dias", rotulo: "Parada há (dias)",
      descricao: "A execução está aberta e nada mudou nela desde então.", tipo: "numero",
      paraWhere: (v) => { const c = antesDeNDias("startedAt", v); return c ? { AND: [c, { completedAt: null }] } : null } },
    { key: "periodo_entrada", rotulo: "Período de entrada na fase", tipo: "intervalo_data",
      paraWhere: (v) => periodo("startedAt", v) },
    { key: "periodo_saida", rotulo: "Período de saída da fase", tipo: "intervalo_data",
      paraWhere: (v) => periodo("completedAt", v) },
    { key: "processo", rotulo: "Processo", tipo: "entidade", opcoes: cadastro("processos"), paraWhere: igualId("processoId") },
    { key: "familia", rotulo: "Família", tipo: "entidade", opcoes: cadastro("familias"),
      paraWhere: (v) => (v.tipo === "entidade" ? { processo: { familiaId: v.id } } : null) },
    { key: "reentrada", rotulo: "É reentrada na fase",
      descricao: "A fase foi reaberta: existe execução anterior.", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { previousInstanceId: { not: null } } : { previousInstanceId: null }) },
    { key: "ciclo", rotulo: "Ciclo", tipo: "numero",
      paraWhere: (v) => (v.tipo === "numero" ? { ciclo: v.numero } : null) },
  ],

  agrupamentos: [
    porCampo("fase", "Fase", (l) => l.faseMacroKey),
    porCampo("status", "Situação", (l) => l.status),
    porCampo("nacionalidade", "Nacionalidade", (l) => l.processo?.paisCanonico?.countryLabel),
    porCampo("familia", "Família", (l) => l.processo?.familia?.nome),
    porCampo("abertura", "Aberta ou fechada", (l) => (aberta(l) ? "Aberta" : "Fechada")),
    porCampo("origem", "Origem da entrada", (l) => l.origem),
  ],

  colunas: [
    { key: "fase", rotulo: "Fase", valor: (l) => l.faseMacroKey },
    { key: "processo", rotulo: "Processo",
      valor: (l) => (l.processo ? `${l.processo.codigo ?? l.processo.id} — ${l.processo.nome}` : null),
      link: (l) => (l.processo ? `/processos/${l.processo.id}` : null) },
    { key: "familia", rotulo: "Família", valor: (l) => l.processo?.familia?.nome ?? null },
    { key: "nacionalidade", rotulo: "Nacionalidade", valor: (l) => l.processo?.paisCanonico?.countryLabel ?? null },
    { key: "status", rotulo: "Situação", valor: (l) => l.status },
    { key: "ciclo", rotulo: "Ciclo", valor: (l) => l.ciclo, alinhamento: "direita" },
    { key: "entrada", rotulo: "Entrou em", valor: (l) => dataBR(l.startedAt) },
    { key: "saida", rotulo: "Saiu em", valor: (l) => dataBR(l.completedAt) },
    { key: "permanencia", rotulo: "Permanência (dias)",
      valor: (l) => diasEntre(l.startedAt, l.completedAt), alinhamento: "direita" },
    { key: "parada_dias", rotulo: "Aberta há (dias)",
      valor: (l) => (aberta(l) ? diasEntre(l.startedAt) : null), alinhamento: "direita" },
    { key: "reentrada", rotulo: "Reentrada", valor: (l) => (l.previousInstanceId ? "sim" : "não") },
    { key: "origem", rotulo: "Origem", valor: (l) => l.origem ?? null },
    { key: "passos", rotulo: "Passos", valor: (l) => l._count?.steps ?? 0, alinhamento: "direita", somavel: true },
    { key: "tarefas", rotulo: "Tarefas", valor: (l) => l._count?.tarefas ?? 0, alinhamento: "direita", somavel: true },
    { key: "cancelada", rotulo: "Cancelada em", valor: (l) => dataBR(l.cancelledAt) },
    { key: "supersedida", rotulo: "Supersedida em", valor: (l) => dataBR(l.supersededAt) },
  ],

  ordenacoes: [
    { key: "entrada", rotulo: "Entrada na fase", orderBy: (d) => [{ startedAt: d }, { id: d }] },
    { key: "saida", rotulo: "Saída da fase", orderBy: (d) => [{ completedAt: d }, { id: d }] },
  ],

  filtrosPrincipais: ["fase", "periodo_entrada", "aberta"],
  colunasIniciais: ["fase", "processo", "nacionalidade", "status", "entrada", "permanencia", "parada_dias", "reentrada"],
  ordenacaoPadrao: { key: "entrada", direcao: "desc" },

  contar: (where) => prisma.phaseWorkflowInstance.count({ where }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.phaseWorkflowInstance.findMany({ where, orderBy, skip: pular, take: levar, include: INCLUDE }),

  visoesDoSistema: [
    { key: "abertas", nome: "Fases abertas agora",
      spec: { filtros: [{ key: "aberta", valor: { tipo: "booleano", valor: true } }] } },
    { key: "paradas-30", nome: "Paradas há mais de 30 dias",
      spec: { filtros: [{ key: "parada_dias", valor: { tipo: "numero", numero: 30 } }] } },
    { key: "retrabalho", nome: "Retrabalho (reentradas)",
      spec: { filtros: [{ key: "reentrada", valor: { tipo: "booleano", valor: true } }] } },
    { key: "por-fase", nome: "Por fase — onde estão parados",
      spec: { filtros: [{ key: "aberta", valor: { tipo: "booleano", valor: true } }], agruparPor: "fase" } },
  ],
}
