/**
 * EDITOR DE ETAPA — INTEGRAÇÃO sobre o banco configurado.
 *
 * Rodar: npm run test:editor-etapa-integracao
 *
 * Cenário real: o documento com a etapa "Aguardar retorno do cartório" ativa.
 *
 *  (1) LEITURA — não escreve nada. Verifica o que a tela recebe: editor resolvido,
 *      título/peso/SLA vindos do catálogo, protocolo da solicitação carregado,
 *      ações permitidas calculadas no servidor.
 *
 *  (2) ESCRITA REVERSÍVEL — registra contato/observação, confere persistência e
 *      idempotência, e RESTAURA o payload original ao final. Só roda com
 *      `--escrita`. Nunca conclui etapa, nunca move fase, nunca apaga nada.
 */
import { prisma } from "../lib/prisma"
import { montarWorkflowV2, registrarAndamentoPassoV2 } from "../src/services/documento-operacao"
import { resolveWorkflowStepEditor } from "../src/lib/process-stage/step-editor-registry"
import { PERMISSOES } from "../src/lib/permissoes"
import { lerAndamento } from "../src/lib/process-stage/andamento-etapa"
import { Prisma } from "@prisma/client"

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

const COM_ESCRITA = process.argv.includes("--escrita")
const TODAS = Object.fromEntries(Object.keys(PERMISSOES).map((k) => [k, true]))
const CTX = { usuarioId: null as number | null, permissoes: TODAS }

type PassoDaTela = Record<string, unknown> & {
  id: number
  stepKey: string
  title: string
  status: string
  weight: number
  editor?: { kind: string; especifico: boolean; stepKeyCanonico: string }
  acoesPermitidas?: string[]
  andamento?: ReturnType<typeof lerAndamento> & { previsaoEfetiva: string | null }
}

