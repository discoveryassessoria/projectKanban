// src/app/api/gerenciamento/prazo-por-pais/route.ts
// ============================================================================
// CADASTRO DO PRAZO POR PAÍS DO REGISTRO (08/10/2026) — a regra vive no Gerenciamento; quem decide é
// `lib/operacional/prazo-por-pais.ts`. Vale para as certidões que NASCEM depois (e para o recálculo do SLA na republicação);
// o prazo já gravado numa tarefa existente nunca é reescrito por aqui.
//   GET    ?stepKey=…                      → regras do passo + países da base (para escolher)
//   PUT    {stepKey, paisNome, slaDays}    → cria ou altera a regra do país (idempotente)
//   DELETE ?id=…                           → remove a regra (o país volta ao prazo do passo)
// ============================================================================
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { chaveDoPais } from "@/lib/operacional/prazo-por-pais"

const LIMITE_DIAS = 365

export async function GET(request: Request) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  const stepKey = new URL(request.url).searchParams.get("stepKey")?.trim() ?? ""
  if (!stepKey) return NextResponse.json({ error: "Informe o passo (stepKey)." }, { status: 400 })
  const [regras, paises] = await Promise.all([
    prisma.regraTemporalPais.findMany({ where: { stepKey }, orderBy: [{ paisNome: "asc" }] }),
    prisma.pais.findMany({ where: { ativo: true }, select: { nome: true }, orderBy: { nome: "asc" } }),
  ])
  return NextResponse.json({ regras, paises: paises.map((p) => p.nome) })
}

export async function PUT(request: Request) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  const body = (await request.json().catch(() => ({}))) as { stepKey?: unknown; paisNome?: unknown; slaDays?: unknown; ativo?: unknown }
  const stepKey = typeof body.stepKey === "string" ? body.stepKey.trim() : ""
  const paisNome = typeof body.paisNome === "string" ? body.paisNome.trim() : ""
  const slaDays = Number(body.slaDays)
  if (!stepKey) return NextResponse.json({ error: "Informe o passo (stepKey)." }, { status: 400 })
  const paisChave = chaveDoPais(paisNome)
  if (!paisChave) return NextResponse.json({ error: "Escolha o país." }, { status: 400 })
  if (!Number.isInteger(slaDays) || slaDays < 1 || slaDays > LIMITE_DIAS) {
    return NextResponse.json({ error: `O prazo precisa ser um número inteiro de 1 a ${LIMITE_DIAS} dias corridos.` }, { status: 400 })
  }
  // O país tem que existir na base de países (ou ser o Brasil): nome digitado errado nunca vira regra que não casa com nada.
  if (paisChave !== "brasil") {
    const existe = (await prisma.pais.findMany({ where: { ativo: true }, select: { nome: true } })).some((p) => chaveDoPais(p.nome) === paisChave)
    if (!existe) return NextResponse.json({ error: `«${paisNome}» não está na base de países.` }, { status: 400 })
  }
  const usuario = await extrairUsuarioComPermissoes(request)
  const nomeOficial = paisChave === "brasil" ? "Brasil" : paisNome
  const antes = await prisma.regraTemporalPais.findUnique({ where: { stepKey_paisChave: { stepKey, paisChave } }, select: { slaDays: true } })
  const regra = await prisma.$transaction(async (tx) => {
    const r = await tx.regraTemporalPais.upsert({
      where: { stepKey_paisChave: { stepKey, paisChave } },
      create: { stepKey, paisChave, paisNome: nomeOficial, slaDays, ativo: body.ativo !== false },
      update: { slaDays, paisNome: nomeOficial, ativo: body.ativo !== false },
    })
    await tx.logAuditoria.create({
      data: {
        acao: antes ? "PRAZO_POR_PAIS_ALTERADO" : "PRAZO_POR_PAIS_CRIADO", entidade: "RegraTemporalPais", entidadeId: r.id, usuarioId: usuario?.userId ?? undefined,
        descricao: `Prazo do passo «${stepKey}» para ${nomeOficial}: ${antes ? `${antes.slaDays} → ` : ""}${slaDays} dia(s) corridos.`,
        detalhes: { stepKey, paisChave, de: antes?.slaDays ?? null, para: slaDays },
      },
    })
    return r
  })
  return NextResponse.json({ regra })
}

export async function DELETE(request: Request) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  const id = Number(new URL(request.url).searchParams.get("id"))
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Informe a regra (id)." }, { status: 400 })
  const usuario = await extrairUsuarioComPermissoes(request)
  const r = await prisma.regraTemporalPais.findUnique({ where: { id } })
  if (!r) return NextResponse.json({ error: "Regra não encontrada." }, { status: 404 })
  await prisma.$transaction(async (tx) => {
    await tx.regraTemporalPais.delete({ where: { id } })
    await tx.logAuditoria.create({
      data: {
        acao: "PRAZO_POR_PAIS_REMOVIDO", entidade: "RegraTemporalPais", entidadeId: id, usuarioId: usuario?.userId ?? undefined,
        descricao: `Regra de prazo do passo «${r.stepKey}» para ${r.paisNome} (${r.slaDays} dia(s)) removida — o país volta ao prazo do passo.`,
        detalhes: { stepKey: r.stepKey, paisChave: r.paisChave, slaDays: r.slaDays },
      },
    })
  })
  return NextResponse.json({ ok: true })
}
