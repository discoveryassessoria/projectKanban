// scripts/etapa5-projecoes-convergem.test.ts
// ============================================================================
// ETAPA 5 — PROJEÇÕES E CONSISTÊNCIA ENTRE TELAS — os casos obrigatórios.
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/etapa5-projecoes-convergem.test.ts
//
// A pergunta de cada caso: Tarefas e Projetos, Lista, Kanban (tarefa-grão),
// Central e Minha Fila — todas consumindo `tarefa-projecoes.ts` — mostram a
// MESMA verdade para a MESMA Tarefa? EM_RISCO/conflito de prazo nunca fica
// mascarado; CANCELADA nunca vira CONCLUÍDA; card e lista filtrada fecham.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import {
  visaoGerencial, indicadoresGerenciais, minhaFila, semResponsavel, dossieDaTarefa,
} from "@/lib/operacional/tarefa-projecoes"
import { atribuirTarefa, transferirTarefa } from "@/lib/operacional/tarefa-comandos"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"

const MARCA = "ETAPA5-TEST"

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
  await prisma.notificacaoOperacional.deleteMany({ where: { OR: [{ tarefa: { processoId: { in: ids } } }, { processoId: { in: ids } }] } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@etapa5.test" } } })
}

let seq = 0
async function palco() {
  seq++
  const item = await prisma.itemCatalogo.create({
    data: { code: `${MARCA}_C${seq}`, name: "Certidão de Nascimento - Inteiro Teor", natureza: "DOCUMENTO" }, select: { id: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore ${seq}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo ${seq}`, arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Fulano", sobrenome: `Teste${seq}` }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${proc.id}` },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-inst-${proc.id}` },
    select: { id: true },
  })
  const step = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia", stepKey: "localizar_registro",
      ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL", necessidadeId: nec.id, pessoaId: pes.id,
      papel: "equipe_documental", slaDays: 5, chaveIdempotencia: `${MARCA}-step-${proc.id}`,
    },
    select: { id: true },
  })
  await reconciliarTarefas({ processoId: proc.id })
  const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true } })
  return { processoId: proc.id, stepId: step.id, tarefaId: t.id }
}

const usuario = (nome: string) =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}.${++seq}@etapa5.test`, senha: "x", tipo: "assistente" }, select: { id: true, nome: true } })

function naLista<T extends { taskId: number }>(linhas: T[], taskId: number): T | undefined {
  return linhas.find((l) => l.taskId === taskId)
}

async function main() {
  exigirBancoDeTeste("prova a convergência de projeções da Etapa 5")
  await limpar()

  console.log("ETAPA 5 — projeções convergem\n")

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 1 — Uma Tarefa: mesmo responsável/passo/risco em toda projeção")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela1")
    const p = await palco()
    await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: daniela.id })
    await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "NAO_INICIADA", dataPrazo: null } })

    const { linhas: todas } = await visaoGerencial({ processoId: p.processoId }, new Date())
    const linhaVG = naLista(todas, p.tarefaId)
    const filaMinha = await minhaFila(daniela.id, new Date())
    const linhaMF = naLista(filaMinha, p.tarefaId)
    const dossie = await dossieDaTarefa(p.tarefaId)

    ok("CASO 1) existe em Tarefas e Projetos/Kanban/Lista (visaoGerencial)", !!linhaVG)
    ok("CASO 1) existe em Minha Fila", !!linhaMF)
    ok("CASO 1) mesmo responsável nas duas", linhaVG?.responsavelId === daniela.id && linhaMF?.responsavelId === daniela.id)
    ok("CASO 1) mesmo emRisco nas duas", linhaVG?.emRisco === true && linhaMF?.emRisco === true)
    ok("CASO 1) mesmos motivosRisco (mesmo conjunto)", JSON.stringify([...linhaVG!.motivosRisco].sort()) === JSON.stringify([...linhaMF!.motivosRisco].sort()))
    ok("CASO 1) o dossiê (detalhe expandido) concorda", dossie?.emRisco === true && dossie?.responsavelId === daniela.id)
    ok("CASO 1) passo atual é o mesmo (workflowStepInstanceId por trás)", linhaVG?.etapaAtual === linhaMF?.etapaAtual && linhaVG?.etapaAtual === dossie?.etapaAtual)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 2 — Conflito real Tarefa.dataPrazo × PhaseWorkflowStepInstance.prazo: visível como risco, não mascarado")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela2")
    const p = await palco()
    await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: daniela.id })
    const hoje = new Date()
    // Réplica exata do caso real 3562/3564: Tarefa.dataPrazo != PhaseWorkflowStepInstance.prazo.
    await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { dataPrazo: new Date(hoje.getTime() + 9 * 86400000), statusTarefa: "EM_ANDAMENTO" } })
    await prisma.phaseWorkflowStepInstance.update({ where: { id: p.stepId }, data: { prazo: new Date(hoje.getTime() + 3 * 86400000) } })

    const { linhas } = await visaoGerencial({ processoId: p.processoId }, hoje)
    const linha = naLista(linhas, p.tarefaId)
    ok("CASO 2) a linha mostra EM_RISCO — não apenas o dataPrazo como se não houvesse conflito", linha?.emRisco === true)
    ok("CASO 2) o motivo cita o conflito de verdade (nomeia as duas fontes)", !!linha?.motivosRisco.some((m) => m.includes("CONFLITO_PRAZO_TAREFA_PASSO")))
    ok("CASO 2) o dataPrazo continua exibido (histórico intacto, nada foi escolhido silenciosamente)", linha?.dataPrazo != null)

    const card = await indicadoresGerenciais({ processoId: p.processoId }, hoje)
    ok("CASO 2/CASO 10) o card EM_RISCO conta esta tarefa", card.emRisco >= 1, String(card.emRisco))
    const { linhas: filtradasPorRisco } = await visaoGerencial({ processoId: p.processoId, emRisco: true }, hoje)
    ok("CASO 10) a lista filtrada por EM_RISCO retorna o mesmo universo do card", filtradasPorRisco.length === card.emRisco, `${filtradasPorRisco.length} × ${card.emRisco}`)
    ok("CASO 10) e a tarefa em conflito está nela", !!naLista(filtradasPorRisco, p.tarefaId))
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 3 — Atribuição: Processo/Tarefas e Projetos/Lista/Kanban/Central mostram o mesmo responsável")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const gestor = await usuario("Gestor3")
    const daniela = await usuario("Daniela3")
    const p = await palco()
    await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: gestor.id })

    const tarefaCanonica = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { responsavelId: true } })
    const { linhas } = await visaoGerencial({ processoId: p.processoId }, new Date())
    const linha = naLista(linhas, p.tarefaId)
    ok("CASO 3) Processo (Tarefa canônica) tem Daniela", tarefaCanonica.responsavelId === daniela.id)
    ok("CASO 3) Tarefas e Projetos/Lista/Kanban (visaoGerencial) tem Daniela", linha?.responsavelId === daniela.id)
    ok("CASO 3) Minha Fila da Daniela a inclui", !!naLista(await minhaFila(daniela.id, new Date()), p.tarefaId))
    ok("CASO 3) e some da fila de sem-responsável", !(await semResponsavel(new Date())).some((l) => l.taskId === p.tarefaId))
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 8 — Tarefa cancelada: nenhuma projeção trata como concluída")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela8")
    const p = await palco()
    await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: daniela.id })
    await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "CANCELADA" } })

    const { linhas } = await visaoGerencial({ processoId: p.processoId, incluirEncerradas: true }, new Date())
    const linha = naLista(linhas, p.tarefaId)
    ok("CASO 8) a coluna NÃO é CONCLUIDA — é a própria coluna CANCELADA", linha?.coluna === "CANCELADA", linha?.coluna)
    const card = await indicadoresGerenciais({ processoId: p.processoId }, new Date())
    ok("CASO 8) não conta em 'concluidas'", card.concluidas === 0, String(card.concluidas))
    ok("CASO 8) não conta em 'total' (abertas)", card.total === 0, String(card.total))
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 9 — Filtro responsável: universo lógico idêntico entre Tarefas e Projetos e Minha Fila")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela9")
    const gestor = await usuario("Gestor9")
    const p1 = await palco(), p2 = await palco(), p3 = await palco()
    await atribuirTarefa({ tarefaId: p1.tarefaId, responsavelId: daniela.id, autorId: gestor.id })
    await atribuirTarefa({ tarefaId: p2.tarefaId, responsavelId: daniela.id, autorId: gestor.id })
    // p3 fica com outro responsável — não deve entrar no recorte da Daniela.
    const outro = await usuario("Outro9")
    await atribuirTarefa({ tarefaId: p3.tarefaId, responsavelId: outro.id, autorId: gestor.id })

    const { linhas: porFiltro, total } = await visaoGerencial({ responsavelId: daniela.id }, new Date())
    const filaDaniela = await minhaFila(daniela.id, new Date())
    const idsFiltro = new Set(porFiltro.map((l) => l.taskId))
    const idsFila = new Set(filaDaniela.map((l) => l.taskId))
    ok("CASO 9) mesmo universo lógico (ambos incluem as 2 da Daniela)", idsFiltro.has(p1.tarefaId) && idsFiltro.has(p2.tarefaId) && idsFila.has(p1.tarefaId) && idsFila.has(p2.tarefaId))
    ok("CASO 9) nenhum dos dois inclui a tarefa do outro responsável", !idsFiltro.has(p3.tarefaId) && !idsFila.has(p3.tarefaId))
    ok("CASO 9) total do filtro bate com a contagem de linhas retornadas (sem paginação escondendo linha)", total === porFiltro.length)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 10b — Filtro por coluna: total/página fecham (bug de paginação corrigido)")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela10")
    const gestor = await usuario("Gestor10")
    const tarefas: number[] = []
    for (let i = 0; i < 5; i++) {
      const p = await palco()
      await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: gestor.id })
      tarefas.push(p.tarefaId)
    }
    // Todas nascem NAO_INICIADA + responsavelId setado => coluna A_FAZER.
    const { linhas, total } = await visaoGerencial({ responsavelId: daniela.id, coluna: "A_FAZER", porPagina: 2, pagina: 1 }, new Date())
    ok("CASO 10b) total já reflete o universo FILTRADO por coluna (não o pré-filtro)", total === 5, String(total))
    ok("CASO 10b) a página respeita porPagina dentro do universo certo", linhas.length === 2, String(linhas.length))
    ok("CASO 10b) todas as linhas devolvidas são da coluna pedida", linhas.every((l) => l.coluna === "A_FAZER"))
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("CASO 12 — RBAC: fatos iguais, visibilidade conforme escopo (não é fato diferente)")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const daniela = await usuario("Daniela12")
    const gestor = await usuario("Gestor12")
    const p = await palco()
    await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: gestor.id })

    const { linhas: comoAdmin } = await visaoGerencial({ processoId: p.processoId }, new Date())
    const { linhas: comoResponsavel } = await visaoGerencial({ processoId: p.processoId, responsavelId: daniela.id }, new Date())
    const lAdmin = naLista(comoAdmin, p.tarefaId)
    const lResp = naLista(comoResponsavel, p.tarefaId)
    ok("CASO 12) mesmo statusTarefa nos dois escopos", lAdmin?.statusTarefa === lResp?.statusTarefa)
    ok("CASO 12) mesmo responsavelId nos dois escopos", lAdmin?.responsavelId === lResp?.responsavelId)
    ok("CASO 12) mesmo emRisco nos dois escopos — fato não muda com quem pergunta", lAdmin?.emRisco === lResp?.emRisco)
  }

  await limpar()
  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? "Processo, Tarefas e Projetos, Lista, Kanban, Central e Minha Fila concordam sobre a mesma Tarefa."
    : "As projeções da Etapa 5 divergiram em algum ponto.")
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

void main()
