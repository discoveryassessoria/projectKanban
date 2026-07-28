// GET /api/financeiro/v3/pagamentos — LISTA de pagamentos registrados (consulta).
// Somente leitura: read-model sobre OcorrenciaFinanceira (tipo PAGAMENTO*), com o
// valor estornado agregado por pagamento. NÃO escreve, NÃO aplica regra de negócio.
// Alimenta a página canônica de Pagamentos (consulta/investigação). Flag posicaoRead.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { flagAtiva } from '@/lib/financeiro/flags'
import { usuarioFlag } from '@/src/app/api/financeiro/v3/_flags'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  try {
    const take = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('take') ?? 200)))
    const pags = await prisma.ocorrenciaFinanceira.findMany({
      where: { tipo: { in: ['PAGAMENTO', 'PAGAMENTO_PARCIAL'] }, status: 'PROCESSADA' },
      orderBy: { data: 'desc' }, take,
      select: {
        id: true, valor: true, moeda: true, data: true, formaLabel: true, contaBanco: true,
        referencia: true, comprovanteUrl: true, status: true, obrigacaoId: true, criadoPorId: true,
        obrigacao: { select: { codigoOperacional: true, origemTipo: true, origemId: true, processoId: true, direcao: true } },
      },
    })
    const ids = pags.map((p) => p.id)
    // valor estornado por pagamento (ESTORNO PROCESSADA cujo estornaId aponta ao pagamento)
    const estornos = ids.length ? await prisma.ocorrenciaFinanceira.groupBy({
      by: ['estornaId'], where: { tipo: 'ESTORNO', status: 'PROCESSADA', estornaId: { in: ids } }, _sum: { valor: true },
    }).catch(() => []) : []
    const estMap = new Map<number, number>()
    for (const e of estornos as { estornaId: number | null; _sum: { valor: unknown } }[]) if (e.estornaId != null) estMap.set(e.estornaId, cent(Number(e._sum.valor ?? 0)))
    // responsável (nome) — batch
    const userIds = [...new Set(pags.map((p) => p.criadoPorId).filter((v): v is number => v != null))]
    const users = userIds.length ? await prisma.usuario.findMany({ where: { id: { in: userIds } }, select: { id: true, nome: true } }).catch(() => []) : []
    const userMap = new Map(users.map((u) => [u.id, u.nome]))

    const pagamentos = pags.map((p) => {
      const valor = cent(Number(p.valor))
      const estornado = estMap.get(p.id) ?? 0
      return {
        id: p.id, data: p.data.toISOString(), valor, moeda: String(p.moeda), forma: p.formaLabel ?? null,
        conta: p.contaBanco ?? null, referencia: p.referencia ?? null, temComprovante: !!p.comprovanteUrl,
        comprovanteUrl: p.comprovanteUrl ?? null, status: p.status, estornado, saldoEstornavel: cent(valor - estornado),
        codigo: p.obrigacao?.codigoOperacional ?? `OBR-${p.obrigacaoId}`, obrigacaoId: p.obrigacaoId,
        processoId: p.obrigacao?.processoId ?? null, direcao: p.obrigacao?.direcao ?? null,
        responsavel: p.criadoPorId != null ? (userMap.get(p.criadoPorId) ?? null) : null,
      }
    })
    return NextResponse.json({ disponivel: true, pagamentos })
  } catch (e) {
    return NextResponse.json({ disponivel: false, erro: e instanceof Error ? e.message : 'Falha ao listar pagamentos.' }, { status: 500 })
  }
}
