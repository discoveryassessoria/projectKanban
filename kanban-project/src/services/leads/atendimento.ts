// src/services/leads/atendimento.ts
// ============================================================================
// O ATENDIMENTO DO AGENTE DE LEADS — docs/leads-mandato.md, regras 6 a 18.
//
// ÚNICO DONO DE ESCRITA de `LeadConversa` e `LeadMensagem` (CLAUDE.md §23). Recebe o que o lead
// mandou, espera ele terminar de escrever, pede a resposta à IA, envia no ritmo de uma pessoa e, na
// hora certa, passa a conversa adiante.
//
// LEAD NÃO É TAREFA (CLAUDE.md §1, §5): grain = LEAD, um por telefone. Nada aqui lê ou escreve
// Processo, Tarefa, Pessoa, Documento nem cadastro de cliente.
//
// Roda dentro de função serverless, depois da resposta do webhook (`after()`), e cada mensagem do lead
// é uma chamada separada. Por isso:
//   · a mensagem é gravada ANTES de qualquer espera — nada se perde se a função morrer;
//   · `LeadMensagem.wamid` único impede responder duas vezes a mesma mensagem que a Meta reentrega;
//   · `LeadConversa.processandoAte` é a trava: só uma chamada responde a conversa de cada vez;
//   · nenhuma transação fica aberta durante espera, IA ou envio (o pool é de 5 conexões por instância);
//   · a decisão é gravada ANTES do envio: se a função morrer no meio, o lead não recebe a mesma
//     resposta duas vezes; o que ficou sem resposta é retomado por `retomarConversasParadas` (cron).
// ============================================================================
import { Prisma } from "@prisma/client"
import { avisarLeadAguardando, retirarAvisoDeLead } from "@/lib/operacional/avisos-fatos"
import { prisma } from "@/lib/prisma"
import { chaveDoTelefone, configuracaoDaIA, configuracaoDoAgente, configuracaoDoWhatsApp, modoDeTesteInvalido, type ConfiguracaoDoAgente } from "./config"
import { criarIA, type IA, type RespostaDoAgente, type TurnoDaConversa } from "./ia"
import { instrucaoDaHora, instrucoesFixas } from "./instrucoes"
import { usuariosQueAtendemLeads } from "./destinatarios"
import { podeResponderAoLead } from "./situacao"
import { criarWhatsApp, type EventoDoLead, type WhatsApp } from "./whatsapp"

/** A resposta de quem não pode responder (regras 7, 13 e 14). */
export const FRASE_DE_ESPERA = "Um momento, por favor."

/** Por quanto tempo uma chamada segura a conversa. Maior que o `maxDuration` do webhook. */
const TRAVA_MS = 150_000
/** Quantas vezes a resposta é refeita porque o lead continuou escrevendo (regra 11). */
const MAX_REFEITAS = 2
/** Conversa parada há menos que isto ainda pode estar sendo respondida pela própria chamada do webhook. */
const PARADA_HA_MS = 60_000
/**
 * Teto de respostas do agente numa mesma conversa. Uma triagem usa de 8 a 15; acima disto a conversa
 * deixou de ser triagem (ou alguém está só conversando com o agente) e cada resposta custa: passa para
 * uma pessoa.
 */
export const MAX_RESPOSTAS_DO_AGENTE = 30
/** O que fica registrado quando uma pessoa assume a conversa respondendo pela tela. */
export const MOTIVO_ASSUMIDO_PELA_TELA = "Assumido pela tela de Leads"

export interface Dependencias {
  whats: WhatsApp
  /** `null` quando a chave da IA não está configurada: o lead vai direto para uma pessoa. */
  ia: IA | null
  agente: ConfiguracaoDoAgente
  esperar: (ms: number) => Promise<void>
  agora: () => Date
  registrar: { error: (...args: unknown[]) => void }
}

/** Monta as dependências reais a partir do ambiente. `null` = módulo desligado (regra 18). */
export function dependenciasReais(): Dependencias | null {
  const whatsApp = configuracaoDoWhatsApp()
  if (!whatsApp || modoDeTesteInvalido()) return null
  const ia = configuracaoDaIA()
  return {
    whats: criarWhatsApp(whatsApp),
    ia: ia ? criarIA(ia) : null,
    agente: configuracaoDoAgente(),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    agora: () => new Date(),
    registrar: console,
  }
}

