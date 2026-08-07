/**
 * BACKFILL — resíduos deixados por exclusões de pessoa anteriores ao serviço canônico.
 *
 *   npm run backfill:residuos-pessoa        (DRY-RUN — só relata, não escreve)
 *   npm run backfill:residuos-pessoa:execute
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE SCRIPT NÃO FAZ
 * ═══════════════════════════════════════════════════════════════════════════
 * Não consolida identidade, não decide qual de dois registros é "o certo", não
 * apaga nada que tenha fato histórico, e não inventa vínculo que não existe.
 *
 * Ele repara SÓ o determinístico: linha derivada que perdeu a origem e não
 * carrega fato nenhum. Tudo que exige julgamento sai classificado como AMBIGUO
 * e fica para decisão humana — com os IDs na mão.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CLASSIFICAÇÃO
 * ═══════════════════════════════════════════════════════════════════════════
 *   INTEGRO              nada a fazer
 *   REPARAVEL            derivado sem origem e sem fato → sai
 *   HISTORICO_PROTEGIDO  tem fato → permanece, por decisão, não por omissão
 *   AMBIGUO              exige julgamento → relatado, nunca tocado
 */
import { prisma } from "../src/lib/prisma"

const EXECUTAR = process.argv.includes("--execute")

type Classe = "INTEGRO" | "REPARAVEL" | "HISTORICO_PROTEGIDO" | "AMBIGUO"

interface Achado {
  categoria: string
  classe: Classe
  ids: number[]
  detalhe: string
  /** Executado só quando `--execute` e classe === REPARAVEL. */
  reparar?: () => Promise<number>
}

const achados: Achado[] = []

