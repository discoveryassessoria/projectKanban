// src/lib/genealogia/registral/chaves.ts
//
// MRG — chaves de idempotência. Puro.
//
// Toda escrita do motor passa por uma destas funções. É o que garante o
// requisito 16 do protocolo: upload repetido, reprocessamento, job repetido,
// retomada após falha e execução concorrente NÃO duplicam nada.
//
// Regras que valem para todas:
//   · são DETERMINÍSTICAS (mesma entrada -> mesma chave, sempre);
//   · não contêm timestamp nem número aleatório — se contivessem, reprocessar
//     geraria chave nova e duplicaria;
//   · cabem em VARCHAR(200) (o limite das colunas `chaveIdempotencia`);
//   · quando a entrada é texto livre, entra o HASH estável do texto, não o texto.

import type { CampoRegistral, PapelOcorrencia, TipoPropostaRegistral } from "./tipos"

const TETO = 200

/**
 * Hash FNV-1a 32 bits em base36. Determinístico, sem dependência externa e
 * suficiente para desambiguar valor dentro de uma chave já escopada por
 * documento/campo (não é uso criptográfico).
 */
export function hashEstavel(v: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < v.length; i++) {
    h ^= v.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** Hash de 64 bits (dois FNV com sementes diferentes) para snapshots. */
export function hashSnapshot(v: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x1000193
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    h1 ^= c
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`
}

function cortar(s: string): string {
  if (s.length <= TETO) return s
  return `${s.slice(0, TETO - 9)}~${hashEstavel(s)}`
}

/**
 * LOTE — um lote por (processo, conjunto de documentos, versão do motor).
 * Reenviar o mesmo pedido devolve o lote existente em vez de criar outro.
 */
export function chaveLote(p: {
  processoId: number
  documentoIds: number[]
  versaoMotor: string
}): string {
  const ids = [...new Set(p.documentoIds)].sort((a, b) => a - b).join(",")
  return cortar(`mrg:lote:${p.processoId}:${p.versaoMotor}:${hashEstavel(ids)}:${p.documentoIds.length}`)
}

/**
 * EXECUÇÃO — uma execução por (lote, documento). Reprocessar o mesmo documento
 * no mesmo lote reusa a execução; reprocessamento explícito cria lote novo.
 */
export function chaveExecucao(p: { loteId: number; documentoId: number }): string {
  return cortar(`mrg:exec:${p.loteId}:${p.documentoId}`)
}

/**
 * OCORRÊNCIA — uma por (execução, papel, nome normalizado). Duas menções com o
 * mesmo papel e o mesmo nome no mesmo documento são a MESMA menção.
 */
export function chaveOcorrencia(p: {
  execucaoId: number
  papel: PapelOcorrencia
  nomeNormalizado: string
}): string {
  return cortar(`mrg:ocor:${p.execucaoId}:${p.papel}:${hashEstavel(p.nomeNormalizado)}`)
}

/**
 * EVIDÊNCIA — uma por (documento, campo, papel/sujeito, valor, método).
 * Inclui o método porque a leitura A e a leitura B do MESMO valor são DUAS
 * evidências independentes — e é exatamente isso que sustenta
 * "CONFIRMADO_MULTIPLAS_EVIDENCIAS".
 */
export function chaveEvidencia(p: {
  documentoId: number
  campo: CampoRegistral
  papel: PapelOcorrencia
  valorNormalizado: string
  metodo: string
  pessoaId?: number | null
  uniaoId?: number | null
}): string {
  const sujeito = p.pessoaId != null ? `p${p.pessoaId}` : p.uniaoId != null ? `u${p.uniaoId}` : "s0"
  return cortar(
    `mrg:evid:${p.documentoId}:${p.campo}:${p.papel}:${sujeito}:${hashEstavel(`${p.metodo}|${p.valorNormalizado}`)}`,
  )
}

/**
 * FATO — um fato ATIVO por (sujeito, campo, versão). A versão entra na chave
 * porque corrigir é criar a versão seguinte (append-only), e as duas precisam
 * coexistir.
 */
export function chaveFato(p: {
  pessoaId?: number | null
  uniaoId?: number | null
  campo: CampoRegistral
  versao: number
}): string {
  const sujeito = p.pessoaId != null ? `p${p.pessoaId}` : `u${p.uniaoId ?? 0}`
  return cortar(`mrg:fato:${sujeito}:${p.campo}:v${p.versao}`)
}

/** CORRESPONDÊNCIA — uma por (ocorrência, pessoa). */
export function chaveCorrespondencia(p: { ocorrenciaId: number; pessoaId: number }): string {
  return cortar(`mrg:corr:${p.ocorrenciaId}:${p.pessoaId}`)
}

/**
 * PROPOSTA — uma por (processo, tipo, alvo, campo, valor proposto).
 * O valor proposto entra na chave para que uma proposta REJEITADA não impeça uma
 * proposta DIFERENTE sobre o mesmo campo; e para que a MESMA proposta, vinda de
 * outro documento, seja reconhecida como a mesma (e ganhe evidência, não cópia).
 */
export function chaveProposta(p: {
  processoId: number
  tipo: TipoPropostaRegistral
  entidadeAlvo: string
  alvoId: number | null
  campo?: CampoRegistral | null
  valorProposto?: string | null
}): string {
  const alvo = `${p.entidadeAlvo}${p.alvoId ?? 0}`
  const valor = p.valorProposto ? hashEstavel(p.valorProposto) : "0"
  return cortar(`mrg:prop:${p.processoId}:${p.tipo}:${alvo}:${p.campo ?? "-"}:${valor}`)
}

/**
 * CONFLITO — um por (processo, código, sujeito, campo, assinatura do conteúdo).
 * Reprocessar o mesmo documento reabre o MESMO conflito, não um novo.
 */
export function chaveConflito(p: {
  processoId: number
  codigo: string
  pessoaId?: number | null
  uniaoId?: number | null
  campo?: CampoRegistral | null
  assinatura: string
}): string {
  const sujeito = p.pessoaId != null ? `p${p.pessoaId}` : p.uniaoId != null ? `u${p.uniaoId}` : "s0"
  return cortar(
    `mrg:conf:${p.processoId}:${p.codigo}:${sujeito}:${p.campo ?? "-"}:${hashEstavel(p.assinatura)}`,
  )
}

/** IMPACTO — um por (proposta, momento). */
export function chaveImpacto(p: { propostaId: number; momento: "PREVIO" | "POSTERIOR" }): string {
  return cortar(`mrg:imp:${p.propostaId}:${p.momento}`)
}

/**
 * DECISÃO — uma por (alvo, decisão, responsável, "rodada").
 * `rodada` é o número de decisões já registradas sobre o alvo: permite
 * aprovar → reverter → aprovar de novo sem colidir, e ainda assim bloqueia o
 * duplo-clique (mesma rodada, mesma decisão, mesmo responsável).
 */
export function chaveDecisao(p: {
  propostaId?: number | null
  conflitoId?: number | null
  decisao: string
  responsavelId: number | null
  rodada: number
}): string {
  const alvo = p.propostaId != null ? `prop${p.propostaId}` : `conf${p.conflitoId ?? 0}`
  return cortar(`mrg:dec:${alvo}:${p.decisao}:u${p.responsavelId ?? 0}:r${p.rodada}`)
}

/** EVENTO DE OUTBOX do motor. */
export function chaveEventoOutbox(p: {
  tipo: string
  processoId: number
  referencia: string | number
}): string {
  return cortar(`mrg:evt:${p.tipo}:${p.processoId}:${p.referencia}`)
}

/**
 * CORRELAÇÃO — identifica uma OPERAÇÃO ponta a ponta (lote, aplicação de
 * proposta, reversão) na auditoria e nos logs. Recebe o instante de fora
 * (nunca chama Date.now aqui: função pura), e o valor é estável para o mesmo
 * conjunto de entradas.
 */
export function correlationId(p: {
  prefixo: string
  processoId: number
  referencia: string | number
  instante: number
}): string {
  return `${p.prefixo}-${p.processoId}-${p.referencia}-${p.instante.toString(36)}`.slice(0, 60)
}
