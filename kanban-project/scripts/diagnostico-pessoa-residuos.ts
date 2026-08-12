/**
 * DIAGNÓSTICO — resíduos do ciclo de vida da Pessoa dentro do Processo.
 * SOMENTE LEITURA. Nenhuma escrita, nenhum reparo. Roda com segurança em produção.
 *
 * Responde, por processo:
 *   · há duplicidade de vínculo ativo para a MESMA identidade canônica?
 *   · quais registros derivados ficaram órfãos de uma Pessoa que não existe mais?
 *
 * Por que este script existe: `Pessoa` é apagada, mas quase toda a cadeia
 * derivada aponta para ela com `onDelete: SetNull` ou por coluna solta (sem FK).
 * O apagamento não propaga — ele DESLIGA o vínculo e deixa a linha viva.
 */
import { prisma } from "../src/lib/prisma"

type Linha = Record<string, unknown>

const titulo = (t: string) => console.log(`\n${"─".repeat(72)}\n${t}\n${"─".repeat(72)}`)
const tabela = (rows: Linha[]) => {
  if (rows.length === 0) { console.log("  (nenhum)"); return }
  console.table(rows)
}

async function main() {
  const fingerprint = await prisma.$queryRaw<{ db: string; usuario: string; agora: Date }[]>`
    SELECT current_database() AS db, current_user AS usuario, now() AS agora
  `
  console.log("BANCO:", fingerprint[0])

  // ── 0) Volume geral ──────────────────────────────────────────────────────
  titulo("0) Volumes")
  const [processos, pessoas, requerentes, vinculos, necessidades, documentos, steps, tarefas] =
    await Promise.all([
      prisma.processo.count(),
      prisma.pessoa.count(),
      prisma.requerente.count(),
      prisma.processoRequerente.count(),
      prisma.necessidadeDocumental.count(),
      prisma.documento.count(),
      prisma.phaseWorkflowStepInstance.count(),
      prisma.tarefa.count(),
    ])
  console.table([{ processos, pessoas, requerentes, vinculos, necessidades, documentos, steps, tarefas }])

  // ── 1) DUPLICIDADE: mesma identidade canônica, dois Requerentes no processo ─
  titulo("1) Duplicidade de vínculo — mesmo personId, >1 Requerente ativo no mesmo Processo")
  const dupPorPessoa = await prisma.$queryRaw<Linha[]>`
    SELECT pr."processoId",
           r."personId",
           COUNT(*)::int                       AS vinculos,
           ARRAY_AGG(r.id ORDER BY r.id)       AS "requerenteIds",
           ARRAY_AGG(r.nome ORDER BY r.id)     AS nomes
      FROM "ProcessoRequerente" pr
      JOIN "Requerente" r ON r.id = pr."requerenteId"
     WHERE r."personId" IS NOT NULL
     GROUP BY pr."processoId", r."personId"
    HAVING COUNT(*) > 1
     ORDER BY 1
  `
  tabela(dupPorPessoa)

  // Duplicidade por Requerente ÓRFÃO de pessoa (personId nulo) com nome repetido
  // no mesmo processo — é o rastro que a exclusão SetNull deixa.
  titulo("1b) Requerentes do processo com personId NULO (rastro de SetNull)")
  const orfaosPersonId = await prisma.$queryRaw<Linha[]>`
    SELECT pr."processoId", r.id AS "requerenteId", r.nome, r.cpf, r."createdAt"
      FROM "ProcessoRequerente" pr
      JOIN "Requerente" r ON r.id = pr."requerenteId"
     WHERE r."personId" IS NULL
     ORDER BY pr."processoId", r.id
  `
  tabela(orfaosPersonId)

  // ── 2) ÓRFÃOS: derivados apontando para Pessoa inexistente ────────────────
  titulo("2) Derivados órfãos — coluna de pessoa preenchida, Pessoa inexistente")

  const orfaoObrigacao = await prisma.$queryRaw<Linha[]>`
    SELECT o.id, o."processoId", o."personId", o.natureza, o.status, o."documentoId"
      FROM "ObrigacaoEconomica" o
     WHERE o."personId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "Pessoa" p WHERE p.id = o."personId")
     ORDER BY o.id
  `
  console.log(`ObrigacaoEconomica.personId órfão: ${orfaoObrigacao.length}`)
  tabela(orfaoObrigacao.slice(0, 30))

  const orfaoTarefaPessoa = await prisma.$queryRaw<Linha[]>`
    SELECT t.id, t."processoId", t."pessoaId", t.titulo, t."statusTarefa"
      FROM "Tarefa" t
     WHERE t."pessoaId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "Pessoa" p WHERE p.id = t."pessoaId")
     ORDER BY t.id
  `
  console.log(`Tarefa.pessoaId órfão: ${orfaoTarefaPessoa.length}`)
  tabela(orfaoTarefaPessoa.slice(0, 30))

  // ── 3) DESLIGADOS: derivados que perderam o vínculo por SetNull ───────────
  titulo("3) Derivados desligados — vínculo que virou NULL e a linha sobreviveu")

  const stepsSemEscopo = await prisma.$queryRaw<Linha[]>`
    SELECT s.id, s."processoId", s."faseMacroKey", s."stepKey", s.status, s.ciclo
      FROM "PhaseWorkflowStepInstance" s
     WHERE s."pessoaId" IS NULL
       AND s."necessidadeId" IS NULL
       AND s."documentoId" IS NULL
       AND s."stepKey" IS NOT NULL
     ORDER BY s.id
  `
  console.log(`Steps sem NENHUM escopo (pessoa/necessidade/documento): ${stepsSemEscopo.length}`)
  tabela(stepsSemEscopo.slice(0, 30))

  const tarefasSemStep = await prisma.$queryRaw<Linha[]>`
    SELECT t.id, t."processoId", t.titulo, t."statusTarefa", t.concluida
      FROM "Tarefa" t
     WHERE t."workflowStepInstanceId" IS NULL
       AND t."necessidadeId" IS NULL
       AND t."documentoId" IS NULL
       AND t.origem IS DISTINCT FROM 'MANUAL'
     ORDER BY t.id
  `
  console.log(`Tarefas sem passo/necessidade/documento (não-manuais): ${tarefasSemStep.length}`)
  tabela(tarefasSemStep.slice(0, 30))

  const custoSemPessoa = await prisma.$queryRaw<Linha[]>`
    SELECT c.id, c."processoId", c."personId", c.descricao
      FROM "Custo" c
     WHERE c."personId" IS NULL AND c."processoId" IS NOT NULL
     ORDER BY c.id
  `
  console.log(`Custo com personId NULL: ${custoSemPessoa.length}`)

  const receitaSemPessoa = await prisma.$queryRaw<Linha[]>`
    SELECT r.id, r."processoId", r."personId", r.descricao
      FROM "Receita" r
     WHERE r."personId" IS NULL AND r."processoId" IS NOT NULL
     ORDER BY r.id
  `
  console.log(`Receita com personId NULL: ${receitaSemPessoa.length}`)

  const receitaReqOrfa = await prisma.$queryRaw<Linha[]>`
    SELECT rr.id, rr."receitaId", rr."requerenteId", rr.nome, rr.percentual
      FROM "ReceitaRequerente" rr
     WHERE rr."requerenteId" IS NULL
     ORDER BY rr.id
  `
  console.log(`ReceitaRequerente sem requerente (participante financeiro solto): ${receitaReqOrfa.length}`)
  tabela(receitaReqOrfa.slice(0, 30))

  // Participante financeiro duplicado: mesma receita + mesmo requerente
  titulo("4) Participante financeiro duplicado — mesma Receita + mesmo Requerente")
  const partDup = await prisma.$queryRaw<Linha[]>`
    SELECT rr."receitaId", rr."requerenteId", COUNT(*)::int AS linhas,
           ARRAY_AGG(rr.id ORDER BY rr.id) AS ids
      FROM "ReceitaRequerente" rr
     WHERE rr."requerenteId" IS NOT NULL
     GROUP BY rr."receitaId", rr."requerenteId"
    HAVING COUNT(*) > 1
     ORDER BY 1
  `
  tabela(partDup)

  // Participante financeiro duplicado por IDENTIDADE canônica (personId)
  const partDupPessoa = await prisma.$queryRaw<Linha[]>`
    SELECT rr."receitaId", r."personId", COUNT(*)::int AS linhas,
           ARRAY_AGG(rr.id ORDER BY rr.id) AS ids,
           ARRAY_AGG(rr.nome ORDER BY rr.id) AS nomes
      FROM "ReceitaRequerente" rr
      JOIN "Requerente" r ON r.id = rr."requerenteId"
     WHERE r."personId" IS NOT NULL
     GROUP BY rr."receitaId", r."personId"
    HAVING COUNT(*) > 1
     ORDER BY 1
  `
  console.log("Duplicidade por identidade canônica (personId):")
  tabela(partDupPessoa)

  // ── 5) Necessidades / documentos de pessoa removida ───────────────────────
  titulo("5) Necessidades e documentos sem sujeito")
  const necSemSujeito = await prisma.$queryRaw<Linha[]>`
    SELECT n.id, n."processoId", n."itemCatalogoId", n.status
      FROM "NecessidadeDocumental" n
     WHERE n."pessoaId" IS NULL AND n."uniaoId" IS NULL
     ORDER BY n.id
  `
  console.log(`NecessidadeDocumental sem sujeito (viola o CHECK conceitual): ${necSemSujeito.length}`)
  tabela(necSemSujeito.slice(0, 30))

  // ── 6) Pessoas ativas por processo (via árvore) ───────────────────────────
  titulo("6) Pessoas por processo (via árvore) — identidade repetida na MESMA árvore")
  const pessoaDupArvore = await prisma.$queryRaw<Linha[]>`
    SELECT p."arvoreId",
           LOWER(TRIM(p.nome || ' ' || COALESCE(p.sobrenome, ''))) AS chave_visual,
           COUNT(*)::int                   AS pessoas,
           ARRAY_AGG(p.id ORDER BY p.id)   AS ids
      FROM "Pessoa" p
     WHERE p."arvoreId" IS NOT NULL
     GROUP BY 1, 2
    HAVING COUNT(*) > 1
     ORDER BY 1
  `
  console.log("(diagnóstico apenas — a chave visual NÃO é usada para decidir nada)")
  tabela(pessoaDupArvore)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
