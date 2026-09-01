// src/app/api/relatorios/protocolos/route.ts
//
// RELATÓRIO DE PROTOCOLOS — a leitura que a operação pede.
//
// ─── POR QUE ESTA ROTA EXISTE ───────────────────────────────────────────────
// "Tudo que foi protocolado no Consulado de São Paulo em agosto", "todos os
// requerimentos da família Rovatti", "o que está com exigência vencendo". As três
// perguntas são a MESMA consulta com filtros diferentes — e passaram a ser
// possíveis quando o órgão virou FK para Órgãos e Organizações e o escopo virou
// tabela.
//
// Antes disto o relatório italiano era impossível: o tribunal morava num enum do
// schema (sem endereço, sem cidade, sem juntar com consulado) e o número do
// processo numa tabela que só a Itália tinha. Espanha e Itália agora respondem à
// mesma pergunta pela mesma porta — nenhuma linha deste arquivo sabe de país.
//
// SOMENTE LEITURA. Nenhuma escrita, nenhum efeito.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { Prisma } from "@prisma/client"
import { ondePaisEh } from "@/src/lib/identidade/canonica"

/** Fim do dia, para `ate` inclusivo — filtro de data que exclui o próprio dia é bug clássico. */
function fimDoDia(iso: string): Date {
  const d = new Date(iso)
  d.setHours(23, 59, 59, 999)
  return d
}

export async function GET(request: Request) {
  try {
    const erro = await verificarPermissao(request, "processos.ver_paginas")
    if (erro) return erro

    const q = new URL(request.url).searchParams
    const num = (k: string) => {
      const v = parseInt(q.get(k) ?? "")
      return Number.isInteger(v) ? v : null
    }

    const orgaoId = num("orgaoId")
    const familiaId = num("familiaId")
    const processoId = num("processoId")
    const requerenteId = num("requerenteId")
    const orgaoTipo = q.get("orgaoTipo")          // consulado | tribunal | comune…
    // PAÍS DO ÓRGÃO — por identidade. É dimensão SEPARADA da nacionalidade do
    // processo: o Consolato d'Italia em Miami fica nos Estados Unidos.
    const orgaoPaisId = Number(q.get("orgaoPaisId")) || null
    const paisProcesso = q.get("pais")            // país do PROCESSO
    const finalidade = q.get("finalidade")
    const situacao = q.get("situacao")
    const de = q.get("de")
    const ate = q.get("ate")
    const comExigenciaAberta = q.get("exigenciaAberta") === "1"

    const where: Prisma.ProtocoloWhereInput = {
      ...(orgaoId != null ? { orgaoId } : {}),
      ...(processoId != null ? { processoId } : {}),
      ...(finalidade ? { finalidade } : {}),
      ...(situacao ? { situacao } : {}),
      ...(orgaoTipo || orgaoPaisId != null
        ? { orgao: { ...(orgaoTipo ? { type: orgaoTipo } : {}), ...(orgaoPaisId != null ? { paisId: orgaoPaisId } : {}) } }
        : {}),
      // NACIONALIDADE POR IDENTIDADE. Comparar `Processo.pais` com o texto do
      // filtro funcionava por coincidência: os dois usavam a mesma grafia. A
      // cláusula agora sai de `ondePaisEh`, que casa pela FK do cadastro e só
      // cai no texto para linha que ainda não tem identidade.
      ...(familiaId != null || paisProcesso
        ? { processo: { ...(familiaId != null ? { familiaId } : {}), ...ondePaisEh(paisProcesso) } }
        : {}),
      // O filtro por requerente atravessa o ESCOPO — é assim que a mesma pergunta
      // serve à Espanha (uma pessoa, um protocolo) e à Itália (uma pessoa dentro
      // de um protocolo que cobre a família).
      ...(requerenteId != null ? { requerentesCobertos: { some: { requerenteId } } } : {}),
      ...(de || ate
        ? { dataProtocolo: { ...(de ? { gte: new Date(de) } : {}), ...(ate ? { lte: fimDoDia(ate) } : {}) } }
        : {}),
      ...(comExigenciaAberta ? { exigencias: { some: { cumpridaEm: null } } } : {}),
    }

    const protocolos = await prisma.protocolo.findMany({
      where,
      select: {
        id: true,
        publicCode: true,
        numeroProtocolo: true,
        numeroProcesso: true,
        dataProtocolo: true,
        finalidade: true,
        situacao: true,
        situacaoEm: true,
        tipo: { select: { id: true, code: true, nome: true } },
        formaEnvio: true,
        setor: true,
        orgao: {
          select: {
            id: true, publicCode: true, name: true, type: true, city: true,
            paisId: true, pais: { select: { id: true, countryKey: true, countryLabel: true } },
          },
        },
        responsavel: { select: { id: true, nome: true } },
        processo: {
          select: {
            id: true, codigo: true, nome: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } },
            familia: { select: { id: true, nome: true } },
            enquadramentoLegal: {
              select: {
                code: true, nome: true,
                modalidadeLegal: { select: { code: true, nome: true, cardinalidadeRequerimento: true } },
              },
            },
          },
        },
        requerentesCobertos: {
          select: { requerente: { select: { id: true, publicCode: true, nome: true, cidade: true, estado: true } } },
          orderBy: { requerenteId: "asc" },
        },
        exigencias: {
          select: { id: true, descricao: true, prazo: true, cumpridaEm: true },
          orderBy: [{ cumpridaEm: "asc" }, { prazo: "asc" }],
        },
        _count: { select: { documentos: true, anexos: true } },
      },
      orderBy: [{ dataProtocolo: "desc" }, { id: "desc" }],
      take: 2000,
    })

    const linhas = protocolos.map((p) => ({
      ...p,
      requerentes: p.requerentesCobertos.map((r) => r.requerente),
      requerentesCobertos: undefined,
      exigenciasAbertas: p.exigencias.filter((e) => e.cumpridaEm == null).length,
    }))

    // AGREGADO POR ÓRGÃO — a leitura gerencial ("quanto tem em cada consulado")
    // sai da MESMA consulta. Somar na tela produziria um número que a lista não
    // confirma quando houver paginação.
    const porOrgao = new Map<string, { orgaoId: number | null; nome: string; tipo: string | null; pais: string | null; total: number; requerentes: number }>()
    for (const p of linhas) {
      const chave = String(p.orgao?.id ?? "sem-orgao")
      const atual = porOrgao.get(chave) ?? {
        orgaoId: p.orgao?.id ?? null,
        nome: p.orgao?.name ?? "— sem órgão —",
        tipo: p.orgao?.type ?? null,
        paisId: p.orgao?.paisId ?? null,
        pais: p.orgao?.pais?.countryLabel ?? null,
        total: 0,
        requerentes: 0,
      }
      atual.total += 1
      atual.requerentes += p.requerentes.length
      porOrgao.set(chave, atual)
    }

    return NextResponse.json({
      total: linhas.length,
      truncado: linhas.length === 2000,
      porOrgao: [...porOrgao.values()].sort((a, b) => b.total - a.total),
      protocolos: linhas,
    })
  } catch (error) {
    console.error("Erro no relatório de protocolos:", error)
    return NextResponse.json({ error: "Erro ao gerar o relatório de protocolos" }, { status: 500 })
  }
}
