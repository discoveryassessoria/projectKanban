// src/app/api/saude/banco/route.ts
//
// HEALTH CHECK DA CONEXÃO COM O BANCO — três diagnósticos distintos.
//
// POR QUE ELE EXISTE
// ------------------
// Em 04/08/2026 produção passou a devolver 500 em toda rota de dados porque
// `PRISMA_DATABASE_URL` sumiu do target Production. Descobrir isso levou tempo
// demais: a única pista era o stack trace de UMA rota qualquer, e "login com erro
// interno" não distingue as três coisas que quebram do mesmo jeito para o usuário
// e se consertam de formas completamente diferentes:
//
//   VARIAVEL_AUSENTE   → a configuração do ambiente perdeu a chave;
//   FALHA_DE_CONEXAO   → a chave existe, o banco é o certo, mas não responde;
//   BANCO_INCORRETO    → conecta, mas no banco ERRADO (ex.: homologação).
//
// O terceiro é o mais perigoso: sem este check ele é INVISÍVEL — a aplicação
// funciona, só que sobre os dados errados.
//
// SEGREDO NUNCA SAI DAQUI. Nem para o corpo da resposta, nem para o log: só host
// mascarado, fingerprint parcial e o motivo nomeado. Requisição anônima recebe
// apenas o veredito; host e fingerprint exigem operador autenticado ou CRON_SECRET.

import { type NextRequest, NextResponse } from "next/server"
import { PrismaClient } from "@prisma/client"
import { conferirVariavel, EXPLICACAO, MOTIVO } from "@/lib/db/fingerprint-producao.mjs"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"

export const dynamic = "force-dynamic"

type Estado = "OK" | "VARIAVEL_AUSENTE" | "FALHA_DE_CONEXAO" | "BANCO_INCORRETO"

/**
 * Detalhe é para quem opera. O gate NÃO pode depender do banco — este endpoint
 * precisa responder justamente quando o banco está fora.
 */
async function podeVerDetalhe(req: NextRequest): Promise<boolean> {
  const segredo = process.env.CRON_SECRET
  const auth = req.headers.get("authorization")
  if (segredo && auth === `Bearer ${segredo}`) return true
  if (req.headers.get("x-vercel-cron")) return true
  try {
    const u = await extrairUsuarioComPermissoes(req)
    return !!u
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  const detalhado = await podeVerDetalhe(request)

  const url = process.env.PRISMA_DATABASE_URL
  const conferencia = conferirVariavel("PRISMA_DATABASE_URL", url)

  // ── 1) A variável existe e aponta para o banco certo? ─────────────────────
  if (!conferencia.ok) {
    const estado: Estado =
      conferencia.motivo === MOTIVO.AUSENTE ? "VARIAVEL_AUSENTE" : "BANCO_INCORRETO"
    return NextResponse.json(
      {
        estado,
        motivo: conferencia.motivo,
        explicacao: EXPLICACAO[conferencia.motivo],
        ...(detalhado ? { host: conferencia.host, fingerprint: conferencia.fingerprint } : {}),
      },
      { status: 503 },
    )
  }

  // ── 2) O banco responde? ──────────────────────────────────────────────────
  // Client próprio e descartável: o singleton da aplicação guarda a conexão, e
  // um health check que reaproveita conexão viva mente sobre o estado atual.
  const prisma = new PrismaClient({ datasources: { db: { url: url as string } } })
  const inicio = Date.now()
  try {
    const [linha] = await prisma.$queryRawUnsafe<Array<{ db: string }>>(
      "select current_database() as db",
    )
    return NextResponse.json({
      estado: "OK" as Estado,
      motivo: MOTIVO.OK,
      explicacao: EXPLICACAO[MOTIVO.OK],
      latenciaMs: Date.now() - inicio,
      ...(detalhado
        ? { host: conferencia.host, fingerprint: conferencia.fingerprint, database: linha?.db ?? null }
        : {}),
    })
  } catch (e) {
    // A mensagem do driver pode conter a URL inteira. Só o TIPO do erro sai daqui.
    const tipo = e instanceof Error ? e.constructor.name : "Error"
    console.error("[saude/banco] falha de conexão:", tipo)
    return NextResponse.json(
      {
        estado: "FALHA_DE_CONEXAO" as Estado,
        motivo: "FALHA_DE_CONEXAO",
        explicacao:
          "a variável está correta e aponta para o banco de produção, mas a conexão não se estabeleceu. É indisponibilidade do banco ou de rede — não é configuração.",
        latenciaMs: Date.now() - inicio,
        ...(detalhado ? { host: conferencia.host, fingerprint: conferencia.fingerprint, erro: tipo } : {}),
      },
      { status: 503 },
    )
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
}
