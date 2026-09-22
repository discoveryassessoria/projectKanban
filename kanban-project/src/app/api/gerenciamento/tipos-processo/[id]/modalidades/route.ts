// src/app/api/gerenciamento/tipos-processo/[id]/modalidades/route.ts
//
// HABILITAÇÃO de modalidades num Tipo de Processo (mandato "Reconstrução da
// hierarquia País/Tipo/Modalidade/Workflow Macro", 22/09/2026).
//
// "Cada Tipo de Processo pode habilitar: somente Administrativa; somente
// Judicial; ambas." — a fonte única dessa habilitação é
// `TipoProcessoModalidadeHabilitada` (N:N real). GET lista o estado atual;
// PUT recebe a lista COMPLETA de modalidadeIds habilitados (mesmo padrão
// "lista completa = verdade" já usado pelo Workflow Macro/composição de
// Fases) — nunca um PATCH incremental que possa divergir do que a tela vê.
//
// DESABILITAR uma modalidade NUNCA apaga o Workflow Macro publicado sob ela
// nem qualquer processo — apenas impede publicar/criar processo NOVO
// naquela combinação. Reabilitar depois volta a oferecer o que já existia,
// intacto (mesma filosofia de INATIVA do Catálogo de Fases).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const tipoProcessoId = Number(idStr)
    const tipo = await prisma.tipoProcessoNacionalidade.findUnique({ where: { id: tipoProcessoId }, select: { id: true, paisId: true } })
    if (!tipo) return NextResponse.json({ error: 'Tipo de processo não encontrado' }, { status: 404 })

    const [modalidadesDoPais, habilitadas] = await Promise.all([
      prisma.modalidadePais.findMany({ where: { paisId: tipo.paisId, ativo: true }, orderBy: { ordem: 'asc' } }),
      prisma.tipoProcessoModalidadeHabilitada.findMany({ where: { tipoProcessoId }, include: { modalidade: true } }),
    ])
    const habilitadasIds = new Set(habilitadas.filter((h) => h.ativo).map((h) => h.modalidadeId))

    return NextResponse.json({
      modalidades: modalidadesDoPais.map((m) => ({
        id: m.id, modalityKey: m.modalityKey, modalityLabel: m.modalityLabel,
        habilitada: habilitadasIds.has(m.id),
      })),
    })
  } catch (error) {
    console.error('GET tipos-processo/[id]/modalidades', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// PUT — lista COMPLETA de modalidadeIds habilitados (substitui, não soma).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const tipoProcessoId = Number(idStr)
    const tipo = await prisma.tipoProcessoNacionalidade.findUnique({ where: { id: tipoProcessoId }, select: { id: true, paisId: true, name: true } })
    if (!tipo) return NextResponse.json({ error: 'Tipo de processo não encontrado' }, { status: 404 })

    const b = await request.json().catch(() => ({}))
    const modalidadeIdsPedidos: number[] = Array.isArray(b?.modalidadeIds) ? b.modalidadeIds.map(Number).filter(Number.isFinite) : null
    if (!modalidadeIdsPedidos) return NextResponse.json({ error: 'Informe modalidadeIds (lista completa).' }, { status: 400 })
    if (modalidadeIdsPedidos.length === 0) {
      return NextResponse.json({ error: 'Um Tipo de Processo precisa de pelo menos uma modalidade habilitada.' }, { status: 400 })
    }

    // AS MODALIDADES PEDIDAS TÊM QUE SER DO MESMO PAÍS DO TIPO — nunca
    // habilitar "Judicial da Espanha" pra um Tipo da Itália por engano de id.
    const modalidadesValidas = await prisma.modalidadePais.findMany({ where: { id: { in: modalidadeIdsPedidos }, paisId: tipo.paisId } })
    if (modalidadesValidas.length !== modalidadeIdsPedidos.length) {
      return NextResponse.json({ error: 'Uma ou mais modalidades não pertencem ao país deste tipo de processo.', code: 'MODALIDADE_PAIS_DIVERGENTE' }, { status: 400 })
    }

    const atuais = await prisma.tipoProcessoModalidadeHabilitada.findMany({ where: { tipoProcessoId } })
    const atuaisIds = new Set(atuais.map((h) => h.modalidadeId))
    const pedidosIds = new Set(modalidadeIdsPedidos)

    const paraDesabilitar = atuais.filter((h) => h.ativo && !pedidosIds.has(h.modalidadeId))
    // DESABILITAR uma modalidade com Workflow Macro PUBLICADO e ATIVO é
    // decisão estrutural — bloqueada aqui (nunca some silenciosamente o que
    // já é oferecido). O admin inativa o Workflow Macro primeiro, se for essa
    // a intenção real.
    if (paraDesabilitar.length > 0) {
      const macrosAtivos = await prisma.macroWorkflow.findMany({
        where: { tipoProcessoId, modalidadeId: { in: paraDesabilitar.map((h) => h.modalidadeId) }, ativo: true },
        include: { modalidade: { select: { modalityLabel: true } } },
      })
      if (macrosAtivos.length > 0) {
        return NextResponse.json(
          {
            error: `Não é possível desabilitar ${macrosAtivos.map((m) => m.modalidade.modalityLabel).join(', ')}: existe Workflow Macro publicado e ativo. Inative o Workflow Macro primeiro.`,
            code: 'MODALIDADE_COM_MACRO_ATIVO',
          },
          { status: 409 },
        )
      }
    }

    const usuario = await extrairUsuarioComPermissoes(request)
    await prisma.$transaction(async (tx) => {
      for (const modalidadeId of modalidadeIdsPedidos) {
        if (atuaisIds.has(modalidadeId)) {
          await tx.tipoProcessoModalidadeHabilitada.update({ where: { tipoProcessoId_modalidadeId: { tipoProcessoId, modalidadeId } }, data: { ativo: true } })
        } else {
          await tx.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId, modalidadeId, ativo: true } })
        }
      }
      for (const h of paraDesabilitar) {
        await tx.tipoProcessoModalidadeHabilitada.update({ where: { tipoProcessoId_modalidadeId: { tipoProcessoId, modalidadeId: h.modalidadeId } }, data: { ativo: false } })
      }
    })

    await prisma.logAuditoria.create({
      data: {
        acao: 'TIPO_PROCESSO_MODALIDADES_ATUALIZADAS',
        entidade: 'TipoProcessoNacionalidade',
        entidadeId: tipoProcessoId,
        descricao: `Modalidades habilitadas de "${tipo.name}" atualizadas: ${modalidadesValidas.map((m) => m.modalityLabel).join(', ')}.`,
        detalhes: { modalidadeIdsHabilitados: modalidadeIdsPedidos, desabilitados: paraDesabilitar.map((h) => h.modalidadeId) } as never,
        usuarioId: usuario?.userId ?? null,
      },
    }).catch(() => null)

    const habilitacoesFinal = await prisma.tipoProcessoModalidadeHabilitada.findMany({ where: { tipoProcessoId, ativo: true }, include: { modalidade: true } })
    return NextResponse.json({
      ok: true,
      habilitadas: habilitacoesFinal.map((h) => ({ id: h.modalidade.id, modalityKey: h.modalidade.modalityKey, modalityLabel: h.modalidade.modalityLabel })),
    })
  } catch (error) {
    console.error('PUT tipos-processo/[id]/modalidades', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
