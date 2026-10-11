// src/services/leads/leitura.ts
// ============================================================================
// O QUE A TELA DE LEADS LÊ — docs/leads-mandato.md, regras 21 a 24. SOMENTE LEITURA.
//
// A situação de cada lead e "dá para responder" saem de `situacao.ts` (uma função só); a lista e os
// contadores saem do MESMO conjunto, então sempre fecham. Nada aqui é Tarefa nem entra em contador de
// tarefas (CLAUDE.md §5: grain = LEAD).
// ============================================================================
import { prisma } from "@/lib/prisma"
import { podeResponderAoLead, situacaoDoLead, type SituacaoDoLead } from "./situacao"

/** Quantas conversas a lista carrega (as de atividade mais recente). Acima disto a resposta diz que cortou. */
export const LIMITE_DA_LISTA = 500

export interface LeadNaLista {
  id: number
  telefone: string
  nome: string
  pais: string
  situacao: SituacaoDoLead
  podeResponder: boolean
  ultimaMensagem: { de: string; texto: string; em: string } | null
  ultimaAtividadeEm: string | null
}

export interface ListaDeLeads {
  leads: LeadNaLista[]
  /** Contagem por situação de TODOS os leads carregados (não só do filtro). */
  contagem: Record<SituacaoDoLead, number>
  total: number
  cortada: boolean
}

const textoDe = (v: unknown, campo: string) => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const x = (v as Record<string, unknown>)[campo]
    if (typeof x === "string") return x
  }
  return ""
}

