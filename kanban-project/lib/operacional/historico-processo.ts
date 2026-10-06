// lib/operacional/historico-processo.ts
// ============================================================================
// HISTÓRICO DO PROCESSO — módulo PURO (sem banco, sem relógio, sem React).
//
// O histórico NÃO é uma tabela: é uma PROJEÇÃO das fontes que já existem —
// LogAuditoria, TarefaHistorico, WorkflowEvento, PhaseAdvanceLog,
// NecessidadeDocumentalEvento, ContatoTerceiro, ComentarioTarefa,
// SolicitacaoDocumento, SubtaskExecution, StepExecution, DocumentoObservacao.
// O serviço (`src/services/historico-processo.ts`) LÊ essas fontes em lote e
// entrega linhas cruas + um dicionário de nomes; ESTE módulo decide o que é um
// FATO, redige a frase e agrupa. Um registro por FATO REAL — nunca um registro
// por linha técnica.
//
// REGRAS DE NEGÓCIO (escritas uma vez, aqui):
//   • Um fato = hora · quem · o que fez · em qual certidão e de quem · fase/passo ·
//     motivo e justificativa (quando existirem) · efeito.
//   • A MESMA ação nunca aparece duas vezes: "Tarefa concluída" + "Passo
//     concluído" viram UM fato; reabrir etapa + reabrir subtarefa viram UM fato;
//     o evento da necessidade que acompanha um cancelamento é absorvido por ele.
//   • Linha técnica NUNCA vira texto cru: ou é traduzida para uma frase legível
//     (e fica como AUTOMÁTICO), ou é DESCARTADA como mecânica interna (contada
//     em `descartados`), ou — se o código é desconhecido — NÃO é mostrada e vai
//     para `naoClassificados` (o serviço a expõe para diagnóstico).
//   • AUTOMÁTICO = o autor é o Sistema (nenhuma pessoa). Exceção: marcos do
//     processo (abertura, avanço/retorno de fase) nunca são escondidos.
//   • Agrupamento: ações repetidas em sequência pela mesma pessoa (mesma chave,
//     intervalo ≤ JANELA_DE_GRUPO_MS entre uma e a próxima) viram UM cartão com
//     `agrupadoDe` ("validou 3 certidões de Helena"; "atribuiu 11 certidões a
//     Daniela Brait").
//   • O prazo NUNCA pausa por causa de terceiro: nenhuma frase daqui diz o
//     contrário — esperar o cartório é um estado da tarefa, não uma pausa.
// ============================================================================
import { CAMPOS_EDITAVEIS } from '@/src/lib/genealogia/dados-registrais-edicao'
import { dataBR } from '@/src/lib/genealogia/sincronizacao-registral'
import { ordenarCertidoesDaFamilia, type ChaveDaCertidao } from './ordem-certidoes'
import { ROTULO_STATUS } from '@/src/lib/home/rotulo-status-tarefa'
import { apresentarTextoDoHistorico } from './historico-apresentacao'
import {
  CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO, CHAVES_SUBTAREFA_ENVIO_REQUERIMENTO, CHAVES_SUBTAREFA_RECEBIMENTO_CERTIDAO, STEP_KEY_LOCALIZAR_REGISTRO,
} from '@/src/lib/process-stage/situacao-solicitacao-certidao'

// ─── TIPOS DE FATO (o filtro "Tipo de fato") ────────────────────────────────
export const TIPOS_DE_FATO = ['PROCESSO', 'FASE', 'ARVORE', 'CERTIDAO', 'ATRIBUICAO', 'CARTORIO', 'PRAZO', 'BLOQUEIO', 'COMENTARIO', 'TAREFA'] as const
export type TipoDeFato = (typeof TIPOS_DE_FATO)[number]

export const ROTULO_TIPO_DE_FATO: Record<TipoDeFato, string> = {
  PROCESSO: 'Processo (abertura, edição)',
  FASE: 'Fase (avanço, retorno)',
  ARVORE: 'Árvore (exigências criadas e removidas)',
  CERTIDAO: 'Certidão (validada, recebida, cancelada)',
  ATRIBUICAO: 'Atribuição',
  CARTORIO: 'Cartório (pedido, cobrança, retorno)',
  PRAZO: 'Prazo (repactuação)',
  BLOQUEIO: 'Bloqueio e espera',
  COMENTARIO: 'Comentário',
  TAREFA: 'Tarefa',
}

/** Rótulo curto do chip do cartão, por subtipo. */
export const ROTULO_SUBTIPO = {
  abertura: 'Processo', edicao: 'Processo',
  avanco_fase: 'Fase', retorno_fase: 'Fase', movimento_fase: 'Fase', preparo_fase: 'Fase',
  linhagem: 'Árvore', conferencia: 'Árvore', sincronizacao_registral: 'Árvore', sincronizacao_desfeita: 'Árvore', dados_registrais_editados: 'Dados registrais', exigencia_criada: 'Exigência criada', exigencia_removida: 'Exigência removida', exigencia_reativada: 'Exigência reativada',
  exigencia_sem_causa: 'Pede decisão', nao_exigida: 'Não exigida',
  localizada: 'Localizada', solicitada: 'Solicitada', confirmacao_pedido: 'Confirmada', recebida: 'Recebida', validada: 'Validada',
  reaberta: 'Reaberta', cancelada: 'Cancelamento', etapa_concluida: 'Etapa concluída',
  atribuida: 'Atribuição', transferida: 'Atribuição', devolvida: 'Atribuição', atribuicao_desfeita: 'Atribuição',
  cobranca: 'Cobrança', protocolo: 'Protocolo',
  prazo: 'Prazo', acompanhamento: 'Prazo', prioridade: 'Prioridade',
  bloqueada: 'Bloqueio', desbloqueada: 'Bloqueio', espera_terceiro: 'Espera', retomada: 'Espera', canal: 'Cartório',
  comentario: 'Comentário', observacao: 'Observação',
  tarefa_criada: 'Tarefa', tarefa_iniciada: 'Iniciada', tarefa_concluida: 'Concluída',
} as const
export type SubtipoDeFato = keyof typeof ROTULO_SUBTIPO

/** Papel semântico da subtarefa "Conferir e validar certidão" (Emissão) — por CHAVE, como as demais. */
export const CHAVES_SUBTAREFA_CONFERENCIA_VALIDACAO = ['conferir_validar_certidao'] as const

/** Intervalo máximo entre duas ações "em sequência" para formarem um cartão só. */
export const JANELA_DE_GRUPO_MS = 30 * 60_000
/** Duas linhas de fontes diferentes dentro desta janela são o MESMO fato (ex.: evento da necessidade + cancelamento). */
const JANELA_MESMO_FATO_MS = 120_000
const JANELA_REABERTURA_MS = 5_000
const JANELA_FASE_MS = 60_000

type Json = Record<string, unknown>

// ─── ENTRADA: LINHAS CRUAS (uma forma por fonte) ────────────────────────────
export type LinhaCrua =
  | { fonte: 'LOG'; id: number; acao: string; entidade: string; entidadeId: number | null; descricao: string; detalhes: Json | null; criadoEm: string; usuarioId: number | null }
  | { fonte: 'WORKFLOW'; id: number; tipo: string; entityType: string; entityId: number | null; tarefaId: number | null; stepInstanceId: number | null; dados: Json | null; criadoEm: string }
  | { fonte: 'FASE'; id: number; faseAtual: string; fasePretendida: string | null; resultado: string; origem: string; solicitadoPorId: number | null; forcado: boolean; justificativa: string | null; criadoEm: string }
  | { fonte: 'NECESSIDADE'; id: number; necessidadeId: number; tipo: string; descricao: string | null; dados: Json | null; criadoEm: string }
  | { fonte: 'CONTATO'; id: number; tarefaId: number; documentoId: number | null; orgaoNome: string | null; canal: string; resultado: string; observacao: string | null; registradoPorId: number | null; criadoEm: string }
  | { fonte: 'COMENTARIO'; id: number; tarefaId: number | null; familiaId: number | null; autorId: number; texto: string; criadoEm: string }
  | { fonte: 'SUBTAREFA'; id: number; stepInstanceId: number; subtaskKey: string; completedAt: string; executadoPorId: number | null; resultado: string | null }
  | { fonte: 'PASSO'; id: number; stepInstanceId: number; completedAt: string; executadoPorId: number | null }
  | { fonte: 'SOLICITACAO'; id: number; documentoId: number; tarefaId: number | null; canal: string; destinatarioNome: string | null; orgaoNome: string | null; criadoPorId: number | null; criadoEm: string }
  | { fonte: 'OBSERVACAO'; id: number; documentoId: number; texto: string; criadoPorId: number | null; criadoEm: string }
  | { fonte: 'TAREFA_HIST'; id: number; tarefaId: number; acao: string; descricao: string; dados: Json | null; usuarioId: number | null; criadoEm: string }

// ─── CONTEXTO: nomes resolvidos EM LOTE pelo serviço ────────────────────────
export interface ContextoDoHistorico {
  processo: { id: number; nome: string; pais: string | null; requerentes: number | null; familiaId: number | null }
  usuarios: Record<number, string>
  pessoas: Record<number, string>
  /** Geração calculada, linha reta e nascimento de cada pessoa da árvore — a regra fixa de ordem das certidões (`ordem-certidoes.ts`). */
  ordemDasPessoas?: Record<number, { geracao: number | null; linhaReta: boolean; nascimento: string | null }>
  tarefas: Record<number, { titulo: string; documentoId: number | null; necessidadeId: number | null; pessoaId: number | null; faseMacroKey: string | null; statusTarefa: string; responsavelId: number | null }>
  documentos: Record<number, { rotulo: string | null; pessoaId: number | null; necessidadeId: number | null; status: string }>
  necessidades: Record<number, { rotulo: string; pessoaId: number | null }>
  passos: Record<number, { stepKey: string; titulo: string; faseMacroKey: string | null; documentoId: number | null; necessidadeId: number | null; pessoaId: number | null }>
  /** Nome da fase pelo CADASTRO (chave → rótulo); chave desconhecida devolve null. */
  rotuloDaFase: (chave: string | null | undefined) => string | null
}

// ─── SAÍDA ──────────────────────────────────────────────────────────────────
export interface Quem { tipo: 'humano' | 'sistema'; id: number | null; nome: string }
export interface LinksDoFato { processoId: number; tarefaId: number | null; documentoId: number | null; pessoaId: number | null; necessidadeId: number | null }
/** UMA alteração, antes → depois ("prazo 30/09 → 15/10", "responsável ninguém → Daniela Brait", "fase Genealogia → Emissão Documental"). */
export interface Mudanca { campo: string; antes: string | null; depois: string | null }
export interface FatoItem { id: string; quando: string; frase: string; certidao: string | null; pessoa: string | null; links: LinksDoFato; mudancas: Mudanca[] }
export interface FatoDoHistorico {
  id: string
  quando: string
  quem: Quem
  tipo: TipoDeFato
  subtipo: SubtipoDeFato
  rotuloSubtipo: string
  /** A frase COMPLETA, em texto simples (busca, CSV e PDF leem esta). */
  frase: string
  /** A frase SEM motivo/justificativa/efeito (a tela mostra esses três à parte). */
  nucleo: string
  verbo: string
  objeto: string | null
  complemento: string | null
  contexto: string | null
  certidao: string | null
  pessoa: string | null
  pessoaId: number | null
  fase: string | null
  passo: string | null
  motivo: string | null
  justificativa: string | null
  efeito: string | null
  /** O Sistema fez, e não é um marco do processo. Fica oculto por padrão. */
  automatico: boolean
  quantidade: number
  agrupadoDe: FatoItem[]
  links: LinksDoFato
  /** Cancelamento cuja tarefa continua CANCELADA: a porta canônica de reabertura (`reabrir`) se aplica. */
  reabrivel: { tarefaId: number } | null
  /** Marco do processo (abertura, avanço/retorno de fase): nunca é "automático" nem some do filtro. */
  marco: boolean
  /** O que mudou, antes → depois. Fato agrupado: só quando TODOS dizem o mesmo (senão fica por item em `agrupadoDe`). */
  mudancas: Mudanca[]
  /** Identificador do lote (quando a ação gravou um) — o agrupamento por lote vale mais que o do mesmo minuto. */
  lote: string | null
  /** Fase de destino de um marco (chave) — para contar "N dias na fase". */
  faseDestino: string | null
}

