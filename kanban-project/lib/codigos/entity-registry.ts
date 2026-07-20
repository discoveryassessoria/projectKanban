// lib/codigos/entity-registry.ts
// REGISTRO ÚNICO entidade→gerador. É a fonte que liga cada modelo Prisma ao CodeGeneratorService
// central. Conectar uma entidade nova = 1 linha aqui (+ coluna publicCode + backfill). A geração
// no create é automática via extensão do Prisma Client (lib/prisma.ts) — sem lógica duplicada.
import type { EntidadeCodigo } from './code-patterns'

export interface RegistroCodigo {
  entidade: EntidadeCodigo   // tipo no CODE_PREFIX/escopoDe
  campo: string              // coluna de destino (sempre "publicCode" no rollout)
}

// Chave = nome do MODELO Prisma (como a extensão $extends reporta: PascalCase).
// Entidades já concluídas (Processo.codigo, Receita.codigo, Custo.codigo) NÃO entram aqui — usam
// o mesmo gerador por chamada explícita e não devem ser alteradas. OperacaoAntecipada gera OPA
// explicitamente no serviço; a extensão só age quando publicCode ainda não veio no data.
export const CODE_REGISTRY: Record<string, RegistroCodigo> = {
  ServicoProduto:      { entidade: 'SERVICE',               campo: 'publicCode' }, // SRV
  Documento:           { entidade: 'DOCUMENT',              campo: 'publicCode' }, // DOC
  Pessoa:              { entidade: 'PERSON',                campo: 'publicCode' }, // PES
  Fornecedor:          { entidade: 'SUPPLIER',              campo: 'publicCode' }, // FOR
  ProdutoFinanceiro:   { entidade: 'FINANCIAL_CONFIG',      campo: 'publicCode' }, // CFG
  TabelaValor:         { entidade: 'PRICE',                 campo: 'publicCode' }, // PRE
  Tarefa:              { entidade: 'TASK',                  campo: 'publicCode' }, // TAR
  Usuario:             { entidade: 'USER',                  campo: 'publicCode' }, // USR
  Evento:              { entidade: 'EVENT',                 campo: 'publicCode' }, // EVT
  Protocolo:           { entidade: 'PROTOCOL',              campo: 'publicCode' }, // PRO
  PhaseAutomationRule: { entidade: 'FINANCIAL_RULE',        campo: 'publicCode' }, // RGF
  OperacaoAntecipada:  { entidade: 'ANTICIPATED_OPERATION', campo: 'publicCode' }, // OPA (create já gera; extensão é no-op se já veio)
}