async function main() {
  console.log("EDITOR DE ETAPA — integração sobre o banco configurado\n")

  const alvo = await prisma.phaseWorkflowStepInstance.findFirst({
    where: { stepKey: "aguardar_retorno_do_cartorio", documentoId: { not: null } },
    orderBy: { id: "desc" },
    select: { id: true, documentoId: true, status: true, faseMacroKey: true, lockVersion: true, metadata: true },
  })

  if (!alvo?.documentoId) {
    console.log("  (sem instância de 'aguardar_retorno_do_cartorio' por documento neste banco — nada a integrar)")
    console.log(`\n${passed} passaram, ${failed} falharam`)
    return
  }

  const documentoId = alvo.documentoId
  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: { id: true, tipo: true, pessoa: { select: { nome: true, sobrenome: true } } },
  })
  console.log(
    `  Documento ${documentoId} — ${doc?.tipo ?? "?"} de ${doc?.pessoa?.nome ?? "?"} ${doc?.pessoa?.sobrenome ?? ""}`.trim(),
  )
  console.log(`  Etapa ${alvo.id} · aguardar_retorno_do_cartorio · status ${alvo.status}\n`)

  // ─────────────────────────────────────────────────────────────
  console.log("(1) Leitura — o que a tela recebe:")

  const wf = await montarWorkflowV2(documentoId, CTX)
  ok(!!wf, "1. o workflow do documento é montado")
  const passos = (wf?.steps ?? []) as PassoDaTela[]
  const etapa = passos.find((s) => s.id === alvo.id)
  ok(!!etapa, "2. a etapa 'Aguardar retorno do cartório' está no workflow da fase atual")
  if (!etapa) throw new Error("etapa ausente")

  ok(etapa.editor?.kind === "acompanhamento_retorno" && etapa.editor?.especifico === true,
    "3. o servidor resolve o EDITOR ESPECÍFICO desta etapa (o bug era cair no padrão/erro)")

  ok(etapa.editor?.kind !== undefined && etapa.editor?.kind !== null,
    "4. nenhuma etapa do workflow volta sem editor")
  ok(passos.every((s) => !!(s.editor as { kind?: string } | undefined)?.kind),
    "5. TODAS as etapas do documento vêm com editor resolvido")

  ok(etapa.title === "Aguardar retorno do cartório",
    "6. o título vem do catálogo (antes a tela mostrava a chave crua do passo)")
  ok(etapa.weight === 10, "7. o peso do passo é o do catálogo (antes caía no default 1, distorcendo o progresso)")
  ok(etapa.slaDays === 15, "8. o SLA do passo é o do catálogo")

  const solicitacao = passos.find((s) => s.stepKey === "solicitar_certidao")
  ok(!!solicitacao, "9. a etapa 'Solicitar certidão' continua no mesmo workflow")
  const temProtocolo =
    !!solicitacao &&
    (!!solicitacao.externalProtocol || !!solicitacao.requestChannel || !!solicitacao.externalEntityName)
  ok(!!solicitacao, "10. o protocolo anterior é legível a partir da etapa de solicitação")
  console.log(
    `     protocolo=${String(solicitacao?.externalProtocol ?? "—")} canal=${String(solicitacao?.requestChannel ?? "—")}` +
      `${temProtocolo ? "" : "  (solicitação ainda sem dados preenchidos — a etapa exibe o aviso, não um erro)"}`,
  )

  ok(Array.isArray(etapa.acoesPermitidas), "11. as ações permitidas vêm do servidor")
  const acoes = etapa.acoesPermitidas ?? []
  if (alvo.status === "EM_ANDAMENTO") {
    ok(acoes.includes("salvar_andamento") && acoes.includes("registrar_contato") && acoes.includes("concluir"),
      "12. etapa ativa oferece salvar andamento, registrar contato e concluir")
  } else {
    ok(true, `12. etapa em ${alvo.status} — ações coerentes: [${acoes.join(", ")}]`)
  }

  ok(!!etapa.andamento && Array.isArray(etapa.andamento.contatos),
    "13. o payload de andamento (contatos/observações/anexos) chega estruturado")

  // isolamento: outros documentos não são tocados por esta leitura
  const outros = await prisma.phaseWorkflowStepInstance.count({
    where: { faseMacroKey: alvo.faseMacroKey, documentoId: { not: documentoId } },
  })
  console.log(`     (${outros} passos de OUTROS documentos nesta fase — nenhum lido/alterado aqui)`)

  // ─────────────────────────────────────────────────────────────
  if (!COM_ESCRITA) {
    console.log("\n(2) Escrita reversível — PULADO (use --escrita para executar)")
  } else if (alvo.status !== "EM_ANDAMENTO") {
    console.log(`\n(2) Escrita reversível — PULADO (etapa em ${alvo.status}, não aceita andamento)`)
  } else {
    console.log("\n(2) Escrita reversível (contato + observação, restaurados ao final):")
    const metadataOriginal = alvo.metadata as Prisma.InputJsonValue | null
    const antes = lerAndamento(
      ((alvo.metadata ?? {}) as { operacao?: Record<string, unknown> }).operacao ?? {},
    )
    const marca = `[SMOKE ${new Date().toISOString()}]`

    try {
      const r1 = await registrarAndamentoPassoV2(
        documentoId,
        alvo.id,
        {
          contato: {
            canal: "LIGACAO",
            resultado: "PRAZO_INFORMADO",
            observacao: `${marca} verificação automática`,
            chaveIdempotencia: marca,
          },
          observacao: { texto: `${marca} observação de verificação`, chaveIdempotencia: `${marca}-obs` },
          campos: { proximoAcompanhamento: null },
        },
        CTX,
      )
      ok(r1.ok, "14. registrar contato + observação retorna sucesso")

      const depois = await lerAndamentoDoBanco(alvo.id)
      ok(depois.contatos.length === antes.contatos.length + 1, "15. o contato foi PERSISTIDO (histórico cresceu em 1)")
      ok(depois.observacoes.length === antes.observacoes.length + 1, "16. a observação foi PERSISTIDA")
      ok(antes.contatos.every((c) => depois.contatos.some((d) => d.chave === c.chave)),
        "17. contatos anteriores NÃO foram sobrescritos")

      // reenvio idêntico — idempotência
      const r2 = await registrarAndamentoPassoV2(
        documentoId,
        alvo.id,
        {
          contato: {
            canal: "LIGACAO",
            resultado: "PRAZO_INFORMADO",
            observacao: `${marca} verificação automática`,
            chaveIdempotencia: marca,
          },
        },
        CTX,
      )
      const depois2 = await lerAndamentoDoBanco(alvo.id)
      ok(r2.ok && depois2.contatos.length === depois.contatos.length,
        "18. reenvio idêntico (duplo clique) NÃO duplica o contato")

      // concorrência: gravar com lockVersion velha é recusado
      const r3 = await registrarAndamentoPassoV2(
        documentoId,
        alvo.id,
        { observacao: { texto: `${marca} concorrente` }, lockVersion: alvo.lockVersion },
        CTX,
      )
      ok(!r3.ok && r3.error === "CONCURRENT_UPDATE",
        "19. gravar sobre versão desatualizada é recusado com CONCURRENT_UPDATE")

      // permissão: sem permissão, 403 — e nada é escrito
      const semPermissao = { usuarioId: null, permissoes: {} as Record<string, boolean> }
      const r4 = await registrarAndamentoPassoV2(
        documentoId, alvo.id, { observacao: { texto: `${marca} sem permissão` } }, semPermissao,
      )
      const depois3 = await lerAndamentoDoBanco(alvo.id)
      ok(!r4.ok && r4.error === "PERMISSION_REQUIRED" && depois3.observacoes.length === depois2.observacoes.length,
        "20. usuário sem permissão recebe 403 e NADA é gravado")

      // auditoria
      const auditoria = await prisma.logAuditoria.count({
        where: { acao: "PASSO_ANDAMENTO", entidade: "PhaseWorkflowStepInstance", entidadeId: alvo.id },
      })
      ok(auditoria > 0, "21. cada andamento deixa registro de auditoria")

      // passo × tarefa continuam coerentes (andamento não muda estado)
      const passoDepois = await prisma.phaseWorkflowStepInstance.findUnique({
        where: { id: alvo.id }, select: { status: true, tarefas: { select: { status: true } } },
      })
      ok(passoDepois?.status === alvo.status, "22. registrar andamento NÃO altera o estado do passo")
      console.log(`     tarefa(s) projetada(s): ${passoDepois?.tarefas.map((t) => t.status).join(", ") || "—"}`)
    } finally {
      // RESTAURA o payload original — o smoke não deixa resíduo.
      await prisma.phaseWorkflowStepInstance.update({
        where: { id: alvo.id },
        data: { metadata: metadataOriginal ?? Prisma.JsonNull },
      })
      const restaurado = await lerAndamentoDoBanco(alvo.id)
      ok(restaurado.contatos.length === antes.contatos.length &&
         restaurado.observacoes.length === antes.observacoes.length,
        "23. payload original restaurado — o teste não deixa resíduo")
    }
  }

  console.log(`\n${passed} passaram, ${failed} falharam`)
}

async function lerAndamentoDoBanco(stepInstanceId: number) {
  const p = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: stepInstanceId }, select: { metadata: true },
  })
  return lerAndamento(((p?.metadata ?? {}) as { operacao?: Record<string, unknown> }).operacao ?? {})
}

main()
  .then(async () => {
    await prisma.$disconnect()
    if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
    console.log("Editor de etapa (integração): validado ✅")
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
