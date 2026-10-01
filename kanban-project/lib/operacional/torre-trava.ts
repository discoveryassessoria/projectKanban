// lib/operacional/torre-trava.ts
// ============================================================================
// A TRAVA PARA AVANÇAR (Torre nova, frente H, 01/10/2026) — o cartão "Trava para avançar à <próxima fase>" do Detalhe.
//
// A TRAVA É O QUE O SISTEMA DIZ QUE IMPEDE O AVANÇO: as pendências BLOCKING que o `BlockingEngine` (`calcularPendencias`, que
// delega ao `computeGate` — a função-base única do gate) devolve para a fase atual. Aqui NÃO se recalcula nenhuma regra: só se
// TRADUZ cada código de pendência para o português de quem opera ("3 certidões obrigatórias ainda não concluídas"), agrupando
// as repetidas, e se junta o progresso real das certidões (a mesma completude da Central) quando a trava é documental.
// "Avançar na marra" (`forceAdvance`) exige justificativa e fica no histórico (`PhaseAdvanceLog` forçado) — a tela usa a porta
// `POST /api/processos/{id}/advance/force`; este módulo só diz SE há trava.
//
// A parte PURA (`traduzirPendencias`, `montarTrava`) é importável pela tela; o leitor carrega o motor sob demanda.
// ============================================================================
import type { BlockingIssue } from '@/src/lib/motor/blocking-helpers'

/** Cada código de pendência → como se diz em português. `n` = quantas vezes aparece. */
const TEXTO_POR_CODIGO: Record<string, (n: number) => string> = {
  CERTIDAO_OBRIGATORIA_PENDENTE: (n) => `${n} ${n === 1 ? 'certidão obrigatória ainda não concluída' : 'certidões obrigatórias ainda não concluídas'}`,
  NECESSIDADE_OBRIGATORIA_PENDENTE: (n) => `${n} ${n === 1 ? 'exigência documental obrigatória sem atender' : 'exigências documentais obrigatórias sem atender'}`,
  DOCUMENTO_NAO_LOCALIZADO: (n) => `${n} ${n === 1 ? 'documento obrigatório não localizado' : 'documentos obrigatórios não localizados'}`,
  NECESSIDADE_NAO_GERADA: () => 'a árvore ainda não gerou nenhuma certidão para esta fase',
  GENEALOGIA_SEM_ARVORE: () => 'o processo ainda não tem árvore vinculada',
  GENEALOGIA_SEM_REQUERENTE: () => 'nenhum requerente definido na árvore',
  PASSO_OBRIGATORIO_ABERTO: (n) => `${n} ${n === 1 ? 'passo obrigatório ainda aberto' : 'passos obrigatórios ainda abertos'}`,
  PASSO_PENDENTE_DEPENDENCIA: (n) => `${n} ${n === 1 ? 'passo esperando outro passo' : 'passos esperando outros passos'}`,
  PASSO_BLOQUEADO: (n) => `${n} ${n === 1 ? 'passo bloqueado' : 'passos bloqueados'}`,
  PASSO_FALHOU: (n) => `${n} ${n === 1 ? 'passo falhou' : 'passos falharam'}`,
  PASSO_AGUARDANDO_APROVACAO: (n) => `${n} ${n === 1 ? 'passo aguardando aprovação' : 'passos aguardando aprovação'}`,
  TAREFA_OBRIGATORIA_ABERTA: (n) => `${n} ${n === 1 ? 'tarefa obrigatória ainda aberta' : 'tarefas obrigatórias ainda abertas'}`,
  TAREFA_SEM_RESPONSAVEL: (n) => `${n} ${n === 1 ? 'tarefa sem responsável individual' : 'tarefas sem responsável individual'}`,
  TRANSVERSAL_OBRIGATORIA_ABERTA: (n) => `${n} ${n === 1 ? 'tarefa transversal obrigatória aberta' : 'tarefas transversais obrigatórias abertas'}`,
  BLOQUEIO_MANUAL_ATIVO: (n) => `${n} ${n === 1 ? 'bloqueio manual ativo' : 'bloqueios manuais ativos'}`,
  EVIDENCIA_OBRIGATORIA_AUSENTE: (n) => `${n} ${n === 1 ? 'passo exige evidência que falta' : 'passos exigem evidência que falta'}`,
  INSTANCIA_DUPLICADA_ATIVA: () => 'duas instâncias ativas da mesma fase (incidente a resolver antes de avançar)',
  DEPENDENCIA_QUEBRADA: (n) => `${n} ${n === 1 ? 'passo depende de um passo que não existe' : 'passos dependem de passos que não existem'}`,
  PROCESSO_NAO_ENCONTRADO: () => 'processo não encontrado',
}

