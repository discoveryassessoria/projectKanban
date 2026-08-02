// POST /api/gerenciamento/saude/corrigir
//
// Executa uma correção automática do catálogo de correções seguras. Toda
// execução é AUDITADA — inclusive quando falha. Correção fora do catálogo é
// recusada: não existe "executar qualquer coisa".

import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { correcaoPorId, correcoes } from '@/lib/saude/correcoes'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  return NextResponse.json({ correcoes: correcoes() })
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const usuario = await extrairUsuarioComPermissoes(request)
    const body = await request.json().catch(() => ({}))
    const id = String(body?.correcao ?? '')
    const correcao = correcaoPorId(id)
    if (!correcao) {
      return NextResponse.json({ error: `Correção "${id}" não existe no catálogo de correções seguras.` }, { status: 400 })
    }

    const t0 = Date.now()
    let resultado
    try {
      resultado = await correcao.executar()
    } catch (e) {
      const mensagem = String((e as Error)?.message ?? e).slice(0, 300)
      // Falha também é auditada: correção que quebrou precisa deixar rastro.
      await registrarAuditoria(request, {
        acao: 'CORRECAO_AUTOMATICA_FALHOU', entidade: 'SaudeAchado', entidadeId: null,
        descricao: `Correção "${correcao.nome}" falhou: ${mensagem}`,
        detalhes: { correcao: id, erro: mensagem },
      })
      return NextResponse.json({ error: `A correção falhou: ${mensagem}`, correcao: id }, { status: 500 })
    }

    await registrarAuditoria(request, {
      acao: 'CORRECAO_AUTOMATICA', entidade: 'SaudeAchado', entidadeId: null,
      descricao: `Correção "${correcao.nome}": ${resultado.mensagem}`,
      detalhes: { correcao: id, afetados: resultado.afetados, duracaoMs: Date.now() - t0, ...(resultado.detalhes ?? {}) },
    })

    // O achado que motivou a correção passa a EM_CORRECAO — a próxima execução do
    // diagnóstico é que decide se ele foi mesmo resolvido. Correção não se
    // autodeclara bem-sucedida.
    if (body?.chaveAchado) {
      await prisma.saudeAchado.updateMany({
        where: { chave: String(body.chaveAchado), status: { notIn: ['RESOLVIDO'] } },
        data: { status: 'EM_CORRECAO', responsavelId: usuario?.userId ?? null },
      })
    }

    return NextResponse.json({ resultado, correcao: { id: correcao.id, nome: correcao.nome } })
  } catch (e) {
    console.error('POST saude/corrigir', e)
    return NextResponse.json({ error: 'Erro ao executar a correção.' }, { status: 500 })
  }
}
