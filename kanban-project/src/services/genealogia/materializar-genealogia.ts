// src/services/genealogia/materializar-genealogia.ts
//
// FATIA 2 — Materialização das Regras Documentais na Genealogia (V2).
// Regras Documentais PUBLICADAS exigidas na Genealogia → avaliação por Pessoa →
// NecessidadeDocumental (canônica, idempotente, com snapshot da regra) + passo
// operacional "Localizar registro" (PhaseWorkflowStepInstance) vinculado à
// necessidade. ADITIVO, IDEMPOTENTE, REVERSÍVEL. NÃO avança fase, NÃO conclui, NÃO
// cria tarefa, NÃO usa document-generator/DOCUMENT_RULES/reconcileDocsForPessoa.
//
// Documento NÃO é criado aqui: Documento.necessidadeId é preenchido quando houver
// Documento materializado pela operação (seção 3.4 da tarefa).

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { garantirNecessidade, dispensarNecessidade, reativarNecessidade } from "@/src/services/necessidade-documental"
import { matrizParaRegra } from "@/src/lib/documentos/regras-documentais/mapear"
import { avaliarRegrasDocumentais } from "@/src/lib/documentos/regras-documentais/avaliador"
import type { RegraDocumental, SujeitoContexto } from "@/src/lib/documentos/regras-documentais/tipos"
import {
  politicaDaFase, resolverTiposDocumentais, naturezaPermitidaNaFase, recebeWorkflowOperacional,
  type TipoDocumentalResolvido,
} from "@/src/lib/documentos/politica-natureza-fase"
import { idadeEmAnos, maioridadeEfetiva, ehRequerente } from "@/src/lib/documentos/maioridade"
import { aplicarHonorariosCidadaniaItaliana } from "@/src/lib/motor/executor"
import { materializarExecucaoDaFase } from "@/src/services/materializar-fase"

type DB = typeof prisma | Prisma.TransactionClient

const FASE_GENEALOGIA = "genealogia" // phaseKey canônica (minúscula)
// stepKey canônico ÚNICO da Genealogia. "Localizar registro" (não "buscar
// documento"/"certidão"): aqui só se LOCALIZA o registro civil e preenchem-se os
// dados registrais. A solicitação/obtenção da certidão é da Emissão Documental.
const STEP_LOCALIZAR = "localizar_registro"
const STEP_LABEL = "Localizar registro da certidão"

export interface MaterializarResultado {
  processoId: number
  aplicaveis: number
  necessidadesCriadas: number
  necessidadesReusadas: number
  stepsCriados: number
  stepsReusados: number
  dispensadas: number
  reativadas: number
  pendencias: string[]
  semInstanciaWorkflow: boolean
}

// ---- contexto canônico da Pessoa (sem legado) ----
export function contextoDaPessoa(p: {
  id: number; nome?: string | null; sobrenome?: string | null
  documentacao: boolean; casado: boolean; vivo: boolean; linhaReta: boolean; requerente: string | null
  data_nasc?: Date | string | null
}, referencia: Date = new Date()): SujeitoContexto {
  // A idade vem da política canônica de maioridade, com data de referência
  // EXPLÍCITA — nunca de "hoje" implícito espalhado pelo código.
  const idade = idadeEmAnos(p.data_nasc ?? null, referencia)
  return {
    id: p.id,
    nome: [p.nome, p.sobrenome].filter(Boolean).join(" ") || `Pessoa ${p.id}`,
    ehPessoaArvore: true,
    precisaDeDocumentacao: p.documentacao === true,
    casado: p.casado === true,
    vivo: p.vivo === true,
    falecido: p.vivo === false,
    // domínio canônico: "sim" | "maior" | "menor" contam como requerente.
    requerente: ehRequerente(p.requerente),
    linhaReta: p.linhaReta === true,
    idade,
    maiorDeIdade: maioridadeEfetiva(p.data_nasc ?? null, p.requerente, referencia),
    dataNascimento: p.data_nasc ? new Date(p.data_nasc).toISOString() : null,
  }
}

