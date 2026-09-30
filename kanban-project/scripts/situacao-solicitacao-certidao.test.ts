// scripts/situacao-solicitacao-certidao.test.ts
//
// REFORMULAÇÃO DA "SITUAÇÃO" NO RELATÓRIO DE CERTIDÕES — rodada 28/09/2026.
//
// Achado real (processo 651, Cibils): a coluna "Situação" mostrava o status
// bruto de NecessidadeDocumental (ATENDIDA) como se fosse "certidão recebida"
// — na prática ATENDIDA só significa "localizei o registro na Genealogia"
// (SATISFAZER_NECESSIDADE, motor registral). As 14 necessidades ATENDIDA do
// Cibils tinham Documento.status ainda em SOLICITAR/SOLICITADO — nenhuma
// certidão física tinha chegado. Caso nomeado pelo usuário: necessidade #620
// (Ruben Cibils, Nascimento, Documento #2263) — ATENDIDA, mas ZERO
// solicitações, ZERO subtarefas concluídas.
//
// SEGUNDA RODADA (mesmo dia): NAO_LOCALIZADA deixou de ser um status manual
// (que nunca teve botão nenhum na UI — 0 casos reais) e passou a ser DERIVADO
// de a Genealogia já ter concluído "Localizar registro" pra aquela
// necessidade ou não. Decisão do usuário: "se existem 3 registros na fase de
// genealogia que não foram localizados, eles vão aparecer no relatório como
// não localizados... até porque essas tarefas ainda não foram fechadas na
// fase de Genealogia, então como que elas seriam solicitadas?"
//
// Mapeamento final (6 estados):
//   NAO_LOCALIZADA — Genealogia ainda NÃO concluiu "Localizar registro".
//   NAO_SOLICITADA — registro localizado, nada enviado ao cartório ainda.
//   PENDENTE       — enviei, aguardando confirmação.
//   SOLICITADO     — cartório confirmou o recebimento do pedido.
//   RECEBIDA       — a certidão (documento) chegou de fato.
//   DISPENSADA     — necessidade não se aplica.
//
// Monta o PRÓPRIO cenário (processo com 8 necessidades REGISTRO_CIVIL, uma por
// situação, incluindo a réplica do caso #620) num banco de teste, com marca e
// limpeza — não depende de dado de produção (o gate roda em banco novo).
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import {
  situacaoDaSolicitacaoCertidao, ROTULO_SITUACAO_SOLICITACAO, CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO,
  CHAVES_SUBTAREFA_ENVIO_REQUERIMENTO, CHAVES_SUBTAREFA_RECEBIMENTO_CERTIDAO,
  STEP_KEY_LOCALIZAR_REGISTRO, STEP_KEY_SOLICITAR_CERTIDAO,
} from "@/src/lib/process-stage/situacao-solicitacao-certidao"
import { DOMINIO_CERTIDOES, CATEGORIA_CERTIDAO } from "@/src/lib/relatorios/motor/dominios/certidoes"
import { executar } from "@/src/lib/relatorios/motor/executar"

let ok = 0, falhou = 0
const falhas: string[] = []
const t = (cond: boolean, nome: string, detalhe = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}

const MARCA = "SITCERT"

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: ids } } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { necessidade: { processoId: { in: ids } } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.categoriaDocumental.deleteMany({ where: { code: CATEGORIA_CERTIDAO, name: `${MARCA} categoria` } })
}

