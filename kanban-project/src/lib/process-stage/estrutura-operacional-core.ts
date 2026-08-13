// src/lib/process-stage/estrutura-operacional-core.ts
//
// NÚCLEO PURO (sem Prisma, sem I/O) da ESTRUTURA OPERACIONAL DA FASE.
//
// PROBLEMA QUE ESTE ARQUIVO RESOLVE
// ---------------------------------
// A Central agrupava as instâncias de passo POR PASSO PUBLICADO: "Solicitar
// certidão" aparecia uma vez e, dentro dele, as certidões de todas as pessoas
// misturadas. Para uma fase documental isso descreve o cadastro, não o trabalho: o
// operador não executa "Solicitar certidão", ele executa "a certidão de nascimento
// da Tereza" — e essa certidão tem a sequência inteira do workflow só dela.
//
// A hierarquia REAL da execução é:
//
//     PESSOA → DOCUMENTO/CERTIDÃO → WORKFLOW DA FASE APLICADO ÀQUELE DOCUMENTO
//            → PASSOS → EXECUÇÃO
//
// O QUE ESTE NÚCLEO É — E O QUE NÃO É
// -----------------------------------
// É uma REORGANIZAÇÃO das instâncias oficiais já materializadas pelo domínio. Não
// cria passo, não cria tarefa, não infere sequência, não inventa alvo, não deriva
// nada de texto. Cada passo já chega com o seu ALVO PERSISTIDO
// (PhaseWorkflowStepInstance.pessoaId / necessidadeId / documentoId), gravado na
// materialização a partir da CARDINALIDADE publicada do passo. Aqui só se agrupa por
// esses IDs e se contam obrigatórios.
//
// PROGRESSO
// ---------
// Documento = passos obrigatórios concluídos DELE / obrigatórios DELE.
// Pessoa    = soma dos obrigatórios concluídos dos alvos dela / soma dos obrigatórios.
// O PERCENTUAL DA FASE **não** é calculado aqui de propósito: a fonte única dele é a
// projeção operacional canônica (resolveOperationalProjection), que pondera por
// ENTIDADE do escopo da fase e governa também o gate de avanço. Um segundo percentual
// da fase seria uma segunda fonte de verdade. O resumo devolve CONTADORES (documentos,
// concluídos, pendentes, divergentes, vencidos e passos obrigatórios), que são
// informação nova, não um número rival.

import type { PessoaDoProcesso } from "./central-operacional-core"
import { baldeDoPasso, rotuloStatusPasso, type BaldeTarefa } from "./central-operacional-core"

// ============================================================
// ENTRADA — o que a camada de I/O carrega e entrega já resolvido
// ============================================================

/** Escopo do alvo, LIDO da entidade que a instância carrega (nunca inferido por nome). */
export type EscopoAlvo = "PROCESSO" | "PESSOA" | "NECESSIDADE" | "DOCUMENTO"

/** Uma instância de passo (PhaseWorkflowStepInstance) já com os rótulos resolvidos. */
export interface PassoBruto {
  stepInstanceId: number
  /** Id da DEFINIÇÃO publicada (PhaseInternalWorkflowStep). Identidade estrutural. */
  stepDefinitionId: number | null
  stepKey: string
  /** Rótulo vindo do SNAPSHOT do passo publicado — nunca inventado aqui. */
  titulo: string
  ordem: number
  obrigatorio: boolean
  /** StepInstanceStatus persistido. */
  status: string
  ciclo: number
  pessoaId: number | null
  necessidadeId: number | null
  documentoId: number | null
  responsavelId: number | null
  responsavelNome: string | null
  prazo: string | null
  diasParaPrazo: number | null
  slaDays: number | null
  motivo: string | null
  /** Executor oficial que abre este passo. null ⇒ falta configuração (nunca esconder). */
  executor: "OPERACAO_DOCUMENTO" | null
  erroAdministrativo: string | null
  /** Dependências PERSISTIDAS (por stepKey da definição), do modo de execução publicado. */
  dependeDeStepKeys: string[]
  /**
   * PESO CANÔNICO do passo, do catálogo da fase. Não é enfeite: a Emissão
   * Documental pesa 25/10/18/15/12, e contar 1/5 para cada um diria que
   * "Aguardar retorno do cartório" vale o mesmo que "Solicitar certidão".
   * Ausente ⇒ 1, que é a contagem simples — nunca zero, que apagaria o passo.
   */
  peso: number
}