export async function listarLeads(filtro: { situacao?: SituacaoDoLead | null; busca?: string | null }, agora: Date = new Date()): Promise<ListaDeLeads> {
  const conversas = await prisma.leadConversa.findMany({
    orderBy: [{ ultimaAtividadeEm: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: LIMITE_DA_LISTA + 1,
    select: { id: true, telefone: true, nomeWhats: true, estado: true, ficha: true, ultimaDoLeadEm: true, ultimaAtividadeEm: true },
  })
  const cortada = conversas.length > LIMITE_DA_LISTA
  const naTela = conversas.slice(0, LIMITE_DA_LISTA)
  // A última mensagem de cada conversa em DUAS consultas (o maior id por conversa, depois as mensagens),
  // em vez de trazer a conversa inteira de cada lead: a lista se atualiza sozinha a cada poucos segundos.
  const maiores = naTela.length
    ? await prisma.leadMensagem.groupBy({ by: ["conversaId"], where: { conversaId: { in: naTela.map((c) => c.id) } }, _max: { id: true } })
    : []
  const idsDasUltimas = maiores.map((m) => m._max.id).filter((id): id is number => id !== null)
  const ultimas = idsDasUltimas.length
    ? await prisma.leadMensagem.findMany({ where: { id: { in: idsDasUltimas } }, select: { conversaId: true, de: true, texto: true, criadoEm: true } })
    : []
  const ultimaDaConversa = new Map(ultimas.map((m) => [m.conversaId, m]))
  const todos: LeadNaLista[] = naTela.map((c) => {
    const ultima = ultimaDaConversa.get(c.id) ?? null
    return {
      id: c.id,
      telefone: c.telefone,
      nome: textoDe(c.ficha, "nome") || c.nomeWhats || "",
      pais: textoDe(c.ficha, "pais"),
      situacao: situacaoDoLead({ estado: c.estado, ultimaDe: ultima?.de ?? null }),
      podeResponder: podeResponderAoLead({ estado: c.estado, ultimaDoLeadEm: c.ultimaDoLeadEm, agora }),
      ultimaMensagem: ultima ? { de: ultima.de, texto: ultima.texto.slice(0, 200), em: ultima.criadoEm.toISOString() } : null,
      ultimaAtividadeEm: c.ultimaAtividadeEm?.toISOString() ?? null,
    }
  })
  const contagem: Record<SituacaoDoLead, number> = { AGUARDANDO_RESPOSTA: 0, RESPONDIDO: 0, COM_O_AGENTE: 0, ENCERRADO: 0 }
  for (const l of todos) contagem[l.situacao]++

  const busca = (filtro.busca ?? "").trim().toLowerCase()
  const digitos = busca.replace(/\D/g, "")
  const leads = todos.filter((l) => {
    if (filtro.situacao && l.situacao !== filtro.situacao) return false
    if (!busca) return true
    return l.nome.toLowerCase().includes(busca) || (digitos.length >= 3 && l.telefone.includes(digitos))
  })
  return { leads, contagem, total: todos.length, cortada }
}

export interface MensagemDoLead {
  id: number
  de: string
  /** Nome de quem respondeu, quando foi uma pessoa. */
  autor: string | null
  texto: string
  em: string
  arquivo: { tipo: string; nome: string | null } | null
}

export interface LeadAberto extends LeadNaLista {
  nomeWhats: string
  motivoPassagem: string | null
  motivoEncerramento: string | null
  resumo: string
  ficha: Record<string, string>
  linhagem: { quem: string; nome: string; conjuge: string; pais: string; nasceu: string }[]
  mensagens: MensagemDoLead[]
}

export async function lerLead(id: number, agora: Date = new Date()): Promise<LeadAberto | null> {
  const c = await prisma.leadConversa.findUnique({
    where: { id },
    select: {
      id: true, telefone: true, nomeWhats: true, estado: true, ficha: true, linhagem: true, resumo: true,
      motivoPassagem: true, motivoEncerramento: true, ultimaDoLeadEm: true, ultimaAtividadeEm: true,
      mensagens: {
        orderBy: { id: "asc" },
        select: { id: true, de: true, texto: true, criadoEm: true, midiaId: true, midiaTipo: true, midiaNome: true, autor: { select: { nome: true } } },
      },
    },
  })
  if (!c) return null
  const ultima = c.mensagens.at(-1) ?? null
  const ficha: Record<string, string> = {}
  if (c.ficha && typeof c.ficha === "object" && !Array.isArray(c.ficha)) {
    for (const [k, v] of Object.entries(c.ficha)) if (typeof v === "string" && v.trim()) ficha[k] = v
  }
  const linhagem = Array.isArray(c.linhagem)
    ? c.linhagem
        .filter((p) => Boolean(p) && typeof p === "object" && !Array.isArray(p))
        .map((p) => ({ quem: textoDe(p, "quem"), nome: textoDe(p, "nome"), conjuge: textoDe(p, "conjuge"), pais: textoDe(p, "pais"), nasceu: textoDe(p, "nasceu") }))
    : []
  return {
    id: c.id,
    telefone: c.telefone,
    nome: ficha.nome || c.nomeWhats || "",
    nomeWhats: c.nomeWhats ?? "",
    pais: ficha.pais ?? "",
    situacao: situacaoDoLead({ estado: c.estado, ultimaDe: ultima?.de ?? null }),
    podeResponder: podeResponderAoLead({ estado: c.estado, ultimaDoLeadEm: c.ultimaDoLeadEm, agora }),
    ultimaMensagem: ultima ? { de: ultima.de, texto: ultima.texto.slice(0, 200), em: ultima.criadoEm.toISOString() } : null,
    ultimaAtividadeEm: c.ultimaAtividadeEm?.toISOString() ?? null,
    motivoPassagem: c.motivoPassagem,
    motivoEncerramento: c.motivoEncerramento,
    resumo: c.resumo ?? "",
    ficha,
    linhagem,
    mensagens: c.mensagens.map((m) => ({
      id: m.id,
      de: m.de,
      autor: m.autor?.nome ?? null,
      texto: m.texto,
      em: m.criadoEm.toISOString(),
      // O identificador da mídia na Meta nunca sai do servidor: a tela pede o arquivo pelo id da MENSAGEM.
      arquivo: m.midiaTipo ? { tipo: m.midiaTipo, nome: m.midiaNome } : null,
    })),
  }
}

/** O arquivo que o lead mandou numa mensagem: só o que o servidor precisa para buscá-lo na Meta. */
export async function arquivoDaMensagem(mensagemId: number): Promise<{ midiaId: string; tipo: string; nome: string | null } | null> {
  const m = await prisma.leadMensagem.findUnique({ where: { id: mensagemId }, select: { midiaId: true, midiaTipo: true, midiaNome: true } })
  if (!m?.midiaId || !m.midiaTipo) return null
  return { midiaId: m.midiaId, tipo: m.midiaTipo, nome: m.midiaNome }
}
