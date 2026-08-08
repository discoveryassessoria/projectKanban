// src/app/api/processos/[processoId]/requerentes-disponiveis/route.ts
// ============================================================================
// Lista os Requerentes (participantes oficiais) do Processo para o SELETOR da
// Árvore Genealógica. Alimenta o fluxo de REUSO — a árvore vincula uma Pessoa a
// partir daqui em vez de criar uma nova. `jaNaArvore` indica se o requerente já
// é nó desta árvore (Pessoa vinculada com o mesmo arvoreId do processo).
// ============================================================================

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { VINCULO_PROCESSO_ATIVO } from "@/src/lib/genealogia/vinculo-ativo"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  const erro = await verificarPermissao(request, "arvore.ver")
  if (erro) return erro

  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const processo = await prisma.processo.findUnique({
      where: { id: processoId },
      select: { id: true, arvoreId: true },
    })
    if (!processo) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    // REQUERENTE DO PROCESSO ≠ MEMBRO DA ÁRVORE. São dois vínculos independentes:
    // um diz que a pessoa participa do processo; o outro, que ela é nó desta
    // árvore. Só o segundo tira o requerente da lista de disponíveis.
    const vinculos = await prisma.processoRequerente.findMany({
      where: { processoId, ...VINCULO_PROCESSO_ATIVO },
      include: { requerente: { include: { pessoa: true } } },
    })

    const requerentes = vinculos.map(({ requerente }) => {
      const pessoa = requerente.pessoa
      // MEMBRO ATIVO exige as DUAS coisas: ser nó desta árvore E não ter sido
      // removido dela.
      //
      // Só `arvoreId` não basta — e este era o defeito. A remoção de pessoa é
      // SOFT (`removidaEm`), porque fato histórico protegido precisa continuar
      // apontando para alguém (ver `vinculo-ativo.ts`). Com o predicado antigo,
      // quem fosse removido da árvore continuava contando como membro e sumia da
      // lista para sempre: o requerente ficava impossível de reinserir, sem
      // nenhuma mensagem dizendo por quê.
      const membroAtivo =
        processo.arvoreId != null &&
        pessoa?.arvoreId === processo.arvoreId &&
        pessoa?.removidaEm == null

      return {
        requerenteId: requerente.id,
        nome: requerente.nome,
        personId: requerente.personId ?? null,
        sexo: requerente.sexo ?? null,
        dataNascimento: requerente.dataNascimento ?? null,
        nacionalidade: requerente.nacionalidade ?? null,
        jaNaArvore: membroAtivo,
        // O backend entrega o estado DECIDIDO; o front só renderiza. Inferir
        // disponibilidade na tela é como a regra se perde de novo.
        alreadyInTree: membroAtivo,
        availableForTree: !membroAtivo,
        /** Esteve na árvore e foi removida — pode ser reinserida. */
        removidaDaArvore:
          pessoa?.arvoreId === processo.arvoreId && pessoa?.removidaEm != null,
      }
    })

    return NextResponse.json({
      arvoreId: processo.arvoreId,
      requerentes,
      totalRequerentes: requerentes.length,
      disponiveis: requerentes.filter((r) => r.availableForTree).length,
    })
  } catch (error) {
    console.error("[GET /api/processos/[processoId]/requerentes-disponiveis]", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