/** Hora no fuso do escritório, no formato 14:05. */
export function horaLocal(fuso: string, data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(data)
}

export function saudacao(hora: string): string {
  const h = Number(hora.slice(0, 2))
  if (h >= 5 && h < 12) return "bom dia"
  if (h >= 12 && h < 18) return "boa tarde"
  return "boa noite"
}

const ROTULO_DO_ARQUIVO: Record<string, string> = { audio: "áudio", image: "foto", document: "documento", video: "vídeo" }
const rotuloDoArquivo = (midiaTipo: string | null) => ROTULO_DO_ARQUIVO[midiaTipo ?? ""] ?? "arquivo"

function lerTurnos(contexto: Prisma.JsonValue | null): TurnoDaConversa[] {
  if (!Array.isArray(contexto)) return []
  const turnos: TurnoDaConversa[] = []
  for (const t of contexto) {
    if (!t || typeof t !== "object" || Array.isArray(t)) continue
    const { role, content } = t
    if ((role === "user" || role === "assistant") && typeof content === "string") turnos.push({ role, content })
  }
  return turnos
}

function lerFicha(ficha: Prisma.JsonValue | null): Record<string, string> {
  const saida: Record<string, string> = {}
  if (ficha && typeof ficha === "object" && !Array.isArray(ficha)) {
    for (const [campo, valor] of Object.entries(ficha)) if (typeof valor === "string") saida[campo] = valor
  }
  return saida
}

const json = (v: unknown) => v as Prisma.InputJsonValue
const ehDuplicata = (e: unknown) => (e as { code?: string })?.code === "P2002"

/**
 * Avisa no sino quem atende leads (regra 27). Aviso é consequência, nunca fonte de verdade: se falhar,
 * a conversa já está gravada e aparece na tela do mesmo jeito — por isso nunca derruba o atendimento.
 */
async function avisarQuemAtende(conversaId: number, deps: Dependencias): Promise<void> {
  try {
    for (const destinatarioId of await usuariosQueAtendemLeads()) {
      await avisarLeadAguardando(prisma, { destinatarioId, conversaId })
    }
  } catch (e) {
    deps.registrar.error(`[leads] aviso do sino não gravado para a conversa ${conversaId}:`, e instanceof Error ? e.message : e)
  }
}

/** O lead deixou de aguardar resposta: sai do aviso do sino. Mesma regra do aviso — nunca derruba o ato. */
async function tirarDoAviso(conversaId: number): Promise<void> {
  try {
    await retirarAvisoDeLead(prisma, conversaId)
  } catch (e) {
    console.error(`[leads] aviso do sino não atualizado para a conversa ${conversaId}:`, e instanceof Error ? e.message : e)
  }
}

export type ResultadoDoRecebimento =
  | "IGNORADA" // reação, figurinha, texto vazio ou telefone fora do modo de teste
  | "REPETIDA" // a Meta reentregou uma mensagem já gravada
  | "REGISTRADA" // gravada; a conversa não está com o agente, ele não responde
  | "ADIADA" // gravada; chegou mensagem mais nova, quem responde é a chamada dela
  | "PROCESSADA" // gravada e a conversa foi respondida (ou já estava sendo, por outra chamada)

