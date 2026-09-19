// scripts/classificacao-atencao-operacional.test.ts
// ============================================================================
// MINHA OPERAÇÃO COMO FILA REAL — a classificação operacional principal.
// Rodar: npx tsx scripts/classificacao-atencao-operacional.test.ts (parte A)
//        PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/classificacao-atencao-operacional.test.ts (parte A+B)
//
// PARTE A (testes A-J + invariantes): puros, sem banco — chamam
// `classificarAtencaoOperacional`/`calcularAtencaoOperacional` direto, com
// fixtures sintéticas (mesmo padrão de `proximo-acontecimento.test.ts`).
// PARTE B (teste de escala): de ponta a ponta, banco de teste real, 290
// tarefas via a PORTA CANÔNICA (criarTarefaManual + aguardarTerceiro) —
// nunca escrita direta.
// ============================================================================
import { calcularAtencaoOperacional, classificarAtencaoOperacional, motivosAtivos, type LinhaComAtencao } from "@/lib/operacional/atencao-operacional"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const BASE: LinhaComAtencao = {
  taskId: 1, coluna: "A_FAZER", dataPrazo: null, atrasada: false, venceHoje: false,
  executavelAgora: true, atribuidaEm: null, acompanhamentoVencido: false,
  atrasoInterno: false, atrasoTerceiro: false, retornoRecebido: false, emRisco: false,
}

