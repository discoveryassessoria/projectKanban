// src/services/registral/reconciliacao-documental.ts
//
// MRG — RECONCILIAÇÃO COM O SISTEMA DOCUMENTAL (requisitos 6 e 10).
//
// REGRA DE OURO, verificada por scripts/mrg-arquitetura-guard.test.ts: este
// serviço NÃO decide status documental. Ele traduz o que o motor registral
// concluiu em CHAMADAS aos serviços oficiais do Sistema Documental
// (`services/necessidade-documental`), e nada mais. Não existe status documental
// dentro do domínio da árvore, não existe pasta paralela, não existe cópia de
// documento.
//
// O que a chegada de uma certidão pode produzir, e por qual caminho:
//   · satisfazer necessidade            → atenderNecessidade()          [automático quando inequívoco]
//   · satisfazer parcialmente           → proposta (aprovação humana)
//   · ser insuficiente                  → conflito + necessidade segue aberta
//   · conter divergência                → conflito + fato DIVERGENTE
//   · exigir inteiro teor / tradução /
//     apostilamento / retificação       → proposta CRIAR_NECESSIDADE (item mestre correspondente)
//   · gerar nova necessidade            → proposta CRIAR_NECESSIDADE
//   · tornar necessidade inaplicável    → proposta (dispensa é decisão humana)
//   · reabrir necessidade               → proposta REABRIR_NECESSIDADE

import { prisma } from "@/lib/prisma"
import { chaveProposta } from "@/src/lib/genealogia/registral/chaves"
import type { PropostaMontada, TipoPropostaRegistral } from "@/src/lib/genealogia/registral/tipos"
import { atenderNecessidade } from "@/src/services/necessidade-documental"
import { auditar } from "./auditoria"
import { ACOES_AUDITORIA } from "./constantes"
import { camposDoItemMestre } from "./estado"
import { persistirProposta } from "./propostas-db"

/**
 * Status de Documento que o Sistema Documental considera CONCLUÍDO. A lista é o
 * vocabulário do enum StatusDocumento — a árvore não inventa status documental,
 * apenas reconhece os que o dono do domínio definiu.
 */
const DOCUMENTO_CONCLUIDO = new Set<string>(["ENTREGUE", "APOSTILADO", "TRADUZIDO", "RECEBIDO"])

export interface ResultadoReconciliacaoDocumental {
  necessidadesAvaliadas: number
  necessidadesAtendidas: number
  propostasCriadas: number
  insuficientes: number
  divergentes: number
}

/**
 * Reconcilia a Pasta Documental do processo com o que o motor registral apurou.
 *
 * Idempotente: chamar duas vezes não reabre necessidade atendida, não duplica
 * proposta e não cria segunda exigência do mesmo item para o mesmo sujeito.
 */
