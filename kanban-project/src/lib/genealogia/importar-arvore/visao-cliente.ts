// src/lib/genealogia/importar-arvore/visao-cliente.ts
// ============================================================================
// CLIENTE DA API DA ANTHROPIC — o único ponto deste módulo que fala com fora.
//
// Adaptado de `src/services/registral/visao/cliente.ts` (commit b253c3f6, hoje
// revertido). O que veio de lá são as garantias operacionais, cada uma com um
// motivo que dá para nomear:
//
//   TIMEOUT + PRAZO · a rota tem `maxDuration = 60`. Uma tentativa que trava
//                     não pode consumir o orçamento inteiro da função e devolver
//                     504 sem mensagem. Há prazo global, não só por tentativa.
//   RETRY           · 429 e 5xx são transitórios; esquema errado e credencial
//                     recusada não são, e repetir só queima crédito. Só os
//                     primeiros são repetidos, com espera exponencial e
//                     respeito ao `retry-after`.
//   PORTÃO          · a instância serverless é reusada entre requisições. Sem
//                     um portão, N operadores importando ao mesmo tempo viram
//                     N chamadas simultâneas e a conta toma 429 de volta.
//   TETO DE CUSTO   · calculado ANTES da chamada, sobre o pior caso possível
//                     (entrada estimada + `max_tokens` inteiro). Teto conferido
//                     só depois do gasto não é teto, é relatório.
//   TETO DE RESPOSTA· `max_tokens` limita o custo; o leitor limitado limita a
//                     memória. Um corpo gigante não vira string de 100 MB aqui.
//   SIGILO          · NADA do conteúdo entra em log — nem base64, nem trecho,
//                     nem nome. Só identificadores, contagens, custo e status.
//
// A chave é lida de `ANTHROPIC_API_KEY`. Sem ela o provedor se declara
// indisponível e diz por quê; ninguém inventa credencial nem cai para outro
// fornecedor.
// ============================================================================

export const ENDPOINT = "https://api.anthropic.com/v1/messages"
export const VERSAO_API = "2023-06-01"

/**
 * Modelo padrão. `claude-opus-5` é o modelo atual de maior capacidade da linha
 * Opus (US$ 5/MTok entrada, US$ 25/MTok saída) — a leitura de um diagrama com
 * linhas cruzando cards é justamente onde a diferença aparece.
 *
 * Trocável por env sem tocar em código: `ARVORE_VISAO_MODELO=claude-sonnet-5`
 * corta o preço para US$ 3/US$ 15 se o volume passar a pesar mais que a
 * precisão. Se trocar, ajuste também os dois preços abaixo.
 */
export const MODELO_PADRAO = "claude-opus-5"

// ---------------------------------------------------------------- configuração

export interface ConfigVisao {
  modelo: string
  /** Esforço de raciocínio: low | medium | high | xhigh | max. */
  esforco: string
  /** Teto de tokens de SAÍDA. É o limitador direto do custo de saída. */
  maxTokens: number
  /** Timeout de UMA tentativa. */
  timeoutMs: number
  /** Prazo total, somando tentativas e esperas. Fica abaixo do maxDuration da rota. */
  prazoTotalMs: number
  tentativas: number
  concorrencia: number
  /** Teto em dólares por chamada. 0 desliga o teto (não recomendado). */
  tetoUsd: number
  /** Teto do BYTES da imagem decodificada — entrada também custa. */
  maxBytesImagem: number
  /** Teto de bytes lidos do corpo da resposta. */
  maxBytesResposta: number
}

function num(v: string | undefined, padrao: number, min: number, max: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : padrao
}

