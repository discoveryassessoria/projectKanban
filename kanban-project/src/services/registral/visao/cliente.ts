// src/services/registral/visao/cliente.ts
//
// CLIENTE DA API DA ANTHROPIC — a única parte do sistema que fala com fora.
//
// É deliberadamente pequeno e sem SDK: o que precisamos daqui é uma chamada HTTP
// com garantias operacionais explícitas, e cada uma delas existe por um motivo
// que dá para nomear:
//
//   TIMEOUT      · certidão que trava não pode segurar a função até o limite da
//                  plataforma e derrubar o lote inteiro junto.
//   RETRY        · 429 e 5xx são transitórios; erro de esquema ou de credencial
//                  não é, e repetir só queima dinheiro. Só os primeiros são
//                  repetidos, com espera exponencial e respeito ao `retry-after`.
//   RATE LIMIT   · o lote é de 30 certidões × 2 leituras; sem um portão, sobem
//                  60 requisições simultâneas e a conta toma 429 de volta.
//   TETO DE CUSTO· uma pasta grande com PDFs densos pode custar caro sem ninguém
//                  perceber. O teto é por importação e mata o lote antes disso.
//   SIGILO       · certidão é dado pessoal sensível. NADA do conteúdo do
//                  documento — nem base64, nem trecho, nem nome — entra em log.
//                  Só entram identificadores, contagens, custo e status.
//
// A chave é lida de `ANTHROPIC_API_KEY`. Sem ela, o provedor se declara
// indisponível e diz por quê; ninguém inventa credencial nem cai para outro
// fornecedor.

import { logRegistral } from "../auditoria"

// ---------------------------------------------------------------- configuração

/**
 * Modelo de visão. Padrão `claude-sonnet-5` — na documentação oficial é o
 * equilíbrio de capacidade e preço para extração documental em volume
 * (US$ 3/MTok entrada, US$ 15/MTok saída; introdutório US$ 2/US$ 10 até 31/08/2026),
 * com 1M de contexto e latência baixa. Trocável por env sem tocar em código.
 */
export const MODELO_PADRAO = "claude-sonnet-5"

export const ENDPOINT = "https://api.anthropic.com/v1/messages"
export const VERSAO_API = "2023-06-01"

/** Preço por milhão de tokens, para o teto de custo. Ajustável por env. */
interface Tabela {
  entrada: number
  saida: number
}
function tabelaDePreco(): Tabela {
  const entrada = Number(process.env.ANTHROPIC_PRECO_ENTRADA_MTOK ?? "3")
  const saida = Number(process.env.ANTHROPIC_PRECO_SAIDA_MTOK ?? "15")
  return {
    entrada: Number.isFinite(entrada) && entrada > 0 ? entrada : 3,
    saida: Number.isFinite(saida) && saida > 0 ? saida : 15,
  }
}

export interface ConfigVisao {
  modelo: string
  timeoutMs: number
  tentativas: number
  concorrencia: number
  /** Teto em dólares por importação. 0 desliga o teto (não recomendado). */
  tetoUsd: number
  maxBytes: number
  maxPaginas: number
}

export function configVisao(): ConfigVisao {
  const num = (v: string | undefined, padrao: number, min: number, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= min && n <= max ? n : padrao
  }
  return {
    modelo: process.env.ANTHROPIC_MODEL?.trim() || MODELO_PADRAO,
    timeoutMs: num(process.env.ANTHROPIC_TIMEOUT_MS, 120_000, 5_000, 600_000),
    tentativas: num(process.env.ANTHROPIC_TENTATIVAS, 3, 1, 6),
    concorrencia: num(process.env.ANTHROPIC_CONCORRENCIA, 3, 1, 12),
    tetoUsd: num(process.env.ANTHROPIC_TETO_USD, 5, 0, 500),
    maxBytes: num(process.env.ANTHROPIC_MAX_BYTES, 20 * 1024 * 1024, 1024, 32 * 1024 * 1024),
    maxPaginas: num(process.env.ANTHROPIC_MAX_PAGINAS, 20, 1, 100),
  }
}