/** O alvo concreto sobre o qual o workflow opera, com a identidade já resolvida. */
export interface AlvoBruto {
  /** Identidade lógica do alvo — SEMPRE por id oficial, nunca por título. */
  chave: string
  escopo: EscopoAlvo
  pessoaId: number | null
  necessidadeId: number | null
  documentoId: number | null
  /** "Certidão de Nascimento" — rótulo do requisito/tipo, vindo do cadastro. */
  titulo: string
  subtitulo: string | null
  /** Estado do próprio alvo (necessidade/documento), não do workflow. */
  statusLabel: string | null
  pais: string | null
}

export interface EstruturaInput {
  /** Roster oficial (vínculo Pessoa.arvoreId = Processo.arvoreId). */
  pessoas: PessoaDoProcesso[]
  passos: PassoBruto[]
  alvos: AlvoBruto[]
  /**
   * Documento → necessidade que ele atende (vínculo oficial Documento.necessidadeId).
   * Une, num único alvo, o passo escopado por NECESSIDADE e o escopado pelo DOCUMENTO
   * que a atende — senão a mesma certidão apareceria em dois lugares.
   */
  necessidadePorDocumento?: Map<number, number>
}

// ============================================================
// SAÍDA — pronta para apresentação, sem regra de negócio no frontend
// ============================================================

export interface PassoDaEstrutura {
  stepInstanceId: number
  stepDefinitionId: number | null
  stepKey: string
  titulo: string
  ordem: number
  obrigatorio: boolean
  status: string
  statusLabel: string
  balde: BaldeTarefa
  /** Pode ser executado agora (estado PERSISTIDO, não regra do frontend). */
  disponivel: boolean
  bloqueado: boolean
  /** Peso canônico deste passo dentro do workflow da fase. */
  peso: number
  /** Por que está parado. Vem do motivo persistido ou da dependência publicada. */
  motivoBloqueio: string | null
  responsavelId: number | null
  responsavelNome: string | null
  prazo: string | null
  diasParaPrazo: number | null
  slaDays: number | null
  vencido: boolean
  executor: "OPERACAO_DOCUMENTO" | null
  erroAdministrativo: string | null
  pessoaId: number | null
  necessidadeId: number | null
  documentoId: number | null
}

export interface ProgressoEstrutura {
  /** Passos obrigatórios concluídos — a fração que a pessoa lê ("2 de 5"). */
  concluidos: number
  total: number
  /** Percentual PONDERADO pelo peso canônico dos passos. */
  pct: number
  /** Pontos feitos e possíveis — o que explica o percentual quando ele não é n/N. */
  pontosFeitos: number
  pontosTotais: number
}

/** Um alvo com o workflow COMPLETO da fase aplicado só a ele. */
export interface AlvoDaEstrutura {
  chave: string
  escopo: EscopoAlvo
  necessidadeId: number | null
  documentoId: number | null
  pessoaId: number | null
  titulo: string
  subtitulo: string | null
  statusLabel: string | null
  pais: string | null
  progresso: ProgressoEstrutura
  concluido: boolean
  divergente: boolean
  vencido: boolean
  passos: PassoDaEstrutura[]
}

export interface PessoaDaEstrutura {
  pessoa: PessoaDoProcesso
  /** Documentos/certidões aplicáveis A ESTA PESSOA nesta fase. */
  documentos: AlvoDaEstrutura[]
  /** Passos de escopo PESSOA (sem documento) — trabalho da pessoa, não de um doc. */
  passosDaPessoa: PassoDaEstrutura[]
  progresso: ProgressoEstrutura
  pendentes: number
  divergentes: number
  /** Sem documento e sem passo aplicável — estado explícito, nunca some da lista. */
  semTrabalhoAplicavel: boolean
}

export interface ResumoEstrutura {
  documentos: number
  documentosConcluidos: number
  documentosPendentes: number
  documentosDivergentes: number
  documentosVencidos: number
  passosObrigatorios: number
  passosObrigatoriosConcluidos: number
  pessoasComTrabalho: number
}

export interface EstruturaOperacional {
  resumo: ResumoEstrutura
  linhaPrincipal: PessoaDaEstrutura[]
  foraDaLinha: PessoaDaEstrutura[]
  pendenteClassificacao: PessoaDaEstrutura[]
  /** Passos de escopo PROCESSO — uma instância por fase/ciclo, sem dono pessoal. */
  globais: PassoDaEstrutura[]
  /**
   * Alvos cujo dono não está no roster (pessoa fora da árvore, união sem pessoa
   * resolvida). Ficam VISÍVEIS aqui em vez de desaparecer em silêncio.
   */
  semDono: AlvoDaEstrutura[]
}