export interface ResultadoDoHistorico {
  fatos: FatoDoHistorico[]
  /** Linhas técnicas que são mecânica interna (nunca mostradas), por código. */
  descartados: Record<string, number>
  /** Códigos que o módulo não conhece: NÃO são mostrados crus; o serviço os expõe para diagnóstico. */
  naoClassificados: Record<string, number>
}

// ─── ÁTOMO (fato antes de dedupe/grupo) ─────────────────────────────────────
interface Atomo {
  id: string
  fonte: LinhaCrua['fonte']
  /** Prioridade entre fontes quando duas descrevem o mesmo fato (maior vence). */
  rank: number
  t: number
  quemId: number | null
  sistema: boolean
  /** Marco do processo (abertura, avanço/retorno): nunca é "automático", mesmo feito pelo Sistema. */
  marco: boolean
  tipo: TipoDeFato
  subtipo: SubtipoDeFato
  verbo: string
  objeto: string | null
  complemento: string | null
  /** Partes do contexto além da fase/passo (ex.: "Espanha · 4 requerentes"). */
  contextoExtra: string | null
  /** Frase pronta (fatos do Sistema que não seguem o molde "quem verbo objeto"). */
  fraseLivre: string | null
  tarefaId: number | null
  documentoId: number | null
  necessidadeId: number | null
  stepInstanceId: number | null
  pessoaId: number | null
  faseKey: string | null
  passo: string | null
  certidao: string | null
  motivo: string | null
  justificativa: string | null
  efeito: string | null
  destinoId: number | null
  chaveExtra: string | null
  faseDestino: string | null
  mudancas: Mudanca[]
  lote: string | null
}

const SISTEMA: Quem = { tipo: 'sistema', id: null, nome: 'Sistema' }
const ms = (iso: string) => new Date(iso).getTime()
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const cortar = (s: string, n = 240) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** "Motivo: X · Justificativa: Y · Impacto: Z" (o texto que o modal de cancelamento compõe) → campos. */
export function lerMotivoComposto(bruto: string | null | undefined): { motivo: string | null; justificativa: string | null; impacto: string | null; slaNaoCancelado: boolean; estruturado: boolean } {
  const t = (bruto ?? '').replace(/^Opera[cç][aã]o cancelada:\s*/i, '').trim()
  if (!t) return { motivo: null, justificativa: null, impacto: null, slaNaoCancelado: false, estruturado: false }
  const partes = t.split(/\s·\s(?=(?:Motivo|Justificativa|Impacto|SLA das etapas ativas):)/)
  const campo: Record<string, string> = {}
  let estruturado = false
  for (const p of partes) {
    const m = /^(Motivo|Justificativa|Impacto|SLA das etapas ativas):\s*([\s\S]*)$/.exec(p.trim())
    if (m) { campo[m[1]] = m[2].trim(); estruturado = true }
  }
  if (!estruturado) return { motivo: t, justificativa: null, impacto: null, slaNaoCancelado: false, estruturado: false }
  return {
    motivo: campo.Motivo || null, justificativa: campo.Justificativa || null, impacto: campo.Impacto || null,
    slaNaoCancelado: /n[aã]o cancelado/i.test(campo['SLA das etapas ativas'] ?? ''), estruturado: true,
  }
}

/** O motivo que só existe dentro da descrição ("... Motivo: X") — o writer da reabertura não o grava em `detalhes`. */
function motivoDaDescricao(d: string): string | null {
  const m = /Motivo:\s*([\s\S]+)$/.exec(d)
  return m ? m[1].trim() : null
}

const ROTULO_CANAL: Record<string, string> = { EMAIL: 'e-mail', TELEFONE: 'telefone', WHATSAPP: 'WhatsApp', OFICIO: 'ofício', PRESENCIAL: 'presencial', CRC: 'CRC', ECARTORIO: 'e-Cartório', BALCAO: 'balcão', COMUNE: 'comune', CORREIOS: 'correios', CONSULADO: 'consulado' }
const ROTULO_RESULTADO_CONTATO: Record<string, string> = {
  SEM_RESPOSTA: 'sem resposta', CONFIRMOU_PEDIDO: 'confirmou o pedido', PEDIU_DOCUMENTO: 'pediu documento', EM_BUSCA: 'em busca', NAO_LOCALIZOU: 'não localizou', ENVIOU: 'enviou',
}
const ROTULO_ESTADO_LINHAGEM: Record<string, string> = {
  LINHA_COMPLETA_COMPROVADA: 'linha completa comprovada', LINHA_COMPLETA_COM_PENDENCIAS: 'linha completa com pendências',
}
const ROTULO_PRIORIDADE: Record<string, string> = { BAIXA: 'baixa', MEDIA: 'média', ALTA: 'alta', URGENTE: 'urgente' }

/** Mecânica interna: nunca é fato e nunca é exibida (contada em `descartados`). */
const DESCARTAR_LOG = new Set([
  'TAREFA_REANCORADA', 'TAREFA_SINCRONIZADA', 'TAREFA_RECONCILIADA_DIVERGENCIA', 'ACOMPANHAMENTO_A_INICIAR_BACKFILL',
  'TAREFAS_REDISTRIBUIDAS', 'TAREFAS_REPRIORIZADAS', 'COBRANCA_ESTORNADA', 'OBRIGACAO_ATRIBUICAO_ABERTA', 'OBRIGACAO_ATRIBUICAO_CONCLUIDA', 'OBRIGACAO_ATRIBUICAO_ENCERRADA_PELA_TORRE',
  'STEP_ACTION_EXECUTED', 'PASSO_ANDAMENTO', 'PASSO_FORCADO', 'PASSO_DUPLICADO_SUPERSEDIDO', 'PASSO_FASE_FUTURA_SUPERSEDIDO', 'PASSO_TAREFA_REPARADO',
  'COMENTARIO_CRIADO', 'SOLICITACAO_DOCUMENTO_REGISTRADA', 'AUDITORIA_EXPORTADA', 'HISTORICO_EXPORTADO', 'TAREFA_UNIFICADA',
  'RECONCILIACAO_SOLICITADA', 'RECONCILIACAO_FASE_MACRO', 'RECONCILIACAO_ESCOPO_FASE', 'RECONCILIACAO_ESCOPO_FALHOU', 'RECONCILIACAO_WORKFLOW_INTERNO_FASE_ATUAL',
  'BACKFILL_PASSOS_PUBLICADOS', 'TAREFA_SEM_RESPONSAVEL_NA_REATIVACAO', 'TAREFA_DEPENDENCIA_REMOVIDA', 'HISTORICO_VISITADO',
])
const DESCARTAR_WORKFLOW = new Set([
  'WORKFLOW_INSTANCIADO', 'WORKFLOW_INICIADO', 'WORKFLOW_BLOQUEADO', 'WORKFLOW_CONCLUIDO', 'WORKFLOW_REABERTO', 'WORKFLOW_SUPERSEDIDO',
  'PASSO_INSTANCIADO', 'PASSO_DISPONIBILIZADO', 'PASSO_INICIADO', 'PASSO_BLOQUEADO', 'PASSO_DESBLOQUEADO', 'PASSO_EXECUTADO', 'PASSO_AGUARDANDO_APROVACAO',
  'PASSO_APROVADO', 'PASSO_CONCLUIDO', 'PASSO_FALHOU', 'PASSO_REABERTO', 'PASSO_DISPENSADO', 'PASSO_CANCELADO', 'PASSO_SUPERSEDIDO',
  'TAREFA_GERADA', 'TAREFA_ATRIBUIDA', 'TAREFA_INICIADA', 'TAREFA_CONCLUIDA', 'TAREFA_CANCELADA', 'TAREFA_SUPERSEDIDA', 'TAREFA_REABERTA', 'TAREFA_SINCRONIZADA',
  'TAREFA_BLOQUEADA', 'TAREFA_DESBLOQUEADA', 'FASE_SIMULADA',
])

// ─── RESOLUÇÃO DE CERTIDÃO/PESSOA ───────────────────────────────────────────
interface Alvo { tarefaId: number | null; documentoId: number | null; necessidadeId: number | null; stepInstanceId: number | null; pessoaId: number | null; rotulo: string | null }

/** Índices tarefa-por-documento / tarefa-por-necessidade (a mais recente vence), uma vez por contexto. */
const INDICES = new WeakMap<ContextoDoHistorico, { porDoc: Map<number, number>; porNec: Map<number, number> }>()
function indicesDe(ctx: ContextoDoHistorico) {
  let i = INDICES.get(ctx)
  if (!i) {
    i = { porDoc: new Map(), porNec: new Map() }
    for (const [idTxt, t] of Object.entries(ctx.tarefas)) {
      const id = Number(idTxt)
      if (t.documentoId != null && (i.porDoc.get(t.documentoId) ?? 0) < id) i.porDoc.set(t.documentoId, id)
      if (t.necessidadeId != null && (i.porNec.get(t.necessidadeId) ?? 0) < id) i.porNec.set(t.necessidadeId, id)
    }
    INDICES.set(ctx, i)
  }
  return i
}

function resolverAlvo(ctx: ContextoDoHistorico, a: Partial<Alvo>): Alvo {
  const idx = indicesDe(ctx)
  const p = a.stepInstanceId != null ? ctx.passos[a.stepInstanceId] : undefined
  const documentoId0 = a.documentoId ?? (a.tarefaId != null ? ctx.tarefas[a.tarefaId]?.documentoId : null) ?? p?.documentoId ?? null
  const necessidadeId0 = a.necessidadeId ?? (a.tarefaId != null ? ctx.tarefas[a.tarefaId]?.necessidadeId : null) ?? (documentoId0 != null ? ctx.documentos[documentoId0]?.necessidadeId : null) ?? p?.necessidadeId ?? null
  // A tarefa da obrigação: a informada, ou a mais recente do mesmo documento/exigência — é ela que o link abre e que nomeia a certidão.
  const tarefaId = a.tarefaId ?? (documentoId0 != null ? idx.porDoc.get(documentoId0) : undefined) ?? (necessidadeId0 != null ? idx.porNec.get(necessidadeId0) : undefined) ?? null
  const t = tarefaId != null ? ctx.tarefas[tarefaId] : undefined
  const documentoId = documentoId0 ?? t?.documentoId ?? null
  const d = documentoId != null ? ctx.documentos[documentoId] : undefined
  const necessidadeId = necessidadeId0 ?? t?.necessidadeId ?? d?.necessidadeId ?? null
  const n = necessidadeId != null ? ctx.necessidades[necessidadeId] : undefined
  const pessoaId = a.pessoaId ?? t?.pessoaId ?? d?.pessoaId ?? n?.pessoaId ?? p?.pessoaId ?? null
  // Só a tarefa de UMA CERTIDÃO (com documento ou exigência) dá nome de certidão; tarefa administrativa é "tarefa “título”".
  // Título canônico: "Certidão de nascimento - Inteiro Teor · Pessoa" — a pessoa vem do VÍNCULO, não do texto.
  const tituloDeCertidao = t && (t.documentoId != null || t.necessidadeId != null) ? t.titulo.split(' · ')[0].trim() : null
  const rotulo = tituloDeCertidao ?? d?.rotulo ?? (n ? n.rotulo.split(' · ')[0].trim() : null)
  return { tarefaId, documentoId, necessidadeId, stepInstanceId: a.stepInstanceId ?? null, pessoaId, rotulo }
}

