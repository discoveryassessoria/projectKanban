// GET  /api/arvore/:arvoreid/sincronizacao → SÓ LEITURA: as diferenças entre a árvore e os registros localizados na Genealogia (campo, valor da árvore, valor do registro).
// POST /api/arvore/:arvoreid/sincronizacao { confirmar: true, selecao?: ["PESSOA:12:PESSOA.data_nasc", …] } → aplica, DEPOIS de confirmação, com histórico antes → depois.
// Botão "Sincronizar com a Genealogia" da árvore de cada processo. Nunca cria, remove nem religa pessoa/união (só atualiza campos que já existem).
import { type NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { itensDeSincronizacao, sincronizarArvore } from "@/src/services/genealogia/sincronizar-com-registro"

const idDe = async (params: Promise<{ arvoreid: string }>) => { const n = Number.parseInt((await params).arvoreid); return Number.isInteger(n) && n > 0 ? n : null }

export async function GET(request: NextRequest, { params }: { params: Promise<{ arvoreid: string }> }) {
  const semPermissao = await verificarPermissao(request, "arvore.ver")
  if (semPermissao) return semPermissao
  const arvoreId = await idDe(params)
  if (arvoreId == null) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  const { itens, registrosLocalizados } = await itensDeSincronizacao(arvoreId)
  return NextResponse.json({ itens, registrosLocalizados, preencher: itens.filter((i) => i.tipo === "PREENCHER").length, conflitos: itens.filter((i) => i.tipo === "CONFLITO").length })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ arvoreid: string }> }) {
  const semPermissao = await verificarPermissao(request, "arvore.editar")
  if (semPermissao) return semPermissao
  const arvoreId = await idDe(params)
  if (arvoreId == null) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  const corpo = await request.json().catch(() => ({} as Record<string, unknown>))
  if (corpo.confirmar !== true) return NextResponse.json({ error: "Confirme a sincronização depois de ver a lista de diferenças." }, { status: 400 })
  const usuario = await extrairUsuarioComPermissoes(request)
  const selecao = Array.isArray(corpo.selecao) ? new Set((corpo.selecao as unknown[]).filter((x): x is string => typeof x === "string")) : null
  try {
    const r = await sincronizarArvore({ arvoreId, autorId: usuario?.userId ?? null, origem: "BOTAO_NA_ARVORE", selecao })
    return NextResponse.json({ ok: true, aplicados: r.aplicados, total: r.aplicados.length })
  } catch (e) {
    console.error("POST arvore/sincronizacao", e)
    return NextResponse.json({ error: "Não foi possível sincronizar. Nada foi alterado." }, { status: 500 })
  }
}