// "exigida na Genealogia": fase de exigência OU fase bloqueada = genealogia.
// Regras de identidade/comprovante (protocolo) NÃO entram na Genealogia.
export function exigidaNaGenealogia(r: RegraDocumental): boolean {
  return r.faseExigencia === FASE_GENEALOGIA || r.faseBloqueio === FASE_GENEALOGIA
}
export function aplicaAoProcesso(r: RegraDocumental, tipoProcessoId: number | null): boolean {
  return r.aplicaTodosProcessos || (tipoProcessoId != null && (r.tipoProcessoIds.length ? r.tipoProcessoIds.includes(tipoProcessoId) : r.tipoProcessoId === tipoProcessoId))
}

// ---- regras PUBLICADAS exigidas na Genealogia aplicáveis ao processo ----
export async function regrasGenealogiaDoProcesso(tipoProcessoId: number | null, db: DB = prisma): Promise<RegraDocumental[]> {
  const rows = await db.matrizDocumental.findMany({ where: { status: "PUBLICADA" } })
  return rows.map(matrizParaRegra).filter((r) => aplicaAoProcesso(r, tipoProcessoId) && exigidaNaGenealogia(r))
}

function chaveStep(necessidadeId: number, ciclo: number): string {
  return `matdoc|${STEP_LOCALIZAR}|nec${necessidadeId}|c${ciclo}`
}