// ============================================================
// DTO DE ÍNDICE — o que a TELA PRINCIPAL recebe
// ------------------------------------------------------------
// A Central Operacional é um ÍNDICE: pessoa → documento → "Abrir detalhes". Quem
// EXECUTA é o modal do documento, na aba Workflow. Por isso a tela principal não
// recebe passo, status de passo, responsável de passo, SLA, prazo, bloqueio nem
// operação antecipada: o que ela não pode mostrar, ela não precisa carregar.
//
// Os contadores e o status final são calculados AQUI, no domínio, a partir das
// instâncias oficiais — nunca contando elementos renderizados na tela.
// ============================================================

/** Estado canônico e resumido de um artefato ou do documento inteiro. */
export type StatusResumo =
  | "PENDENTE"
  | "EM_ANDAMENTO"
  | "PRONTO"
  | "DIVERGENTE"
  | "INVALIDADO"
  | "NAO_APLICAVEL"

export const ROTULO_STATUS_RESUMO: Record<StatusResumo, string> = {
  PENDENTE: "Pendente",
  EM_ANDAMENTO: "Em andamento",
  PRONTO: "Pronto",
  DIVERGENTE: "Divergente",
  INVALIDADO: "Invalidado",
  NAO_APLICAVEL: "Não aplicável",
}

/** Estado dos artefatos do documento — uma coluna cada na tabela do índice. */
export interface ArtefatosDoDocumento {
  certidao: StatusResumo
  retificada: StatusResumo
  traducao: StatusResumo
  apostila: StatusResumo
}

/**
 * O ESTADO OPERACIONAL DA TAREFA — o que a linha da fase precisa responder.
 *
 * Deriva dos passos JÁ carregados do alvo. Não é um status novo: é a mesma
 * leitura que a Minha Fila faz, escrita aqui a partir do que a fase tem em mãos.
 */
export type EstadoOperacionalDaLinha =
  | "A_FAZER"
  | "EM_ANDAMENTO"
  | "AGUARDANDO_TERCEIRO"
  | "BLOQUEADA"
  | "CONCLUIDA"

export const ROTULO_ESTADO_LINHA: Record<EstadoOperacionalDaLinha, string> = {
  A_FAZER: "A fazer",
  EM_ANDAMENTO: "Em andamento",
  AGUARDANDO_TERCEIRO: "Aguardando terceiro",
  BLOQUEADA: "Bloqueada",
  CONCLUIDA: "Concluída",
}

/**
 * COMO ESTE DOCUMENTO ESTÁ **NESTA FASE**.
 *
 * A tabela da fase respondia "já foi retificado? traduzido? apostilado?" —
 * perguntas de fases FUTURAS, que com quinhentos documentos viram ruído. A
 * pergunta desta tela é uma só: *onde este trabalho está agora*.
 *
 * Tudo aqui é DERIVADO dos passos que a estrutura já carregou. Nenhuma consulta
 * a mais, nenhum campo persistido, nenhuma segunda fonte de verdade.
 */
export interface EstadoNaFase {
  progresso: ProgressoEstrutura
  /** Nome humano do passo corrente — nunca a chave técnica. */
  etapaAtual: string | null
  responsavelId: number | null
  responsavelNome: string | null
  prazo: string | null
  /** Dias até o prazo; negativo é atraso. Derivado, nunca gravado. */
  diasParaPrazo: number | null
  atrasado: boolean
  venceHoje: boolean
  estado: EstadoOperacionalDaLinha
  estadoLabel: string
  /** Por que está parado, quando está. */
  motivoBloqueio: string | null
}

/** Uma LINHA da tabela de documentos da pessoa. Sem nada de execução. */
export interface DocumentoDoIndice {
  chave: string
  documentoId: number | null
  necessidadeId: number | null
  /** Titular do documento — o modal precisa dele para a Operação Antecipada. */
  pessoaId: number | null
  titulo: string
  tipoLabel: string | null
  pais: string | null
  artefatos: ArtefatosDoDocumento
  statusFinal: StatusResumo
  statusFinalLabel: string
  /** COMO ESTE DOCUMENTO ESTÁ NESTA FASE — o que a tabela da fase exibe. */
  naFase: EstadoNaFase
  /** Há executor oficial para abrir o detalhe deste documento. */
  podeAbrirDetalhes: boolean
  /** Falta de configuração, dita em texto. O documento nunca é escondido. */
  impedimento: string | null
}

export interface PessoaDoIndice {
  pessoa: PessoaDoProcesso
  documentos: DocumentoDoIndice[]
  totais: { documentos: number; prontos: number; pendentes: number; divergentes: number }
  semDocumentoAplicavel: boolean
}