export function chaveConfigurada(): { ok: true; chave: string } | { ok: false; motivo: string } {
  const chave = process.env.ANTHROPIC_API_KEY?.trim()
  if (!chave) {
    return {
      ok: false,
      motivo:
        "ANTHROPIC_API_KEY não configurada — a leitura visual de certidões está desligada. " +
        "Cadastre a variável no projeto (Vercel) para habilitar.",
    }
  }
  if (!chave.startsWith("sk-ant-")) {
    return { ok: false, motivo: "ANTHROPIC_API_KEY presente mas com formato inesperado (deve começar com sk-ant-)." }
  }
  return { ok: true, chave }
}

// ---------------------------------------------------------------- blocos de conteúdo

export type BlocoConteudo =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }

export const IMAGENS_ACEITAS = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

/**
 * Monta o bloco de conteúdo do arquivo. PDF vai como `document` — a API o
 * processa página a página POR VISÃO, que é justamente o que faz certidão
 * escaneada (sem camada de texto) funcionar sem rasterizar nada aqui.
 */
export function blocoDoArquivo(
  mimeType: string | null,
  nome: string | null,
  conteudo: Uint8Array,
): { ok: true; bloco: BlocoConteudo } | { ok: false; motivo: string } {
  const mime = (mimeType ?? "").toLowerCase().split(";")[0].trim()
  const ext = (nome ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ""
  const base64 = Buffer.from(conteudo).toString("base64")

  const ehPdf = mime === "application/pdf" || (!mime && ext === "pdf")
  if (ehPdf) {
    if (!pareceMesmoPdf(conteudo)) {
      return { ok: false, motivo: "O arquivo diz ser PDF mas não começa com a assinatura de um PDF." }
    }
    return { ok: true, bloco: { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } } }
  }

  const mimeImagem = IMAGENS_ACEITAS.has(mime)
    ? mime
    : ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : ext === "gif"
            ? "image/gif"
            : null

  if (!mimeImagem) {
    return {
      ok: false,
      motivo: `Tipo de arquivo não aceito para leitura visual (${mime || ext || "desconhecido"}). Envie PDF, JPG, PNG ou WEBP.`,
    }
  }
  if (!pareceMesmaImagem(conteudo, mimeImagem)) {
    return { ok: false, motivo: "O conteúdo do arquivo não corresponde ao tipo declarado." }
  }
  return { ok: true, bloco: { type: "image", source: { type: "base64", media_type: mimeImagem, data: base64 } } }
}

/** Assinatura real do arquivo — extensão e MIME são declaração, não prova. */
function pareceMesmoPdf(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 // %PDF
}