const nomeDaPessoa = (ctx: ContextoDoHistorico, id: number | null) => (id != null ? ctx.pessoas[id] ?? null : null)
const nomeDoUsuario = (ctx: ContextoDoHistorico, id: number | null) => (id != null ? ctx.usuarios[id] ?? `Usuário #${id}` : null)

type Prep = 'a' | 'de' | 'em' | null

/**
 * A certidão DITA com a preposição que a frase pede: "a Certidão de casamento · Maria" / "da Certidão …" / "na Certidão …".
 * Sem rótulo de certidão cai na tarefa ("a tarefa “Atribuir …”"); sem nada devolve null.
 */
function sobre(ctx: ContextoDoHistorico, alvo: Alvo, prep: Prep): string | null {
  const pessoa = nomeDaPessoa(ctx, alvo.pessoaId)
  if (alvo.rotulo) {
    const corpo = `${alvo.rotulo}${pessoa ? ` · ${pessoa}` : ''}`
    const fem = /^Certid/i.test(alvo.rotulo)
    if (prep === 'a') return fem ? `a ${corpo}` : corpo
    if (prep === 'de') return fem ? `da ${corpo}` : `de ${corpo}`
    if (prep === 'em') return fem ? `na ${corpo}` : `em ${corpo}`
    return corpo
  }
  const t = alvo.tarefaId != null ? ctx.tarefas[alvo.tarefaId] : undefined
  if (t) { const c = `tarefa “${t.titulo}”`; return prep === 'a' ? `a ${c}` : prep === 'de' ? `da ${c}` : prep === 'em' ? `na ${c}` : c }
  if (pessoa) return prep === 'de' ? `de ${pessoa}` : prep === 'em' ? `em ${pessoa}` : pessoa
  return null
}

const temCertidao = (alvo: Alvo) => alvo.rotulo != null

interface BaseAtomo { id: string; fonte: LinhaCrua['fonte']; rank: number; t: number; tipo: TipoDeFato; subtipo: SubtipoDeFato; verbo: string }

function novoAtomo(ctx: ContextoDoHistorico, base: BaseAtomo & Partial<Atomo>, alvo?: Partial<Alvo>): Atomo {
  const a = alvo ? resolverAlvo(ctx, alvo) : null
  const faseDoAlvo = a?.stepInstanceId != null ? ctx.passos[a.stepInstanceId]?.faseMacroKey ?? null : a?.tarefaId != null ? ctx.tarefas[a.tarefaId]?.faseMacroKey ?? null : null
  return {
    quemId: null, sistema: false, marco: false, objeto: null, complemento: null, contextoExtra: null, fraseLivre: null,
    tarefaId: a?.tarefaId ?? null, documentoId: a?.documentoId ?? null, necessidadeId: a?.necessidadeId ?? null, stepInstanceId: a?.stepInstanceId ?? null, pessoaId: a?.pessoaId ?? null,
    faseKey: faseDoAlvo, passo: a?.stepInstanceId != null ? ctx.passos[a.stepInstanceId]?.titulo ?? null : null,
    certidao: a?.rotulo ?? null, motivo: null, justificativa: null, efeito: null, destinoId: null, chaveExtra: null, faseDestino: null, mudancas: [], lote: null,
    ...base,
  }
}

/** Fato do Sistema em frase livre ("Sistema recalculou a linhagem …"). */
function atomoDoSistema(ctx: ContextoDoHistorico, base: Omit<BaseAtomo, 'verbo'>, frase: string, extra: Partial<Atomo> = {}): Atomo {
  return novoAtomo(ctx, { ...base, sistema: true, quemId: null, verbo: '', fraseLivre: `Sistema ${frase}`, ...extra })
}

// ─── FASE 1: LINHA CRUA → ÁTOMO(S) ──────────────────────────────────────────
type Resultado = Atomo[] | 'descartar' | 'desconhecido'

