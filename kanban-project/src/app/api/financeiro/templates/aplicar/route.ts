// src/app/api/financeiro/templates/aplicar/route.ts
//
// ⚠️ DESATIVADO — a aplicação MANUAL de template financeiro foi removida.
// ARQUITETURA NOVA: lançamentos financeiros (receitas/custos) nascem apenas
// quando uma Automação por Fase (kind=financial) é executada em resposta a um
// evento do Workflow Interno. Nenhum usuário aplica templates manualmente.
//
// Os templates permanecem como BIBLIOTECA TÉCNICA (lib/financeiro/templates.ts +
// templateEngine.ts), consumida pelas automações — NÃO são alterados aqui.
// Este endpoint responde 410 Gone e NÃO cria nenhum lançamento (receita/custo/
// parcela/histórico permanecem intocados).

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "A aplicação manual de templates financeiros foi descontinuada. Lançamentos financeiros são gerados exclusivamente pelas Automações por Fase (evento do Workflow Interno).",
      code: "TEMPLATE_MANUAL_DESATIVADO",
    },
    { status: 410 },
  );
}
