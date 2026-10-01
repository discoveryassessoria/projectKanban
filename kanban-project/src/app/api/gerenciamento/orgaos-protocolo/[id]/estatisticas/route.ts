// src/app/api/gerenciamento/orgaos-protocolo/[id]/estatisticas/route.ts
// ============================================================================
// ESTATÍSTICAS DE UM ÓRGÃO — Torre de Controle, Bloco C (29/09/2026).
//
//   GET /api/gerenciamento/orgaos-protocolo/{id}/estatisticas
//
// SÓ NÚMEROS COM ORIGEM GRAVADA — nenhum contador novo, nenhuma tabela nova.
// Reaproveita `visaoGerencial` (Tarefa.orgaoId, o mesmo filtro que qualquer
// outra fila usa) para as tarefas, e `ContatoTerceiro.orgaoId` (já gravado
// por `registrarCobranca`) para as cobranças — as mesmas fontes que a
// Operação e o Bloco B já leem, nunca uma segunda contagem.
// ============================================================================
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { visaoGerencial } from "@/lib/operacional/tarefa-projecoes"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro

  const { id: idStr } = await params
  const orgaoId = Number(idStr)
  if (!Number.isInteger(orgaoId) || orgaoId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 })
  }

  try {
    const orgao = await prisma.orgaoProtocolo.findUnique({
      where: { id: orgaoId },
      select: { id: true, name: true, nomeFantasia: true, type: true, publicCode: true },
    })
    if (!orgao) return NextResponse.json({ error: "Órgão não encontrado." }, { status: 404 })

    const [tarefasResp, cobrancasPorResultado, cobrancasTotal] = await Promise.all([
      // `incluirEncerradas` — canceladas/supersedidas também são fato sobre
      // ESTE órgão (ex.: quantas certidões dele nunca saíram do lugar), não
      // ruído a esconder de uma tela de estatística.
      visaoGerencial({ orgaoId, incluirEncerradas: true, porPagina: 500 }),
      prisma.contatoTerceiro.groupBy({ by: ["resultado"], where: { orgaoId, estornadoEm: null }, _count: { _all: true } }),
      prisma.contatoTerceiro.count({ where: { orgaoId, estornadoEm: null } }),
    ])

    const linhas = tarefasResp.linhas
    const porEstadoOperacao = { FILA: 0, AGUARDANDO: 0, CONCLUIDA: 0 }
    const porStatusTarefa: Record<string, number> = {}
    let atrasadas = 0
    let escaladas = 0
    for (const l of linhas) {
      porEstadoOperacao[l.estadoOperacao] = (porEstadoOperacao[l.estadoOperacao] ?? 0) + 1
      porStatusTarefa[l.statusTarefa] = (porStatusTarefa[l.statusTarefa] ?? 0) + 1
      if (l.atrasada) atrasadas++
      if (l.escalada) escaladas++
    }

    const porResultado: Record<string, number> = {}
    for (const c of cobrancasPorResultado) porResultado[c.resultado] = c._count._all

    return NextResponse.json({
      orgao,
      tarefas: {
        // `visaoGerencial` pagina em até 500 — `parcial` avisa se este órgão
        // já passou disso (nenhum órgão real chega perto hoje, mas a tela
        // nunca deve mostrar um total incompleto calado).
        total: tarefasResp.total,
        parcial: tarefasResp.total > linhas.length,
        porEstadoOperacao,
        porStatusTarefa,
        atrasadas,
        escaladas,
      },
      cobrancas: {
        total: cobrancasTotal,
        porResultado,
      },
    })
  } catch (e) {
    console.error("GET orgaos-protocolo/[id]/estatisticas", e)
    return NextResponse.json({ error: "Erro ao carregar estatísticas do órgão." }, { status: 500 })
  }
}
