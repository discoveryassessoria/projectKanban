import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { validarWorkflowParaPublicar } from '@/src/services/validacao-de-publicacao'
import { marcarRascunho, publicarWorkflow, preverPublicacao } from '@/src/services/publicacao-de-workflow'

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
    opcoesPorCampo: lista(s?.campos).map((c: any, i: number) => ({
      campoKey: slug(String(c?.key || c?.label || `campo_${i + 1}`)),
      opcoes: (Array.isArray(c?.opcoesCadastradas) ? c.opcoesCadastradas : []).map((o: any, j: number) => ({
        key: slug(String(o?.key || o?.label || `opcao_${j + 1}`)),
        label: String(o?.label || 'Opção'),
        descricao: o?.descricao ? String(o.descricao) : null,
        ordem: Number(o?.ordem) || j + 1,
        ativo: o?.ativo !== false,
        condicao: (o?.condicao ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    })),
    canais: lista(s?.canais).map((c: any, i: number) => ({
      // Aceita as duas formas que a tela pode mandar: a chave direta ou o canal
      // aninhado, que é como a leitura devolve.
      canalKey: String(c?.canalKey ?? c?.canal?.key ?? c?.key ?? ''),
      ordem: Number(c?.ordem) || i + 1,
      ativo: c?.ativo !== false,
      // `null` = herda o requisito do catálogo; `true`/`false` = o passo decide.
      exigeProtocolo: typeof c?.exigeProtocolo === 'boolean' ? c.exigeProtocolo : null,
      exigeAnexo: typeof c?.exigeAnexo === 'boolean' ? c.exigeAnexo : null,
      exigeRastreio: typeof c?.exigeRastreio === 'boolean' ? c.exigeRastreio : null,
      exigeObservacao: typeof c?.exigeObservacao === 'boolean' ? c.exigeObservacao : null,
      camposObrigatorios: (Array.isArray(c?.camposObrigatorios)
        ? c.camposObrigatorios.filter((x: unknown) => typeof x === 'string') : undefined) as Prisma.InputJsonValue | undefined,
      condicao: (c?.condicao ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
    requisitos: lista(s?.requisitos).map((r: any, i: number) => ({
      key: slug(String(r?.key || r?.label || `requisito_${i + 1}`)),
      label: String(r?.label || 'Requisito'),
      descricao: r?.descricao ? String(r.descricao) : null,
      tipo: ['CAMPO_PREENCHIDO', 'CHECKLIST_COMPLETO', 'EVIDENCIA_ANEXADA', 'ACAO_EXECUTADA'].includes(String(r?.tipo))
        ? String(r.tipo) : 'CAMPO_PREENCHIDO',
      alvoKey: r?.alvoKey ? String(r.alvoKey) : null,
      minimo: Math.max(1, Number(r?.minimo) || 1),
      obrigatorio: r?.obrigatorio !== false,
      condicao: (r?.condicao ?? undefined) as Prisma.InputJsonValue | undefined,
      acaoKey: r?.acaoKey ? String(r.acaoKey) : null,
      ordem: Number(r?.ordem) || i + 1,
      ativo: r?.ativo !== false,
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
        // SALVAR NÃO PUBLICA. A definição viva É o rascunho; a versão congelada é o
        // publicado. Antes, cada save incrementava a versão — três ajustes viravam
        // três versões, e o diff nunca podia ser olhado antes de decidir.
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
            if (filhos.requisitos.length) {
              await tx.stepRequirement.createMany({
                data: filhos.requisitos.map((r) => ({ ...r, stepId: criado.id })) as Prisma.StepRequirementCreateManyInput[],
              })
            }

            // OPÇÕES — filhas do campo, então só depois de os campos existirem.
            for (const grupo of filhos.opcoesPorCampo) {
              if (grupo.opcoes.length === 0) continue
              const campo = await tx.stepField.findFirst({
                where: { stepId: criado.id, key: grupo.campoKey }, select: { id: true },
              })
              if (!campo) continue
              await tx.stepFieldOption.createMany({
                data: grupo.opcoes.map((o: (typeof grupo.opcoes)[number]) => ({ ...o, fieldId: campo.id })) as Prisma.StepFieldOptionCreateManyInput[],
              })
            }

            // CANAIS — a associação é com o catálogo; canal inexistente é ignorado
            // aqui e recusado na publicação, com o nome dele na mensagem.
            for (const c of filhos.canais) {
              if (!c.canalKey) continue
              const canal = await tx.canalOperacional.findUnique({ where: { key: c.canalKey }, select: { id: true } })
              if (!canal) continue
              const { canalKey: _k, ...resto } = c
              await tx.stepChannel.create({ data: { ...resto, stepId: criado.id, canalId: canal.id } })
            }
          }
        }

        // A CONFIGURAÇÃO É CONFERIDA AO SALVAR, mesmo sem publicar.
        //
        // Deixar para a publicação faria o administrador descobrir três ajustes depois
        // que o primeiro estava errado. `$transaction` desfaz tudo — um rascunho
        // inválido não fica guardado parecendo bom.
        const problemas = await validarWorkflowParaPublicar(id, tx)
        if (problemas.length) {
          throw Object.assign(new Error('PUBLICACAO_INVALIDA'), { problemas })
        }
        // TEMPO SUFICIENTE PARA GRAVAR O WORKFLOW INTEIRO. Um passo com ações,
        // campos, opções, canais, checklist e requisitos são várias escritas; com o
        // banco de produção do outro lado da rede, os 5 s do padrão estouram no meio e
        // a transação morre com metade dos passos gravados. Ela desfaz tudo — mas o
        // administrador perde a edição sem saber por quê.
      }, { maxWait: 20_000, timeout: 120_000 })

      // SALVAR NÃO É PUBLICAR.
      //
      // Antes, cada save publicava uma versão: ajustar três coisas gerava três
      // versões, e não havia como olhar o diff antes de decidir. O rascunho é a mesma
      // definição viva de sempre — o que passou a existir é a marca de que ela difere
      // da última publicação. Publicar é `POST ?acao=publicar`.
      await marcarRascunho(id, usuario?.userId ?? null)
      versaoNova = null
      await prisma.logAuditoria.create({
        data: {
          acao: 'WORKFLOW_DRAFT_SAVED', entidade: 'PhaseInternalWorkflow', entidadeId: id,
          descricao: `Rascunho do workflow interno "${atual.name}" salvo. Os processos em andamento continuam na versão ${atual.versao}; nada muda para eles até a publicação.`,
          detalhes: { versaoPublicada: atual.versao, alterouPassos: Array.isArray(body.steps) } as never,
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
            campos: { orderBy: { ordem: 'asc' }, include: { opcoesCadastradas: { orderBy: { ordem: 'asc' } } } },
            checkItens: { orderBy: { ordem: 'asc' } },
            canais: { orderBy: { ordem: 'asc' }, include: { canal: true } },
            requisitos: { orderBy: { ordem: 'asc' } },
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


// ============================================================================
// GET — a configuração VIVA (o rascunho) e, com ?preview=1, o que a publicação faria.
//
// O editor precisa das duas coisas separadas: o que está gravado agora e o que os
// processos passariam a ver se isso fosse publicado. Misturar as duas numa resposta
// só foi o que fez o administrador publicar sem saber o que estava publicando.
// ============================================================================
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  const { id: idStr } = await params
  const id = Number(idStr)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Workflow inválido.' }, { status: 400 })

  if (request.nextUrl.searchParams.get('preview') === '1') {
    const preview = await preverPublicacao(id)
    if (!preview) return NextResponse.json({ error: 'Workflow não encontrado.' }, { status: 404 })
    return NextResponse.json({ preview })
  }

  const wf = await prisma.phaseInternalWorkflow.findUnique({
    where: { id },
    include: {
      passos: {
        orderBy: { ordem: 'asc' },
        include: {
          acoes: { orderBy: { ordem: 'asc' } },
          campos: { orderBy: { ordem: 'asc' }, include: { opcoesCadastradas: { orderBy: { ordem: 'asc' } } } },
          checkItens: { orderBy: { ordem: 'asc' } },
          canais: { orderBy: { ordem: 'asc' }, include: { canal: true } },
          requisitos: { orderBy: { ordem: 'asc' } },
        },
      },
    },
  })
  if (!wf) return NextResponse.json({ error: 'Workflow não encontrado.' }, { status: 404 })
  return NextResponse.json({ workflow: wf, temRascunho: wf.rascunhoAlteradoEm != null })
}

// ============================================================================
// POST ?acao=publicar — congela a versão vigente e passa a valer a nova.
//
// `versaoEsperada` é o número que a tela tinha em mãos. Sem ele, dois administradores
// publicando ao mesmo tempo criariam duas versões, a segunda idêntica à primeira.
// ============================================================================
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  const { id: idStr } = await params
  const id = Number(idStr)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Workflow inválido.' }, { status: 400 })

  const acao = request.nextUrl.searchParams.get('acao')
  if (acao !== 'publicar') {
    return NextResponse.json({ error: 'Ação desconhecida. Use ?acao=publicar.' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const usuario = await extrairUsuarioComPermissoes(request)
  const versaoEsperada = Number((body as { versaoEsperada?: unknown }).versaoEsperada)

  const r = await publicarWorkflow({
    workflowId: id,
    actorId: usuario?.userId ?? null,
    versaoEsperada: Number.isFinite(versaoEsperada) ? versaoEsperada : undefined,
  })

  if (!r.ok) {
    const status = r.code === 'CONFLITO_DE_VERSAO' ? 409 : r.code === 'WORKFLOW_INEXISTENTE' ? 404 : 422
    return NextResponse.json({ error: r.mensagem ?? 'A configuração não pode ser publicada.', code: r.code, problemas: r.problemas }, { status })
  }
  return NextResponse.json(r)
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