// ---------- Entrada: cada mensagem que chega do WhatsApp passa por aqui ----------
export async function receberMensagemDoLead(evento: EventoDoLead, deps: Dependencias): Promise<ResultadoDoRecebimento> {
  if (evento.tipo === "ignorar" || !evento.wamid || !evento.telefone) return "IGNORADA"
  const { soAtender } = deps.agente
  if (soAtender.size && !soAtender.has(chaveDoTelefone(evento.telefone))) return "IGNORADA"

  const textoDoLead = evento.texto.trim()
  if (evento.tipo === "texto" && !textoDoLead) return "IGNORADA"

  // A Meta pode entregar a mesma mensagem mais de uma vez: a segunda para aqui, antes de criar qualquer coisa.
  const jaGravada = await prisma.leadMensagem.findUnique({ where: { wamid: evento.wamid }, select: { id: true } })
  if (jaGravada) return "REPETIDA"

  const telefone = evento.telefone.replace(/\D/g, "")
  const nome = evento.nome.trim().slice(0, 200)
  const conversa = await prisma.leadConversa
    .upsert({
      where: { telefone },
      create: { telefone, nomeWhats: nome || null },
      update: nome ? { nomeWhats: nome } : {},
      select: { id: true, estado: true },
    })
    .catch(async (e) => {
      // Duas primeiras mensagens do mesmo telefone ao mesmo tempo: a outra chamada criou a conversa.
      if (!ehDuplicata(e)) throw e
      return prisma.leadConversa.findUniqueOrThrow({ where: { telefone }, select: { id: true, estado: true } })
    })

  // Gravada antes de qualquer espera. O `wamid` único cobre a corrida entre duas entregas simultâneas.
  const em = deps.agora()
  // Regra 26: lead ENCERRADO que escreve de novo volta para o agente como conversa nova. O que já se
  // sabia dele (ficha, linhagem, resumo e as mensagens antigas) fica guardado; só o contexto da IA recomeça.
  const reabre = conversa.estado === "ENCERRADA"
  const comOAgente = conversa.estado === "AGENTE" || reabre
  try {
    await prisma.$transaction([
      prisma.leadMensagem.create({
        data: {
          conversaId: conversa.id,
          de: "LEAD",
          texto: textoDoLead || `[${rotuloDoArquivo(evento.midiaTipo)}]`,
          wamid: evento.wamid,
          midiaId: evento.tipo === "arquivo" ? evento.midiaId : null,
          midiaTipo: evento.tipo === "arquivo" ? (evento.midiaTipo ?? "outro") : null,
          midiaNome: evento.tipo === "arquivo" ? evento.midiaNome?.slice(0, 300) ?? null : null,
          aguardaAgente: comOAgente,
          criadoEm: em,
        },
      }),
      prisma.leadConversa.update({
        where: { id: conversa.id },
        data: {
          ultimaDoLeadEm: em, ultimaDoLeadWamid: evento.wamid, ultimaAtividadeEm: em,
          ...(reabre ? { estado: "AGENTE", contextoIa: json([]), motivoPassagem: null, passouEm: null, encerradaEm: null, motivoEncerramento: null } : {}),
        },
      }),
    ])
  } catch (e) {
    if (ehDuplicata(e)) return "REPETIDA"
    throw e
  }

  // Depois da passagem o agente se cala (regra 10). A mensagem fica gravada para a tela de Leads e
  // quem atende é avisado no sino (regra 27).
  if (!comOAgente) {
    await avisarQuemAtende(conversa.id, deps)
    return "REGISTRADA"
  }

  // Espera o lead terminar de escrever (regra 11). Se chegou mensagem mais nova, quem responde é a chamada dela.
  await deps.esperar(deps.agente.esperaMs)
  const depois = await prisma.leadConversa.findUnique({ where: { id: conversa.id }, select: { ultimaDoLeadWamid: true } })
  if (depois?.ultimaDoLeadWamid !== evento.wamid) return "ADIADA"

  await responderConversa(conversa.id, deps)
  return "PROCESSADA"
}

// ---------- A trava: só uma chamada responde a conversa de cada vez ----------
async function travar(conversaId: number, deps: Dependencias): Promise<Date | null> {
  const agora = deps.agora()
  const ate = new Date(agora.getTime() + TRAVA_MS)
  const r = await prisma.leadConversa.updateMany({
    where: { id: conversaId, OR: [{ processandoAte: null }, { processandoAte: { lt: agora } }] },
    data: { processandoAte: ate },
  })
  return r.count === 1 ? ate : null
}

async function destravar(conversaId: number, ate: Date): Promise<void> {
  await prisma.leadConversa.updateMany({ where: { id: conversaId, processandoAte: ate }, data: { processandoAte: null } })
}

