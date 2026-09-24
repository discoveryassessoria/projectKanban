// src/app/api/processos/[processoId]/fase-documental-kpis/[stepKey]/route.ts
// ============================================================================
// LEITURA — resumo de uma fase DOCUMENTO-escopada (hoje: "traducao_juramentada"
// e "apostilamento") pelas 4 subtarefas reais da Biblioteca (preparar → enviar
// → receber [espera externa] → conferir e validar). Só agrega dado que já
// existe pelo motor canônico — não cria Pasta, não duplica progresso: os
// mesmos `PhaseWorkflowStepInstance`/`SubtaskExecution` que a Central
// Operacional genérica (`PainelDaFase`/`DocumentoOperationalDrawer`) já lê e
// escreve. Este é um SEGUNDO PAINEL sobre o MESMO dado, nunca uma segunda
// fonte — mandato 24/09/2026 (migração de Tradução/Apostilamento pro motor
// canônico, na sequência do achado do usuário sobre a Biblioteca já publicada).
// ============================================================================
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { subtarefasDaEtapa } from "@/src/services/subtarefas-da-etapa"
import { garantirOperacaoDocumentoV2 } from "@/src/services/documento-operacao"

const STEP_KEYS_PERMITIDOS = new Set(["traducao_juramentada", "apostilamento"])

// mesmos critérios de "documento em mãos" já usados no resto do sistema para
// estas duas fases (ver histórico: pasta-documental-universo.ts, removido).
const READY_STATUSES_POR_FASE: Record<string, string[]> = {
  traducao_juramentada: ["RECEBIDO", "EM_TRADUCAO", "TRADUZIDO"],
  apostilamento: ["RECEBIDO", "TRADUZIDO", "EM_APOSTILAMENTO", "APOSTILADO"],
}
const SKIP_TIPOS = ["TRADUCAO_JURAMENTADA", "APOSTILA_HAIA"]

function nomeCompleto(p: { nome: string; sobrenome: string | null }): string {
  return p.sobrenome ? `${p.nome} ${p.sobrenome}` : p.nome
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string; stepKey: string }> },
) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { processoId, stepKey } = await params
  const id = parseInt(processoId)
  if (isNaN(id) || !STEP_KEYS_PERMITIDOS.has(stepKey)) {
    return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 })
  }

  const processo = await prisma.processo.findUnique({
    where: { id },
    select: { id: true, arvoreId: true },
  })
  if (!processo || !processo.arvoreId) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

  const readyStatuses = READY_STATUSES_POR_FASE[stepKey]

  // UNIVERSO — documentos da linha reta candidatos, prontos ou não.
  const docs = await prisma.documento.findMany({
    where: { tipo: { notIn: SKIP_TIPOS as never }, pessoa: { arvoreId: processo.arvoreId, linhaReta: true } },
    select: {
      id: true, tipo: true, status: true, pessoaId: true,
      pessoa: { select: { id: true, nome: true, sobrenome: true } },
    },
    orderBy: { id: "asc" },
  })

  const aptos = docs.filter((d) => readyStatuses.includes(d.status))

  // Para cada documento APTO, garante a operação materializada (idempotente —
  // mesma porta que o drawer já usa ao abrir) e lê as subtarefas reais.
  const porPessoa = new Map<number, { pessoaId: number; nome: string; documentos: Array<Record<string, unknown>> }>()
  const contagem: Record<string, number> = {
    preparar_documentos: 0, enviar_documentos: 0, receber_documentos: 0, conferir_validar_documentos: 0, validados: 0,
  }

  for (const d of aptos) {
    const wf = await garantirOperacaoDocumentoV2(d.id)
    const stepInstanceId = wf.workflow?.currentStepId ?? null
    let subtarefas: Awaited<ReturnType<typeof subtarefasDaEtapa>> = []
    if (stepInstanceId) {
      try { subtarefas = await subtarefasDaEtapa({ stepInstanceId }) } catch { /* passo de outra fase/instância — segue sem subtarefas */ }
    }
    const porChave = new Map(subtarefas.map((s) => [s.key, s]))
    for (const chave of Object.keys(contagem)) {
      if (chave === "validados") continue
      if (porChave.get(chave)?.concluida) contagem[chave]++
    }
    const todasConcluidas = subtarefas.length > 0 && subtarefas.every((s) => s.concluida)
    if (todasConcluidas) contagem.validados++

    let pessoa = porPessoa.get(d.pessoaId)
    if (!pessoa) { pessoa = { pessoaId: d.pessoaId, nome: nomeCompleto(d.pessoa), documentos: [] }; porPessoa.set(d.pessoaId, pessoa) }
    pessoa.documentos.push({
      documentoId: d.id,
      subtarefas: subtarefas.map((s) => ({ key: s.key, label: s.label, status: s.status, concluida: s.concluida, disponivel: s.disponivel })),
    })
  }

  return NextResponse.json({
    totais: {
      documentosNecessarios: docs.length,
      aptos: aptos.length,
      bloqueados: docs.length - aptos.length,
      preparados: contagem.preparar_documentos,
      enviados: contagem.enviar_documentos,
      recebidos: contagem.receber_documentos,
      conferidos: contagem.conferir_validar_documentos,
      validados: contagem.validados,
    },
    pessoas: [...porPessoa.values()],
  })
}
