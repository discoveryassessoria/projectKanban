// lib/operacional/torre-prioridade-lote.ts
// ============================================================================
// PRIORIDADE EM MASSA (aba Tarefas da Torre) — regras PURAS: quais níveis existem, como se chamam e o que o lote muda.
// Os níveis são os do modelo (`enum PrioridadeTarefa`): BAIXA · MEDIA · ALTA · URGENTE. "Voltar ao normal" = MEDIA (o padrão do modelo).
// Nada de coluna nova: só escolher entre os valores que já existem.
// ============================================================================
export type PrioridadeDoModelo = 'BAIXA' | 'MEDIA' | 'ALTA' | 'URGENTE'

/** Na ordem em que aparecem na escolha (do mais para o menos urgente). `rotulo` é o que a pessoa lê. */
export const PRIORIDADES_DO_LOTE: ReadonlyArray<{ valor: PrioridadeDoModelo; rotulo: string }> = [
  { valor: 'URGENTE', rotulo: 'Urgente' },
  { valor: 'ALTA', rotulo: 'Alta' },
  { valor: 'MEDIA', rotulo: 'Normal' },
  { valor: 'BAIXA', rotulo: 'Baixa' },
]
export const PRIORIDADE_NORMAL: PrioridadeDoModelo = 'MEDIA'

export const rotuloDaPrioridade = (p: string): string => PRIORIDADES_DO_LOTE.find((x) => x.valor === p)?.rotulo ?? p

export function prioridadeValida(v: unknown): PrioridadeDoModelo | null {
  const s = String(v ?? '').toUpperCase()
  return PRIORIDADES_DO_LOTE.some((p) => p.valor === s) ? (s as PrioridadeDoModelo) : null
}

/** Separa o que o lote vai mudar do que já está no nível pedido (ou não existe). */
export function separarPrioridadeDoLote(
  ids: number[], atuais: Map<number, string>, alvo: PrioridadeDoModelo,
): { aMudar: number[]; puladas: Array<{ tarefaId: number; mensagem: string }> } {
  const aMudar: number[] = []
  const puladas: Array<{ tarefaId: number; mensagem: string }> = []
  for (const id of ids) {
    if (!atuais.has(id)) puladas.push({ tarefaId: id, mensagem: 'tarefa não encontrada' })
    else if (atuais.get(id) === alvo) puladas.push({ tarefaId: id, mensagem: `já está com prioridade ${rotuloDaPrioridade(alvo).toLowerCase()}` })
    else aMudar.push(id)
  }
  return { aMudar, puladas }
}

/** "Prioridade alta em 3 tarefas" · "Prioridade voltou ao normal em 1 tarefa". */
export function textoDoLotePrioridade(p: PrioridadeDoModelo, n: number): string {
  const tarefas = `${n} ${n === 1 ? 'tarefa' : 'tarefas'}`
  return p === PRIORIDADE_NORMAL ? `Prioridade voltou ao normal em ${tarefas}` : `Prioridade ${rotuloDaPrioridade(p).toLowerCase()} em ${tarefas}`
}
