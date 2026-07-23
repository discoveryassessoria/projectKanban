// lib/financeiro/ledger/plano-contas.ts
// ============================================================================
// Plano de contas MÍNIMO do Ledger double-entry (Motor Financeiro V3 · Fase 1).
// PURO. Extensível sem mudar o modelo. Ver docs/motor-financeiro-discovery-spec.md §4.8
// ============================================================================

export const CONTA = {
  CAIXA_BANCO: '1.0',
  CLIENTES_A_RECEBER: '1.1',
  FORNECEDORES_A_PAGAR: '2.1',
  RECEITA_A_REALIZAR: '4.1',
  DESCONTOS: '4.2',
  ENCARGOS: '4.3', // juros/multa
  TAXAS: '5.1',
  DIFERENCA_CAMBIAL: '6.1',
  CREDITOS_CLIENTES: '7.1',
  SALDO_ABERTURA: '9.9',
} as const

export type CodigoConta = (typeof CONTA)[keyof typeof CONTA]

/** Seed idempotente do plano de contas (usado pelo seed de build). */
export const PLANO_CONTAS_SEED: { codigo: string; nome: string; tipo: string }[] = [
  { codigo: CONTA.CAIXA_BANCO, nome: 'Caixa/Banco', tipo: 'ATIVO' },
  { codigo: CONTA.CLIENTES_A_RECEBER, nome: 'Clientes a Receber', tipo: 'ATIVO' },
  { codigo: CONTA.FORNECEDORES_A_PAGAR, nome: 'Fornecedores/Custos a Pagar', tipo: 'PASSIVO' },
  { codigo: CONTA.RECEITA_A_REALIZAR, nome: 'Receita a Realizar', tipo: 'RECEITA' },
  { codigo: CONTA.DESCONTOS, nome: 'Descontos', tipo: 'RESULTADO' },
  { codigo: CONTA.ENCARGOS, nome: 'Encargos (juros/multa)', tipo: 'RECEITA' },
  { codigo: CONTA.TAXAS, nome: 'Taxas/Tarifas', tipo: 'DESPESA' },
  { codigo: CONTA.DIFERENCA_CAMBIAL, nome: 'Diferença Cambial', tipo: 'RESULTADO' },
  { codigo: CONTA.CREDITOS_CLIENTES, nome: 'Créditos de Clientes', tipo: 'PASSIVO' },
  { codigo: CONTA.SALDO_ABERTURA, nome: 'Saldo de Abertura', tipo: 'RESULTADO' },
]
