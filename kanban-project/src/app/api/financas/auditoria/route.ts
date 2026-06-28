// CRIAR EM: src/app/api/financas/auditoria/route.ts
//
// GET /api/financas/auditoria — aba "Auditoria e Logs", dados REAIS.
// Fonte: LogAuditoria (acao, entidade, descricao, usuarioId, criadoEm).
// "Severidade" e "impacto" não existem no schema → severidade inferida pela
// ação (estorno/exclusão = crítico; alteração/aprovação = aviso; resto = info).

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

function inferirSeveridade(acao: string): "critico" | "aviso" | "info" {
  const a = (acao || "").toLowerCase()
  if (a.includes("estorn") || a.includes("exclu") || a.includes("delet") || a.includes("cancel") || a.includes("remov")) return "critico"
  if (a.includes("alter") || a.includes("aprov") || a.includes("edit") || a.includes("atualiz")) return "aviso"
  return "info"
}

export async function GET(_req: NextRequest) {
  try {
    const logs = await prisma.logAuditoria.findMany({
      orderBy: { criadoEm: "desc" },
      take: 100,
      select: {
        id: true, acao: true, entidade: true, descricao: true, criadoEm: true,
        usuario: { select: { nome: true } },
      },
    })

    const itens = logs.map((l) => ({
      id: l.id,
      acao: l.acao,
      entidade: l.entidade ?? "—",
      descricao: l.descricao ?? "",
      usuario: l.usuario?.nome ?? "Sistema",
      criadoEm: l.criadoEm,
      severidade: inferirSeveridade(l.acao),
    }))

    const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
    const eventosHoje = itens.filter((i) => new Date(i.criadoEm) >= hoje)
    const criticos = itens.filter((i) => i.severidade === "critico").length
    const avisos = itens.filter((i) => i.severidade === "aviso").length
    const automaticos = itens.filter((i) => i.usuario === "Sistema").length

    return NextResponse.json({
      kpis: {
        eventosHoje: eventosHoje.length,
        automaticosHoje: eventosHoje.filter((i) => i.usuario === "Sistema").length,
        manuaisHoje: eventosHoje.filter((i) => i.usuario !== "Sistema").length,
        criticos, avisos,
        pctAutomatico: itens.length > 0 ? (automaticos / itens.length) * 100 : 0,
        automaticos, total: itens.length,
      },
      logs: itens,
    })
  } catch (e) {
    console.error("[financas/auditoria] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar auditoria" }, { status: 500 })
  }
}