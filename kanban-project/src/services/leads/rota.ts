// src/services/leads/rota.ts
// ============================================================================
// O QUE AS ROTAS /api/leads TÊM EM COMUM — docs/leads-mandato.md §7 e §8.
//
// Toda rota confere `leads.atender` no servidor (a página não é protegida pelo middleware) e traduz o
// erro do serviço em resposta com texto pronto para a tela. A regra fica no serviço; a rota só traduz.
// ============================================================================
import { NextResponse } from "next/server"
import { exigirPermissao } from "@/src/lib/verificar-permissao"
import { ErroDoLead } from "./atendimento"
import { PERMISSAO_DE_LEADS } from "./destinatarios"

export const autorizarLeads = (request: Request) => exigirPermissao(request, PERMISSAO_DE_LEADS)

/** Id numérico positivo vindo da URL, ou `null`. */
export function idDaUrl(valor: string): number | null {
  return /^[0-9]{1,9}$/.test(valor) && Number(valor) > 0 ? Number(valor) : null
}

export const idInvalido = () => NextResponse.json({ error: "identificador inválido" }, { status: 400 })

export function respostaDeErro(e: unknown, onde: string): NextResponse {
  if (e instanceof ErroDoLead) return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: e.status })
  console.error(`[leads] falha em ${onde}:`, e instanceof Error ? e.message : e)
  return NextResponse.json({ error: "Não foi possível concluir a ação." }, { status: 500 })
}

export const whatsAppDesligado = () =>
  NextResponse.json({ error: "O WhatsApp do agente não está configurado neste ambiente.", codigo: "NAO_CONFIGURADO" }, { status: 503 })
