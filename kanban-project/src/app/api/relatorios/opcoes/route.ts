// GET /api/relatorios/opcoes?fonte=<chave>&q=<busca>
//
// Os valores de um filtro, sempre da FONTE CANÔNICA do conceito. `fonte` é uma
// chave whitelisted pelo domínio — nunca um nome de tabela vindo do cliente.
//
// SOMENTE LEITURA.

import { NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { opcoesDoCadastro } from "@/src/lib/relatorios/motor/opcoes"
import { DOMINIOS } from "@/src/lib/relatorios/motor/registro"

/** Só fontes que algum domínio declarou. Fora disso, não existe. */
const FONTES_PERMITIDAS = new Set(
  DOMINIOS.flatMap((d) => d.filtros.map((f) => (f.opcoes?.tipo === "cadastro" ? f.opcoes.chave : null)))
    .filter((x): x is string => !!x),
)

export async function GET(request: Request) {
  const erro = await verificarPermissao(request, "processos.ver_paginas")
  if (erro) return erro
  try {
    const q = new URL(request.url).searchParams
    const fonte = q.get("fonte") ?? ""
    if (!FONTES_PERMITIDAS.has(fonte)) {
      return NextResponse.json({ error: "Fonte de opções não declarada por nenhum domínio." }, { status: 400 })
    }
    return NextResponse.json({ opcoes: await opcoesDoCadastro(fonte, q.get("q")) })
  } catch (e) {
    console.error("GET relatorios/opcoes", e)
    return NextResponse.json({ error: "Erro ao carregar opções." }, { status: 500 })
  }
}
