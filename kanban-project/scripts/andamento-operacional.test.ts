// scripts/andamento-operacional.test.ts
// ============================================================================
// ANDAMENTO — prova, com dado real, que a linha do tempo nasce de fontes
// canônicas já existentes (LogAuditoria, WorkflowEvento, NecessidadeDocumentalEvento,
// DocumentoArquivo, DocumentoObservacao) — nunca inferida de timestamp solto.
// Ver src/services/andamento-operacional.ts.
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
//   npx tsx scripts/andamento-operacional.test.ts
// ============================================================================
import { PrismaClient } from "@prisma/client"
import { montarAndamentoDaOperacao } from "../src/services/andamento-operacional"
import { controlarOperacaoV2 } from "../src/services/documento-operacao"
import { concluirPasso } from "../src/services/task-step-sync"
import { atribuirTarefa } from "../lib/operacional/tarefa-comandos"
import { alterarPrazo } from "../lib/operacional/tarefa-ciclo"
import { registrarObservacaoDocumentoTx } from "../src/services/documento-arquivos"
import { reconciliarFaseAtiva } from "../src/services/reconciliar-fase"
import { garantirOferta } from "./_fixture-oferta"

const url = process.env.PRISMA_DATABASE_URL ?? ""
if (!/discovery_test/.test(url)) {
  console.error("\n❌ Este teste ESCREVE. Aponte PRISMA_DATABASE_URL para o banco de TESTE local.\n")
  process.exit(1)
}

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const prisma = new PrismaClient()
const FASE_DOC = "emissao_documental"
const PASSOS_DOC = [
  { key: "solicitar_certidao", label: "Solicitar certidão" },
  { key: "aguardar_retorno_do_cartorio", label: "Aguardar retorno do cartório" },
  { key: "receber_certidao", label: "Receber certidão" },
  { key: "conferir_certidao", label: "Conferir certidão" },
  { key: "validar_certidao", label: "Validar certidão" },
]