const haMensagemSemResposta = async (conversaId: number) =>
  (await prisma.leadMensagem.count({ where: { conversaId, aguardaAgente: true } })) > 0

function respostaFixa(primeiraVez: boolean, motivo: string, deps: Dependencias): RespostaDoAgente & { fixa: true } {
  const cumprimento = `Olá, ${saudacao(horaLocal(deps.agente.fuso, deps.agora()))}.`
  return {
    mensagens: primeiraVez ? [cumprimento, FRASE_DE_ESPERA] : [FRASE_DE_ESPERA],
    ficha: {},
    linhagem: [],
    passar_para_equipe: true,
    motivo,
    resumo: "",
    fixa: true,
  }
}

const pausaDeDigitacao = (texto: string, a: ConfiguracaoDoAgente) => Math.min(a.digitacaoMaxMs, a.digitacaoBaseMs + texto.length * a.digitacaoPorLetraMs)

// ---------- Resposta ----------
/**
 * Responde o que estiver sem resposta numa conversa que está com o agente. Idempotente: se não há
 * nada pendente, ou a conversa não está com o agente, não faz nada.
 */
export async function responderConversa(conversaId: number, deps: Dependencias): Promise<void> {
  let trava = await travar(conversaId, deps)
  // Outra chamada está respondendo. Ela mesma confere as mensagens novas ao terminar; esta só fica
  // por perto para o caso de ela soltar a conversa exatamente entre a conferência dela e a chegada desta.
  for (let i = 0; !trava && i < 12; i++) {
    await deps.esperar(deps.agente.repeticaoDaTravaMs)
    if (!(await haMensagemSemResposta(conversaId))) return
    trava = await travar(conversaId, deps)
  }
  if (!trava) return

  try {
    let refeitas = 0
    for (let volta = 0; volta < 6; volta++) {
      let conversa = await prisma.leadConversa.findUnique({ where: { id: conversaId } })
      if (!conversa || conversa.estado !== "AGENTE") return

      // O lead ainda está escrevendo? Espera o silêncio completar.
      if (conversa.ultimaDoLeadEm) {
        const falta = deps.agente.esperaMs - (deps.agora().getTime() - conversa.ultimaDoLeadEm.getTime())
        if (falta > 0) {
          await deps.esperar(falta)
          conversa = await prisma.leadConversa.findUnique({ where: { id: conversaId } })
          if (!conversa || conversa.estado !== "AGENTE") return
        }
      }

      const pendentes = await prisma.leadMensagem.findMany({
        where: { conversaId, aguardaAgente: true },
        orderBy: { id: "asc" },
        select: { id: true, texto: true, midiaTipo: true },
      })
      if (!pendentes.length) return
      const ultimoId = pendentes[pendentes.length - 1].id
      const inicio = deps.agora()

      const turnos = lerTurnos(conversa.contextoIa)
      const primeiraVez = !turnos.some((t) => t.role === "assistant")
      const lidas = pendentes.filter((p) => !p.midiaTipo).map((p) => p.texto)
      if (lidas.length) turnos.push({ role: "user", content: lidas.join("\n") })
      const arquivo = pendentes.find((p) => p.midiaTipo)

      let resposta: RespostaDoAgente & { fixa?: true }
      if (arquivo) {
        // Regra 13: o agente não lê áudio, foto, documento nem vídeo.
        resposta = respostaFixa(primeiraVez, `Lead mandou ${rotuloDoArquivo(arquivo.midiaTipo)}, que o agente não lê`, deps)
      } else if (turnos.filter((t) => t.role === "assistant").length >= MAX_RESPOSTAS_DO_AGENTE) {
        resposta = respostaFixa(primeiraVez, "Conversa longa: o agente chegou ao limite de respostas", deps)
      } else if (!deps.ia) {
        resposta = respostaFixa(primeiraVez, "Agente sem IA configurada", deps)
      } else {
        try {
          resposta = await deps.ia.responder({
            instrucoesFixas: instrucoesFixas(deps.agente.nome),
            instrucaoDaHora: instrucaoDaHora(horaLocal(deps.agente.fuso, deps.agora())),
            turnos,
          })
        } catch (e) {
          // Regra 14: sem resposta da IA, o lead não fica no vácuo.
          deps.registrar.error(`[leads] IA sem resposta para a conversa ${conversaId}:`, e instanceof Error ? e.message : e)
          resposta = respostaFixa(primeiraVez, "Falha técnica no agente", deps)
        }
        // Regra 11: chegou mensagem nova enquanto a resposta era preparada? Refaz, agora com tudo.
        if (!resposta.fixa && refeitas < MAX_REFEITAS) {
          const chegouMais = await prisma.leadMensagem.count({ where: { conversaId, aguardaAgente: true, id: { gt: ultimoId } } })
          if (chegouMais > 0) {
            refeitas++
            continue
          }
        }
      }

      // Regra 16: se uma pessoa assumiu enquanto a resposta era preparada, o agente não fala.
      const antesDeGravar = await prisma.leadConversa.findUnique({ where: { id: conversaId }, select: { estado: true } })
      if (antesDeGravar?.estado !== "AGENTE") return

      // A DECISÃO É GRAVADA ANTES DO ENVIO: mensagens do lote dadas como respondidas e o contexto da IA atualizado.
      turnos.push({
        role: "assistant",
        content: JSON.stringify({
          mensagens: resposta.mensagens,
          ficha: resposta.ficha,
          linhagem: resposta.linhagem,
          passar_para_equipe: resposta.passar_para_equipe,
          motivo: resposta.motivo,
          resumo: resposta.resumo,
        }),
      })
      // O que já foi levantado nunca é apagado por um campo que voltou vazio.
      const ficha = lerFicha(conversa.ficha)
      for (const [campo, valor] of Object.entries(resposta.ficha)) if (valor.trim()) ficha[campo] = valor
      const estadoDepois = resposta.passar_para_equipe ? "EQUIPE" : "AGENTE"
      await prisma.$transaction([
        // Na passagem, nenhuma mensagem fica marcada para o agente: ele não responde mais esta conversa.
        prisma.leadMensagem.updateMany({
          where: resposta.passar_para_equipe ? { conversaId, aguardaAgente: true } : { id: { in: pendentes.map((p) => p.id) } },
          data: { aguardaAgente: false },
        }),
        prisma.leadConversa.update({
          where: { id: conversaId },
          data: {
            contextoIa: json(turnos),
            ficha: json(ficha),
            ...(resposta.linhagem.length ? { linhagem: json(resposta.linhagem) } : {}),
            ...(resposta.resumo.trim() ? { resumo: resposta.resumo } : {}),
            ...(resposta.passar_para_equipe
              ? { estado: "EQUIPE", motivoPassagem: (resposta.motivo.trim() || "Triagem concluída").slice(0, 300), passouEm: inicio }
              : {}),
          },
        }),
      ])

      const enviou = await enviarResposta({ conversaId, resposta, estadoDepois, inicio, wamidDoLead: conversa.ultimaDoLeadWamid, telefone: conversa.telefone }, deps)
      // A conversa passou (regra 27): quem atende é avisado depois que a frase saiu.
      if (resposta.passar_para_equipe) await avisarQuemAtende(conversaId, deps)
      if (!enviou || resposta.passar_para_equipe) return
      // Sem passagem: confere se o lead escreveu enquanto as mensagens eram enviadas.
    }
  } finally {
    await destravar(conversaId, trava).catch(() => {})
  }
}