export function configVisao(): ConfigVisao {
  return {
    modelo: process.env.ARVORE_VISAO_MODELO?.trim() || MODELO_PADRAO,
    esforco: process.env.ARVORE_VISAO_ESFORCO?.trim() || "medium",
    maxTokens: num(process.env.ARVORE_VISAO_MAX_TOKENS, 16_000, 1_000, 32_000),
    // 45s não cobria a leitura de uma árvore real. Uma prancha com quinze cards
    // leva bem mais que isso, então a 1ª tentativa era abortada, e a 2ª herdava
    // o resto do orçamento — o usuário via "A leitura passou de 6s", mensagem
    // que escondia os 45s já gastos e fazia parecer defeito instantâneo.
    timeoutMs: num(process.env.ARVORE_VISAO_TIMEOUT_MS, 110_000, 5_000, 120_000),
    // O orçamento total precisa caber DUAS tentativas, senão a segunda nasce
    // condenada e só serve para atrasar a mensagem de erro.
    prazoTotalMs: num(process.env.ARVORE_VISAO_PRAZO_MS, 240_000, 10_000, 300_000),
    tentativas: num(process.env.ARVORE_VISAO_TENTATIVAS, 2, 1, 5),
    concorrencia: num(process.env.ARVORE_VISAO_CONCORRENCIA, 2, 1, 8),
    tetoUsd: num(process.env.ARVORE_VISAO_TETO_USD, 1, 0, 100),
    maxBytesImagem: num(process.env.ARVORE_VISAO_MAX_BYTES, 5 * 1024 * 1024, 1024, 20 * 1024 * 1024),
    maxBytesResposta: num(process.env.ARVORE_VISAO_MAX_BYTES_RESP, 2 * 1024 * 1024, 8 * 1024, 16 * 1024 * 1024),
  }
}

/** Preço por milhão de tokens. Só serve para o teto — não é cobrança. */
function tabelaDePreco(): { entrada: number; saida: number } {
  const entrada = Number(process.env.ANTHROPIC_PRECO_ENTRADA_MTOK ?? "5")
  const saida = Number(process.env.ANTHROPIC_PRECO_SAIDA_MTOK ?? "25")
  return {
    entrada: Number.isFinite(entrada) && entrada > 0 ? entrada : 5,
    saida: Number.isFinite(saida) && saida > 0 ? saida : 25,
  }
}

/**
 * Teto de tokens de uma imagem em alta resolução (2576px no lado maior).
 * Usado para estimar o PIOR CASO de entrada antes de gastar — subestimar aqui
 * transformaria o teto de custo em enfeite.
 */
const TOKENS_IMAGEM_TETO = 4_800
/** Folga para prompt de sistema, texto complementar e esquema. */
const TOKENS_TEXTO_TETO = 4_000

export function chaveConfigurada(): { ok: true; chave: string } | { ok: false; motivo: string } {
  const chave = process.env.ANTHROPIC_API_KEY?.trim()
  if (!chave) {
    return {
      ok: false,
      motivo:
        "ANTHROPIC_API_KEY não configurada — a leitura da árvore por IA está desligada. " +
        "Cadastre a variável no projeto (Vercel) para habilitar.",
    }
  }
  if (!chave.startsWith("sk-ant-")) {
    return { ok: false, motivo: "ANTHROPIC_API_KEY presente mas com formato inesperado (deve começar com sk-ant-)." }
  }
  return { ok: true, chave }
}

/** Situação do provedor — para a tela e para o smoke dizerem a verdade. */
export function situacaoDaVisao(): { disponivel: boolean; modelo: string; motivo: string | null } {
  const c = chaveConfigurada()
  return { disponivel: c.ok, modelo: configVisao().modelo, motivo: c.ok ? null : c.motivo }
}

// ---------------------------------------------------------------- imagem

export const IMAGENS_ACEITAS = new Set(["image/png", "image/jpeg", "image/webp"])

export interface BlocoImagem {
  type: "image"
  source: { type: "base64"; media_type: string; data: string }
}

/**
 * Valida a imagem e monta o bloco. Confere a ASSINATURA do arquivo: extensão e
 * MIME são declaração do cliente, não prova — e mandar 5 MB de lixo para a API
 * custa igual a mandar 5 MB de imagem.
 */
