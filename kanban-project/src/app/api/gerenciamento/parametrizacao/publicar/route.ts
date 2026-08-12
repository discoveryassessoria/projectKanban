// POST /api/gerenciamento/parametrizacao/publicar { tipoProcessoId, phaseKey? }
// Publicação COORDENADA: valida tudo, publica tudo, ou não publica nada.
// Permissão RESTRITA — a mesma que publica regra documental.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { publicarParametrizacao } from "@/src/services/parametrizacao/publicacao-coordenada"
import { registrarAuditoria } from "@/lib/gerenciamento/auditoria"

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, "regras_documentais.publicar" as never); if (erro) return erro
  const b = await req.json().catch(() => ({}))
  const tipoProcessoId = Number(b?.tipoProcessoId)
  if (!tipoProcessoId) return NextResponse.json({ error: "tipoProcessoId é obrigatório." }, { status: 400 })
  const phaseKey: string | null = b?.phaseKey ?? null
  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await publicarParametrizacao({ tipoProcessoId, phaseKey, usuarioId: actor?.userId ?? null })
    if (!r.publicou) {
      return NextResponse.json({
        ok: false, error: "Publicação bloqueada: a parametrização está incompleta.",
        impedimentos: r.impedimentos.map((i) => ({ mensagem: i.mensagem, onde: i.onde })),
      }, { status: 422 })
    }
    await registrarAuditoria(req, {
      acao: "PUBLICAR", entidade: "ParametrizacaoInicial", entidadeId: tipoProcessoId,
      descricao: `Parametrização publicada (${r.regrasPublicadas.length} regra(s), ${r.componentesAtivados.length} componente(s))`,
      detalhes: { tipoProcessoId, phaseKey, ...r },
    })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao publicar." }, { status: 500 })
  }
}
