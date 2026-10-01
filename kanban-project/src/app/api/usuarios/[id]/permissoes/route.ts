// src/app/api/usuarios/[id]/permissoes/route.ts
// Gerenciar permissões de um usuário específico

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { calcularPermissoes, PERMISSOES, type MapaPermissoes } from '@/src/lib/permissoes'
import { diffPermissoesCustom, exclusivasPerdidas, semMudanca } from '@/src/lib/usuarios-permissoes'

// GET - Buscar permissões efetivas do usuário
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const resolvedParams = await Promise.resolve(context.params)
    const id = parseInt(resolvedParams.id)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id },
      select: {
        id: true,
        nome: true,
        email: true,
        tipo: true,
        perfilId: true,
        permissoesCustom: true,
        perfil: {
          select: {
            id: true,
            nome: true,
            permissoes: true,
          },
        },
      },
    })

    if (!usuario) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
    }

    const perfilPermissoes = usuario.perfil?.permissoes as MapaPermissoes | null
    const permissoesCustom = usuario.permissoesCustom as MapaPermissoes | null

    // Permissões efetivas (perfil + overrides)
    const permissoesEfetivas = calcularPermissoes(
      usuario.tipo,
      perfilPermissoes,
      permissoesCustom
    )

    return NextResponse.json({
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        tipo: usuario.tipo,
        perfilId: usuario.perfilId,
        perfilNome: usuario.perfil?.nome || null,
      },
      // Permissões do perfil (base)
      perfilPermissoes: perfilPermissoes || {},
      // Overrides do usuário
      permissoesCustom: permissoesCustom || {},
      // Resultado final (o que vale de fato)
      permissoesEfetivas,
    })
  } catch (error) {
    console.error('Erro ao buscar permissões:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// PUT - Atualizar perfil e/ou permissões custom do usuário
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const resolvedParams = await Promise.resolve(context.params)
    const id = parseInt(resolvedParams.id)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const body = await request.json()
    const { perfilId, permissoesCustom } = body
    const confirmouRemocaoDeExclusivas = body.confirmarRemocaoExclusivas === true

    // Validar que o perfil existe (se informado)
    if (perfilId !== undefined && perfilId !== null) {
      const perfil = await prisma.perfil.findUnique({
        where: { id: perfilId },
      })
      if (!perfil) {
        return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 404 })
      }
    }

    // Limpar chaves de permissão inválidas/obsoletas
    if (permissoesCustom) {
      const chavesValidas = Object.keys(PERMISSOES)
      Object.keys(permissoesCustom).forEach(k => {
        if (!chavesValidas.includes(k)) {
          delete permissoesCustom[k]
        }
      })
    }

    // O estado ANTERIOR: serve à trava das exclusivas e ao diff da auditoria.
    const antes = await prisma.usuario.findUnique({ where: { id }, select: { perfilId: true, permissoesCustom: true } })
    if (!antes) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

    // TRAVA (01/10/2026): uma permissão EXCLUSIVA (`PERMISSOES_EXCLUSIVAS`) só existe por concessão nominal em
    // `permissoesCustom`. Gravar um conjunto que a omita (ou `null`/`{}`) a REVOGA — e foi assim que o botão de excluir
    // processo do Administrador sumiu, sem aviso. Revogar exige pedir isso de forma explícita.
    if (permissoesCustom !== undefined) {
      const perdidas = exclusivasPerdidas(antes.permissoesCustom, permissoesCustom)
      if (perdidas.length > 0 && !confirmouRemocaoDeExclusivas) {
        return NextResponse.json({
          error: `Esta gravação removeria permissão(ões) exclusiva(s) já concedida(s): ${perdidas.join(', ')}. Confirme a remoção de forma explícita.`,
          code: 'REMOVE_EXCLUSIVA_SEM_CONFIRMACAO',
          exclusivas: perdidas,
        }, { status: 409 })
      }
    }

    // Atualizar
    const updateData: any = {}

    if (perfilId !== undefined) {
      updateData.perfilId = perfilId // null = remover perfil
    }

    if (permissoesCustom !== undefined) {
      // Se enviar null ou {}, limpa as customizações
      const temCustom = permissoesCustom && Object.keys(permissoesCustom).length > 0
      updateData.permissoesCustom = temCustom ? permissoesCustom : null
    }

    // AUDITORIA na MESMA transação da alteração: quem, quando e o que entrou/saiu (nunca há registro de permissão sem fato).
    const requester = await extrairUsuarioComPermissoes(request)
    const depoisCustom = 'permissoesCustom' in updateData ? updateData.permissoesCustom : antes.permissoesCustom
    const diff = diffPermissoesCustom(antes.permissoesCustom, depoisCustom)
    const perfilMudou = 'perfilId' in updateData && updateData.perfilId !== antes.perfilId

    const atualizar = prisma.usuario.update({
      where: { id },
      data: updateData,
      // A resposta do PUT não devolve permissoesCustom nem perfil.permissoes (quem edita já as tem;
      // a tela ignora este corpo). Só o GET, do editor de permissões, as entrega.
      select: {
        id: true,
        nome: true,
        perfilId: true,
        perfil: { select: { nome: true } },
      },
    })
    const auditar = !semMudanca(diff) || perfilMudou
      ? [prisma.logAuditoria.create({
          data: {
            acao: 'USUARIO_PERMISSOES_ALTERADAS', entidade: 'Usuario', entidadeId: id, usuarioId: requester?.userId ?? null,
            descricao: `Permissões do usuário #${id} alteradas`
              + (diff.concedidas.length ? ` · concedidas: ${diff.concedidas.join(', ')}` : '')
              + (diff.revogadas.length ? ` · revogadas: ${diff.revogadas.join(', ')}` : '')
              + (perfilMudou ? ` · perfil ${antes.perfilId ?? 'nenhum'} → ${updateData.perfilId ?? 'nenhum'}` : ''),
            detalhes: JSON.parse(JSON.stringify({
              perfil: { de: antes.perfilId, para: 'perfilId' in updateData ? updateData.perfilId : antes.perfilId },
              concedidas: diff.concedidas, revogadas: diff.revogadas, mudancas: diff.mudancas,
              removeuExclusivasComConfirmacao: confirmouRemocaoDeExclusivas && exclusivasPerdidas(antes.permissoesCustom, depoisCustom).length > 0,
            })),
          },
        })]
      : []
    const [usuario] = await prisma.$transaction([atualizar, ...auditar])

    return NextResponse.json({ usuario, message: 'Permissões atualizadas' })
  } catch (error) {
    console.error('Erro ao atualizar permissões:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}