import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { publicarNovaVersao, congelarVersaoVigente } from '@/src/services/versao-publicada'
import { validarWorkflowParaPublicar } from '@/src/services/validacao-de-publicacao'

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
      // DEPENDÊNCIA DECLARADA. `undefined` (campo ausente no corpo) = não declarada, e
      // o modo de execução continua respondendo. Array vazio é uma DECLARAÇÃO: "este
      // passo não depende de nada". As duas coisas não são a mesma, e por isso não
      // colapsam num único valor.
      dependeDe: (Array.isArray(s?.dependeDe)
        ? s.dependeDe.filter((x: unknown) => typeof x === 'string')
        : undefined) as Prisma.InputJsonValue | undefined,
      executorKey: s?.executorKey ? String(s.executorKey) : null,
      // POLÍTICA DE REABERTURA — cadastrada, não presumida. Estratégia fora do
      // vocabulário fechado vira a mais conservadora: perguntar.
      reaberturaPermitida: s?.reaberturaPermitida !== false,
      reaberturaEstrategia: ['SOMENTE_ESTA', 'ESTA_E_DEPENDENTES', 'ESCOLHA_MANUAL'].includes(String(s?.reaberturaEstrategia))
        ? String(s.reaberturaEstrategia)
        : 'ESCOLHA_MANUAL',
      reaberturaExigeJustificativa: s?.reaberturaExigeJustificativa !== false,
      reaberturaPermissao: s?.reaberturaPermissao ? String(s.reaberturaPermissao) : null,
    }
  })
}

/** Filhos cadastrados de um passo: ações, campos e checklist. */
function buildFilhos(s: any, stepId: number) {
  const lista = (v: unknown) => (Array.isArray(v) ? v : [])
  return {
    acoes: lista(s?.acoes).map((a: any, i: number) => ({
      stepId, key: slug(String(a?.key || a?.label || `acao_${i + 1}`)),
      label: String(a?.label || 'Ação'), descricao: a?.descricao ? String(a.descricao) : null,
      ordem: Number(a?.ordem) || i + 1, effectKey: String(a?.effectKey || 'REGISTER_ONLY'),
      requerCampos: (Array.isArray(a?.requerCampos) ? a.requerCampos.filter((x: unknown) => typeof x === 'string') : undefined) as Prisma.InputJsonValue | undefined,
      permissao: a?.permissao ? String(a.permissao) : null,
      condicao: (a?.condicao ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: (a?.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      ativo: a?.ativo !== false,
    })),
    campos: lista(s?.campos).map((c: any, i: number) => ({
      stepId, key: slug(String(c?.key || c?.label || `campo_${i + 1}`)),
      label: String(c?.label || 'Campo'), tipo: String(c?.tipo || 'texto'),
      obrigatorio: !!c?.obrigatorio,
      opcoes: (c?.opcoes ?? undefined) as Prisma.InputJsonValue | undefined,
      condicao: (c?.condicao ?? undefined) as Prisma.InputJsonValue | undefined,
      ajuda: c?.ajuda ? String(c.ajuda) : null,
      ordem: Number(c?.ordem) || i + 1, ativo: c?.ativo !== false,
    })),
    checkItens: lista(s?.checkItens).map((k: any, i: number) => ({
      stepId, key: slug(String(k?.key || k?.label || `item_${i + 1}`)),
      label: String(k?.label || 'Item'), descricao: k?.descricao ? String(k.descricao) : null,
      obrigatorio: k?.obrigatorio !== false, ordem: Number(k?.ordem) || i + 1,
      ativo: k?.ativo !== false,
    })),
  }
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
          for (let i = 0; i < stepData.length; i++) {
            // UM A UM porque cada passo tem filhos que precisam do id dele. A versão
            // congelada é quem preserva a configuração antiga; recriar as linhas vivas
            // não apaga história nenhuma.
            const criado = await tx.phaseInternalWorkflowStep.create({ data: stepData[i], select: { id: true } })
            const filhos = buildFilhos(body.steps[i], criado.id)
            if (filhos.acoes.length) await tx.stepAction.createMany({ data: filhos.acoes })
            if (filhos.campos.length) await tx.stepField.createMany({ data: filhos.campos })
            if (filhos.checkItens.length) await tx.stepChecklistItem.createMany({ data: filhos.checkItens })
          }
        }

        // A PUBLICAÇÃO RECUSA CONFIGURAÇÃO IMPOSSÍVEL.
        //
        // Dependência inexistente, ciclo, efeito fora do catálogo, efeito fora da
        // competência da fase, campo que o executor não desenha. Recusar aqui é a
        // diferença entre uma mensagem clara para quem configurou e um passo que
        // trava um processo real semanas depois. `$transaction` desfaz tudo.
        const problemas = await validarWorkflowParaPublicar(id, tx)
        if (problemas.length) {
          throw Object.assign(new Error('PUBLICACAO_INVALIDA'), { problemas })
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
      where: { id },
      include: {
        passos: {
          orderBy: { ordem: 'asc' },
          include: {
            acoes: { orderBy: { ordem: 'asc' } },
            campos: { orderBy: { ordem: 'asc' } },
            checkItens: { orderBy: { ordem: 'asc' } },
          },
        },
      },
    })
    return NextResponse.json({ workflow: wf })
  } catch (e) {
    const problemas = (e as { problemas?: unknown })?.problemas
    if (Array.isArray(problemas)) {
      return NextResponse.json({
        error: 'A configuração não pode ser publicada.',
        problemas,
      }, { status: 422 })
    }
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