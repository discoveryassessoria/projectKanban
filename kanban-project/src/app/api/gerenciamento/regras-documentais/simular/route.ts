// src/app/api/gerenciamento/regras-documentais/simular/route.ts
//
// SIMULAÇÃO — roda o avaliador canônico e explica o resultado. SÓ LEITURA:
// nunca cria Documento/Necessidade/Tarefa nem altera processo. Pode incluir
// rascunhos (para testar antes de publicar) via `incluirRascunhos`.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { carregarRegras, auditar, usuarioIdDe } from "@/src/lib/documentos/regras-documentais/persistencia"
import { avaliarRegrasDocumentais } from "@/src/lib/documentos/regras-documentais/avaliador"
import type { ContextoAvaliacao, SujeitoContexto, RegraDocumental } from "@/src/lib/documentos/regras-documentais/tipos"

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const b = await request.json()
    const tipoProcessoId = Number(b?.tipoProcessoId)
    if (!tipoProcessoId) return NextResponse.json({ error: "Selecione o tipo de processo." }, { status: 400 })

    const sujeito: SujeitoContexto = {
      nome: b?.sujeito?.nome ?? "Pessoa de teste",
      ehPessoaArvore: b?.sujeito?.ehPessoaArvore ?? true,
      requerente: b?.sujeito?.requerente ?? false,
      contratante: b?.sujeito?.contratante ?? false,
      linhaReta: b?.sujeito?.linhaReta ?? false,
      precisaDeDocumentacao: b?.sujeito?.precisaDeDocumentacao ?? false,
      casado: b?.sujeito?.casado ?? false,
      vivo: b?.sujeito?.vivo ?? true,
      falecido: b?.sujeito?.falecido ?? false,
      possuiConjuge: b?.sujeito?.possuiConjuge,
      geracao: b?.sujeito?.geracao ?? null,
      nacionalidade: b?.sujeito?.nacionalidade ?? null,
      paisRegistro: b?.sujeito?.paisRegistro ?? null,
      dataEmissaoDocumento: b?.sujeito?.dataEmissaoDocumento ?? null,
    }

    const todas = await carregarRegras()
    const doProcesso = todas.filter((r) => r.tipoProcessoId === tipoProcessoId)
    const incluirRascunhos = b?.incluirRascunhos === true
    const regras: RegraDocumental[] = doProcesso.map((r) =>
      incluirRascunhos && r.status === "RASCUNHO" ? { ...r, status: "PUBLICADA" } : r,
    )

    const ctx: ContextoAvaliacao = {
      tipoProcessoId,
      modalidadeId: b?.modalidadeId != null ? Number(b.modalidadeId) : null,
      paisCode: b?.paisCode ?? null,
      regiaoCode: b?.regiaoCode ?? null,
      faseKey: b?.faseKey ?? null,
      sujeito,
      dataReferencia: b?.dataReferencia ? String(b.dataReferencia) : new Date().toISOString(),
      regras,
    }

    const resultado = avaliarRegrasDocumentais(ctx)

    // auditoria leve de simulação (não grava documento/tarefa)
    const usuarioId = await usuarioIdDe(request)
    await auditar(prisma, { acao: "REGRA_SIMULADA", descricao: `Simulação (${tipoProcessoId}) — ${resultado.aplicaveis.length} aplicável(is)`, detalhes: { tipoProcessoId, sujeito, incluirRascunhos }, usuarioId })

    return NextResponse.json({ resultado })
  } catch (e) {
    console.error("POST regras-documentais/simular", e)
    return NextResponse.json({ error: "Erro ao simular." }, { status: 500 })
  }
}
