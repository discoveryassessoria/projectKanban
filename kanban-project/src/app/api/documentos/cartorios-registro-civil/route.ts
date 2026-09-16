// src/app/api/documentos/cartorios-registro-civil/route.ts
//
// PROXY server-side para a API oficial da ARPEN/Registro Civil
// (apicartorios.registrocivil.org.br) — busca cartórios reais por
// estado+cidade, com bairro/endereço, para preencher "Cartório" sem
// digitação livre. A apikey é secreta (nunca vai ao cliente); sem ela
// configurada, responde `configurado: false` em vez de erro — a tela cai
// no cadastro próprio de Órgãos (datalist) sem quebrar.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

interface CartorioRegistroCivil {
  cartorio_id: number
  nome: string
  cidade: string | null
  estado: string | null
  bairro: string | null
  endereco: string | null
  numero: string | null
  complemento: string | null
  cep: string | null
  telefone: string | null
  email: string | null
}

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "arvore.editar_documento")
  if (erro) return erro

  const apikey = process.env.REGISTRO_CIVIL_API_KEY
  if (!apikey) {
    return NextResponse.json({ configurado: false, cartorios: [] })
  }

  const estado = request.nextUrl.searchParams.get("estado")
  const cidade = request.nextUrl.searchParams.get("cidade")
  if (!estado || !cidade) {
    return NextResponse.json({ error: "Informe estado e cidade." }, { status: 400 })
  }

  try {
    const url = `https://apicartorios.registrocivil.org.br/api/cartorios/geolocalizacao?estado=${encodeURIComponent(estado)}&cidade=${encodeURIComponent(cidade)}&apikey=${apikey}`
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!resp.ok) {
      return NextResponse.json({ configurado: true, cartorios: [], erroExterno: `HTTP ${resp.status}` })
    }
    const lista = (await resp.json()) as CartorioRegistroCivil[]
    const cartorios = Array.isArray(lista)
      ? lista.map((c) => ({
          id: c.cartorio_id,
          nome: c.nome,
          bairro: c.bairro,
          endereco: c.endereco,
          numero: c.numero,
          cep: c.cep,
          telefone: c.telefone,
        }))
      : []
    return NextResponse.json({ configurado: true, cartorios })
  } catch (e) {
    console.error("[GET /api/documentos/cartorios-registro-civil]", e)
    return NextResponse.json({ configurado: true, cartorios: [], erroExterno: "Falha ao consultar a API externa." })
  }
}