export async function reconciliarDocumentalDoProcesso(p: {
  processoId: number
  loteId?: number | null
  usuarioId?: number | null
}): Promise<ResultadoReconciliacaoDocumental> {
  const out: ResultadoReconciliacaoDocumental = {
    necessidadesAvaliadas: 0,
    necessidadesAtendidas: 0,
    propostasCriadas: 0,
    insuficientes: 0,
    divergentes: 0,
  }

  const necessidades = await prisma.necessidadeDocumental.findMany({
    where: { processoId: p.processoId, status: { in: ["PENDENTE", "EM_ATENDIMENTO", "NAO_LOCALIZADA"] } },
    select: {
      id: true,
      pessoaId: true,
      uniaoId: true,
      obrigatoriedade: true,
      status: true,
      itemCatalogo: { select: { id: true, code: true, name: true } },
      documentos: {
        select: {
          id: true,
          status: true,
          arquivo_url: true,
          traduzido: true,
          apostilado: true,
          execucoesRegistrais: {
            select: { id: true, etapa: true, camposExtraidos: true, camposDivergentes: true },
            orderBy: { id: "desc" },
            take: 1,
          },
        },
      },
    },
    orderBy: { id: "asc" },
  })

  const montadas: PropostaMontada[] = []
  const arvoreId = (
    await prisma.processo.findUnique({ where: { id: p.processoId }, select: { arvoreId: true } })
  )?.arvoreId ?? null

  for (const n of necessidades) {
    out.necessidadesAvaliadas++
    const comArquivo = n.documentos.filter((d) => !!d.arquivo_url)
    if (!comArquivo.length) continue

    const camposEsperados = camposDoItemMestre(n.itemCatalogo?.code, n.itemCatalogo?.name)
    const rotuloItem = n.itemCatalogo?.name ?? n.itemCatalogo?.code ?? `item #${n.itemCatalogo?.id}`

    // Estado registral apurado para o sujeito desta necessidade.
    const fatos = n.pessoaId != null
      ? await prisma.fatoRegistral.findMany({
          where: { pessoaId: n.pessoaId, ativo: true, campo: { in: camposEsperados } },
          select: { campo: true, estado: true },
        })
      : []

    const confirmados = fatos.filter(
      (f) => f.estado === "CONFIRMADO" || f.estado === "CONFIRMADO_MULTIPLAS_EVIDENCIAS",
    )
    const divergentes = fatos.filter(
      (f) => f.estado === "DIVERGENTE" || f.estado === "CONFLITANTE" || f.estado === "EM_REVISAO",
    )
    const execucoes = comArquivo.flatMap((d) => d.execucoesRegistrais)
    const houveLeitura = execucoes.length > 0
    const insuficiente = execucoes.some((e) => e.etapa === "DOCUMENTO_INSUFICIENTE" || e.etapa === "FALHA_LEITURA")

    // ---- (a) DIVERGENTE: o documento contradiz o cadastro. Necessidade NÃO é
    //      atendida; a divergência precisa de decisão.
    if (divergentes.length) {
      out.divergentes++
      montadas.push(
        montar({
          processoId: p.processoId,
          tipo: "MARCAR_DOCUMENTO_DIVERGENTE",
          alvoId: n.pessoaId,
          entidadeAlvo: "NECESSIDADE",
          valorProposto: `divergencia:${n.id}`,
          justificativa: `${rotuloItem}: o documento anexado divergiu em ${divergentes.length} campo(s) registral(is) (${divergentes.map((d) => d.campo).join(", ")}). Enquanto a divergência existir, a necessidade não pode ser considerada atendida.`,
          recomendacao: "Revisar a divergência e decidir entre corrigir o cadastro, aceitar variação ou solicitar retificação.",
          risco: "ALTO",
          dados: { necessidadeId: n.id, campos: divergentes.map((d) => d.campo) },
        }),
      )
      continue
    }

    // ---- (b) INSUFICIENTE: o arquivo está lá mas não dá para ler / não traz o
    //      que o item exige. É comum exigir INTEIRO TEOR.
    if (insuficiente || (houveLeitura && camposEsperados.length > 0 && confirmados.length === 0)) {
      out.insuficientes++
      const itemInteiroTeor = await itemDeInteiroTeorDe(n.itemCatalogo?.code)
      if (itemInteiroTeor) {
        montadas.push(
          montar({
            processoId: p.processoId,
            tipo: "CRIAR_NECESSIDADE",
            alvoId: n.pessoaId,
            entidadeAlvo: "NECESSIDADE",
            valorProposto: itemInteiroTeor.code,
            justificativa: `${rotuloItem}: o documento anexado não comprova os campos que o item exige (${camposEsperados.join(", ")}). O caminho documental para isso é a via de inteiro teor.`,
            recomendacao: `Abrir necessidade de ${itemInteiroTeor.name}.`,
            risco: "MEDIO",
            dados: { itemCatalogoId: itemInteiroTeor.id, pessoaId: n.pessoaId, uniaoId: n.uniaoId, origemNecessidadeId: n.id },
          }),
        )
      } else {
        montadas.push(
          montar({
            processoId: p.processoId,
            tipo: "MARCAR_DOCUMENTO_DIVERGENTE",
            alvoId: n.pessoaId,
            entidadeAlvo: "NECESSIDADE",
            valorProposto: `insuficiente:${n.id}`,
            justificativa: `${rotuloItem}: documento insuficiente — a leitura não confirmou nenhum dos campos exigidos (${camposEsperados.join(", ") || "sem campos mapeados"}).`,
            recomendacao: "Conferir o arquivo anexado; pode ser necessária nova via ou inteiro teor.",
            risco: "MEDIO",
            dados: { necessidadeId: n.id, campos: camposEsperados },
          }),
        )
      }
      continue
    }

    // ---- (c) ATENDIDA: todos os campos que o item mestre comprova estão
    //      confirmados por evidência. Transição pelo SERVIÇO OFICIAL.
    const cobertura = camposEsperados.length
      ? confirmados.length / camposEsperados.length
      : comArquivo.some((d) => DOCUMENTO_CONCLUIDO.has(d.status))
        ? 1
        : 0

    if (cobertura >= 1) {
      const antes = n.status
      await atenderNecessidade(n.id, prisma)
      const depois = await prisma.necessidadeDocumental.findUnique({
        where: { id: n.id },
        select: { status: true },
      })
      if (depois?.status === "ATENDIDA" && antes !== "ATENDIDA") out.necessidadesAtendidas++
      continue
    }

    // ---- (d) PARCIAL: parte dos campos confirmada. Nunca atende sozinho.
    if (cobertura > 0) {
      montadas.push(
        montar({
          processoId: p.processoId,
          tipo: "SATISFAZER_NECESSIDADE",
          alvoId: n.id,
          entidadeAlvo: "NECESSIDADE",
          valorProposto: `parcial:${Math.round(cobertura * 100)}%`,
          justificativa: `${rotuloItem}: o documento confirma ${confirmados.length} de ${camposEsperados.length} campo(s) exigido(s) (${Math.round(cobertura * 100)}%). Atendimento parcial não fecha a necessidade automaticamente.`,
          recomendacao: "Conferir se o que falta é exigível neste processo e decidir.",
          risco: "MEDIO",
          dados: { necessidadeId: n.id, confirmados: confirmados.map((c) => c.campo), esperados: camposEsperados },
        }),
      )
    }

    // ---- (e) TRADUÇÃO / APOSTILAMENTO: exigência derivada do documento.
    for (const d of comArquivo) {
      if (!d.traduzido) {
        const item = await itemPorPalavraChave("TRADU")
        if (item) {
          montadas.push(
            montar({
              processoId: p.processoId,
              tipo: "CRIAR_NECESSIDADE",
              alvoId: n.pessoaId,
              entidadeAlvo: "NECESSIDADE",
              valorProposto: `traducao:${d.id}`,
              justificativa: `O documento #${d.id} que atende ${rotuloItem} ainda não está traduzido.`,
              recomendacao: `Abrir necessidade de ${item.name}.`,
              risco: "BAIXO",
              dados: { itemCatalogoId: item.id, pessoaId: n.pessoaId, documentoId: d.id },
            }),
          )
        }
      }
      if (!d.apostilado) {
        const item = await itemPorPalavraChave("APOSTIL")
        if (item) {
          montadas.push(
            montar({
              processoId: p.processoId,
              tipo: "CRIAR_NECESSIDADE",
              alvoId: n.pessoaId,
              entidadeAlvo: "NECESSIDADE",
              valorProposto: `apostila:${d.id}`,
              justificativa: `O documento #${d.id} que atende ${rotuloItem} ainda não está apostilado.`,
              recomendacao: `Abrir necessidade de ${item.name}.`,
              risco: "BAIXO",
              dados: { itemCatalogoId: item.id, pessoaId: n.pessoaId, documentoId: d.id },
            }),
          )
        }
      }
    }
  }

  // ---- (f) NECESSIDADE NOVA a partir de pessoa que o lote acrescentou à linha:
  //      pessoa na ascendência do requerente sem certidão de nascimento exigida.
  montadas.push(...(await necessidadesFaltantesDaLinha(p.processoId)))

  for (const m of montadas) {
    const r = await persistirProposta({
      processoId: p.processoId,
      arvoreId,
      loteId: p.loteId ?? null,
      execucaoId: null,
      correlationId: `mrg-doc-${p.processoId}`,
      montada: m,
    })
    if (r.criada) out.propostasCriadas++
  }

  await auditar(prisma, {
    acao: ACOES_AUDITORIA.RECONCILIACAO_DOCUMENTAL,
    entidade: "Processo",
    entidadeId: p.processoId,
    descricao: `Reconciliação documental: ${out.necessidadesAtendidas} atendida(s), ${out.propostasCriadas} proposta(s), ${out.insuficientes} insuficiente(s), ${out.divergentes} divergente(s).`,
    detalhes: out as unknown as Record<string, unknown>,
    usuarioId: p.usuarioId ?? null,
  })

  return out
}

