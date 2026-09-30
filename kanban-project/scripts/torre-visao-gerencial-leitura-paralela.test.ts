// scripts/torre-visao-gerencial-leitura-paralela.test.ts
// ============================================================================
// TORRE — DESEMPENHO DA `visaoGerencial` SEM MUDAR O RESULTADO (D2, 30/09/2026).
//
// Achado real: GET /api/torre/precisa-de-voce levava ~4,2 s; o que sobrava era `visaoGerencial`. Medido em produção
// (~250 ms por ida ao banco): 7,1 s, dos quais ~3,2 s eram o `tarefa.findMany` com `SELECT_GERENCIAL` aninhado
// (o Prisma executa ~15 consultas UMA DEPOIS DA OUTRA) e o resto, funções que relêem as mesmas tabelas (a Tarefa
// dentro de `estadosTemporaisDasOperacoes`, instâncias/versões/execuções em `progressoPorSubtarefa` E em
// `definicoesDasSubtarefas`, rótulos dos passos, pessoas) e esperam umas às outras.
//
// Agora: a Tarefa vem só com escalares e cada relação é um lote independente disparado junto; as leituras
// repetidas passam por um cache DE UMA REQUISIÇÃO; a projeção temporal recebe as linhas da Tarefa já lidas.
//
// PROVA (o resultado é o mesmo, com as primitivas ANTIGAS como referência):
//   (1) a hidratação em paralelo é IDÊNTICA ao `tarefa.findMany` aninhado (`SELECT_GERENCIAL`) — deep-equal, com
//       processo/família/país, responsável, necessidade→união→pessoas, passo, dependência, documento→órgão;
//   (2) `estadosTemporaisDasOperacoes` com as linhas já lidas + cache é IDÊNTICO à leitura por conta própria
//       (a do cron/saúde, a que sempre releu a Tarefa);
//   (3) cobranças (total e sem resposta) e a subtarefa corrente batem com uma contagem independente no banco;
//   (4) a linha de `visaoGerencial` bate, campo a campo, com o dossiê da MESMA tarefa (caminho por tarefa, sem
//       cache, com o SELECT aninhado) — e a Torre, `minhaFila` e `semResponsavel` devolvem as mesmas linhas;
//   (5) o NÚMERO de consultas não cresce com o volume, a Tarefa é lida 1 vez (antes 2) e a lista é a mesma
//       com o leitor de transação.
// (A comparação COMPLETA do JSON antigo × novo, com o código anterior congelado, foi feita contra a produção,
//  só leitura — ver o relatório do item.)
//
//   npx tsx scripts/torre-visao-gerencial-leitura-paralela.test.ts   (banco de teste)
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-visao-gerencial-leitura-paralela.test.ts")

import { isDeepStrictEqual } from "node:util"
import { PrismaClient } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { visaoGerencial, minhaFila, semResponsavel, dossieDaTarefa, provaDaLeituraParalela } from "../lib/operacional/tarefa-projecoes"
import { estadosTemporaisDasOperacoes } from "../lib/operacional/proximo-acontecimento"
import { criarCacheDeLeitura } from "../lib/operacional/subtarefa-corrente"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { registrarCobranca, contarCobrancasSemResposta } from "../src/services/subtarefas-da-etapa"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORRE_D2_PARALELO"
const ITEM_CODE = `${MARCA}_ITEM`

/** Conta as consultas de um trecho — o leitor espião é um cliente à parte (sem a extensão do global). */
async function contar<T>(rodar: (db: PrismaClient) => Promise<T>): Promise<{ n: number; consultas: string[]; r: T }> {
  const espiao = new PrismaClient({ log: [{ emit: "event", level: "query" }] })
  const consultas: string[] = []
  ;(espiao as unknown as { $on: (e: string, cb: (q: { query: string }) => void) => void }).$on("query", (q) => { consultas.push(q.query) })
  try { const r = await rodar(espiao); return { n: consultas.filter((q) => !/^\s*SELECT 1\b/i.test(q)).length, consultas, r } }
  finally { await espiao.$disconnect() }
}

