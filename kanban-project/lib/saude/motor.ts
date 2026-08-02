// lib/saude/motor.ts
//
// MOTOR DE DIAGNÓSTICO — executa o catálogo com isolamento, timeout e falha
// parcial segura.
//
// Garantias:
//   • uma verificação que estoura, trava ou explode NÃO derruba a rodada;
//   • falha técnica NUNCA vira "aprovada" — ela puxa o estado geral para
//     DIAGNÓSTICO INCOMPLETO;
//   • concorrência limitada (o diagnóstico não pode competir com a operação);
//   • progresso observável e cancelamento seguro.

import { elegiveis, catalogo, dominiosSemCobertura, VERSAO_CATALOGO, type Verificacao } from './catalogo'
import {
  ESTADO_POR_SEVERIDADE, piorEstado, type Dominio, type EstadoSaude, type ExecucaoVerificacao,
  type ModoExecucao, type ResultadoDiagnostico,
} from './tipos'

// O pool de conexões por instância é pequeno de propósito (ver lib/prisma.ts) e
// há verificação que dispara várias consultas em paralelo. Concorrência alta
// esgota o pool e transforma verificação boa em FALHA_TECNICA — diagnóstico
// incompleto por limite de infraestrutura, não por problema real do sistema.
const CONCORRENCIA_PADRAO = 2

