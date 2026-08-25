// ============================================================================
// DIAGNÓSTICO DO LOGIN — só registra, nunca concede.
//
// Existe porque há uma falha relatada que NÃO reproduz em bancada: depois de
// ficar ocioso, o usuário volta, digita a senha e a tela trava em "Entrando…";
// atualizar a página e repetir resolve. Reproduzi o caminho completo (login →
// expiração → logout automático → novo login) em Chromium e em WebKit, o motor
// do Safari, e funcionou nas duas. Também medi a produção: /api/auth/login
// responde em ~0,4s e /dashboard em ~0,2s, então não é lentidão de função fria.
//
// Falta o ingrediente que a bancada não recria — provavelmente a aba realmente
// suspensa pelo Safari. Em vez de continuar adivinhando, o cliente passa a
// relatar o que viu no instante em que travou.
//
// PÚBLICA de propósito: quem está travado no login, por definição, não tem
// sessão. E porque é pública, ela é deliberadamente burra — não lê o corpo
// livremente, não confia em nada que chega, e nunca aceita credencial.
// ============================================================================
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

/** Só estes campos atravessam. Qualquer outra chave do corpo é descartada. */
const CAMPOS_ACEITOS = [
  "fase",              // "fetch-nao-respondeu" | "navegacao-nao-ocorreu"
  "msDecorridos",
  "fetchConcluido",
  "httpStatus",
  "visibilidade",      // document.visibilityState no momento da falha
  "restauradaDoCache", // navigation type "back_forward" = bfcache do Safari
  "msDesdeCarregamento",
  "temTokenLocal",
  "temCookie",
  "online",
  "agente",
] as const

/** Número, booleano e string curta. Nada aninhado, nada longo, nada livre. */
function sanear(bruto: unknown): Record<string, string | number | boolean> {
  const saida: Record<string, string | number | boolean> = {}
  if (!bruto || typeof bruto !== "object") return saida
  const obj = bruto as Record<string, unknown>
  for (const chave of CAMPOS_ACEITOS) {
    const v = obj[chave]
    if (typeof v === "number" && Number.isFinite(v)) saida[chave] = v
    else if (typeof v === "boolean") saida[chave] = v
    else if (typeof v === "string") saida[chave] = v.slice(0, 180)
  }
  return saida
}

export async function POST(request: NextRequest) {
  try {
    const detalhes = sanear(await request.json())
    // Sem detalhe reconhecido não há o que registrar — e não vale abrir linha.
    if (Object.keys(detalhes).length === 0) {
      return NextResponse.json({ registrado: false }, { status: 400 })
    }
    await prisma.logAuditoria.create({
      data: {
        acao: "LOGIN_TRAVOU",
        entidade: "ACESSO",
        // NUNCA o e-mail digitado: quem trava no login pode ter errado o campo,
        // e o que interessa aqui é o COMO, não o quem.
        descricao: `Login não concluiu na fase "${detalhes.fase ?? "desconhecida"}"`,
        detalhes,
        usuarioId: null,
      },
    })
    return NextResponse.json({ registrado: true })
  } catch {
    // Diagnóstico que derruba a tela seria pior que a falha que ele investiga.
    return NextResponse.json({ registrado: false }, { status: 200 })
  }
}