export interface ResumoDoIndice {
  documentos: number
  prontos: number
  pendentes: number
  divergentes: number
  pessoasComTrabalho: number
}

export interface IndiceOperacional {
  resumo: ResumoDoIndice
  linhaPrincipal: PessoaDoIndice[]
  foraDaLinha: PessoaDoIndice[]
  pendenteClassificacao: PessoaDoIndice[]
  /** Documentos sem pessoa no roster — visíveis, nunca descartados em silêncio. */
  semDono: DocumentoDoIndice[]
}

// ============================================================
// REGRAS DE ESTADO — únicas, derivadas do status PERSISTIDO
// ============================================================

/** Estados em que o passo pode ser trabalhado agora. */
const STATUS_DISPONIVEIS = new Set([
  "DISPONIVEL",
  "EM_ANDAMENTO",
  "AGUARDANDO",
  "AGUARDANDO_APROVACAO",
  "EXECUTADO",
])

/** Estados que impedem trabalhar o passo agora (mas ele continua visível). */
const STATUS_BLOQUEADOS = new Set(["PENDENTE", "BLOQUEADO", "FALHOU"])

/** Estados que representam divergência operacional real. */
const STATUS_DIVERGENTES = new Set(["BLOQUEADO", "FALHOU"])

/**
 * Identidade lógica do ALVO de uma instância. SEMPRE por id oficial.
 *
 * Ordem de resolução (a mais específica que existir):
 *   necessidade → documento (normalizado para a necessidade que ele atende, quando
 *   houver vínculo) → pessoa → processo.
 *
 * O passo escopado por NECESSIDADE e o escopado pelo DOCUMENTO que a atende são o
 * MESMO alvo operacional: sem essa normalização a mesma certidão apareceria duas
 * vezes na tela, e nenhuma das duas teria o workflow inteiro.
 */
export function chaveDoAlvo(
  p: { pessoaId: number | null; necessidadeId: number | null; documentoId: number | null },
  necessidadePorDocumento?: Map<number, number>,
): string {
  if (p.necessidadeId != null) return `necessidade:${p.necessidadeId}`
  if (p.documentoId != null) {
    const nec = necessidadePorDocumento?.get(p.documentoId)
    return nec != null ? `necessidade:${nec}` : `documento:${p.documentoId}`
  }
  if (p.pessoaId != null) return `pessoa:${p.pessoaId}`
  return "processo"
}

/** Escopo do alvo — lido da entidade vinculada, jamais do nome do passo. */
export function escopoDoAlvo(p: {
  pessoaId: number | null
  necessidadeId: number | null
  documentoId: number | null
}): EscopoAlvo {
  if (p.necessidadeId != null) return "NECESSIDADE"
  if (p.documentoId != null) return "DOCUMENTO"
  if (p.pessoaId != null) return "PESSOA"
  return "PROCESSO"
}

/**
 * O PROGRESSO É PONDERADO PELO PESO PUBLICADO — a mesma conta que a aba
 * Workflow do documento já mostrava ("0/80 pontos").
 *
 * Havia duas métricas com o mesmo nome: a tabela contava passos (2 de 5 = 40%)
 * e o drawer somava pesos (35 de 80 = 44%). Duas telas, o mesmo documento,
 * números diferentes — e nenhuma das duas errada isoladamente. Agora existe uma
 * definição só, e é a que o domínio declara.
 *
 * A FRAÇÃO continua sendo de passos, porque é assim que uma pessoa lê o
 * trabalho ("2 de 5 etapas"); o PERCENTUAL é ponderado, porque é assim que o
 * trabalho realmente pesa.
 */
function progresso(passos: PassoDaEstrutura[]): ProgressoEstrutura {
  const obrig = passos.filter((s) => s.obrigatorio)
  const total = obrig.length
  const concluidos = obrig.filter((s) => s.balde === "CONCLUIDA").length
  const pontosTotais = obrig.reduce((a, s) => a + s.peso, 0)
  const pontosFeitos = obrig.filter((s) => s.balde === "CONCLUIDA").reduce((a, s) => a + s.peso, 0)
  // Sem passo obrigatório o alvo não tem o que exigir: 0/0 é 100% de nada a fazer,
  // não 0% de trabalho parado. Contar 0% aqui inventaria pendência inexistente.
  return {
    concluidos, total, pontosFeitos, pontosTotais,
    pct: pontosTotais > 0 ? Math.round((pontosFeitos / pontosTotais) * 100) : 100,
  }
}