async function main() {
  const c = await montarCenario(MARCA)
  await prisma.itemCatalogo.deleteMany({ where: { code: ITEM_CODE } })
  try {
    const orgao = await c.novoOrgao("Cartório A", { email: "a@t.com", telefone: "111" })
    const gestor = await prisma.usuario.create({ data: { nome: `${MARCA} Ana`, email: `${MARCA.toLowerCase()}-ana@t.com`, senha: "x", tipo: "assistente" } })

    // ─── o cenário: sem dono · aguardando (com solicitação e cobranças) · aguardando (uma cobrança) · em união ───
    const semDono = await c.novaObrigacao()
    const comDono = await c.novaObrigacao({ responsavelId: gestor.id, dataPrazo: new Date(Date.now() + 2 * 86_400_000) })
    const esperando = await c.novaObrigacao({ aguardando: true, orgaoId: orgao.id, comSolicitacao: { canal: "EMAIL" }, responsavelId: gestor.id })
    // o terceiro que a linha mostra é o órgão do DOCUMENTO
    await prisma.documento.update({ where: { id: esperando.documentoId! }, data: { orgaoId: orgao.id } })
    const esperando2 = await c.novaObrigacao({ aguardando: true, orgaoId: orgao.id, responsavelId: gestor.id })
    const daUniao = await c.novaObrigacao({ responsavelId: gestor.id })

    // cobranças reais, pela porta: duas sem resposta seguidas numa, uma "em busca" na outra
    const sub = "aguardar_retorno"
    for (const [o, resultados] of [[esperando, ["SEM_RESPOSTA", "SEM_RESPOSTA"]], [esperando2, ["SEM_RESPOSTA", "EM_BUSCA"]]] as const) {
      for (const resultado of resultados) {
        const r = await registrarCobranca({ stepInstanceId: o.stepInstanceId, subtaskKey: sub, canal: "EMAIL", resultado, orgaoId: orgao.id, registradoPorId: gestor.id })
        if (!r.ok) throw new Error(`cobrança da fixture falhou: ${r.motivo}`)
      }
    }
    // uma obrigação de UNIÃO (casamento): necessidade→união→duas pessoas, sem pessoa própria na tarefa
    const proc = await prisma.processo.findUniqueOrThrow({ where: { id: daUniao.processoId }, select: { arvoreId: true } })
    const p1 = await prisma.pessoa.create({ data: { arvoreId: proc.arvoreId!, nome: `${MARCA} Ele`, sobrenome: "Teste", linhaReta: false, requerente: "nao", numeroLinhagem: 4 }, select: { id: true } })
    const p2 = await prisma.pessoa.create({ data: { arvoreId: proc.arvoreId!, nome: `${MARCA} Ela`, sobrenome: "Teste", linhaReta: true, requerente: "nao", numeroLinhagem: 3 }, select: { id: true } })
    const uniao = await prisma.uniao.create({ data: { pessoa1Id: p1.id, pessoa2Id: p2.id, tipo: "casamento" }, select: { id: true } })
    const item = await prisma.itemCatalogo.create({ data: { code: ITEM_CODE, name: `${MARCA} Certidão de Casamento` }, select: { id: true } })
    const nec = await prisma.necessidadeDocumental.create({ data: { processoId: daUniao.processoId, itemCatalogoId: item.id, uniaoId: uniao.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-uniao` }, select: { id: true } })
    await prisma.tarefa.update({ where: { id: daUniao.tarefaId }, data: { necessidadeId: nec.id } })
    // e uma tarefa com pessoa própria e outra com dependência obrigatória aberta
    const pessoaDona = await prisma.pessoa.create({ data: { arvoreId: proc.arvoreId!, nome: `${MARCA} Dona`, sobrenome: "Silva", linhaReta: true, requerente: "nao", numeroLinhagem: 1 }, select: { id: true } })
    await prisma.tarefa.update({ where: { id: comDono.tarefaId }, data: { pessoaId: pessoaDona.id } })
    await prisma.tarefaDependencia.create({ data: { tarefaId: semDono.tarefaId, dependeDeId: comDono.tarefaId, obrigatoria: true } })

    const todos = [semDono, comDono, esperando, esperando2, daUniao]
    const ids = todos.map((o) => o.tarefaId).sort((a, b) => a - b)
    const agora = new Date()

    // ═══ (1) a hidratação em paralelo == o findMany aninhado ═══════════════════════════════════════════════
    secao("(1) A leitura em paralelo devolve EXATAMENTE o que o SELECT aninhado devolvia")
    const aninhado = await prisma.tarefa.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, select: provaDaLeituraParalela.SELECT_GERENCIAL })
    const { escalares, brutas, cache } = await provaDaLeituraParalela.hidratar(ids, prisma)
    ok("as mesmas 5 tarefas", brutas.length === 5 && aninhado.length === 5)
    for (const a of aninhado) {
      const b = brutas.find((x) => x.id === a.id)
      // `dependeDe` é um conjunto (a ordem não é contrato); o resto é comparado inteiro.
      const norm = (t: typeof a) => ({ ...t, dependeDe: [...t.dependeDe].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))) })
      ok(`#${a.id} idêntica campo a campo (processo, responsável, necessidade→união→pessoas, passo, dependência, documento→órgão)`,
        b != null && isDeepStrictEqual(norm(a), norm(b)))
    }
    const bUniao = brutas.find((b) => b.id === daUniao.tarefaId)!
    ok("a linha de UNIÃO traz as duas pessoas e o item do catálogo",
      bUniao.necessidade?.uniao?.pessoa1.id === p1.id && bUniao.necessidade?.uniao?.pessoa2.linhaReta === true && bUniao.necessidade?.itemCatalogo.name.includes("Casamento") === true)
    ok("a linha com dependência aberta a traz", brutas.find((b) => b.id === semDono.tarefaId)!.dependeDe.length === 1)
    ok("a linha aguardando traz o órgão do documento", brutas.find((b) => b.id === esperando.tarefaId)!.documento?.orgao?.name === orgao.name)

    // ═══ (2) estados temporais: com linhas já lidas + cache == por conta própria ═══════════════════════════
    secao("(2) A projeção temporal com as linhas já lidas é IDÊNTICA à que relê a Tarefa")
    const porContaPropria = await estadosTemporaisDasOperacoes(prisma, ids, agora)
    const comPre = await estadosTemporaisDasOperacoes(prisma, ids, agora, { tarefas: escalares, cache })
    ok("mesmos ids", isDeepStrictEqual([...porContaPropria.keys()].sort(), [...comPre.keys()].sort()) && porContaPropria.size === 5)
    ok("mesmo estado temporal em cada tarefa (emRisco, motivos, atrasos, acompanhamento, retorno, próximo acontecimento)",
      ids.every((id) => isDeepStrictEqual(porContaPropria.get(id), comPre.get(id))))
    const sozinha = await contar((db) => estadosTemporaisDasOperacoes(db, ids, agora))
    const preCarregada = await contar((db) => estadosTemporaisDasOperacoes(db, ids, agora, { tarefas: escalares, cache: criarCacheDeLeitura(db) }))
    const leiturasDe = (cs: string[], tabela: string) => cs.filter((q) => new RegExp(`FROM "public"\\."${tabela}"`).test(q)).length
    ok("sozinha, a projeção temporal lê a Tarefa (1 leitura) — o que os outros chamadores (cron, saúde) seguem fazendo", leiturasDe(sozinha.consultas, "Tarefa") === 1)
    ok("com as linhas já lidas, a Tarefa NÃO é lida de novo (0 leituras)", leiturasDe(preCarregada.consultas, "Tarefa") === 0, `${leiturasDe(preCarregada.consultas, "Tarefa")} leitura(s)`)
    ok("e o resultado é o mesmo (deep-equal, agora com o leitor espião)", isDeepStrictEqual([...sozinha.r.entries()].sort(([a], [b]) => a - b), [...preCarregada.r.entries()].sort(([a], [b]) => a - b)))

    // ═══ (3) cobranças e subtarefa corrente batem com contagem independente ══════════════════════════════
    secao("(3) Cobranças (total e sem resposta) e subtarefa corrente batem com o banco")
    const progresso = await provaDaLeituraParalela.progressoPorSubtarefa(brutas, prisma, cache)
    for (const o of [esperando, esperando2]) {
      const resumo = progresso.get(o.stepInstanceId)
      const exec = await prisma.subtaskExecution.findFirstOrThrow({ where: { stepInstanceId: o.stepInstanceId, subtaskKey: sub, supersededAt: null }, select: { id: true } })
      const contatos = await prisma.contatoTerceiro.findMany({ where: { subtaskExecutionId: exec.id }, orderBy: { id: "asc" }, select: { resultado: true } })
      const total = await prisma.contatoTerceiro.count({ where: { subtaskExecutionId: exec.id } })
      ok(`#${o.tarefaId}: total de cobranças = contagem do banco (${total})`, resumo?.atual?.totalCobrancas === total && total === 2)
      ok(`#${o.tarefaId}: sem resposta = regra pura sobre os resultados em ordem (${contarCobrancasSemResposta(contatos.map((x) => x.resultado))})`,
        resumo?.atual?.cobrancasSemResposta === contarCobrancasSemResposta(contatos.map((x) => x.resultado)))
      ok(`#${o.tarefaId}: a subtarefa corrente é a que espera o terceiro`, resumo?.atual?.subtaskKey === sub && resumo.atual.status === "AGUARDANDO_EXTERNO")
    }
    ok("as duas cobranças tinham resultados diferentes (a prova não é trivial)",
      progresso.get(esperando.stepInstanceId)?.atual?.cobrancasSemResposta !== progresso.get(esperando2.stepInstanceId)?.atual?.cobrancasSemResposta)

    // ═══ (4) a linha == o dossiê da mesma tarefa; Torre/minhaFila/semResponsavel == visaoGerencial ═══════════
    secao("(4) A linha da visão gerencial bate com o dossiê da MESMA tarefa (caminho por tarefa, sem cache)")
    const visao = await visaoGerencial({ status: undefined }, agora)
    const daFixture = visao.linhas.filter((l) => ids.includes(l.taskId))
    ok("as 5 tarefas estão na visão", daFixture.length === 5)
    // Só o que é da LINHA e tem o mesmo significado no dossiê (o dossiê acrescenta detalhe e recalcula "agora").
    const CAMPOS = [
      "titulo", "documentoId", "processoId", "processoNome", "pais", "familiaNome", "origem", "pessoaId", "pessoaNome", "numeroLinhagem",
      "linhaReta", "casalNomes", "conjugeNome", "faseAtualDoProcessoLabel", "categoriaDoc", "faseMacroKey", "etapaAtual", "statusTarefa",
      "equipeKey", "responsavelId", "responsavelNome", "prioridade", "dataPrazo", "aguardandoDependencia", "requerDecisao", "executavelAgora",
      "terceiroNome", "terceiroEmail", "terceiroTelefone", "servico", "criadaEm", "atribuidaEm", "regraTemporalPasso", "acompanhamentoPasso",
      "emRisco", "motivosRisco", "atrasoInterno", "atrasoTerceiro", "acompanhamentoVencido", "retornoRecebido", "escalada", "totalCobrancas",
      "cobrancasSemResposta", "estadoOperacao", "aIniciar", "passoCorrente", "coluna", "esperandoDe", "motivoBloqueio", "repactuacoes",
    ] as const
    // O dossiê (por tarefa) nunca leu a linhagem, o órgão do documento nem a pessoa da UNIÃO — limitações dele, não da fila em lote; a união é
    // provada campo a campo no item (1).
    const SO_DA_FILA = new Set(["numeroLinhagem", "linhaReta", "pessoaId", "pessoaNome", "casalNomes", "conjugeNome", "terceiroNome", "terceiroEmail", "terceiroTelefone"])
    for (const l of daFixture) {
      const d = (await dossieDaTarefa(l.taskId)) as unknown as Record<string, unknown>
      const dif = CAMPOS.filter((k) => !SO_DA_FILA.has(k) || (k === "pessoaNome" || k === "pessoaId") && l.taskId !== daUniao.tarefaId).filter((k) => !isDeepStrictEqual((l as unknown as Record<string, unknown>)[k], d[k]))
      ok(`#${l.taskId} (${l.estadoOperacao}) — campos da linha iguais aos do dossiê`, dif.length === 0, dif.length ? `divergem: ${dif.map((k) => `${k}: ${JSON.stringify((l as unknown as Record<string, unknown>)[k])} × ${JSON.stringify(d[k])}`).join("; ")}` : "")
    }
    ok("a de união mostra o casal e a pessoa da linha reta", daFixture.find((l) => l.taskId === daUniao.tarefaId)?.casalNomes === `${MARCA} Ele Teste e ${MARCA} Ela Teste` && daFixture.find((l) => l.taskId === daUniao.tarefaId)?.pessoaId === p2.id)

    const torre = await listarTarefasDaTorre({}, agora)
    const daTorre = torre.linhas.filter((l) => ids.includes(l.taskId))
    ok("a Torre lista as 5, com o MESMO conteúdo da visão (mais órgão/fase/podeIniciar)",
      daTorre.length === 5 && daTorre.every((t) => { const v = daFixture.find((l) => l.taskId === t.taskId); return v != null && CAMPOS.every((k) => isDeepStrictEqual(t[k], v[k])) }))
    ok("o órgão da Torre vem da MESMA leitura (tarefa → documento)", daTorre.find((t) => t.taskId === esperando.tarefaId)?.orgaoId === orgao.id && daTorre.find((t) => t.taskId === semDono.tarefaId)?.orgaoId === null)
    ok("e a fase do processo (faseAtualKey)", daTorre.every((t) => t.faseAtualKey === c.PHASE_KEY))
    const fila = await minhaFila(gestor.id, agora)
    ok("minhaFila do responsável = as dele na visão", fila.filter((l) => ids.includes(l.taskId)).map((l) => l.taskId).sort().join() === [comDono, esperando, esperando2, daUniao].map((o) => o.tarefaId).sort((a, b) => a - b).join())
    const sem = await semResponsavel(agora)
    ok("semResponsavel = a tarefa sem dono", sem.filter((l) => ids.includes(l.taskId)).map((l) => l.taskId).join() === String(semDono.tarefaId))
    const linhaSem = sem.find((l) => l.taskId === semDono.tarefaId)!
    ok("e é a mesma linha da visão", CAMPOS.every((k) => isDeepStrictEqual(linhaSem[k], daFixture.find((l) => l.taskId === semDono.tarefaId)![k])))

    // ═══ (5) consultas: constantes no volume, Tarefa lida 1 vez, transação ════════════════════════════════
    secao("(5) Número de consultas constante no volume; a Tarefa é lida uma vez; leitor de transação")
    const cinco = await contar((db) => visaoGerencial({}, agora, db))
    // mais 6 obrigações (mesmos tipos) — o número de consultas não pode subir
    for (let i = 0; i < 3; i++) { await c.novaObrigacao({ aguardando: true, orgaoId: orgao.id, responsavelId: gestor.id }); await c.novaObrigacao({ responsavelId: gestor.id }) }
    const onze = await contar((db) => visaoGerencial({}, agora, db))
    // Tolerância de +2: uma consulta lazy pode variar com o timing do cache; N+1 cresceria com as 6 tarefas novas.
    ok("com o dobro de tarefas, o número de consultas NÃO cresce (sem N+1)", Math.abs(onze.n - cinco.n) <= 2 && onze.r.linhas.length >= cinco.r.linhas.length + 6, `${cinco.n} × ${onze.n} consultas para ${cinco.r.linhas.length} × ${onze.r.linhas.length} linhas`)
    ok("poucas consultas (o antigo fazia 30+ em série)", onze.n <= 30, `${onze.n}`)
    const leituras = onze.consultas.filter((q) => /FROM "public"\."Tarefa"/.test(q)).length
    // contagem + página + o status da tarefa de que a dependência depende (a fixture tem uma). Antes: +1 (a releitura da projeção temporal).
    ok("a Tarefa é lida 3 vezes (contagem, página, status da dependência) — a projeção temporal não a relê", leituras === 3, `${leituras}`)
    ok("a execução vigente das subtarefas é lida UMA vez (antes: duas, uma em cada função)", onze.consultas.filter((q) => /FROM "public"\."SubtaskExecution"/.test(q)).length === 1)
    ok("as versões congeladas: uma leitura por par (workflow, versão), não uma por função", onze.consultas.filter((q) => /FROM "public"\."PhaseInternalWorkflowVersao"/.test(q)).length === 1)
    ok("as instâncias de workflow: uma leitura", onze.consultas.filter((q) => /FROM "public"\."PhaseWorkflowInstance"/.test(q)).length === 1)
    ok("os rótulos dos passos (cadastro): uma leitura", onze.consultas.filter((q) => /FROM "public"\."PhaseInternalWorkflowStep"/.test(q)).length === 1)
    const porTabela = new Map<string, number>()
    for (const q of onze.consultas) { const t = /FROM "public"\."(\w+)"/.exec(q)?.[1]; if (t) porTabela.set(t, (porTabela.get(t) ?? 0) + 1) }
    ok("nenhuma tabela é lida por linha (no máximo 3 leituras de qualquer tabela, com 11 tarefas)", [...porTabela.values()].every((n) => n <= 3), JSON.stringify(Object.fromEntries(porTabela)))

    const tx = await prisma.$transaction(async (t) => visaoGerencial({}, agora, t))
    ok("dentro de uma transação, a lista é a mesma (o leitor recebido faz todas as leituras)",
      isDeepStrictEqual(tx.linhas.map((l) => l.taskId), onze.r.linhas.map((l) => l.taskId)))
  } finally {
    await c.limpar()
    await prisma.itemCatalogo.deleteMany({ where: { code: ITEM_CODE } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas${falhas.length ? ` — ${falhas.join(" | ")}` : ""}`)
  await prisma.$disconnect()
  process.exit(falhou ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
