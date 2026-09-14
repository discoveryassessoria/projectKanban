// lib/operacional/atencao-operacional.ts
// ============================================================================
// AS 8 CATEGORIAS DE ATENÇÃO + O RANKING — a regra canônica de "o que Minha
// Operação mostra primeiro", numa peça PURA (sem `prisma`, sem I/O).
//
// Fica separada de `tarefa-projecoes.ts` de propósito: aquele módulo importa
// `@/lib/prisma` no topo, então nenhum símbolo de lá pode entrar num bundle de
// cliente. Esta regra não é nova lógica de negócio — é a MESMA leitura de
// atenção que `central-tarefas.tsx` já fazia como `FILTROS` (client-side,
// sobre os mesmos booleanos canônicos: `emRisco`, `atrasoInterno`,
// `atrasoTerceiro`, `acompanhamentoVencido`, `retornoRecebido`,
// `executavelAgora`, `coluna`, `atribuidaEm`) — só nomeada e reaproveitável
// pelos dois lados (KPI, chip e tabela nunca podem divergir, mandato §43).
// ============================================================================

export type CategoriaAtencao =
  | 'paraAgirAgora' | 'novasAtribuicoes' | 'acompanharHoje' | 'atrasoInterno'
  | 'terceirosAtrasados' | 'aguardandoTerceiros' | 'retornoRecebido' | 'emRisco'

export const CATEGORIAS_ATENCAO: Array<{ chave: CategoriaAtencao; rotulo: string; tooltip: string }> = [
  { chave: 'paraAgirAgora', rotulo: 'Para agir agora', tooltip: 'A operação está executável e é sua vez de agir.' },
  { chave: 'novasAtribuicoes', rotulo: 'Novas atribuições', tooltip: 'Atribuída a você nas últimas 48 horas e ainda não iniciada.' },
  { chave: 'acompanharHoje', rotulo: 'Acompanhar hoje', tooltip: 'O próximo acompanhamento programado já venceu.' },
  { chave: 'atrasoInterno', rotulo: 'Atraso interno', tooltip: 'O prazo interno (seu) já passou — não é atraso de terceiro.' },
  { chave: 'terceirosAtrasados', rotulo: 'Terceiros atrasados', tooltip: 'A previsão do terceiro (cartório/tradutor/etc.) já venceu; não é atraso seu.' },
  { chave: 'aguardandoTerceiros', rotulo: 'Aguardando terceiros', tooltip: 'A operação está aberta, esperando uma resposta externa.' },
  { chave: 'retornoRecebido', rotulo: 'Retorno recebido', tooltip: 'O terceiro respondeu — existe ação operacional pendente.' },
  { chave: 'emRisco', rotulo: 'Em risco', tooltip: 'O motor não conseguiu determinar com segurança quem age, o quê, ou quando volta à atenção.' },
]

/** O contrato mínimo que a categorização e o ranking precisam — um subconjunto estrutural de `LinhaGerencial`. */
export interface LinhaComAtencao {
  taskId: number
  coluna: string
  dataPrazo: string | null
  atrasada: boolean
  venceHoje: boolean
  executavelAgora: boolean
  atribuidaEm: string | null
  acompanhamentoVencido: boolean
  atrasoInterno: boolean
  atrasoTerceiro: boolean
  retornoRecebido: boolean
  emRisco: boolean
}

const JANELA_NOVA_ATRIBUICAO_MS = 48 * 3600_000

/** As categorias que esta linha pertence — NÃO exclusivas (uma linha pode estar em risco E com terceiro atrasado). */
export function categoriasDaLinha(l: LinhaComAtencao): CategoriaAtencao[] {
  const cats: CategoriaAtencao[] = []
  if (l.executavelAgora && (l.coluna === 'A_FAZER' || l.coluna === 'EM_ANDAMENTO')) cats.push('paraAgirAgora')
  if (l.coluna === 'A_FAZER' && l.atribuidaEm != null && Date.now() - new Date(l.atribuidaEm).getTime() <= JANELA_NOVA_ATRIBUICAO_MS) cats.push('novasAtribuicoes')
  if (l.acompanhamentoVencido) cats.push('acompanharHoje')
  if (l.atrasoInterno) cats.push('atrasoInterno')
  if (l.atrasoTerceiro) cats.push('terceirosAtrasados')
  if (l.coluna === 'AGUARDANDO_TERCEIRO') cats.push('aguardandoTerceiros')
  if (l.retornoRecebido) cats.push('retornoRecebido')
  if (l.emRisco) cats.push('emRisco')
  return cats
}

/**
 * O DEGRAU DE ATENÇÃO — determinístico, excludente, nesta ordem (mandato
 * "Minha Operação" §78): atraso interno crítico (atrasada + a causa é
 * interna) → atraso interno → follow-up vencido → retorno recebido → ação
 * necessária hoje → nova atribuição → em risco → aguardando terceiro →
 * demais.
 */
