// src/lib/document-generator.ts
//
// ⚠️ LEGADO_INATIVO — DESATIVADO na tarefa de desativação da lógica antiga da
// Genealogia. Este módulo criava Documento AUTOMATICAMENTE (origem="automatica",
// necessidadeId=null) a partir de regras hardcoded (DOCUMENT_RULES), o que gerava
// dados inconsistentes. As funções que PERSISTEM Documento
// (reconcileDocsForPessoa, reconcileAllForArvore) foram DESLIGADAS do runtime e
// agora LANÇAM erro se chamadas, para impedir reativação acidental. NÃO religar
// sem uma arquitetura documental aprovada.
//
// Ainda exportado como LEITURA PURA (não cria nada), pois a camada canônica
// PRESERVADA de NecessidadeDocumental (src/services/necessidade-documental.ts) e o
// cálculo da matriz econômica (src/lib/motor/matriz-economica.ts) consomem
// analyzePessoa/DOCUMENT_RULES apenas para LER flags — sem gerar Documento.

import type { Prisma, TipoDocumento } from "@prisma/client"

// ============================================================
// GUARD — geração automática de Documento DESATIVADA
// ============================================================
// Qualquer caminho que tente PERSISTIR Documento automaticamente passa por aqui
// e falha explicitamente. Removê-lo religa o legado inconsistente — não fazer.
const LEGADO_INATIVO_MSG =
  "[document-generator] LEGADO_INATIVO: a geração automática de Documento " +
  "(reconcileDocsForPessoa/reconcileAllForArvore/DOCUMENT_RULES) está DESATIVADA. " +
  "Criar/editar Pessoa não gera mais Documento. Reativar exige arquitetura documental aprovada."

// Retorna `void` (não `never`) DE PROPÓSITO: o corpo legado abaixo permanece
// "alcançável" para o type-checker (sem warnings de unreachable), mas em runtime
// esta barreira sempre lança ANTES de qualquer escrita no banco.
/** @internal Barreira anti-reativação da geração automática de Documento. */
function __assertGeracaoDocumentalDesativada(): void {
  throw new Error(LEGADO_INATIVO_MSG)
}

// ============================================================
// REGRAS — espelha DOCUMENT_RULES do §1.7 do mockup
// ============================================================

export type RuleCode = "NASC_IT" | "CAS_IT" | "OBT_IT"

interface DocumentRule {
  code: RuleCode
  tipo: TipoDocumento
  priority: number
  flag: "needsBirth" | "needsMarriage" | "needsDeath"
  reasonFn: (p: { nome: string; sobrenome?: string | null; vivo: boolean }) => string
}

export const DOCUMENT_RULES: DocumentRule[] = [
  {
    code: "NASC_IT",
    tipo: "CERTIDAO_NASCIMENTO_INTEIRO_TEOR",
    priority: 1,
    flag: "needsBirth",
    reasonFn: (p) =>
      `Certidão de nascimento de ${p.nome}${p.sobrenome ? " " + p.sobrenome : ""} — auto-gerada na criação da pessoa.`,
  },
  {
    code: "CAS_IT",
    tipo: "CERTIDAO_CASAMENTO_INTEIRO_TEOR",
    priority: 2,
    flag: "needsMarriage",
    reasonFn: (p) =>
      `Casamento na linha — certidão necessária para comprovar vínculo conjugal. Vínculo no nome de ${p.nome}${p.sobrenome ? " " + p.sobrenome : ""}.`,
  },
  {
    code: "OBT_IT",
    tipo: "CERTIDAO_OBITO_INTEIRO_TEOR",
    priority: 3,
    flag: "needsDeath",
    reasonFn: () => `Pessoa falecida — certidão de óbito necessária para encerramento de vínculo civil.`,
  },
]

// ============================================================
// FLAGS
// ============================================================

export interface PessoaForAnalysis {
  id: number
  nome: string
  sobrenome?: string | null
  casado: boolean
  vivo: boolean
}

export interface RuleFlags {
  needsBirth: boolean
  needsMarriage: boolean
  needsDeath: boolean
}

/**
 * Toda pessoa precisa de NASC (todo mundo nasceu).
 * CAS só se casado. OBT só se falecido.
 *
 * Se algum doc for desnecessário, o usuário cancela via
 * "Marcar como desnecessário" no fluxo de operação.
 */
export function analyzePessoa(p: PessoaForAnalysis): RuleFlags {
  return {
    needsBirth: true,
    needsMarriage: p.casado,
    needsDeath: !p.vivo,
  }
}

// ============================================================
// SEED
// ============================================================

export interface DocSeed {
  pessoaId: number
  tipo: TipoDocumento
  ruleCode: RuleCode
  origem: "automatica"
  status: "PENDENTE"
  descricao: string
}

export function generateDocsForPessoa(p: PessoaForAnalysis): DocSeed[] {
  const flags = analyzePessoa(p)
  const seeds: DocSeed[] = []
  for (const rule of DOCUMENT_RULES) {
    if (!flags[rule.flag]) continue
    seeds.push({
      pessoaId: p.id,
      tipo: rule.tipo,
      ruleCode: rule.code,
      origem: "automatica",
      status: "PENDENTE",
      descricao: rule.reasonFn(p),
    })
  }
  return seeds
}