/** Os códigos que são sobre CERTIDÕES (a trava vira "R de Q certidões recebidas e conferidas"). */
const CODIGOS_DE_CERTIDAO = new Set(['CERTIDAO_OBRIGATORIA_PENDENTE', 'NECESSIDADE_OBRIGATORIA_PENDENTE', 'DOCUMENTO_NAO_LOCALIZADO'])

/** As pendências BLOQUEANTES, agrupadas por código e traduzidas — na ordem em que aparecem. */
export function traduzirPendencias(issues: Array<Pick<BlockingIssue, 'code' | 'severity' | 'message'>>): Array<{ codigo: string; n: number; texto: string }> {
  const grupos = new Map<string, { n: number; mensagem: string }>()
  for (const i of issues) {
    if (i.severity !== 'BLOCKING') continue
    const g = grupos.get(i.code)
    grupos.set(i.code, { n: (g?.n ?? 0) + 1, mensagem: g?.mensagem ?? i.message })
  }
  return [...grupos].map(([codigo, g]) => ({ codigo, n: g.n, texto: TEXTO_POR_CODIGO[codigo]?.(g.n) ?? g.mensagem }))
}

export interface TravaDoProcesso {
  /** Há pendência bloqueante? */
  travado: boolean
  /** "Trava para avançar à Análise documental" · sem próxima fase: "Trava para concluir o processo" · sem trava: "Pode avançar à Análise documental". */
  rotulo: string
  /** A linha de destaque: "0 de 12 certidões recebidas e conferidas" (trava documental) ou a 1ª pendência traduzida. */
  titulo: string
  /** A linha cinza: a regra do avanço (ou as demais pendências). */
  detalhe: string
  pendencias: Array<{ codigo: string; n: number; texto: string }>
  proximaFaseLabel: string | null
  /** A fase atual (para a porta de avanço forçado e o texto). */
  faseAtualKey: string | null
}

/** "à Análise documental" · "ao Apostilamento" — a contração pelo gênero da 1ª palavra do rótulo (cadastro): termina em "o" (e não "ão") = masculino. */
export const aFase = (label: string): string => {
  const w = label.trim().split(/\s+/)[0].toLowerCase()
  return /[^ã]o$/.test(w) ? `ao ${label}` : `à ${label}`
}

const REGRA = 'o sistema não deixa avançar antes disso; avançar na marra exige justificativa e fica no histórico'

export function montarTrava(a: {
  issues: Array<Pick<BlockingIssue, 'code' | 'severity' | 'message'>>
  proximaFaseLabel: string | null
  faseAtualKey: string | null
  certidoes: { recebidas: number; requeridas: number }
}): TravaDoProcesso {
  const pendencias = traduzirPendencias(a.issues)
  const destino = a.proximaFaseLabel
  if (pendencias.length === 0) {
    return {
      travado: false, faseAtualKey: a.faseAtualKey, proximaFaseLabel: destino, pendencias,
      rotulo: destino ? `Pode avançar ${aFase(destino)}` : 'Última fase do caminho',
      titulo: destino ? 'Nada trava o avanço' : 'Não há próxima fase',
      detalhe: destino ? 'todas as exigências desta fase estão cumpridas; o avanço depende de alguém acionar' : 'este processo está na última fase do Workflow Macro',
    }
  }
  const documental = pendencias.some((p) => CODIGOS_DE_CERTIDAO.has(p.codigo)) && a.certidoes.requeridas > 0
  const titulo = documental
    ? `${a.certidoes.recebidas} de ${a.certidoes.requeridas} ${a.certidoes.requeridas === 1 ? 'certidão recebida e conferida' : 'certidões recebidas e conferidas'}`
    : pendencias[0].texto
  const outras = pendencias.filter((p) => (documental ? !CODIGOS_DE_CERTIDAO.has(p.codigo) : p !== pendencias[0])).map((p) => p.texto)
  return {
    travado: true, faseAtualKey: a.faseAtualKey, proximaFaseLabel: destino, pendencias,
    rotulo: destino ? `Trava para avançar ${aFase(destino)}` : 'Trava para concluir o processo',
    titulo,
    detalhe: outras.length ? `${REGRA} · também: ${outras.slice(0, 2).join('; ')}${outras.length > 2 ? ` e mais ${outras.length - 2}` : ''}` : REGRA,
  }
}

/** Lê as pendências da fase atual no motor canônico e monta a trava. */
export async function lerTravaDoProcesso(processoId: number, a: {
  faseAtualKey: string | null; proximaFaseLabel: string | null; certidoes: { recebidas: number; requeridas: number }
}): Promise<TravaDoProcesso | null> {
  if (!a.faseAtualKey) return null
  const { calcularPendencias } = await import('@/src/lib/motor/blocking-engine')
  const r = await calcularPendencias(processoId, a.faseAtualKey)
  return montarTrava({ issues: r.issues, proximaFaseLabel: a.proximaFaseLabel, faseAtualKey: a.faseAtualKey, certidoes: a.certidoes })
}
