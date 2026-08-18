// src/lib/process-stage/estrutura-operacional.ts
//
// CONSULTA OFICIAL DA CENTRAL OPERACIONAL.
//
// Uma chamada devolve a fase inteira já organizada na hierarquia de execução —
// PESSOA → DOCUMENTO/CERTIDÃO → WORKFLOW DAQUELE DOCUMENTO → PASSOS — pronta para
// apresentação. O frontend não busca pessoas, tarefas e documentos em separado para
// depois casar por nome: o agrupamento acontece AQUI, por IDs relacionais oficiais.
//
// FONTE ÚNICA: PhaseWorkflowStepInstance. Cada instância já nasce com o seu ALVO
// PERSISTIDO (pessoaId / necessidadeId / documentoId), gravado na materialização a
// partir da CARDINALIDADE publicada do passo (phase-workflow-escopo). Esta camada só
// carrega, resolve rótulos e delega o agrupamento ao núcleo puro.
//
// O que esta camada NÃO faz: criar passo, criar tarefa, materializar alvo, inferir
// sequência, adivinhar dono por nome, ou reconstruir progresso de fase (o percentual
// da fase é da projeção operacional canônica — ver estrutura-operacional-core).

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import type { FaseCode } from "@prisma/client"
import {
  montarPessoasDoProcesso,
  nomeCompletoPessoa,
  type PessoaDoProcesso,
} from "./central-operacional-core"
import { nomeCanonicoDaObrigacao, codigosAceitos } from "@/src/lib/documentos/nome-canonico-obrigacao"
import {
  montarEstruturaOperacional,
  montarIndiceOperacional,
  chaveDoAlvo,
  escopoDoAlvo,
  type AlvoBruto,
  type ArtefatosPorChave,
  type EstruturaOperacional,
  type IndiceOperacional,
  type PassoBruto,
  type StatusResumo,
  type TarefasPorChave,
} from "./estrutura-operacional-core"
import { getStepsForFase, getStepDef, phaseKeyToFaseCode } from "./fases-catalog"
import { diasEntreDiasOperacionais } from "@/lib/operacional/tempo-operacional"
import {
  chaveDaUnidade,
  tarefasVivasDasUnidades,
  type UnidadeDeTrabalho,
} from "@/lib/operacional/identidade-da-tarefa"
import { resolverInstanciaVigente } from "./instancia-vigente-da-fase"

// ============================================================
// RÓTULOS DE TIPO DOCUMENTAL — fonte única desta camada de leitura.
// ============================================================
export const TIPO_DOCUMENTO_LABELS: Record<string, string> = {
  CERTIDAO_NASCIMENTO: "Certidão de Nascimento",
  CERTIDAO_NASCIMENTO_INTEIRO_TEOR: "Certidão de Nascimento (IT)",
  CERTIDAO_CASAMENTO: "Certidão de Casamento",
  CERTIDAO_CASAMENTO_INTEIRO_TEOR: "Certidão de Casamento (IT)",
  CERTIDAO_OBITO: "Certidão de Óbito",
  CERTIDAO_OBITO_INTEIRO_TEOR: "Certidão de Óbito (IT)",
  CERTIDAO_BATISMO: "Certidão de Batismo",
  CNN: "CNN",
  CARTA_NATURALIZACAO: "Carta de Naturalização",
  RG: "RG",
  CPF: "CPF",
  CNH: "CNH",
  PASSAPORTE_BRASILEIRO: "Passaporte BR",
  TITULO_ELEITOR: "Título de Eleitor",
  RESERVISTA: "Reservista",
  PASSAPORTE_ESTRANGEIRO: "Passaporte Estrangeiro",
  CERTIDAO_CIDADANIA_ESTRANGEIRA: "Certidão de Cidadania",
  COMPROVANTE_RESIDENCIA: "Comprovante de Residência",
  TRADUCAO_JURAMENTADA: "Tradução Juramentada",
  APOSTILA_HAIA: "Apostila de Haia",
  FOTO_3X4: "Foto 3x4",
  PROCURACAO: "Procuração",
  ARVORE_GENEALOGICA_DOC: "Árvore Genealógica",
  OUTRO: "Outro",
}

export function rotuloTipoDocumento(tipo: string | null | undefined): string | null {
  if (!tipo) return null
  return TIPO_DOCUMENTO_LABELS[tipo] ?? tipo
}