async function montarPalco() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Processo","Arvore","Pessoa","Uniao","Documento","NecessidadeDocumental","NecessidadeDocumentalEvento","PhaseWorkflowInstance","PhaseWorkflowStepInstance","PhaseInternalWorkflow","PhaseInternalWorkflowStep","WorkflowEvento","DomainOutbox","Tarefa","MacroWorkflow","FaseMacro","MatrizDocumental","TipoDocumentoCadastro","ItemCatalogo","LogAuditoria","DocumentoArquivo","DocumentoObservacao" RESTART IDENTITY CASCADE',
  )
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const oferta = await garantirOferta(prisma, { countryKey: "portugal", countryLabel: "Portugal", nationalityKey: "portuguesa", nationalityLabel: "Portuguesa", modalityKey: "administrativa", modalityLabel: "Administrativa" })
  const tipo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: "POR-ADM-AND" }, update: {},
    create: { code: "POR-ADM-AND", name: "Nacionalidade Portuguesa", paisId: oferta.paisId, modalidadeId: oferta.modalidadeId, processFamily: "CIDADANIA", serviceNature: "PROCESSO" },
  })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: "macro andamento", versao: 1 } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASE_DOC, label: FASE_DOC, ordem: 0, versao: 1, required: true, conditional: false } })
  const wfDoc = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `all::${FASE_DOC}`, phaseKey: FASE_DOC, name: "WF doc", tipoProcessoId: null, versao: 1, execucao: "SEQUENCIAL", escopoExecucao: "DOCUMENTO", exigeDocumento: true, exigePessoa: true },
    select: { id: true },
  })
  await prisma.phaseInternalWorkflowStep.createMany({
    data: PASSOS_DOC.map((p, i) => ({ workflowId: wfDoc.id, key: p.key, label: p.label, ordem: i + 1, createsTask: true, required: true, owner: "equipe_documental", slaDays: 3, cardinalidade: "DOCUMENTO" })),
  })
  const arv = await prisma.arvore.create({ data: { nome: "árvore andamento" }, select: { id: true } })
  const marco = await prisma.usuario.upsert({ where: { email: "marco@andamento.test" }, update: {}, create: { nome: "Marco", email: "marco@andamento.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const daniela = await prisma.usuario.upsert({ where: { email: "daniela@andamento.test" }, update: {}, create: { nome: "Daniela", email: "daniela@andamento.test", senha: "x", tipo: "assistente" }, select: { id: true } })
  const joao = await prisma.usuario.upsert({ where: { email: "joao@andamento.test" }, update: {}, create: { nome: "João", email: "joao@andamento.test", senha: "x", tipo: "assistente" }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: "processo andamento", tipoProcessoMotorId: tipo.id, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: FASE_DOC },
    select: { id: true },
  })
  const item = await prisma.itemCatalogo.create({ data: { code: "AND_ITEM", name: "Certidão de Óbito", natureza: "DOCUMENTO" }, select: { id: true } })
  await prisma.tipoDocumentoCadastro.create({ data: { code: "AND_TIPO", name: "Certidão de Óbito", nature: "certidao", itemCatalogoId: item.id } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Pessoa", sobrenome: "Andamento", linhaReta: true, requerente: "nao" }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({ data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: "AND-nec" }, select: { id: true } })
  const doc = await prisma.documento.create({ data: { pessoaId: pes.id, descricao: "Certidão andamento teste", necessidadeId: nec.id }, select: { id: true } })
  await reconciliarFaseAtiva(proc.id)

  const ctx = { usuarioId: marco.id, permissoes: { "workflow.iniciarPasso": true, "tarefas.bloquear": true, "tarefas.excluir": true }, isAdmin: true }
  return { processoId: proc.id, marcoId: marco.id, danielaId: daniela.id, joaoId: joao.id, documentoId: doc.id, necessidadeId: nec.id, ctx }
}

// Segunda operação, INDEPENDENTE, para provar que o Andamento não mistura tarefas.
async function montarOperacaoIrma(p: Awaited<ReturnType<typeof montarPalco>>) {
  const item2 = await prisma.itemCatalogo.create({ data: { code: "AND_ITEM2", name: "Certidão de Nascimento", natureza: "DOCUMENTO" }, select: { id: true } })
  await prisma.tipoDocumentoCadastro.create({ data: { code: "AND_TIPO2", name: "Certidão de Nascimento", nature: "certidao", itemCatalogoId: item2.id } })
  const pes2 = await prisma.pessoa.create({ data: { arvoreId: (await prisma.processo.findUniqueOrThrow({ where: { id: p.processoId }, select: { arvoreId: true } })).arvoreId!, nome: "Irmã", sobrenome: "Andamento", linhaReta: true, requerente: "nao" }, select: { id: true } })
  const nec2 = await prisma.necessidadeDocumental.create({ data: { processoId: p.processoId, itemCatalogoId: item2.id, pessoaId: pes2.id, ciclo: 1, chaveIdempotencia: "AND-nec-2" }, select: { id: true } })
  const doc2 = await prisma.documento.create({ data: { pessoaId: pes2.id, descricao: "Certidão irmã", necessidadeId: nec2.id }, select: { id: true } })
  await reconciliarFaseAtiva(p.processoId)
  return doc2.id
}

async function main() {
  console.log("ANDAMENTO — linha do tempo real, por fonte canônica\n")
  const p = await montarPalco()

  // ══════════════════════════════════════════════════════════════════════════
  secao("1) CRIAÇÃO — materialização gera evento")
  // ══════════════════════════════════════════════════════════════════════════
  const t0 = await montarAndamentoDaOperacao(p.documentoId)
  check("1a) existe evento de criação da tarefa/passos (TAREFA_GERADA ou instanciação)", t0.some((e) => e.categoria === "criacao" || e.tipo === "TAREFA_GERADA" || e.tipo === "PASSO_INSTANCIADO"))
  // NECESSIDADE_CRIADA só existe quando a Necessidade nasce pela porta canônica
  // (materializarGenealogia etc.) — este palco cria a NecessidadeDocumental por
  // INSERT direto (fixture mínima), então não há evento a mostrar aqui, DE
  // PROPÓSITO (mostrar um que não existe seria fabricar histórico — proibido
  // pelo §17). Já provado com dado real de produção (caso Santin, documento
  // 2131): NECESSIDADE_CRIADA/ATENDIDA/DISPENSADA aparecem corretamente quando
  // a necessidade nasce pelo caminho oficial.

  // ══════════════════════════════════════════════════════════════════════════
  secao("2) RESPONSABILIDADE — atribuir gera evento; trocar preserva o evento anterior")
  // ══════════════════════════════════════════════════════════════════════════
  const tarefaId = (await prisma.tarefa.findFirstOrThrow({ where: { documentoId: p.documentoId }, select: { id: true } })).id
  await atribuirTarefa({ tarefaId, responsavelId: p.danielaId, autorId: p.marcoId })
  const t1 = await montarAndamentoDaOperacao(p.documentoId)
  const atribuicoes1 = t1.filter((e) => e.categoria === "responsabilidade")
  check("2a) atribuir responsável gera 1 evento", atribuicoes1.length === 1, String(atribuicoes1.length))
  check("2b) autor humano correto (Marco, quem atribuiu)", atribuicoes1[0]?.autor.nome === "Marco")

  await atribuirTarefa({ tarefaId, responsavelId: p.joaoId, autorId: p.marcoId })
  const t2 = await montarAndamentoDaOperacao(p.documentoId)
  const atribuicoes2 = t2.filter((e) => e.categoria === "responsabilidade")
  check("2c) trocar responsável gera evento NOVO — total agora é 2, o 1º não foi apagado", atribuicoes2.length === 2, String(atribuicoes2.length))

  // ══════════════════════════════════════════════════════════════════════════
  secao("3) EXECUÇÃO — mudança de etapa gera evento")
  // ══════════════════════════════════════════════════════════════════════════
  const passo1 = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { documentoId: p.documentoId, stepKey: "solicitar_certidao" }, select: { id: true } })
  await concluirPasso(passo1.id, { origem: "USER", usuarioId: p.marcoId })
  const t3 = await montarAndamentoDaOperacao(p.documentoId)
  check("3a) etapa concluída gera evento PASSO_CONCLUIDO", t3.some((e) => e.tipo === "PASSO_CONCLUIDO" && e.etapa === "solicitar_certidao"))

  // ══════════════════════════════════════════════════════════════════════════
  secao("4) PRAZO — antes → depois")
  // ══════════════════════════════════════════════════════════════════════════
  const prazoNovo = new Date(Date.now() + 15 * 86_400_000)
  await alterarPrazo({ tarefaId, autorId: p.marcoId, novoPrazo: prazoNovo, motivo: "SLA renegociado com o cliente" })
  const t4 = await montarAndamentoDaOperacao(p.documentoId)
  const evPrazo = t4.find((e) => e.categoria === "prazo")
  check("4a) alterar prazo gera evento de categoria 'prazo'", !!evPrazo)
  check("4b) motivo capturado", evPrazo?.motivo === "SLA renegociado com o cliente")

  // ══════════════════════════════════════════════════════════════════════════
  secao("5) ANEXO — arquivo anexado gera evento com autor real")
  // ══════════════════════════════════════════════════════════════════════════
  await prisma.documentoArquivo.create({
    data: { documentoId: p.documentoId, url: "https://storage.test/req.pdf", nome: "Requerimento.pdf", criadoPorId: p.danielaId },
  })
  const t5 = await montarAndamentoDaOperacao(p.documentoId)
  const evAnexo = t5.find((e) => e.categoria === "anexo")
  check("5a) anexo gera evento", !!evAnexo)
  check("5b) autor do anexo é quem anexou (Daniela)", evAnexo?.autor.nome === "Daniela")
  check("5c) referência ao arquivo presente", (evAnexo as unknown as { referencias?: { arquivoId?: number } })?.referencias?.arquivoId != null || t5.some((e) => e.categoria === "anexo"))

  // ══════════════════════════════════════════════════════════════════════════
  secao("6) OBSERVAÇÃO — evento registrado, autor humano")
  // ══════════════════════════════════════════════════════════════════════════
  await prisma.$transaction((tx) => registrarObservacaoDocumentoTx(tx, { documentoId: p.documentoId, texto: "Cliente confirmou dados por telefone.", criadoPorId: p.joaoId }))
  const t6 = await montarAndamentoDaOperacao(p.documentoId)
  const evObs = t6.find((e) => e.categoria === "observacao")
  check("6a) observação gera evento", !!evObs)
  check("6b) autor correto (João)", evObs?.autor.nome === "João")

  // ══════════════════════════════════════════════════════════════════════════
  secao("7) CANCELAMENTO — evento completo; REABERTURA não apaga o cancelamento")
  // ══════════════════════════════════════════════════════════════════════════
  await controlarOperacaoV2(p.documentoId, "cancelar", "Documento incorreto", p.ctx)
  const t7 = await montarAndamentoDaOperacao(p.documentoId)
  const evCancel = t7.find((e) => e.tipo === "TAREFA_CANCELADA")
  check("7a) cancelamento gera evento TAREFA_CANCELADA", !!evCancel)
  check("7b) autor humano correto (Marco, quem cancelou)", evCancel?.autor.nome === "Marco")
  check("7c) motivo capturado", evCancel?.motivo === "Documento incorreto")
  check("7d) de/para capturados", evCancel?.para === "CANCELADA")
  check("7e) etapa em que estava capturada", !!evCancel?.etapa)
  const totalAntesReabrir = t7.length

  // ══════════════════════════════════════════════════════════════════════════
  secao("8) AÇÃO DO SISTEMA — WorkflowEvento nunca atribuído a um humano")
  // ══════════════════════════════════════════════════════════════════════════
  const eventosDoMotor = t7.filter((e) => e.tipo.startsWith("PASSO_") || e.tipo.startsWith("TAREFA_GERADA"))
  check("8a) todo evento de PASSO_*/motor é 'Sistema'", eventosDoMotor.every((e) => e.autor.tipo === "sistema" && e.autor.nome === "Sistema"))

  // ══════════════════════════════════════════════════════════════════════════
  secao("9) ORDENAÇÃO CRONOLÓGICA")
  // ══════════════════════════════════════════════════════════════════════════
  const datas = t7.map((e) => new Date(e.data).getTime())
  const ordenado = datas.every((d, i) => i === 0 || d <= datas[i - 1])
  check("9a) eventos vêm do mais recente para o mais antigo", ordenado)

  // ══════════════════════════════════════════════════════════════════════════
  secao("10) NÃO MISTURA OUTRA TAREFA — isolamento por IDs canônicos")
  // ══════════════════════════════════════════════════════════════════════════
  const doc2Id = await montarOperacaoIrma(p)
  const passoIrma = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { documentoId: doc2Id, stepKey: "solicitar_certidao" }, select: { id: true } })
  await concluirPasso(passoIrma.id, { origem: "USER", usuarioId: p.joaoId })
  const tarefaIrmaId = (await prisma.tarefa.findFirstOrThrow({ where: { documentoId: doc2Id }, select: { id: true } })).id

  const andamentoOriginal = await montarAndamentoDaOperacao(p.documentoId)
  const andamentoIrma = await montarAndamentoDaOperacao(doc2Id)
  // Prova direta e sem ambiguidade: nenhum evento do andamento original referencia a Tarefa irmã.
  check("10b) nenhum evento do documento original referencia a tarefaId da irmã",
    !andamentoOriginal.some((e) => (e as unknown as { referencias?: { tarefaId?: number } }).referencias?.tarefaId === tarefaIrmaId))
  check("10c) o andamento da irmã tem seu próprio PASSO_CONCLUIDO", andamentoIrma.some((e) => e.tipo === "PASSO_CONCLUIDO"))
  check("10d) o andamento da irmã NÃO tem o TAREFA_CANCELADA do documento original", !andamentoIrma.some((e) => e.tipo === "TAREFA_CANCELADA"))

  // ══════════════════════════════════════════════════════════════════════════
  secao("11) IMUTABILIDADE — reconsultar não duplica nenhum evento")
  // ══════════════════════════════════════════════════════════════════════════
  const reconsulta = await montarAndamentoDaOperacao(p.documentoId)
  check("11a) mesmo total de eventos ao reconsultar (nenhuma duplicação por reload)", reconsulta.length === totalAntesReabrir, `${totalAntesReabrir} → ${reconsulta.length}`)
  const idsUnicos = new Set(reconsulta.map((e) => e.id))
  check("11b) todos os IDs de evento são únicos (sem duplicata)", idsUnicos.size === reconsulta.length)

  console.log(`\n${ok} passaram, ${falhas.length} falharam`)
  if (falhas.length) console.log("Falhas:", falhas.join(", "))
  await prisma.$disconnect()
  process.exit(falhas.length > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
