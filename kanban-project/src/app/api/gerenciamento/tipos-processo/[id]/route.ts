import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

/**
 * Um tipo de processo está "em uso" quando algo real aponta pra ele. Excluir
 * sem checar deixava essas relações (`onDelete: SetNull`) virarem `null` em
 * silêncio — processo, pendência financeira, regra e Workflow Interno
 * perdiam o vínculo sem ninguém ser avisado.
 */
async function usoReal(id: number) {
  const [processos, pendencias, workflows, versoes, regrasTransversais, regrasEconomicas, macroWorkflows] = await Promise.all([
    prisma.processo.count({ where: { tipoProcessoMotorId: id } }),
    prisma.pendenciaFinanceira.count({ where: { tipoProcessoId: id } }),
    prisma.phaseInternalWorkflow.count({ where: { tipoProcessoId: id } }),
    prisma.phaseInternalWorkflowVersao.count({ where: { tipoProcessoId: id } }),
    prisma.regraTarefaTransversal.count({ where: { tipoProcessoId: id } }),
    prisma.phaseEconomicRule.count({ where: { tipoProcessoId: id } }),
    // Workflow Macro publicado é uso real — excluir o Tipo CASCATEIA a
    // composição inteira (`onDelete: Cascade`). Sem esta checagem, um Tipo
    // com Workflow Macro publicado mas zero processo ainda podia ser
    // excluído, apagando a composição em silêncio.
    prisma.macroWorkflow.count({ where: { tipoProcessoId: id } }),
  ])
  return {
    processos, pendencias, workflows, versoes, regrasTransversais, regrasEconomicas, macroWorkflows,
    total: processos + pendencias + workflows + versoes + regrasTransversais + regrasEconomicas + macroWorkflows,
  }
}

// PUT - Atualizar tipo de processo
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.tipoProcessoNacionalidade.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Tipo de processo não encontrado' }, { status: 404 })

    const b = await request.json()

    // PAÍS NÃO MUDA DEPOIS DE CRIADO — é a IDENTIDADE da nacionalidade
    // ofertada (mesma regra de sempre, `paisId` obrigatório e imutável na
    // prática). MODALIDADE também deixou de ser um campo único do Tipo
    // (mandato "Reconstrução da hierarquia", 22/09/2026): um Tipo agora
    // HABILITA 1 ou 2 modalidades via `TipoProcessoModalidadeHabilitada` —
    // gerenciado por `PUT /api/gerenciamento/tipos-processo/[id]/modalidades`,
    // não por este PUT (que só edita code/name/ativo/arquivado).
    const tipo = await prisma.tipoProcessoNacionalidade.update({
      where: { id },
      data: {
        code: b.code !== undefined ? String(b.code).trim().toUpperCase() : atual.code,
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
        arquivado: b.arquivado !== undefined ? !!b.arquivado : atual.arquivado,
      },
    })

    return NextResponse.json({ tipo })
  } catch (error: any) {
    if (error?.code === 'P2002') return NextResponse.json({ error: 'Já existe um tipo de processo com esse código.' }, { status: 409 })
    console.error('Erro ao atualizar tipo de processo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir tipo de processo (bloqueado quando há uso real)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.tipoProcessoNacionalidade.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Tipo de processo não encontrado' }, { status: 404 })

    const uso = await usoReal(id)
    if (uso.total > 0) {
      return NextResponse.json(
        {
          error:
            `Este tipo de processo está em uso (${uso.processos} processo(s), ${uso.pendencias} pendência(s) financeira(s), ` +
            `${uso.workflows} workflow(s) interno(s), ${uso.versoes} versão(ões), ${uso.regrasTransversais} regra(s) transversal(is), ` +
            `${uso.regrasEconomicas} regra(s) econômica(s), ${uso.macroWorkflows} Workflow(s) Macro publicado(s)). Arquive em vez de excluir.`,
          codigo: 'EM_USO',
          uso,
        },
        { status: 409 },
      )
    }

    await prisma.tipoProcessoNacionalidade.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir tipo de processo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}