/**
 * O ESTADO DOCUMENTAL em português — o que o REGISTRO é hoje.
 *
 * Fica aqui, ao lado dos rótulos de tipo, porque esta é a camada de leitura da
 * Central: a tela recebe a frase pronta e não traduz enum. É informação
 * SECUNDÁRIA da linha — "Solicitado" descreve o documento, não o trabalho, e
 * nunca ocupa o lugar do status operacional da Tarefa.
 */
export const DOCUMENTO_STATUS_LABELS: Record<string, string> = {
  PENDENTE: "Pendente",
  SOLICITADO: "Solicitado",
  EM_BUSCA: "Em busca",
  SOLICITAR: "Solicitar",
  RECEBIDO: "Recebido",
  EM_ANALISE: "Em análise",
  RETIFICANDO: "Retificando",
  EM_TRADUCAO: "Em tradução",
  TRADUZIDO: "Traduzido",
  EM_APOSTILAMENTO: "Em apostilamento",
  APOSTILADO: "Apostilado",
  ENTREGUE: "Entregue",
  INVALIDO: "Inválido",
  NAO_ENCONTRADO: "Não encontrado",
  CANCELADO: "Cancelado",
}

const STATUS_NECESSIDADE_LABELS: Record<string, string> = {
  PENDENTE: "A localizar",
  EM_ATENDIMENTO: "Em atendimento",
  ATENDIDA: "Registro localizado",
  NAO_LOCALIZADA: "Não localizada",
  DISPENSADA: "Dispensada",
  SUPERSEDIDA: "Substituída",
}

// ============================================================
// OBSERVABILIDADE — registro estruturado, um evento por ocorrência.
// ============================================================

type EventoEstrutura =
  | "ALVO_AUSENTE"
  | "ALVO_SEM_DONO"
  | "INSTANCIA_DUPLICADA"
  | "PASSO_SEM_EXECUTOR"

export interface DiagnosticoEstrutura {
  evento: EventoEstrutura
  processoId: number
  faseMacroKey: string | null
  detalhe: Record<string, unknown>
}

function registrar(d: DiagnosticoEstrutura): void {
  // Mesmo formato dos demais emissores da Central: prefixo estável + JSON, para que a
  // ocorrência seja localizável nos logs de runtime sem depender de texto livre.
  console.warn(`[estrutura-operacional] ${d.evento}`, JSON.stringify(d))
}

// ============================================================
// CONTRATO
// ============================================================

export interface EstruturaFaseContexto {
  processoId: number
  /** Fase consultada (ativa ou passada). null ⇒ processo sem fase — estrutura vazia. */
  faseMacroKey: string | null
  /** Instância da fase. Presente ⇒ escopa a leitura àquela instância/ciclo. */
  workflowInstanceId?: number | null
}

export interface EstruturaFaseResultado {
  estrutura: EstruturaOperacional
  /** Ocorrências detectadas nesta leitura (também emitidas no log estruturado). */
  diagnosticos: DiagnosticoEstrutura[]
  /**
   * CICLO DA OBRIGAÇÃO por necessidade — parte da IDENTIDADE da tarefa.
   *
   * Não é o ciclo da FASE: a fase sobe de ciclo a cada ida e volta, a obrigação
   * só sobe quando a exigência é outra. Quem procura a tarefa de um documento
   * precisa do ciclo certo, senão não encontra a que existe.
   */
  cicloDaObrigacao: Map<number, number>
}

/** Roster já carregado pelo chamador (evita reler a árvore na mesma requisição). */
export interface EstruturaFaseOpcoes {
  pessoas?: PessoaDoProcesso[]
  agora?: Date
  db?: Prisma.TransactionClient | typeof prisma
}

const ESTRUTURA_VAZIA: EstruturaOperacional = {
  resumo: {
    documentos: 0,
    documentosConcluidos: 0,
    documentosPendentes: 0,
    documentosDivergentes: 0,
    documentosVencidos: 0,
    passosObrigatorios: 0,
    passosObrigatoriosConcluidos: 0,
    pessoasComTrabalho: 0,
  },
  linhaPrincipal: [],
  foraDaLinha: [],
  pendenteClassificacao: [],
  globais: [],
  semDono: [],
}