/** Envia uma mensagem de cada vez, com "digitando…" e pausa (regra 12). Devolve `false` se o envio foi interrompido ou falhou. */
async function enviarResposta(
  args: { conversaId: number; resposta: RespostaDoAgente; estadoDepois: string; inicio: Date; wamidDoLead: string | null; telefone: string },
  deps: Dependencias,
): Promise<boolean> {
  const { conversaId, resposta, estadoDepois, inicio } = args
  for (const texto of resposta.mensagens) {
    // Regra 16: uma pessoa respondeu ou mexeu na conversa nesse meio tempo? O agente para na hora.
    const [atual, deAtendente] = await Promise.all([
      prisma.leadConversa.findUnique({ where: { id: conversaId }, select: { estado: true } }),
      prisma.leadMensagem.count({ where: { conversaId, de: "ATENDENTE", criadoEm: { gte: inicio } } }),
    ])
    if (atual?.estado !== estadoDepois || deAtendente > 0) return false

    await deps.whats.digitando(args.wamidDoLead)
    await deps.esperar(pausaDeDigitacao(texto, deps.agente))
    let wamid: string | null
    try {
      wamid = await deps.whats.enviarTexto(args.telefone, texto)
    } catch (e) {
      deps.registrar.error(`[leads] envio falhou na conversa ${conversaId}:`, e instanceof Error ? e.message : e)
      // O lead ficou sem resposta do agente: a conversa vai para uma pessoa, com o motivo.
      const passou = await prisma.leadConversa.updateMany({
        where: { id: conversaId, estado: "AGENTE" },
        data: { estado: "EQUIPE", motivoPassagem: "Falha no envio pelo WhatsApp", passouEm: deps.agora() },
      })
      if (passou.count === 1) await avisarQuemAtende(conversaId, deps)
      return false
    }
    const em = deps.agora()
    try {
      await prisma.$transaction([
        prisma.leadMensagem.create({ data: { conversaId, de: "AGENTE", texto, wamid, criadoEm: em } }),
        prisma.leadConversa.update({ where: { id: conversaId }, data: { ultimaAtividadeEm: em } }),
      ])
    } catch (e) {
      // A mensagem JÁ saiu. Falhar em registrar não pode fazê-la sair de novo: registra o erro e segue.
      deps.registrar.error(`[leads] mensagem enviada mas não registrada na conversa ${conversaId}:`, e instanceof Error ? e.message : e)
    }
  }
  return true
}