function somarProgresso(partes: ProgressoEstrutura[]): ProgressoEstrutura {
  const concluidos = partes.reduce((a, p) => a + p.concluidos, 0)
  const total = partes.reduce((a, p) => a + p.total, 0)
  const pontosFeitos = partes.reduce((a, p) => a + p.pontosFeitos, 0)
  const pontosTotais = partes.reduce((a, p) => a + p.pontosTotais, 0)
  return {
    concluidos, total, pontosFeitos, pontosTotais,
    pct: pontosTotais > 0 ? Math.round((pontosFeitos / pontosTotais) * 100) : 100,
  }
}

/**
 * Motivo de o passo estar parado. Duas origens, nesta ordem, ambas OFICIAIS:
 *   1. `motivo` persistido na instância (bloqueio real registrado pelo motor);
 *   2. dependência PUBLICADA (dependeDeStepKeys) ainda não concluída NO MESMO ALVO.
 * Nunca uma regra fixa de sequência escrita aqui.
 */
function motivoDoBloqueio(p: PassoBruto, irmaos: PassoBruto[]): string | null {
  if (p.motivo && p.motivo.trim()) return p.motivo.trim()
  if (!STATUS_BLOQUEADOS.has(String(p.status).toUpperCase())) return null
  if (p.dependeDeStepKeys.length === 0) return null
  const pendentes = p.dependeDeStepKeys
    .map((k) => irmaos.find((s) => s.stepKey === k))
    .filter((s): s is PassoBruto => s != null && baldeDoPasso(s.status) !== "CONCLUIDA")
  if (pendentes.length === 0) return null
  return `Aguarda: ${pendentes.map((s) => s.titulo).join(", ")}`
}

function montarPasso(p: PassoBruto, irmaos: PassoBruto[]): PassoDaEstrutura {
  const status = String(p.status).toUpperCase()
  const balde = baldeDoPasso(p.status)
  return {
    stepInstanceId: p.stepInstanceId,
    stepDefinitionId: p.stepDefinitionId,
    stepKey: p.stepKey,
    titulo: p.titulo,
    ordem: p.ordem,
    obrigatorio: p.obrigatorio,
    status: p.status,
    statusLabel: rotuloStatusPasso(p.status),
    balde,
    disponivel: STATUS_DISPONIVEIS.has(status),
    bloqueado: STATUS_BLOQUEADOS.has(status),
    peso: p.peso > 0 ? p.peso : 1,
    motivoBloqueio: motivoDoBloqueio(p, irmaos),
    responsavelId: p.responsavelId,
    responsavelNome: p.responsavelNome,
    prazo: p.prazo,
    diasParaPrazo: p.diasParaPrazo,
    slaDays: p.slaDays,
    vencido: p.diasParaPrazo != null && p.diasParaPrazo < 0 && balde !== "CONCLUIDA",
    executor: p.executor,
    erroAdministrativo: p.erroAdministrativo,
    pessoaId: p.pessoaId,
    necessidadeId: p.necessidadeId,
    documentoId: p.documentoId,
  }
}

// ============================================================
// MONTAGEM DA ESTRUTURA
// ============================================================

/**
 * Reorganiza as instâncias oficiais da fase na hierarquia de execução:
 * pessoa → alvo (documento/certidão) → passos do workflow daquele alvo.
 *
 * Determinístico: mesma entrada, mesma saída. Nenhuma instância é descartada — o que
 * não tem dono no roster sai em `semDono`, o que é da fase inteira sai em `globais`.
 */
