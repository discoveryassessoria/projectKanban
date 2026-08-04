// src/lib/process-stage/andamento-etapa.ts
//
// ANDAMENTO OPERACIONAL DE UMA ETAPA — domínio PURO (sem prisma, sem React).
//
// ONDE ISSO MORA
// --------------
// Na estrutura por-etapa que o projeto JÁ tem: `PhaseWorkflowStepInstance.metadata.operacao`.
// É o payload operacional oficial do passo — o mesmo lugar onde já vivem
// trackingCode, externalProtocol, requestChannel, reviewChecklist etc. Não nasce
// tabela nova, não nasce entidade exclusiva de "aguardar retorno", e não existe
// segunda fonte de verdade: o passo continua sendo o estado, a tarefa continua
// sendo projeção dele.
//
// O QUE ESTE ARQUIVO ACRESCENTA
// -----------------------------
// Três COLEÇÕES APPEND-ONLY dentro desse payload — contatos, observações e
// anexos — com FORMATO VALIDADO. O histórico de contatos vivia como texto
// corrido dentro de `notes`, com parsing por regex: um contato podia ser
// sobrescrito por qualquer edição da nota, não tinha autor, e "quem registrou"
// simplesmente não existia. Aqui cada registro é uma entrada imutável, com autor
// e carimbo de tempo, e nada apaga o que já foi registrado.
//
// IDEMPOTÊNCIA
// ------------
// Cada entrada carrega uma `chave` derivada do conteúdo + do autor. Reenviar a
// mesma entrada (duplo clique, retry de rede) NÃO cria um segundo registro — o
// append é uma união por chave, não um push cego.

// ── Canal do contato: dimensão FECHADA de domínio (não é cadastro mestre) ─────
export const CANAIS_CONTATO = [
  "LIGACAO",
  "EMAIL",
  "WHATSAPP",
  "PRESENCIAL",
  "PORTAL",
  "CORREIOS",
  "OUTRO",
] as const
export type CanalContato = (typeof CANAIS_CONTATO)[number]

/** Desfecho do contato — o que a etapa aprendeu com ele. */
export const RESULTADOS_CONTATO = [
  "SEM_RESPOSTA",
  "EM_ANALISE",
  "PRAZO_INFORMADO",
  "EXIGENCIA",
  "PRONTO_PARA_RETIRADA",
  "RETORNO_RECEBIDO",
  "OUTRO",
] as const
export type ResultadoContato = (typeof RESULTADOS_CONTATO)[number]

export interface ContatoEtapa {
  chave: string
  registradoEm: string // ISO — quando o registro entrou no sistema
  ocorridoEm: string // ISO — quando o contato aconteceu de fato
  autorId: number | null
  canal: CanalContato
  destinatario: string | null
  resultado: ResultadoContato
  observacao: string | null
  proximoAcompanhamento: string | null // ISO date (YYYY-MM-DD)
  anexoUrl: string | null
  anexoNome: string | null
}

export interface ObservacaoEtapa {
  chave: string
  registradoEm: string
  autorId: number | null
  texto: string
}

export interface AnexoEtapa {
  chave: string
  registradoEm: string
  autorId: number | null
  url: string
  nome: string
  tipo: string | null
  tamanho: number | null
}

/** Campos de acompanhamento da espera. Todos OPCIONAIS: salvar andamento nunca exige formulário completo. */
export interface CamposAcompanhamento {
  prazoEstimadoDias: number | null
  previsaoRetorno: string | null // ISO date
  proximoAcompanhamento: string | null // ISO date
  destinatario: string | null
  canalPreferencial: CanalContato | null
  semRetornoDesde: string | null // ISO date — marcação explícita de ausência de retorno
}

export interface AndamentoEtapa extends CamposAcompanhamento {
  contatos: ContatoEtapa[]
  observacoes: ObservacaoEtapa[]
  anexos: AnexoEtapa[]
}

export const ANDAMENTO_VAZIO: AndamentoEtapa = {
  prazoEstimadoDias: null,
  previsaoRetorno: null,
  proximoAcompanhamento: null,
  destinatario: null,
  canalPreferencial: null,
  semRetornoDesde: null,
  contatos: [],
  observacoes: [],
  anexos: [],
}

// ── Leitores tolerantes ──────────────────────────────────────────────────────