// ============================================================================
// helpers
// ============================================================================

function montar(p: {
  processoId: number
  tipo: TipoPropostaRegistral
  entidadeAlvo: string
  alvoId: number | null
  valorProposto: string
  justificativa: string
  recomendacao: string
  risco: "CRITICO" | "ALTO" | "MEDIO" | "BAIXO" | "INFO"
  dados: Record<string, unknown>
}): PropostaMontada {
  return {
    operacao: {
      tipo: p.tipo,
      entidadeAlvo: p.entidadeAlvo,
      alvoId: p.alvoId,
      campo: null,
      valorAtual: null,
      valorProposto: p.valorProposto,
      dados: p.dados,
    },
    // Toda alteração documental proposta aqui é APROVAÇÃO HUMANA: quem decide
    // exigência documental é o Sistema Documental com um operador, não o motor.
    criticidade: "APROVACAO_HUMANA",
    aplicavelAutomaticamente: false,
    confianca: 0.8,
    justificativa: p.justificativa,
    regraAplicada: `MRG-DOCUMENTAL-${p.tipo}`,
    recomendacao: p.recomendacao,
    risco: p.risco,
    evidenciasFavoraveis: [
      { campo: "documental", descricao: p.justificativa, favoravel: true, peso: 2 },
    ],
    evidenciasContrarias: [],
    origemValorAtual: "Sistema Documental (NecessidadeDocumental)",
    origemValorProposto: "Motor registral genealógico",
    pessoasAfetadas: p.alvoId != null && p.entidadeAlvo === "PESSOA" ? [p.alvoId] : [],
    chaveIdempotencia: chaveProposta({
      processoId: p.processoId,
      tipo: p.tipo,
      entidadeAlvo: p.entidadeAlvo,
      alvoId: p.alvoId,
      campo: null,
      valorProposto: p.valorProposto,
    }),
  }
}

