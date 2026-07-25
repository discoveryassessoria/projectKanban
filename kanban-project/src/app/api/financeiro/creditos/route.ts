// /api/financeiro/creditos — LISTA créditos financeiros DISPONÍVEIS (ABERTOS).
//   GET ?processoId=&pessoaId=&obrigacaoId= → { creditos, saldoDisponivel }
// Leitura pura (permissão financeiro.ver). Não muda estado.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { listarCreditosDisponiveis, saldoDisponivelCredito } from '@/lib/financeiro/creditos/credito-service'

const num = (v: string | null): number | undefined => (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined)

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro

  const sp = req.nextUrl.searchParams
  const processoId = num(sp.get('processoId'))
  const pessoaId = num(sp.get('pessoaId'))
  const obrigacaoId = num(sp.get('obrigacaoId'))

  const [creditos, saldoDisponivel] = await Promise.all([
    listarCreditosDisponiveis({ processoId, pessoaId, obrigacaoId }),
    saldoDisponivelCredito(pessoaId, obrigacaoId, processoId),
  ])
  return NextResponse.json({ creditos, saldoDisponivel })
}