function atomosDoLog(l: Extract<LinhaCrua, { fonte: 'LOG' }>, ctx: ContextoDoHistorico): Resultado {
  if (DESCARTAR_LOG.has(l.acao)) return 'descartar'
  const d = l.detalhes ?? {}
  const t = ms(l.criadoEm)
  const autor = l.usuarioId
  const eTarefa = /^tarefa$/i.test(l.entidade)
  const eProcesso = /^processo$/i.test(l.entidade)
  const tarefaId = eTarefa && l.entidadeId ? l.entidadeId : num(d.tarefaId)
  const origem = { id: `log:${l.id}`, fonte: 'LOG' as const, t, quemId: autor, sistema: autor == null, lote: txt(d.loteId) }
  const alvoDaTarefa: Partial<Alvo> = { tarefaId, documentoId: num(d.documentoId), stepInstanceId: num(d.stepInstanceId) }
  const certidaoDaTarefa = (prep: Prep) => sobre(ctx, resolverAlvo(ctx, alvoDaTarefa), prep)
  const simples = (b: { rank: number; tipo: TipoDeFato; subtipo: SubtipoDeFato; verbo: string }, prep: Prep, extra: Partial<Atomo> = {}): Atomo => {
    const a = novoAtomo(ctx, { ...origem, ...b, ...extra }, alvoDaTarefa)
    a.objeto = certidaoDaTarefa(prep)
    if (!temCertidao(resolverAlvo(ctx, alvoDaTarefa)) && a.tipo === 'CERTIDAO') a.tipo = 'TAREFA'
    return a
  }

  switch (l.acao) {
    // ── PROCESSO ──────────────────────────────────────────────────────────
    case 'PROCESSO_INICIALIZADO_V2':
    case 'criou': {
      if (!eProcesso) return 'desconhecido'
      const faseIni = ctx.rotuloDaFase(txt(d.primeiraFase))
      const partes = [ctx.processo.pais, ctx.processo.requerentes != null ? `${ctx.processo.requerentes} requerente${ctx.processo.requerentes === 1 ? '' : 's'}` : null, faseIni ? `fase inicial ${faseIni}` : null].filter(Boolean)
      return [novoAtomo(ctx, { ...origem, rank: l.acao === 'PROCESSO_INICIALIZADO_V2' ? 2 : 1, tipo: 'PROCESSO', subtipo: 'abertura', verbo: 'abriu o processo', objeto: ctx.processo.nome, marco: true, contextoExtra: partes.join(' · ') || null, faseDestino: txt(d.primeiraFase), mudancas: faseIni ? [{ campo: 'fase', antes: null, depois: faseIni }] : [] })]
    }
    case 'editou':
      if (!eProcesso) return 'desconhecido'
      return [novoAtomo(ctx, { ...origem, rank: 1, tipo: 'PROCESSO', subtipo: 'edicao', verbo: 'editou os dados do processo', objeto: ctx.processo.nome })]
    case 'FASE_MATERIALIZADA': {
      const fase = txt(d.faseMacroKey)
      const faseRot = ctx.rotuloDaFase(fase)
      const passos = num(d.passosTotais) ?? num(d.passosCriados) ?? 0
      const estado = txt(d.estado)
      const porCertidao = txt(d.escopo) === 'NECESSIDADE' || txt(d.escopo) === 'DOCUMENTO'
      const ciclo = num(d.ciclo)
      const frase = estado && estado !== 'MATERIALIZADO'
        ? `tentou preparar a fase${faseRot ? ` ${faseRot}` : ''}, mas nenhum item se aplicava`
        : `preparou a fase${faseRot ? ` ${faseRot}` : ''}${ciclo && ciclo > 1 ? ` (ciclo ${ciclo})` : ''} com ${passos} ${porCertidao ? (passos === 1 ? 'certidão' : 'certidões') : (passos === 1 ? 'passo' : 'passos')}${porCertidao ? ' (a partir da árvore)' : ''}`
      return [atomoDoSistema(ctx, { ...origem, rank: 1, tipo: 'FASE', subtipo: 'preparo_fase' }, frase, { faseKey: fase, chaveExtra: fase ?? '' })]
    }
    // SINCRONIZAÇÃO ÁRVORE ⇄ DADOS REGISTRAIS (06/10/2026): o registro localizado na Genealogia venceu (ou preencheu) um campo da árvore — antes → depois, quem e quando.
    case 'SINCRONIZACAO_REGISTRAL':
    case 'SINCRONIZACAO_REGISTRAL_DESFEITA': {
      const desfeita = l.acao === 'SINCRONIZACAO_REGISTRAL_DESFEITA'
      if (num(d.logId) != null && txt(d.rotulo) == null) return 'descartar' // a linha de "campo destravado" é interna, não é fato do histórico
      const rotulo = txt(d.rotulo) ?? 'campo'
      const pessoa = txt(d.pessoaNome) ?? nomeDaPessoa(ctx, num(d.pessoaId)) ?? 'uma pessoa'
      const a = novoAtomo(ctx, {
        ...origem, rank: 2, tipo: 'ARVORE', subtipo: desfeita ? 'sincronizacao_desfeita' : 'sincronizacao_registral',
        verbo: desfeita ? 'desfez a sincronização da árvore com a Genealogia' : 'sincronizou a árvore com a Genealogia',
        complemento: `${rotulo} de ${pessoa}`,
        motivo: desfeita ? null : txt(d.tipo) === 'CONFLITO' ? 'o registro localizado diferia da árvore (vale o da Genealogia)' : 'campo vazio na árvore preenchido pelo registro localizado',
        mudancas: [{ campo: rotulo, antes: txt(d.antes) ?? null, depois: txt(d.depois) ?? null }],
        chaveExtra: `${l.id}`,
      }, { documentoId: num(d.documentoId) })
      a.pessoaId = num(d.pessoaId) ?? a.pessoaId
      return [a]
    }
    // DADOS REGISTRAIS CORRIGIDOS (06/10/2026): editar depois do "Localizar registro" — antes → depois, quem e quando; motivo; e se o pedido ao cartório já tinha saído.
    case 'DADOS_REGISTRAIS_EDITADOS': {
      const lista = Array.isArray(d.mudancas) ? (d.mudancas as Array<Record<string, unknown>>) : []
      const fmt = (chave: unknown, v: unknown): string | null => {
        const t = txt(v)
        if (t == null) return null
        const c = CAMPOS_EDITAVEIS.find((x) => x.chave === chave)
        return c?.tipo === 'data' ? dataBR(t) : t
      }
      const a = novoAtomo(ctx, {
        ...origem, rank: 2, tipo: 'CERTIDAO', subtipo: 'dados_registrais_editados', verbo: 'corrigiu os dados registrais',
        motivo: txt(d.motivo),
        efeito: d.requerimentoJaEnviado === true ? `o pedido ao cartório já tinha saído com os dados antigos${txt(d.avisoRequerimento) ? ` — ${txt(d.avisoRequerimento)}` : ''}` : null,
        mudancas: lista.map((m) => ({ campo: txt(m.campo) ?? 'campo', antes: fmt(m.chave, m.antes), depois: fmt(m.chave, m.depois) })),
        chaveExtra: `${l.id}`,
      }, { documentoId: num(d.documentoId) })
      a.objeto = sobre(ctx, resolverAlvo(ctx, { documentoId: num(d.documentoId) }), null)
      a.pessoaId = num(d.pessoaId) ?? a.pessoaId
      return [a]
    }
    case 'registral_linhagem_recalculada': {
      const m = /Linhagem recalculada:\s*([A-Z_]+)/.exec(l.descricao)
      const estado = m ? ROTULO_ESTADO_LINHAGEM[m[1]] ?? m[1].toLowerCase().replace(/_/g, ' ') : null
      return [atomoDoSistema(ctx, { ...origem, rank: 1, tipo: 'ARVORE', subtipo: 'linhagem' }, `recalculou a linhagem da árvore${estado ? ` (${estado})` : ''}`, { chaveExtra: 'linhagem' })]
    }
    case 'registral_reconciliacao_documental': {
      const av = num(d.necessidadesAvaliadas), at = num(d.necessidadesAtendidas)
      return [atomoDoSistema(ctx, { ...origem, rank: 1, tipo: 'ARVORE', subtipo: 'conferencia' }, `conferiu ${av != null ? `${av} exigências` : 'as exigências'} documentais com os registros da árvore${at != null ? ` (${at} atendida${at === 1 ? '' : 's'})` : ''}`, { chaveExtra: 'conferencia' })]
    }
    case 'registral_importacao_analisada':
      return [atomoDoSistema(ctx, { ...origem, rank: 1, tipo: 'ARVORE', subtipo: 'conferencia' }, 'analisou uma importação de registros', { chaveExtra: l.acao })]
    case 'registral_transcricao_automatica':
      return [atomoDoSistema(ctx, { ...origem, rank: 1, tipo: 'ARVORE', subtipo: 'conferencia' }, 'transcreveu um documento automaticamente', { chaveExtra: l.acao })]
    case 'PROCESS_PHASE_ROLLED_BACK': {
      const de = txt(d.deFase), para = txt(d.paraFase)
      return [novoAtomo(ctx, { ...origem, rank: 3, tipo: 'FASE', subtipo: 'retorno_fase', verbo: 'voltou o processo', marco: true, complemento: `de ${ctx.rotuloDaFase(de) ?? '—'} para ${ctx.rotuloDaFase(para) ?? '—'}`, justificativa: txt(d.justificativa), faseKey: null, faseDestino: para, mudancas: [{ campo: 'fase', antes: ctx.rotuloDaFase(de), depois: ctx.rotuloDaFase(para) }] })]
    }
    case 'GENEALOGIA_REABERTA':
      return [novoAtomo(ctx, { ...origem, rank: 3, tipo: 'FASE', subtipo: 'reaberta', verbo: 'reabriu a Genealogia:', marco: true, motivo: txt(d.motivo), efeito: 'as certidões dessa exigência aguardam a Genealogia para serem solicitadas' })]
    // ── ÁRVORE ────────────────────────────────────────────────────────────
    case 'NECESSIDADE_REMOVIDA_PELA_ARVORE':
    case 'NECESSIDADE_CRIADA_PELA_ARVORE':
    case 'NECESSIDADE_REATIVADA_PELA_ARVORE': {
      const docIds = Array.isArray(d.documentoIds) ? (d.documentoIds as unknown[]).filter((x): x is number => typeof x === 'number') : []
      const removida = l.acao === 'NECESSIDADE_REMOVIDA_PELA_ARVORE'
      const criada = l.acao === 'NECESSIDADE_CRIADA_PELA_ARVORE'
      const n = l.entidadeId != null ? ctx.necessidades[l.entidadeId] : undefined
      const tarefasAbertas = num(d.tarefasAbertas) ?? 0
      const a = novoAtomo(ctx, {
        ...origem, rank: 2, tipo: 'ARVORE', subtipo: removida ? 'exigencia_removida' : criada ? 'exigencia_criada' : 'exigencia_reativada',
        verbo: removida ? 'alterou a árvore: deixou de ser exigida' : criada ? 'alterou a árvore: passou a ser exigida' : 'alterou a árvore: voltou a ser exigida', motivo: txt(d.motivo),
        efeito: removida ? (tarefasAbertas > 0 ? `${tarefasAbertas} tarefa${tarefasAbertas === 1 ? ' aberta foi tratada' : 's abertas foram tratadas'}; a certidão continua na pasta como Não exigida` : 'a certidão continua na pasta como Não exigida') : null,
      }, { necessidadeId: l.entidadeId, documentoId: docIds[0] ?? null })
      a.objeto = n ? n.rotulo : sobre(ctx, resolverAlvo(ctx, { necessidadeId: l.entidadeId, documentoId: docIds[0] ?? null }), null)
      a.pessoaId = n?.pessoaId ?? a.pessoaId
      return [a]
    }
    case 'NECESSIDADE_ATENDIDA_SEM_CAUSA': {
      const n = l.entidadeId != null ? ctx.necessidades[l.entidadeId] : undefined
      const a = novoAtomo(ctx, { ...origem, rank: 2, tipo: 'ARVORE', subtipo: 'exigencia_sem_causa', verbo: 'deixou de ser exigida pela árvore, mas já andou e pede decisão humana:', motivo: txt(d.motivo) }, { necessidadeId: l.entidadeId })
      a.objeto = n?.rotulo ?? null
      return [a]
    }
    case 'DOCUMENTO_ORFAO_NAO_EXIGIDO': {
      const alvo = { documentoId: l.entidadeId }
      const a = novoAtomo(ctx, { ...origem, rank: 2, sistema: true, quemId: null, tipo: 'ARVORE', subtipo: 'nao_exigida', verbo: 'marcou como não exigida', motivo: 'o documento não tem necessidade ativa na árvore' }, alvo)
      a.objeto = sobre(ctx, resolverAlvo(ctx, alvo), 'a')
      return [a]
    }
    // ── ATRIBUIÇÃO ────────────────────────────────────────────────────────
    case 'TAREFA_ATRIBUIDA':
    case 'TAREFA_TRANSFERIDA': {
      const para = num(d.para), de = num(d.de)
      const nomePara = nomeDoUsuario(ctx, para), nomeDe = nomeDoUsuario(ctx, de)
      const a = simples({ rank: 2, tipo: 'ATRIBUICAO', subtipo: l.acao === 'TAREFA_ATRIBUIDA' ? 'atribuida' : 'transferida', verbo: l.acao === 'TAREFA_ATRIBUIDA' ? 'atribuiu' : 'transferiu' }, 'a', { destinoId: para, motivo: txt(d.motivo) })
      a.complemento = l.acao === 'TAREFA_ATRIBUIDA' ? (nomePara ? `a ${nomePara}` : null) : [nomeDe ? `de ${nomeDe}` : null, nomePara ? `para ${nomePara}` : null].filter(Boolean).join(' ') || null
      a.mudancas = [{ campo: 'responsável', antes: nomeDe ?? 'ninguém', depois: nomePara }]
      return [a]
    }
    case 'TAREFA_DEVOLVIDA_A_FILA': {
      const de = nomeDoUsuario(ctx, num(d.de))
      return [simples({ rank: 2, tipo: 'ATRIBUICAO', subtipo: 'devolvida', verbo: 'devolveu à fila da equipe' }, 'a', { motivo: txt(d.motivo), efeito: de ? `deixou de ser de ${de}` : null, mudancas: [{ campo: 'responsável', antes: de, depois: 'ninguém' }] })]
    }
    case 'TAREFA_ATRIBUICAO_DESFEITA':
      return [simples({ rank: 2, tipo: 'ATRIBUICAO', subtipo: 'atribuicao_desfeita', verbo: 'desfez a atribuição' }, 'de', { motivo: txt(d.motivo) })]
    // ── TAREFA / CERTIDÃO ─────────────────────────────────────────────────
    case 'TAREFA_CRIADA': {
      const alvo = { ...alvoDaTarefa, necessidadeId: num(d.necessidadeId), pessoaId: num(d.pessoaId) }
      const a = novoAtomo(ctx, { ...origem, rank: 1, tipo: 'TAREFA', subtipo: 'tarefa_criada', verbo: 'criou a tarefa', chaveExtra: txt(d.faseMacroKey) ?? 'sem-fase' }, alvo)
      a.objeto = sobre(ctx, resolverAlvo(ctx, alvo), 'de') ?? (txt(d.titulo) ? `“${txt(d.titulo)}”` : null)
      a.faseKey = txt(d.faseMacroKey) ?? a.faseKey
      return [a]
    }
    case 'TAREFA_CRIADA_MANUAL': {
      const tt = tarefaId != null ? ctx.tarefas[tarefaId]?.titulo : null
      return [novoAtomo(ctx, { ...origem, rank: 2, tipo: 'TAREFA', subtipo: 'tarefa_criada', verbo: 'criou a tarefa', objeto: tt ? `“${tt}”` : null }, alvoDaTarefa)]
    }
    case 'TAREFA_INICIADA':
      return [simples({ rank: 2, tipo: 'CERTIDAO', subtipo: 'tarefa_iniciada', verbo: 'iniciou' }, 'a')]
    case 'TAREFA_CONCLUIDA':
      return [simples({ rank: 1, tipo: 'CERTIDAO', subtipo: 'tarefa_concluida', verbo: 'concluiu' }, 'a')]
    case 'TAREFA_ETAPA_CONCLUIDA':
      return [simples({ rank: 1, tipo: 'CERTIDAO', subtipo: 'etapa_concluida', verbo: 'concluiu uma etapa' }, 'de')]
    case 'TAREFA_CANCELADA': {
      const composto = lerMotivoComposto(txt(d.motivoDetalhado) ?? txt(d.motivo))
      const automatico = autor == null
      const causaRemovida = automatico && txt(d.motivo) === 'CAUSA_REMOVIDA'
      const alvo = { ...alvoDaTarefa, necessidadeId: num(d.necessidadeId) }
      const a = novoAtomo(ctx, { ...origem, rank: 3, tipo: 'CERTIDAO', subtipo: 'cancelada', verbo: automatico ? 'retirou do trabalho' : 'cancelou', motivo: causaRemovida ? 'a exigência deixou de existir (o workflow que a originou foi encerrado)' : composto.motivo, justificativa: composto.justificativa }, alvo)
      const r = resolverAlvo(ctx, alvo)
      a.objeto = sobre(ctx, r, 'a')
      if (!temCertidao(r)) a.tipo = 'TAREFA'
      const de = txt(d.de)
      const resp = num(d.responsavelId)
      const efeitos: string[] = []
      if (de && ROTULO_STATUS[de]) efeitos.push(`saiu de “${ROTULO_STATUS[de]}”${resp != null ? ` (responsável: ${nomeDoUsuario(ctx, resp)})` : ''}`)
      if (temCertidao(r) && r.documentoId != null) efeitos.push('continua na pasta como Cancelada')
      if (composto.slaNaoCancelado) efeitos.push('os prazos das etapas ativas não foram cancelados (conforme informado)')
      if (composto.impacto) efeitos.push(`impacto informado: ${composto.impacto}`)
      a.efeito = efeitos.join(' · ') || null
      if (de && ROTULO_STATUS[de]) a.mudancas = [{ campo: 'situação', antes: ROTULO_STATUS[de], depois: 'Cancelada' }]
      return [a]
    }
    case 'TAREFA_REABERTA':
      return [simples({ rank: 3, tipo: 'CERTIDAO', subtipo: 'reaberta', verbo: 'reabriu' }, 'a', { motivo: txt(d.motivo) ?? motivoDaDescricao(l.descricao) })]
    case 'TAREFA_REABERTA_APOS_CANCELAMENTO_INDEVIDO':
      return [simples({ rank: 3, tipo: 'CERTIDAO', subtipo: 'reaberta', verbo: 'reabriu' }, 'a', { motivo: 'o cancelamento foi indevido' })]
    case 'STEP_EXECUTION_REOPENED':
    case 'SUBTAREFA_REABERTA': {
      const stepId = num(d.stepInstanceId) ?? (l.acao === 'STEP_EXECUTION_REOPENED' ? l.entidadeId : null)
      const ident = (d.identidade ?? {}) as Json
      const alvo = { stepInstanceId: stepId, documentoId: num(ident.documentoId) }
      const a = novoAtomo(ctx, { ...origem, rank: l.acao === 'STEP_EXECUTION_REOPENED' ? 3 : 2, tipo: 'CERTIDAO', subtipo: 'reaberta', verbo: 'reabriu', motivo: txt(d.justificativa) }, alvo)
      a.objeto = sobre(ctx, resolverAlvo(ctx, alvo), 'a') ?? (txt(ident.pessoaNome) ? `a certidão de ${txt(ident.pessoaNome)}` : null)
      if (!a.passo) a.passo = txt(ident.stepTitulo)
      if (!a.faseKey) a.faseKey = txt(ident.faseMacroKey)
      return [a]
    }
    case 'TAREFA_CAUSA_DECIDIDA': {
      const manter = txt(d.decisao) === 'MANTER'
      const a = simples({ rank: 2, tipo: 'CERTIDAO', subtipo: manter ? 'reaberta' : 'cancelada', verbo: manter ? 'decidiu manter o trabalho' : 'encerrou' }, manter ? 'de' : 'a', { motivo: txt(d.motivo) })
      if (!manter) a.complemento = 'cuja exigência saiu da árvore'
      return [a]
    }
    case 'TAREFA_CAUSA_REMOVIDA': {
      const a = simples({ rank: 1, tipo: 'ARVORE', subtipo: 'exigencia_sem_causa', verbo: 'marcou para decisão' }, 'a', { sistema: true, quemId: null, motivo: txt(d.motivo) ?? txt(d.causaRemovidaMotivo) })
      a.complemento = 'porque a árvore deixou de exigi-la e o trabalho já tinha começado'
      return [a]
    }
    // ── PRAZO / PRIORIDADE ────────────────────────────────────────────────
    case 'TAREFA_PRAZO_ALTERADO':
    case 'TAREFA_PRAZO_REPACTUACAO_DESFEITA': {
      const a = simples({ rank: 2, tipo: 'PRAZO', subtipo: 'prazo', verbo: l.acao === 'TAREFA_PRAZO_ALTERADO' ? 'repactuou o prazo' : 'desfez a repactuação do prazo' }, 'de', { motivo: txt(d.motivo) })
      const data = (v: unknown) => (v === null ? 'sem prazo' : typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null)
      // No "antes → depois" a data vem curta (30/09) quando é do mesmo ano do próprio registro; de outro ano, completa.
      const curta = (v: unknown) => { const c = data(v); return c && /^\d{2}\/\d{2}\/\d{4}$/.test(c) && c.slice(6) === new Date(l.criadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).slice(6) ? c.slice(0, 5) : c }
      const de = data(d.de), para = data(d.para)
      a.complemento = para ? `para ${para}${de ? ` (era ${de})` : ''}` : null
      a.mudancas = [{ campo: 'prazo', antes: curta(d.de) ?? 'sem prazo', depois: curta(d.para) ?? 'sem prazo' }]
      return [a]
    }
    case 'TAREFA_PRIORIDADE_ALTERADA':
    case 'TAREFA_PRIORIDADE_DESFEITA': {
      const a = simples({ rank: 2, tipo: 'TAREFA', subtipo: 'prioridade', verbo: l.acao === 'TAREFA_PRIORIDADE_ALTERADA' ? 'alterou a prioridade' : 'desfez a alteração de prioridade' }, 'de', { motivo: txt(d.motivo) })
      const de = txt(d.de), para = txt(d.para)
      a.complemento = para ? `${de ? `de ${ROTULO_PRIORIDADE[de] ?? de.toLowerCase()} ` : ''}para ${ROTULO_PRIORIDADE[para] ?? para.toLowerCase()}` : null
      if (para) a.mudancas = [{ campo: 'prioridade', antes: de ? ROTULO_PRIORIDADE[de] ?? de.toLowerCase() : null, depois: ROTULO_PRIORIDADE[para] ?? para.toLowerCase() }]
      return [a]
    }
    // ── BLOQUEIO / ESPERA ─────────────────────────────────────────────────
    case 'TAREFA_BLOQUEADA':
      return [simples({ rank: 2, tipo: 'BLOQUEIO', subtipo: 'bloqueada', verbo: 'bloqueou' }, 'a', { motivo: txt(d.motivo) })]
    case 'TAREFA_DESBLOQUEADA':
      return [simples({ rank: 2, tipo: 'BLOQUEIO', subtipo: 'desbloqueada', verbo: 'desbloqueou' }, 'a', { motivo: txt(d.motivo) })]
    case 'TAREFA_AGUARDANDO_TERCEIRO':
      return [simples({ rank: 2, tipo: 'BLOQUEIO', subtipo: 'espera_terceiro', verbo: 'passou a aguardar terceiros em' }, 'em', { motivo: txt(d.motivo) })]
    case 'TAREFA_RETOMADA_DE_ESPERA':
      return [simples({ rank: 2, tipo: 'BLOQUEIO', subtipo: 'retomada', verbo: 'retomou o trabalho' }, 'de', { motivo: txt(d.motivo) })]
    case 'SOLICITACAO_CANAL_ALTERADO': {
      const a = simples({ rank: 2, tipo: 'CARTORIO', subtipo: 'canal', verbo: 'trocou o canal do pedido' }, 'de', { motivo: txt(d.motivo) })
      const de = txt(d.de), para = txt(d.para)
      a.complemento = de && para ? `de ${ROTULO_CANAL[de] ?? de} para ${ROTULO_CANAL[para] ?? para}` : null
      if (de && para) a.mudancas = [{ campo: 'canal', antes: ROTULO_CANAL[de] ?? de, depois: ROTULO_CANAL[para] ?? para }]
      return [a]
    }
    case 'PROTOCOLO_INFORMADO_POSTERIORMENTE': {
      const alvo = { documentoId: num(d.documentoId) }
      const a = novoAtomo(ctx, { ...origem, rank: 2, tipo: 'CARTORIO', subtipo: 'protocolo', verbo: 'informou o protocolo' }, alvo)
      a.objeto = sobre(ctx, resolverAlvo(ctx, alvo), 'de')
      const numero = txt(d.numero); a.complemento = numero ? `(nº ${numero})` : null
      return [a]
    }
    case 'COMENTARIO_APAGADO':
      return [simples({ rank: 1, tipo: 'COMENTARIO', subtipo: 'comentario', verbo: 'apagou um comentário' }, 'em')]
    default:
      return 'desconhecido'
  }
}