export function montarEstruturaOperacional(input: EstruturaInput): EstruturaOperacional {
  const { pessoas, passos, alvos, necessidadePorDocumento } = input

  const alvoPorChave = new Map(alvos.map((a) => [a.chave, a]))

  // 1) Agrupa as instâncias pelo ALVO. A chave é sempre id oficial.
  const porAlvo = new Map<string, PassoBruto[]>()
  for (const p of passos) {
    const chave = chaveDoAlvo(p, necessidadePorDocumento)
    const lista = porAlvo.get(chave)
    if (lista) lista.push(p)
    else porAlvo.set(chave, [p])
  }

  // 2) Passos de escopo PROCESSO — pertencem à fase, não a uma pessoa.
  const brutosGlobais = porAlvo.get("processo") ?? []
  const globais = ordenar(brutosGlobais).map((p) => montarPasso(p, brutosGlobais))
  porAlvo.delete("processo")

  // 3) Cada alvo restante vira um bloco com o workflow completo DELE.
  const blocos: AlvoDaEstrutura[] = []
  const passosPorPessoa = new Map<number, PassoBruto[]>()

  for (const [chave, brutos] of porAlvo) {
    // Escopo PESSOA: não é um documento; é trabalho da própria pessoa.
    if (chave.startsWith("pessoa:")) {
      const pessoaId = Number(chave.slice("pessoa:".length))
      passosPorPessoa.set(pessoaId, brutos)
      continue
    }

    const ordenados = ordenar(brutos)
    const passosDoAlvo = ordenados.map((p) => montarPasso(p, brutos))
    const prog = progresso(passosDoAlvo)
    const meta = alvoPorChave.get(chave)
    const primeiro = ordenados[0]

    blocos.push({
      chave,
      escopo: meta?.escopo ?? escopoDoAlvo(primeiro),
      necessidadeId: meta?.necessidadeId ?? primeiro.necessidadeId,
      documentoId: meta?.documentoId ?? primeiro.documentoId,
      pessoaId: meta?.pessoaId ?? primeiro.pessoaId,
      // Sem metadado do alvo a identidade continua sendo o id, nunca um texto
      // inventado: o rótulo diz exatamente o que se sabe.
      titulo: meta?.titulo ?? `Registro #${chave}`,
      subtitulo: meta?.subtitulo ?? null,
      statusLabel: meta?.statusLabel ?? null,
      pais: meta?.pais ?? null,
      progresso: prog,
      concluido: prog.total > 0 && prog.concluidos >= prog.total,
      divergente: passosDoAlvo.some((s) => STATUS_DIVERGENTES.has(String(s.status).toUpperCase())),
      vencido: passosDoAlvo.some((s) => s.vencido),
      passos: passosDoAlvo,
    })
  }

  // 4) Distribui os blocos entre as pessoas do roster.
  const blocosPorPessoa = new Map<number, AlvoDaEstrutura[]>()
  const rosterIds = new Set(pessoas.map((p) => p.pessoaId))
  const semDono: AlvoDaEstrutura[] = []
  for (const b of blocos) {
    if (b.pessoaId != null && rosterIds.has(b.pessoaId)) {
      const lista = blocosPorPessoa.get(b.pessoaId)
      if (lista) lista.push(b)
      else blocosPorPessoa.set(b.pessoaId, [b])
    } else {
      semDono.push(b)
    }
  }
  for (const lista of blocosPorPessoa.values()) {
    lista.sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR") || a.chave.localeCompare(b.chave))
  }
  semDono.sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR") || a.chave.localeCompare(b.chave))

  // 5) Uma linha por pessoa do roster — sempre, com ou sem trabalho aplicável.
  const linhas: PessoaDaEstrutura[] = pessoas.map((pessoa) => {
    const documentos = blocosPorPessoa.get(pessoa.pessoaId) ?? []
    const brutosPessoa = passosPorPessoa.get(pessoa.pessoaId) ?? []
    const passosDaPessoa = ordenar(brutosPessoa).map((p) => montarPasso(p, brutosPessoa))
    const prog = somarProgresso([...documentos.map((d) => d.progresso), progresso(passosDaPessoa)])
    const todos = [...documentos.flatMap((d) => d.passos), ...passosDaPessoa]
    return {
      pessoa,
      documentos,
      passosDaPessoa,
      progresso: prog,
      pendentes: todos.filter((s) => s.balde !== "CONCLUIDA").length,
      divergentes: todos.filter((s) => STATUS_DIVERGENTES.has(String(s.status).toUpperCase())).length,
      semTrabalhoAplicavel: documentos.length === 0 && passosDaPessoa.length === 0,
    }
  })

  const todosOsAlvos = [...blocos]
  const passosDeAlvo = todosOsAlvos.flatMap((b) => b.passos)
  const passosDePessoa = linhas.flatMap((l) => l.passosDaPessoa)
  const obrigatorios = [...passosDeAlvo, ...passosDePessoa, ...globais].filter((s) => s.obrigatorio)

  const resumo: ResumoEstrutura = {
    documentos: todosOsAlvos.length,
    documentosConcluidos: todosOsAlvos.filter((b) => b.concluido).length,
    documentosPendentes: todosOsAlvos.filter((b) => !b.concluido && !b.divergente).length,
    documentosDivergentes: todosOsAlvos.filter((b) => b.divergente).length,
    documentosVencidos: todosOsAlvos.filter((b) => b.vencido).length,
    passosObrigatorios: obrigatorios.length,
    passosObrigatoriosConcluidos: obrigatorios.filter((s) => s.balde === "CONCLUIDA").length,
    pessoasComTrabalho: linhas.filter((l) => !l.semTrabalhoAplicavel).length,
  }

  return {
    resumo,
    linhaPrincipal: linhas.filter((l) => l.pessoa.classificacao === "LINHA_PRINCIPAL"),
    foraDaLinha: linhas.filter((l) => l.pessoa.classificacao === "FORA_DA_LINHAGEM"),
    pendenteClassificacao: linhas.filter((l) => l.pessoa.classificacao === "PENDENTE_CLASSIFICACAO"),
    globais,
    semDono,
  }
}