/**
 * Rede de segurança (cron): responde as conversas que estão com o agente e ficaram com mensagem sem
 * resposta — a função do webhook morreu no meio, ou a IA demorou além do limite.
 */
export async function retomarConversasParadas(deps: Dependencias, limite = 3): Promise<{ encontradas: number; retomadas: number }> {
  const agora = deps.agora()
  const paradas = await prisma.leadConversa.findMany({
    where: {
      estado: "AGENTE",
      ultimaDoLeadEm: { lt: new Date(agora.getTime() - PARADA_HA_MS) },
      mensagens: { some: { aguardaAgente: true } },
      OR: [{ processandoAte: null }, { processandoAte: { lt: agora } }],
    },
    orderBy: { ultimaDoLeadEm: "asc" },
    take: limite,
    select: { id: true, telefone: true },
  })
  const { soAtender } = deps.agente
  let retomadas = 0
  for (const c of paradas) {
    // O modo de teste também vale aqui: conversa de telefone fora da lista não é respondida.
    if (soAtender.size && !soAtender.has(chaveDoTelefone(c.telefone))) continue
    try {
      await responderConversa(c.id, deps)
      retomadas++
    } catch (e) {
      deps.registrar.error(`[leads] retomada falhou na conversa ${c.id}:`, e instanceof Error ? e.message : e)
    }
  }
  return { encontradas: paradas.length, retomadas }
}

// ============================================================================
// A PESSOA NA CONVERSA — docs/leads-mandato.md, regras 15, 16, 25 e 26.
// Responder, devolver ao agente, encerrar e reabrir. Cada ato humano deixa uma linha em LogAuditoria.
// ============================================================================

/** Erro com explicação pronta para a tela. */
export class ErroDoLead extends Error {
  constructor(public readonly codigo: string, public readonly status: number, mensagem: string) {
    super(mensagem)
  }
}

const naoEncontrado = () => new ErroDoLead("NAO_ENCONTRADO", 404, "Lead não encontrado.")

async function auditar(acao: string, conversaId: number, usuarioId: number, descricao: string, detalhes?: Record<string, unknown>) {
  await prisma.logAuditoria.create({ data: { acao, entidade: "LEAD_CONVERSA", entidadeId: conversaId, usuarioId, descricao, detalhes: detalhes ? json(detalhes) : undefined } })
}

