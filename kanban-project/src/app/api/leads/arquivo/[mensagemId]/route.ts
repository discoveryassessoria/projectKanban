// src/app/api/leads/arquivo/[mensagemId]/route.ts — o arquivo que o lead mandou numa mensagem (docs/leads-mandato.md, regras 13 e 23, §8).
// O conteúdo não é copiado para o sistema: é buscado na Meta na hora, com o token do servidor. O identificador
// da mídia e o endereço da Meta nunca chegam ao navegador — a tela pede pelo id da MENSAGEM.
import { NextRequest, NextResponse } from "next/server"
import { configuracaoDoWhatsApp } from "@/src/services/leads/config"
import { arquivoDaMensagem } from "@/src/services/leads/leitura"
import { autorizarLeads, idDaUrl, idInvalido, whatsAppDesligado } from "@/src/services/leads/rota"
import { criarWhatsApp } from "@/src/services/leads/whatsapp"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const EXTENSAO: Record<string, string> = { audio: "ogg", image: "jpg", video: "mp4", document: "pdf" }

/**
 * O arquivo vem de fora (qualquer pessoa manda qualquer coisa pelo WhatsApp). Só estes tipos podem ser
 * abertos pelo navegador; todo o resto (HTML, SVG, executável…) sai como download de "arquivo qualquer",
 * para nunca rodar dentro do sistema com a sessão de quem está logado.
 */
const TIPOS_QUE_ABREM = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/amr", "video/mp4", "video/3gpp"])

export async function GET(request: NextRequest, ctx: { params: Promise<{ mensagemId: string }> }) {
  const { erro } = await autorizarLeads(request)
  if (erro) return erro
  const id = idDaUrl((await ctx.params).mensagemId)
  if (!id) return idInvalido()
  const config = configuracaoDoWhatsApp()
  if (!config) return whatsAppDesligado()
  const arquivo = await arquivoDaMensagem(id)
  if (!arquivo) return NextResponse.json({ error: "Esta mensagem não tem arquivo.", codigo: "SEM_ARQUIVO" }, { status: 404 })
  try {
    const { bytes, tipo } = await criarWhatsApp(config).baixarArquivo(arquivo.midiaId)
    const nome = (arquivo.nome || `arquivo-do-lead-${id}.${EXTENSAO[arquivo.tipo] ?? "bin"}`).replace(/[^\w.\- ()À-ÿ]/g, "_")
    const declarado = tipo.split(";")[0].trim().toLowerCase()
    const abre = TIPOS_QUE_ABREM.has(declarado)
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": abre ? declarado : "application/octet-stream",
        "content-length": String(bytes.length),
        "content-disposition": `${abre ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(nome)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    })
  } catch (e) {
    console.error("[leads] arquivo do lead não baixado:", e instanceof Error ? e.message : e)
    // A Meta guarda a mídia por tempo limitado; depois disso o arquivo não existe mais lá.
    return NextResponse.json({ error: "O arquivo não está mais disponível no WhatsApp. Peça ao lead para enviar de novo.", codigo: "ARQUIVO_INDISPONIVEL" }, { status: 502 })
  }
}
