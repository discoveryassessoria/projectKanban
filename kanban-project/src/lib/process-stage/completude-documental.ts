// src/lib/process-stage/completude-documental.ts
//
// FONTE ÚNICA DE "QUANTO ESTÁ PRONTO" — unificação de 3 implementações que
// calculavam a mesma pergunta com regras diferentes (achado real, rodada
// "unificação de completude documental", 27/09/2026):
//
//   1. resolveOperationalProjection/Batch — conta NecessidadeDocumental
//      (inclui necessidade sem Documento), SEM filtro de pessoa.
//   2. resolveProgressoFaseDocumento — conta só Documento MATERIALIZADO
//      (esconde necessidade sem Documento — era o caso #607), filtra
//      Pessoa.linhaReta (booleano cru, sem checar filiação real).
//   3. montarEstruturaOperacional/montarIndiceOperacional — pessoasComTrabalho
//      sem filtro nenhum, mas com a classificação RICA de pessoa
//      (LINHA_PRINCIPAL/FORA_DA_LINHAGEM/PENDENTE_CLASSIFICACAO), que as
//      outras duas nem conheciam.
//
// Nenhuma das 3 foi apagada — cada uma segue fazendo o que só ELA faz (a
// #1 alimenta gate/avanço, a #3 monta a tabela "Documentos por pessoa" com
// tarefa/responsável/prazo). O que se unifica é a CONTA: "quantas certidões
// são obrigatórias, quantas estão prontas, quais faltam" — sempre a partir
// de NecessidadeDocumental (nunca esconde uma sem Documento), sempre com o
// MESMO predicado de conclusão do núcleo canônico
// (certidoesObrigatoriasDocumento/certidoesObrigatoriasNecessidade, em
// operational-projection-core.ts — reaproveitado aqui, nunca reescrito).

import { prisma } from "@/lib/prisma"
import type { FaseCode } from "@prisma/client"
import { getFase, phaseKeyToFaseCode } from "./fases-catalog"
import { pessoasAtivasDaArvore } from "@/src/lib/genealogia/vinculo-ativo"
import { itemCatalogosDeCertidao } from "@/src/lib/documentos/natureza-certidao"
import { resolverInstanciaVigente } from "./instancia-vigente-da-fase"
import { mapStepToGate } from "./operational-projection"
import {
  montarPessoasDoProcesso,
  nomeCompletoPessoa,
  type PessoaBruta,
  type UniaoBruta,
  type ClassificacaoPessoa,
} from "./central-operacional-core"
import {
  certidoesObrigatoriasDocumento,
  certidoesObrigatoriasNecessidade,
  escopoEfetivo,
  type NecessidadeData,
  type DocumentoData,
  type ProjectionInput,
} from "@/src/lib/motor/operational-projection-core"

export type EscopoPessoa = "TODAS" | "LINHA_PRINCIPAL" | "LINHA_E_FORA_DA_LINHAGEM"

export interface OpcoesCompletudeDocumental {
  /** Fase a considerar. Ausente = fase ATIVA do processo. */
  faseMacroKey?: string | null
  /** Instância/ciclo específico. Ausente = instância vigente da fase considerada. */
  workflowInstanceId?: number | null
  /** Default "TODAS" — é o que 5 dos 6 consumidores mapeados já faziam antes da unificação. */
  escopoPessoa?: EscopoPessoa
}

export interface CompletudeDocumentalPessoa {
  pessoaId: number
  nome: string
  geracao: number | null
  classificacao: ClassificacaoPessoa
  required: number
  completed: number
  percentage: number
}

export interface CompletudeDocumentalFaltante {
  necessidadeId: number
  /** null = necessidade obrigatória sem Documento materializado ainda — nunca escondida. */
  documentoId: number | null
  /** null = necessidade de União (casamento) — pessoaId XOR uniaoId por desenho. */
  pessoaId: number | null
  pessoaNome: string
  docType: string
  status: string
  geracao: number | null
}

export interface CompletudeDocumental {
  faseCode: FaseCode | null
  /** null quando o escopo da fase é PROCESSO — "documentos necessários" não se aplica
   *  (passos genéricos, não certidões). Consumidor decide o que fazer com isso. */
  aplicavel: boolean
  escopoPessoa: EscopoPessoa
  required: number
  completed: number
  percentage: number
  missingCount: number
  byPerson: CompletudeDocumentalPessoa[]
  missing: CompletudeDocumentalFaltante[]
}

const VAZIA = (faseCode: FaseCode | null, escopoPessoa: EscopoPessoa): CompletudeDocumental => ({
  faseCode, aplicavel: false, escopoPessoa,
  required: 0, completed: 0, percentage: 0, missingCount: 0, byPerson: [], missing: [],
})

/** Mesma régua de percentual do núcleo canônico (bloqueado nunca 100%, etc.) —
 *  aqui simplificada porque `resolverCompletudeDocumental` não decide bloqueio
 *  (isso continua sendo só do gate/`computeGate`). */
function pct(completed: number, required: number): number {
  if (required <= 0) return 0
  return Math.min(100, Math.round((completed / required) * 100))
}

