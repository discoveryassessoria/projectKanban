// ============================================================================
// GET /api/home/search?q= — Busca global da Central Operacional
// ----------------------------------------------------------------------------
// Pesquisa integrada (não é filtro visual): processo (nome), família, requerente
// e cliente/contratante. Devolve resultados enxutos que abrem direto o processo
// no Kanban. Respeita permissão 'processos.ver'.
// ============================================================================

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"

export interface SearchResult {
  tipo: "processo" | "familia" | "requerente" | "cliente"
  id: number
  label: string
  sub: string | null
  processoId: number
  pais: string | null
  href: string
}

const LIMITE = 8

export async function GET(request: NextRequest) {
  try {
    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

    const isAdmin = usuario.tipo === "admin"
    if (!isAdmin && !temPermissao(usuario.permissoes, "processos.ver")) {
      return NextResponse.json({ resultados: [] })
    }

    const q = (new URL(request.url).searchParams.get("q") ?? "").trim()
    if (q.length < 2) return NextResponse.json({ resultados: [] })

    const contains = { contains: q, mode: "insensitive" as const }
    const href = (pid: number, pais: string | null) =>
      pais ? `/kanban?pais=${encodeURIComponent(pais)}&processoId=${pid}` : `/kanban?processoId=${pid}`

    const [processos, familias, requerentes, contratantes] = await Promise.all([
      prisma.processo.findMany({
        where: { nome: contains },
        select: { id: true, nome: true, pais: true, familia: { select: { nome: true } } },
        take: LIMITE,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.familia.findMany({
        where: { nome: contains },
        select: { id: true, nome: true, processos: { select: { id: true, nome: true, pais: true }, take: 3 } },
        take: LIMITE,
      }),
      prisma.requerente.findMany({
        where: { nome: contains },
        select: {
          id: true,
          nome: true,
          processos: { select: { processo: { select: { id: true, nome: true, pais: true } } }, take: 3 },
        },
        take: LIMITE,
      }),
      prisma.contratante.findMany({
        where: { nome: contains },
        select: {
          id: true,
          nome: true,
          processos: { select: { processo: { select: { id: true, nome: true, pais: true } } }, take: 3 },
        },
        take: LIMITE,
      }),
    ])

    const resultados: SearchResult[] = []
    const vistos = new Set<string>()
    const add = (r: SearchResult) => {
      const chave = `${r.tipo}:${r.id}:${r.processoId}`
      if (vistos.has(chave)) return
      vistos.add(chave)
      resultados.push(r)
    }

    for (const p of processos) {
      add({ tipo: "processo", id: p.id, label: p.nome, sub: p.familia?.nome ?? null, processoId: p.id, pais: p.pais, href: href(p.id, p.pais) })
    }
    for (const f of familias) {
      for (const p of f.processos) {
        add({ tipo: "familia", id: f.id, label: f.nome, sub: `Processo: ${p.nome}`, processoId: p.id, pais: p.pais, href: href(p.id, p.pais) })
      }
    }
    for (const r of requerentes) {
      for (const v of r.processos) {
        if (!v.processo) continue
        add({ tipo: "requerente", id: r.id, label: r.nome, sub: `Requerente · ${v.processo.nome}`, processoId: v.processo.id, pais: v.processo.pais, href: href(v.processo.id, v.processo.pais) })
      }
    }
    for (const c of contratantes) {
      for (const v of c.processos) {
        if (!v.processo) continue
        add({ tipo: "cliente", id: c.id, label: c.nome, sub: `Cliente · ${v.processo.nome}`, processoId: v.processo.id, pais: v.processo.pais, href: href(v.processo.id, v.processo.pais) })
      }
    }

    return NextResponse.json({ resultados: resultados.slice(0, 12) })
  } catch (e) {
    console.error("[/api/home/search] erro:", e)
    return NextResponse.json({ error: "Erro na busca" }, { status: 500 })
  }
}
