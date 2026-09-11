// scripts/escopo-operacional-contrato.test.ts
// ============================================================================
// O CONTRATO DE ESCOPO OPERACIONAL — decisão do usuário em 10/09/2026, depois
// de achar Daniela (operacional) vendo "129 ações abertas" e processos de
// outras famílias na Home. CORRIGIDO no mesmo dia: a primeira versão filtrava
// Processo/Família por `tarefas.some.responsavelId = usuario` — o usuário
// reprovou explicitamente ("processo WHERE tarefas.some.responsavelId =
// usuario... essa condição não pertence ao domínio Processo").
//
//   npx tsx scripts/escopo-operacional-contrato.test.ts
//
// Prova, com dados REAIS (não mock), a regra CORRIGIDA:
//   1. `escopoTarefa`/`escopoPasso`: admin sem filtro; operacional SÓ o que é
//      dele — nunca `responsavelId: null` (esse era o vazamento original: a
//      fila da empresa inteira "sem responsável" contava como "minha fila").
//   2. `escopoProcesso`/`escopoDocumento`: SEM filtro por responsável, pra
//      admin E pra operacional — Processo/Família/Documento seguem a
//      permissão de MÓDULO (`processos.ver`/`verFinanceiro`), nunca
//      ownership de tarefa. Um processo aparece mesmo sem nenhuma tarefa
//      atribuída a ninguém.
//   3. `carregarBase` (Home): a lista de PROCESSOS é a mesma pra admin e
//      operacional (mesmo módulo autorizado); a lista de TAREFAS continua
//      sendo o subconjunto pessoal de cada um — são grãos diferentes.
//   4. Busca (`/api/home/search`): PROCESSO/FAMÍLIA acham por nome sem
//      restrição de escopo (só permissão de módulo).
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { carregarBase, type ContextoHome } from "@/src/lib/home/coleta"
import { escopoTarefa, escopoPasso, escopoProcesso, escopoDocumento } from "@/src/lib/autorizacao/escopo-operacional"

const MARCA = "ESCOPOOP"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  const tids = ts.map((t) => t.id)
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: tids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.pendenciaFinanceira.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvore: { nome: { startsWith: MARCA } } } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.familia.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@escopoop.test" } } })
}

async function palco(sufixo: string, familiaId: number | null = null) {
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${sufixo}`, name: `Trabalho ${sufixo}`, natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} ${sufixo}`, arvoreId: arv.id, familiaId }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Ademir", sobrenome: sufixo }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${sufixo}-${proc.id}` }, select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-${sufixo}-${proc.id}` }, select: { id: true },
  })
  await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia", stepKey: `${sufixo}_0`,
      ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL",
      necessidadeId: nec.id, pessoaId: pes.id, papel: "equipe_documental", slaDays: 5,
      chaveIdempotencia: `${MARCA}-s-${sufixo}-${proc.id}-0`,
    },
  })
  await reconciliarTarefas({ processoId: proc.id })
  const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true } })
  return { processoId: proc.id, pessoaId: pes.id, tarefaId: t.id }
}

