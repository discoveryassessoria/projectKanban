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
import { escopoProcesso } from "@/src/lib/autorizacao/escopo-operacional"
import { idsQueContem } from "@/src/lib/busca-sem-acento"

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
/** `?ids=1`: o Kanban pede TODOS os processos que casam (mesma busca do menu, sem o teto de 8 por tipo). */
const LIMITE_IDS = 500

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

    const soIds = new URL(request.url).searchParams.get("ids") === "1"
    const limite = soIds ? LIMITE_IDS : LIMITE
    const porProcesso = soIds ? 500 : 3
    // SEM ACENTO E SEM CAIXA: "antao" acha "Antão". Os ids que casam saem de `busca-sem-acento` (translate, sem extensão do banco).
    const [idsProcesso, idsFamilia, idsRequerente, idsContratante] = await Promise.all([
      idsQueContem("Processo", q, limite), idsQueContem("Familia", q, limite), idsQueContem("Requerente", q, limite), idsQueContem("Contratante", q, limite),
    ])
    const href = (pid: number, pais: string | null) =>
      pais ? `/kanban?pais=${encodeURIComponent(pais)}&processoId=${pid}` : `/kanban?processoId=${pid}`

    // 🔒 ESCOPO: admin busca no universo global; operacional só acha
    // processo/família/requerente/cliente que tenham ALGUM processo dentro do
    // que é dela — autocomplete nunca pode revelar nome fora do escopo (ver
    // src/lib/autorizacao/escopo-operacional.ts).
    const escopo = escopoProcesso({ userId: usuario.userId, tipo: usuario.tipo })

    const [processos, familias, requerentes, contratantes] = await Promise.all([
      prisma.processo.findMany({
        // busca por NOME ou por CÓDIGO PÚBLICO (ex.: "DE-7", "IT-125").
        // `AND`, nunca espalhar `...escopo` direto aqui: `escopo` também é um
        // `OR` (ver escopoProcesso), e um objeto JS só pode ter uma chave
        // `OR` — espalhar as duas apagava a condição de busca por completo e
        // devolvia qualquer processo do escopo, ignorando o texto digitado.
        where: { AND: [{ id: { in: idsProcesso } }, escopo] },
        select: { id: true, nome: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } }, codigo: true, familia: { select: { nome: true } } },
        take: limite,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.familia.findMany({
        where: { id: { in: idsFamilia }, processos: { some: escopo } },
        select: { id: true, nome: true, processos: { where: escopo, select: { id: true, nome: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } } }, take: porProcesso } },
        take: limite,
      }),
      prisma.requerente.findMany({
        where: { id: { in: idsRequerente }, processos: { some: { processo: escopo } } },
        select: {
          id: true,
          publicCode: true,
          nome: true,
          processos: { where: { processo: escopo }, select: { processo: { select: { id: true, nome: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } } } } }, take: porProcesso },
        },
        take: limite,
      }),
      prisma.contratante.findMany({
        where: { id: { in: idsContratante }, processos: { some: { processo: escopo } } },
        select: {
          id: true,
          publicCode: true,
          nome: true,
          processos: { where: { processo: escopo }, select: { processo: { select: { id: true, nome: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } } } } }, take: porProcesso },
        },
        take: limite,
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
      add({ tipo: "processo", id: p.id, label: p.nome, sub: p.familia?.nome ?? null, processoId: p.id, pais: (p.paisCanonico?.countryKey ?? null), href: href(p.id, (p.paisCanonico?.countryKey ?? null)) })
    }
    for (const f of familias) {
      for (const p of f.processos) {
        add({ tipo: "familia", id: f.id, label: f.nome, sub: `Processo: ${p.nome}`, processoId: p.id, pais: (p.paisCanonico?.countryKey ?? null), href: href(p.id, (p.paisCanonico?.countryKey ?? null)) })
      }
    }
    for (const r of requerentes) {
      for (const v of r.processos) {
        if (!v.processo) continue
        add({ tipo: "requerente", id: r.id, label: r.publicCode ? `${r.publicCode} — ${r.nome}` : r.nome, sub: `Requerente · ${v.processo.nome}`, processoId: v.processo.id, pais: (v.processo?.paisCanonico?.countryKey ?? null), href: href(v.processo.id, (v.processo?.paisCanonico?.countryKey ?? null)) })
      }
    }
    for (const c of contratantes) {
      for (const v of c.processos) {
        if (!v.processo) continue
        add({ tipo: "cliente", id: c.id, label: c.publicCode ? `${c.publicCode} — ${c.nome}` : c.nome, sub: `Cliente · ${v.processo.nome}`, processoId: v.processo.id, pais: (v.processo?.paisCanonico?.countryKey ?? null), href: href(v.processo.id, (v.processo?.paisCanonico?.countryKey ?? null)) })
      }
    }

    if (soIds) return NextResponse.json({ processoIds: [...new Set(resultados.map((r) => r.processoId))] })
    return NextResponse.json({ resultados: resultados.slice(0, 12) })
  } catch (e) {
    console.error("[/api/home/search] erro:", e)
    return NextResponse.json({ error: "Erro na busca" }, { status: 500 })
  }
}