/**
 * ESTRUTURA OPERACIONAL DA FASE — a consulta oficial da Central.
 *
 * Escopo da leitura: processo + fase (+ instância, quando a fase consultada não é a
 * ativa). Instâncias SUPERSEDIDO/CANCELADO ficam fora: saíram do fluxo, não são
 * trabalho. Nada mais filtra — agrupar não é esconder.
 */
export async function getPhaseOperationalStructure(
  ctx: EstruturaFaseContexto,
  opcoes: EstruturaFaseOpcoes = {},
): Promise<EstruturaFaseResultado> {
  const db = opcoes.db ?? prisma
  const agora = opcoes.agora ?? new Date()
  const diagnosticos: DiagnosticoEstrutura[] = []
  const diag = (evento: EventoEstrutura, detalhe: Record<string, unknown>) => {
    const d: DiagnosticoEstrutura = { evento, processoId: ctx.processoId, faseMacroKey: ctx.faseMacroKey, detalhe }
    diagnosticos.push(d)
    registrar(d)
  }

  if (!ctx.faseMacroKey) return { estrutura: ESTRUTURA_VAZIA, diagnosticos, cicloDaObrigacao: new Map() }

  // ------------------------------------------------------------
  // 1) ROSTER — vínculo oficial com a árvore. A pessoa existe na Central por estar
  //    na árvore do processo, nunca por ter documento ou tarefa.
  // ------------------------------------------------------------
  let pessoas = opcoes.pessoas
  if (!pessoas) {
    const proc = await db.processo.findUnique({
      where: { id: ctx.processoId },
      select: { arvoreId: true },
    })
    if (!proc?.arvoreId) {
      pessoas = []
    } else {
      const [brutas, unioes] = await Promise.all([
        db.pessoa.findMany({
          where: { arvoreId: proc.arvoreId },
          select: {
            id: true, nome: true, sobrenome: true, sexo: true, publicCode: true,
            numeroLinhagem: true, requerente: true, linhaReta: true, paiId: true, maeId: true,
          },
        }),
        db.uniao.findMany({
          where: { OR: [{ pessoa1: { arvoreId: proc.arvoreId } }, { pessoa2: { arvoreId: proc.arvoreId } }] },
          select: { id: true, pessoa1Id: true, pessoa2Id: true },
        }),
      ])
      pessoas = montarPessoasDoProcesso(brutas, unioes)
    }
  }

  // ------------------------------------------------------------
  // 2) INSTÂNCIAS DA FASE — a fonte única do trabalho.
  //
  // ESCOPO POR CICLO, sempre. Quando o chamador não diz qual instância quer, a
  // leitura resolve a VIGENTE em vez de aceitar todos os ciclos da fase: depois de
  // um retorno ou de uma movimentação manual, a fase tem mais de um ciclo, e somar
  // os dois mostra um estado que não existe em nenhum deles.
  // ------------------------------------------------------------
  const instanciaAlvo =
    ctx.workflowInstanceId ??
    (await resolverInstanciaVigente(ctx.processoId, ctx.faseMacroKey, db))?.id ??
    null

  const instancias = instanciaAlvo == null ? [] : await db.phaseWorkflowStepInstance.findMany({
    where: {
      processoId: ctx.processoId,
      faseMacroKey: ctx.faseMacroKey,
      status: { notIn: ["SUPERSEDIDO", "CANCELADO"] },
      workflowInstanceId: instanciaAlvo,
    },
    orderBy: [{ ciclo: "desc" }, { ordem: "asc" }, { id: "asc" }],
    select: {
      id: true, stepKey: true, stepDefinitionId: true, ordem: true, status: true,
      obrigatorio: true, pessoaId: true, necessidadeId: true, documentoId: true,
      responsavelId: true, prazo: true, slaDays: true, motivo: true, snapshot: true,
      ciclo: true, dependeDeStepKeys: true,
    },
  })

  // Fase sem instância materializada: as PESSOAS continuam aparecendo (o roster não
  // depende de trabalho). O que falta é workflow publicado, e isso a tela diz.
  if (instancias.length === 0) {
    return { estrutura: montarEstruturaOperacional({ pessoas, passos: [], alvos: [] }), diagnosticos, cicloDaObrigacao: new Map() }
  }

  // ------------------------------------------------------------
  // 3) ALVOS — as entidades reais que as instâncias apontam.
  // ------------------------------------------------------------
  const docIds = [...new Set(instancias.map((s) => s.documentoId).filter((x): x is number => x != null))]
  const respIds = [...new Set(instancias.map((s) => s.responsavelId).filter((x): x is number => x != null))]

  const SELECT_NECESSIDADE = {
    id: true, pessoaId: true, status: true, matrizSnapshot: true, ciclo: true,
    itemCatalogo: { select: { name: true } },
    // Certidão de casamento tem a UNIÃO como sujeito. O titular operacional é
    // pessoa1 — mesma régua do motor documental, nunca uma escolha de tela.
    uniao: {
      select: {
        pessoa1Id: true,
        pessoa1: { select: { nome: true, sobrenome: true } },
        pessoa2: { select: { nome: true, sobrenome: true } },
      },
    },
    documentos: { select: { id: true } },
  } as const

  const [documentos, responsaveis] = await Promise.all([
    docIds.length
      ? db.documento.findMany({
          where: { id: { in: docIds } },
          // `documentTypeId` é o que permite casar Documento com Necessidade por
          // ID quando a FK `necessidadeId` não foi gravada — sem ele, a mesma
          // obrigação virava duas linhas.
          select: { id: true, pessoaId: true, tipo: true, status: true, necessidadeId: true, documentTypeId: true },
        })
      : Promise.resolve([]),
    respIds.length
      ? db.usuario.findMany({ where: { id: { in: respIds } }, select: { id: true, nome: true } })
      : Promise.resolve([]),
  ])

  // NECESSIDADES a carregar: as apontadas pelas instâncias MAIS as apontadas pelos
  // documentos que elas alcançam. Numa fase que opera por DOCUMENTO (a Emissão), a
  // instância só carrega `documentoId` — mas o alvo operacional continua sendo a
  // certidão exigida, e é dela que saem o requisito, o país e o titular. Sem esta
  // segunda origem, toda certidão da Emissão ficava sem identidade e sem dono.
  const necIds = [
    ...new Set([
      ...instancias.map((s) => s.necessidadeId).filter((x): x is number => x != null),
      ...documentos.map((d) => d.necessidadeId).filter((x): x is number => x != null),
    ]),
  ]
  const necessidades = necIds.length
    ? await db.necessidadeDocumental.findMany({ where: { id: { in: necIds } }, select: SELECT_NECESSIDADE })
    : []

  const necMap = new Map(necessidades.map((n) => [n.id, n]))
  const docMap = new Map(documentos.map((d) => [d.id, d]))
  const respMap = new Map(responsaveis.map((u) => [u.id, u.nome]))

  // CADASTRO MESTRE dos tipos documentais: code → nome e code → id. É a fonte do
  // nome exibido da obrigação e do casamento por ID entre Documento e Necessidade.
  const tiposCadastro = await db.tipoDocumentoCadastro.findMany({ select: { id: true, code: true, name: true } })
  const nomeTipoPorCode = new Map<string, string>()
  const idTipoPorCode = new Map<string, number>()
  for (const t of tiposCadastro) {
    if (!t.code) continue
    nomeTipoPorCode.set(t.code, t.name)
    idTipoPorCode.set(t.code, t.id)
  }

  // VÍNCULO OFICIAL documento → necessidade. Une, num único alvo, o passo escopado
  // por NECESSIDADE e o escopado pelo DOCUMENTO que a atende.
  const necessidadePorDocumento = new Map<number, number>()
  for (const d of documentos) if (d.necessidadeId != null) necessidadePorDocumento.set(d.id, d.necessidadeId)
  for (const n of necessidades) for (const d of n.documentos) necessidadePorDocumento.set(d.id, n.id)

  // RECONCILIAÇÃO POR ID quando a FK não existe. Documento materializado fora do
  // caminho canônico fica com `necessidadeId` nulo; sem esta ponte, o passo dele
  // vira um alvo `documento:N` que convive com o alvo `necessidade:M` da MESMA
  // obrigação — duas linhas para a mesma exigência, cada uma com um nome.
  // O casamento é por (pessoa, tipo documental aceito). Nunca por nome.
  const tiposAceitosDaNecessidade = (n: { matrizSnapshot: unknown }): number[] => {
    const snap = (n.matrizSnapshot ?? null) as { documentosAceitos?: unknown } | null
    return codigosAceitos(snap?.documentosAceitos)
      .map((c) => idTipoPorCode.get(c))
      .filter((x): x is number => x != null)
  }
  const necPorPessoaETipo = new Map<string, number>()
  for (const n of necessidades) {
    const pid = n.pessoaId ?? n.uniao?.pessoa1Id ?? null
    if (pid == null) continue
    for (const tipoId of tiposAceitosDaNecessidade(n)) {
      const k = `${pid}:${tipoId}`
      if (!necPorPessoaETipo.has(k)) necPorPessoaETipo.set(k, n.id)
    }
  }
  for (const d of documentos) {
    if (necessidadePorDocumento.has(d.id)) continue
    if (d.pessoaId == null || d.documentTypeId == null) continue
    const nec = necPorPessoaETipo.get(`${d.pessoaId}:${d.documentTypeId}`)
    if (nec != null) necessidadePorDocumento.set(d.id, nec)
  }

  // TITULAR de cada necessidade a partir dos documentos que a atendem — o vínculo
  // Documento.pessoaId é oficial e resolve o caso em que a própria necessidade tem
  // união (casamento) ou está sem pessoa direta.
  const pessoaPorNecessidade = new Map<number, number>()
  const documentoPorNecessidade = new Map<number, number>()
  for (const d of documentos) {
    const nec = necessidadePorDocumento.get(d.id)
    if (nec == null) continue
    if (!pessoaPorNecessidade.has(nec)) pessoaPorNecessidade.set(nec, d.pessoaId)
    if (!documentoPorNecessidade.has(nec)) documentoPorNecessidade.set(nec, d.id)
  }

  // ------------------------------------------------------------
  // 4) RÓTULOS — do SNAPSHOT publicado; catálogo e stepKey só como último recurso.
  // ------------------------------------------------------------
  const faseCode = phaseKeyToFaseCode(ctx.faseMacroKey)
  const catalogo = faseCode ? getStepsForFase(faseCode as FaseCode) : []
  const tituloDoPasso = (stepKey: string, snapshot: unknown): string => {
    if (snapshot && typeof snapshot === "object") {
      for (const chave of ["titulo", "label"] as const) {
        const v = (snapshot as Record<string, unknown>)[chave]
        if (typeof v === "string" && v.trim()) return v
      }
    }
    return catalogo.find((c) => c.stepKey === stepKey)?.title ?? stepKey
  }

  // NOME DA OBRIGAÇÃO — do Cadastro Mestre quando a regra aponta para um único
  // documento aceito. `matrizSnapshot.requisito` é texto administrativo da regra
  // e não pode nomear documento: era ele que fazia "Certidão de Nascimento"
  // aparecer ao lado de "Certidão de nascimento - Inteiro Teor" como se fossem
  // duas obrigações da mesma pessoa.
  const requisitoDaNecessidade = (n: {
    matrizSnapshot: unknown
    itemCatalogo: { name: string } | null
  }): string | null => {
    const snap = (n.matrizSnapshot ?? null) as { requisito?: unknown; documentosAceitos?: unknown } | null
    return nomeCanonicoDaObrigacao({
      documentosAceitos: snap?.documentosAceitos,
      requisitoNome: typeof snap?.requisito === "string" ? snap.requisito : null,
      itemCatalogoNome: n.itemCatalogo?.name ?? null,
      nomePorCode: (code) => nomeTipoPorCode.get(code) ?? null,
    })
  }

  const paisDaNecessidade = (n: { matrizSnapshot: unknown }): string | null => {
    const snap = n.matrizSnapshot
    if (snap && typeof snap === "object") {
      for (const chave of ["pais", "paisOrigem", "country"] as const) {
        const v = (snap as Record<string, unknown>)[chave]
        if (typeof v === "string" && v.trim()) return v
      }
    }
    return null
  }

  // A RÉGUA DO PRAZO É A CANÔNICA — a mesma da Minha Fila e das notificações.
  //
  // Aqui havia um `Math.floor((alvo - base)/86400000)`: blocos de 24 HORAS a
  // partir do instante. Às 23h de 14/08, com prazo em 15/08 às 09h, esta tela
  // dizia "vence hoje" e a fila dizia "vence amanhã" — a mesma tarefa, duas
  // respostas, e o operador sem saber em qual acreditar.
  const diffDias = (alvo: Date, base: Date) => diasEntreDiasOperacionais(alvo, base)

  // ------------------------------------------------------------
  // 5) INSTÂNCIAS → PassoBruto (rótulos resolvidos, alvo intacto).
  // ------------------------------------------------------------
  const passos: PassoBruto[] = instancias.map((s) => {
    const escopo = escopoDoAlvo(s)
    // EXECUTOR: qual tela oficial abre este passo. Hoje há UM — a operação por
    // documento/necessidade. Passo sem entidade não tem executor: continua VISÍVEL e
    // diz, em texto, que falta configuração. Esconder seria mentir sobre o trabalho.
    const executor: PassoBruto["executor"] =
      s.necessidadeId != null || s.documentoId != null ? "OPERACAO_DOCUMENTO" : null
    const titulo = tituloDoPasso(s.stepKey, s.snapshot)
    const erroAdministrativo = executor
      ? null
      : `Sem executor para este passo. "${titulo}" está publicado com escopo ${escopo} na fase "${ctx.faseMacroKey}", e o único executor disponível opera sobre documento/necessidade. Ajuste o escopo do passo em Gerenciamento › Workflows das Fases, ou publique o requisito documental que gera a entidade.`

    if (executor == null && escopo !== "PROCESSO") {
      diag("PASSO_SEM_EXECUTOR", { stepInstanceId: s.id, stepKey: s.stepKey, escopo })
    }
    if (escopo !== "PROCESSO" && s.pessoaId == null && s.necessidadeId == null && s.documentoId == null) {
      diag("ALVO_AUSENTE", { stepInstanceId: s.id, stepKey: s.stepKey })
    }

    const dep = Array.isArray(s.dependeDeStepKeys)
      ? (s.dependeDeStepKeys as unknown[]).filter((x): x is string => typeof x === "string")
      : []

    return {
      stepInstanceId: s.id,
      stepDefinitionId: s.stepDefinitionId,
      stepKey: s.stepKey,
      titulo,
      ordem: s.ordem,
      obrigatorio: s.obrigatorio,
      status: s.status,
      ciclo: s.ciclo,
      pessoaId: s.pessoaId,
      necessidadeId: s.necessidadeId,
      documentoId: s.documentoId,
      responsavelId: s.responsavelId,
      responsavelNome: s.responsavelId != null ? respMap.get(s.responsavelId) ?? null : null,
      prazo: s.prazo?.toISOString() ?? null,
      diasParaPrazo: s.prazo ? diffDias(s.prazo, agora) : null,
      slaDays: s.slaDays ?? null,
      motivo: s.motivo ?? null,
      executor,
      erroAdministrativo,
      dependeDeStepKeys: dep,
      // PESO CANÔNICO, resolvido pelo mesmo lookup tolerante a alias que a aba
      // Workflow usa: a instância pode carregar a chave legada enquanto o
      // catálogo tem a publicada, e cair para 1 silenciosamente distorceria o
      // progresso de todos os documentos da fase.
      peso: getStepDef(faseCode, s.stepKey)?.weight ?? 1,
    }
  })

  // DUPLICIDADE: a mesma definição de passo, no mesmo alvo e no mesmo ciclo, não pode
  // ter duas instâncias. A trava real é o índice único de chaveIdempotencia; esta
  // verificação é o alarme que revela uma trava furada em vez de exibir a duplicata.
  const vistos = new Map<string, number>()
  for (const p of passos) {
    const identidade = `${p.stepDefinitionId ?? p.stepKey}|${chaveDoAlvo(p, necessidadePorDocumento)}|${p.ciclo}`
    const anterior = vistos.get(identidade)
    if (anterior != null) {
      diag("INSTANCIA_DUPLICADA", { identidade, stepInstanceIds: [anterior, p.stepInstanceId] })
    } else {
      vistos.set(identidade, p.stepInstanceId)
    }
  }

  // ------------------------------------------------------------
  // 6) ALVOS — identidade, dono e rótulo de cada bloco da tela.
  // ------------------------------------------------------------
  const alvos: AlvoBruto[] = []
  const chavesUsadas = new Set(passos.map((p) => chaveDoAlvo(p, necessidadePorDocumento)))

  for (const n of necessidades) {
    const chave = `necessidade:${n.id}`
    if (!chavesUsadas.has(chave)) continue
    // Dono: a pessoa da necessidade; para certidão de união, o titular é pessoa1 —
    // a MESMA regra que o motor documental já aplica ao criar o Documento. Em último
    // caso, o titular do próprio Documento que atende a necessidade (vínculo oficial).
    const pessoaId = n.pessoaId ?? n.uniao?.pessoa1Id ?? pessoaPorNecessidade.get(n.id) ?? null
    const nomesUniao = n.uniao
      ? [n.uniao.pessoa1, n.uniao.pessoa2]
          .filter((x): x is { nome: string; sobrenome: string | null } => x != null)
          .map((x) => nomeCompletoPessoa(x))
          .join(" e ")
      : null
    alvos.push({
      chave,
      escopo: "NECESSIDADE",
      pessoaId,
      necessidadeId: n.id,
      documentoId: documentoPorNecessidade.get(n.id) ?? n.documentos[0]?.id ?? null,
      titulo: requisitoDaNecessidade(n) ?? `Registro #${n.id}`,
      subtitulo: nomesUniao,
      statusLabel: STATUS_NECESSIDADE_LABELS[String(n.status)] ?? String(n.status),
      pais: paisDaNecessidade(n),
    })
  }

  for (const d of documentos) {
    const chave = `documento:${d.id}`
    if (!chavesUsadas.has(chave)) continue // já normalizado para a necessidade
    alvos.push({
      chave,
      escopo: "DOCUMENTO",
      pessoaId: d.pessoaId,
      necessidadeId: d.necessidadeId ?? null,
      documentoId: d.id,
      titulo: rotuloTipoDocumento(d.tipo) ?? `Documento #${d.id}`,
      subtitulo: null,
      statusLabel: String(d.status),
      pais: null,
    })
  }

  const estrutura = montarEstruturaOperacional({ pessoas, passos, alvos, necessidadePorDocumento })

  for (const a of estrutura.semDono) {
    diag("ALVO_SEM_DONO", { chave: a.chave, necessidadeId: a.necessidadeId, documentoId: a.documentoId })
  }

  return { estrutura, diagnosticos, cicloDaObrigacao: new Map(necessidades.map((n) => [n.id, n.ciclo])) }
}