const usuario = (nome: string, tipo: string) =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@escopoop.test`, senha: "x", tipo }, select: { id: true } })

async function main() {
  exigirBancoDeTeste("prova o escopo ADMIN x OPERACIONAL")
  await limpar()

  const admin = await usuario("Marco", "admin")
  const daniela = await usuario("Daniela", "assistente")
  const joao = await usuario("Joao", "assistente")

  console.log("O CONTRATO DE ESCOPO OPERACIONAL — ADMIN x OPERACIONAL\n")

  // ══════════════════════════════════════════════════════════════════════════
  secao("1) FUNÇÕES PURAS — admin sem filtro, operacional nunca inclui null")
  // ══════════════════════════════════════════════════════════════════════════
  const admEscopo = { userId: admin.id, tipo: "admin" }
  const danEscopo = { userId: daniela.id, tipo: "assistente" }
  ok("1a) escopoTarefa(admin) é {} — sem filtro", JSON.stringify(escopoTarefa(admEscopo)) === "{}")
  ok("1b) escopoTarefa(operacional) é só responsavelId dela", JSON.stringify(escopoTarefa(danEscopo)) === JSON.stringify({ responsavelId: daniela.id }))
  ok("1c) escopoTarefa(operacional) NÃO inclui responsavelId:null", !JSON.stringify(escopoTarefa(danEscopo)).includes("null"))
  ok("1d) escopoPasso segue a mesma regra", JSON.stringify(escopoPasso(danEscopo)) === JSON.stringify({ responsavelId: daniela.id }))
  ok("1e) escopoProcesso(admin) é {} — sem filtro", JSON.stringify(escopoProcesso(admEscopo)) === "{}")
  ok("1f) escopoProcesso(operacional) TAMBÉM é {} — Processo segue permissão de módulo, não tarefa", JSON.stringify(escopoProcesso(danEscopo)) === "{}")
  ok("1g) escopoDocumento(operacional) TAMBÉM é {} — mesma regra de Processo", JSON.stringify(escopoDocumento(danEscopo)) === "{}")

  // ══════════════════════════════════════════════════════════════════════════
  secao("2) CENÁRIO REAL — 3 famílias, cargas diferentes por responsável")
  // ══════════════════════════════════════════════════════════════════════════
  const familiaMedina = await prisma.familia.create({ data: { nome: `${MARCA} Medina Olivares` }, select: { id: true } })
  const familiaCibils = await prisma.familia.create({ data: { nome: `${MARCA} Cibils` }, select: { id: true } })
  const familiaDonato = await prisma.familia.create({ data: { nome: `${MARCA} Donato` }, select: { id: true } })

  // Medina: 1 tarefa da Daniela (via reconciliarTarefas + atribuição manual)
  const medina = await palco("MEDINA", familiaMedina.id)
  await prisma.tarefa.update({ where: { id: medina.tarefaId }, data: { responsavelId: daniela.id } })

  // Cibils: 1 tarefa do João (não é da Daniela)
  const cibils = await palco("CIBILS", familiaCibils.id)
  await prisma.tarefa.update({ where: { id: cibils.tarefaId }, data: { responsavelId: joao.id } })

  // Donato: 1 tarefa SEM responsável (fila da empresa — não é de ninguém ainda)
  const donato = await palco("DONATO", familiaDonato.id)
  await prisma.tarefa.update({ where: { id: donato.tarefaId }, data: { responsavelId: null } })
  await prisma.phaseWorkflowStepInstance.updateMany({ where: { processoId: donato.processoId }, data: { responsavelId: null } })

  const permissoesTudo = { verProcessos: true, verTarefas: true, verEventos: true, verFinanceiro: true, isAdmin: false }
  const agora = new Date()

  const ctxAdmin: ContextoHome = { userId: admin.id, isAdmin: true, permissoes: { ...permissoesTudo, isAdmin: true }, agora }
  const ctxDaniela: ContextoHome = { userId: daniela.id, isAdmin: false, permissoes: permissoesTudo, agora }

  const baseAdmin = await carregarBase(ctxAdmin)
  const baseDaniela = await carregarBase(ctxDaniela)

  const nossos = (processos: Map<number, unknown>) =>
    [...processos.keys()].filter((id) => id === medina.processoId || id === cibils.processoId || id === donato.processoId)

  ok("2a) ADMIN vê os 3 processos (Medina, Cibils, Donato)",
    nossos(baseAdmin.processos).length === 3, `${nossos(baseAdmin.processos).length}/3`)
  // CORRIGIDO: Processo/Família não são filtrados por tarefa — Daniela, com
  // `processos.ver`, vê os MESMOS 3 processos que o admin vê. É a lista de
  // TAREFAS (2e-2h abaixo) que continua pessoal, não a lista de processos.
  ok("2b) DANIELA vê os MESMOS 3 processos que o admin (Processo segue permissão de módulo)",
    nossos(baseDaniela.processos).length === 3, `${nossos(baseDaniela.processos).length}/3`)
  ok("2c) DANIELA vê o processo Cibils mesmo sem tarefa lá (tarefa é do João)", baseDaniela.processos.has(cibils.processoId))
  ok("2d) DANIELA vê o processo Donato mesmo com a tarefa sem responsável", baseDaniela.processos.has(donato.processoId))

  const tarefasDe = (base: typeof baseAdmin, processoId: number) => base.tarefas.filter((t) => t.processoId === processoId)
  ok("2e) ADMIN vê a tarefa de Donato (sem responsável) na base", tarefasDe(baseAdmin, donato.processoId).length === 1)
  ok("2f) DANIELA NÃO vê a tarefa de Donato — sem responsável não é dela", tarefasDe(baseDaniela, donato.processoId).length === 0)
  ok("2g) DANIELA vê exatamente a tarefa dela em Medina, nem uma a mais", tarefasDe(baseDaniela, medina.processoId).length === 1)
  ok("2h) DANIELA não vê a tarefa do João em Cibils", tarefasDe(baseDaniela, cibils.processoId).length === 0)

  // ══════════════════════════════════════════════════════════════════════════
  secao("3) PENDÊNCIA FINANCEIRA — grão de PROCESSO: respeita só o módulo (`verFinanceiro`), não tarefa")
  // ══════════════════════════════════════════════════════════════════════════
  await prisma.pendenciaFinanceira.create({
    data: {
      processoId: cibils.processoId, phaseKey: "genealogia", motivo: "SEM_PRECO", detalhe: "teste",
      chaveIdempotencia: `${MARCA}-pf-${cibils.processoId}`,
    },
  })
  const baseDanielaComFin = await carregarBase({ ...ctxDaniela, permissoes: { ...permissoesTudo, isAdmin: false } })
  ok("3a) DANIELA vê a pendência financeira de Cibils mesmo sem tarefa lá (grão é Processo, não tarefa)",
    baseDanielaComFin.pendencias.some((p) => p.processoId === cibils.processoId))
  const baseAdminComFin = await carregarBase(ctxAdmin)
  ok("3b) ADMIN vê a pendência financeira normalmente", baseAdminComFin.pendencias.some((p) => p.processoId === cibils.processoId))
  const baseDanielaSemFin = await carregarBase({ ...ctxDaniela, permissoes: { ...permissoesTudo, verFinanceiro: false } })
  ok("3c) sem a PERMISSÃO `verFinanceiro`, ninguém vê pendência nenhuma — o módulo continua sendo o gate",
    baseDanielaSemFin.pendencias.length === 0)

  // ══════════════════════════════════════════════════════════════════════════
  secao("4) BUSCA — PROCESSO/FAMÍLIA acham por nome sem restrição de escopo (só permissão de módulo)")
  // ══════════════════════════════════════════════════════════════════════════
  const escopoBusca = escopoProcesso(danEscopo)
  const achaMedina = await prisma.familia.findFirst({ where: { nome: `${MARCA} Medina Olivares`, processos: { some: escopoBusca } } })
  const achaCibils = await prisma.familia.findFirst({ where: { nome: `${MARCA} Cibils`, processos: { some: escopoBusca } } })
  ok("4a) busca de Daniela ACHA a família Medina", !!achaMedina)
  ok("4b) busca de Daniela TAMBÉM acha a família Cibils — Família segue permissão de módulo, não tarefa", !!achaCibils)

  // O `where: { AND: [{OR:[...texto]}, escopo] }` usado em /api/home/search
  // continua sendo o padrão certo para QUALQUER escopo futuro que volte a ter
  // formato `{OR:...}` — hoje nenhum escopo de Processo/Documento tem essa
  // forma (ambos são `{}`), então a colisão de chave `OR` (achado real do dia
  // 10/09) não é mais reproduzível por AQUI. A prova de que o texto pesquisado
  // ainda importa (nunca "qualquer processo") continua válida:
  const textoDonato = { contains: `${MARCA} Donato`, mode: "insensitive" as const }
  const buscaPorTexto = await prisma.processo.findMany({
    where: { AND: [{ OR: [{ nome: textoDonato }, { codigo: textoDonato }] }, escopoBusca] },
  })
  ok("4c) a busca por texto de 'Donato' encontra só o processo Donato (o texto ainda filtra)",
    buscaPorTexto.length === 1 && buscaPorTexto[0].id === donato.processoId)

  // ══════════════════════════════════════════════════════════════════════════
  secao("5) DOCUMENTO — grão de Processo/Pessoa: segue permissão de módulo, não tarefa")
  // ══════════════════════════════════════════════════════════════════════════
  const docCibils = await prisma.documento.create({ data: { pessoaId: cibils.pessoaId, status: "INVALIDO" }, select: { id: true } })
  const docMedina = await prisma.documento.create({ data: { pessoaId: medina.pessoaId, status: "INVALIDO" }, select: { id: true } })
  const docsDaniela = await prisma.documento.findMany({ where: { status: "INVALIDO", ...escopoDocumento(danEscopo) }, select: { id: true } })
  const idsDaniela = docsDaniela.map((d) => d.id)
  ok("5a) DANIELA vê o documento inválido de Medina", idsDaniela.includes(docMedina.id))
  ok("5b) DANIELA TAMBÉM vê o documento inválido de Cibils — documento não é escopado por tarefa", idsDaniela.includes(docCibils.id))

  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) console.log("Falhas:", falhas.join(", "))
  await limpar()
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