export function blocoDaImagem(
  base64: string,
  mimeType: string,
  cfg: ConfigVisao = configVisao(),
): { ok: true; bloco: BlocoImagem; bytes: number } | { ok: false; motivo: string } {
  const mime = mimeType.toLowerCase().split(";")[0].trim()
  if (!IMAGENS_ACEITAS.has(mime)) {
    return { ok: false, motivo: `Tipo não aceito para leitura (${mime || "desconhecido"}). Envie PNG, JPEG ou WebP.` }
  }

  let bytes: Buffer
  try {
    bytes = Buffer.from(base64, "base64")
  } catch {
    return { ok: false, motivo: "A imagem não está em base64 válido." }
  }
  if (bytes.length === 0) return { ok: false, motivo: "A imagem chegou vazia." }
  if (bytes.length > cfg.maxBytesImagem) {
    const mb = (cfg.maxBytesImagem / (1024 * 1024)).toFixed(1)
    return { ok: false, motivo: `Imagem acima do limite de ${mb} MB. Reduza a resolução e tente de novo.` }
  }
  if (!assinaturaConfere(bytes, mime)) {
    return { ok: false, motivo: "O conteúdo do arquivo não corresponde ao tipo declarado." }
  }
  return { ok: true, bloco: { type: "image", source: { type: "base64", media_type: mime, data: base64 } }, bytes: bytes.length }
}