/** Ordem de execução: a do workflow publicado (ordem), desempate estável por id. */
function ordenar(passos: PassoBruto[]): PassoBruto[] {
  return [...passos].sort((a, b) => a.ordem - b.ordem || a.stepInstanceId - b.stepInstanceId)
}

// ============================================================
// PROJEÇÃO PARA O ÍNDICE
// ============================================================

/**
 * Estado do documento derivado do workflow DELE — a fonte é a mesma da execução,
 * então índice e modal nunca discordam. Divergência (BLOQUEADO/FALHOU) tem
 * precedência sobre progresso: um documento travado não é "em andamento".
 */
export function statusFinalDoAlvo(alvo: AlvoDaEstrutura): StatusResumo {
  if (alvo.divergente) return "DIVERGENTE"
  if (alvo.progresso.total === 0) return "NAO_APLICAVEL"
  if (alvo.concluido) return "PRONTO"
  if (alvo.progresso.concluidos > 0) return "EM_ANDAMENTO"
  // Algum passo já saiu do estado inicial? Então o trabalho começou.
  return alvo.passos.some((p) => p.balde === "EM_ANDAMENTO") ? "EM_ANDAMENTO" : "PENDENTE"
}

/**
 * Artefatos do documento (certidão / retificada / tradução / apostila). O que o
 * domínio não registra vem como NAO_APLICAVEL — nunca um estado inventado para
 * preencher coluna.
 */
export type ArtefatosPorChave = Map<string, Partial<ArtefatosDoDocumento>>

/**
 * O PASSO CORRENTE DO ALVO — o que uma pessoa chamaria de "onde isso está".
 *
 * O primeiro passo obrigatório ainda não concluído, na ordem publicada. Um em
 * andamento vence um apenas disponível: se alguém já pôs a mão, é ali que o
 * trabalho está.
 */
function passoCorrente(alvo: AlvoDaEstrutura): PassoDaEstrutura | null {
  const abertos = alvo.passos.filter((p) => p.obrigatorio && p.balde !== "CONCLUIDA")
  if (abertos.length === 0) return null
  return abertos.find((p) => p.balde === "EM_ANDAMENTO") ?? abertos[0]
}

/** Espera EXTERNA: o passo corre, mas quem tem a bola é de fora. */
const STATUS_ESPERA_EXTERNA = new Set(["AGUARDANDO", "AGUARDANDO_APROVACAO"])

/**
 * COMO ESTE DOCUMENTO ESTÁ NESTA FASE — derivado, nunca gravado.
 *
 * `atrasado` é CONDIÇÃO, não estado: uma tarefa atrasada continua "Em
 * andamento". Colapsar as duas coisas num status só apagaria a informação de
 * que ela está sendo trabalhada.
 */
function estadoNaFase(alvo: AlvoDaEstrutura): EstadoNaFase {
  const corrente = passoCorrente(alvo)
  const concluido = corrente == null

  const estado: EstadoOperacionalDaLinha =
    concluido ? "CONCLUIDA"
    : corrente!.bloqueado && corrente!.motivoBloqueio != null ? "BLOQUEADA"
    : STATUS_ESPERA_EXTERNA.has(String(corrente!.status).toUpperCase()) ? "AGUARDANDO_TERCEIRO"
    : corrente!.balde === "EM_ANDAMENTO" ? "EM_ANDAMENTO"
    : "A_FAZER"

  // O prazo é o do passo corrente; concluído não tem prazo a vencer.
  const prazo = concluido ? null : corrente!.prazo
  const dias = concluido ? null : corrente!.diasParaPrazo

  return {
    progresso: alvo.progresso,
    // Título do passo publicado — o rótulo humano, nunca a stepKey.
    etapaAtual: concluido ? null : corrente!.titulo,
    responsavelId: concluido ? null : corrente!.responsavelId,
    responsavelNome: concluido ? null : corrente!.responsavelNome,
    prazo,
    diasParaPrazo: dias,
    atrasado: !concluido && dias != null && dias < 0,
    venceHoje: !concluido && dias === 0,
    estado,
    estadoLabel: ROTULO_ESTADO_LINHA[estado],
    motivoBloqueio: concluido ? null : corrente!.motivoBloqueio,
  }
}