function atomosDoWorkflow(w: Extract<LinhaCrua, { fonte: 'WORKFLOW' }>, ctx: ContextoDoHistorico): Resultado {
  const d = w.dados ?? {}
  const t = ms(w.criadoEm)
  const origem = { id: `wf:${w.id}`, fonte: 'WORKFLOW' as const, t, sistema: true }
  if (['FASE_AVANCADA', 'FASE_AVANCADA_FORCADO', 'FASE_RETORNADA', 'FASE_MOVIDA', 'FASE_REABERTA'].includes(w.tipo)) {
    const de = txt(d.de), para = txt(d.para) ?? txt(d.faseDestino)
    const sub: SubtipoDeFato = w.tipo === 'FASE_RETORNADA' ? 'retorno_fase' : w.tipo === 'FASE_MOVIDA' || w.tipo === 'FASE_REABERTA' ? 'movimento_fase' : 'avanco_fase'
    const verbo = sub === 'retorno_fase' ? 'voltou o processo' : sub === 'movimento_fase' ? 'moveu o processo' : w.tipo === 'FASE_AVANCADA_FORCADO' ? 'avançou (forçado) o processo' : 'avançou o processo'
    return [novoAtomo(ctx, { ...origem, rank: 1, marco: true, tipo: 'FASE', subtipo: sub, verbo, complemento: `de ${ctx.rotuloDaFase(de) ?? '—'} para ${ctx.rotuloDaFase(para) ?? '—'}`, faseKey: null, faseDestino: para, mudancas: [{ campo: 'fase', antes: ctx.rotuloDaFase(de), depois: ctx.rotuloDaFase(para) }] })]
  }
  // Espera por terceiro decidida pelo motor: a tarefa continua com o prazo correndo (o prazo nunca pausa por terceiro).
  if (w.tipo === 'TAREFA_BLOQUEADA' && txt(d.motivoCodigo) === 'AGUARDANDO_TERCEIRO') {
    const alvo = { tarefaId: w.tarefaId, documentoId: num(d.documentoId) }
    const a = novoAtomo(ctx, { ...origem, rank: 1, tipo: 'BLOQUEIO', subtipo: 'espera_terceiro', verbo: 'passou a aguardar terceiros em', chaveExtra: 'espera' }, alvo)
    a.objeto = sobre(ctx, resolverAlvo(ctx, alvo), 'em')
    return [a]
  }
  if (DESCARTAR_WORKFLOW.has(w.tipo)) return 'descartar'
  return 'desconhecido'
}

function atomoDaFase(f: Extract<LinhaCrua, { fonte: 'FASE' }>, ctx: ContextoDoHistorico): Resultado {
  if (f.resultado === 'BLOQUEADO' || f.resultado === 'IDEMPOTENTE' || f.resultado === 'CONFLITO') return 'descartar'
  const sub: SubtipoDeFato = f.resultado === 'RETORNADO' ? 'retorno_fase' : f.resultado === 'MOVIDO' || f.resultado === 'REABERTO' ? 'movimento_fase' : 'avanco_fase'
  const verbo = sub === 'retorno_fase' ? 'voltou o processo' : sub === 'movimento_fase' ? 'moveu o processo' : f.resultado === 'FORCADO' || f.forcado ? 'avançou (forçado) o processo' : 'avançou o processo'
  return [novoAtomo(ctx, {
    id: `fase:${f.id}`, fonte: 'FASE', rank: 2, t: ms(f.criadoEm), quemId: f.solicitadoPorId, sistema: f.solicitadoPorId == null, marco: true,
    tipo: 'FASE', subtipo: sub, verbo, complemento: `de ${ctx.rotuloDaFase(f.faseAtual) ?? '—'} para ${ctx.rotuloDaFase(f.fasePretendida) ?? '—'}`,
    justificativa: txt(f.justificativa), faseKey: null, faseDestino: f.fasePretendida,
    mudancas: [{ campo: 'fase', antes: ctx.rotuloDaFase(f.faseAtual), depois: ctx.rotuloDaFase(f.fasePretendida) }],
  })]
}