/**
 * A pessoa responde pela tela. A partir daí a conversa é dela e o agente não fala mais (regra 16).
 * Só dentro das 24 horas da última mensagem do lead (regra 15).
 */
export async function responderComoPessoa(args: { conversaId: number; texto: string; autorId: number }, deps: Dependencias): Promise<{ id: number; em: string }> {
  const texto = String(args.texto ?? "").trim()
  if (!texto) throw new ErroDoLead("MENSAGEM_VAZIA", 400, "A mensagem está vazia.")
  if (texto.length > 4096) throw new ErroDoLead("MENSAGEM_LONGA", 400, "A mensagem passa do limite de 4096 letras do WhatsApp.")
  const conversa = await prisma.leadConversa.findUnique({ where: { id: args.conversaId }, select: { id: true, telefone: true, estado: true, ultimaDoLeadEm: true } })
  if (!conversa) throw naoEncontrado()
  if (conversa.estado === "ENCERRADA") throw new ErroDoLead("ENCERRADO", 409, "Este lead está encerrado. Reabra para responder.")
  if (!podeResponderAoLead({ estado: conversa.estado, ultimaDoLeadEm: conversa.ultimaDoLeadEm, agora: deps.agora() })) {
    throw new ErroDoLead("FORA_DA_JANELA", 409, "Passaram mais de 24 horas desde a última mensagem do lead. O WhatsApp só libera a resposta quando ele escrever de novo.")
  }

  // Assume ANTES de enviar: o agente para mesmo que esteja no meio de uma resposta.
  const agora = deps.agora()
  const assumiu = await prisma.leadConversa.updateMany({
    where: { id: conversa.id, estado: "AGENTE" },
    data: { estado: "EQUIPE", motivoPassagem: MOTIVO_ASSUMIDO_PELA_TELA, passouEm: agora },
  })
  if (assumiu.count === 1) {
    await prisma.leadMensagem.updateMany({ where: { conversaId: conversa.id, aguardaAgente: true }, data: { aguardaAgente: false } })
    await auditar("ASSUMIR", conversa.id, args.autorId, `Lead ${conversa.id} assumido pela tela de Leads (estava com o agente).`)
  }

  let wamid: string | null
  try {
    wamid = await deps.whats.enviarTexto(conversa.telefone, texto)
  } catch (e) {
    throw new ErroDoLead("ENVIO_FALHOU", 502, `O WhatsApp recusou o envio: ${e instanceof Error ? e.message : String(e)}`)
  }
  const em = deps.agora()
  const [mensagem] = await prisma.$transaction([
    prisma.leadMensagem.create({ data: { conversaId: conversa.id, de: "ATENDENTE", autorId: args.autorId, texto, wamid, criadoEm: em }, select: { id: true } }),
    prisma.leadConversa.update({ where: { id: conversa.id }, data: { ultimaAtividadeEm: em } }),
  ])
  await tirarDoAviso(conversa.id)
  return { id: mensagem.id, em: em.toISOString() }
}

/**
 * Devolve a conversa ao agente (regra 25). Ele volta sabendo o que foi dito enquanto esteve fora: as
 * mensagens do lead e da pessoa depois da passagem entram no contexto da IA. Se a última palavra é do
 * lead, ela fica marcada para o agente responder (`responderAgora`).
 */
