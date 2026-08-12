// POST /api/gerenciamento/parametrizacao/concluir { tipoProcessoId, phaseKey? }
//
// Executa o ciclo inteiro e TRANSMITE cada etapa assim que ela termina (NDJSON).
// Streaming em vez de uma resposta única porque materializar N processos leva
// tempo: sem progresso real, o administrador olha um spinner sem saber se está
// andando ou travado — e recarrega a página no meio de uma escrita.
//
// Permissão RESTRITA: concluir publica e materializa.
import { NextRequest } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { concluirParametrizacao } from "@/src/services/parametrizacao/concluir-parametrizacao"
import { registrarAuditoria } from "@/lib/gerenciamento/auditoria"

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, "regras_documentais.publicar" as never)
  if (erro) return erro
  const b = await req.json().catch(() => ({}))
  const tipoProcessoId = Number(b?.tipoProcessoId)
  if (!tipoProcessoId) return Response.json({ error: "tipoProcessoId é obrigatório." }, { status: 400 })
  const phaseKey: string | null = b?.phaseKey ?? null
  const actor = await extrairUsuarioComPermissoes(req)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const envia = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"))
      try {
        for await (const evento of concluirParametrizacao({ tipoProcessoId, phaseKey, usuarioId: actor?.userId ?? null })) {
          envia(evento)
          if ("relatorio" in evento) {
            // Auditoria do ATO administrativo, com o que de fato aconteceu.
            await registrarAuditoria(req, {
              acao: "PUBLICAR", entidade: "ConclusaoParametrizacao", entidadeId: tipoProcessoId,
              descricao: `Parametrização concluída (${evento.relatorio.concluiu ? "sem erro" : "com erro em etapa"})`,
              detalhes: { tipoProcessoId, phaseKey, resumo: evento.relatorio.resumo, duracaoMs: evento.relatorio.duracaoMs },
            }).catch(() => {})
          }
        }
      } catch (e) {
        envia({ erroFatal: e instanceof Error ? e.message : "erro ao concluir" })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  })
}
