// src/app/api/processos/[processoId]/genealogia/operacional/route.ts
//
// FATOS OPERACIONAIS DA ÁRVORE — uma leitura, somente leitura.
//
// Por que existe: o painel da pessoa na árvore precisa de exigência documental,
// tarefa, custo e receita da MESMA pessoa. Sem este endpoint a tela faria quatro
// chamadas, três delas trazendo o processo inteiro para descartar 95% no
// cliente, e a quarta vazando valor financeiro para quem não pode vê-lo.
//
// O que ele NÃO é: uma segunda fonte. Cada bloco abaixo lê a tabela que já é
// dona do assunto e devolve o mínimo:
//   • necessidades → NecessidadeDocumental (Sistema Documental)
//   • tarefas      → Tarefa do processo, com a necessidade que a originou
//   • lançamentos  → ObrigacaoEconomica + SaldoProjecao (Ledger V3)
//
// Nada é criado, nada é derivado, nenhum status é inferido. Um GET que escreve
// é o defeito que já apagou a planilha documental uma vez.
//
// GATE FINANCEIRO: ver a árvore não é ver o dinheiro. Quem não tem
// `financeiro.ver` recebe `lancamentos: []` com `financeiroVisivel: false` — o
// painel então diz "sem permissão para ver valores" em vez de exibir zero, que
// seria informação falsa.

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes, verificarPermissao } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"
import { resolveSlaProjection } from "@/src/lib/process-stage/sla-projection"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const semPermissao = await verificarPermissao(request, "arvore.ver")
  if (semPermissao) return semPermissao

  try {
    const { processoId } = await params
    const id = Number.parseInt(processoId)
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: "processoId inválido" }, { status: 400 })
    }

    const usuario = await extrairUsuarioComPermissoes(request)
    const financeiroVisivel = Boolean(
      usuario && temPermissao(usuario.permissoes, "financeiro.ver"),
    )

    const [necessidadesRaw, tarefasRaw, lancamentosRaw, sla] = await Promise.all([
      prisma.necessidadeDocumental.findMany({
        where: { processoId: id },
        select: {
          id: true,
          pessoaId: true,
          uniaoId: true,
          status: true,
          obrigatoriedade: true,
          ciclo: true,
          itemCatalogo: { select: { id: true, code: true, name: true } },
        },
        orderBy: { id: "asc" },
      }),
      prisma.tarefa.findMany({
        where: { processoId: id },
        select: {
          id: true,
          titulo: true,
          concluida: true,
          statusTarefa: true,
          prioridade: true,
          dataPrazo: true,
          necessidadeId: true,
          responsavel: { select: { nome: true } },
          necessidade: { select: { pessoaId: true } },
        },
        orderBy: { id: "asc" },
      }),
      financeiroVisivel
        ? prisma.obrigacaoEconomica.findMany({
            // Cancelada e arquivada saem: o painel mostra compromisso vivo. Trazer
            // o cancelado inflaria o total da pessoa sem que ela deva nada.
            where: {
              processoId: id,
              personId: { not: null },
              status: { not: "CANCELADO" },
              arquivadaEm: null,
            },
            select: {
              id: true,
              natureza: true,
              codigoOperacional: true,
              observacoes: true,
              moedaContratual: true,
              valorContratado: true,
              status: true,
              personId: true,
              saldoProjecao: { select: { recebidoLiquido: true, saldo: true } },
            },
            orderBy: { id: "asc" },
          })
        : Promise.resolve([]),
      // PRAZO: vem da engine ÚNICA de SLA, derivado na leitura. A árvore não
      // estima prazo por contagem de documento — seria uma segunda engine de
      // prazo dizendo outro número na mesma tela.
      resolveSlaProjection(id),
    ])

    const necessidades = necessidadesRaw.map((n) => ({
      id: n.id,
      pessoaId: n.pessoaId,
      uniaoId: n.uniaoId,
      status: n.status,
      obrigatoriedade: n.obrigatoriedade,
      ciclo: n.ciclo,
      itemCatalogo: n.itemCatalogo,
    }))

    const tarefas = tarefasRaw.map((t) => ({
      id: t.id,
      titulo: t.titulo,
      concluida: t.concluida,
      statusTarefa: t.statusTarefa,
      prioridade: t.prioridade,
      dataPrazo: t.dataPrazo ? t.dataPrazo.toISOString() : null,
      responsavel: t.responsavel?.nome ?? null,
      necessidadeId: t.necessidadeId,
      // O dono da tarefa é a pessoa da necessidade que a originou. Tarefa sem
      // necessidade é do processo, não de alguém — e fica com pessoaId nulo.
      pessoaId: t.necessidade?.pessoaId ?? null,
    }))

    const lancamentos = lancamentosRaw.map((o) => ({
      id: o.id,
      natureza: o.natureza,
      descricao: o.codigoOperacional ?? o.observacoes ?? `Obrigação #${o.id}`,
      moeda: String(o.moedaContratual),
      valor: Number(o.valorContratado),
      recebido: o.saldoProjecao ? Number(o.saldoProjecao.recebidoLiquido) : null,
      saldo: o.saldoProjecao ? Number(o.saldoProjecao.saldo) : null,
      status: o.status,
      pessoaId: o.personId,
    }))

    const prazo = sla.configurado
      ? {
          rotuloDias: sla.rotuloDias,
          rotuloStatus: sla.rotuloStatus,
          status: sla.status,
          diasParaVencimento: sla.diasParaVencimento,
          prazoPrevisto: sla.prazoPrevisto,
          configurado: true,
        }
      : null

    return NextResponse.json({ necessidades, tarefas, lancamentos, financeiroVisivel, prazo })
  } catch (error) {
    console.error("GET genealogia/operacional", error)
    return NextResponse.json({ error: "Erro ao ler os fatos operacionais da árvore." }, { status: 500 })
  }
}
