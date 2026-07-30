// POST — CONFIRMAR a importação: aplica a árvore proposta inteira, de uma vez.
//
// Aqui nascem as pessoas aprovadas, os vínculos aprovados e os documentos na
// Pasta Documental existente — tudo numa transação. Devolve o `importacaoId`,
// que é por onde a importação inteira pode ser desfeita depois.
import { type NextRequest, NextResponse } from "next/server"
import {
  confirmarImportacao,
  type ArquivoAnalisado,
  type ArquivoImportado,
  type DecisaoDocumento,
  type DecisaoNo,
  type DecisaoVinculo,
  type NoProposto,
  type VinculoProposto,
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
  const nos = Array.isArray(body?.nos) ? (body.nos as NoProposto[]) : null
  const vinculos = Array.isArray(body?.vinculos) ? (body.vinculos as VinculoProposto[]) : null
  if (!arquivos || !analise || !nos || !vinculos) {
    return erro("Envie `arquivos`, `analise`, `nos` e `vinculos` — os mesmos devolvidos pela análise.")
  }

  const chavesConhecidas = new Set(nos.map((n) => n.chave))

  // ---- decisões sobre pessoas
  const decisoesNos: DecisaoNo[] = []
  for (const b of Array.isArray(body?.decisoesNos) ? (body.decisoesNos as unknown[]) : []) {
    const d = b as Record<string, unknown>
    const chave = typeof d?.chave === "string" ? d.chave : null
    if (!chave || !chavesConhecidas.has(chave)) return erro("Decisão para um nó que não está na análise.")
    const acao = d?.acao === "CRIAR" || d?.acao === "VINCULAR" || d?.acao === "IGNORAR" ? d.acao : null
    if (!acao) return erro(`Ação inválida para o nó ${chave}.`)
    const pessoaId = Number(d?.pessoaId)
    const mesmoQue = typeof d?.mesmoQue === "string" ? d.mesmoQue : null
    if (mesmoQue && !chavesConhecidas.has(mesmoQue)) {
      return erro("Junção apontada para um nó que não está na análise.")
    }
    decisoesNos.push({
      chave,
      acao,
      mesmoQue,
      pessoaId: Number.isFinite(pessoaId) && pessoaId > 0 ? pessoaId : null,
      nome: typeof d?.nome === "string" ? d.nome : null,
      sobrenome: typeof d?.sobrenome === "string" ? d.sobrenome : null,
      camposAAplicar: Array.isArray(d?.camposAAplicar)
        ? (d.camposAAplicar as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
    })
  }
  if (decisoesNos.length === 0) return erro("Nenhuma decisão de pessoa enviada.")

  // ---- decisões sobre vínculos
  const decisoesVinculos: DecisaoVinculo[] = []
  for (const b of Array.isArray(body?.decisoesVinculos) ? (body.decisoesVinculos as unknown[]) : []) {
    const d = b as Record<string, unknown>
    const tipo =
      d?.tipo === "FILIACAO_PAI" || d?.tipo === "FILIACAO_MAE" || d?.tipo === "UNIAO" ? d.tipo : null
    const deChave = typeof d?.deChave === "string" ? d.deChave : null
    const paraChave = typeof d?.paraChave === "string" ? d.paraChave : null
    if (!tipo || !deChave || !paraChave) return erro("Decisão de vínculo incompleta.")
    if (!chavesConhecidas.has(deChave) || !chavesConhecidas.has(paraChave)) {
      return erro("Decisão de vínculo aponta para um nó que não está na análise.")
    }
    decisoesVinculos.push({ tipo, deChave, paraChave, aplicar: d?.aplicar === true })
  }

  // ---- decisões sobre documentos
  const decisoesDocumentos: DecisaoDocumento[] = []
  for (const b of Array.isArray(body?.decisoesDocumentos) ? (body.decisoesDocumentos as unknown[]) : []) {
    const d = b as Record<string, unknown>
    const indice = Number(d?.indice)
    if (!Number.isInteger(indice) || indice < 0 || indice >= arquivos.length) {
      return erro("Decisão com índice de arquivo fora do lote analisado.")
    }
    const chave = typeof d?.pessoaChave === "string" ? d.pessoaChave : null
    if (chave && !chavesConhecidas.has(chave)) return erro("Documento apontado para um nó que não está na análise.")
    decisoesDocumentos.push({ indice, pessoaChave: chave, descartar: d?.descartar === true })
  }

  // Criar pessoa ou mexer em vínculo é alteração da árvore: exige a permissão
  // própria, e só quando a importação de fato vai fazer isso.
  const alteraArvore =
    decisoesNos.some((d) => d.acao === "CRIAR") || decisoesVinculos.some((d) => d.aplicar)
  if (alteraArvore) {
    const permitido =
      temPermissao(auth.ctx.ator.permissoes, "registral.revisar") ||
      temPermissao(auth.ctx.ator.permissoes, "arvore.editar")
    if (!permitido) {
      return NextResponse.json(
        {
          error: "Esta importação criaria pessoas ou vínculos na árvore, e você não tem permissão para isso.",
          permissoesAceitas: ["registral.revisar", "arvore.editar"],
        },
        { status: 403 },
      )
    }
  }

  // Alterar filiação já cadastrada é a mudança mais destrutiva possível numa
  // árvore de cidadania — tem porteiro próprio.
  const trocaFiliacao = decisoesVinculos.some(
    (d) => d.aplicar && d.tipo !== "UNIAO" && vinculos.some((v) => v.deChave === d.deChave && v.paraChave === d.paraChave && v.conflito),
  )
  if (trocaFiliacao && !temPermissao(auth.ctx.ator.permissoes, "registral.alterar_filiacao")) {
    return NextResponse.json(
      {
        error: "Esta importação trocaria uma filiação já cadastrada. É preciso a permissão de alterar filiação.",
        permissoesAceitas: ["registral.alterar_filiacao"],
      },
      { status: 403 },
    )
  }

  try {
    const resultado = await confirmarImportacao({
      processoId,
      arquivos,
      analise,
      nos,
      vinculos,
      decisoesNos,
      decisoesVinculos,
      decisoesDocumentos,
      usuarioId: auth.ctx.usuarioId,
    })
    return NextResponse.json(resultado, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[registral][importar][confirmar]", msg)
    return erro(msg, 422)
  }
}