function assinaturaConfere(b: Buffer, mime: string): boolean {
  if (b.length < 12) return false
  if (mime === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8
  if (mime === "image/png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  if (mime === "image/webp") {
    return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42
  }
  return false
}

// ---------------------------------------------------------------- portão

/**
 * Portão simples: no máximo N chamadas em voo. Vive no módulo porque a
 * instância serverless é reusada entre requisições — é o mesmo processo que
 * precisa se conter.
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

// ---------------------------------------------------------------- custo

export interface CustoChamada {
  tokensEntrada: number
  tokensSaida: number
  custoUsd: number
}

function custoDe(entrada: number, saida: number): number {
  const p = tabelaDePreco()
  return (entrada / 1_000_000) * p.entrada + (saida / 1_000_000) * p.saida
}

/**
 * Pior caso desta chamada, em dólares, ANTES de fazê-la: entrada estimada pelo
 * teto de tokens de imagem + texto, saída pelo `max_tokens` inteiro.
 */
export function piorCustoPossivel(cfg: ConfigVisao): number {
  return custoDe(TOKENS_IMAGEM_TETO + TOKENS_TEXTO_TETO, cfg.maxTokens)
}

// ---------------------------------------------------------------- a chamada

export interface PedidoVisao {
  sistema: string
  blocos: Array<BlocoImagem | { type: "text"; text: string }>
  /** JSON Schema do retorno — a API constrange a saída a ele. */
  esquema: unknown
  /** Só para log. Nunca conteúdo. */
  referencia?: string
}

export type RespostaVisao =
  | { ok: true; json: unknown; custo: CustoChamada; tentativasFeitas: number }
  | { ok: false; motivo: string; permanente: boolean; tentativasFeitas: number }

/** Transporte injetável — permite provar retry/timeout/teto sem tocar na rede. */
export type Transporte = (url: string, init: RequestInit) => Promise<Response>

let transporteAtual: Transporte | null = null
/** Só para teste. Em produção nunca é chamado. */
export function definirTransporte(t: Transporte | null): void {
  transporteAtual = t
}

const ESPERA_BASE_MS = 600

export async function chamarVisao(pedido: PedidoVisao, cfg: ConfigVisao = configVisao()): Promise<RespostaVisao> {
  const credencial = chaveConfigurada()
  if (!credencial.ok) return { ok: false, motivo: credencial.motivo, permanente: true, tentativasFeitas: 0 }

  // Teto conferido ANTES de gastar. Depois do gasto seria relatório, não teto.
  const pior = piorCustoPossivel(cfg)
  if (cfg.tetoUsd > 0 && pior > cfg.tetoUsd) {
    return {
      ok: false,
      permanente: true,
      tentativasFeitas: 0,
      motivo:
        `Configuração excede o teto de custo por leitura (pior caso US$ ${pior.toFixed(3)} > teto US$ ${cfg.tetoUsd}). ` +
        "Nenhuma chamada foi feita. Reduza ARVORE_VISAO_MAX_TOKENS ou aumente ARVORE_VISAO_TETO_USD.",
    }
  }

  const corpo = JSON.stringify({
    model: cfg.modelo,
    max_tokens: cfg.maxTokens,
    system: pedido.sistema,
    messages: [{ role: "user", content: pedido.blocos }],
    output_config: {
      effort: cfg.esforco,
      format: { type: "json_schema", schema: pedido.esquema },
    },
  })

  const executar = transporteAtual ?? ((url: string, init: RequestInit) => fetch(url, init))
  const g = portaoAtual(cfg.concorrencia)
  await g.entrar()
  const inicio = Date.now()
  const restante = () => cfg.prazoTotalMs - (Date.now() - inicio)

  try {
    let ultimoMotivo = "Falha desconhecida ao chamar o serviço de leitura."
    for (let tentativa = 1; tentativa <= cfg.tentativas; tentativa++) {
      // Prazo global: uma tentativa que não cabe no que sobrou não é iniciada —
      // começar para ser abortada em 2s só atrasa a mensagem de erro.
      const janela = Math.min(cfg.timeoutMs, restante())
      if (janela < 5_000) {
        return { ok: false, motivo: `${ultimoMotivo} (prazo da requisição esgotado)`, permanente: false, tentativasFeitas: tentativa - 1 }
      }

      const controle = new AbortController()
      const relogio = setTimeout(() => controle.abort(), janela)
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
          const bruto = await lerLimitado(res, cfg.maxBytesResposta)
          if (!bruto.ok) return { ok: false, motivo: bruto.motivo, permanente: true, tentativasFeitas: tentativa }

          let dados: {
            content?: Array<{ type: string; text?: string }>
            usage?: { input_tokens?: number; output_tokens?: number }
            stop_reason?: string
          }
          try {
            dados = JSON.parse(bruto.texto)
          } catch {
            return { ok: false, motivo: "A resposta do serviço não é JSON.", permanente: true, tentativasFeitas: tentativa }
          }

          const tokensEntrada = dados.usage?.input_tokens ?? 0
          const tokensSaida = dados.usage?.output_tokens ?? 0
          const custo: CustoChamada = {
            tokensEntrada,
            tokensSaida,
            custoUsd: Math.round(custoDe(tokensEntrada, tokensSaida) * 10_000) / 10_000,
          }
          registrar("info", "visao_ok", {
            referencia: pedido.referencia ?? null,
            tentativa,
            tokensEntrada,
            tokensSaida,
            custoUsd: custo.custoUsd,
            stopReason: dados.stop_reason ?? null,
          })

          // Resposta cortada pelo teto de tokens: o JSON está truncado e o
          // parse abaixo falharia com mensagem obscura. Nomear a causa aqui
          // poupa o operador de adivinhar por que "a IA não leu".
          if (dados.stop_reason === "max_tokens") {
            return {
              ok: false,
              permanente: true,
              tentativasFeitas: tentativa,
              motivo:
                `A leitura passou do teto de ${cfg.maxTokens} tokens de resposta e foi cortada. ` +
                "A árvore da imagem provavelmente é grande demais: importe em partes ou aumente ARVORE_VISAO_MAX_TOKENS.",
            }
          }
          if (dados.stop_reason === "refusal") {
            return {
              ok: false,
              permanente: true,
              tentativasFeitas: tentativa,
              motivo: "O serviço recusou processar esta imagem. Confira se o print é mesmo de uma árvore genealógica.",
            }
          }

          const texto = (dados.content ?? []).find((c) => c.type === "text")?.text
          if (!texto) {
            return { ok: false, motivo: "A resposta não trouxe conteúdo de texto.", permanente: true, tentativasFeitas: tentativa }
          }
          try {
            return { ok: true, json: JSON.parse(texto), custo, tentativasFeitas: tentativa }
          } catch {
            return {
              ok: false,
              motivo: "A resposta não é JSON válido apesar do esquema declarado.",
              permanente: true,
              tentativasFeitas: tentativa,
            }
          }
        }

        // ── erro HTTP ────────────────────────────────────────────────────────
        const permanente = res.status !== 429 && res.status < 500
        ultimoMotivo = await motivoDoErro(res)
        registrar("warn", "visao_erro_http", {
          referencia: pedido.referencia ?? null,
          status: res.status,
          tentativa,
          permanente,
        })
        if (permanente) return { ok: false, motivo: ultimoMotivo, permanente: true, tentativasFeitas: tentativa }
        if (tentativa < cfg.tentativas) await esperar(Math.min(esperaDe(res, tentativa), Math.max(restante() - 5_000, 0)))
      } catch (e) {
        const abortado = e instanceof Error && e.name === "AbortError"
        // A MENSAGEM CONTA O TEMPO TOTAL, NÃO O DA ÚLTIMA JANELA. Dizer "passou
        // de 6s" quando a tentativa anterior já tinha queimado 45s faz o
        // usuário procurar um defeito instantâneo que não existe.
        const gastoS = Math.round((Date.now() - inicio) / 1000)
        ultimoMotivo = abortado
          ? `A leitura foi interrompida após ${gastoS}s (tentativa ${tentativa} de ${cfg.tentativas}, janela de ${Math.round(janela / 1000)}s). ` +
            `Imagem muito grande ou serviço lento — tente recortar o print ou reenviar.`
          : `Falha de rede ao chamar o serviço de leitura: ${e instanceof Error ? e.message : String(e)}`
        registrar("warn", "visao_falha_rede", { referencia: pedido.referencia ?? null, tentativa, abortado })
        if (tentativa < cfg.tentativas) {
          await esperar(Math.min(ESPERA_BASE_MS * 2 ** (tentativa - 1), Math.max(restante() - 5_000, 0)))
        }
      } finally {
        clearTimeout(relogio)
      }
    }
    return { ok: false, motivo: ultimoMotivo, permanente: false, tentativasFeitas: cfg.tentativas }
  } finally {
    g.sair()
  }
}

