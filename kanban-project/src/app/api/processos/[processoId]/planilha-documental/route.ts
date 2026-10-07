// src/app/api/processos/[processoId]/planilha-documental/route.ts
// ============================================================================
// PLANILHA DOCUMENTAL SEM VALORES — a visão da aba Documentos do processo (07/10/2026).
//
//   GET /api/processos/{id}/planilha-documental
//
// É a MESMA planilha de Financeiro → Custos (mesmas pessoas, mesma ordem por geração, mesmos registros), sem NENHUM dado financeiro: a
// resposta sai de `montarEstruturaDocumental`, que nem consulta preço, lançamento, regra econômica ou combinado. Não há valor escondido por
// CSS: ele simplesmente não existe nesta resposta.
//
// PERMISSÃO: `processos.ver` — a MESMA que `/api/processos/{id}/documentos` (a aba Documentos) já exige. NÃO exige `financeiro.ver`:
// quem opera (a Daniela e os demais) abre a planilha sem ter acesso ao financeiro.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { montarEstruturaDocumental } from '@/lib/financeiro/leitura/planilha-documental'

export async function GET(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'processos.ver')
    if (erro) return erro

    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const processo = await prisma.processo.findUnique({ where: { id }, select: { id: true, nome: true } })
    if (!processo) return NextResponse.json({ error: 'Processo não encontrado' }, { status: 404 })

    const pessoas = await montarEstruturaDocumental(id)
    return NextResponse.json({ planilha: { processoId: id, nomeProcesso: processo.nome, pessoas } })
  } catch (error) {
    console.error('Erro ao montar a planilha documental (sem valores):', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
