// GET /api/localidades/cidades?pais=ES&provincia=Galicia&q=lug — as cidades da província (fora do Brasil). Cidade ausente da base = lista vazia: a tela aceita texto livre.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { cidadesDaProvincia } from '@/src/services/localidade/geografia-mundial'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'arvore.ver')
  if (erro) return erro
  const sp = request.nextUrl.searchParams
  const pais = sp.get('pais') ?? ''
  if (!/^[A-Za-z]{2}$/.test(pais) || pais.toUpperCase() === 'BR') return NextResponse.json({ cidades: [] })
  return NextResponse.json({ cidades: await cidadesDaProvincia(pais, sp.get('provincia'), sp.get('q')) })
}