type Caso = {
  rotulo: string
  esperado: keyof typeof ROTULO_SITUACAO_SOLICITACAO
  statusNec: "PENDENTE" | "ATENDIDA" | "DISPENSADA"
  localizado: boolean
  chaves: readonly string[]
}
const ENVIO = CHAVES_SUBTAREFA_ENVIO_REQUERIMENTO[0]
const CONFIRMA = CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO[0]
const RECEBE = CHAVES_SUBTAREFA_RECEBIMENTO_CERTIDAO[0]
const CASOS: Caso[] = [
  { rotulo: "nao_localizada", esperado: "NAO_LOCALIZADA", statusNec: "PENDENTE", localizado: false, chaves: [] },
  { rotulo: "nao_localizada_atendida", esperado: "NAO_LOCALIZADA", statusNec: "ATENDIDA", localizado: false, chaves: [] },
  // réplica do caso nomeado (#620): ATENDIDA, registro localizado, zero subtarefas de solicitação
  { rotulo: "caso620", esperado: "NAO_SOLICITADA", statusNec: "ATENDIDA", localizado: true, chaves: [] },
  { rotulo: "nao_solicitada", esperado: "NAO_SOLICITADA", statusNec: "PENDENTE", localizado: true, chaves: [] },
  { rotulo: "pendente", esperado: "PENDENTE", statusNec: "ATENDIDA", localizado: true, chaves: [ENVIO] },
  { rotulo: "solicitado", esperado: "SOLICITADO", statusNec: "ATENDIDA", localizado: true, chaves: [ENVIO, CONFIRMA] },
  { rotulo: "recebida", esperado: "RECEBIDA", statusNec: "ATENDIDA", localizado: true, chaves: [ENVIO, CONFIRMA, RECEBE] },
  { rotulo: "dispensada", esperado: "DISPENSADA", statusNec: "DISPENSADA", localizado: false, chaves: [] },
]

async function montarCenario() {
  const cat = await prisma.categoriaDocumental.upsert({
    where: { code: CATEGORIA_CERTIDAO }, update: {}, create: { code: CATEGORIA_CERTIDAO, name: `${MARCA} categoria` }, select: { id: true },
  })
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_ITEM`, name: "Certidão de Nascimento", natureza: "DOCUMENTO" }, select: { id: true } })
  await prisma.tipoDocumentoCadastro.create({
    data: { code: `${MARCA}_TIPO`, name: `${MARCA} tipo`, itemCatalogoId: item.id, categoriaDocumentalId: cat.id }, select: { id: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo`, arvoreId: arv.id }, select: { id: true } })
  const instGen = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-ig` }, select: { id: true },
  })
  const instEmi = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-ie` }, select: { id: true },
  })
  const porRotulo = new Map<string, { necessidadeId: number; esperado: Caso["esperado"] }>()
  let n = 0
  for (const c of CASOS) {
    n++
    const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: `Pessoa${n}`, sobrenome: c.rotulo }, select: { id: true } })
    const nec = await prisma.necessidadeDocumental.create({
      data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, status: c.statusNec, chaveIdempotencia: `${MARCA}-n-${n}` },
      select: { id: true },
    })
    const doc = await prisma.documento.create({ data: { pessoaId: pes.id, necessidadeId: nec.id }, select: { id: true } })
    if (c.localizado) {
      await prisma.phaseWorkflowStepInstance.create({
        data: {
          workflowInstanceId: instGen.id, processoId: proc.id, faseMacroKey: "genealogia", stepKey: STEP_KEY_LOCALIZAR_REGISTRO,
          ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "CONCLUIDO", necessidadeId: nec.id, pessoaId: pes.id,
          papel: "equipe_documental", slaDays: 5, chaveIdempotencia: `${MARCA}-loc-${n}`,
        },
      })
      const solicitar = await prisma.phaseWorkflowStepInstance.create({
        data: {
          workflowInstanceId: instEmi.id, processoId: proc.id, faseMacroKey: "emissao_documental", stepKey: STEP_KEY_SOLICITAR_CERTIDAO,
          ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "EM_ANDAMENTO", necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id,
          papel: "equipe_documental", slaDays: 5, chaveIdempotencia: `${MARCA}-sol-${n}`,
        },
        select: { id: true },
      })
      let seq = 0
      for (const k of c.chaves) {
        seq++
        await prisma.subtaskExecution.create({
          data: { stepInstanceId: solicitar.id, subtaskKey: k, sequencia: seq, status: "CONCLUIDO", motivo: "ABERTURA", completedAt: new Date(), chaveIdempotencia: `${MARCA}-ex-${n}-${seq}` },
        })
      }
    }
    porRotulo.set(c.rotulo, { necessidadeId: nec.id, esperado: c.esperado })
  }
  return { processoId: proc.id, porRotulo }
}