/**
 * Lê o corpo com teto de bytes. `res.json()` leria tudo: um corpo anômalo (ou
 * um intermediário mal-comportado) viraria uma string de centenas de MB dentro
 * da função. Aqui o excesso é cortado e vira erro nomeado.
 */
async function lerLimitado(res: Response, maxBytes: number): Promise<{ ok: true; texto: string } | { ok: false; motivo: string }> {
  const excedeu = { ok: false as const, motivo: `A resposta passou do limite de ${Math.round(maxBytes / 1024)} KB e foi descartada.` }

  const corpo = res.body
  if (!corpo) {
    const texto = await res.text()
    return Buffer.byteLength(texto, "utf8") > maxBytes ? excedeu : { ok: true, texto }
  }

  const leitor = corpo.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await leitor.cancel().catch(() => {})
        return excedeu
      }
      partes.push(value)
    }
  } finally {
    leitor.releaseLock()
  }
  return { ok: true, texto: Buffer.concat(partes).toString("utf8") }
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
            ? "imagem grande demais para uma requisição"
            : res.status >= 500
              ? "falha temporária do serviço"
              : "requisição recusada"
  return `Leitura por IA falhou (${res.status} · ${rotulo})${detalhe ? `: ${detalhe.slice(0, 200)}` : "."}`
}

function esperaDe(res: Response, tentativa: number): number {
  const segundos = Number(res.headers?.get?.("retry-after"))
  if (Number.isFinite(segundos) && segundos > 0) return Math.min(segundos * 1000, 20_000)
  return Math.min(ESPERA_BASE_MS * 2 ** (tentativa - 1), 8_000)
}

function esperar(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms))
}

/** Log estruturado. O contrato é o mesmo do cliente original: nunca conteúdo. */
function registrar(nivel: "info" | "warn", evento: string, dados: Record<string, unknown>): void {
  const linha = { evento, ...dados }
  if (nivel === "warn") console.warn("[importar-arvore][visao]", linha)
  else console.info("[importar-arvore][visao]", linha)
}