function montarDocumentoDoIndice(
  alvo: AlvoDaEstrutura,
  artefatos: ArtefatosPorChave | undefined,
): DocumentoDoIndice {
  const statusFinal = statusFinalDoAlvo(alvo)
  const extra = artefatos?.get(alvo.chave) ?? {}
  // Sem executor em NENHUM passo do documento não há o que abrir — e isso é falta de
  // configuração, que precisa ser dita, não escondida.
  const comExecutor = alvo.passos.some((p) => p.executor != null)
  const impedimento = comExecutor
    ? null
    : alvo.passos.find((p) => p.erroAdministrativo)?.erroAdministrativo ??
      "Sem executor configurado para os passos deste documento."
  return {
    chave: alvo.chave,
    documentoId: alvo.documentoId,
    necessidadeId: alvo.necessidadeId,
    pessoaId: alvo.pessoaId,
    titulo: alvo.titulo,
    tipoLabel: alvo.subtitulo,
    pais: alvo.pais,
    artefatos: {
      certidao: extra.certidao ?? statusFinal,
      retificada: extra.retificada ?? "NAO_APLICAVEL",
      traducao: extra.traducao ?? "NAO_APLICAVEL",
      apostila: extra.apostila ?? "NAO_APLICAVEL",
    },
    statusFinal,
    statusFinalLabel: ROTULO_STATUS_RESUMO[statusFinal],
    naFase: estadoNaFase(alvo),
    podeAbrirDetalhes: comExecutor,
    impedimento,
  }
}

function montarPessoaDoIndice(linha: PessoaDaEstrutura, artefatos: ArtefatosPorChave | undefined): PessoaDoIndice {
  const documentos = linha.documentos.map((d) => montarDocumentoDoIndice(d, artefatos))
  return {
    pessoa: linha.pessoa,
    documentos,
    totais: {
      documentos: documentos.length,
      prontos: documentos.filter((d) => d.statusFinal === "PRONTO").length,
      pendentes: documentos.filter((d) => d.statusFinal === "PENDENTE" || d.statusFinal === "EM_ANDAMENTO").length,
      divergentes: documentos.filter((d) => d.statusFinal === "DIVERGENTE" || d.statusFinal === "INVALIDADO").length,
    },
    // Passos de escopo PESSOA continuam existindo no domínio e são executados pelo
    // modal do alvo deles; no ÍNDICE eles não viram linha, porque não são documento.
    semDocumentoAplicavel: documentos.length === 0,
  }
}

/**
 * Projeta a estrutura completa no ÍNDICE que a tela principal consome.
 *
 * Nada de execução atravessa: passo, status de passo, responsável, SLA, prazo,
 * bloqueio e operação antecipada ficam de fora por construção — não é filtro de
 * renderização, é o contrato do DTO.
 */
export function montarIndiceOperacional(
  estrutura: EstruturaOperacional,
  artefatos?: ArtefatosPorChave,
): IndiceOperacional {
  const linhaPrincipal = estrutura.linhaPrincipal.map((l) => montarPessoaDoIndice(l, artefatos))
  const foraDaLinha = estrutura.foraDaLinha.map((l) => montarPessoaDoIndice(l, artefatos))
  const pendenteClassificacao = estrutura.pendenteClassificacao.map((l) => montarPessoaDoIndice(l, artefatos))
  const semDono = estrutura.semDono.map((d) => montarDocumentoDoIndice(d, artefatos))

  const todos = [
    ...linhaPrincipal.flatMap((p) => p.documentos),
    ...foraDaLinha.flatMap((p) => p.documentos),
    ...pendenteClassificacao.flatMap((p) => p.documentos),
    ...semDono,
  ]

  return {
    resumo: {
      documentos: todos.length,
      prontos: todos.filter((d) => d.statusFinal === "PRONTO").length,
      pendentes: todos.filter((d) => d.statusFinal === "PENDENTE" || d.statusFinal === "EM_ANDAMENTO").length,
      divergentes: todos.filter((d) => d.statusFinal === "DIVERGENTE" || d.statusFinal === "INVALIDADO").length,
      pessoasComTrabalho: [...linhaPrincipal, ...foraDaLinha, ...pendenteClassificacao]
        .filter((p) => !p.semDocumentoAplicavel).length,
    },
    linhaPrincipal,
    foraDaLinha,
    pendenteClassificacao,
    semDono,
  }
}
