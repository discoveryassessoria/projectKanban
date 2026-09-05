// src/app/api/processos/[processoId]/analise/importar/route.ts
//
// IMPORTA UM RELATÓRIO DE DIVERGÊNCIAS JÁ PRONTO (feito por um humano comparando
// as certidões — inclusive com a ajuda de uma conversa com o Claude fora do
// sistema) e grava exatamente nas MESMAS tabelas que o motor automático usa
// (`AnaliseDocumental`/`Divergencia`). Não é um motor novo, é uma PORTA DE
// ENTRADA a mais pros mesmos dados — a tela de Análise Documental não sabe (nem
// precisa saber) se a divergência veio do motor local ou de um relatório importado.
//
// Nunca lê nem grava nada da árvore como fonte de verdade: cada linha do
// relatório já vem com "valor no documento" e "valor correto" — os dois
// tirados de certidão, nunca de `Pessoa`.

import { NextResponse } from "next/server"
import { prisma } from "@/src/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

interface LinhaRelatorio {
  pessoa: string
  documento: string
  campo: string
  campoLabel?: string
  valorNoDocumento: string
  valorCorreto: string
  severidade?: string
  sugestao?: string
  decisao?: string
}

const SEVERIDADES = new Set(["baixa", "media", "critica"])
const DECISOES = new Set(["pendente", "aceita", "ressalva", "apoio_solicitado", "retificacao", "ignorada"])

const normaliza = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase()

function tipoDoTitulo(tituloBruto: string): string | null {
  const t = normaliza(tituloBruto)
  const it = t.includes("inteiro teor") || /\(it\)/.test(t)
  if (t.includes("nascimento")) return it ? "CERTIDAO_NASCIMENTO_INTEIRO_TEOR" : "CERTIDAO_NASCIMENTO"
  if (t.includes("casamento")) return it ? "CERTIDAO_CASAMENTO_INTEIRO_TEOR" : "CERTIDAO_CASAMENTO"
  if (t.includes("obito") || t.includes("óbito")) return it ? "CERTIDAO_OBITO_INTEIRO_TEOR" : "CERTIDAO_OBITO"
  return null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const erro = await verificarPermissao(request, "tarefas.iniciar_concluir")
  if (erro) return erro

  const { processoId } = await params
  const id = Number(processoId)
  if (!Number.isInteger(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const body = (await request.json().catch(() => ({}))) as { linhas?: LinhaRelatorio[] }
  const linhas = Array.isArray(body.linhas) ? body.linhas : []
  if (linhas.length === 0) {
    return NextResponse.json({ error: "RELATORIO_VAZIO", mensagem: "O relatório não tem nenhuma linha de divergência." }, { status: 422 })
  }
  for (const [i, l] of linhas.entries()) {
    if (!l.pessoa?.trim() || !l.campo?.trim() || !l.valorNoDocumento?.trim() && !l.valorCorreto?.trim()) {
      return NextResponse.json({ error: "LINHA_INCOMPLETA", mensagem: `Linha ${i + 1} do relatório está sem pessoa/campo/valores.` }, { status: 422 })
    }
  }

  const processo = await prisma.processo.findUnique({ where: { id }, select: { id: true, arvoreId: true } })
  if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

  const pessoas = processo.arvoreId
    ? await prisma.pessoa.findMany({
        where: { arvoreId: processo.arvoreId, linhaReta: true },
        select: { id: true, nome: true, sobrenome: true, numeroLinhagem: true, documentos: { select: { id: true, tipo: true } } },
      })
    : []
  const pessoaPorNome = new Map(pessoas.map((p) => [normaliza(`${p.nome} ${p.sobrenome ?? ""}`), p]))

  const analise = await prisma.$transaction(async (tx) => {
    let a = await tx.analiseDocumental.findUnique({ where: { processoId: id } })
    if (!a) {
      a = await tx.analiseDocumental.create({
        data: { processoId: id, status: "em_andamento", currentStep: "revisao_humana", startedAt: new Date() },
      })
    }

    for (const l of linhas) {
      const pessoa = pessoaPorNome.get(normaliza(l.pessoa))
      const tipo = tipoDoTitulo(l.documento || "")
      const documento = pessoa && tipo ? pessoa.documentos.find((d) => d.tipo === tipo) : undefined
      const severidade = SEVERIDADES.has(l.severidade ?? "") ? (l.severidade as string) : "media"
      const decisao = DECISOES.has(l.decisao ?? "") ? (l.decisao as string) : "pendente"

      await tx.divergencia.create({
        data: {
          analiseId: a.id,
          pessoaId: pessoa?.id ?? null,
          pessoaNome: l.pessoa.trim(),
          geracao: pessoa?.numeroLinhagem ?? null,
          linhaReta: true,
          documentoId: documento?.id ?? null,
          documentoTitulo: l.documento?.trim() || "Documento não identificado",
          campo: l.campo.trim(),
          campoLabel: l.campoLabel?.trim() || l.campo.trim(),
          valorArvore: l.valorCorreto?.trim() || null,
          valorDocumento: l.valorNoDocumento?.trim() || null,
          tipo: "importado",
          severidade,
          sugestaoIA: l.sugestao?.trim() || null,
          motivoIA: "Divergência importada de relatório externo — comparação entre certidões, feita fora do motor automático.",
          requerRetificacaoIA: severidade === "critica",
          status: decisao,
          ...(decisao !== "pendente" ? { decididoEm: new Date() } : {}),
        },
      })
    }

    const totalDivergencias = await tx.divergencia.count({ where: { analiseId: a.id } })
    const documentosCitados = await tx.divergencia.findMany({ where: { analiseId: a.id }, select: { documentoId: true, documentoTitulo: true }, distinct: ["documentoTitulo"] })

    return tx.analiseDocumental.update({
      where: { id: a.id },
      data: {
        camposComparados: totalDivergencias,
        documentosAnalisados: documentosCitados.length,
        totalDocumentos: Math.max(documentosCitados.length, a.totalDocumentos),
      },
      include: { divergencias: { orderBy: { id: "asc" } } },
    })
  }, { maxWait: 20_000, timeout: 60_000 })

  return NextResponse.json({ ok: true, analise, linhasImportadas: linhas.length })
}