const CLASSIFICACOES_POR_ESCOPO: Record<EscopoPessoa, Set<ClassificacaoPessoa> | null> = {
  TODAS: null,
  LINHA_PRINCIPAL: new Set(["LINHA_PRINCIPAL"]),
  LINHA_E_FORA_DA_LINHAGEM: new Set(["LINHA_PRINCIPAL", "FORA_DA_LINHAGEM"]),
}

/**
 * A FONTE ÚNICA. Sempre parte de NecessidadeDocumental (nunca some uma sem
 * Documento). Sempre usa o mesmo predicado de conclusão do núcleo canônico —
 * nenhuma conta própria. `escopoPessoa` é o único eixo de variação real entre
 * os consumidores mapeados; o resto (fase, instância) já existia em
 * `resolveOperationalProjection`, só replicado aqui pra byPerson/missing
 * poderem nascer da MESMA leitura, no mesmo instante — nunca duas consultas
 * que possam discordar entre si.
 */
export async function resolverCompletudeDocumental(
  processId: number,
  opcoes: OpcoesCompletudeDocumental = {},
): Promise<CompletudeDocumental> {
  const escopoPessoa = opcoes.escopoPessoa ?? "TODAS"

  const proc = await prisma.processo.findUnique({
    where: { id: processId },
    select: { id: true, arvoreId: true, faseAtualKey: true },
  })
  if (!proc) return VAZIA(null, escopoPessoa)

  const faseMacroKey = opcoes.faseMacroKey ?? proc.faseAtualKey ?? null
  if (!faseMacroKey) return VAZIA(null, escopoPessoa)
  const faseCode = phaseKeyToFaseCode(faseMacroKey)
  const faseDef = faseCode ? getFase(faseCode) : null

  // Instância: a informada, ou a VIGENTE da fase — mesma resolução que o resto
  // do sistema usa (resolverInstanciaVigente), nunca uma escolha própria.
  const instanciaId = opcoes.workflowInstanceId
    ?? (await resolverInstanciaVigente(processId, faseMacroKey))?.id
    ?? null

  const inst = instanciaId != null
    ? await prisma.phaseWorkflowInstance.findUnique({
        where: { id: instanciaId },
        include: {
          steps: {
            include: { tarefas: { where: { chaveIdempotencia: { not: null } }, select: { id: true, statusTarefa: true, responsavelId: true } } },
            orderBy: { ordem: "asc" },
          },
        },
      })
    : null

  const steps = (inst?.steps ?? []).map(mapStepToGate)
  const scope = escopoEfetivo({ scope: faseDef?.scope ?? null, steps })
  if (scope === "PROCESSO") return { ...VAZIA(faseCode, escopoPessoa), aplicavel: false }

  // ── PESSOAS + CLASSIFICAÇÃO RICA — a MESMA função que a Central usa (#3),
  //    nunca o booleano linhaReta cru sozinho.
  const [pessoasRaw, unioesRaw] = proc.arvoreId != null
    ? await Promise.all([
        prisma.pessoa.findMany({
          where: pessoasAtivasDaArvore(proc.arvoreId),
          select: { id: true, nome: true, sobrenome: true, sexo: true, publicCode: true, numeroLinhagem: true, requerente: true, linhaReta: true, paiId: true, maeId: true },
        }),
        prisma.uniao.findMany({
          where: { OR: [{ pessoa1: { arvoreId: proc.arvoreId } }, { pessoa2: { arvoreId: proc.arvoreId } }] },
          select: { id: true, pessoa1Id: true, pessoa2Id: true },
        }),
      ])
    : [[] as PessoaBruta[], [] as UniaoBruta[]]
  const pessoasDoProcesso = montarPessoasDoProcesso(pessoasRaw as PessoaBruta[], unioesRaw as UniaoBruta[])
  const pessoaPorId = new Map(pessoasDoProcesso.map((p) => [p.pessoaId, p]))
  const linhaRetaPorId = new Map(pessoasRaw.map((p) => [p.id, p.linhaReta]))

  // ── NECESSIDADES — SEMPRE a partir daqui, nunca de Documento. A que não tem
  //    Documento materializado entra igual (era o caso #607, escondido antes).
  const certItens = await itemCatalogosDeCertidao(prisma)
  const necsRaw = await prisma.necessidadeDocumental.findMany({
    where: { processoId: processId, supersedePorId: null },
    select: {
      id: true, status: true, obrigatoriedade: true, itemCatalogoId: true,
      pessoaId: true, uniaoId: true,
      itemCatalogo: { select: { name: true } },
      documentos: { select: { id: true, status: true, pessoaId: true }, take: 1 },
    },
  })

  const necessidades: NecessidadeData[] = necsRaw.map((n) => ({
    id: n.id, status: n.status, obrigatoria: n.obrigatoriedade === "OBRIGATORIA", ehCertidao: certItens.has(n.itemCatalogoId),
    pessoaId: n.pessoaId, uniaoId: n.uniaoId, documentoId: n.documentos[0]?.id ?? null,
  }))
  // `documentos` (DocumentoData[]) só existe pra `passosPorObrigacao` casar STEP
  // (documentoId) → necessidade — nunca pra decidir o que é obrigatório (isso
  // é só de `necessidades`, acima).
  const documentos: DocumentoData[] = necsRaw
    .filter((n) => n.documentos[0])
    .map((n) => ({
      id: n.documentos[0].id, status: n.documentos[0].status, necessidadeId: n.id,
      pessoaId: n.documentos[0].pessoaId,
      linhaReta: n.documentos[0].pessoaId != null ? (linhaRetaPorId.get(n.documentos[0].pessoaId) ?? false) : false,
    }))

  const input: ProjectionInput = {
    processId, faseCode, faseMacroKey, phaseName: faseDef?.label ?? faseMacroKey,
    scope: faseDef?.scope ?? null, processoExists: true, hasActiveInstance: !!inst,
    steps, necessidades, documentos, documentosTodos: documentos,
    hasArvore: proc.arvoreId != null, requerentesCount: 0,
  }

  const { certObrig, emitida } = scope === "DOCUMENTO"
    ? certidoesObrigatoriasDocumento(input)
    : certidoesObrigatoriasNecessidade(input)

  // ── PESSOA DONA da necessidade, pra agrupar. Casamento (uniaoId, pessoaId
  //    null) atribui ao pessoaId do Documento já materializado, quando existe
  //    — é assim que a tela sempre mostrou (Documento.pessoaId nunca é nulo,
  //    mesmo pra Documento de casamento). Sem Documento ainda, cai no
  //    pessoa1Id da União — é uma escolha de agrupamento, não de regra de
  //    negócio, e fica registrada aqui, não escondida.
  const uniaoPorId = new Map<number, { pessoa1Id: number | null; pessoa2Id: number | null }>(
    unioesRaw.map((u) => [u.id, { pessoa1Id: u.pessoa1Id, pessoa2Id: u.pessoa2Id }]),
  )
  const donoDaNecessidade = (n: NecessidadeData & { itemCatalogoNome?: string | null }): number | null => {
    if (n.pessoaId != null) return n.pessoaId
    const doc = necsRaw.find((x) => x.id === n.id)?.documentos[0]
    if (doc?.pessoaId != null) return doc.pessoaId
    if (n.uniaoId != null) return uniaoPorId.get(n.uniaoId)?.pessoa1Id ?? null
    return null
  }

  const classesPermitidas = CLASSIFICACOES_POR_ESCOPO[escopoPessoa]
  const passaNoEscopo = (pessoaId: number | null): boolean => {
    if (!classesPermitidas) return true // TODAS
    if (pessoaId == null) return false // União sem dono resolvido não entra em recorte de pessoa
    const classe = pessoaPorId.get(pessoaId)?.classificacao
    return !!classe && classesPermitidas.has(classe)
  }

  const porPessoa = new Map<number, { required: number; completed: number }>()
  const missing: CompletudeDocumentalFaltante[] = []
  let required = 0
  let completed = 0

  for (const n of certObrig) {
    const pessoaId = donoDaNecessidade(n)
    if (!passaNoEscopo(pessoaId)) continue

    required += 1
    const ok = emitida(n)
    if (ok) completed += 1

    if (pessoaId != null) {
      const cur = porPessoa.get(pessoaId) ?? { required: 0, completed: 0 }
      cur.required += 1
      if (ok) cur.completed += 1
      porPessoa.set(pessoaId, cur)
    }

    if (!ok) {
      const necRaw = necsRaw.find((x) => x.id === n.id)!
      const pessoa = pessoaId != null ? pessoaPorId.get(pessoaId) : null
      missing.push({
        necessidadeId: n.id,
        documentoId: n.documentoId ?? null,
        pessoaId: n.pessoaId ?? null,
        pessoaNome: pessoa ? pessoa.nome : (n.uniaoId != null ? "(União)" : "—"),
        docType: necRaw.itemCatalogo?.name ?? "Certidão",
        status: necRaw.documentos[0]?.status ?? necRaw.status,
        geracao: pessoa?.numeroLinhagem ?? null,
      })
    }
  }

  const byPerson: CompletudeDocumentalPessoa[] = [...porPessoa.entries()]
    .map(([pessoaId, v]) => {
      const p = pessoaPorId.get(pessoaId)
      return {
        // `PessoaDoProcesso.nome` já é o nome completo (nomeCompletoPessoa foi
        // aplicado dentro de `montarPessoasDoProcesso`) — nunca reformatar aqui.
        pessoaId, nome: p ? p.nome : "—",
        geracao: p?.numeroLinhagem ?? null, classificacao: p?.classificacao ?? "PENDENTE_CLASSIFICACAO",
        required: v.required, completed: v.completed, percentage: pct(v.completed, v.required),
      }
    })
    .sort((a, b) => (a.geracao ?? 99) - (b.geracao ?? 99))

  return {
    faseCode, aplicavel: true, escopoPessoa,
    required, completed, percentage: pct(completed, required), missingCount: Math.max(0, required - completed),
    byPerson, missing,
  }
}