export async function devolverAoAgente(args: { conversaId: number; autorId: number }): Promise<{ devolvida: boolean; responderAgora: boolean }> {
  const conversa = await prisma.leadConversa.findUnique({
    where: { id: args.conversaId },
    select: { id: true, estado: true, passouEm: true, contextoIa: true, mensagens: { orderBy: { id: "asc" }, select: { id: true, de: true, texto: true, midiaTipo: true, criadoEm: true } } },
  })
  if (!conversa) throw naoEncontrado()
  if (conversa.estado === "ENCERRADA") throw new ErroDoLead("ENCERRADO", 409, "Este lead está encerrado. Reabra antes de devolver ao agente.")
  if (conversa.estado === "AGENTE") return { devolvida: false, responderAgora: false }

  // O que aconteceu sem o agente: tudo depois da passagem que não foi ele quem escreveu.
  const desde = conversa.passouEm
  const fora = conversa.mensagens.filter((m) => m.de !== "AGENTE" && (!desde || m.criadoEm >= desde))
  // As últimas mensagens do lead, ainda sem resposta de ninguém, ficam para o agente responder.
  let corte = fora.length
  while (corte > 0 && fora[corte - 1].de === "LEAD") corte--
  const semResposta = fora.slice(corte).filter((m) => !m.midiaTipo)
  const turnos = lerTurnos(conversa.contextoIa)
  for (const m of fora.slice(0, corte)) {
    if (m.de === "LEAD") turnos.push({ role: "user", content: m.texto })
    else turnos.push({ role: "assistant", content: JSON.stringify({ mensagens: [m.texto], ficha: {}, linhagem: [], passar_para_equipe: false, motivo: "", resumo: "" }) })
  }

  await prisma.$transaction([
    prisma.leadConversa.update({ where: { id: conversa.id }, data: { estado: "AGENTE", motivoPassagem: null, passouEm: null, contextoIa: json(turnos) } }),
    prisma.leadMensagem.updateMany({ where: { id: { in: semResposta.map((m) => m.id) } }, data: { aguardaAgente: true } }),
    prisma.logAuditoria.create({ data: { acao: "DEVOLVER", entidade: "LEAD_CONVERSA", entidadeId: conversa.id, usuarioId: args.autorId, descricao: `Lead ${conversa.id} devolvido ao agente.` } }),
  ])
  await tirarDoAviso(conversa.id)
  return { devolvida: true, responderAgora: semResposta.length > 0 }
}

/** Encerra o lead, com motivo escrito (regra 26). */
export async function encerrarLead(args: { conversaId: number; motivo: string; autorId: number }, agora: Date = new Date()): Promise<void> {
  const motivo = String(args.motivo ?? "").trim()
  if (motivo.length < 5) throw new ErroDoLead("MOTIVO_CURTO", 400, "Escreva o motivo do encerramento (pelo menos 5 letras).")
  const conversa = await prisma.leadConversa.findUnique({ where: { id: args.conversaId }, select: { id: true, estado: true } })
  if (!conversa) throw naoEncontrado()
  if (conversa.estado === "ENCERRADA") throw new ErroDoLead("JA_ENCERRADO", 409, "Este lead já está encerrado.")
  await prisma.$transaction([
    prisma.leadConversa.update({ where: { id: conversa.id }, data: { estado: "ENCERRADA", encerradaEm: agora, motivoEncerramento: motivo.slice(0, 300) } }),
    prisma.leadMensagem.updateMany({ where: { conversaId: conversa.id, aguardaAgente: true }, data: { aguardaAgente: false } }),
    prisma.logAuditoria.create({ data: { acao: "ENCERRAR", entidade: "LEAD_CONVERSA", entidadeId: conversa.id, usuarioId: args.autorId, descricao: `Lead ${conversa.id} encerrado.`, detalhes: json({ motivo: motivo.slice(0, 300), estadoAnterior: conversa.estado }) } }),
  ])
  await tirarDoAviso(conversa.id)
}

/** Desfaz um encerramento: o lead volta para a pessoa (nunca direto para o agente). */
export async function reabrirLead(args: { conversaId: number; autorId: number }, agora: Date = new Date()): Promise<void> {
  const conversa = await prisma.leadConversa.findUnique({ where: { id: args.conversaId }, select: { id: true, estado: true, passouEm: true } })
  if (!conversa) throw naoEncontrado()
  if (conversa.estado !== "ENCERRADA") throw new ErroDoLead("NAO_ENCERRADO", 409, "Este lead não está encerrado.")
  await prisma.$transaction([
    prisma.leadConversa.update({ where: { id: conversa.id }, data: { estado: "EQUIPE", encerradaEm: null, motivoEncerramento: null, passouEm: conversa.passouEm ?? agora } }),
    prisma.logAuditoria.create({ data: { acao: "REABRIR", entidade: "LEAD_CONVERSA", entidadeId: conversa.id, usuarioId: args.autorId, descricao: `Lead ${conversa.id} reaberto.` } }),
  ])
}
