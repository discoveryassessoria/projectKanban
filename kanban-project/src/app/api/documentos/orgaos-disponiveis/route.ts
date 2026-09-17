// src/app/api/documentos/orgaos-disponiveis/route.ts
//
// LISTAGEM LEVE do cadastro de Órgãos e Organizações, pra vincular um documento
// ao seu órgão/cartório emissor (`Documento.orgaoId`) — não confundir com
// GET /api/gerenciamento/orgaos-protocolo, que é a tela de administração do
// cadastro inteiro (ficha completa, permissão de admin). Aqui é só "qual
// órgão", pela mesma permissão operacional que já edita o documento
// (`arvore.editar_documento`) — quem pode preencher "Dados Registrais" pode
// escolher o órgão emissor.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { resolverOrganizacao } from "@/src/services/organizacao-identidade"

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "arvore.editar_documento")
  if (erro) return erro
  const paisId = request.nextUrl.searchParams.get("paisId")
  try {
    const orgaos = await prisma.orgaoProtocolo.findMany({
      where: paisId ? { paisId: Number(paisId) } : undefined,
      orderBy: [{ pais: { countryLabel: "asc" } }, { name: "asc" }],
      select: {
        id: true, name: true, nomeFantasia: true, type: true, city: true, state: true,
        pais: { select: { id: true, countryLabel: true } },
      },
    })
    return NextResponse.json({ orgaos })
  } catch (e) {
    console.error("GET orgaos-disponiveis", e)
    return NextResponse.json({ error: "Erro ao carregar órgãos." }, { status: 500 })
  }
}

/**
 * CRIAÇÃO RÁPIDA de cartório — não confundir com o cadastro completo de
 * Órgãos e Organizações (consulados, tribunais, comuni), que é curado por um
 * admin e tem ficha inteira (financeiro, identificação fiscal, categorias).
 *
 * Achado real (15/09/2026): o Brasil tem milhares de cartórios de registro
 * civil — pedir que um admin pré-cadastre cada um antes de qualquer operador
 * conseguir pedir uma certidão não escala. Aqui é o quick-add operacional:
 * nome + cidade/país, `type: "cartorio"` fixo, e a MESMA identidade única
 * (`resolverOrganizacao` — nome oficial + país) que o cadastro completo usa,
 * pra não duplicar o mesmo cartório real sob dois registros.
 */
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "arvore.editar_documento")
  if (erro) return erro
  try {
    const b = await request.json().catch(() => ({} as Record<string, unknown>))
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 200) : ""
    if (!name) return NextResponse.json({ error: "Informe o nome do cartório." }, { status: 400 })
    const city = typeof b.city === "string" && b.city.trim() ? b.city.trim().slice(0, 100) : null
    const state = typeof b.state === "string" && b.state.trim() ? b.state.trim().slice(0, 60) : null
    // Endereço/telefone/email são opcionais — quando quem chama já os sabe (ex.:
    // espelhado da base nacional de Cartórios sincronizada), evita nascer com
    // ficha vazia só porque a criação rápida sempre pediu só nome+cidade.
    const endereco = typeof b.endereco === "string" && b.endereco.trim() ? b.endereco.trim().slice(0, 300) : null
    const telefone = typeof b.telefone === "string" && b.telefone.trim() ? b.telefone.trim().slice(0, 60) : null
    const email = typeof b.email === "string" && b.email.trim() ? b.email.trim().slice(0, 200) : null
    const paisIdRaw = Number(b.paisId)
    const paisId = Number.isInteger(paisIdRaw) && paisIdRaw > 0 ? paisIdRaw : null
    if (paisId != null) {
      const existe = await prisma.catalogoPais.findUnique({ where: { id: paisId }, select: { id: true } })
      if (!existe) return NextResponse.json({ error: "País não encontrado no Cadastro Mestre." }, { status: 400 })
    }

    // MESMA ENTIDADE, mesmo registro — não cria um segundo cartório com o
    // mesmo nome oficial no mesmo país.
    const resolucao = await resolverOrganizacao(prisma, { name, paisId })
    if (resolucao.id) {
      const atual = await prisma.orgaoProtocolo.findUnique({
        where: { id: resolucao.id },
        select: { city: true, state: true, endereco: true, telefone: true, email: true },
      })
      // SÓ PREENCHE LACUNA — nunca sobrescreve o que já existe (pode ter sido
      // digitado por um admin). Achado real, 16/09/2026: cartório criado só com
      // nome ficava com ficha vazia pra sempre; ao espelhar de novo com dados
      // completos (base nacional de Cartórios), completa o que faltava.
      const preencher: Record<string, string> = {}
      if (!atual?.city && city) preencher.city = city
      if (!atual?.state && state) preencher.state = state
      if (!atual?.endereco && endereco) preencher.endereco = endereco
      if (!atual?.telefone && telefone) preencher.telefone = telefone
      if (!atual?.email && email) preencher.email = email
      const orgao = await prisma.orgaoProtocolo.update({
        where: { id: resolucao.id },
        data: preencher,
        select: { id: true, name: true, nomeFantasia: true, type: true, city: true, state: true, endereco: true, telefone: true, email: true, pais: { select: { id: true, countryLabel: true } } },
      })
      return NextResponse.json({ orgao, jaExistia: true })
    }

    const usuario = await extrairUsuarioComPermissoes(request)
    const criado = await prisma.orgaoProtocolo.create({
      data: { name, city, state, endereco, telefone, email, paisId, type: "cartorio", funcoes: ["ORGAO"], ativo: true },
      select: { id: true, name: true, nomeFantasia: true, type: true, city: true, state: true, endereco: true, telefone: true, email: true, pais: { select: { id: true, countryLabel: true } } },
    })
    await prisma.logAuditoria.create({
      data: {
        acao: "ORGAO_CARTORIO_CRIADO_RAPIDO", entidade: "OrgaoProtocolo", entidadeId: criado.id,
        descricao: `Cartório "${name}" criado pelo quick-add (fora do cadastro admin).`,
        usuarioId: usuario?.userId ?? null,
      },
    }).catch(() => null)
    return NextResponse.json({ orgao: criado, jaExistia: false }, { status: 201 })
  } catch (e) {
    console.error("POST orgaos-disponiveis", e)
    return NextResponse.json({ error: "Erro ao criar cartório." }, { status: 500 })
  }
}