function atomoDaNecessidade(n: Extract<LinhaCrua, { fonte: 'NECESSIDADE' }>, ctx: ContextoDoHistorico): Resultado {
  const d = n.dados ?? {}
  const nec = ctx.necessidades[n.necessidadeId]
  const origem = { id: `nec:${n.id}`, fonte: 'NECESSIDADE' as const, rank: 0, t: ms(n.criadoEm), sistema: true }
  const fazer = (b: { tipo: TipoDeFato; subtipo: SubtipoDeFato; verbo: string }, extra: Partial<Atomo> = {}): Atomo[] => {
    const a = novoAtomo(ctx, { ...origem, ...b, objeto: nec ? nec.rotulo : null, ...extra }, { necessidadeId: n.necessidadeId })
    a.pessoaId = nec?.pessoaId ?? a.pessoaId
    return [a]
  }
  switch (n.tipo) {
    case 'CRIADA': return fazer({ tipo: 'ARVORE', subtipo: 'exigencia_criada', verbo: 'registrou a exigência de' }, { chaveExtra: 'nec-criada' })
    case 'DISPENSADA': return fazer({ tipo: 'ARVORE', subtipo: 'exigencia_removida', verbo: 'dispensou a exigência de' }, { motivo: txt(d.motivo) })
    case 'REABERTA': return fazer({ tipo: 'ARVORE', subtipo: 'exigencia_reativada', verbo: 'reativou a exigência de' })
    case 'ATENDIDA': return fazer({ tipo: 'CERTIDAO', subtipo: 'localizada', verbo: 'marcou como atendida a exigência de' })
    case 'NAO_LOCALIZADA': return fazer({ tipo: 'CERTIDAO', subtipo: 'localizada', verbo: 'marcou como não localizada a exigência de' })
    default: return 'descartar'
  }
}

function atomosDaSubtarefa(l: Extract<LinhaCrua, { fonte: 'SUBTAREFA' }>, ctx: ContextoDoHistorico, docsComSolicitacao: Set<number>): Resultado {
  const k = l.subtaskKey
  const passo = ctx.passos[l.stepInstanceId]
  const eValida = (CHAVES_SUBTAREFA_CONFERENCIA_VALIDACAO as readonly string[]).includes(k)
  const eRecebe = (CHAVES_SUBTAREFA_RECEBIMENTO_CERTIDAO as readonly string[]).includes(k)
  const eConfirma = (CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO as readonly string[]).includes(k)
  const eEnvia = (CHAVES_SUBTAREFA_ENVIO_REQUERIMENTO as readonly string[]).includes(k)
  // O pedido enviado já é contado pela SolicitacaoDocumento (canal, destinatário, protocolo) — um fato só.
  if (eEnvia && passo?.documentoId != null && docsComSolicitacao.has(passo.documentoId)) return 'descartar'
  const origem = { id: `sub:${l.id}`, fonte: 'SUBTAREFA' as const, rank: 2, t: ms(l.completedAt), quemId: l.executadoPorId, sistema: l.executadoPorId == null }
  const alvo = { stepInstanceId: l.stepInstanceId }
  const r = resolverAlvo(ctx, alvo)
  // A subtarefa JÁ é o passo a passo ("validou", "recebeu"): repetir "passo Solicitar certidão" no contexto só faria ruído.
  const semPasso = (a: Atomo, objeto: string | null): Atomo => Object.assign(a, { objeto, passo: null })
  if (eValida) return [semPasso(novoAtomo(ctx, { ...origem, tipo: 'CERTIDAO', subtipo: 'validada', verbo: 'validou' }, alvo), sobre(ctx, r, 'a'))]
  if (eRecebe) return [semPasso(novoAtomo(ctx, { ...origem, tipo: 'CERTIDAO', subtipo: 'recebida', verbo: 'recebeu' }, alvo), sobre(ctx, r, 'a'))]
  if (eConfirma) return [semPasso(novoAtomo(ctx, { ...origem, tipo: 'CARTORIO', subtipo: 'confirmacao_pedido', verbo: 'registrou a confirmação do pedido pelo cartório' }, alvo), sobre(ctx, r, 'de'))]
  if (eEnvia) return [semPasso(novoAtomo(ctx, { ...origem, tipo: 'CARTORIO', subtipo: 'solicitada', verbo: 'solicitou' }, alvo), sobre(ctx, r, 'a'))]
  const a = novoAtomo(ctx, { ...origem, tipo: 'CERTIDAO', subtipo: 'etapa_concluida', verbo: 'concluiu a etapa' }, alvo)
  const tituloDaSub = k.replace(/_/g, ' ')
  a.objeto = `“${tituloDaSub}”${sobre(ctx, r, 'de') ? ` ${sobre(ctx, r, 'de')}` : ''}`
  return [a]
}

function atomoDoPasso(l: Extract<LinhaCrua, { fonte: 'PASSO' }>, ctx: ContextoDoHistorico, stepsComSubtarefa: Set<number>): Resultado {
  // Passo com subtarefas: o fato é a subtarefa concluída (quem, quando, qual). O fim do passo só a espelha.
  if (stepsComSubtarefa.has(l.stepInstanceId)) return 'descartar'
  const passo = ctx.passos[l.stepInstanceId]
  const eLocalizar = passo?.stepKey === STEP_KEY_LOCALIZAR_REGISTRO
  const alvo = { stepInstanceId: l.stepInstanceId }
  const r = resolverAlvo(ctx, alvo)
  const a = novoAtomo(ctx, { id: `passo:${l.id}`, fonte: 'PASSO', rank: 2, t: ms(l.completedAt), quemId: l.executadoPorId, sistema: l.executadoPorId == null, tipo: 'CERTIDAO', subtipo: eLocalizar ? 'localizada' : 'etapa_concluida', verbo: eLocalizar ? 'localizou o registro' : 'concluiu a etapa' }, alvo)
  if (eLocalizar) { a.objeto = sobre(ctx, r, 'de'); a.passo = null } else { a.objeto = `${passo?.titulo ?? 'da tarefa'}${sobre(ctx, r, 'de') ? ` ${sobre(ctx, r, 'de')}` : ''}`; a.passo = null }
  return [a]
}

function montarAtomos(linhas: LinhaCrua[], ctx: ContextoDoHistorico): { atomos: Atomo[]; descartados: Record<string, number>; naoClassificados: Record<string, number> } {
  const atomos: Atomo[] = []
  const descartados: Record<string, number> = {}
  const naoClassificados: Record<string, number> = {}
  const conta = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1 }
  const stepsComSubtarefa = new Set<number>()
  const docsComSolicitacao = new Set<number>()
  for (const x of linhas) { if (x.fonte === 'SUBTAREFA') stepsComSubtarefa.add(x.stepInstanceId); if (x.fonte === 'SOLICITACAO') docsComSolicitacao.add(x.documentoId) }

  for (const l of linhas) {
    let r: Resultado
    let codigo: string
    switch (l.fonte) {
      case 'LOG': r = atomosDoLog(l, ctx); codigo = `${l.entidade}:${l.acao}`; break
      case 'WORKFLOW': r = atomosDoWorkflow(l, ctx); codigo = `WorkflowEvento:${l.tipo}`; break
      case 'FASE': r = atomoDaFase(l, ctx); codigo = `PhaseAdvanceLog:${l.resultado}`; break
      case 'NECESSIDADE': r = atomoDaNecessidade(l, ctx); codigo = `NecessidadeEvento:${l.tipo}`; break
      case 'SUBTAREFA': r = atomosDaSubtarefa(l, ctx, docsComSolicitacao); codigo = `SubtaskExecution:${l.subtaskKey}`; break
      case 'PASSO': r = atomoDoPasso(l, ctx, stepsComSubtarefa); codigo = 'StepExecution'; break
      case 'CONTATO': {
        const alvo = { tarefaId: l.tarefaId, documentoId: l.documentoId }
        const ligacao = l.canal === 'TELEFONE'
        const a = novoAtomo(ctx, { id: `contato:${l.id}`, fonte: 'CONTATO', rank: 2, t: ms(l.criadoEm), quemId: l.registradoPorId, sistema: l.registradoPorId == null, tipo: 'CARTORIO', subtipo: 'cobranca', verbo: ligacao ? 'ligou para' : 'cobrou' }, alvo)
        a.objeto = l.orgaoNome ? `o cartório ${l.orgaoNome}` : 'o cartório'
        a.complemento = `sobre ${sobre(ctx, resolverAlvo(ctx, alvo), 'a') ?? 'a certidão'} — ${ROTULO_CANAL[l.canal] ?? l.canal.toLowerCase()}, ${ROTULO_RESULTADO_CONTATO[l.resultado] ?? l.resultado.toLowerCase()}`
        a.justificativa = txt(l.observacao)
        r = [a]; codigo = 'ContatoTerceiro'; break
      }
      case 'COMENTARIO': {
        const alvo = { tarefaId: l.tarefaId }
        const a = novoAtomo(ctx, { id: `coment:${l.id}`, fonte: 'COMENTARIO', rank: 2, t: ms(l.criadoEm), quemId: l.autorId, tipo: 'COMENTARIO', subtipo: 'comentario', verbo: 'comentou' }, alvo)
        a.objeto = l.tarefaId != null ? sobre(ctx, resolverAlvo(ctx, alvo), 'em') : 'na família'
        a.complemento = `“${cortar(l.texto.replace(/@\[([^\]]+)\]\(\d+\)/g, '@$1'), 280)}”`
        r = [a]; codigo = 'ComentarioTarefa'; break
      }
      case 'TAREFA_HIST': {
        const alvo = { tarefaId: l.tarefaId }
        const origem = { id: `hist:${l.id}`, fonte: 'TAREFA_HIST' as const, rank: 2, t: ms(l.criadoEm), quemId: l.usuarioId, sistema: l.usuarioId == null }
        if (l.acao === 'COMENTARIO') {
          const a = novoAtomo(ctx, { ...origem, tipo: 'COMENTARIO', subtipo: 'comentario', verbo: 'comentou' }, alvo)
          a.objeto = sobre(ctx, resolverAlvo(ctx, alvo), 'em'); a.complemento = `“${cortar(l.descricao, 280)}”`
          r = [a]
        } else if (l.acao === 'ACOMPANHAMENTO_ADIADO') {
          const a = novoAtomo(ctx, { ...origem, tipo: 'PRAZO', subtipo: 'acompanhamento', verbo: 'adiou o acompanhamento', motivo: txt(l.descricao) }, alvo)
          a.objeto = sobre(ctx, resolverAlvo(ctx, alvo), 'de'); r = [a]
        } else r = 'desconhecido'
        codigo = `TarefaHistorico:${l.acao}`; break
      }
      case 'SOLICITACAO': {
        const alvo = { documentoId: l.documentoId, tarefaId: l.tarefaId }
        const a = novoAtomo(ctx, { id: `solic:${l.id}`, fonte: 'SOLICITACAO', rank: 3, t: ms(l.criadoEm), quemId: l.criadoPorId, sistema: l.criadoPorId == null, tipo: 'CARTORIO', subtipo: 'solicitada', verbo: 'solicitou' }, alvo)
        a.objeto = sobre(ctx, resolverAlvo(ctx, alvo), 'a')
        const dest = l.orgaoNome ?? l.destinatarioNome
        a.complemento = `${dest ? `a ${dest} ` : ''}por ${ROTULO_CANAL[l.canal] ?? l.canal.toLowerCase()}`.trim()
        r = [a]; codigo = 'SolicitacaoDocumento'; break
      }
      case 'OBSERVACAO': {
        const alvo = { documentoId: l.documentoId }
        const a = novoAtomo(ctx, { id: `obs:${l.id}`, fonte: 'OBSERVACAO', rank: 2, t: ms(l.criadoEm), quemId: l.criadoPorId, sistema: l.criadoPorId == null, tipo: 'COMENTARIO', subtipo: 'observacao', verbo: 'registrou uma observação' }, alvo)
        a.objeto = sobre(ctx, resolverAlvo(ctx, alvo), 'em') ?? 'em um documento'
        a.complemento = `“${cortar(l.texto, 280)}”`
        r = [a]; codigo = 'DocumentoObservacao'; break
      }
    }
    if (r === 'descartar') conta(descartados, codigo)
    else if (r === 'desconhecido') conta(naoClassificados, codigo)
    else atomos.push(...r)
  }
  return { atomos, descartados, naoClassificados }
}