// ---- núcleo: materializa a Genealogia de UM processo (idempotente) ----
export async function materializarGenealogia(processoId: number, db: DB = prisma): Promise<MaterializarResultado> {
  const res: MaterializarResultado = {
    processoId, aplicaveis: 0, necessidadesCriadas: 0, necessidadesReusadas: 0,
    stepsCriados: 0, stepsReusados: 0, dispensadas: 0, reativadas: 0, pendencias: [], semInstanciaWorkflow: false,
  }

  const processo = await db.processo.findUnique({
    where: { id: processoId },
    select: { id: true, arvoreId: true, tipoProcessoMotorId: true },
  })
  if (!processo?.arvoreId) { res.pendencias.push("processo sem árvore vinculada"); return res }

  const regras = await regrasGenealogiaDoProcesso(processo.tipoProcessoMotorId ?? null, db)
  if (regras.length === 0) { res.pendencias.push("nenhuma Regra Documental publicada exigida na Genealogia"); return res }

  const pessoas = await db.pessoa.findMany({
    where: { arvoreId: processo.arvoreId },
    select: { id: true, nome: true, sobrenome: true, documentacao: true, casado: true, vivo: true, linhaReta: true, requerente: true, data_nasc: true },
  })

  // POLÍTICA DA FASE — o que a Genealogia materializa vem do CADASTRO (quais
  // naturezas a fase aceita), não de uma premissa no motor. Fase sem política
  // declarada não materializa nada: esquecimento de cadastro não pode virar
  // materialização indevida.
  const politica = await politicaDaFase(FASE_GENEALOGIA, db)
  if (!politica) res.pendencias.push(`fase "${FASE_GENEALOGIA}" não existe no Catálogo de Fases`)
  else if (politica.naturezasPermitidas.size === 0) {
    res.pendencias.push(`fase "${FASE_GENEALOGIA}" sem naturezas documentais habilitadas — cadastre a política da fase`)
  }
  const tiposPorId = await resolverTiposDocumentais(db)
  const tipoPorCode = new Map<string, TipoDocumentalResolvido>()
  for (const t of tiposPorId.values()) if (t.code) tipoPorCode.set(t.code, t)

  // instância ativa do Workflow Interno da Genealogia (para pendurar o passo)
  const instancia = await db.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey: FASE_GENEALOGIA, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
    orderBy: { ciclo: "desc" },
    select: { id: true, ciclo: true, faseMacroKey: true },
  })
  if (!instancia) res.semInstanciaWorkflow = true

  // varianteKeys aplicáveis nesta rodada (para reconciliação)
  const aplicaveisVariante = new Set<string>()

  for (const p of pessoas) {
    const sujeito = contextoDaPessoa(p)
    const av = avaliarRegrasDocumentais({
      tipoProcessoId: processo.tipoProcessoMotorId ?? 0,
      faseKey: FASE_GENEALOGIA, sujeito, dataReferencia: new Date().toISOString(), regras,
    })
    for (const ap of av.aplicaveis) {
      res.aplicaveis++
      // ELEGIBILIDADE ESTRUTURAL — por CADASTRO, comparando IDs: a fase declara as
      // naturezas que aceita, o tipo documental declara a sua. Nunca por código
      // DOC, nome ou substring. Cada recusa tem motivo nomeado.
      const tipoDoc = tipoPorCode.get(ap.documentTypeCode)
      const elegivel = naturezaPermitidaNaFase(politica, tipoDoc)
      if (!elegivel.permitido) { res.pendencias.push(`"${ap.documentTypeCode}": ${elegivel.detalhe}`); continue }
      const regra = regras.find((r) => r.id === ap.regraId)!
      const codigo = regra.codigo ?? `MDX_${regra.id}`
      const varianteKey = `rd:${codigo}:v${regra.versao}`
      const itemCatalogoId = tipoDoc?.itemCatalogoId ?? null
      if (itemCatalogoId == null) { res.pendencias.push(`sem ItemCatalogo para "${ap.documentTypeCode}" (pessoa ${p.id}, regra ${codigo}) — necessidade não materializada`); continue }

      // materializa a variante aplicável (para reconciliação depois)
      aplicaveisVariante.add(`${p.id}::${varianteKey}`)

      const snapshot = {
        codigo, requisito: ap.requisitoNome ?? regra.requisitoNome ?? ap.documentTypeCode,
        documentosAceitos: ap.documentosAceitos, modoSatisfacao: ap.modoSatisfacao,
        obrigatoriedade: ap.obrigatoriedade, faseExigencia: regra.faseExigencia, faseBloqueio: regra.faseBloqueio,
        publicoAlvo: regra.publicoAlvo, condicoes: regra.condicoes ?? null,
      } as unknown as Prisma.InputJsonValue
      const { necessidade, criada } = await garantirNecessidade({
        processoId, itemCatalogoId, pessoaId: p.id, varianteKey, origem: "MATRIZ",
        obrigatoriedade: ap.obrigatoriedade, matrizRegraId: regra.id, matrizRegraVersao: regra.versao,
        matrizSnapshot: snapshot, motivoAplicabilidade: ap.justificativa, arvoreId: processo.arvoreId, ruleCode: codigo.slice(0, 20),
      }, db)
      criada ? res.necessidadesCriadas++ : res.necessidadesReusadas++

      // reativa se estava DISPENSADA (voltou a ser aplicável) — via serviço canônico.
      if (!criada && necessidade.status === "DISPENSADA") {
        await reativarNecessidade(necessidade.id, db)
        res.reativadas++
      }

      // PASSO OPERACIONAL — só para documento cujo PERFIL declara workflow.
      // É o que impede RG, comprovante e procuração de herdarem os cinco passos
      // da emissão de certidão: eles entram na fase como necessidade, sem passo.
      // A distinção vem do perfil cadastrado, não de uma lista de exceções.
      if (instancia && recebeWorkflowOperacional(tipoDoc)) {
        const chave = chaveStep(necessidade.id, instancia.ciclo)
        const existente = await db.phaseWorkflowStepInstance.findUnique({ where: { chaveIdempotencia: chave }, select: { id: true } })
        if (existente) { res.stepsReusados++ }
        else {
          await db.phaseWorkflowStepInstance.create({
            data: {
              workflowInstanceId: instancia.id, stepKey: STEP_LOCALIZAR, processoId,
              faseMacroKey: FASE_GENEALOGIA, ordem: 1, tipo: "HUMANO",
              obrigatorio: ap.obrigatoriedade === "OBRIGATORIA", geraTarefa: false, ciclo: instancia.ciclo,
              status: "DISPONIVEL", necessidadeId: necessidade.id, papel: "equipe_documental", slaDays: 5,
              chaveIdempotencia: chave,
              snapshot: { stepKey: STEP_LOCALIZAR, label: STEP_LABEL, requisito: snapshot } as Prisma.InputJsonValue,
              snapshotSchemaVersion: 1,
            },
          })
          res.stepsCriados++
        }
      }
    }
  }

  return await reconciliarEfinalizar(res, processoId, aplicaveisVariante, db)
}

