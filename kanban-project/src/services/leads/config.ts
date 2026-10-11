// src/services/leads/config.ts
// ============================================================================
// CONFIGURAÇÃO DO MÓDULO DE LEADS — docs/leads-mandato.md §7 e regra 18.
//
// Tudo é lido de `process.env` NA HORA do uso, nunca no import: o gate do build roda sem estas
// variáveis e nenhum arquivo do módulo pode falhar ao ser importado sem elas. Sem as chaves do
// WhatsApp, `configuracaoDoWhatsApp()` devolve `null` e nada do módulo roda.
// ============================================================================

export interface ConfiguracaoDoWhatsApp {
  token: string
  telefoneId: string
  verifyToken: string
  appSecret: string
  versaoApi: string
}

export interface ConfiguracaoDoAgente {
  nome: string
  fuso: string
  /** Quanto esperar depois da última mensagem do lead antes de responder (regra 11). */
  esperaMs: number
  /** Ritmo de digitação: pausa antes de cada mensagem enviada (regra 12). */
  digitacaoBaseMs: number
  digitacaoPorLetraMs: number
  digitacaoMaxMs: number
  /** De quanto em quanto tempo uma chamada confere se a outra, que está respondendo, já soltou a conversa. */
  repeticaoDaTravaMs: number
  /** Modo de teste (regra 17): com telefones aqui, o agente só responde a eles. */
  soAtender: Set<string>
}

export interface ConfiguracaoDaIA {
  chave: string
  modelo: string
}

const limpo = (v: string | undefined) => (v ?? "").trim()

/** `null` quando falta qualquer uma das quatro chaves: o módulo fica desligado. */
export function configuracaoDoWhatsApp(env: NodeJS.ProcessEnv = process.env): ConfiguracaoDoWhatsApp | null {
  const token = limpo(env.WHATSAPP_TOKEN)
  const telefoneId = limpo(env.WHATSAPP_PHONE_ID)
  const verifyToken = limpo(env.WHATSAPP_VERIFY_TOKEN)
  const appSecret = limpo(env.WHATSAPP_APP_SECRET)
  if (!token || !telefoneId || !verifyToken || !appSecret) return null
  return { token, telefoneId, verifyToken, appSecret, versaoApi: limpo(env.WHATSAPP_API_VERSAO) || "v25.0" }
}

/**
 * O WhatsApp às vezes entrega o celular brasileiro sem o nono dígito. Esta chave iguala as duas
 * formas, para a lista do modo de teste casar com o número que a Meta manda.
 */
export function chaveDoTelefone(telefone: string): string {
  let n = String(telefone || "").replace(/\D/g, "")
  if (n.length === 10 || n.length === 11) n = "55" + n
  if (n.startsWith("55") && n.length === 13 && n[4] === "9") n = n.slice(0, 4) + n.slice(5)
  return n
}

export function configuracaoDoAgente(env: NodeJS.ProcessEnv = process.env): ConfiguracaoDoAgente {
  const soAtender = new Set(
    limpo(env.LEADS_SO_ATENDER).split(",").map(chaveDoTelefone).filter((n) => n.length >= 10),
  )
  return {
    nome: limpo(env.LEADS_NOME_AGENTE) || "Marco",
    fuso: "America/Sao_Paulo",
    esperaMs: 6000,
    digitacaoBaseMs: 900,
    digitacaoPorLetraMs: 45,
    digitacaoMaxMs: 6000,
    repeticaoDaTravaMs: 3000,
    soAtender,
  }
}

/**
 * `LEADS_SO_ATENDER` preenchido mas sem nenhum telefone válido é erro de digitação, não "atender todo
 * mundo": nesse caso o módulo se recusa a responder a quem quer que seja.
 */
export function modoDeTesteInvalido(env: NodeJS.ProcessEnv = process.env): boolean {
  return limpo(env.LEADS_SO_ATENDER) !== "" && configuracaoDoAgente(env).soAtender.size === 0
}

/** A IA usa a mesma chave que o sistema já tem para a leitura de árvore por foto. */
export function configuracaoDaIA(env: NodeJS.ProcessEnv = process.env): ConfiguracaoDaIA | null {
  const chave = limpo(env.ANTHROPIC_API_KEY)
  if (!chave) return null
  return { chave, modelo: limpo(env.LEADS_MODELO) || "claude-sonnet-5-5" }
}
