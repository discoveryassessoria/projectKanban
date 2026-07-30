// POST — CONFIRMAR a importação: grava na Pasta Documental e roda o motor.
//
// Só aqui nasce `Documento`, e já com a pessoa que o operador aprovou na revisão.
// A transcrição vem pronta da análise (não se paga OCR duas vezes) e o lote
// registral é disparado na sequência, produzindo fatos, evidências e propostas.
import { type NextRequest, NextResponse } from "next/server"
import {
  confirmarImportacao,
  type ArquivoAnalisado,
  type ArquivoImportado,
  type DecisaoImportacao,
} from "@/src/services/registral/importacao"
import { erro, exigirAlguma, idDe } from "@/src/services/registral/autorizacao"
import { temPermissao } from "@/src/lib/permissoes"

export const maxDuration = 300
export const dynamic = "force-dynamic"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const auth = await exigirAlguma(request, ["registral.revisar", "arvore.criar_documento"])
  if (!auth.ok) return auth.resposta

  const { processoId: raw } = await params
  const processoId = idDe(raw)
  if (processoId == null) return erro("processoId inválido")

  const body = await request.json().catch(() => null)
  const arquivos = Array.isArray(body?.arquivos) ? (body.arquivos as ArquivoImportado[]) : null
  const analise = Array.isArray(body?.analise) ? (body.analise as ArquivoAnalisado[]) : null
  const brutas = Array.isArray(body?.decisoes) ? (body.decisoes as unknown[]) : null
  if (!arquivos || !analise || !brutas) {
    return erro("Envie `arquivos`, `analise` e `decisoes` — os mesmos devolvidos pela análise.")
  }

  const decisoes: DecisaoImportacao[] = []
  for (const b of brutas) {
    const d = b as Record<string, unknown>
    const indice = Number(d?.indice)
    if (!Number.isInteger(indice) || indice < 0 || indice >= arquivos.length) {
      return erro("Decisão com índice fora do lote analisado.")
    }
    const pessoaId = Number(d?.pessoaId)
    decisoes.push({
      indice,
      pessoaId: Number.isFinite(pessoaId) && pessoaId > 0 ? pessoaId : null,
      nomeNovaPessoa: typeof d?.nomeNovaPessoa === "string" ? d.nomeNovaPessoa : null,
      descartar: d?.descartar === true,
    })
  }
  if (decisoes.length === 0) return erro("Nenhuma decisão enviada.")

  // Criar pessoa é alteração da árvore: exige a permissão própria, e só quando
  // a importação de fato vai criar alguém.
  const criaPessoa = decisoes.some((d) => !d.descartar && d.pessoaId == null)
  if (criaPessoa) {
    const permitido =
      temPermissao(auth.ctx.ator.permissoes, "registral.revisar") ||
      temPermissao(auth.ctx.ator.permissoes, "arvore.editar")
    if (!permitido) {
      return NextResponse.json(
        {
          error: "Esta importação criaria pessoas novas na árvore, e você não tem permissão para isso.",
          permissoesAceitas: ["registral.revisar", "arvore.editar"],
        },
        { status: 403 },
      )
    }
  }

  try {
    const resultado = await confirmarImportacao({
      processoId,
      arquivos,
      analise,
      decisoes,
      usuarioId: auth.ctx.usuarioId,
    })
    return NextResponse.json(resultado, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[registral][importar][confirmar]", msg)
    return erro(msg, 422)
  }
}
