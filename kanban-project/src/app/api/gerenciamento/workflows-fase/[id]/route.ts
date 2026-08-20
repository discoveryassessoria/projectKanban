import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { publicarNovaVersao, congelarVersaoVigente } from '@/src/services/versao-publicada'

function slug(s: string) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// monta as linhas de passo já com workflowId e CHAVES ÚNICAS dentro do workflow
function buildSteps(raw: any[], workflowId: number) {
  const seen = new Set<string>()
  return (raw || []).map((s: any, i: number) => {
    let base = s?.key ? slug(String(s.key)) : slug(String(s?.label || ''))
    if (!base) base = 'passo_' + (i + 1)
    let key = base, n = 2
    while (seen.has(key)) { key = base + '_' + n; n++ }
    seen.add(key)
    return {
      workflowId,
      key,
      label: String(s?.label || 'Etapa'),
      description: s?.description ? String(s.description) : null,
      ordem: i + 1,
      createsTask: s?.createsTask !== false,
      required: s?.required !== false,
      owner: s?.owner ? String(s.owner) : null,
      priority: s?.priority || 'medium',
      slaDays: Number(s?.slaDays) || 0,
      // CARDINALIDADE OPERACIONAL persistida do passo. null = herda o escopo da fase.
      // Não confundir com "global (compartilhado)", que é o compartilhamento do WORKFLOW.
      cardinalidade: ['PROCESSO', 'PESSOA', 'NECESSIDADE', 'DOCUMENTO'].includes(String(s?.cardinalidade))
        ? String(s.cardinalidade)
        : null,
      completionRule: s?.completionRule ? String(s.completionRule) : null,
      checklist: (s?.checklist == null ? undefined : s.checklist) as Prisma.InputJsonValue | undefined,
    }
  })
}

// PUT — atualiza o workflow. Se vier "steps", SUBSTITUI todos os passos (atômico).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const body = await request.json()

    const atual = await prisma.phaseInternalWorkflow.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Workflow não encontrado.' }, { status: 404 })

    const dataBase: Prisma.PhaseInternalWorkflowUpdateInput = {}
    if (body.name !== undefined) dataBase.name = String(body.name)
    // MODO DE EXECUÇÃO persistido (SEQUENCIAL | PARALELO) — é ele que decide se a fase
    // libera um passo por vez ou todos; nunca uma regra fixa no código.
    if (body.execucao !== undefined) {
      dataBase.execucao = body.execucao === 'PARALELO' ? 'PARALELO' : 'SEQUENCIAL'
    }
    if (body.active !== undefined) dataBase.active = !!body.active
    if (body.arquivado !== undefined) dataBase.arquivado = !!body.arquivado

    // EDITAR UM WORKFLOW PUBLICADO É PUBLICAR UMA VERSÃO NOVA.
    //
    // O conteúdo vigente é CONGELADO antes de qualquer alteração, e só então a
    // definição muda e o número da versão anda. Processos em execução guardam o
    // número antigo e passam a ler o conteúdo congelado — nada do que eles
    // materializaram é reinterpretado pela configuração de hoje.
    //
    // Tudo numa transação só: entre congelar, alterar e incrementar não pode haver
    // janela em que a versão vigente aponte para conteúdo que já mudou.
    const usuario = await extrairUsuarioComPermissoes(request)
    const mudouDefinicao = Array.isArray(body.steps) || Object.keys(dataBase).length > 0
    let versaoNova: number | null = null

    if (mudouDefinicao) {
      await prisma.$transaction(async (tx) => {
        const r = await publicarNovaVersao(id, tx, usuario?.userId ?? null)
        versaoNova = r.nova
        if (Object.keys(dataBase).length) {
          await tx.phaseInternalWorkflow.update({ where: { id }, data: dataBase })
        }
        if (Array.isArray(body.steps)) {
          const stepData = buildSteps(body.steps, id)
          await tx.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: id } })
          if (stepData.length) await tx.phaseInternalWorkflowStep.createMany({ data: stepData })
        }
        // A versão NOVA também nasce congelada: toda versão que uma instância possa
        // vir a registrar precisa ter conteúdo desde o primeiro instante.
        await congelarVersaoVigente(id, "PUBLICACAO", tx, usuario?.userId ?? null)
      })
      await prisma.logAuditoria.create({
        data: {
          acao: 'WORKFLOW_VERSION_PUBLISHED', entidade: 'PhaseInternalWorkflow', entidadeId: id,
          descricao: `Workflow interno "${atual.name}" publicado na versão ${versaoNova}. A versão ${(versaoNova ?? 1) - 1} foi congelada e continua valendo para os processos que já a registraram.`,
          detalhes: { versaoAnterior: (versaoNova ?? 1) - 1, versaoNova, alterouPassos: Array.isArray(body.steps) } as never,
          usuarioId: usuario?.userId ?? null,
        },
      }).catch(() => null)
    }

    const wf = await prisma.phaseInternalWorkflow.findUnique({
      where: { id }, include: { passos: { orderBy: { ordem: 'asc' } } },
    })
    return NextResponse.json({ workflow: wf })
  } catch (e) {
    console.error('PUT workflows-fase/[id]', e)
    return NextResponse.json({ error: 'Erro ao salvar o workflow.' }, { status: 500 })
  }
}

// DELETE — apaga o workflow (passos caem em cascade) e devolve usedByCount ao modelo
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { id: idStr } = await params
    const id = Number(idStr)

    const atual = await prisma.phaseInternalWorkflow.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Workflow não encontrado.' }, { status: 404 })

    await prisma.phaseInternalWorkflow.delete({ where: { id } })


    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE workflows-fase/[id]', e)
    return NextResponse.json({ error: 'Erro ao excluir o workflow.' }, { status: 500 })
  }
}