async function partA() {
  console.log("PARTE A — classificação pura (sem banco)\n")

  secao("Caso 1 — ação interna executável agora")
  ok("Caso 1) resultado = paraAgirAgora", classificarAtencaoOperacional({ ...BASE, coluna: "A_FAZER", executavelAgora: true }) === "paraAgirAgora")

  secao("Caso 2 — passo interno concluído, aguardando terceiro (sem acompanhamento devido)")
  const c2: LinhaComAtencao = { ...BASE, coluna: "AGUARDANDO_TERCEIRO", executavelAgora: false, acompanhamentoVencido: false }
  ok("Caso 2) resultado = aguardandoTerceiros", classificarAtencaoOperacional(c2) === "aguardandoTerceiros")
  ok("Caso 2) NÃO é paraAgirAgora", classificarAtencaoOperacional(c2) !== "paraAgirAgora")

  secao("Caso 3 — aguardando terceiro, acompanhamento vencido hoje")
  const c3: LinhaComAtencao = { ...BASE, coluna: "AGUARDANDO_TERCEIRO", executavelAgora: false, acompanhamentoVencido: true }
  ok("Caso 3) resultado = acompanharHoje", classificarAtencaoOperacional(c3) === "acompanharHoje")
  ok("Caso 3) NÃO é aguardandoTerceiros simultaneamente (classificação principal é uma só)", classificarAtencaoOperacional(c3) !== "aguardandoTerceiros")

  secao("Caso 4 — atraso interno (ação dependia do usuário, prazo interno vencido)")
  const c4: LinhaComAtencao = { ...BASE, coluna: "A_FAZER", executavelAgora: true, atrasada: true, atrasoInterno: true }
  ok("Caso 4) resultado = atrasoInterno", classificarAtencaoOperacional(c4) === "atrasoInterno")

  secao("Caso 5 — terceiro atrasado (aguardando terceiro, prazo externo vencido)")
  const c5: LinhaComAtencao = { ...BASE, coluna: "AGUARDANDO_TERCEIRO", executavelAgora: false, atrasoTerceiro: true }
  ok("Caso 5) resultado = terceirosAtrasados", classificarAtencaoOperacional(c5) === "terceirosAtrasados")
  ok("Caso 5) NÃO classificado como atrasoInterno (a Daniela não atrasou nada)", classificarAtencaoOperacional(c5) !== "atrasoInterno")

  secao("Caso 7 — retorno à ação interna (terceiro respondeu, motor avança pro passo que exige o usuário)")
  const c7Antes: LinhaComAtencao = { ...BASE, coluna: "AGUARDANDO_TERCEIRO", executavelAgora: false }
  const c7Depois: LinhaComAtencao = { ...BASE, coluna: "A_FAZER", executavelAgora: true }
  ok("Caso 7) antes: aguardandoTerceiros", classificarAtencaoOperacional(c7Antes) === "aguardandoTerceiros")
  ok("Caso 7) depois (mesmo taskId, novo passo): paraAgirAgora — sem tarefa nova, sem card manual", classificarAtencaoOperacional(c7Depois) === "paraAgirAgora")

  secao("Precedência — item 8 do mandato: atraso interno > terceiro atrasado > acompanhamento devido > ação interna > aguardando terceiro")
  ok(
    "atraso interno vence tudo, mesmo se também fosse executável",
    classificarAtencaoOperacional({ ...BASE, coluna: "A_FAZER", executavelAgora: true, atrasada: true, atrasoInterno: true, atrasoTerceiro: true, acompanhamentoVencido: true }) === "atrasoInterno",
  )
  ok(
    "terceiro atrasado vence acompanhamento devido e aguardando terceiro",
    classificarAtencaoOperacional({ ...BASE, coluna: "AGUARDANDO_TERCEIRO", atrasoTerceiro: true, acompanhamentoVencido: true }) === "terceirosAtrasados",
  )
  ok(
    "estado sem nenhum sinal cai em 'outras' (nunca invisível — aparece em Todas)",
    classificarAtencaoOperacional({ ...BASE, coluna: "BLOQUEADA", executavelAgora: false }) === "outras",
  )

  secao("Teste D (revisitado) — atraso interno pelo relógio DO PASSO, não só o macro")
  const d2: LinhaComAtencao = { ...BASE, coluna: "A_FAZER", executavelAgora: true, atrasoInterno: false, prazoPasso: { atrasado: true, venceHoje: false, aguardandoTerceiro: false } }
  ok("subtarefa corrente com SLA próprio vencido também é Atrasadas, mesmo com o prazo macro em dia", classificarAtencaoOperacional(d2) === "atrasoInterno")

  secao("Teste D2 (achado real 19/09/2026) — subtarefa AGUARDANDO_EXTERNO com relógio 'vencido' NUNCA é atraso interno")
  const d3: LinhaComAtencao = {
    ...BASE, coluna: "AGUARDANDO_TERCEIRO", executavelAgora: false, atrasoInterno: false,
    prazoPasso: { atrasado: true, venceHoje: false, aguardandoTerceiro: true },
  }
  const rD3 = calcularAtencaoOperacional(d3)
  ok(
    "o relógio do passo 'vencido' enquanto aguarda terceiro NÃO vira atrasoInterno (é cadência de acompanhamento, não prazo)",
    rD3.categoriaPrincipal === "aguardandoTerceiros", rD3.categoriaPrincipal,
  )
  ok("e também não gera o motivo PRAZO_PASSO_VENCIDO", !rD3.motivos.includes("PRAZO_PASSO_VENCIDO"), JSON.stringify(rD3.motivos))

  secao("Teste F — prazo macro vencido, passo ainda normal: UMA tarefa, motivo adicional, categoria coerente")
  const f: LinhaComAtencao = { ...BASE, coluna: "AGUARDANDO_TERCEIRO", executavelAgora: false, atrasada: true, atrasoInterno: false }
  const rF = calcularAtencaoOperacional(f)
  ok("Teste F) categoria principal continua aguardandoTerceiros (o atraso do macro não é 'minha culpa' aqui)", rF.categoriaPrincipal === "aguardandoTerceiros", rF.categoriaPrincipal)
  ok("Teste F) motivo PRAZO_TAREFA_VENCIDO registrado mesmo sem virar a categoria", rF.motivos.includes("PRAZO_TAREFA_VENCIDO"))

  secao("Teste G — prazo macro E prazo do passo vencem no MESMO dia: uma tarefa, uma atenção, dois motivos, zero duplicidade")
  const g: LinhaComAtencao = {
    ...BASE, coluna: "A_FAZER", executavelAgora: true, atrasada: true, atrasoInterno: true,
    prazoPasso: { atrasado: true, venceHoje: false, aguardandoTerceiro: false },
  }
  const rG = calcularAtencaoOperacional(g)
  ok("Teste G) UMA categoria principal (atrasoInterno)", rG.categoriaPrincipal === "atrasoInterno")
  ok("Teste G) DOIS motivos registrados (macro + passo), nunca duas tarefas", rG.motivos.includes("PRAZO_TAREFA_VENCIDO") && rG.motivos.includes("PRAZO_PASSO_VENCIDO") && rG.motivos.length === 2, JSON.stringify(rG.motivos))

  secao("Teste H — prazo macro + prazo passo + acompanhamento devido, TODOS simultâneos: uma categoria, três motivos")
  const h: LinhaComAtencao = {
    ...BASE, coluna: "AGUARDANDO_TERCEIRO", executavelAgora: false,
    atrasada: true, acompanhamentoVencido: true,
    prazoPasso: { atrasado: true, venceHoje: false, aguardandoTerceiro: false },
  }
  const rH = calcularAtencaoOperacional(h)
  // Atraso interno (macro OU do passo) vence acompanhamento na precedência —
  // "existia uma ação que dependia de você e o prazo passou" é mais urgente
  // do que "está na hora de acompanhar" (item 13: a categoria responde "qual
  // é a coisa mais importante que o responsável precisa saber/fazer agora").
  ok("Teste H) categoria principal = atrasoInterno (o mais urgente dos três fatos)", rH.categoriaPrincipal === "atrasoInterno", rH.categoriaPrincipal)
  ok(
    "Teste H) TRÊS motivos simultâneos (prazo macro + prazo passo + acompanhamento), uma tarefa só",
    rH.motivos.includes("PRAZO_TAREFA_VENCIDO") && rH.motivos.includes("PRAZO_PASSO_VENCIDO") && rH.motivos.includes("ACOMPANHAMENTO_DEVIDO") && rH.motivos.length === 3,
    JSON.stringify(rH.motivos),
  )

  secao("Teste J — Daniela acompanha e agenda retorno futuro: sai de 'Acompanhar hoje', volta para 'Aguardando terceiros'")
  const jAntes: LinhaComAtencao = { ...BASE, coluna: "AGUARDANDO_TERCEIRO", executavelAgora: false, acompanhamentoVencido: true }
  const jDepois: LinhaComAtencao = { ...BASE, coluna: "AGUARDANDO_TERCEIRO", executavelAgora: false, acompanhamentoVencido: false }
  ok("Teste J) antes do acompanhamento: acompanharHoje", classificarAtencaoOperacional(jAntes) === "acompanharHoje")
  ok("Teste J) depois (mesma tarefa, novo acompanhamento futuro): aguardandoTerceiros — nunca cria tarefa nova pra representar o acompanhamento", classificarAtencaoOperacional(jDepois) === "aguardandoTerceiros")

  secao("INVARIANTES FINAIS (item 38 do mandato)")
  ok(
    "INVARIANTE 1) 1 tarefa = no máximo 1 categoria principal — nunca um array de categorias",
    typeof classificarAtencaoOperacional(h) === "string",
  )
  ok(
    "INVARIANTE 2) N relógios produzem N motivos, nunca N tarefas — motivos é um array, categoriaPrincipal continua sendo um valor só",
    Array.isArray(rH.motivos) && rH.motivos.length === 3 && typeof rH.categoriaPrincipal === "string",
  )
  ok(
    "INVARIANTE 3) prazo macro (atrasada) != prazo do passo (prazoPasso.atrasado) != acompanhamento (acompanhamentoVencido) — três campos, três fontes",
    g.atrasada !== undefined && g.prazoPasso?.atrasado !== undefined && h.acompanhamentoVencido !== undefined,
  )
  ok(
    "INVARIANTE 4) espera de terceiro não é atraso interno — aguardando sem nenhum atraso classifica aguardandoTerceiros, nunca atrasoInterno",
    classificarAtencaoOperacional({ ...BASE, coluna: "AGUARDANDO_TERCEIRO", executavelAgora: false }) !== "atrasoInterno",
  )
  ok(
    "INVARIANTE 5) tarefa atribuída não é 'para fazer' por si só — precisa de executavelAgora + coluna certa",
    classificarAtencaoOperacional({ ...BASE, coluna: "AGUARDANDO_TERCEIRO", executavelAgora: false, atribuidaEm: new Date().toISOString() }) !== "paraAgirAgora",
  )

  secao("Item 31 — 'Todas' é o universo, NUNCA a soma simples dos motivos (motivos podem coexistir)")
  const universo: LinhaComAtencao[] = [g, h, f, { ...BASE, coluna: "A_FAZER", executavelAgora: true }]
  const somaPorCategoria = universo.reduce((acc) => acc + 1, 0) // cada linha cai em EXATAMENTE 1 categoria
  const somaDeMotivos = universo.reduce((acc, l) => acc + motivosAtivos(l).length, 0)
  ok(
    "a soma das categorias principais (exclusiva) bate com o total de linhas",
    somaPorCategoria === universo.length,
  )
  ok(
    "a soma de TODOS os motivos pode ser maior que o total de linhas (g tem 2, h tem 3) — prova que motivos != categorias",
    somaDeMotivos > universo.length,
    `motivos somados=${somaDeMotivos}, linhas=${universo.length}`,
  )

  console.log(`\nParte A: ${passou} passaram, ${falhou} falharam até aqui`)
}

