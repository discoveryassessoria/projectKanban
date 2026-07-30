// GET  — detalhe da proposta: antes, depois, evidências dos dois lados,
//         impacto prévio e posterior, decisões e conflitos ligados.
// PATCH — decisão humana: aprovar | rejeitar | adiar | reverter.
//
// A permissão exigida NÃO é fixa: vem da matriz de automação (o tipo e a
// criticidade da proposta determinam quem pode decidir). Corrigir nome exige
// `registral.aprovar`; mexer em filiação exige `registral.alterar_filiacao`;
// mesclar identidade exige `registral.mesclar_pessoas` + desbloqueio explícito.
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { permissaoDaProposta } from "@/src/lib/genealogia/registral/campos"
import { detalharProposta } from "@/src/services/registral/consultas"
import { adiarProposta, aprovarProposta, rejeitarProposta, reverterProposta } from "@/src/services/registral/decisoes"
import { erro, exigir, exigirAlguma, idDe } from "@/src/services/registral/autorizacao"

export async function GET(request: NextRequest, { params }: { params: Promise<{ propostaId: string }> }) {
  const auth = await exigirAlguma(request, ["registral.revisar", "registral.aprovar", "registral.ver_evidencias"])
  if (!auth.ok) return auth.resposta

  const { propostaId: raw } = await params
  const propostaId = idDe(raw)
  if (propostaId == null) return erro("propostaId inválido")

  const proposta = await detalharProposta(propostaId)
  if (!proposta) return erro("Proposta não encontrada", 404)
  return NextResponse.json({ proposta })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ propostaId: string }> }) {
  const { propostaId: raw } = await params
  const propostaId = idDe(raw)
  if (propostaId == null) return erro("propostaId inválido")

  const body = await request.json().catch(() => ({}))
  const acao = String(body?.acao ?? "").toLowerCase()
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : ""

  const proposta = await prisma.propostaReconciliacao.findUnique({
    where: { id: propostaId },
    select: { tipo: true, criticidade: true },
  })
  if (!proposta) return erro("Proposta não encontrada", 404)

  // Reverter tem permissão própria; as demais seguem a matriz.
  const permissao = acao === "reverter" ? "registral.reverter" : permissaoDaProposta(proposta.tipo, proposta.criticidade)
  const auth = await exigir(request, permissao)
  if (!auth.ok) return auth.resposta

  const ator = auth.ctx.ator
  const desbloqueioExplicito = body?.desbloqueioExplicito === true

  switch (acao) {
    case "aprovar": {
      const r = await aprovarProposta({ propostaId, ator, motivo, desbloqueioExplicito })
      return NextResponse.json({ resultado: r }, { status: r.ok ? 200 : 409 })
    }
    case "rejeitar": {
      const r = await rejeitarProposta({ propostaId, ator, motivo, falsoPositivo: body?.falsoPositivo === true })
      return NextResponse.json({ resultado: r }, { status: r.ok ? 200 : 409 })
    }
    case "adiar": {
      const r = await adiarProposta({ propostaId, ator, motivo })
      return NextResponse.json({ resultado: r }, { status: r.ok ? 200 : 409 })
    }
    case "reverter": {
      const r = await reverterProposta({ propostaId, ator, motivo })
      return NextResponse.json({ resultado: r }, { status: r.ok ? 200 : 409 })
    }
    default:
      return erro("Ação inválida. Use: aprovar | rejeitar | adiar | reverter.")
  }
}