function pareceMesmaImagem(b: Uint8Array, mime: string): boolean {
  if (b.length < 12) return false
  if (mime === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8
  if (mime === "image/png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  if (mime === "image/gif") return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46
  if (mime === "image/webp") {
    return (
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42
    )
  }
  return false
}

/** Conta páginas de um PDF sem depender de biblioteca — para barrar o exagero. */
export function contarPaginasPdf(b: Uint8Array): number | null {
  if (!pareceMesmoPdf(b)) return null
  const texto = Buffer.from(b).toString("latin1")
  const porCount = [...texto.matchAll(/\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (porCount.length) return Math.max(...porCount)
  const porTipo = (texto.match(/\/Type\s*\/Page[^s]/g) ?? []).length
  return porTipo > 0 ? porTipo : null
}

// ---------------------------------------------------------------- portão de concorrência

/**
 * Portão simples: no máximo N chamadas em voo. Vive no módulo porque a instância
 * da função serverless é reusada entre requisições (Fluid Compute) — é o mesmo
 * processo que precisa se conter.
 */
class Portao {
  private emVoo = 0
  private fila: Array<() => void> = []
  constructor(private limite: number) {}

  async entrar(): Promise<void> {
    if (this.emVoo < this.limite) {
      this.emVoo++
      return
    }
    await new Promise<void>((resolve) => this.fila.push(resolve))
    this.emVoo++
  }

  sair(): void {
    this.emVoo--
    const proximo = this.fila.shift()
    if (proximo) proximo()
  }
}

let portao: Portao | null = null
let portaoLimite = 0
function portaoAtual(limite: number): Portao {
  if (!portao || portaoLimite !== limite) {
    portao = new Portao(limite)
    portaoLimite = limite
  }
  return portao
}

// ---------------------------------------------------------------- orçamento

/** Orçamento de UMA importação. Some o gasto e corta antes de estourar. */
export class Orcamento {
  private gastoUsd = 0
  private chamadas = 0
  private tokensEntrada = 0
  private tokensSaida = 0

  constructor(private tetoUsd: number) {}

  podeGastar(): boolean {
    return this.tetoUsd <= 0 || this.gastoUsd < this.tetoUsd
  }

  registrar(entrada: number, saida: number): void {
    const p = tabelaDePreco()
    this.gastoUsd += (entrada / 1_000_000) * p.entrada + (saida / 1_000_000) * p.saida
    this.chamadas++
    this.tokensEntrada += entrada
    this.tokensSaida += saida
  }

  resumo(): { chamadas: number; tokensEntrada: number; tokensSaida: number; custoUsd: number; tetoUsd: number } {
    return {
      chamadas: this.chamadas,
      tokensEntrada: this.tokensEntrada,
      tokensSaida: this.tokensSaida,
      custoUsd: Math.round(this.gastoUsd * 10000) / 10000,
      tetoUsd: this.tetoUsd,
    }
  }
}

// ---------------------------------------------------------------- a chamada

export interface PedidoVisao {
  sistema: string
  blocos: BlocoConteudo[]
  esquema: unknown
  maxTokens?: number
  /** Só para log/telemetria — nunca conteúdo. */
  referencia?: string
}

export type RespostaVisao =
  | { ok: true; json: unknown; tokensEntrada: number; tokensSaida: number; tentativasFeitas: number }
  | { ok: false; motivo: string; permanente: boolean; tentativasFeitas: number }

/** Transporte injetável — os testes provam retry/timeout/rate limit sem rede. */
export type Transporte = (url: string, init: RequestInit) => Promise<Response>

let transporteAtual: Transporte | null = null
/** Só para teste. Em produção nunca é chamado, e o guard cobre isso. */
export function definirTransporte(t: Transporte | null): void {
  transporteAtual = t
}

const ESPERA_BASE_MS = 500

export async function chamarVisao(
  pedido: PedidoVisao,
  orcamento: Orcamento,
  cfg: ConfigVisao = configVisao(),
): Promise<RespostaVisao> {
  const credencial = chaveConfigurada()
  if (!credencial.ok) return { ok: false, motivo: credencial.motivo, permanente: true, tentativasFeitas: 0 }

  if (!orcamento.podeGastar()) {
    return {
      ok: false,
      motivo: `Teto de custo desta importação atingido (US$ ${orcamento.resumo().tetoUsd}). Nenhuma chamada adicional foi feita.`,
      permanente: true,
      tentativasFeitas: 0,
    }
  }

  const corpo = JSON.stringify({
    model: cfg.modelo,
    max_tokens: pedido.maxTokens ?? 8000,
    system: pedido.sistema,
    messages: [{ role: "user", content: pedido.blocos }],
    output_config: { format: { type: "json_schema", schema: pedido.esquema } },
  })

  const executar = transporteAtual ?? ((url: string, init: RequestInit) => fetch(url, init))
  const g = portaoAtual(cfg.concorrencia)
  await g.entrar()
  try {
    let ultimoMotivo = "Falha desconhecida."
    for (let tentativa = 1; tentativa <= cfg.tentativas; tentativa++) {
      const controle = new AbortController()
      const relogio = setTimeout(() => controle.abort(), cfg.timeoutMs)
      try {
        const res = await executar(ENDPOINT, {
          method: "POST",
          signal: controle.signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": credencial.chave,
            "anthropic-version": VERSAO_API,
          },
          body: corpo,
        })

        if (res.ok) {
          const dados = (await res.json()) as {
            content?: Array<{ type: string; text?: string }>
            usage?: { input_tokens?: number; output_tokens?: number }
          }
          const entrada = dados.usage?.input_tokens ?? 0
          const saida = dados.usage?.output_tokens ?? 0
          orcamento.registrar(entrada, saida)

          const texto = (dados.content ?? []).find((c) => c.type === "text")?.text
          if (!texto) {
            return {
              ok: false,
              motivo: "A resposta não trouxe conteúdo de texto.",
              permanente: true,
              tentativasFeitas: tentativa,
            }
          }
          try {
            return { ok: true, json: JSON.parse(texto), tokensEntrada: entrada, tokensSaida: saida, tentativasFeitas: tentativa }
          } catch {
            return {
              ok: false,
              motivo: "A resposta não é JSON válido apesar do esquema declarado.",
              permanente: true,
              tentativasFeitas: tentativa,
            }
          }
        }

        // ---- erro HTTP
        const permanente = res.status !== 429 && res.status < 500
        ultimoMotivo = await motivoDoErro(res)
        logRegistral("warn", "visao_erro_http", {
          status: res.status,
          tentativa,
          permanente,
          referencia: pedido.referencia ?? null,
        })
        if (permanente) return { ok: false, motivo: ultimoMotivo, permanente: true, tentativasFeitas: tentativa }
        if (tentativa < cfg.tentativas) await esperar(esperaDe(res, tentativa))
      } catch (e) {
        const abortado = e instanceof Error && e.name === "AbortError"
        ultimoMotivo = abortado
          ? `A leitura passou de ${Math.round(cfg.timeoutMs / 1000)}s e foi interrompida.`
          : `Falha de rede ao chamar o serviço de leitura: ${e instanceof Error ? e.message : String(e)}`
        logRegistral("warn", "visao_falha_rede", {
          tentativa,
          abortado,
          referencia: pedido.referencia ?? null,
        })
        if (tentativa < cfg.tentativas) await esperar(ESPERA_BASE_MS * 2 ** (tentativa - 1))
      } finally {
        clearTimeout(relogio)
      }
    }
    return { ok: false, motivo: ultimoMotivo, permanente: false, tentativasFeitas: cfg.tentativas }
  } finally {
    g.sair()
  }
}

/** Mensagem de erro SEM eco de conteúdo: só o que a API disse sobre si mesma. */
async function motivoDoErro(res: Response): Promise<string> {
  let detalhe = ""
  try {
    const corpo = (await res.json()) as { error?: { message?: string; type?: string } }
    detalhe = corpo?.error?.message ?? corpo?.error?.type ?? ""
  } catch {
    detalhe = ""
  }
  const rotulo =
    res.status === 401
      ? "credencial recusada"
      : res.status === 403
        ? "sem permissão para o modelo"
        : res.status === 429
          ? "limite de requisições"
          : res.status === 413
            ? "arquivo grande demais para uma requisição"
            : res.status >= 500
              ? "falha temporária do serviço"
              : "requisição recusada"
  return `Leitura visual falhou (${res.status} · ${rotulo})${detalhe ? `: ${detalhe.slice(0, 200)}` : "."}`
}

function esperaDe(res: Response, tentativa: number): number {
  const cabecalho = res.headers?.get?.("retry-after")
  const segundos = Number(cabecalho)
  if (Number.isFinite(segundos) && segundos > 0) return Math.min(segundos * 1000, 30_000)
  return Math.min(ESPERA_BASE_MS * 2 ** (tentativa - 1), 8_000)
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Situação do provedor de visão — para a tela e para o smoke dizerem a verdade. */
export function situacaoDaVisao(): { disponivel: boolean; modelo: string; motivo: string | null } {
  const c = chaveConfigurada()
  const cfg = configVisao()
  return {
    disponivel: c.ok,
    modelo: cfg.modelo,
    motivo: c.ok ? null : c.motivo,
  }
}