/** Corre a verificação com relógio próprio. Timeout é resultado, não exceção solta. */
async function comTimeout(v: Verificacao, ctx: { agora: Date; modo: ModoExecucao }): Promise<ExecucaoVerificacao> {
  const inicio = Date.now()
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const resultado = await Promise.race([
      v.executar(ctx),
      new Promise<never>((_, rejeitar) => {
        timer = setTimeout(() => rejeitar(new Error(`timeout após ${v.timeoutMs}ms`)), v.timeoutMs)
      }),
    ])
    const achados = resultado.achados ?? []
    return {
      codigo: v.codigo,
      status: achados.length ? 'COM_ACHADOS' : 'APROVADA',
      duracaoMs: Date.now() - inicio,
      achados,
      metricas: resultado.metricas,
      resumo: resultado.resumo,
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    return {
      codigo: v.codigo,
      status: /timeout/i.test(msg) ? 'TIMEOUT' : 'FALHA_TECNICA',
      duracaoMs: Date.now() - inicio,
      achados: [],
      erro: msg.slice(0, 400),
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface OpcoesExecucao {
  modo?: ModoExecucao
  /** roda só estes códigos (usado pelo "Executar somente falhas") */
  somenteCodigos?: string[]
  concorrencia?: number
  /** chamado a cada verificação concluída — progresso observável */
  aoProgredir?: (feitas: number, total: number, codigo: string) => void
  /** cancelamento seguro: o que já rodou é preservado */
  sinal?: AbortSignal
}

/**
 * Executa o diagnóstico. SEMPRE devolve resultado — mesmo com falhas parciais,
 * mesmo cancelado. O que não rodou aparece como NAO_EXECUTADA, nunca some.
 */
export async function executarDiagnostico(opts: OpcoesExecucao = {}): Promise<ResultadoDiagnostico> {
  const modo = opts.modo ?? 'COMPLETO'
  const agora = new Date()
  const iniciadoEm = agora.toISOString()
  const t0 = Date.now()
  const ctx = { agora, modo }

  const doModo = elegiveis(modo)
  const alvo = opts.somenteCodigos?.length
    ? doModo.filter((v) => opts.somenteCodigos!.includes(v.codigo))
    : doModo

  const execucoes: ExecucaoVerificacao[] = []
  const fila = [...alvo]
  const concorrencia = Math.max(1, opts.concorrencia ?? CONCORRENCIA_PADRAO)
  let feitas = 0

  const trabalhador = async () => {
    for (;;) {
      const v = fila.shift()
      if (!v) return
      if (opts.sinal?.aborted) {
        execucoes.push({ codigo: v.codigo, status: 'NAO_EXECUTADA', duracaoMs: 0, achados: [], erro: 'execução cancelada' })
        continue
      }
      const r = await comTimeout(v, ctx)
      execucoes.push(r)
      feitas++
      opts.aoProgredir?.(feitas, alvo.length, v.codigo)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, alvo.length || 1) }, trabalhador))

  // As elegíveis que ficaram de fora do recorte continuam sendo "não executadas"
  // para efeito de cobertura — o recorte não pode fabricar completude.
  const codigosRodados = new Set(execucoes.map((e) => e.codigo))
  for (const v of doModo) {
    if (!codigosRodados.has(v.codigo)) {
      execucoes.push({ codigo: v.codigo, status: 'NAO_EXECUTADA', duracaoMs: 0, achados: [] })
    }
  }

  return consolidar({ modo, iniciadoEm, duracaoMs: Date.now() - t0, execucoes, elegiveisDoModo: doModo })
}

/** Calcula estado geral, cobertura e contagens. É aqui que a honestidade mora. */
export function consolidar(args: {
  modo: ModoExecucao
  iniciadoEm: string
  duracaoMs: number
  execucoes: ExecucaoVerificacao[]
  elegiveisDoModo: Verificacao[]
  /** injetável para teste; por padrão lê o catálogo real */
  semCobertura?: Dominio[]
}): ResultadoDiagnostico {
  const { modo, iniciadoEm, duracaoMs, execucoes, elegiveisDoModo } = args
  const porCodigo = new Map(elegiveisDoModo.map((v) => [v.codigo, v]))

  const aprovadas = execucoes.filter((e) => e.status === 'APROVADA').length
  const comAchados = execucoes.filter((e) => e.status === 'COM_ACHADOS').length
  const falhasTecnicas = execucoes.filter((e) => e.status === 'FALHA_TECNICA' || e.status === 'TIMEOUT').length
  const naoExecutadas = execucoes.filter((e) => e.status === 'NAO_EXECUTADA').length
  const executadas = aprovadas + comAchados

  const todosAchados = execucoes.flatMap((e) => e.achados)
  const criticos = todosAchados.filter((a) => a.severidade === 'CRITICO').length
  const erros = todosAchados.filter((a) => a.severidade === 'ERRO').length
  const alertas = todosAchados.filter((a) => a.severidade === 'ALERTA').length
  const informativos = todosAchados.filter((a) => a.severidade === 'INFORMATIVO').length

  // ── estado geral: SEMPRE o pior encontrado; média jamais esconde crítico ──
  let estado: EstadoSaude = 'SAUDAVEL'
  const motivos: string[] = []

  for (const a of todosAchados) estado = piorEstado(estado, ESTADO_POR_SEVERIDADE[a.severidade])
  if (criticos) motivos.push(`${criticos} achado(s) crítico(s)`)
  else if (erros) motivos.push(`${erros} erro(s)`)
  else if (alertas) motivos.push(`${alertas} alerta(s)`)

  // Falha técnica ou verificação não executada ⇒ diagnóstico incompleto. Só piora
  // o estado (um crítico continua crítico); nunca melhora.
  const obrigatoriasPendentes = execucoes.filter(
    (e) => (e.status === 'NAO_EXECUTADA' || e.status === 'FALHA_TECNICA' || e.status === 'TIMEOUT')
      && porCodigo.get(e.codigo)?.obrigatoria !== false,
  )
  const semCobertura = args.semCobertura ?? dominiosSemCobertura()

  if (obrigatoriasPendentes.length || semCobertura.length) {
    if (obrigatoriasPendentes.length) {
      motivos.push(`${obrigatoriasPendentes.length} verificação(ões) obrigatória(s) sem resultado`)
    }
    if (semCobertura.length) motivos.push(`${semCobertura.length} domínio(s) obrigatório(s) sem cobertura`)
    estado = piorEstado(estado, 'DIAGNOSTICO_INCOMPLETO')
  }
  // Nada rodou: o próprio motor não conseguiu operar.
  if (elegiveisDoModo.length > 0 && executadas === 0) {
    estado = 'INDISPONIVEL'
    motivos.unshift('nenhuma verificação pôde ser executada')
  }

  const totalCatalogo = catalogo().length
  const coberturaPercentual = elegiveisDoModo.length
    ? Math.round((executadas / elegiveisDoModo.length) * 100)
    : 0

  return {
    modo,
    estado,
    motivoEstado: motivos.length ? motivos.join(' · ') : 'todas as verificações obrigatórias concluídas sem achados',
    iniciadoEm,
    concluidoEm: new Date(new Date(iniciadoEm).getTime() + duracaoMs).toISOString(),
    duracaoMs,
    versaoCatalogo: VERSAO_CATALOGO,
    totalCatalogo,
    totalElegiveis: elegiveisDoModo.length,
    executadas,
    aprovadas,
    comAchados,
    falhasTecnicas,
    naoExecutadas,
    coberturaPercentual,
    dominiosSemCobertura: semCobertura,
    criticos,
    erros,
    alertas,
    informativos,
    execucoes: execucoes.sort((a, b) => a.codigo.localeCompare(b.codigo)),
  }
}
