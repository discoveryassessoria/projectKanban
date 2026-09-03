// src/app/api/processos/[processoId]/necessidades/[necessidadeId]/route.ts
// CP-3 — detalhe + transições de estado da NecessidadeDocumental (append-only).
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { marcarNaoLocalizada, reabrir, retornoGenealogia, dispensarNecessidade, atenderNecessidade, iniciarAtendimentoNecessidade } from "@/src/services/necessidade-documental"
import { tentarAvancoAutomaticoSeNecessidadeDaFaseAtual } from "@/src/lib/motor/auto-avanco"
import { notificarNecessidadeTransicionada } from "@/src/services/registral/gancho-documental"

// GET - detalhe da necessidade + histórico (eventos) + documentos que a atendem
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string; necessidadeId: string }> }
) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro
  try {
    const { necessidadeId: nid } = await params
    const id = parseInt(nid)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const necessidade = await prisma.necessidadeDocumental.findUnique({
      where: { id },
      include: {
        itemCatalogo: { select: { id: true, code: true, name: true } },
        documentos: { select: { id: true, status: true, arquivo_nome: true } },
        eventos: { orderBy: { criadoEm: "asc" } },
      },
    })
    if (!necessidade) return NextResponse.json({ error: "Necessidade não encontrada" }, { status: 404 })
    return NextResponse.json({ necessidade })
  } catch (error) {
    console.error("Erro ao buscar necessidade:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

// PATCH - transições: nao_localizada | reabrir | retorno_genealogia | dispensar | atender | em_atendimento
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string; necessidadeId: string }> }
) {
  const erro = await verificarPermissao(request, "processos.editar")
  if (erro) return erro
  try {
    const { processoId: pidStr, necessidadeId: nid } = await params
    const id = parseInt(nid)
    const pid = parseInt(pidStr)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const acao = body.acao as string

    // AUTO-AVANÇO: necessidade é ENTRADA do gate da fase. Quando uma transição
    // completa/dispensa uma necessidade obrigatória, o card deve ir sozinho — sem
    // arrastar. Dispara após a transição (gancho idempotente e gated).
    //
    // ESCOPADO À FASE ATUAL: uma necessidade também pode pertencer só a uma etapa de
    // fase HISTÓRICA (regularização manual de fase anterior, processo já reposicionado
    // adiante) — transicioná-la não pode reavaliar nem mover a fase corrente. Só
    // dispara se existir etapa desta necessidade na fase ATUAL do processo.
    const avancar = () => tentarAvancoAutomaticoSeNecessidadeDaFaseAtual(isNaN(pid) ? null : pid, id)

    // MRG — RECONCILIAÇÃO CONTÍNUA: transição de necessidade muda o que está
    // comprovado, e portanto a linhagem. Publica evento (best-effort, fora do
    // caminho crítico; não altera nenhuma resposta desta rota).
    const reconciliarRegistral = () =>
      notificarNecessidadeTransicionada({ necessidadeId: id }).catch((e) =>
        console.error("[necessidade → gancho registral]", e),
      )

    switch (acao) {
      case "nao_localizada": {
        const necessidade = await marcarNaoLocalizada(id)
        await avancar()
        await reconciliarRegistral()
        return NextResponse.json({ necessidade })
      }
      case "reabrir": {
        const nova = await reabrir(id)
        await reconciliarRegistral()
        return NextResponse.json({ necessidade: nova }, { status: 201 })
      }
      case "retorno_genealogia":
        return NextResponse.json({ necessidade: await retornoGenealogia(id, body.motivo) })
      case "dispensar": {
        // Transição CANÔNICA pelo serviço de domínio (nenhuma escrita direta de status).
        await dispensarNecessidade(id, typeof body.motivo === "string" ? body.motivo : undefined)
        await avancar()
        await reconciliarRegistral()
        return NextResponse.json({ necessidade: await prisma.necessidadeDocumental.findUnique({ where: { id } }) })
      }
      case "em_atendimento": {
        await iniciarAtendimentoNecessidade(id)
        await reconciliarRegistral()
        return NextResponse.json({ necessidade: await prisma.necessidadeDocumental.findUnique({ where: { id } }) })
      }
      case "atender": {
        await atenderNecessidade(id)
        await avancar()
        await reconciliarRegistral()
        return NextResponse.json({ necessidade: await prisma.necessidadeDocumental.findUnique({ where: { id } }) })
      }
      default:
        return NextResponse.json({ error: "Ação inválida" }, { status: 400 })
    }
  } catch (error) {
    console.error("Erro ao transicionar necessidade:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
