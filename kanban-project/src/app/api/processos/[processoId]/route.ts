// src/app/api/processos/[processoId]/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { VINCULO_PROCESSO_ATIVO } from "@/src/lib/genealogia/vinculo-ativo"
import { logProcesso } from "@/lib/auditoria"
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { tentarAvancoAutomatico } from "@/src/lib/motor/auto-avanco"
import { removerFamiliaSeOrfa } from "@/src/services/familia"
import { excluirProcesso } from "@/src/services/processo-ciclo-vida"

// GET - Buscar processo por ID
export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const processo = await prisma.processo.findUnique({
      where: { id },
      include: {
        contratantes: {
          include: {
            contratante: true
          }
        },
        arvore: true,
        requerentes: {
          where: VINCULO_PROCESSO_ATIVO,
          include: {
            requerente: true
          }
        },
        tarefas: {
          include: {
            responsavel: true
          },
          orderBy: { createdAt: "desc" }
        },
        anexos: {
          orderBy: { createdAt: "desc" }
        }
      }
    })

    if (!processo) {
      return NextResponse.json(
        { error: "Processo não encontrado" },
        { status: 404 }
      )
    }

    // Formatar resposta
    const processoFormatado = {
      ...processo,
      contratantes: processo.contratantes.map(c => c.contratante),
      requerentes: processo.requerentes.map(r => r.requerente)
    }

    return NextResponse.json({ processo: processoFormatado })
  } catch (error) {
    console.error("Erro ao buscar processo:", error)
    return NextResponse.json(
      { error: "Erro ao buscar processo" },
      { status: 500 }
    )
  }
}

// PUT - Atualizar processo
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'processos.editar')
    if (erro) return erro

    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { 
      nome,
      descricao,
      observacoes,
      contratanteIds,
      arvoreId,
      previsaoTermino,
      dataConclusao,
      requerenteIds
    } = body

    // Verificar se o processo existe
    const processoExistente = await prisma.processo.findUnique({
      where: { id },
    })

    if (!processoExistente) {
      return NextResponse.json(
        { error: "Processo não encontrado" },
        { status: 404 }
      )
    }

    // A fase do processo NÃO é editável por esta rota genérica: ela é controlada
    // exclusivamente pelo PhaseAdvanceService (faseAtualKey). O legado
    // Processo.statusId foi removido — não há mais "mudar de fase" na edição.

    // Atualizar contratantes se fornecidos.
    //
    // DELETE + CREATE PRECISA SER UMA TRANSAÇÃO. Sem ela, dois PUTs quase
    // simultâneos (duplo clique em "Salvar", ou um retry depois de um erro
    // transitório) intercalam: A apaga, B apaga (nada), A recria, B recria —
    // e o `createMany` de B colide com a linha que A acabou de criar (unique
    // em processoId+contratanteId/requerenteId). Foi exatamente esse P2002
    // que apareceu em produção. `skipDuplicates` é o cinto de segurança: se
    // ainda assim sobrar uma corrida com OUTRO processo concorrente, o PUT
    // converge em vez de falhar.
    if (contratanteIds !== undefined) {
      await prisma.$transaction([
        prisma.processoContratante.deleteMany({ where: { processoId: id } }),
        ...(contratanteIds.length > 0
          ? [prisma.processoContratante.createMany({
              data: contratanteIds.map((contratanteId: number) => ({ processoId: id, contratanteId })),
              skipDuplicates: true,
            })]
          : []),
      ])
    }

    // Atualizar requerentes se fornecidos — mesmo motivo da transação acima.
    if (requerenteIds !== undefined) {
      await prisma.$transaction([
        prisma.processoRequerente.deleteMany({ where: { processoId: id } }),
        ...(requerenteIds.length > 0
          ? [prisma.processoRequerente.createMany({
              data: requerenteIds.map((requerenteId: number) => ({ processoId: id, requerenteId })),
              skipDuplicates: true,
            })]
          : []),
      ])
    }

    // Atualizar o processo
    await prisma.processo.update({
      where: { id },
      data: {
        nome: nome !== undefined ? nome : undefined,
        descricao: descricao !== undefined ? descricao : undefined,
        observacoes: observacoes !== undefined ? observacoes : undefined,
        arvoreId: arvoreId !== undefined ? arvoreId : undefined,
        previsaoTermino: previsaoTermino !== undefined 
          ? (previsaoTermino ? new Date(previsaoTermino) : null) 
          : undefined,
        dataConclusao: dataConclusao !== undefined 
          ? (dataConclusao ? new Date(dataConclusao) : null) 
          : undefined
      }
    })

    // ✅ REGISTRAR LOG (edição de dados; a fase é registrada pelo PhaseAdvanceService)
    await logProcesso.editar(processoExistente.nome, id)

    // AUTO-AVANÇO: requerente/árvore são ENTRADAS do gate (computeGate). Se a edição
    // desbloqueou a fase, o card deve ir sozinho — sem arrastar. advance() é idempotente
    // e gated (só avança com zero pendências blocking). Best-effort: não falha o PUT.
    if (requerenteIds !== undefined || arvoreId !== undefined) {
      await tentarAvancoAutomatico(id)
    }

    // Buscar processo atualizado
    const processoAtualizado = await prisma.processo.findUnique({
      where: { id },
      include: {
        contratantes: {
          include: {
            contratante: true
          }
        },
        arvore: true,
        requerentes: {
          where: VINCULO_PROCESSO_ATIVO,
          include: {
            requerente: true
          }
        },
        tarefas: {
          include: {
            responsavel: true
          },
          orderBy: { createdAt: "desc" }
        }
      }
    })

    // Formatar resposta
    const processoFormatado = {
      ...processoAtualizado,
      contratantes: processoAtualizado?.contratantes.map(c => c.contratante) || [],
      requerentes: processoAtualizado?.requerentes.map(r => r.requerente) || []
    }

    return NextResponse.json({ processo: processoFormatado })
  } catch (error) {
    console.error("Erro ao atualizar processo:", error)
    return NextResponse.json(
      { error: "Erro ao atualizar processo" },
      { status: 500 }
    )
  }
}