// ============================================================
// ÍNDICE OPERACIONAL — o que a TELA PRINCIPAL consome
// ------------------------------------------------------------
// A Central Operacional é um ÍNDICE (pessoa → documento → "Abrir detalhes"); quem
// EXECUTA é o modal do documento, na aba Workflow. Esta consulta devolve SÓ o que o
// índice pode mostrar: pessoa, documentos, artefatos, status final e contadores.
//
// Passo, status de passo, responsável, SLA, prazo, bloqueio e operação antecipada
// NÃO atravessam — não por filtro de renderização, mas porque não estão no DTO. Um
// processo com 20 instâncias de passo não manda 20 instâncias para uma tela que não
// as usa.
// ============================================================

/** Estado do artefato a partir do registro do Documento. */
function statusArtefato(feito: boolean, emAndamento: boolean): StatusResumo {
  if (feito) return "PRONTO"
  return emAndamento ? "EM_ANDAMENTO" : "NAO_APLICAVEL"
}

export interface IndiceFaseResultado {
  indice: IndiceOperacional
  diagnosticos: DiagnosticoEstrutura[]
}

export async function getPhaseOperationalSummary(
  ctx: EstruturaFaseContexto,
  opcoes: EstruturaFaseOpcoes = {},
): Promise<IndiceFaseResultado> {
  const db = opcoes.db ?? prisma
  const { estrutura, diagnosticos, cicloDaObrigacao } = await getPhaseOperationalStructure(ctx, opcoes)

  // ARTEFATOS — colunas "Certidão retificada", "Tradução" e "Apostila" da tabela.
  // Vêm dos registros OFICIAIS do documento; o que o domínio não registra fica
  // "Não aplicável", nunca um estado inventado só para preencher coluna.
  const alvos = [
    ...estrutura.linhaPrincipal.flatMap((p) => p.documentos),
    ...estrutura.foraDaLinha.flatMap((p) => p.documentos),
    ...estrutura.pendenteClassificacao.flatMap((p) => p.documentos),
    ...estrutura.semDono,
  ]
  const docIds = alvos.map((a) => a.documentoId).filter((x): x is number => x != null)
  const artefatos: ArtefatosPorChave = new Map()

  // ────────────────────────────────────────────────────────────────────────────
  // A TAREFA CANÔNICA DE CADA DOCUMENTO — responsável, prazo e status da linha.
  //
  // A tabela lia os três do PASSO CORRENTE, que tem campos com nomes parecidos e
  // significado outro: `responsavelId` do passo é quem executa AQUELA etapa,
  // `prazo` do passo é até quando ELA corre. Em produção os cinco passos da
  // certidão do Ademir estavam com responsável nulo enquanto a Tarefa era da
  // Daniela — a tabela dizia "Sem responsável", o drawer dizia "Daniela Brait",
  // e a Minha Fila dizia "Daniela Brait". Duas verdades para o mesmo trabalho.
  //
  // A identidade da tarefa NÃO é resolvida aqui: vem de `identidade-da-tarefa`,
  // o dono único da pergunta "qual é a tarefa desta obrigação". Aqui só se
  // pergunta por TODAS as unidades da fase de uma vez — 1 consulta, não 500.
  // ────────────────────────────────────────────────────────────────────────────
  const unidades: UnidadeDeTrabalho[] = []
  const unidadePorChave = new Map<string, UnidadeDeTrabalho>()
  for (const a of alvos) {
    if (a.necessidadeId == null && a.documentoId == null) continue
    const u: UnidadeDeTrabalho = {
      processoId: ctx.processoId,
      necessidadeId: a.necessidadeId,
      documentoId: a.documentoId,
      pessoaId: a.pessoaId,
      // O ciclo da OBRIGAÇÃO. Sem necessidade registrada não há obrigação a
      // consultar, e o ciclo 1 é o que a materialização grava nesse caso.
      ciclo: (a.necessidadeId != null ? cicloDaObrigacao.get(a.necessidadeId) : null) ?? 1,
    }
    unidades.push(u)
    unidadePorChave.set(a.chave, u)
  }
  const vivas = await tarefasVivasDasUnidades(db, unidades)
  const tarefas: TarefasPorChave = new Map()
  for (const [chave, u] of unidadePorChave) {
    const t = vivas.get(chaveDaUnidade(u))
    if (!t) continue
    tarefas.set(chave, {
      taskId: t.id,
      statusTarefa: t.statusTarefa,
      responsavelId: t.responsavelId,
      responsavelNome: t.responsavelNome,
      dataPrazo: t.dataPrazo?.toISOString() ?? null,
      dataConclusao: t.dataConclusao?.toISOString() ?? null,
      slaPausadoEm: t.slaPausadoEm?.toISOString() ?? null,
      slaPausaAcumuladaMin: t.slaPausaAcumuladaMin,
      criadaEm: t.criadaEm?.toISOString() ?? null,
    })
  }

  if (docIds.length > 0) {
    const [documentos, retificadas] = await Promise.all([
      db.documento.findMany({
        where: { id: { in: docIds } },
        select: { id: true, status: true, traduzido: true, apostilado: true },
      }),
      db.emissaoRetificada.findMany({
        where: { processoId: ctx.processoId, documentoId: { in: docIds } },
        select: { documentoId: true, status: true, retifiedValidated: true },
      }),
    ])
    const docMap = new Map(documentos.map((d) => [d.id, d]))
    const retMap = new Map(retificadas.map((r) => [r.documentoId, r]))

    for (const a of alvos) {
      if (a.documentoId == null) continue
      const d = docMap.get(a.documentoId)
      const r = retMap.get(a.documentoId)
      if (!d && !r) continue
      artefatos.set(a.chave, {
        // A CERTIDÃO em si segue o workflow da fase (statusFinalDoAlvo); só o
        // INVALIDADO vem do registro, porque é estado do documento, não do passo.
        certidao: d?.status === "INVALIDO" ? "INVALIDADO" : undefined,
        retificada: r ? (r.retifiedValidated ? "PRONTO" : "EM_ANDAMENTO") : "NAO_APLICAVEL",
        traducao: statusArtefato(
          d?.traduzido === true || d?.status === "TRADUZIDO",
          d?.status === "EM_TRADUCAO",
        ),
        apostila: statusArtefato(
          d?.apostilado === true || d?.status === "APOSTILADO",
          d?.status === "EM_APOSTILAMENTO",
        ),
        // ESTADO DOCUMENTAL — o que o REGISTRO é hoje. Vem junto (mesma leitura,
        // zero consulta a mais) e a tela o mostra como informação secundária: ele
        // responde "o que é este documento", não "como vai o trabalho".
        statusDocumentalLabel: d ? DOCUMENTO_STATUS_LABELS[String(d.status)] ?? String(d.status) : null,
      })
    }
  }

  return { indice: montarIndiceOperacional(estrutura, artefatos, tarefas), diagnosticos }
}
