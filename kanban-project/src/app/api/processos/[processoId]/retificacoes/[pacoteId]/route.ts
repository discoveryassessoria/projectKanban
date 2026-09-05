// src/app/api/processos/[processoId]/retificacoes/[pacoteId]/route.ts
//
// DETALHE DE UM PEDIDO DE RETIFICAÇÃO — projeção de leitura, sem gravar nada.
//
// Não existia rota nenhuma que respondesse "o que este pedido tem e em que passo ele
// está": a tela de pedidos (`PedidosDeRetificacao.tsx`) listava só o resumo. Isto
// projeta, a partir dos donos canônicos (RetificacaoPacote, PhaseWorkflowStepInstance,
// OrgaoProtocolo, Protocolo, Profissional), tudo que a tela precisa mostrar — nada é
// copiado ou recalculado fora deles.

import { NextResponse } from "next/server"
import { prisma } from "@/src/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

const PASSO_ENCERRADO: string[] = ["CONCLUIDO", "CANCELADO", "DISPENSADO", "SUPERSEDIDO"]

export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string; pacoteId: string }> },
) {
  const erro = await verificarPermissao(request, "processos.editar")
  if (erro) return erro

  const { processoId, pacoteId } = await params
  const procId = Number(processoId)
  const pktId = Number(pacoteId)
  if (!Number.isInteger(procId) || !Number.isInteger(pktId)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  }

  const pacote = await prisma.retificacaoPacote.findFirst({
    where: { id: pktId, processoId: procId },
    select: {
      id: true, num: true, tipo: true, status: true, motivo: true, processoNum: true,
      createdAt: true, updatedAt: true,
      orgao: { select: { id: true, name: true, nomeFantasia: true, type: true, city: true, state: true, ativo: true } },
      protocoloRef: { select: { id: true, numeroProtocolo: true, numeroProcesso: true, dataProtocolo: true, setor: true, situacao: true } },
      profissional: {
        select: {
          id: true, nome: true, ativo: true,
          categoria: { select: { nome: true } },
          organizacao: { select: { name: true, nomeFantasia: true } },
          registros: { where: { ativo: true }, orderBy: { id: "asc" }, select: { tipo: true, numero: true, jurisdicao: true } },
        },
      },
      divergencias: {
        orderBy: { divergenciaId: "asc" },
        select: {
          divergencia: {
            select: {
              id: true, campoLabel: true, pessoaNome: true, documentoTitulo: true, documentoId: true,
              valorArvore: true, valorDocumento: true, severidade: true, status: true,
            },
          },
        },
      },
      passos: {
        orderBy: { ordem: "asc" },
        select: {
          id: true, stepKey: true, status: true, ordem: true, obrigatorio: true,
          prazo: true, startedAt: true, completedAt: true,
          responsavel: { select: { nome: true } },
        },
      },
    },
  })
  if (!pacote) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })

  const passos = pacote.passos
  const passoAtual = passos.find((p) => !PASSO_ENCERRADO.includes(p.status)) ?? null
  const progresso = passos.length
    ? Math.round((passos.filter((p) => p.status === "CONCLUIDO").length / passos.length) * 100)
    : 0

  return NextResponse.json({
    pacote: {
      id: pacote.id, num: pacote.num, tipo: pacote.tipo, status: pacote.status,
      motivo: pacote.motivo, processoNum: pacote.processoNum,
      createdAt: pacote.createdAt, updatedAt: pacote.updatedAt,
      orgao: pacote.orgao, protocolo: pacote.protocoloRef, profissional: pacote.profissional,
      divergencias: pacote.divergencias.map((d) => d.divergencia),
    },
    passos,
    passoAtualId: passoAtual?.id ?? null,
    progresso,
  })
}