// ─── FASE 2: DEDUPE (um fato = um registro) ─────────────────────────────────
function dedupe(atomos: Atomo[]): Atomo[] {
  const vivos = new Set(atomos.map((a) => a.id))
  const morrer = (a: Atomo) => vivos.delete(a.id)
  const porTempo = [...atomos].sort((a, b) => a.t - b.t)

  // R1 — reabertura de etapa + de subtarefa (mesma pessoa, mesma etapa, em segundos): UM fato, com o motivo mais rico.
  const reab = porTempo.filter((a) => a.subtipo === 'reaberta' && a.stepInstanceId != null)
  for (let i = 0; i < reab.length; i++) for (let j = i + 1; j < reab.length; j++) {
    const a = reab[i], b = reab[j]
    if (!vivos.has(a.id) || !vivos.has(b.id)) continue
    if (a.stepInstanceId === b.stepInstanceId && a.quemId === b.quemId && Math.abs(a.t - b.t) <= JANELA_REABERTURA_MS) {
      const manter = a.rank >= b.rank ? a : b, sair = manter === a ? b : a
      manter.motivo = manter.motivo ?? sair.motivo; manter.passo = manter.passo ?? sair.passo; manter.efeito = manter.efeito ?? sair.efeito
      morrer(sair)
    }
  }
  // R2 — "concluiu a tarefa"/"concluiu a etapa" que só espelha um fato de resultado (validou/recebeu/localizou) do mesmo trabalho.
  const resultado = porTempo.filter((a) => a.subtipo === 'validada' || a.subtipo === 'recebida' || a.subtipo === 'localizada')
  for (const c of porTempo.filter((a) => a.subtipo === 'tarefa_concluida' || a.subtipo === 'etapa_concluida')) {
    const espelha = resultado.some((r) => vivos.has(r.id) && Math.abs(r.t - c.t) <= JANELA_MESMO_FATO_MS
      && ((c.tarefaId != null && c.tarefaId === r.tarefaId) || (c.stepInstanceId != null && c.stepInstanceId === r.stepInstanceId) || (c.documentoId != null && c.documentoId === r.documentoId)))
    if (espelha) morrer(c)
  }
  // R3 — o evento da NECESSIDADE acompanha o fato que o causou (cancelamento, árvore, localização…): não é outro fato.
  const cobrem = new Set<SubtipoDeFato>(['cancelada', 'exigencia_removida', 'exigencia_criada', 'exigencia_reativada', 'localizada', 'recebida', 'validada', 'nao_exigida', 'reaberta'])
  for (const n of porTempo.filter((a) => a.fonte === 'NECESSIDADE')) {
    const coberto = n.necessidadeId != null && porTempo.some((o) => o.fonte !== 'NECESSIDADE' && vivos.has(o.id) && o.necessidadeId === n.necessidadeId && Math.abs(o.t - n.t) <= JANELA_MESMO_FATO_MS && cobrem.has(o.subtipo))
    if (coberto) morrer(n)
  }
  // R4 — abertura: a inicialização V2 e o "criou" legado descrevem o mesmo ato.
  const aberturas = porTempo.filter((a) => a.subtipo === 'abertura')
  if (aberturas.length > 1) { const melhor = aberturas.reduce((x, y) => (y.rank > x.rank ? y : x)); for (const a of aberturas) if (a !== melhor) morrer(a) }
  // R5 — movimento de fase: LOG do retorno > PhaseAdvanceLog > WorkflowEvento, no mesmo instante e destino.
  const fases = porTempo.filter((a) => a.tipo === 'FASE' && a.marco)
  for (let i = 0; i < fases.length; i++) for (let j = i + 1; j < fases.length; j++) {
    const a = fases[i], b = fases[j]
    if (!vivos.has(a.id) || !vivos.has(b.id)) continue
    if (Math.abs(a.t - b.t) <= JANELA_FASE_MS && a.faseDestino === b.faseDestino) {
      const manter = a.rank >= b.rank ? a : b, sair = manter === a ? b : a
      manter.justificativa = manter.justificativa ?? sair.justificativa
      if (manter.quemId == null && sair.quemId != null) { manter.quemId = sair.quemId; manter.sistema = false }
      morrer(sair)
    }
  }
  return atomos.filter((a) => vivos.has(a.id))
}

// ─── FASE 3: AGRUPAR ────────────────────────────────────────────────────────
// Cancelar, reabrir e solicitar NÃO agrupam: cada um é uma decisão com motivo próprio (e o cancelamento tem o seu "Reabrir").
const AGRUPAVEIS = new Set<SubtipoDeFato>(['validada', 'recebida', 'localizada', 'confirmacao_pedido', 'atribuida', 'transferida', 'devolvida', 'cobranca', 'tarefa_criada', 'exigencia_criada', 'exigencia_removida', 'nao_exigida', 'linhagem', 'conferencia', 'espera_terceiro', 'protocolo', 'prazo'])

/** O que NUNCA vira lote, nem por minuto: marcos do processo, texto digitado por gente e fatos únicos por natureza. */
const NAO_AGRUPA_NO_MINUTO = new Set<SubtipoDeFato>(['abertura', 'edicao', 'avanco_fase', 'retorno_fase', 'movimento_fase', 'preparo_fase', 'comentario', 'observacao'])

export type ModoDeAgrupamento = 'sequencia' | 'minuto'

function chaveDeGrupo(a: Atomo, modo: ModoDeAgrupamento = 'sequencia'): string | null {
  if (modo === 'minuto') {
    // Linha do tempo: "uma ação feita de uma vez" = mesmo identificador de lote, ou mesmo usuário + mesma ação no mesmo minuto.
    if (NAO_AGRUPA_NO_MINUTO.has(a.subtipo) || a.marco) return null
    if (a.lote) return `lote|${a.lote}`
    return `${a.subtipo}|${a.sistema ? 'sys' : `u${a.quemId}`}|m${Math.floor(a.t / 60_000)}`
  }
  if (!AGRUPAVEIS.has(a.subtipo)) return null
  const quem = a.sistema ? 'sys' : `u${a.quemId}`
  switch (a.subtipo) {
    // "validou 3 certidões de Helena": mesma pessoa que atua, mesma pessoa da árvore.
    case 'validada': case 'recebida': case 'localizada': case 'confirmacao_pedido': return `${a.subtipo}|${quem}|p${a.pessoaId ?? 'x'}`
    // "atribuiu 11 certidões a Daniela": mesmo autor, mesmo destino.
    case 'atribuida': case 'transferida': case 'devolvida': return `${a.subtipo}|${quem}|d${a.destinoId ?? 'x'}`
    case 'tarefa_criada': return `${a.subtipo}|${quem}|f${a.chaveExtra ?? ''}`
    case 'linhagem': case 'conferencia': case 'espera_terceiro': return `${a.subtipo}|${quem}|${a.chaveExtra ?? ''}`
    case 'exigencia_criada': case 'exigencia_removida': return `${a.subtipo}|${quem}|${a.motivo ?? ''}`
    default: return `${a.subtipo}|${quem}|${a.motivo ?? ''}|${a.justificativa ?? ''}`
  }
}

// ─── FASE 4: REDAÇÃO ────────────────────────────────────────────────────────
function tipoCurto(rotulo: string | null): string | null {
  if (!rotulo) return null
  const m = /^Certid[ãa]o de ([^\s-]+)/i.exec(rotulo)
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : rotulo
}

function contextoDe(ctx: ContextoDoHistorico, a: Atomo): { fase: string | null; contexto: string | null } {
  const fase = ctx.rotuloDaFase(a.faseKey)
  const partes = [fase, a.passo ? `passo ${a.passo}` : null, a.contextoExtra].filter((x): x is string => !!x)
  return { fase, contexto: partes.length ? partes.join(' · ') : null }
}

function nucleoDe(quemNome: string, p: { verbo: string; objeto: string | null; complemento: string | null; contexto: string | null; fraseLivre: string | null }): string {
  const t = p.fraseLivre != null
    ? p.fraseLivre
    : `${quemNome} ${p.verbo}${p.objeto ? ` ${p.objeto}` : ''}${p.complemento ? ` ${p.complemento}` : ''}${p.contexto ? ` (${p.contexto})` : ''}`
  return t.replace(/\s+/g, ' ').trim()
}

function redigir(quemNome: string, p: { verbo: string; objeto: string | null; complemento: string | null; contexto: string | null; fraseLivre: string | null; motivo: string | null; justificativa: string | null; efeito: string | null }): string {
  const cauda = [
    p.motivo ? `Motivo: ${p.motivo}` : null,
    p.justificativa ? `Justificativa: “${p.justificativa}”` : null,
    p.efeito ? `Efeito: ${p.efeito}` : null,
  ].filter(Boolean)
  return `${nucleoDe(quemNome, p)}${cauda.length ? `. ${cauda.join('. ')}` : ''}`.replace(/\s+/g, ' ').trim()
}

/**
 * Texto gerado pelo SISTEMA (auditoria, workflow, fase, necessidade) em linguagem de gente: "usuário 7" → nome, "equipe_documental" →
 * "Equipe documental", "SLA 5d" → "prazo de 5 dias". Só na EXIBIÇÃO (nada é regravado). Texto DIGITADO por pessoa (comentário, observação,
 * observação de tarefa) não é reescrito.
 */
const FONTES_DE_TEXTO_DO_SISTEMA = new Set<LinhaCrua['fonte']>(['LOG', 'WORKFLOW', 'FASE', 'NECESSIDADE'])
function apresentavel(ctx: ContextoDoHistorico, a: Atomo): Atomo {
  if (!FONTES_DE_TEXTO_DO_SISTEMA.has(a.fonte)) return a
  const t = (v: string | null) => (v == null ? v : apresentarTextoDoHistorico(v, ctx.usuarios))
  return { ...a, motivo: t(a.motivo), justificativa: t(a.justificativa), efeito: t(a.efeito), complemento: t(a.complemento), fraseLivre: t(a.fraseLivre) }
}

