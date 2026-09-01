// DOMÍNIO PROCESSOS — 1 linha = 1 processo.
//
// O processo é a unidade operacional: é ele que tem fase, prazo e conclusão.
// Requerentes e serviços entram achatados na célula — se a linha fosse o
// requerente, uma família de cinco viraria cinco processos na contagem.
//
// Tempo de andamento, tempo na fase e paralisação são DERIVADOS na leitura, a
// partir de datas que já existem. Nenhum deles é coluna: número de tempo
// gravado envelhece em silêncio e passa a mentir no dia seguinte.

import { prisma } from "@/lib/prisma"
import { VINCULO_PROCESSO_ATIVO } from "@/src/lib/genealogia/vinculo-ativo"
import type { DominioDef } from "../tipos"
import {
  cadastro, contem, dataBR, diasEntre, emLista, emListaId, igualId,
  antesDeNDias, periodo, porCampo, porMes,
} from "./_comuns"

const INCLUDE = {
  paisCanonico: { select: { id: true, countryKey: true, countryLabel: true } },
  familia: { select: { id: true, nome: true } },
  tipoProcessoMotor: {
    select: { id: true, code: true, name: true, modalidade: { select: { modalityKey: true, modalityLabel: true } } },
  },
  enquadramentoLegal: { select: { nome: true, modalidadeLegal: { select: { nome: true, cardinalidadeRequerimento: true } } } },
  tiposServico: { select: { id: true, nome: true } },
  requerentes: {
    where: VINCULO_PROCESSO_ATIVO,
    select: { requerente: { select: { id: true, publicCode: true, nome: true } } },
  },
  _count: { select: { tarefas: true, protocolos: true, necessidades: true, receitas: true, custos: true } },
} as const

