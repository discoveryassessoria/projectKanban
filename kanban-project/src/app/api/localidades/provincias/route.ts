// GET /api/localidades/provincias?pais=ES — as províncias do país (fora do Brasil). Lista vazia (nunca erro) se a base não conhecer o país.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { provinciasDoPais } from '@/src/services/localidade/geografia-mundial'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'arvore.ver')
  if (erro) return erro
  const pais = request.nextUrl.searchParams.get('pais') ?? ''
  if (!/^[A-Za-z]{2}$/.test(pais) || pais.toUpperCase() === 'BR') return NextResponse.json({ provincias: [] })
  return NextResponse.json({ provincias: await provinciasDoPais(pais) })
}