async function levantar() {
  // ── 1) TAREFA ÓRFÃ ───────────────────────────────────────────────────────
  // Tarefa é PROJEÇÃO de um passo. Sem passo, sem necessidade e sem documento,
  // ela não projeta nada: é fila ativa apontando para trabalho que não existe.
  // Foi assim que sobraram 16 "Localizar registro da certidão" no processo 513.
  const orfas = await prisma.tarefa.findMany({
    where: {
      workflowStepInstanceId: null,
      necessidadeId: null,
      documentoId: null,
      origem: { notIn: ["MANUAL", "manual"] },
      concluida: false,
      dataInicio: null,
    },
    select: { id: true, processoId: true, titulo: true, statusTarefa: true },
  })
  // Tarefa com subtarefa que já andou não é descartável: a subtarefa é o trabalho.
  const comFilhaViva = new Set(
    (await prisma.tarefa.findMany({
      where: { tarefaPaiId: { in: orfas.map((t) => t.id) }, OR: [{ concluida: true }, { dataInicio: { not: null } }] },
      select: { tarefaPaiId: true },
    })).map((t) => t.tarefaPaiId!),
  )
  const descartaveis = orfas.filter((t) => !comFilhaViva.has(t.id))
  const comHistorico = orfas.filter((t) => comFilhaViva.has(t.id))

  if (descartaveis.length) {
    achados.push({
      categoria: "Tarefa órfã (sem passo, sem necessidade, sem documento, nunca iniciada)",
      classe: "REPARAVEL",
      ids: descartaveis.map((t) => t.id),
      detalhe: `processos: ${[...new Set(descartaveis.map((t) => t.processoId))].join(", ")}`,
      reparar: async () => (await prisma.tarefa.deleteMany({ where: { id: { in: descartaveis.map((t) => t.id) } } })).count,
    })
  }
  if (comHistorico.length) {
    achados.push({
      categoria: "Tarefa órfã COM subtarefa já trabalhada",
      classe: "HISTORICO_PROTEGIDO",
      ids: comHistorico.map((t) => t.id),
      detalhe: "a subtarefa registra trabalho real — a árvore de tarefas permanece",
    })
  }

  // ── 2) TAREFA APONTANDO PARA PESSOA INEXISTENTE ──────────────────────────
  // `Tarefa.pessoaId` é coluna solta (sem FK): nunca foi limpa por cascata.
  const pessoasVivas = new Set((await prisma.pessoa.findMany({ select: { id: true } })).map((p) => p.id))
  const tarefasPessoaMorta = (await prisma.tarefa.findMany({
    where: { pessoaId: { not: null } },
    select: { id: true, pessoaId: true, concluida: true },
  })).filter((t) => !pessoasVivas.has(t.pessoaId!))

  const semFato = tarefasPessoaMorta.filter((t) => !t.concluida)
  const comFato = tarefasPessoaMorta.filter((t) => t.concluida)
  if (semFato.length) {
    achados.push({
      categoria: "Tarefa de pessoa inexistente, não concluída",
      classe: "REPARAVEL",
      ids: semFato.map((t) => t.id),
      detalhe: "aponta para Pessoa que não existe mais",
      reparar: async () => (await prisma.tarefa.deleteMany({ where: { id: { in: semFato.map((t) => t.id) } } })).count,
    })
  }
  if (comFato.length) {
    achados.push({
      categoria: "Tarefa CONCLUÍDA de pessoa inexistente",
      classe: "HISTORICO_PROTEGIDO",
      ids: comFato.map((t) => t.id),
      detalhe: "conclusão é fato — a tarefa permanece como histórico",
    })
  }

  // ── 3) PASSO SEM ESCOPO ──────────────────────────────────────────────────
  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    where: { pessoaId: null, necessidadeId: null, documentoId: null, status: { in: ["PENDENTE", "DISPONIVEL"] } },
    select: { id: true, processoId: true, stepKey: true },
  })
  // Passo de escopo GLOBAL nasce legitimamente sem entidade. O resíduo é o que
  // PERDEU o escopo — e isso só se distingue pelas tarefas que ficaram penduradas
  // nele: passo global vivo tem tarefa; passo desligado não tem mais nada.
  const passosComTarefa = new Set(
    (await prisma.tarefa.findMany({
      where: { workflowStepInstanceId: { in: passos.map((p) => p.id) } },
      select: { workflowStepInstanceId: true },
    })).map((t) => t.workflowStepInstanceId!),
  )
  const passosSoltos = passos.filter((p) => !passosComTarefa.has(p.id))
  if (passosSoltos.length) {
    achados.push({
      categoria: "Passo sem escopo e sem tarefa (escopo desligado por SetNull)",
      classe: "AMBIGUO",
      ids: passosSoltos.map((p) => p.id),
      detalhe: "pode ser passo GLOBAL legítimo — não é possível distinguir sem a definição publicada; NÃO tocado",
    })
  }

  // ── 4) NECESSIDADE SEM SUJEITO ───────────────────────────────────────────
  const necSemSujeito = await prisma.necessidadeDocumental.findMany({
    where: { pessoaId: null, uniaoId: null },
    select: { id: true, processoId: true },
  })
  if (necSemSujeito.length) {
    achados.push({
      categoria: "NecessidadeDocumental sem sujeito",
      classe: "REPARAVEL",
      ids: necSemSujeito.map((n) => n.id),
      detalhe: "viola o invariante pessoaId XOR uniaoId; é reproduzível pela materialização",
      reparar: async () => {
        await prisma.phaseWorkflowStepInstance.deleteMany({ where: { necessidadeId: { in: necSemSujeito.map((n) => n.id) } } })
        return (await prisma.necessidadeDocumental.deleteMany({ where: { id: { in: necSemSujeito.map((n) => n.id) } } })).count
      },
    })
  }

  // ── 5) PARTICIPANTE FINANCEIRO DUPLICADO ─────────────────────────────────
  const partDup = await prisma.$queryRaw<{ receitaId: number; requerenteId: number; ids: number[] }[]>`
    SELECT rr."receitaId", rr."requerenteId", ARRAY_AGG(rr.id ORDER BY rr.id) AS ids
      FROM "ReceitaRequerente" rr
     WHERE rr."requerenteId" IS NOT NULL
     GROUP BY rr."receitaId", rr."requerenteId"
    HAVING COUNT(*) > 1
  `
  if (partDup.length) {
    achados.push({
      categoria: "Participante financeiro duplicado (mesma receita, mesmo requerente)",
      classe: "AMBIGUO",
      ids: partDup.flatMap((d) => d.ids),
      detalhe: "os percentuais podem diferir — consolidar é decisão de negócio, não de script",
    })
  }

  // ── 6) IDENTIDADE CANÔNICA DUPLICADA ─────────────────────────────────────
  const reqDup = await prisma.$queryRaw<{ personId: number; ids: number[] }[]>`
    SELECT "personId", ARRAY_AGG(id ORDER BY id) AS ids
      FROM "Requerente"
     WHERE "personId" IS NOT NULL
     GROUP BY "personId"
    HAVING COUNT(*) > 1
  `
  if (reqDup.length) {
    achados.push({
      categoria: "Dois Requerentes para a MESMA Pessoa",
      classe: "AMBIGUO",
      ids: reqDup.flatMap((d) => d.ids),
      detalhe: "impede a constraint Requerente_personId_key — exige escolha do vínculo canônico",
    })
  }

  // ── 7) VÍNCULO ATIVO DUPLICADO POR IDENTIDADE ────────────────────────────
  // Roda ANTES e DEPOIS da migration `20260807_pessoa_ciclo_vida`: onde a coluna
  // `removidoEm` ainda não existe, TODO vínculo é ativo — que é a leitura correta
  // do estado anterior, não um contorno.
  const temColunaRemocao = (await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_name = 'ProcessoRequerente' AND column_name = 'removidoEm'
  `)[0].n > 0
  const filtroAtivo = temColunaRemocao ? ' AND pr."removidoEm" IS NULL' : ""
  const vincDup = await prisma.$queryRawUnsafe<{ processoId: number; personId: number; ids: number[] }[]>(`
    SELECT pr."processoId", r."personId", ARRAY_AGG(r.id ORDER BY r.id) AS ids
      FROM "ProcessoRequerente" pr
      JOIN "Requerente" r ON r.id = pr."requerenteId"
     WHERE r."personId" IS NOT NULL${filtroAtivo}
     GROUP BY pr."processoId", r."personId"
    HAVING COUNT(*) > 1
  `)
  if (vincDup.length) {
    achados.push({
      categoria: "Mesma identidade com dois vínculos ATIVOS no mesmo processo",
      classe: "AMBIGUO",
      ids: vincDup.flatMap((d) => d.ids),
      detalhe: "é a duplicação de requerente — exige escolher o vínculo canônico e consolidar os fatos",
    })
  }

  // ── 8) LANÇAMENTO SEM DONO ───────────────────────────────────────────────
  // `personId` nulo NÃO é órfão: a Receita carrega o dono pelo participante
  // (ReceitaRequerente). É desligamento, e reatar exige saber a quem — decisão.
  const receitasSemDono = await prisma.receita.count({ where: { personId: null } })
  const obrigSemDono = await prisma.obrigacaoEconomica.count({ where: { personId: null, processoId: { not: null } } })
  if (receitasSemDono + obrigSemDono > 0) {
    achados.push({
      categoria: "Lançamento financeiro com personId nulo",
      classe: "AMBIGUO",
      ids: [],
      detalhe: `${receitasSemDono} receita(s) e ${obrigSemDono} obrigação(ões); o dono pode estar no participante — reatar exige decisão`,
    })
  }
}

async function main() {
  const fp = await prisma.$queryRaw<{ db: string; usuario: string }[]>`
    SELECT current_database() AS db, current_user AS usuario
  `
  console.log(`BANCO: ${fp[0].db} (${fp[0].usuario})`)
  console.log(EXECUTAR ? "MODO: EXECUÇÃO — vai escrever\n" : "MODO: DRY-RUN — nada será escrito\n")

  await levantar()

  if (achados.length === 0) {
    console.log("✅ Nenhum resíduo encontrado. Base íntegra para o ciclo de vida da Pessoa.")
    await prisma.$disconnect()
    return
  }

  let reparados = 0
  for (const a of achados) {
    const marca = { INTEGRO: "·", REPARAVEL: "🔧", HISTORICO_PROTEGIDO: "🔒", AMBIGUO: "❓" }[a.classe]
    console.log(`${marca} [${a.classe}] ${a.categoria}`)
    console.log(`    ${a.ids.length} registro(s)${a.ids.length ? `: ${a.ids.slice(0, 25).join(", ")}${a.ids.length > 25 ? " …" : ""}` : ""}`)
    console.log(`    ${a.detalhe}`)
    if (a.classe === "REPARAVEL" && a.reparar) {
      if (EXECUTAR) {
        const n = await a.reparar()
        reparados += n
        console.log(`    → REPARADO: ${n} registro(s) removido(s)`)
      } else {
        console.log(`    → seria reparado (rode com --execute)`)
      }
    }
    console.log()
  }

  const porClasse = achados.reduce<Record<string, number>>((acc, a) => {
    acc[a.classe] = (acc[a.classe] ?? 0) + a.ids.length
    return acc
  }, {})
  console.log("─".repeat(64))
  console.log("RESUMO:", porClasse)
  if (EXECUTAR) console.log(`Reparados: ${reparados} registro(s).`)
  else console.log("Dry-run: nada foi escrito.")

  const ambiguos = achados.filter((a) => a.classe === "AMBIGUO")
  if (ambiguos.length) {
    console.log(`\n${ambiguos.length} categoria(s) AMBÍGUA(S) — decisão humana, com os IDs acima.`)
  }

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
