import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { avaliarAptidaoDaFase } from '@/src/lib/process-stage/escopo-operacional-da-fase'
import { enqueueReconciliacaoFaseMacro } from '@/src/lib/motor/reconciliar-fase-macro'
import { validarComposicaoMacro } from '@/src/lib/motor/validar-composicao-macro'

// [id] = MacroWorkflow.id (PK própria — desde a hierarquia País/Tipo/
// Modalidade/Workflow Macro, 22/09/2026, um Tipo pode ter até 2 Workflow
// Macro, um por modalidade habilitada, então `tipoProcessoId` sozinho deixou
// de identificar um único registro).

// GET - Workflow Macro (com fases) por id
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const { id } = await params
    const macroWorkflow = await prisma.macroWorkflow.findUnique({
      where: { id: Number(id) },
      include: { fases: { orderBy: { ordem: 'asc' } } },
    })
    return NextResponse.json({ macroWorkflow: macroWorkflow || null })
  } catch (error) {
    console.error('Erro ao buscar workflow macro:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// PUT - Sincroniza as fases do workflow (lista completa = verdade). Reordena, adiciona, remove.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const { id } = await params

    const mw = await prisma.macroWorkflow.findUnique({
      where: { id: Number(id) },
      include: { fases: true, tipoProcesso: { select: { id: true, ativo: true, arquivado: true } } },
    })
    if (!mw) return NextResponse.json({ error: 'Workflow não encontrado.' }, { status: 404 })
    const tipoProcessoId = mw.tipoProcessoId

    const b = await request.json()
    const incoming: any[] = Array.isArray(b.fases) ? b.fases : []
    const incomingKeys = incoming.map((f) => String(f.phaseKey))

    // BLOQUEIO DE PUBLICAÇÃO: código duplicado. Aceitar duplicata aqui faria o
    // upsert seguinte colapsar as duas linhas numa só sem avisar ninguém.
    const chavesDuplicadas = incomingKeys.filter((k, i) => incomingKeys.indexOf(k) !== i)
    if (chavesDuplicadas.length > 0) {
      return NextResponse.json(
        { error: `Chave de fase repetida na composição: ${[...new Set(chavesDuplicadas)].join(', ')}.`, code: 'FASE_CHAVE_DUPLICADA' },
        { status: 422 },
      )
    }

    // A MESMA PERGUNTA DA CRIAÇÃO, na composição: a fase é utilizável? Sem isto, o
    // seletor aceitaria uma fase sem escopo — e o processo travaria nela depois, longe
    // daqui, sem ninguém ligar uma coisa à outra.
    //
    // SÓ PRA CHAVE NOVA — nunca pra uma que JÁ compunha este macro. "Salvar" reenvia
    // a lista INTEIRA sempre (é a semântica "lista completa = verdade" desta rota), e
    // sem esta distinção qualquer edição — reordenar, adicionar outra fase, marcar
    // "no kanban" — ficava bloqueada assim que UMA fase já composta virasse INATIVA
    // depois de publicada, mesmo sem ninguém estar tentando reintroduzi-la (achado
    // real, mandato "Módulo de Fases", 21/09/2026: TESTEVIS_fase INATIVA em repouso
    // travava qualquer resync do macro que a já continha). Config ≠ fato histórico —
    // inativar não apaga retroativamente o que já estava composto.
    const chavesJaNaComposicao = new Set(mw.fases.map((f) => f.phaseKey))
    const chavesNovas = incomingKeys.filter((k) => !chavesJaNaComposicao.has(k))
    const aptidoes = await Promise.all(chavesNovas.map(async (k) => ({ k, a: await avaliarAptidaoDaFase(k) })))
    const inaptas = aptidoes.filter((x) => !x.a.apta)
    if (inaptas.length > 0) {
      return NextResponse.json(
        {
          error: inaptas.map((x) => x.a.motivo).join(' | '),
          code: 'FASE_NAO_UTILIZAVEL',
          fases: inaptas.map((x) => ({ phaseKey: x.k, motivo: x.a.motivo, code: x.a.code, canonica: x.a.canonica ?? null })),
        },
        { status: 422 },
      )
    }

    // BLOQUEIOS DE PUBLICAÇÃO — formato de código, contradição obrigatória×condicional,
    // tipo de processo ausente/incompatível, fim de fluxo sem desfecho garantido.
    // Chave já cadastrada (ex.: TESTEVIS_fase, o próprio exemplo histórico do
    // formato inconsistente) fica isenta da checagem de FORMATO — barrar
    // nascimento de chave nova ruim é o objetivo; apagar retroativamente o uso
    // de uma já existente, publicada e referenciada não é.
    const jaCadastradas = new Set(
      (await prisma.catalogoFase.findMany({ where: { phaseKey: { in: incomingKeys } }, select: { phaseKey: true } })).map((f) => f.phaseKey),
    )
    const problemas = validarComposicaoMacro(
      incoming.map((f) => ({ phaseKey: String(f.phaseKey), required: f.required !== false, conditional: !!f.conditional })),
      mw.tipoProcesso,
      jaCadastradas,
    )
    if (problemas.length > 0) {
      return NextResponse.json(
        { error: problemas.map((p) => p.mensagem).join(' | '), code: 'COMPOSICAO_INVALIDA', problemas },
        { status: 422 },
      )
    }

    // O ANTES, para a auditoria dizer o que mudou — e não só que algo mudou.
    const antes = mw.fases
      .map((f) => ({ phaseKey: f.phaseKey, ordem: f.ordem, required: f.required, conditional: f.conditional }))
      .sort((x, y) => x.ordem - y.ordem)
    const usuario = await extrairUsuarioComPermissoes(request)

    // Diferença estrutural calculada ANTES de escrever — decide se esta gravação é
    // uma PUBLICAÇÃO (precisa de revisão congelada + reconciliação) ou só metadado.
    const depoisPlanejado = incoming.map((f, i) => ({
      phaseKey: String(f.phaseKey), ordem: i + 1, required: f.required !== false, conditional: !!f.conditional,
    }))
    const chavesAntesSet = new Set(antes.map((f) => f.phaseKey))
    const chavesDepoisSet = new Set(depoisPlanejado.map((f) => f.phaseKey))
    const adicionadasPre = depoisPlanejado.filter((f) => !chavesAntesSet.has(f.phaseKey)).map((f) => f.phaseKey)
    const removidasPre = antes.filter((f) => !chavesDepoisSet.has(f.phaseKey)).map((f) => f.phaseKey)
    const reordenouPre =
      JSON.stringify(antes.filter((f) => chavesDepoisSet.has(f.phaseKey)).map((f) => f.phaseKey)) !==
      JSON.stringify(depoisPlanejado.filter((f) => chavesAntesSet.has(f.phaseKey)).map((f) => f.phaseKey))
    // TORNOU-SE OBRIGATÓRIA — reconciliação geral, não só fase nova. Uma fase que já
    // estava no fluxo, mas condicional/opcional, e passa a required+não-condicional,
    // impõe a MESMA obrigação retroativa que uma fase recém-criada impõe: quem já
    // passou daquela posição também precisa dela agora. Tratar só "chave nova" como
    // gatilho deixaria essa publicação silenciosamente sem efeito nos processos em
    // andamento — exatamente o "bloqueio só na entrada de Finalizado" que não basta.
    const tornaramSeObrigatoriasPre = depoisPlanejado
      .filter((d) => {
        const a = antes.find((x) => x.phaseKey === d.phaseKey)
        return a != null && d.required && !d.conditional && (!a.required || a.conditional)
      })
      .map((d) => d.phaseKey)
    const houveMudancaEstrutural =
      adicionadasPre.length > 0 || removidasPre.length > 0 || reordenouPre || tornaramSeObrigatoriasPre.length > 0

    let versaoNova = mw.versao

    await prisma.$transaction(async (tx) => {
      if (b.name !== undefined) {
        await tx.macroWorkflow.update({ where: { id: mw.id }, data: { name: String(b.name).trim() } })
      }
      // remove as que sumiram
      await tx.faseMacro.deleteMany({ where: { macroWorkflowId: mw.id, phaseKey: { notIn: incomingKeys.length ? incomingKeys : ['__none__'] } } })
      // upsert cada uma na ordem recebida (entryRule derivado da posição)
      for (let i = 0; i < incoming.length; i++) {
        const f = incoming[i]
        // CONSOLIDAÇÃO DO AVANÇO DE FASE — o Workflow Macro define APENAS a
        // sequência (ordem/entryRule estrutural). exitRule foi descontinuada como
        // condição de conclusão (isso é do Workflow Interno + BlockingEngine):
        // não gravamos novos valores. A coluna permanece só p/ leitura de legado
        // (o update não a toca; a criação nasce sem exitRule).
        const dados = {
          label: String(f.label || f.phaseKey),
          ordem: i + 1,
          required: f.required !== false,
          conditional: !!f.conditional,
          entryRule: i === 0 ? 'process_created' : 'previous_phase_completed',
          showInKanban: f.showInKanban !== false,
        }
        await tx.faseMacro.upsert({
          where: { macroWorkflowId_phaseKey: { macroWorkflowId: mw.id, phaseKey: String(f.phaseKey) } },
          update: dados,
          create: { macroWorkflowId: mw.id, phaseKey: String(f.phaseKey), exitRule: null, ...dados },
        })
      }

      // PUBLICAÇÃO (mandato "Catálogo de Fases", 20/09/2026) — só quando a
      // COMPOSIÇÃO muda de fato (fase adicionada/removida/reordenada). Renomear
      // rótulo ou ajustar showInKanban sem mexer em quais fases existem/ordem
      // não gera revisão nova: não é isso que a reconciliação precisa saber.
      if (houveMudancaEstrutural) {
        versaoNova = mw.versao + 1
        const fasesFinais = await tx.faseMacro.findMany({ where: { macroWorkflowId: mw.id }, orderBy: { ordem: 'asc' } })
        await tx.macroWorkflow.update({ where: { id: mw.id }, data: { versao: versaoNova } })
        await tx.macroWorkflowVersao.create({
          data: {
            macroWorkflowId: mw.id, versao: versaoNova, tipoProcessoId,
            modalidadeId: mw.modalidadeId, cardinalidadeRequerimento: mw.cardinalidadeRequerimento,
            name: b.name !== undefined ? String(b.name).trim() : mw.name,
            fases: fasesFinais.map((f) => ({
              phaseKey: f.phaseKey, label: f.label, ordem: f.ordem, required: f.required,
              conditional: f.conditional, showInKanban: f.showInKanban, entryRule: f.entryRule,
            })),
            congeladoPorId: usuario?.userId ?? null,
            origem: 'PUBLICACAO',
          },
        })
      }
    })

    const atualizado = await prisma.macroWorkflow.findUnique({ where: { id: mw.id }, include: { fases: { orderBy: { ordem: 'asc' } } } })

    // RECONCILIAÇÃO RETROATIVA — fora da transação de composição (publicar não
    // pode ficar refém de travar milhares de linhas de Processo/DomainOutbox na
    // mesma transação curta que só deveria gravar o cadastro). Registra o
    // trabalho; quem materializa é o outbox-dispatcher, um processo por vez.
    let reconciliacao: { processosAlcancados: number; outboxRegistrados: number; fasesConsideradas: string[] } | null = null
    const fasesQueGeramObrigacao = [...new Set([...adicionadasPre, ...tornaramSeObrigatoriasPre])]
    if (houveMudancaEstrutural && fasesQueGeramObrigacao.length > 0 && atualizado) {
      const fasesNovasInfo = atualizado.fases
        .filter((f) => fasesQueGeramObrigacao.includes(f.phaseKey))
        .map((f) => ({ phaseKey: f.phaseKey, required: f.required, conditional: f.conditional }))
      reconciliacao = await enqueueReconciliacaoFaseMacro({
        macroWorkflowId: mw.id, tipoProcessoId, versaoAnterior: mw.versao, versaoNova,
        fasesNovas: fasesNovasInfo, publicadoPorId: usuario?.userId ?? null,
      }).catch((e) => {
        console.error('[workflow-macro] enqueueReconciliacaoFaseMacro falhou:', e)
        return null
      })
    }

    // AUDITORIA DA COMPOSIÇÃO — três fatos distintos, com nomes distintos. "Workflow
    // salvo" não responde a pergunta que se faz meses depois: quem tirou a Retificação
    // deste fluxo, e quando.
    const depois = (atualizado?.fases ?? []).map((f) => ({ phaseKey: f.phaseKey, ordem: f.ordem }))
    const chavesAntes = new Set(antes.map((f) => f.phaseKey))
    const chavesDepois = new Set(depois.map((f) => f.phaseKey))
    const adicionadas = depois.filter((f) => !chavesAntes.has(f.phaseKey)).map((f) => f.phaseKey)
    const removidas = antes.filter((f) => !chavesDepois.has(f.phaseKey)).map((f) => f.phaseKey)
    const reordenou =
      JSON.stringify(antes.filter((f) => chavesDepois.has(f.phaseKey)).map((f) => f.phaseKey)) !==
      JSON.stringify(depois.filter((f) => chavesAntes.has(f.phaseKey)).map((f) => f.phaseKey))

    const auditar = (acao: string, descricao: string, detalhes: Record<string, unknown>) =>
      prisma.logAuditoria.create({
        data: { acao, entidade: 'MacroWorkflow', entidadeId: mw.id, descricao, detalhes: detalhes as never, usuarioId: usuario?.userId ?? null },
      }).catch(() => null)

    if (adicionadas.length) {
      await auditar('WORKFLOW_PHASE_ADDED', `${adicionadas.length} fase(s) adicionada(s) ao fluxo "${atualizado?.name}": ${adicionadas.join(', ')}.`, { adicionadas, antes, depois })
    }
    if (removidas.length) {
      // REMOVER DO FLUXO NÃO É EXCLUIR A FASE: o cadastro canônico continua intacto,
      // e a auditoria precisa dizer isso — senão a leitura futura confunde as duas.
      await auditar('WORKFLOW_PHASE_REMOVED', `${removidas.length} fase(s) removida(s) do fluxo "${atualizado?.name}": ${removidas.join(', ')}. O cadastro das fases não foi alterado.`, { removidas, antes, depois })
    }
    if (reordenou && !adicionadas.length && !removidas.length) {
      await auditar('WORKFLOW_PHASE_REORDERED', `Ordem das fases do fluxo "${atualizado?.name}" alterada.`, { antes, depois })
    }

    return NextResponse.json({
      macroWorkflow: atualizado,
      publicacao: houveMudancaEstrutural
        ? { versao: versaoNova, reconciliacao }
        : null,
    })
  } catch (error) {
    console.error('Erro ao salvar fases do workflow macro:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Apaga o workflow inteiro (cascade nas fases)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const { id } = await params
    await prisma.macroWorkflow.delete({ where: { id: Number(id) } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir workflow macro:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}