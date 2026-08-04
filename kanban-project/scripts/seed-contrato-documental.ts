// scripts/seed-contrato-documental.ts
//
// CONFIGURAÇÃO DO CONTRATO DOCUMENTAL — Fatia 1.
//
// Persiste o que hoje é conhecimento do código: quais famílias e naturezas
// existem, qual perfil processa certidão, e que o Workflow Interno de Emissão
// Documental executa UMA VEZ POR DOCUMENTO.
//
// NÃO TOCA EM DADO OPERACIONAL. Nenhum StepInstance, Tarefa, Documento ou ciclo
// é lido para escrita. O reparo de `documentoId` ausente em passos e tarefas é a
// Fatia 2 — misturar as duas coisas tornaria impossível reverter uma sem a outra.
//
// Rodar:
//   npx tsx scripts/seed-contrato-documental.ts            # diagnóstico
//   npx tsx scripts/seed-contrato-documental.ts --execute  # aplica
//
// IDEMPOTENTE: upsert por `code`. Reexecutar não duplica nem sobrescreve o que
// um administrador tenha ajustado depois — só preenche o que está vazio.

import { prisma } from "@/lib/prisma"

const EXECUTAR = process.argv.includes("--execute")

/** Famílias de bootstrap. `sistema` = code imutável, não excluível. */
const FAMILIAS = [
  { code: "CERTIDAO_REGISTRO_CIVIL", name: "Certidão de Registro Civil", ordem: 10,
    descricao: "Certidões emitidas por cartório de registro civil (nascimento, casamento, óbito)." },
  { code: "REQUERIMENTO", name: "Requerimento", ordem: 20,
    descricao: "Peças que o escritório envia ao órgão para pedir algo. Evidência do ato, não resultado dele." },
  { code: "DOCUMENTO_IDENTIDADE", name: "Documento de Identidade", ordem: 30,
    descricao: "Documentos de identificação civil recebidos do cliente." },
  { code: "PROCURACAO", name: "Procuração", ordem: 40,
    descricao: "Instrumentos de representação gerados pelo sistema." },
]

/**
 * Naturezas operacionais. `exigeWorkflow` é o campo que separa documento que se
 * PROCESSA (tem etapas, prazo, responsável) de documento que só se ANEXA.
 */
const NATUREZAS = [
  { code: "OBTIDO_EXTERNAMENTE", name: "Obtido externamente", exigeWorkflow: true, ordem: 10,
    descricao: "Solicitado a um órgão externo e aguardado. Tem etapas próprias." },
  { code: "GERADO_PELO_SISTEMA", name: "Gerado pelo sistema", exigeWorkflow: true, ordem: 20,
    descricao: "Produzido pelo Discovery a partir dos dados do processo." },
  { code: "RECEBIDO_DO_CLIENTE", name: "Recebido do cliente", exigeWorkflow: false, ordem: 30,
    descricao: "Enviado pelo cliente. Entra por upload, sem workflow de emissão." },
  { code: "EVIDENCIA_DE_ETAPA", name: "Evidência de etapa", exigeWorkflow: false, ordem: 40,
    descricao: "Comprova que uma etapa aconteceu. Vive vinculado ao passo, não tem etapas próprias." },
  { code: "SEM_WORKFLOW_OPERACIONAL", name: "Sem workflow operacional", exigeWorkflow: false, ordem: 90,
    descricao: "Documento de apoio, apenas arquivado." },
]

/** Chave do Workflow Interno vigente de Emissão Documental (phaseKey canônica). */
const PHASE_KEY_EMISSAO = "emissao_documental"
/** Passos que passam a declarar cardinalidade DOCUMENTO. Chaves canônicas. */
const PASSOS_DOCUMENTAIS = [
  "solicitar_certidao",
  "aguardar_retorno_do_cartorio",
  "receber_certidao",
  "conferir_certidao",
  "validar_certidao",
]

/** Tipos que passam a apontar para o perfil de emissão, por publicCode oficial. */
const TIPOS_EMISSAO = ["DOC1", "DOC2", "DOC3"]
/** DOC21 é evidência: família própria, natureza própria, e NENHUM perfil. */
const TIPO_REQUERIMENTO = "DOC21"

