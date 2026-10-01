// src/lib/torre-terceiros-corpo.ts — lê o corpo comum das portas de cobrança da Torre › Terceiros (por pedido e por cartório).
// Só traduz o JSON em opções tipadas; a VALIDAÇÃO de regra (canal, resultado, 1–60 dias) é do serviço (`torre-terceiros.ts`).
export interface OpcoesLidas {
  canal: string | null; resultado: string | undefined; observacao: string | null; dataContato: Date | null; proximaEmDias: number | null
}

export function lerOpcoesDeCobranca(b: Record<string, unknown>): { ok: true; opcoes: OpcoesLidas } | { ok: false; erro: string } {
  const dataBruta = typeof b.dataContato === 'string' && b.dataContato.trim() ? new Date(b.dataContato) : null
  let proximaEmDias: number | null = null
  if (b.proximaEmDias !== undefined && b.proximaEmDias !== null && b.proximaEmDias !== '') {
    const n = typeof b.proximaEmDias === 'number' ? b.proximaEmDias : Number(b.proximaEmDias)
    if (!Number.isInteger(n)) return { ok: false, erro: '"Próxima cobrança em (dias)" deve ser um número inteiro' }
    proximaEmDias = n
  }
  return {
    ok: true,
    opcoes: {
      canal: typeof b.canal === 'string' && b.canal ? b.canal.toUpperCase() : null,
      resultado: typeof b.resultado === 'string' && b.resultado ? b.resultado.toUpperCase() : undefined,
      observacao: typeof b.observacao === 'string' ? b.observacao.trim() || null : null,
      dataContato: dataBruta && !Number.isNaN(dataBruta.getTime()) ? dataBruta : null,
      proximaEmDias,
    },
  }
}