function str(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function inteiroNaoNegativo(v: unknown): number | null {
  const n = num(v)
  if (n === null) return null
  const i = Math.trunc(n)
  return i >= 0 ? i : null
}

/** ISO date (YYYY-MM-DD). Qualquer coisa fora disso vira null — nunca lança. */
export function dataIso(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** Instante ISO completo. */
export function instanteIso(v: unknown, fallback: string): string {
  const s = str(v)
  if (!s) return fallback
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return fallback
  return d.toISOString()
}

function ehCanal(v: unknown): v is CanalContato {
  return typeof v === "string" && (CANAIS_CONTATO as readonly string[]).includes(v)
}

function ehResultado(v: unknown): v is ResultadoContato {
  return typeof v === "string" && (RESULTADOS_CONTATO as readonly string[]).includes(v)
}

/** Hash estável e curto de um texto — base das chaves de idempotência. */
export function chaveDeConteudo(partes: Array<string | number | null>): string {
  const base = partes.map((p) => (p === null ? "" : String(p))).join("|")
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 16)
}

// ── Desserialização do payload gravado ───────────────────────────────────────

function lerContato(v: unknown): ContatoEtapa | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  const canal = ehCanal(o.canal) ? o.canal : "OUTRO"
  const resultado = ehResultado(o.resultado) ? o.resultado : "OUTRO"
  const ocorridoEm = instanteIso(o.ocorridoEm, instanteIso(o.registradoEm, new Date(0).toISOString()))
  const registradoEm = instanteIso(o.registradoEm, ocorridoEm)
  const autorId = num(o.autorId)
  const observacao = str(o.observacao)
  const chave =
    str(o.chave) ??
    chaveDeConteudo(["contato", ocorridoEm.slice(0, 16), canal, resultado, observacao, autorId])
  return {
    chave,
    registradoEm,
    ocorridoEm,
    autorId,
    canal,
    destinatario: str(o.destinatario),
    resultado,
    observacao,
    proximoAcompanhamento: dataIso(o.proximoAcompanhamento),
    anexoUrl: str(o.anexoUrl),
    anexoNome: str(o.anexoNome),
  }
}

function lerObservacao(v: unknown): ObservacaoEtapa | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  const texto = str(o.texto)
  if (!texto) return null
  const registradoEm = instanteIso(o.registradoEm, new Date(0).toISOString())
  const autorId = num(o.autorId)
  return {
    chave: str(o.chave) ?? chaveDeConteudo(["obs", texto, autorId, registradoEm.slice(0, 16)]),
    registradoEm,
    autorId,
    texto,
  }
}

function lerAnexo(v: unknown): AnexoEtapa | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  const url = str(o.url)
  if (!url) return null
  const registradoEm = instanteIso(o.registradoEm, new Date(0).toISOString())
  return {
    // A chave de um anexo é a URL: reenviar o MESMO arquivo (retry) não duplica a linha.
    chave: str(o.chave) ?? chaveDeConteudo(["anexo", url]),
    registradoEm,
    autorId: num(o.autorId),
    url,
    nome: str(o.nome) ?? url.split("/").pop() ?? "arquivo",
    tipo: str(o.tipo),
    tamanho: num(o.tamanho),
  }
}