async function reconciliarEfinalizar(res: MaterializarResultado, processoId: number, aplicaveisVariante: Set<string>, db: DB): Promise<MaterializarResultado> {
  // ---- reconciliação: necessidades desta origem que deixaram de ser aplicáveis ----
  const existentes = await db.necessidadeDocumental.findMany({
    where: { processoId, origem: "MATRIZ", varianteKey: { startsWith: "rd:" } },
    select: { id: true, pessoaId: true, varianteKey: true, status: true },
  })
  for (const n of existentes) {
    const chaveAplic = `${n.pessoaId}::${n.varianteKey}`
    if (aplicaveisVariante.has(chaveAplic)) continue
    // deixou de ser aplicável: se ainda não começou (PENDENTE), DISPENSA (reversível);
    // se já em atendimento/atendida/não localizada → preserva histórico, não mexe.
    if (n.status === "PENDENTE") {
      await dispensarNecessidade(n.id, "Regra deixou de ser aplicável (reconciliação)", db)
      res.dispensadas++
    }
  }

  return res
}

// ---- gatilho best-effort: ao criar/editar Pessoa, reavalia a Genealogia dos
// processos da árvore dela. NUNCA lança (não pode quebrar o CRUD de Pessoa). ----
export async function dispararMaterializacaoPorArvore(arvoreId: number | null | undefined): Promise<void> {
  if (!arvoreId) return
  try {
    const procs = await prisma.processo.findMany({ where: { arvoreId }, select: { id: true } })
    for (const p of procs) {
      // CONVERGÊNCIA OFICIAL primeiro. Este é o elo causal que faltava: no fluxo
      // real o processo nasce ANTES da árvore, e a fase inicial foi materializada
      // com zero pessoa. Quando a pessoa aparece, a fase precisa convergir — pelo
      // materializador ÚNICO, não por um caminho paralelo.
      //
      // `materializarGenealogia` (abaixo) continua sendo a origem MATRIZ das
      // exigências e depende de Regra Documental publicada; sem nenhuma publicada
      // ela retorna cedo, e era por isso que este gatilho não fazia nada.
      try {
        await materializarExecucaoDaFase({ processoId: p.id, fonte: "RECONCILIACAO" })
      } catch (e) {
        console.error(`[genealogia] convergência oficial do processo ${p.id} falhou (fluxo seguiu):`, e)
      }
      try { await materializarGenealogia(p.id) } catch (e) { console.error(`[genealogia] materializar processo ${p.id} falhou (fluxo seguiu):`, e) }
      // EVENTO OPERACIONAL "REQUERENTES_DO_PROCESSO_DEFINIDOS/ATUALIZADOS": mudou a árvore
      // (inclui a marcação de requerente) → o FinanceRuleEngine recalcula os honorários da
      // cidadania italiana (1 lançamento consolidado por processo). Best-effort, idempotente.
      try { await aplicarHonorariosCidadaniaItaliana(p.id) } catch (e) { console.error(`[honorarios] processo ${p.id} falhou (fluxo seguiu):`, e) }
    }
  } catch (e) {
    console.error("[genealogia] disparo por árvore falhou (fluxo seguiu):", e)
  }
}