export const DOMINIO_PROCESSOS: DominioDef = {
  key: "processos",
  rotulo: "Processos",
  descricao: "O processo como unidade operacional: fase, situação, família, requerentes, responsável e tempos.",
  grain: "1 linha = 1 processo",
  permissao: "processos.ver",
  ordem: 1,
  aceitaNacionalidade: true,
  ondeNacionalidade: (countryKey) => ({ paisCanonico: { countryKey } }),

  filtros: [
    { key: "periodo_inicio", rotulo: "Período de entrada", descricao: "Quando o processo começou.",
      tipo: "intervalo_data", paraWhere: (v) => periodo("dataInicio", v) },
    { key: "periodo_conclusao", rotulo: "Período de conclusão", tipo: "intervalo_data",
      paraWhere: (v) => periodo("dataConclusao", v) },
    { key: "nacionalidade", rotulo: "Nacionalidade", tipo: "multi_selecao",
      opcoes: cadastro("nacionalidades_ofertadas"),
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length ? { paisCanonico: { countryKey: { in: v.valores } } } : null) },
    { key: "tipo_processo", rotulo: "Tipo de processo (oferta)", tipo: "multi_selecao",
      opcoes: cadastro("tipos_de_processo"), paraWhere: emListaId("tipoProcessoMotorId") },
    { key: "fase", rotulo: "Fase atual", tipo: "multi_selecao", opcoes: cadastro("fases"),
      paraWhere: emLista("faseAtualKey") },
    { key: "familia", rotulo: "Família", tipo: "entidade", opcoes: cadastro("familias"),
      paraWhere: igualId("familiaId") },
    { key: "requerente", rotulo: "Requerente", tipo: "entidade", opcoes: cadastro("requerentes"),
      paraWhere: (v) => (v.tipo === "entidade" ? { requerentes: { some: { requerenteId: v.id, ...VINCULO_PROCESSO_ATIVO } } } : null) },
    { key: "concluido", rotulo: "Concluído", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { dataConclusao: { not: null } } : { dataConclusao: null }) },
    { key: "sem_fase", rotulo: "Sem fase atribuída", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { faseAtualKey: null } : { faseAtualKey: { not: null } }) },
    { key: "parado_dias", rotulo: "Parado há (dias)",
      descricao: "Nada foi atualizado no processo desde então.", tipo: "numero",
      paraWhere: (v) => antesDeNDias("updatedAt", v) },
    { key: "nome", rotulo: "Nome ou código", tipo: "texto",
      paraWhere: (v) => (v.tipo === "texto" && v.texto.trim()
        ? { OR: [{ nome: { contains: v.texto.trim(), mode: "insensitive" } }, { codigo: { contains: v.texto.trim(), mode: "insensitive" } }] }
        : null) },
    { key: "observacoes", rotulo: "Observações contêm", tipo: "texto", paraWhere: contem("observacoes") },
  ],

  agrupamentos: [
    porCampo("nacionalidade", "Nacionalidade", (l) => l.paisCanonico?.countryLabel),
    porCampo("fase", "Fase atual", (l) => l.faseAtualKey),
    porCampo("familia", "Família", (l) => l.familia?.nome),
    porCampo("tipo", "Tipo de processo", (l) => l.tipoProcessoMotor?.name),
    porCampo("modalidade", "Modalidade legal", (l) => l.enquadramentoLegal?.modalidadeLegal?.nome),
    porCampo("situacao", "Situação", (l) => (l.dataConclusao ? "Concluído" : "Em andamento")),
    porMes("dataInicio", "Mês de entrada"),
  ],

  colunas: [
    { key: "codigo", rotulo: "Código", valor: (l) => l.codigo ?? `#${l.id}`, link: (l) => `/processos/${l.id}` },
    { key: "nome", rotulo: "Processo", valor: (l) => l.nome, link: (l) => `/processos/${l.id}` },
    { key: "nacionalidade", rotulo: "Nacionalidade", valor: (l) => l.paisCanonico?.countryLabel ?? null },
    { key: "tipo", rotulo: "Tipo (oferta)", valor: (l) => l.tipoProcessoMotor?.name ?? null },
    { key: "modalidade", rotulo: "Modalidade legal", valor: (l) => l.enquadramentoLegal?.modalidadeLegal?.nome ?? null },
    { key: "servicos", rotulo: "Serviços", valor: (l) => l.tiposServico?.map((s: any) => s.nome).join(" · ") || null },
    { key: "fase", rotulo: "Fase atual", valor: (l) => l.faseAtualKey ?? null },
    { key: "situacao", rotulo: "Situação", valor: (l) => (l.dataConclusao ? "Concluído" : "Em andamento") },
    { key: "familia", rotulo: "Família", valor: (l) => l.familia?.nome ?? null,
      link: (l) => (l.familia ? `/genealogy?familiaId=${l.familia.id}` : null) },
    { key: "requerentes", rotulo: "Requerentes", valor: (l) => l.requerentes?.map((r: any) => r.requerente.nome).join(" · ") || null },
    { key: "qtd_requerentes", rotulo: "Nº requerentes", valor: (l) => l.requerentes?.length ?? 0, alinhamento: "direita", somavel: true },
    { key: "entrada", rotulo: "Entrada", valor: (l) => dataBR(l.dataInicio) },
    { key: "previsao", rotulo: "Previsão", valor: (l) => dataBR(l.previsaoTermino) },
    { key: "conclusao", rotulo: "Conclusão", valor: (l) => dataBR(l.dataConclusao) },
    // Derivados na leitura — nunca gravados.
    { key: "andamento_dias", rotulo: "Andamento (dias)", valor: (l) => diasEntre(l.dataInicio, l.dataConclusao),
      alinhamento: "direita" },
    { key: "parado_dias", rotulo: "Sem movimento (dias)", valor: (l) => (l.dataConclusao ? null : diasEntre(l.updatedAt)),
      alinhamento: "direita" },
    { key: "tarefas", rotulo: "Tarefas", valor: (l) => l._count?.tarefas ?? 0, alinhamento: "direita", somavel: true },
    { key: "protocolos", rotulo: "Protocolos", valor: (l) => l._count?.protocolos ?? 0, alinhamento: "direita", somavel: true },
    { key: "pendencias_doc", rotulo: "Necessidades documentais", valor: (l) => l._count?.necessidades ?? 0, alinhamento: "direita", somavel: true },
    { key: "arvore", rotulo: "Árvore", valor: (l) => (l.arvoreId ? `#${l.arvoreId}` : null),
      link: (l) => (l.arvoreId ? `/genealogy?arvoreId=${l.arvoreId}` : null) },
  ],

  ordenacoes: [
    { key: "entrada", rotulo: "Data de entrada", orderBy: (d) => [{ dataInicio: d }, { id: d }] },
    { key: "conclusao", rotulo: "Data de conclusão", orderBy: (d) => [{ dataConclusao: d }, { id: d }] },
    { key: "movimentacao", rotulo: "Última movimentação", orderBy: (d) => [{ updatedAt: d }, { id: d }] },
    { key: "nome", rotulo: "Nome", orderBy: (d) => [{ nome: d }] },
  ],

  colunasIniciais: ["codigo", "nome", "nacionalidade", "fase", "situacao", "familia", "qtd_requerentes", "entrada", "parado_dias"],
  ordenacaoPadrao: { key: "entrada", direcao: "desc" },

  contar: (where) => prisma.processo.count({ where }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.processo.findMany({ where, orderBy, skip: pular, take: levar, include: INCLUDE }),

  visoesDoSistema: [
    { key: "em-andamento", nome: "Em andamento",
      spec: { filtros: [{ key: "concluido", valor: { tipo: "booleano", valor: false } }] } },
    { key: "concluidos", nome: "Concluídos",
      spec: { filtros: [{ key: "concluido", valor: { tipo: "booleano", valor: true } }] } },
    { key: "parados-30", nome: "Parados há 30 dias",
      spec: { filtros: [
        { key: "concluido", valor: { tipo: "booleano", valor: false } },
        { key: "parado_dias", valor: { tipo: "numero", numero: 30 } },
      ] } },
    { key: "sem-fase", nome: "Sem fase atribuída",
      spec: { filtros: [{ key: "sem_fase", valor: { tipo: "booleano", valor: true } }] } },
    { key: "por-fase", nome: "Por fase", spec: { filtros: [], agruparPor: "fase" } },
    { key: "por-familia", nome: "Por família", spec: { filtros: [], agruparPor: "familia" } },
  ],
}