// ============================================================
// RECONCILIAÇÃO
// ============================================================

export interface ReconcileResult {
  pessoaId: number
  createdCount: number
  createdRules: RuleCode[]
  alreadyExisted: RuleCode[]
}

/**
 * @deprecated LEGADO_INATIVO — DESATIVADA. Criava Documento automaticamente a
 * partir de DOCUMENT_RULES. Agora lança erro (guard anti-reativação). Não religar.
 */
export async function reconcileDocsForPessoa(
  pessoaId: number,
  tx: Prisma.TransactionClient | typeof import("@/lib/prisma").prisma,
): Promise<ReconcileResult> {
  // GUARD: geração automática de Documento está desligada (lança em runtime).
  __assertGeracaoDocumentalDesativada()
  const pessoa = await tx.pessoa.findUnique({
    where: { id: pessoaId },
    select: {
      id: true,
      nome: true,
      sobrenome: true,
      casado: true,
      vivo: true,
      documentos: {
        where: { origem: "automatica" },
        select: { ruleCode: true },
      },
    },
  })

  if (!pessoa) {
    throw new Error(`reconcileDocsForPessoa: pessoa ${pessoaId} não encontrada`)
  }

  const seeds = generateDocsForPessoa({
    id: pessoa.id,
    nome: pessoa.nome,
    sobrenome: pessoa.sobrenome,
    casado: pessoa.casado,
    vivo: pessoa.vivo,
  })

  const existingRules = new Set(
    pessoa.documentos
      .map((d) => d.ruleCode)
      .filter((c): c is RuleCode => c === "NASC_IT" || c === "CAS_IT" || c === "OBT_IT"),
  )

  const toCreate = seeds.filter((s) => !existingRules.has(s.ruleCode))

  if (toCreate.length === 0) {
    return {
      pessoaId,
      createdCount: 0,
      createdRules: [],
      alreadyExisted: Array.from(existingRules),
    }
  }

  await tx.documento.createMany({
    data: toCreate.map((s) => ({
      pessoaId: s.pessoaId,
      tipo: s.tipo,
      status: s.status,
      origem: s.origem,
      ruleCode: s.ruleCode,
      descricao: s.descricao,
    })),
  })

  return {
    pessoaId,
    createdCount: toCreate.length,
    createdRules: toCreate.map((s) => s.ruleCode),
    alreadyExisted: Array.from(existingRules),
  }
}

/**
 * @deprecated LEGADO_INATIVO — DESATIVADA. Reconciliava Documento de toda a árvore.
 * Agora lança erro (guard anti-reativação). Sem callers no runtime. Não religar.
 */
export async function reconcileAllForArvore(
  arvoreId: number,
  tx: Prisma.TransactionClient | typeof import("@/lib/prisma").prisma,
): Promise<{ totalCreated: number; perPessoa: ReconcileResult[] }> {
  // GUARD: geração automática de Documento está desligada (lança em runtime).
  __assertGeracaoDocumentalDesativada()
  const pessoas = await tx.pessoa.findMany({
    where: { arvoreId },
    select: { id: true },
  })

  const results: ReconcileResult[] = []
  for (const p of pessoas) {
    const r = await reconcileDocsForPessoa(p.id, tx)
    results.push(r)
  }

  return {
    totalCreated: results.reduce((acc, r) => acc + r.createdCount, 0),
    perPessoa: results,
  }
}

// ============================================================
// DRY-RUN
// ============================================================

export interface DryRunResult {
  pessoaId: number
  pessoaNome: string
  flags: RuleFlags
  wouldCreate: RuleCode[]
  alreadyExists: RuleCode[]
}

export async function dryRunReconcile(
  pessoaId: number,
  tx: Prisma.TransactionClient | typeof import("@/lib/prisma").prisma,
): Promise<DryRunResult> {
  const pessoa = await tx.pessoa.findUnique({
    where: { id: pessoaId },
    select: {
      id: true,
      nome: true,
      sobrenome: true,
      casado: true,
      vivo: true,
      documentos: {
        where: { origem: "automatica" },
        select: { ruleCode: true },
      },
    },
  })

  if (!pessoa) throw new Error(`dryRunReconcile: pessoa ${pessoaId} não encontrada`)

  const flags = analyzePessoa({
    id: pessoa.id,
    nome: pessoa.nome,
    sobrenome: pessoa.sobrenome,
    casado: pessoa.casado,
    vivo: pessoa.vivo,
  })

  const existing = new Set(
    pessoa.documentos
      .map((d) => d.ruleCode)
      .filter((c): c is RuleCode => c === "NASC_IT" || c === "CAS_IT" || c === "OBT_IT"),
  )

  const wouldCreate: RuleCode[] = []
  for (const rule of DOCUMENT_RULES) {
    if (flags[rule.flag] && !existing.has(rule.code)) {
      wouldCreate.push(rule.code)
    }
  }

  return {
    pessoaId,
    pessoaNome: `${pessoa.nome}${pessoa.sobrenome ? " " + pessoa.sobrenome : ""}`,
    flags,
    wouldCreate,
    alreadyExists: Array.from(existing),
  }
}