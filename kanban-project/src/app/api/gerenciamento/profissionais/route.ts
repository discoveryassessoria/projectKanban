// src/app/api/gerenciamento/profissionais/route.ts
//
// O CADASTRO DE PROFISSIONAIS — listar e criar.
//
// Não entrou no registro genérico de cadastros porque ele é para CADASTRO PURO, e o
// profissional tem um filho com atributos próprios: a inscrição de classe (tipo,
// número, jurisdição). O registro genérico sabe relação N:N de vínculo simples, não
// coleção com forma própria — e fingir que sabe daria uma tela que mostra o
// profissional e esconde a OAB.

import { NextResponse } from "next/server"
import { prisma } from "@/src/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { registrarAuditoria } from "@/lib/gerenciamento/auditoria"

/** O que a tela precisa saber de cada profissional. */
const SELECT = {
  id: true, nome: true, email: true, telefone: true,
  observacoes: true, ativo: true, organizacaoId: true, categoriaId: true, criadoEm: true,
  categoria: { select: { id: true, code: true, nome: true } },
  organizacao: { select: { id: true, name: true, nomeFantasia: true } },
  registros: {
    orderBy: { id: "asc" as const },
    select: { id: true, tipo: true, numero: true, jurisdicao: true, ativo: true, orgaoDeClasseId: true },
  },
  _count: { select: { retificacoes: true } },
} as const

export async function GET(request: Request) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro

  const url = new URL(request.url)
  const busca = (url.searchParams.get("q") ?? "").trim()
  const incluirInativos = url.searchParams.get("inativos") === "1"

  const profissionais = await prisma.profissional.findMany({
    where: {
      ...(incluirInativos ? {} : { ativo: true }),
      // A BUSCA ALCANÇA O NÚMERO DO REGISTRO. Procurar "123456" e não achar o
      // advogado cuja OAB é 123456 seria uma busca que não busca.
      ...(busca
        ? {
            OR: [
              { nome: { contains: busca, mode: "insensitive" as const } },
              { email: { contains: busca, mode: "insensitive" as const } },
              { categoria: { nome: { contains: busca, mode: "insensitive" as const } } },
              { registros: { some: { numero: { contains: busca, mode: "insensitive" as const } } } },
              { organizacao: { name: { contains: busca, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    select: SELECT,
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
    take: 500,
  })
  return NextResponse.json({ profissionais })
}

export async function POST(request: Request) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const nome = String(body.nome ?? "").trim()
  const categoriaId = idOuNulo(body.categoriaId)
  if (!nome) return NextResponse.json({ error: "VALIDACAO", mensagem: "O nome é obrigatório." }, { status: 422 })
  if (!categoriaId) return NextResponse.json({ error: "VALIDACAO", mensagem: "Escolha a categoria profissional." }, { status: 422 })

  const registros = normalizarRegistros(body.registros)
  const problema = conferirRegistros(registros)
  if (problema) return NextResponse.json({ error: "VALIDACAO", mensagem: problema }, { status: 422 })

  try {
    const criado = await prisma.profissional.create({
      data: {
        nome, categoriaId,
        email: texto(body.email), telefone: texto(body.telefone), observacoes: texto(body.observacoes),
        organizacaoId: idOuNulo(body.organizacaoId),
        ativo: body.ativo === undefined ? true : !!body.ativo,
        registros: { create: registros },
      },
      select: SELECT,
    })
    await registrarAuditoria(request, {
      acao: "CRIAR", entidade: "Profissional", entidadeId: criado.id,
      descricao: `Profissional "${criado.nome}" (${criado.categoria.nome}) cadastrado.`,
    })
    return NextResponse.json({ ok: true, profissional: criado })
  } catch (e) {
    return NextResponse.json(traduzir(e), { status: 409 })
  }
}

// ── COMPARTILHADO COM A ROTA DE EDIÇÃO ──────────────────────────────────────

export const texto = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : ""
  return s === "" ? null : s
}
export const idOuNulo = (v: unknown) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

export interface RegistroEntrada {
  tipo: string; numero: string; jurisdicao: string | null
  orgaoDeClasseId: number | null; ativo: boolean
}

export function normalizarRegistros(v: unknown): RegistroEntrada[] {
  if (!Array.isArray(v)) return []
  return v.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    return {
      // O TIPO É VALOR, e sobe em caixa alta porque "oab" e "OAB" são a mesma
      // inscrição — e a unicidade é por (tipo, número, jurisdição).
      tipo: String(o.tipo ?? "").trim().toUpperCase(),
      numero: String(o.numero ?? "").trim(),
      jurisdicao: texto(o.jurisdicao)?.toUpperCase() ?? null,
      orgaoDeClasseId: idOuNulo(o.orgaoDeClasseId),
      ativo: o.ativo === undefined ? true : !!o.ativo,
    }
  }).filter((r) => r.tipo !== "" || r.numero !== "")
}

export function conferirRegistros(registros: RegistroEntrada[]): string | null {
  for (const r of registros) {
    if (!r.tipo) return "Todo registro precisa do tipo (OAB, CRC, …)."
    if (!r.numero) return `O registro ${r.tipo} está sem número.`
  }
  const vistos = new Set<string>()
  for (const r of registros) {
    const chave = `${r.tipo}|${r.numero}|${r.jurisdicao ?? ""}`
    if (vistos.has(chave)) return `O registro ${r.tipo} ${r.numero}${r.jurisdicao ? `/${r.jurisdicao}` : ""} está repetido.`
    vistos.add(chave)
  }
  return null
}

export function traduzir(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  // A INSCRIÇÃO É ÚNICA NO SISTEMA INTEIRO: "OAB 123456/SP" é uma pessoa só. Quando o
  // índice recusa, quem lê precisa saber que já existe alguém com aquele número — e
  // não "erro ao salvar".
  if (msg.includes("RegistroProfissional_tipo_numero_jurisdicao_key")) {
    return { error: "REGISTRO_DUPLICADO",
      mensagem: "Já existe outro profissional com esse registro. A inscrição identifica uma pessoa só." }
  }
  console.error("[profissionais]", e)
  return { error: "INTERNAL_ERROR", mensagem: "Não foi possível salvar." }
}
