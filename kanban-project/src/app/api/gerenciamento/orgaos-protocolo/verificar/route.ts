// GET /api/gerenciamento/orgaos-protocolo/verificar?name=&nomeFantasia=&country=&identificacaoFiscal=&ignorarId=
//
// DETECÇÃO DE DUPLICIDADE em tempo de digitação. A tela chama enquanto o
// operador preenche o nome: se a organização já existe, ele acrescenta função
// ao cadastro que existe em vez de criar outro. Somente leitura.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { detectarDuplicidade, resolverOrganizacao } from '@/src/services/organizacao-identidade'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const p = new URL(request.url).searchParams
    const entrada = {
      name: p.get('name'),
      nomeFantasia: p.get('nomeFantasia'),
      country: p.get('country'),
      identificacaoFiscal: p.get('identificacaoFiscal'),
    }
    const ignorarId = Number(p.get('ignorarId')) || null
    if (!entrada.name && !entrada.nomeFantasia && !entrada.identificacaoFiscal) {
      return NextResponse.json({ existente: null, suspeitas: [] })
    }

    const resolucao = ignorarId ? { id: null, como: 'nova' as const, registro: null } : await resolverOrganizacao(prisma, entrada)
    const suspeitas = await detectarDuplicidade(prisma, entrada, { ignorarId })

    return NextResponse.json({
      existente: resolucao.registro,
      resolvidoPor: resolucao.registro ? resolucao.como : null,
      suspeitas: resolucao.registro ? suspeitas.filter((s) => s.id !== resolucao.id) : suspeitas,
    })
  } catch (e) {
    console.error('GET orgaos-protocolo/verificar', e)
    return NextResponse.json({ error: 'Erro ao verificar duplicidade.' }, { status: 500 })
  }
}
