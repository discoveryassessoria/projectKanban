// /api/relatorios/visoes — as visões salvas de quem está pedindo.
//
// A visão guarda a PERGUNTA (QuerySpec), nunca o resultado. Reabrir refaz a
// consulta: é isso que a mantém verdadeira quando o dado muda.
//
// GET    lista (do dono, opcionalmente por domínio)
// POST   cria/atualiza pelo nome
// PATCH  favorita / marca uso
// DELETE remove

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { dominioPorChave } from "@/src/lib/relatorios/motor/registro"
import type { QuerySpec } from "@/src/lib/relatorios/motor/tipos"

async function dono(request: Request): Promise<number | null> {
  const u = await extrairUsuarioComPermissoes(request as never)
  return u?.userId ?? null
}

export async function GET(request: Request) {

  const erro = await verificarPermissao(request, "relatorios.ver")
  if (erro) return erro
  try {
    const usuarioId = await dono(request)
    if (!usuarioId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    const dominio = new URL(request.url).searchParams.get("dominio")

    const visoes = await prisma.relatorioVisao.findMany({
      where: { usuarioId, ...(dominio ? { dominio } : {}) },
      orderBy: [{ favorita: "desc" }, { usadaEm: "desc" }, { nome: "asc" }],
      select: { id: true, dominio: true, nome: true, spec: true, favorita: true, usadaEm: true, criadoEm: true, compartilhada: true },
    })
    // RECENTES saem da mesma tabela: `usadaEm` já responde, sem log paralelo.
    const recentes = visoes.filter((v) => v.usadaEm).slice(0, 5)

    // COMPARTILHADAS COM A EQUIPE (Bloco E7, 29/09/2026) — de QUALQUER dono,
    // mesmo domínio, `compartilhada = true`. Nunca inclui as próprias (já
    // estão em `visoes`) — ninguém vê a própria visão duplicada numa segunda lista.
    const compartilhadas = await prisma.relatorioVisao.findMany({
      where: { compartilhada: true, usuarioId: { not: usuarioId }, ...(dominio ? { dominio } : {}) },
      orderBy: [{ nome: "asc" }],
      select: {
        id: true, dominio: true, nome: true, spec: true, criadoEm: true,
        usuario: { select: { nome: true } },
      },
    })

    return NextResponse.json({
      visoes, favoritas: visoes.filter((v) => v.favorita), recentes,
      compartilhadas: compartilhadas.map((v) => ({ ...v, donoNome: v.usuario.nome, usuario: undefined })),
    })
  } catch (e) {
    console.error("GET relatorios/visoes", e)
    return NextResponse.json({ error: "Erro ao carregar visões." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const erro = await verificarPermissao(request, "relatorios.ver")
  if (erro) return erro
  try {
    const usuarioId = await dono(request)
    if (!usuarioId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

    const b = await request.json()
    const nome = String(b?.nome ?? "").trim()
    const spec = b?.spec as QuerySpec | undefined
    if (!nome) return NextResponse.json({ error: "Dê um nome à visão." }, { status: 400 })
    if (!spec || !dominioPorChave(spec.dominio)) {
      return NextResponse.json({ error: "Domínio não encontrado." }, { status: 400 })
    }
    // O RESULTADO NÃO ENTRA. Só a configuração da pergunta é persistida.
    const limpa: QuerySpec = {
      dominio: spec.dominio,
      nacionalidade: spec.nacionalidade ?? null,
      filtros: Array.isArray(spec.filtros) ? spec.filtros : [],
      agruparPor: spec.agruparPor ?? null,
      colunas: Array.isArray(spec.colunas) ? spec.colunas : undefined,
      ordenarPor: spec.ordenarPor ?? null,
      direcao: spec.direcao ?? undefined,
    }

    const visao = await prisma.relatorioVisao.upsert({
      where: { usuarioId_dominio_nome: { usuarioId, dominio: spec.dominio, nome } },
      update: { spec: limpa as object, usadaEm: new Date() },
      create: { usuarioId, dominio: spec.dominio, nome, spec: limpa as object, usadaEm: new Date() },
      select: { id: true, dominio: true, nome: true, spec: true, favorita: true },
    })
    return NextResponse.json({ visao })
  } catch (e) {
    console.error("POST relatorios/visoes", e)
    return NextResponse.json({ error: "Erro ao salvar a visão." }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const erro = await verificarPermissao(request, "relatorios.ver")
  if (erro) return erro
  try {
    const usuarioId = await dono(request)
    if (!usuarioId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    const b = await request.json()
    const id = Number(b?.id)
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Visão inválida." }, { status: 400 })

    // O `where` inclui o dono: ninguém favorita OU (des)compartilha a visão
    // de outro operador. Só o dono decide se a equipe vê a visão dele.
    const r = await prisma.relatorioVisao.updateMany({
      where: { id, usuarioId },
      data: {
        ...(b?.favorita !== undefined ? { favorita: !!b.favorita } : {}),
        ...(b?.usar ? { usadaEm: new Date() } : {}),
        ...(b?.compartilhada !== undefined ? { compartilhada: !!b.compartilhada } : {}),
      },
    })
    if (r.count === 0) return NextResponse.json({ error: "Visão não encontrada." }, { status: 404 })
    if (b?.compartilhada !== undefined) {
      const v = await prisma.relatorioVisao.findUnique({ where: { id }, select: { nome: true } })
      await prisma.logAuditoria.create({
        data: {
          acao: b.compartilhada ? "VISAO_COMPARTILHADA" : "VISAO_DESCOMPARTILHADA",
          entidade: "RelatorioVisao", entidadeId: id, usuarioId,
          descricao: `Visão "${v?.nome ?? id}" ${b.compartilhada ? "passou a ser compartilhada com a equipe" : "deixou de ser compartilhada"}.`,
          detalhes: { visaoId: id, compartilhada: !!b.compartilhada },
        },
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("PATCH relatorios/visoes", e)
    return NextResponse.json({ error: "Erro ao atualizar a visão." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const erro = await verificarPermissao(request, "relatorios.ver")
  if (erro) return erro
  try {
    const usuarioId = await dono(request)
    if (!usuarioId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    const id = Number(new URL(request.url).searchParams.get("id"))
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Visão inválida." }, { status: 400 })
    const r = await prisma.relatorioVisao.deleteMany({ where: { id, usuarioId } })
    if (r.count === 0) return NextResponse.json({ error: "Visão não encontrada." }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("DELETE relatorios/visoes", e)
    return NextResponse.json({ error: "Erro ao excluir a visão." }, { status: 500 })
  }
}