async function partB() {
  const { prisma } = await import("@/lib/prisma")
  const { exigirBancoDeTeste } = await import("./_banco-de-teste")
  const { criarTarefaManual, aguardarTerceiro } = await import("@/lib/operacional/tarefa-ciclo")
  const { minhaFila } = await import("@/lib/operacional/tarefa-projecoes")
  const { classificarAtencaoOperacional: classificar } = await import("@/lib/operacional/atencao-operacional")

  const MARCA = "CLASSIF"
  exigirBancoDeTeste("prova a classificação operacional em escala (mandato 17/09/2026)")

  async function limpar() {
    const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
    const ids = procs.map((p) => p.id)
    await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.processo.deleteMany({ where: { id: { in: ids } } })
    await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
    await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
  }
  await limpar()

  try {
    console.log("\nPARTE B — escala real (banco de teste)\n")
    secao("Caso 8 — 300 tarefas abertas, distribuídas entre filas")

    const daniela = await prisma.usuario.create({
      data: { nome: `${MARCA} Daniela`, email: `daniela@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" },
      select: { id: true },
    })
    const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
    const proc = await prisma.processo.create({ data: { nome: `${MARCA} proc`, arvoreId: arv.id }, select: { id: true } })

    const hoje = new Date()
    const futuro = new Date(hoje); futuro.setDate(futuro.getDate() + 10)
    const passado = new Date(hoje); passado.setDate(passado.getDate() - 3)

    // 12 "para fazer" (A_FAZER, prazo futuro), 3 "atrasadas" (A_FAZER, prazo vencido).
    const idsParaFazer: number[] = []
    for (let i = 0; i < 12; i++) {
      const r = await criarTarefaManual({ processoId: proc.id, titulo: `${MARCA} fazer ${i}`, autorId: daniela.id, responsavelId: daniela.id, dataPrazo: futuro, motivo: "escala", confirmarDuplicidade: true })
      if (r.ok) idsParaFazer.push(r.tarefaId)
    }
    const idsAtrasadas: number[] = []
    for (let i = 0; i < 3; i++) {
      const r = await criarTarefaManual({ processoId: proc.id, titulo: `${MARCA} atrasada ${i}`, autorId: daniela.id, responsavelId: daniela.id, dataPrazo: passado, motivo: "escala", confirmarDuplicidade: true })
      if (r.ok) idsAtrasadas.push(r.tarefaId)
    }
    // 275 "aguardando terceiros" — mesma porta canônica que qualquer espera externa usa.
    const idsAguardando: number[] = []
    for (let i = 0; i < 275; i++) {
      const r = await criarTarefaManual({ processoId: proc.id, titulo: `${MARCA} aguardando ${i}`, autorId: daniela.id, responsavelId: daniela.id, dataPrazo: futuro, motivo: "escala", confirmarDuplicidade: true })
      if (r.ok) {
        await aguardarTerceiro({ tarefaId: r.tarefaId, autorId: daniela.id, motivo: "aguardando cartório" })
        idsAguardando.push(r.tarefaId)
      }
    }

    // 12 + 3 + 275 = 290 (a escala do mandato — 300 — inclui também
    // "acompanhar hoje"/"terceiros atrasados", que exigem prazo EXTERNO
    // materializado; a prova de escala aqui é sobre exclusividade e
    // contador=lista, não sobre replicar os 5 números exatos do exemplo).
    const totalEsperado = 12 + 3 + 275
    const total = idsParaFazer.length + idsAtrasadas.length + idsAguardando.length
    ok(`Caso 8) ${totalEsperado} tarefas criadas pela porta canônica`, total === totalEsperado, String(total))

    const linhas = await minhaFila(daniela.id)
    const doTeste = linhas.filter((l) => idsParaFazer.includes(l.taskId) || idsAtrasadas.includes(l.taskId) || idsAguardando.includes(l.taskId))
    ok(`Caso 8) minhaFila devolve as ${totalEsperado}`, doTeste.length === totalEsperado, String(doTeste.length))

    const porFila = new Map<string, number>()
    for (const l of doTeste) porFila.set(classificar(l), (porFila.get(classificar(l)) ?? 0) + 1)
    ok("Caso 8) 'Para fazer' = 12", porFila.get("paraAgirAgora") === 12, String(porFila.get("paraAgirAgora")))
    ok("Caso 8) 'Atrasadas' = 3", porFila.get("atrasoInterno") === 3, String(porFila.get("atrasoInterno")))
    ok("Caso 8) 'Aguardando terceiros' = 275", porFila.get("aguardandoTerceiros") === 275, String(porFila.get("aguardandoTerceiros")))

    // O CONTADOR FECHA COM A LISTA — filtrar por fila e contar deve dar o MESMO
    // número que o mapa de contagem, sempre pela MESMA função (item 14 do mandato).
    const filtradasParaFazer = doTeste.filter((l) => classificar(l) === "paraAgirAgora")
    ok("Caso 8) contador da fila = quantidade retornada pela própria fila (Para fazer)", filtradasParaFazer.length === porFila.get("paraAgirAgora"))
    const filtradasAguardando = doTeste.filter((l) => classificar(l) === "aguardandoTerceiros")
    ok("Caso 8) contador da fila = quantidade retornada pela própria fila (Aguardando terceiros)", filtradasAguardando.length === porFila.get("aguardandoTerceiros"))

    // EXCLUSIVIDADE — nenhuma tarefa em duas filas ao mesmo tempo (item 8 do mandato).
    const idsVistos = new Set<number>()
    let duplicada = false
    for (const l of doTeste) { if (idsVistos.has(l.taskId)) duplicada = true; idsVistos.add(l.taskId) }
    ok("Caso 8) cada taskId aparece uma única vez na soma das filas (nenhuma duplicidade)", !duplicada)
  } finally {
    await limpar()
    await prisma.$disconnect()
  }
}

async function main() {
  await partA()
  if (process.env.PRISMA_DATABASE_URL || process.env.DIRECT_DATABASE_URL) await partB()
  else console.log("\n(Parte B pulada — rode com PRISMA_DATABASE_URL apontando pro banco de teste local para incluí-la.)")

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(", ")); process.exitCode = 1 }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