// DELETE - Excluir processo definitivamente
//
// NÃO faz `prisma.processo.delete()` cru. `excluirProcesso` (processo-ciclo-vida.ts)
// recusa a exclusão se existir fato financeiro já materializado (pagamento,
// estorno, baixa ou liquidação) ligado a este processo — a mesma régua que
// `pessoa-ciclo-vida.ts` já usa para Pessoa, aqui aplicada direto por
// `processoId` (ver docs/architecture/26-delete-processo-lifecycle-seguro.md).
//
// TAMBÉM NÃO apaga a Árvore. A versão anterior chamava `prisma.arvore.delete()`
// direto quando este era o último processo dela — sem `analisarExclusaoArvore`,
// sem frase de confirmação, contornando o guard que `DELETE /api/arvore/[id]`
// já paga o preço de ter. Uma árvore que fica sem processo depois desta rota
// permanece para os mecanismos canônicos JÁ EXISTENTES cuidarem dela.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    // EXCLUSIVA (ver PERMISSOES_EXCLUSIVAS): nunca concedida por perfil padrão
    // nem por `tipo = 'admin'` — só por concessão nominal, mesma régua de
    // `processos.moverFaseManual`. `processos.excluir` continua existindo para
    // outras portas (ex.: DELETE /api/familias/[id]) e não é usada aqui.
    const erro = await verificarPermissao(request, 'processos.excluirDefinitivo')
    if (erro) return erro

    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const usuario = await extrairUsuarioComPermissoes(request)

    const resultado = await excluirProcesso({ processoId: id, actorUserId: usuario?.userId ?? null })

    if (!resultado.ok) {
      if (resultado.code === "PROCESSO_NAO_ENCONTRADO") {
        return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
      }
      if (resultado.code === "FATO_FINANCEIRO_PROTEGIDO") {
        return NextResponse.json(
          {
            error: resultado.erro,
            code: resultado.code,
            fatos: resultado.plano?.fatosProtegidos.map((f) => f.descricao) ?? [],
          },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: resultado.erro ?? "Erro ao excluir processo" }, { status: 500 })
    }

    const plano = resultado.plano!

    // A FAMÍLIA NÃO PODE FICAR PARA TRÁS. Sem processo e sem árvore, ela não é
    // mais alcançável por porta nenhuma — é resíduo. `removerFamiliaSeOrfa` já
    // rechecha a contagem antes de apagar; comportamento preexistente, não
    // alterado por esta correção (ver docs/architecture/25, ND/portas de
    // exclusão — classificado como guardado).
    const familiaRemovida = await removerFamiliaSeOrfa(plano.familiaId)

    return NextResponse.json({
      message: [
        "Processo excluído com sucesso",
        familiaRemovida ? "família órfã removida" : null,
      ].filter(Boolean).join(" · "),
      familiaRemovida,
    })
  } catch (error) {
    console.error("Erro ao excluir processo:", error)
    return NextResponse.json(
      { error: "Erro ao excluir processo" },
      { status: 500 }
    )
  }
}
