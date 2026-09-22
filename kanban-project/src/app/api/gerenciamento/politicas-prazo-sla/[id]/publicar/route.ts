// ESTE ARQUIVO VAI EM: src/app/api/gerenciamento/politicas-prazo-sla/[id]/publicar/route.ts
//
// POST - valida os parâmetros, congela nova PoliticaPrazoSlaVersao, e
//        ENFILEIRA a reconciliação das tarefas em andamento vinculadas pela
//        estratégia escolhida EXPLICITAMENTE no corpo (REGRA MASTER: nunca
//        escolhida em silêncio). A UI deve ter mostrado a prévia de impacto
//        (GET .../previa-impacto) ANTES de chamar esta rota.

import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { publicarPoliticaPrazoSla, type ParametrosVersaoInput } from "@/src/services/prazo-sla/politica-prazo-sla"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { id } = await params
    const b = await request.json().catch(() => ({}))
    if (!b.estrategiaRetroacao) {
      return NextResponse.json({ error: "Escolha explicitamente a estratégia de retroação.", code: "ESTRATEGIA_OBRIGATORIA" }, { status: 400 })
    }
    const usuario = await extrairUsuarioComPermissoes(request)
    const resultado = await publicarPoliticaPrazoSla({
      politicaId: Number(id),
      parametros: b.parametros as ParametrosVersaoInput,
      estrategiaRetroacao: b.estrategiaRetroacao,
      motivoAlteracao: b.motivoAlteracao ?? null,
      publicadoPorId: usuario?.userId ?? null,
    })
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.erros.map((e) => e.mensagem).join(" | "), code: "CONFIGURACAO_INVALIDA", erros: resultado.erros }, { status: 422 })
    }
    return NextResponse.json({ versao: resultado.versao, reconciliacao: resultado.reconciliacao })
  } catch (error) {
    console.error("Erro ao publicar política de prazo/SLA:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
