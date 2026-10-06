// lib/operacional/motivos-legiveis.ts
// ============================================================================
// CÓDIGO INTERNO NUNCA VAI PARA A TELA — módulo PURO, UMA tabela para a Torre inteira (histórico, lista de certidões canceladas / não
// exigidas, avisos, exportações). O que está gravado não muda (`CAUSA_REMOVIDA` segue sendo a chave estável de quem lê o banco); só a
// EXIBIÇÃO passa por aqui.
//
//   "por o Sistema · CAUSA_REMOVIDA"   →   "pelo sistema · causa removida da árvore"
//
// Código SEM tradução cadastrada nunca aparece cru: vira o próprio nome em minúsculas, sem sublinhado ("motivo_x" → "motivo x"), e
// `codigosSemTraducao` o devolve para quem quiser listar o que falta traduzir.
// ============================================================================
import { MOTIVOS_MOVIMENTACAO } from '@/src/lib/motor/motivos-movimentacao'
import { ROTULO_STATUS } from '@/src/lib/home/rotulo-status-tarefa'

/** código → português. Os motivos de movimentação de fase vêm do próprio catálogo oficial (`label`), uma fonte só. */
export const MOTIVO_EM_PORTUGUES: Readonly<Record<string, string>> = {
  // O estado da tarefa citado num texto ("estava NAO_INICIADA"): o mapa único de rótulos de status (`rotulo-status-tarefa.ts`).
  ...Object.fromEntries(Object.entries(ROTULO_STATUS).map(([k, v]) => [k, v.toLowerCase()])),
  ...Object.fromEntries(MOTIVOS_MOVIMENTACAO.map((m) => [m.codigo, m.label.charAt(0).toLowerCase() + m.label.slice(1)])),
  // Cancelamento / reconciliação
  CAUSA_REMOVIDA: 'causa removida da árvore',
  SUBSTITUIDA_PELA_TORRE: 'substituída pela Torre de Controle',
  NAO_EXIGIDA_PELA_ARVORE: 'não exigida pela árvore',
  CADASTRO_REMOVIDO: 'cadastro removido',
  RECONCILIADOR: 'reconciliação automática',
  SEM_MOTIVO: 'sem motivo informado',
  // Espera, bloqueio, reabertura
  AGUARDANDO_TERCEIRO: 'aguardando terceiros',
  ESPERA_EXTERNA: 'espera de terceiros',
  BLOQUEIO: 'bloqueio',
  REABERTURA: 'reabertura',
  // Fase e correções
  AVANCO_FORCADO_PELA_TORRE: 'avanço forçado pela Torre',
  CORRECAO_DE_FASE: 'correção de fase',
  CORRECAO_CADASTRO: 'correção de cadastro',
  ERRO_OPERACIONAL: 'erro operacional',
  AUDITORIA_INTEGRAL_FASES: 'auditoria integral das fases',
  PROCESSO_JA_EM_ANDAMENTO: 'processo já estava em andamento',
  RETORNO_PARA_REGULARIZACAO: 'retorno para regularização',
  OPERACAO_ADMINISTRATIVA: 'operação administrativa',
  OUTRO_AUTORIZADO: 'outro motivo (autorizado)',
  // Resíduos de teste que existem no banco de produção
  TESTE: 'teste',
  TEST_DELETE_SERVICE: 'teste do serviço de exclusão',
}

/** Um código: MAIÚSCULAS_COM_SUBLINHADO (pelo menos 3 letras), sozinho. */
const RE_CODIGO = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/
/** Um código DENTRO de um texto: precisa de sublinhado (ou ser um dos conhecidos), para não pegar sigla ("CRC", "SLA", "PDF"). */
const RE_CODIGO_NO_TEXTO = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b(?:CAUSA_REMOVIDA|TESTE|BLOQUEIO|REABERTURA|RECONCILIADOR)\b/g

const humanizar = (c: string): string => c.toLowerCase().replace(/_+/g, ' ').trim()

export const ehCodigoInterno = (v: string | null | undefined): boolean => !!v && v.trim().length >= 3 && RE_CODIGO.test(v.trim())

/** O motivo em português: código → tradução (ou o nome sem sublinhado); texto de gente passa intacto. */
export function motivoLegivel(bruto: string | null | undefined): string | null {
  const t = (bruto ?? '').trim()
  if (!t) return null
  if (ehCodigoInterno(t)) return MOTIVO_EM_PORTUGUES[t] ?? humanizar(t)
  return t
}

/** Traduz os códigos que aparecem no meio de um texto ("… · CAUSA_REMOVIDA" → "… · causa removida da árvore"). */
export function apresentarCodigos(texto: string): string {
  return texto.replace(RE_CODIGO_NO_TEXTO, (c) => MOTIVO_EM_PORTUGUES[c] ?? humanizar(c))
}

/** Os códigos de um texto que NÃO têm tradução cadastrada (para listar o que falta). */
export function codigosSemTraducao(texto: string): string[] {
  const achados = new Set<string>()
  for (const m of texto.matchAll(RE_CODIGO_NO_TEXTO)) if (!(m[0] in MOTIVO_EM_PORTUGUES)) achados.add(m[0])
  if (ehCodigoInterno(texto.trim()) && !(texto.trim() in MOTIVO_EM_PORTUGUES)) achados.add(texto.trim())
  return [...achados]
}

/** "por Marco Rovatti" / "pelo sistema" — nunca "por o Sistema". `nome` vazio = quem agiu foi o sistema. */
export function porQuem(nome: string | null | undefined): string {
  const n = (nome ?? '').trim()
  return n && !/^(o )?sistema$/i.test(n) ? `por ${n}` : 'pelo sistema'
}
