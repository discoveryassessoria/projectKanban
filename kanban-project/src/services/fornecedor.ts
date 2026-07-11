// src/services/fornecedor.ts
// CP-2 — service CANÔNICO ÚNICO de Fornecedor.
//
// Toda a validação e regra de persistência vivem AQUI. As rotas
// /api/gerenciamento/fornecedores (canônica) e /api/fornecedores (adaptador
// deprecated) apenas mapeiam request/response e aplicam seu gate de permissão,
// SEM reimplementar CRUD nem duplicar regra de negócio.

import { prisma } from "@/lib/prisma"
import { s } from "@/src/services/fornecedor-helpers"

export { s, digitosFiscais, chaveFiscal } from "@/src/services/fornecedor-helpers"

// Campos "ricos" comuns (superset). Não inclui nome/tipo (tratados à parte).
function camposComuns(b: Record<string, unknown>) {
  return {
    nomeFantasia: s(b.nomeFantasia),
    cpfCnpj: s(b.cpfCnpj),
    inscricaoEstadual: s(b.inscricaoEstadual),
    inscricaoMunicipal: s(b.inscricaoMunicipal),
    telefone: s(b.telefone),
    celular: s(b.celular),
    email: s(b.email),
    website: s(b.website),
    cep: s(b.cep),
    endereco: s(b.endereco),
    numero: s(b.numero),
    complemento: s(b.complemento),
    bairro: s(b.bairro),
    cidade: s(b.cidade),
    estado: s(b.estado),
    pais: s(b.pais),
    banco: s(b.banco),
    agencia: s(b.agencia),
    conta: s(b.conta),
    tipoConta: s(b.tipoConta),
    chavePix: s(b.chavePix),
    tipoChavePix: s(b.tipoChavePix),
    observacoes: s(b.observacoes),
  }
}

export interface ListarOpts {
  busca?: string | null
  ativo?: boolean | null
  comTotais?: boolean
}

export async function listarFornecedores(opts: ListarOpts = {}) {
  const where: Record<string, unknown> = {}
  if (opts.ativo !== undefined && opts.ativo !== null) where.ativo = opts.ativo
  if (opts.busca) {
    where.OR = [
      { nome: { contains: opts.busca, mode: "insensitive" } },
      { nomeFantasia: { contains: opts.busca, mode: "insensitive" } },
      { cpfCnpj: { contains: opts.busca } },
    ]
  }

  const fornecedores = await prisma.fornecedor.findMany({
    where,
    orderBy: { nome: "asc" },
    include: { _count: { select: { contasPagar: true } } },
  })

  if (!opts.comTotais) return fornecedores

  return Promise.all(
    fornecedores.map(async (f) => {
      const totalPago = await prisma.contaPagar.aggregate({
        where: { fornecedorId: f.id, status: "PAGO" },
        _sum: { valorPago: true },
      })
      return {
        ...f,
        totalContas: f._count.contasPagar,
        totalPago: totalPago._sum.valorPago?.toNumber() || 0,
      }
    })
  )
}

export async function obterFornecedor(id: number, opts: { incluirContas?: boolean } = {}) {
  return prisma.fornecedor.findUnique({
    where: { id },
    include: opts.incluirContas
      ? { contasPagar: { orderBy: { dataVencimento: "desc" }, take: 10 } }
      : undefined,
  })
}

export async function criarFornecedor(b: Record<string, unknown>) {
  const nome = s(b.nome)
  if (!nome) throw new Error("VALIDATION:Nome é obrigatório")
  const tipo = s(b.tipo) || "PJ" // legado default; a rota canônica exige tipo antes.
  return prisma.fornecedor.create({
    data: {
      nome,
      tipo,
      ...camposComuns(b),
      moedaPadrao: (b.moedaPadrao as "BRL" | "EUR" | "USD") || "BRL",
      ativo: b.ativo === undefined ? true : !!b.ativo,
    },
  })
}

export async function atualizarFornecedor(id: number, b: Record<string, unknown>) {
  const atual = await prisma.fornecedor.findUnique({ where: { id } })
  if (!atual) return null
  return prisma.fornecedor.update({
    where: { id },
    data: {
      // nome/tipo: se vier vazio, preserva o atual (lenient — validação estrita
      // fica na rota canônica).
      nome: s(b.nome) ?? atual.nome,
      tipo: s(b.tipo) ?? atual.tipo,
      ...camposComuns(b),
      moedaPadrao: (b.moedaPadrao as "BRL" | "EUR" | "USD") || atual.moedaPadrao,
      ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
    },
  })
}

export type RemocaoResultado =
  | { status: "not_found" }
  | { status: "in_use"; count: number }
  | { status: "deactivated" }
  | { status: "deleted" }

export async function removerFornecedor(
  id: number,
  opts: { seEmUso: "block" | "deactivate" }
): Promise<RemocaoResultado> {
  const atual = await prisma.fornecedor.findUnique({
    where: { id },
    include: { _count: { select: { contasPagar: true } } },
  })
  if (!atual) return { status: "not_found" }

  if (atual._count.contasPagar > 0) {
    if (opts.seEmUso === "block") return { status: "in_use", count: atual._count.contasPagar }
    await prisma.fornecedor.update({ where: { id }, data: { ativo: false } })
    return { status: "deactivated" }
  }

  await prisma.fornecedor.delete({ where: { id } })
  return { status: "deleted" }
}