/** A certidão de um fato agrupado na REGRA FIXA de ordem (`ordem-certidoes.ts`): geração calculada → linha reta → nascimento → pessoa → Nascimento, Casamento, Óbito. */
export function chaveDoAtomo(ctx: ContextoDoHistorico, x: { pessoaId: number | null; certidao: string | null; t: number }): ChaveDaCertidao {
  const o = x.pessoaId != null ? ctx.ordemDasPessoas?.[x.pessoaId] : undefined
  return { geracao: o?.geracao ?? null, linhaReta: o?.linhaReta ?? null, pessoaNascimento: o?.nascimento ?? null, pessoaId: x.pessoaId, titulo: x.certidao, desempate: -x.t }
}

function montarFato(ctx: ContextoDoHistorico, membrosBrutos: Atomo[], reabriveis: Set<string>): FatoDoHistorico {
  const membros = membrosBrutos.map((m) => apresentavel(ctx, m))
  const ordenados = [...membros].sort((x, y) => y.t - x.t || (x.id < y.id ? 1 : -1))
  const a = ordenados[0]
  const n = membros.length
  const linksDe = (x: Atomo): LinksDoFato => ({ processoId: ctx.processo.id, tarefaId: x.tarefaId, documentoId: x.documentoId, pessoaId: x.pessoaId, necessidadeId: x.necessidadeId })
  const quem: Quem = a.sistema || a.quemId == null ? SISTEMA : { tipo: 'humano', id: a.quemId, nome: nomeDoUsuario(ctx, a.quemId) ?? `Usuário #${a.quemId}` }
  const automatico = quem.tipo === 'sistema' && !membros.some((m) => m.marco)

  const itemDe = (x: Atomo): FatoItem => {
    const c = contextoDe(ctx, x)
    return {
      id: x.id, quando: new Date(x.t).toISOString(), certidao: x.certidao, pessoa: nomeDaPessoa(ctx, x.pessoaId), links: linksDe(x), mudancas: x.mudancas,
      frase: redigir(quem.nome, { verbo: x.verbo, objeto: x.objeto, complemento: x.complemento, contexto: c.contexto, fraseLivre: x.fraseLivre, motivo: x.motivo, justificativa: x.justificativa, efeito: x.efeito }),
    }
  }

  let verbo = a.verbo, objeto = a.objeto, complemento = a.complemento
  let { fase, contexto } = contextoDe(ctx, a)
  let { motivo, justificativa, efeito } = a
  let fraseLivre = a.fraseLivre
  const pessoasDistintas = new Set(membros.map((m) => m.pessoaId))
  const pessoaUnica = pessoasDistintas.size === 1 ? nomeDaPessoa(ctx, a.pessoaId) : null

  if (n > 1) {
    const tipos = [...new Set(membros.map((m) => tipoCurto(m.certidao)).filter((x): x is string => !!x))]
    const fasesDistintas = new Set(membros.map((m) => m.faseKey))
    const faseRot = fasesDistintas.size === 1 ? ctx.rotuloDaFase(a.faseKey) : null
    const certidoes = `${n} certidões`
    const dePessoa = pessoaUnica ? ` de ${pessoaUnica}` : ''
    complemento = null; fase = faseRot
    switch (a.subtipo) {
      case 'validada': case 'recebida':
        objeto = `${certidoes}${dePessoa}`; contexto = [tipos.join(', ') || null, faseRot].filter(Boolean).join(' · ') || null; break
      case 'localizada':
        verbo = 'localizou o registro de'; objeto = `${certidoes}${dePessoa}`; contexto = [tipos.join(', ') || null, faseRot].filter(Boolean).join(' · ') || null; break
      case 'atribuida': case 'transferida': case 'devolvida':
        objeto = certidoes; contexto = [faseRot, 'lote'].filter(Boolean).join(' · ')
        // O destino ("a Daniela Brait") só sobe ao cartão quando é o mesmo em todas; senão cada item diz o seu em "Ver as N".
        if (a.subtipo !== 'devolvida') complemento = new Set(membros.map((m) => m.complemento)).size === 1 ? a.complemento : null
        break
      case 'prioridade': {
        const depois = [...new Set(membros.map((m) => m.mudancas[0]?.depois ?? null))]
        verbo = 'alterou a prioridade de'; objeto = certidoes; complemento = depois.length === 1 && depois[0] ? `para ${depois[0]}` : null; contexto = faseRot; break
      }
      case 'tarefa_criada': verbo = 'criou'; objeto = `${n} tarefas de certidão`; contexto = faseRot; break
      case 'cobranca': verbo = 'cobrou'; objeto = `${n} cartórios`; complemento = `sobre ${certidoes}`; contexto = null; break
      case 'confirmacao_pedido': verbo = 'registrou a confirmação de'; objeto = `${n} pedidos pelo cartório`; complemento = pessoaUnica ? `de ${pessoaUnica}` : null; contexto = faseRot; break
      case 'solicitada': objeto = `${certidoes}${dePessoa}`; contexto = faseRot; break
      case 'cancelada': case 'reaberta': objeto = `${certidoes}${dePessoa}`; contexto = faseRot; efeito = null; break
      case 'exigencia_criada': verbo = 'registrou as exigências de'; objeto = certidoes; contexto = faseRot ?? 'a partir da árvore'; break
      case 'exigencia_removida': verbo = 'dispensou as exigências de'; objeto = certidoes; contexto = faseRot; break
      case 'nao_exigida': objeto = certidoes; contexto = null; break
      case 'linhagem': fraseLivre = `Sistema recalculou a linhagem da árvore ${n} vezes`; break
      case 'conferencia': fraseLivre = `Sistema conferiu as exigências documentais com os registros da árvore ${n} vezes`; break
      case 'espera_terceiro': verbo = 'passou a aguardar terceiros em'; objeto = certidoes; contexto = faseRot; break
      case 'protocolo': verbo = 'informou protocolos de'; objeto = certidoes; contexto = null; break
      case 'prazo': verbo = 'repactuou o prazo de'; objeto = certidoes; contexto = null; break
      // Qualquer outra ação feita de uma vez (modo linha do tempo): o verbo é o do fato e a contagem entra no objeto.
      default: objeto = certidoes; contexto = faseRot; break
    }
    // Motivo/justificativa/efeito só sobem ao cartão quando TODOS os membros dizem o mesmo; senão ficam em "Ver as N".
    const igual = (f: (m: Atomo) => string | null) => new Set(membros.map(f)).size === 1
    if (!igual((m) => m.motivo)) motivo = null
    if (!igual((m) => m.justificativa)) justificativa = null
    if (!igual((m) => m.efeito)) efeito = null
  }

  // O ANTES → DEPOIS do cartão: o do próprio fato; num lote, só o que TODOS dizem (o resto fica por item).
  let mudancas: Mudanca[] = a.mudancas
  if (n > 1) {
    const unicas = membros.map((m) => (m.mudancas.length === 1 ? m.mudancas[0] : null))
    if (unicas.every((m) => m != null && m.campo === unicas[0]!.campo)) {
      const antes = new Set(unicas.map((m) => m!.antes)), depois = new Set(unicas.map((m) => m!.depois))
      mudancas = depois.size === 1 ? [{ campo: unicas[0]!.campo, antes: antes.size === 1 ? [...antes][0] : null, depois: [...depois][0] }] : []
    } else mudancas = []
  }
  const reabrivel = a.subtipo === 'cancelada' && n === 1 && a.tarefaId != null && reabriveis.has(a.id) ? { tarefaId: a.tarefaId } : null
  return {
    id: n > 1 ? `g:${ordenados[ordenados.length - 1].id}+${n}` : a.id,
    quando: new Date(a.t).toISOString(), quem, tipo: a.tipo, subtipo: a.subtipo, rotuloSubtipo: ROTULO_SUBTIPO[a.subtipo],
    frase: redigir(quem.nome, { verbo, objeto, complemento, contexto, fraseLivre, motivo, justificativa, efeito }),
    nucleo: nucleoDe(quem.nome, { verbo, objeto, complemento, contexto, fraseLivre }),
    verbo, objeto: fraseLivre != null ? null : objeto, complemento, contexto,
    certidao: n > 1 ? null : a.certidao,
    pessoa: n > 1 ? pessoaUnica : nomeDaPessoa(ctx, a.pessoaId),
    pessoaId: n > 1 ? (pessoasDistintas.size === 1 ? a.pessoaId : null) : a.pessoaId,
    fase, passo: n > 1 ? null : a.passo, motivo, justificativa, efeito,
    automatico, quantidade: n, agrupadoDe: n > 1 ? ordenarCertidoesDaFamilia(ordenados, (x) => chaveDoAtomo(ctx, x)).map(itemDe) : [], links: linksDe(a), reabrivel,
    marco: membros.some((m) => m.marco), mudancas, lote: a.lote, faseDestino: a.faseDestino,
  }
}

// ─── API ────────────────────────────────────────────────────────────────────
export function montarFatos(linhas: LinhaCrua[], ctx: ContextoDoHistorico, opcoes: { agrupar?: ModoDeAgrupamento } = {}): ResultadoDoHistorico {
  const modo: ModoDeAgrupamento = opcoes.agrupar ?? 'sequencia'
  const { atomos, descartados, naoClassificados } = montarAtomos(linhas, ctx)
  const vivos = dedupe(atomos)

  // Só o ÚLTIMO cancelamento humano de uma tarefa que CONTINUA cancelada pode ser reaberto pela porta canônica.
  const ultimoCancel = new Map<number, number>()
  for (const a of vivos) if (a.subtipo === 'cancelada' && a.tarefaId != null) ultimoCancel.set(a.tarefaId, Math.max(ultimoCancel.get(a.tarefaId) ?? 0, a.t))
  const reabriveis = new Set<string>()   // ids dos ÁTOMOS (um cancelamento por vez), não da tarefa
  for (const a of vivos) {
    if (a.subtipo !== 'cancelada' || a.tarefaId == null || a.sistema) continue
    if (a.t === ultimoCancel.get(a.tarefaId) && ctx.tarefas[a.tarefaId]?.statusTarefa === 'CANCELADA') reabriveis.add(a.id)
  }

  // Agrupar: por chave, em ordem cronológica, encadeando enquanto o intervalo ≤ JANELA.
  const cronologico = [...vivos].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1))
  const abertos = new Map<string, Atomo[]>()
  const grupos: Atomo[][] = []
  for (const a of cronologico) {
    const chave = chaveDeGrupo(a, modo)
    if (chave == null) { grupos.push([a]); continue }
    const g = abertos.get(chave)
    if (g && (modo === 'minuto' || a.t - g[g.length - 1].t <= JANELA_DE_GRUPO_MS)) g.push(a)
    else { const novo = [a]; abertos.set(chave, novo); grupos.push(novo) }
  }
  const fatos = grupos.map((g) => montarFato(ctx, g, reabriveis)).sort((x, y) => (x.quando < y.quando ? 1 : x.quando > y.quando ? -1 : x.id < y.id ? 1 : -1))
  return { fatos, descartados, naoClassificados }
}
