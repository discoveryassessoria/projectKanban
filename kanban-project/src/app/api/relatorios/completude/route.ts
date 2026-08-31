// src/app/api/relatorios/completude/route.ts
//
// COMPLETUDE — "o que deveria existir" contra "o que existe".
//
// Duas leituras da MESMA avaliação, e é de propósito que seja a mesma:
//
//   modo=pessoa    → 1 linha = 1 PESSOA. "O que falta para o Fulano?"
//   modo=requisito → 1 linha = 1 REQUISITO. "Quem está sem RG?"
//
// O inverso não é outra consulta: é a mesma avaliação agrupada pelo outro eixo.
// Dois motores dariam dois números para a mesma pergunta — que é exatamente o
// defeito que esta arquitetura existe para impedir.
//
// GRANULARIDADE DECLARADA acima porque relatório de completude é o caso clássico
// de inflar contagem por JOIN: uma pessoa com 3 documentos e 2 campos pendentes
// não são 6 pessoas.
//
// SOMENTE LEITURA. Nenhuma escrita, nenhum efeito.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { completudeDoProcesso, type RequisitoAvaliado } from "@/src/lib/requisitos/completude"

/** Teto de processos avaliados por chamada. Acima disso, refine os filtros. */
const TETO = 300

export async function GET(request: Request) {
  try {
    const erro = await verificarPermissao(request, "processos.ver_paginas")
    if (erro) return erro

    const q = new URL(request.url).searchParams
    const num = (k: string) => {
      const v = parseInt(q.get(k) ?? "")
      return Number.isInteger(v) ? v : null
    }
    const modo = q.get("modo") === "requisito" ? "requisito" : "pessoa"
    const processoId = num("processoId")
    const familiaId = num("familiaId")
    const paisKey = q.get("pais")           // countryKey do CatalogoPais
    const soPendentes = q.get("pendentes") === "1"
    const soBloqueadores = q.get("bloqueadores") === "1"

    const processos = await prisma.processo.findMany({
      where: {
        ...(processoId != null ? { id: processoId } : {}),
        ...(familiaId != null ? { familiaId } : {}),
        ...(paisKey ? { pais: paisKey } : {}),
      },
      select: { id: true, codigo: true, nome: true, pais: true, familia: { select: { id: true, nome: true } } },
      orderBy: { id: "desc" },
      take: TETO,
    })

    const avaliacoes = await Promise.all(processos.map((p) => completudeDoProcesso(p.id)))

    // ── MODO PESSOA — 1 linha = 1 pessoa ───────────────────────────────────
    const linhas: {
      requerenteId: number; nome: string
      processoId: number; processoCodigo: string | null; processoNome: string
      familiaId: number | null; familiaNome: string | null; pais: string | null
      aplicaveis: number; satisfeitos: number; pendentes: number; bloqueadores: number
      percentual: number; requisitos: RequisitoAvaliado[]
    }[] = []

    for (let i = 0; i < processos.length; i++) {
      const p = processos[i]
      const a = avaliacoes[i]
      if (!a) continue
      for (const pessoa of a.pessoas) {
        if (soBloqueadores && pessoa.bloqueadores === 0) continue
        if (soPendentes && pessoa.pendentes === 0) continue
        linhas.push({
          requerenteId: pessoa.requerenteId,
          nome: pessoa.nome,
          processoId: p.id,
          processoCodigo: p.codigo,
          processoNome: p.nome,
          familiaId: p.familia?.id ?? null,
          familiaNome: p.familia?.nome ?? null,
          pais: a.pais,
          aplicaveis: pessoa.aplicaveis,
          satisfeitos: pessoa.satisfeitos,
          pendentes: pessoa.pendentes,
          bloqueadores: pessoa.bloqueadores,
          percentual: pessoa.percentual,
          // Só o que ainda não está satisfeito viaja para a tela: a lista
          // completa de requisitos de cada pessoa é ruído no relatório de
          // pendências, e o detalhe integral vive no drill-down do processo.
          requisitos: pessoa.requisitos.filter((r) => r.estado !== "SATISFEITO"),
        })
      }
    }

    if (modo === "pessoa") {
      const totais = linhas.reduce(
        (acc, l) => ({
          pessoas: acc.pessoas + 1,
          pendentes: acc.pendentes + l.pendentes,
          bloqueadores: acc.bloqueadores + l.bloqueadores,
          completas: acc.completas + (l.pendentes === 0 ? 1 : 0),
        }),
        { pessoas: 0, pendentes: 0, bloqueadores: 0, completas: 0 },
      )
      return NextResponse.json({
        modo, granularidade: "1 linha = 1 pessoa",
        processosAvaliados: processos.length, truncado: processos.length === TETO,
        totais, linhas,
      })
    }

    // ── MODO REQUISITO — 1 linha = 1 requisito ─────────────────────────────
    // O inverso: "quem está sem RG?". Mesmo material, outro eixo.
    const porRequisito = new Map<string, {
      chave: string; rotulo: string; natureza: string; bloqueante: boolean
      pessoas: { requerenteId: number; nome: string; processoId: number; estado: string }[]
    }>()
    for (const l of linhas) {
      for (const r of l.requisitos) {
        // Agrupa pela IDENTIDADE do requisito (code/regra), não pelo rótulo —
        // dois requisitos com o mesmo nome não podem virar um.
        const id = r.origem.fonte === "RequisitoCadastral"
          ? `cad:${r.origem.code ?? r.origem.id}`
          : `doc:${r.origem.regraId ?? r.rotulo}`
        const atual = porRequisito.get(id) ?? {
          chave: id, rotulo: r.rotulo, natureza: r.natureza, bloqueante: r.bloqueante, pessoas: [],
        }
        atual.pessoas.push({ requerenteId: l.requerenteId, nome: l.nome, processoId: l.processoId, estado: r.estado })
        porRequisito.set(id, atual)
      }
    }
    const requisitos = [...porRequisito.values()]
      .map((r) => ({ ...r, quantidade: r.pessoas.length }))
      .sort((a, b) => b.quantidade - a.quantidade)

    return NextResponse.json({
      modo, granularidade: "1 linha = 1 requisito",
      processosAvaliados: processos.length, truncado: processos.length === TETO,
      totais: { requisitos: requisitos.length, pendencias: requisitos.reduce((n, r) => n + r.quantidade, 0) },
      requisitos,
    })
  } catch (error) {
    console.error("Erro no relatório de completude:", error)
    return NextResponse.json({ error: "Erro ao gerar o relatório de completude" }, { status: 500 })
  }
}
