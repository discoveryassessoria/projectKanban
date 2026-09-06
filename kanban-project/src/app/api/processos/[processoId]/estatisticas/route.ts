// src/app/api/processos/[processoId]/estatisticas/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

type AlertaSev = "crit" | "warn" | "info"

interface EstatisticasResponse {
  linhagem: {
    emLinhaDireta: number
    origem: string | null
    requerentePrincipal: string | null
  }
  documentacao: {
    recebidos: number
    total: number
    percentual: number
  }
  risco: {
    bloqueantes: number
    graves: number
  }
  protocolo: {
    apto: boolean
    impeditivos: number
  }
  alertas: Array<{ sev: AlertaSev; label: string }>
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // 1) Carrega o processo (precisa do arvoreId e pais)
    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, arvoreId: true, paisId: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } } },
    })

    if (!processo) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    // 2) Carrega as pessoas da árvore vinculada ao processo
    const pessoas = processo.arvoreId
      ? await prisma.pessoa.findMany({
          where: { arvoreId: processo.arvoreId },
          select: {
            id: true,
            nome: true,
            sobrenome: true,
            numeroLinhagem: true,
            linhaReta: true,
            requerente: true,
          },
        })
      : []

    // "Em linha direta" é `linhaReta`, não "tem numeroLinhagem" — o cônjuge
    // HERDA o número do parceiro de sangue (ver numero-linhagem.ts, é assim
    // de propósito para a pasta documental ficar agrupada), então usar
    // `numeroLinhagem != null` como proxy contava o cônjuge como linha direta
    // e podia até virar "origem" da linhagem (achado real: Edithe, cônjuge,
    // aparecendo como origem no lugar de Antonio).
    const pessoasNaLinha = pessoas.filter((p) => p.linhaReta === true)

    // Origem = pessoa de sangue com MENOR numeroLinhagem (o ancestral mais
    // antigo — Nº Linhagem começa em 1 na raiz da árvore e cresce em direção
    // aos descendentes; ver src/services/genealogia/numero-linhagem.ts).
    const origemPessoa = pessoasNaLinha.reduce<typeof pessoas[number] | null>(
      (min, p) => (min == null || (p.numeroLinhagem ?? Infinity) < (min.numeroLinhagem ?? Infinity) ? p : min),
      null
    )

    // Requerente principal = pessoa com requerente='maior'
    const requerentePrincipal = pessoas.find((p) => p.requerente === "maior") || null

    const nomeCompleto = (p: { nome: string; sobrenome: string | null }) =>
      `${p.nome}${p.sobrenome ? " " + p.sobrenome : ""}`

    // 3) Conta documentos das pessoas da árvore
    const pessoaIds = pessoas.map((p) => p.id)

    // CANCELADO/INVALIDO fora da conta — a exigência acabou (cancelada) ou está
    // sendo refeita por outra via (invalidada); nenhum dos dois é "documento a
    // receber" pendente. Sem isto, um documento corretamente dispensado
    // continuava contando no denominador desta tela (achado real: Antonio,
    // óbito; Edithe, ambas certidões — "3 de 6" com só 3 documentos de verdade
    // exigidos).
    const [totalDocs, recebidosDocs] = pessoaIds.length
      ? await Promise.all([
          prisma.documento.count({ where: { pessoaId: { in: pessoaIds }, status: { notIn: ["CANCELADO", "INVALIDO"] } } }),
          prisma.documento.count({
            where: { pessoaId: { in: pessoaIds }, status: "RECEBIDO" },
          }),
        ])
      : [0, 0]

    const percentual = totalDocs > 0 ? Math.round((recebidosDocs / totalDocs) * 100) : 0

    // 4) Risco — ainda não existe conceito de "divergência" no schema.
    //    Mantemos zerado até o modelo ser implementado.
    const risco = { bloqueantes: 0, graves: 0 }

    // 5) Protocolo — para Espanha, conta os protocolos cadastrados.
    let protocoloImpeditivos = 0
    // IDENTIDADE, NÃO NOME. Este `if` comparava com "ESPANHA" em maiúsculas
    // enquanto o banco grava a chave do cadastro em minúsculas ('espanha') —
    // ele NUNCA era verdadeiro, e o contador ficava zerado sem ninguém notar.
    // É o caso exemplar de por que relacionamento por texto não pode existir.
    if (processo.paisId != null
      ? processo.paisCanonico?.countryKey === "espanha"
      : ((processo.paisCanonico?.countryKey ?? null) ?? "").toLowerCase() === "espanha") {
      protocoloImpeditivos = await prisma.protocolo.count({
        where: { processoId: id, dataProtocolo: null },
      })
    }
    // Análise Documental — impeditivo UNIVERSAL (todo país passa por ela).
    // "Apto" para protocolar não pode ser "documento chegou": chegou errado
    // (nome/data/filiação divergente da árvore) e ninguém revisou ainda é
    // exatamente o que a Análise Documental existe para pegar ANTES do
    // protocolo, não depois.
    const divergenciasAbertas = await prisma.divergencia.count({
      where: {
        analise: { processoId: id },
        status: { in: ["pendente", "apoio_solicitado", "retificacao"] },
      },
    })
    // "Análise deu o OK" é a CONCLUSÃO (analiseDocumental.status="concluida"),
    // não o algoritmo ter rodado por baixo. Rodar a comparação e olhar o
    // resultado sem clicar em "concluir análise" não é aprovação — sem isto
    // o processo virava "Apto" com a própria fase de Análise Documental ainda
    // em 0% / "Em andamento".
    const analiseDocumental = await prisma.analiseDocumental.findUnique({
      where: { processoId: id },
      select: { status: true },
    })
    const analiseConcluida = analiseDocumental?.status === "concluida"
    const impeditivos = protocoloImpeditivos + divergenciasAbertas
    // "Apto" deriva do que já sabemos contar (impeditivos) + da Análise
    // Documental estar de fato concluída. Fixo em `false` dizia "Não apto"
    // mesmo com 0 impeditivo(s) — contradição visível no card. Sem regra
    // formal completa no schema ainda, mas isto já é um critério real.
    const protocolo = { apto: impeditivos === 0 && analiseConcluida, impeditivos }

    // 6) Alertas executivos — derivados dos contadores acima
    const alertas: Array<{ sev: AlertaSev; label: string }> = []

    if (!requerentePrincipal) {
      alertas.push({ sev: "warn", label: "Sem requerente principal definido" })
    }
    if (pessoasNaLinha.length === 0) {
      alertas.push({ sev: "warn", label: "Linhagem ainda não foi definida na árvore" })
    } else if (!origemPessoa) {
      alertas.push({ sev: "info", label: "Origem da linhagem não identificada" })
    }

    const pendentes = totalDocs - recebidosDocs
    if (pendentes > 0) {
      alertas.push({
        sev: "info",
        label: `${pendentes} documento(s) ainda não recebido(s)`,
      })
    }
    if (divergenciasAbertas > 0) {
      alertas.push({
        sev: "warn",
        label: `${divergenciasAbertas} divergência(s) da Análise Documental sem decisão`,
      })
    } else if (!analiseConcluida) {
      alertas.push({
        sev: "info",
        label: "Análise Documental ainda não foi concluída",
      })
    }

    // 7) Monta resposta
    const response: EstatisticasResponse = {
      linhagem: {
        emLinhaDireta: pessoasNaLinha.length,
        origem: origemPessoa ? nomeCompleto(origemPessoa) : null,
        requerentePrincipal: requerentePrincipal ? nomeCompleto(requerentePrincipal) : null,
      },
      documentacao: {
        recebidos: recebidosDocs,
        total: totalDocs,
        percentual,
      },
      risco,
      protocolo,
      alertas,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("[GET /api/processos/[processoId]/estatisticas]", error)
    return NextResponse.json(
      { error: "Erro ao buscar estatísticas" },
      { status: 500 }
    )
  }
}