async function main() {
  console.log(`CONTRATO DOCUMENTAL — ${EXECUTAR ? "EXECUTANDO" : "DIAGNÓSTICO (sem escrita)"}\n`)

  const [fp] = await prisma.$queryRawUnsafe<Array<{ db: string; usr: string }>>(
    "select current_database() as db, current_user as usr")
  console.log(`  banco: ${JSON.stringify(fp)}\n`)

  // ── 1. Cadastros mestres ───────────────────────────────────────────────────
  console.log("(1) Cadastros mestres:")
  const familias = new Map<string, number>()
  for (const f of FAMILIAS) {
    const existente = await prisma.familiaDocumental.findUnique({ where: { code: f.code }, select: { id: true } })
    console.log(`  ${existente ? "=" : "+"} família ${f.code} — ${f.name}`)
    if (existente) { familias.set(f.code, existente.id); continue }
    if (!EXECUTAR) { familias.set(f.code, -1); continue }
    const criada = await prisma.familiaDocumental.create({ data: { ...f, sistema: true }, select: { id: true } })
    familias.set(f.code, criada.id)
  }

  const naturezas = new Map<string, number>()
  for (const n of NATUREZAS) {
    const existente = await prisma.naturezaOperacionalDocumento.findUnique({ where: { code: n.code }, select: { id: true } })
    console.log(`  ${existente ? "=" : "+"} natureza ${n.code} — ${n.name}${n.exigeWorkflow ? " (exige workflow)" : ""}`)
    if (existente) { naturezas.set(n.code, existente.id); continue }
    if (!EXECUTAR) { naturezas.set(n.code, -1); continue }
    const criada = await prisma.naturezaOperacionalDocumento.create({ data: { ...n, sistema: true }, select: { id: true } })
    naturezas.set(n.code, criada.id)
  }

  // ── 2. Workflow vigente de Emissão Documental ─────────────────────────────
  // O vigente é o ATIVO sem tipoProcessoId (vale para todos os processos). Um
  // workflow preso a tipo de processo inexistente NÃO é candidato — é justamente
  // o defeito que o guard passa a barrar.
  console.log("\n(2) Workflow vigente de Emissão Documental:")
  const candidatos = await prisma.phaseInternalWorkflow.findMany({
    where: { phaseKey: PHASE_KEY_EMISSAO, active: true, arquivado: false },
    select: { id: true, name: true, tipoProcessoId: true, versao: true, _count: { select: { passos: true } } },
    orderBy: { id: "asc" },
  })
  for (const c of candidatos) {
    console.log(`    id=${c.id} "${c.name}" tipoProcessoId=${c.tipoProcessoId ?? "TODOS"} v${c.versao} passos=${c._count.passos}`)
  }
  const vigente = candidatos.find((c) => c.tipoProcessoId == null)
  if (!vigente) {
    console.error("  ABORTADO: nenhum workflow de emissão vigente (ativo, para todos os tipos de processo).")
    process.exitCode = 1
    return
  }
  console.log(`  → vigente: id=${vigente.id} "${vigente.name}"`)

  // ── 3. Perfil operacional ──────────────────────────────────────────────────
  console.log("\n(3) Perfil operacional:")
  const familiaCertidao = familias.get("CERTIDAO_REGISTRO_CIVIL")!
  let perfilId = (await prisma.perfilOperacionalDocumento.findUnique({
    where: { code: "EMISSAO_CERTIDAO" }, select: { id: true },
  }))?.id ?? null
  console.log(`  ${perfilId ? "=" : "+"} EMISSAO_CERTIDAO → workflow ${vigente.id} · família CERTIDAO_REGISTRO_CIVIL · escopo DOCUMENTO`)
  if (!perfilId && EXECUTAR) {
    perfilId = (await prisma.perfilOperacionalDocumento.create({
      data: {
        code: "EMISSAO_CERTIDAO",
        name: "Emissão de Certidão",
        descricao: "Solicitação de certidão a cartório/órgão e acompanhamento até a validação. Uma execução por documento.",
        workflowId: vigente.id,
        familiaDocumentalId: familiaCertidao > 0 ? familiaCertidao : null,
        escopoInstanciacao: "DOCUMENTO",
        exigeProcesso: true, exigePessoa: true, exigeDocumento: true,
        ativo: true, sistema: true,
      },
      select: { id: true },
    })).id
  }

  // ── 4. Contrato do workflow ───────────────────────────────────────────────
  console.log("\n(4) Contrato do workflow vigente:")
  console.log(`  escopoExecucao=DOCUMENTO · exigeDocumento=true · exigePessoa=true · família=CERTIDAO_REGISTRO_CIVIL`)
  if (EXECUTAR) {
    await prisma.phaseInternalWorkflow.update({
      where: { id: vigente.id },
      data: {
        escopoExecucao: "DOCUMENTO",
        exigeDocumento: true,
        exigePessoa: true,
        familiaDocumentalId: familiaCertidao > 0 ? familiaCertidao : null,
      },
    })
  }

  // ── 5. Cardinalidade dos cinco passos ─────────────────────────────────────
  // Só a COLUNA `cardinalidade` que já existe e o motor já lê. Nome, ordem,
  // obrigatoriedade, SLA, executor e automações não são tocados.
  console.log("\n(5) Cardinalidade dos passos (só o escopo; nada mais muda):")
  const passos = await prisma.phaseInternalWorkflowStep.findMany({
    where: { workflowId: vigente.id },
    select: { id: true, key: true, label: true, ordem: true, cardinalidade: true },
    orderBy: { ordem: "asc" },
  })
  for (const p of passos) {
    const alvo = PASSOS_DOCUMENTAIS.includes(p.key)
    if (!alvo) { console.log(`    ! ${p.key} não está na lista documental — inalterado`); continue }
    const jaEsta = p.cardinalidade === "DOCUMENTO"
    console.log(`  ${jaEsta ? "=" : "+"} ${p.ordem}. ${p.key} — ${p.cardinalidade ?? "(herda fase)"} → DOCUMENTO`)
    if (!jaEsta && EXECUTAR) {
      await prisma.phaseInternalWorkflowStep.update({ where: { id: p.id }, data: { cardinalidade: "DOCUMENTO" } })
    }
  }
  const faltando = PASSOS_DOCUMENTAIS.filter((k) => !passos.some((p) => p.key === k))
  if (faltando.length) console.log(`    ! passos esperados ausentes no workflow: ${faltando.join(", ")}`)

  // ── 6. Tipos documentais ──────────────────────────────────────────────────
  console.log("\n(6) Tipos documentais:")
  const natObtido = naturezas.get("OBTIDO_EXTERNAMENTE")!
  for (const code of TIPOS_EMISSAO) {
    const t = await prisma.tipoDocumentoCadastro.findFirst({
      where: { publicCode: code },
      select: { id: true, name: true, familiaDocumentalId: true, naturezaOperacionalId: true, perfilOperacionalId: true },
    })
    if (!t) { console.log(`    ! ${code} não existe no cadastro — pulado`); continue }
    console.log(`  + ${code} (id ${t.id}) "${t.name}" → família CERTIDAO_REGISTRO_CIVIL · natureza OBTIDO_EXTERNAMENTE · perfil EMISSAO_CERTIDAO`)
    if (!EXECUTAR) continue
    await prisma.tipoDocumentoCadastro.update({
      where: { id: t.id },
      data: {
        // Só preenche o que está vazio: ajuste administrativo posterior não é
        // desfeito por reexecução do seed.
        familiaDocumentalId: t.familiaDocumentalId ?? (familiaCertidao > 0 ? familiaCertidao : null),
        naturezaOperacionalId: t.naturezaOperacionalId ?? (natObtido > 0 ? natObtido : null),
        perfilOperacionalId: t.perfilOperacionalId ?? perfilId,
      },
    })
  }

  // DOC21 — evidência. Família e natureza próprias; perfil NENHUM, de propósito.
  const req = await prisma.tipoDocumentoCadastro.findFirst({
    where: { publicCode: TIPO_REQUERIMENTO },
    select: { id: true, name: true, familiaDocumentalId: true, naturezaOperacionalId: true, perfilOperacionalId: true },
  })
  if (req) {
    console.log(`  + ${TIPO_REQUERIMENTO} (id ${req.id}) "${req.name}" → família REQUERIMENTO · natureza EVIDENCIA_DE_ETAPA · perfil NENHUM`)
    if (req.perfilOperacionalId != null) console.log("    ! ATENÇÃO: já tem perfil — NÃO será removido aqui; revisar manualmente.")
    if (EXECUTAR) {
      await prisma.tipoDocumentoCadastro.update({
        where: { id: req.id },
        data: {
          familiaDocumentalId: req.familiaDocumentalId ?? (familias.get("REQUERIMENTO")! > 0 ? familias.get("REQUERIMENTO")! : null),
          naturezaOperacionalId: req.naturezaOperacionalId ?? (naturezas.get("EVIDENCIA_DE_ETAPA")! > 0 ? naturezas.get("EVIDENCIA_DE_ETAPA")! : null),
          // perfilOperacionalId permanece como está (null): evidência não tem workflow de emissão.
        },
      })
    }
  }

  // DOC4 — auditoria, sem vínculo. O batismo é certidão, mas é emitido por
  // paróquia, não por cartório: canal, prazo e destinatário são outros. Vincular
  // ao perfil de emissão cartorial exigiria confirmar que os cinco passos servem.
  const doc4 = await prisma.tipoDocumentoCadastro.findFirst({
    where: { publicCode: "DOC4" }, select: { id: true, name: true, perfilOperacionalId: true },
  })
  if (doc4) {
    console.log(`\n  ? DOC4 (id ${doc4.id}) "${doc4.name}" — NÃO vinculado.`)
    console.log("    Motivo: certidão de batismo é emitida por paróquia, não por cartório de registro")
    console.log("    civil. Os cinco passos falam em 'cartório'. Vincular exige decisão de domínio.")
  }

  console.log(`\n${EXECUTAR ? "Aplicado." : "Diagnóstico — nada foi escrito. Use --execute para aplicar."}`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