function lista<T>(v: unknown, ler: (x: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return []
  const out: T[] = []
  for (const item of v) {
    const lido = ler(item)
    if (lido) out.push(lido)
  }
  return out
}

/** Lê o andamento gravado em `metadata.operacao`. Nunca lança; ausência = vazio. */
export function lerAndamento(operacao: unknown): AndamentoEtapa {
  if (!operacao || typeof operacao !== "object") return { ...ANDAMENTO_VAZIO }
  const o = operacao as Record<string, unknown>
  return {
    prazoEstimadoDias: inteiroNaoNegativo(o.prazoEstimadoDias),
    previsaoRetorno: dataIso(o.previsaoRetorno),
    proximoAcompanhamento: dataIso(o.proximoAcompanhamento),
    destinatario: str(o.destinatario),
    canalPreferencial: ehCanal(o.canalPreferencial) ? o.canalPreferencial : null,
    semRetornoDesde: dataIso(o.semRetornoDesde),
    contatos: ordenarPorTempo(lista(o.contatos, lerContato)),
    observacoes: lista(o.observacoes, lerObservacao).sort((a, b) =>
      a.registradoEm.localeCompare(b.registradoEm),
    ),
    anexos: lista(o.anexos, lerAnexo).sort((a, b) => a.registradoEm.localeCompare(b.registradoEm)),
  }
}

function ordenarPorTempo(cs: ContatoEtapa[]): ContatoEtapa[] {
  return [...cs].sort((a, b) => a.ocorridoEm.localeCompare(b.ocorridoEm))
}

// ── Entrada crua vinda da requisição ─────────────────────────────────────────

export interface EntradaAndamento {
  campos?: Partial<Record<keyof CamposAcompanhamento, unknown>>
  contato?: unknown
  observacao?: unknown
  anexos?: unknown
}

export interface ContextoAndamento {
  autorId: number | null
  agora: Date
}

export interface ResultadoAplicacao {
  andamento: AndamentoEtapa
  /** O que de fato mudou — vai para a auditoria e permite detectar no-op. */
  mudou: { campos: boolean; contato: boolean; observacao: boolean; anexos: number }
  erros: string[]
}

/**
 * Aplica uma entrada sobre o andamento atual. FUNÇÃO PURA: recebe o estado
 * gravado, devolve o novo estado. Append-only por construção — nenhuma
 * ramificação remove ou reescreve entrada existente.
 */
export function aplicarAndamento(
  atual: AndamentoEtapa,
  entrada: EntradaAndamento,
  ctx: ContextoAndamento,
): ResultadoAplicacao {
  const erros: string[] = []
  const agoraIso = ctx.agora.toISOString()
  const proximo: AndamentoEtapa = {
    ...atual,
    contatos: [...atual.contatos],
    observacoes: [...atual.observacoes],
    anexos: [...atual.anexos],
  }
  const mudou = { campos: false, contato: false, observacao: false, anexos: 0 }

  // 1) CAMPOS — só o que veio na requisição é tocado. `null` explícito LIMPA;
  //    ausência PRESERVA. Salvar andamento nunca exige preencher tudo.
  const campos = entrada.campos
  if (campos && typeof campos === "object") {
    if ("prazoEstimadoDias" in campos) {
      const v = campos.prazoEstimadoDias === null ? null : inteiroNaoNegativo(campos.prazoEstimadoDias)
      if (campos.prazoEstimadoDias != null && v === null) erros.push("PRAZO_ESTIMADO_INVALIDO")
      else if (v !== proximo.prazoEstimadoDias) { proximo.prazoEstimadoDias = v; mudou.campos = true }
    }
    for (const chave of ["previsaoRetorno", "proximoAcompanhamento", "semRetornoDesde"] as const) {
      if (chave in campos) {
        const bruto = campos[chave]
        const v = bruto === null ? null : dataIso(bruto)
        if (bruto != null && v === null) erros.push(`DATA_INVALIDA:${chave}`)
        else if (v !== proximo[chave]) { proximo[chave] = v; mudou.campos = true }
      }
    }
    if ("destinatario" in campos) {
      const v = campos.destinatario === null ? null : str(campos.destinatario)
      if (v !== proximo.destinatario) { proximo.destinatario = v; mudou.campos = true }
    }
    if ("canalPreferencial" in campos) {
      const bruto = campos.canalPreferencial
      const v = bruto === null || bruto === "" ? null : ehCanal(bruto) ? bruto : undefined
      if (v === undefined) erros.push("CANAL_INVALIDO")
      else if (v !== proximo.canalPreferencial) { proximo.canalPreferencial = v; mudou.campos = true }
    }
  }

  // 2) CONTATO — entrada nova no histórico. Nunca substitui a anterior.
  if (entrada.contato != null) {
    const c = entrada.contato as Record<string, unknown>
    const canal = ehCanal(c.canal) ? c.canal : null
    if (!canal) erros.push("CANAL_INVALIDO")
    const resultado = ehResultado(c.resultado) ? c.resultado : "OUTRO"
    const observacao = str(c.observacao)
    const ocorridoEm = instanteIso(c.ocorridoEm, agoraIso)
    if (ocorridoEm > agoraIso) erros.push("CONTATO_NO_FUTURO")
    const proxAcomp = c.proximoAcompanhamento == null ? null : dataIso(c.proximoAcompanhamento)
    if (c.proximoAcompanhamento != null && proxAcomp === null) erros.push("DATA_INVALIDA:proximoAcompanhamento")
    if (canal && erros.length === 0) {
      // Chave de idempotência: o cliente pode mandar a sua; senão, derivamos do
      // conteúdo + autor + minuto. Duplo clique cai na MESMA chave e não duplica.
      const chave =
        str(c.chaveIdempotencia) ??
        chaveDeConteudo(["contato", ocorridoEm.slice(0, 16), canal, resultado, observacao, ctx.autorId])
      if (!proximo.contatos.some((x) => x.chave === chave)) {
        proximo.contatos.push({
          chave,
          registradoEm: agoraIso,
          ocorridoEm,
          autorId: ctx.autorId,
          canal,
          destinatario: str(c.destinatario) ?? proximo.destinatario,
          resultado,
          observacao,
          proximoAcompanhamento: proxAcomp,
          anexoUrl: str(c.anexoUrl),
          anexoNome: str(c.anexoNome),
        })
        proximo.contatos = ordenarPorTempo(proximo.contatos)
        mudou.contato = true
        // O contato mais recente que informa acompanhamento move a agenda da etapa.
        if (proxAcomp) { proximo.proximoAcompanhamento = proxAcomp; mudou.campos = true }
        // Retorno recebido encerra a marcação de ausência de retorno.
        if (resultado === "RETORNO_RECEBIDO" && proximo.semRetornoDesde) {
          proximo.semRetornoDesde = null
          mudou.campos = true
        }
      }
    }
  }

  // 3) OBSERVAÇÃO — append. Não sobrescreve as anteriores.
  if (entrada.observacao != null) {
    const bruto = entrada.observacao as Record<string, unknown> | string
    const texto = typeof bruto === "string" ? str(bruto) : str(bruto?.texto)
    const chaveCliente = typeof bruto === "string" ? null : str(bruto?.chaveIdempotencia)
    if (!texto) erros.push("OBSERVACAO_VAZIA")
    else {
      const chave = chaveCliente ?? chaveDeConteudo(["obs", texto, ctx.autorId, agoraIso.slice(0, 16)])
      if (!proximo.observacoes.some((x) => x.chave === chave)) {
        proximo.observacoes.push({ chave, registradoEm: agoraIso, autorId: ctx.autorId, texto })
        mudou.observacao = true
      }
    }
  }

  // 4) ANEXOS — append, deduplicado por URL (retry de upload não duplica linha).
  if (entrada.anexos != null) {
    const brutos = Array.isArray(entrada.anexos) ? entrada.anexos : [entrada.anexos]
    for (const a of brutos) {
      const o = (a ?? {}) as Record<string, unknown>
      const url = str(o.url)
      if (!url) { erros.push("ANEXO_SEM_URL"); continue }
      const chave = chaveDeConteudo(["anexo", url])
      if (proximo.anexos.some((x) => x.chave === chave)) continue
      proximo.anexos.push({
        chave,
        registradoEm: agoraIso,
        autorId: ctx.autorId,
        url,
        nome: str(o.nome) ?? url.split("/").pop() ?? "arquivo",
        tipo: str(o.tipo),
        tamanho: num(o.tamanho),
      })
      mudou.anexos++
    }
  }

  return { andamento: erros.length ? atual : proximo, mudou, erros }
}

/**
 * Serializa o andamento de volta para `metadata.operacao`, PRESERVANDO todo o
 * resto do payload (trackingCode, externalProtocol, reviewChecklist, …). Esta
 * função nunca descarta chave que não conhece.
 */
export function gravarAndamento(
  operacaoAtual: Record<string, unknown>,
  andamento: AndamentoEtapa,
): Record<string, unknown> {
  return {
    ...operacaoAtual,
    prazoEstimadoDias: andamento.prazoEstimadoDias,
    previsaoRetorno: andamento.previsaoRetorno,
    proximoAcompanhamento: andamento.proximoAcompanhamento,
    destinatario: andamento.destinatario,
    canalPreferencial: andamento.canalPreferencial,
    semRetornoDesde: andamento.semRetornoDesde,
    contatos: andamento.contatos,
    observacoes: andamento.observacoes,
    anexos: andamento.anexos,
  }
}

/**
 * Data prevista de retorno DERIVADA quando não foi informada explicitamente:
 * início da espera + prazo estimado. Derivação, não persistência — se o operador
 * informar a previsão, a informada manda.
 */
export function previsaoEfetiva(
  andamento: AndamentoEtapa,
  inicioEspera: Date | null,
): string | null {
  if (andamento.previsaoRetorno) return andamento.previsaoRetorno
  if (!inicioEspera || andamento.prazoEstimadoDias == null) return null
  const d = new Date(inicioEspera.getTime() + andamento.prazoEstimadoDias * 86400000)
  return d.toISOString().slice(0, 10)
}