async function main() {
  exigirBancoDeTeste("situacao-solicitacao-certidao.test.ts")
  await limpar()
  const cen = await montarCenario()
  const PROCESSO = cen.processoId
  const TOTAL = CASOS.length
  const contaEsperado = (b: string) => CASOS.filter((c) => c.esperado === b).length

  console.log("SITUAÇÃO DA SOLICITAÇÃO DE CERTIDÃO — reformulação 28/09/2026\n")
  console.log("(1) situacaoDaSolicitacaoCertidao — função pura, precedência correta:")
  t(situacaoDaSolicitacaoCertidao({ necessidadeStatus: "DISPENSADA", registroLocalizado: false, chavesConcluidas: ["receber_certidao"] }) === "DISPENSADA",
    "DISPENSADA sempre vence, mesmo com registro não localizado")
  t(situacaoDaSolicitacaoCertidao({ necessidadeStatus: "ATENDIDA", registroLocalizado: false, chavesConcluidas: [] }) === "NAO_LOCALIZADA",
    "registro NÃO localizado → NAO_LOCALIZADA, mesmo com necessidade ATENDIDA (era a origem da confusão)")
  t(situacaoDaSolicitacaoCertidao({ necessidadeStatus: "PENDENTE", registroLocalizado: true, chavesConcluidas: [] }) === "NAO_SOLICITADA",
    "registro localizado, nada enviado → NAO_SOLICITADA (nunca herda o nome 'PENDENTE' do enum bruto)")
  t(situacaoDaSolicitacaoCertidao({ necessidadeStatus: "ATENDIDA", registroLocalizado: true, chavesConcluidas: ["enviar_requerimento_cartorio"] }) === "PENDENTE",
    "registro localizado + só envio concluído → PENDENTE")
  t(situacaoDaSolicitacaoCertidao({ necessidadeStatus: "ATENDIDA", registroLocalizado: true, chavesConcluidas: ["enviar_requerimento_cartorio", "receber_confirmacao_pedido"] }) === "SOLICITADO",
    "envio + confirmação → SOLICITADO")
  t(situacaoDaSolicitacaoCertidao({ necessidadeStatus: "ATENDIDA", registroLocalizado: true, chavesConcluidas: ["enviar_requerimento_cartorio", "receber_confirmacao_pedido", "receber_certidao"] }) === "RECEBIDA",
    "os 3 concluídos → RECEBIDA")
  t(situacaoDaSolicitacaoCertidao({ necessidadeStatus: "ATENDIDA", registroLocalizado: true, chavesConcluidas: ["receber_certidao"] }) === "RECEBIDA",
    "recebimento sozinho (sem confirmação registrada) ainda vence → RECEBIDA")

  console.log("\n(2) Caso nomeado (réplica de #620) — ATENDIDA, registro localizado, ZERO solicitações:")
  const c620 = cen.porRotulo.get("caso620")!
  const nec620 = await prisma.necessidadeDocumental.findUniqueOrThrow({
    where: { id: c620.necessidadeId },
    select: {
      status: true,
      stepInstances: { where: { stepKey: STEP_KEY_LOCALIZAR_REGISTRO, status: { in: ["CONCLUIDO", "DISPENSADO"] } }, select: { id: true }, take: 1 },
      documentos: {
        select: {
          stepInstances: {
            where: { stepKey: STEP_KEY_SOLICITAR_CERTIDAO, status: { notIn: ["SUPERSEDIDO", "CANCELADO"] } },
            orderBy: { id: "desc" }, take: 1,
            select: { execucoesDeSubtarefa: { where: { status: "CONCLUIDO" }, select: { subtaskKey: true } } },
          },
        },
        take: 1,
      },
    },
  })
  t(nec620.status === "ATENDIDA", "necessidade tem status bruto ATENDIDA (a origem da confusão)", String(nec620.status))
  const registroLocalizado620 = nec620.stepInstances.length > 0
  t(registroLocalizado620 === true, "e o registro JÁ foi localizado na Genealogia (passo Localizar registro concluído)")
  const chaves620 = nec620.documentos[0]?.stepInstances[0]?.execucoesDeSubtarefa.map((e) => e.subtaskKey) ?? []
  t(chaves620.length === 0, "mas zero subtarefas de 'Solicitar certidão' concluídas — nenhuma solicitação foi feita")
  const situacao620 = situacaoDaSolicitacaoCertidao({ necessidadeStatus: nec620.status, registroLocalizado: registroLocalizado620, chavesConcluidas: chaves620 })
  t(situacao620 === "NAO_SOLICITADA", "situação calculada é NAO_SOLICITADA (registro localizado, só não pedido) — não mais 'Atendida'", situacao620)

  console.log("\n(3) NAO_LOCALIZADA agora é DERIVADO da Genealogia, não um status morto:")
  const necNaoLocalizadaBruto = await prisma.necessidadeDocumental.count({ where: { processoId: PROCESSO, status: "NAO_LOCALIZADA" } })
  t(necNaoLocalizadaBruto === 0, "NecessidadeDocumental.status=NAO_LOCALIZADA (o status morto antigo): 0 casos — não é mais essa a fonte", String(necNaoLocalizadaBruto))
  const derivadas = await executar(DOMINIO_CERTIDOES, {
    dominio: "certidoes",
    filtros: [
      { key: "processo", valor: { tipo: "entidade", id: PROCESSO } },
      { key: "status", valor: { tipo: "multi_selecao", valores: ["NAO_LOCALIZADA"] } },
    ],
    porPagina: 50,
  })
  t(derivadas.total === contaEsperado("NAO_LOCALIZADA") && derivadas.total > 0,
    "NAO_LOCALIZADA aparece mesmo com ZERO necessidades no status bruto NAO_LOCALIZADA (deriva do passo da Genealogia)", String(derivadas.total))

  console.log(`\n(4) Contra o processo montado (${TOTAL} necessidades REGISTRO_CIVIL) — filtro e coluna NUNCA divergem:`)
  const rTodas = await executar(DOMINIO_CERTIDOES, {
    dominio: "certidoes",
    filtros: [{ key: "processo", valor: { tipo: "entidade", id: PROCESSO } }],
    colunas: ["status"],
    porPagina: 50,
  })
  t(rTodas.total === TOTAL, `${TOTAL} necessidades no total`, String(rTodas.total))
  const porBucketNaColuna = new Map<string, number>()
  for (const l of rTodas.linhas) {
    const v = String(l.celulas.find((c) => c.key === "status")?.valor)
    porBucketNaColuna.set(v, (porBucketNaColuna.get(v) ?? 0) + 1)
  }
  let somaCruzada = 0
  for (const [bucket, rotulo] of Object.entries(ROTULO_SITUACAO_SOLICITACAO)) {
    const rFiltro = await executar(DOMINIO_CERTIDOES, {
      dominio: "certidoes",
      filtros: [
        { key: "processo", valor: { tipo: "entidade", id: PROCESSO } },
        { key: "status", valor: { tipo: "multi_selecao", valores: [bucket] } },
      ],
      porPagina: 50,
    })
    const naColuna = porBucketNaColuna.get(rotulo) ?? 0
    t(rFiltro.total === naColuna, `filtro status=${bucket} (${rFiltro.total}) bate com a coluna "${rotulo}" (${naColuna})`)
    t(rFiltro.total === contaEsperado(bucket), `bucket ${bucket} tem exatamente as ${contaEsperado(bucket)} necessidades esperadas do cenário`, String(rFiltro.total))
    somaCruzada += rFiltro.total
  }
  t(somaCruzada === TOTAL, `a soma dos 6 buckets fecha nas ${TOTAL} necessidades (nenhuma sobra, nenhuma duplicada)`, String(somaCruzada))

  console.log("\n(5) NAO_LOCALIZADA bate com o que a Genealogia mostra (passos Localizar registro ainda não concluídos):")
  const naoConcluidasNaGenealogia = CASOS.filter((c) => !c.localizado && c.esperado !== "DISPENSADA").length
  t(derivadas.total === naoConcluidasNaGenealogia,
    "NAO_LOCALIZADA = necessidades não dispensadas cujo 'Localizar registro' não concluiu", `${derivadas.total} vs ${naoConcluidasNaGenealogia}`)

  await limpar()
  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${ok} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => {
  await prisma.$disconnect()
})