/** Item mestre de INTEIRO TEOR correspondente a um item comum. */
async function itemDeInteiroTeorDe(code?: string | null): Promise<{ id: number; code: string; name: string } | null> {
  if (!code) return null
  const base = code.toUpperCase()
  const raiz = base.includes("NASC") ? "NASC" : base.includes("CASAM") ? "CASAM" : base.includes("OBITO") ? "OBITO" : null
  if (!raiz) return null
  const item = await prisma.itemCatalogo.findFirst({
    where: {
      ativo: true,
      AND: [
        { OR: [{ code: { contains: raiz, mode: "insensitive" } }, { name: { contains: raiz, mode: "insensitive" } }] },
        {
          OR: [
            { code: { contains: "INTEIRO", mode: "insensitive" } },
            { name: { contains: "inteiro teor", mode: "insensitive" } },
          ],
        },
      ],
    },
    select: { id: true, code: true, name: true },
  })
  return item
}

async function itemPorPalavraChave(chave: string): Promise<{ id: number; code: string; name: string } | null> {
  return prisma.itemCatalogo.findFirst({
    where: {
      ativo: true,
      OR: [{ code: { contains: chave, mode: "insensitive" } }, { name: { contains: chave, mode: "insensitive" } }],
    },
    select: { id: true, code: true, name: true },
  })
}

/**
 * Pessoas na ascendência do requerente que NÃO têm necessidade de certidão de
 * nascimento no processo. É a exigência que aparece quando o lote acrescenta
 * gerações à linha.
 */
async function necessidadesFaltantesDaLinha(processoId: number): Promise<PropostaMontada[]> {
  const proc = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { arvoreId: true },
  })
  if (!proc?.arvoreId) return []

  const itemNascimento = await prisma.itemCatalogo.findFirst({
    where: {
      ativo: true,
      OR: [{ code: { contains: "NASC", mode: "insensitive" } }, { name: { contains: "nascimento", mode: "insensitive" } }],
      NOT: { OR: [{ code: { contains: "INTEIRO", mode: "insensitive" } }, { name: { contains: "inteiro teor", mode: "insensitive" } }] },
    },
    select: { id: true, code: true, name: true },
  })
  if (!itemNascimento) return []

  const pessoas = await prisma.pessoa.findMany({
    where: { arvoreId: proc.arvoreId, linhaReta: true },
    select: { id: true, nome: true, sobrenome: true },
    orderBy: { id: "asc" },
  })
  const jaExistem = new Set(
    (
      await prisma.necessidadeDocumental.findMany({
        where: { processoId, itemCatalogoId: itemNascimento.id, pessoaId: { not: null } },
        select: { pessoaId: true },
      })
    )
      .map((n) => n.pessoaId)
      .filter((x): x is number => x != null),
  )

  return pessoas
    .filter((p) => !jaExistem.has(p.id))
    .map((p) =>
      montar({
        processoId,
        tipo: "CRIAR_NECESSIDADE",
        entidadeAlvo: "PESSOA",
        alvoId: p.id,
        valorProposto: `${itemNascimento.code}:${p.id}`,
        justificativa: `${[p.nome, p.sobrenome].filter(Boolean).join(" ")} está na linha reta do processo e não tem exigência de ${itemNascimento.name} cadastrada.`,
        recomendacao: `Abrir necessidade de ${itemNascimento.name} para esta pessoa.`,
        risco: "BAIXO",
        dados: { itemCatalogoId: itemNascimento.id, pessoaId: p.id },
      }),
    )
}