function degrauDeAtencao(l: LinhaComAtencao): number {
  if (l.atrasada && l.atrasoInterno) return 0
  if (l.atrasoInterno) return 1
  if (l.acompanhamentoVencido) return 2
  if (l.retornoRecebido) return 3
  if (l.venceHoje && l.executavelAgora) return 4
  if (l.coluna === 'A_FAZER' && l.atribuidaEm != null && Date.now() - new Date(l.atribuidaEm).getTime() <= JANELA_NOVA_ATRIBUICAO_MS) return 5
  if (l.emRisco) return 6
  if (l.coluna === 'AGUARDANDO_TERCEIRO') return 7
  return 8
}

/**
 * O RÓTULO DE ATENÇÃO DA LINHA — a primeira coluna da tabela (mandato §14).
 * Deriva SEMPRE dos mesmos booleanos canônicos do ranking — nunca uma
 * prioridade paralela: se `prioridade` (campo canônico da Tarefa) já é
 * URGENTE, ela aparece; o resto é leitura operacional (atraso/risco/hoje),
 * não um segundo campo de prioridade inventado pela UI.
 */
export function rotuloDeAtencao(l: LinhaComAtencao & { prioridade: string }): { rotulo: string; tom: 'critico' | 'alerta' | 'neutro' } {
  if (l.atrasada && l.atrasoInterno) return { rotulo: 'Crítico', tom: 'critico' }
  if (l.atrasoInterno) return { rotulo: 'Atrasado', tom: 'critico' }
  if (l.acompanhamentoVencido || l.retornoRecebido) return { rotulo: 'Atenção', tom: 'alerta' }
  if (l.venceHoje && l.executavelAgora) return { rotulo: 'Hoje', tom: 'alerta' }
  if (l.prioridade === 'URGENTE') return { rotulo: 'Urgente', tom: 'alerta' }
  if (l.emRisco) return { rotulo: 'Em risco', tom: 'alerta' }
  if (l.coluna === 'AGUARDANDO_TERCEIRO') return { rotulo: 'Aguardando', tom: 'neutro' }
  return { rotulo: 'Normal', tom: 'neutro' }
}

/**
 * HUMANIZAÇÃO DE MOTIVO DE RISCO — mandato "Minha Operação" §16-18.
 *
 * `motivosRisco` (de `computarProximoAcontecimento`, `proximo-acontecimento.ts`)
 * é diagnóstico técnico: o código é estável e às vezes carrega detalhe bruto
 * depois de ":" (ex. `CONFLITO_PRAZO_TAREFA_PASSO: Tarefa.dataPrazo=... ×
 * PhaseWorkflowStepInstance.prazo=...`). Isso é correto para auditoria/Saúde
 * do Sistema — NUNCA para a Daniela. Esta função é a ÚNICA tradução para
 * linguagem operacional; o código técnico continua disponível (chamador
 * decide se mostra, ex. um tooltip administrativo), nunca é apagado.
 */
const HUMANIZACAO_RISCO: Record<string, string> = {
  CONFLITO_PRAZO_TAREFA_PASSO: 'Conflito de prazo: o prazo do passo atual diverge do prazo geral desta operação.',
  CONFLITO_RETORNO_TERCEIRO: 'O último contato registra retorno recebido, mas o pedido formal ainda não foi confirmado como respondido — divergência entre as duas fontes.',
  RETORNO_SEM_ACAO_INTERNA: 'O terceiro respondeu, mas a operação continua marcada como em espera.',
  AGUARDANDO_SEM_PREVISAO_NEM_ACOMPANHAMENTO: 'Esta operação está aguardando terceiro sem previsão de retorno nem próximo acompanhamento definidos.',
  ACOMPANHAMENTO_VENCIDO: 'O próximo acompanhamento programado já venceu.',
  SEM_PROXIMO_ACONTECIMENTO_DETERMINAVEL: 'Não foi possível determinar o que acontece a seguir nesta operação.',
  SEM_RESPONSAVEL_PARA_PROXIMA_ACAO: 'Esta operação não possui responsável definido para agir.',
}

export function humanizarMotivoRisco(motivo: string): { texto: string; codigo: string } {
  const codigo = motivo.split(':')[0]?.trim() ?? motivo
  return { texto: HUMANIZACAO_RISCO[codigo] ?? 'Não foi possível determinar a próxima ação desta operação com segurança.', codigo }
}

/** A ordem que a operação olha primeiro — dentro do mesmo degrau, prazo mais próximo, depois `taskId` (determinístico). */
export function ordenarPorAtencaoOperacional<T extends LinhaComAtencao>(linhas: T[]): T[] {
  return [...linhas].sort((a, b) => {
    const d = degrauDeAtencao(a) - degrauDeAtencao(b)
    if (d !== 0) return d
    const pa = a.dataPrazo ? Date.parse(a.dataPrazo) : Number.POSITIVE_INFINITY
    const pb = b.dataPrazo ? Date.parse(b.dataPrazo) : Number.POSITIVE_INFINITY
    if (pa !== pb) return pa - pb
    return a.taskId - b.taskId
  })
}
