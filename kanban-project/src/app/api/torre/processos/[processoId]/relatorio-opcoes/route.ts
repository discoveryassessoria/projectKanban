// GET /api/torre/processos/{processoId}/relatorio-opcoes — as opções dos filtros do "Relatório de controle" (só leitura):
//   fases    = as que o processo JÁ CURSOU ou CURSA (caminho do Workflow Macro: concluída ou atual — futuras, condicionais não pedidas e puladas não entram)
//   pessoas  = os requerentes e ascendentes (linha reta) da árvore do processo, na ordem da linhagem — a mesma árvore da aba Documentos
// Régua: gestor da Torre + `relatorios.ver` (a do relatório).
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { lerCaminhoDoProcesso } from '@/lib/operacional/torre-caminho-leitura'
import { pessoasAtivasDaArvore } from '@/src/lib/genealogia/vinculo-ativo'
import type { OpcoesDoRelatorio } from '@/lib/operacional/torre-relatorio-filtros'

export async function GET(request: NextRequest, ctx: { params: Promise<{ processoId: string }> }) {
  const { erro } = await exigirTorre(request, 'relatorios.ver')
  if (erro) return erro
  const processoId = Number((await ctx.params).processoId)
  if (!Number.isInteger(processoId) || processoId <= 0) return NextResponse.json({ error: 'processo inválido' }, { status: 400 })

  const proc = await prisma.processo.findUnique({ where: { id: processoId }, select: { id: true, arvoreId: true, faseAtualKey: true } })
  if (!proc) return NextResponse.json({ error: 'processo não encontrado' }, { status: 404 })

  const [caminho, pessoas] = await Promise.all([
    lerCaminhoDoProcesso(processoId),
    proc.arvoreId
      ? prisma.pessoa.findMany({
          where: { AND: [pessoasAtivasDaArvore(proc.arvoreId), { OR: [{ requerente: { not: 'nao' } }, { linhaReta: true }] }] },
          select: { id: true, nome: true, sobrenome: true, numeroLinhagem: true },
          orderBy: [{ numeroLinhagem: 'asc' }, { nome: 'asc' }],
        })
      : Promise.resolve([]),
  ])

  const corpo: OpcoesDoRelatorio = {
    faseAtualKey: proc.faseAtualKey ?? null,
    fases: (caminho?.fases ?? [])
      .filter((f) => f.estado === 'concluida' || f.estado === 'atual')
      .map((f) => ({ key: f.phaseKey, label: f.label, estado: f.estado as 'concluida' | 'atual' })),
    pessoas: pessoas.map((p) => ({ id: p.id, nome: `${p.nome}${p.sobrenome ? ` ${p.sobrenome}` : ''}${p.numeroLinhagem != null ? ` · G${p.numeroLinhagem}` : ''}` })),
  }
  return NextResponse.json(corpo)
}
