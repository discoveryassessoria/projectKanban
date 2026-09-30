// scripts/torre-r1-so-atribui-a-apto.test.ts
// ============================================================================
// TORRE — A REGRA r1 SÓ ATRIBUI A QUEM É APTO (item A7, 30/09/2026).
//
//   npx tsx scripts/torre-r1-so-atribui-a-apto.test.ts   (banco de teste)
//
// A sugestão manual (`escolherResponsavel`) tem um FALLBACK: sem ninguém com aptidão cadastrada, ela mostra
// ao HUMANO "Ninguém com aptidão cadastrada; sugiro X por menor carga". A r1 é automática: usar o fallback
// atribuiria trabalho a quem não tem aptidão comprovada. Contrato:
//   • só-fallback  → a r1 NÃO atribui; conta N "sem apto"; a tarefa continua sem dono e em "Precisa de você";
//   • com apto     → atribui ao apto de MENOR carga;
//   • simulação = execução (mesmos números e o mesmo destino);
//   • a auditoria da execução (REGRA_TORRE_EXECUTADA) registra quantas ficaram sem apto;
//   • a sugestão manual NÃO mudou: continua mostrando o fallback.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-r1-so-atribui-a-apto.test.ts")

import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { definirRegra, executarR1, simularRegra, planoDaR1, MOTIVO_SEM_APTO } from "../lib/operacional/regras-torre"
import { itensPrecisaDeVoce, sugerirResponsavelPrecisaDeVoce, textoDaSugestao } from "../lib/operacional/precisa-de-voce"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREA7"
const EQUIPE = "torrea7eq"

async function main() {
  const c = await montarCenario(MARCA)
  try {
    const mk = (nome: string, tipo: string) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(tipo === "admin" ? {} : { permissoesCustom: { "tarefas.iniciar_concluir": true, "tarefas.ver": true } }) } })
    const admin = await mk("Admin", "admin")
    const ana = await mk("Ana", "assistente")
    const beto = await mk("Beto", "assistente")
    const cris = await mk("Cris", "assistente")
    await prisma.grupoUsuario.deleteMany({ where: { code: EQUIPE } })
    await prisma.grupoUsuario.create({ data: { code: EQUIPE, nome: `${MARCA} equipe`, ativo: true, membros: { create: [{ usuarioId: ana.id }, { usuarioId: beto.id }] } } })
    await definirRegra("r1", true, admin.id)

    // ─── (A) SÓ HÁ FALLBACK: ninguém tem aptidão cadastrada para estas tarefas ─────────────────────
    secao("SÓ-FALLBACK: a sugestão manual mostra o fallback, a r1 NÃO atribui")
    const semApto1 = await c.novaObrigacao({ })
    const semApto2 = await c.novaObrigacao({ })
    const sug = await sugerirResponsavelPrecisaDeVoce(semApto1.tarefaId)
    ok("pré-condição: a sugestão manual É um fallback (candidato existe, mas sem aptidão cadastrada)", sug?.fallback === true && sug.usuarioId !== admin.id, JSON.stringify(sug))
    ok("…e o texto que o humano lê continua sendo o do fallback (não mudou)", /^Ninguém com aptidão cadastrada para esta tarefa; sugiro .+ por menor carga/.test(textoDaSugestao(sug) ?? ""), textoDaSugestao(sug) ?? "")

    const plano0 = await planoDaR1(new Date(), false)
    ok("o plano tem as 2 tarefas, nenhuma atribuída, todas 'semApto' com o motivo registrado",
      plano0.length === 2 && plano0.every((p) => !p.atribui && p.semApto && !p.seguradaPorLimite && p.paraId == null && p.motivo === MOTIVO_SEM_APTO && p.motivo === "sem apto — fica no Precisa de você"), JSON.stringify(plano0))

    const sim0 = await simularRegra("r1")
    ok("a simulação conta 2 sem apto e 0 a atribuir", sim0.numeros.semDono === 2 && sim0.numeros.atribuiria === 0 && sim0.numeros.semApto === 2, JSON.stringify(sim0.numeros))
    ok("…e o texto diz 'seguradas por falta de apto'", /2 seguradas por falta de apto/.test(sim0.texto), sim0.texto)
    ok("…e cada item traz o motivo (ninguém, 'sem apto — fica no Precisa de você')", sim0.itens.length === 2 && sim0.itens.every((i) => /→ ninguém \(sem apto — fica no Precisa de você\)/.test(i.texto)), JSON.stringify(sim0.itens))

    const logsAntes = await prisma.logAuditoria.count({ where: { acao: "TAREFA_ATRIBUIDA" } })
    const ex0 = await executarR1(admin.id)
    ok("executar: 0 atribuídas, 2 sem apto, 0 seguradas pelo limite", ex0.executou === true && ex0.atribuidas === 0 && ex0.semApto === 2 && ex0.seguradas === 0 && ex0.falhas === 0, JSON.stringify(ex0))
    const donos0 = await prisma.tarefa.findMany({ where: { id: { in: [semApto1.tarefaId, semApto2.tarefaId] } }, select: { responsavelId: true } })
    ok("as 2 tarefas continuam SEM DONO (nada foi escrito nelas)", donos0.every((t) => t.responsavelId == null))
    ok("nenhuma TAREFA_ATRIBUIDA foi gravada", (await prisma.logAuditoria.count({ where: { acao: "TAREFA_ATRIBUIDA" } })) === logsAntes)
    const aud0 = await prisma.logAuditoria.findFirst({ where: { acao: "REGRA_TORRE_EXECUTADA" }, orderBy: { id: "desc" } })
    const det0 = aud0?.detalhes as { semApto?: number; atribuidas?: number } | null
    ok("a auditoria da execução registra quantas ficaram sem apto (detalhes e descrição)", det0?.semApto === 2 && det0.atribuidas === 0 && /2 sem apto/.test(aud0?.descricao ?? ""), aud0?.descricao ?? "")
    const itens0 = await itensPrecisaDeVoce()
    const ids0 = new Set(itens0.filter((i) => i.tipo === "SEM_DONO").map((i) => i.tarefaId))
    ok("as 2 continuam aparecendo no 'Precisa de você' (SEM_DONO)", ids0.has(semApto1.tarefaId) && ids0.has(semApto2.tarefaId))

    // ─── (B) HÁ APTO: a equipe exigida existe → Ana e Beto são aptos; Cris (com carga 0) NÃO ─────────
    secao("COM APTO: atribui ao apto de MENOR carga (nunca a quem não é apto)")
    await c.novaObrigacao({ responsavelId: ana.id }); await c.novaObrigacao({ responsavelId: ana.id }) // Ana: 2 ativas
    await c.novaObrigacao({ responsavelId: beto.id })                                                     // Beto: 1 ativa
    const apta = await c.novaObrigacao({})
    await prisma.tarefa.update({ where: { id: apta.tarefaId }, data: { equipeKey: EQUIPE } })

    const sim1 = await simularRegra("r1")
    ok("a simulação: 1 a atribuir + 2 sem apto", sim1.numeros.semDono === 3 && sim1.numeros.atribuiria === 1 && sim1.numeros.semApto === 2, JSON.stringify(sim1.numeros))
    const itemApta = sim1.itens.find((i) => i.tarefaId === apta.tarefaId)
    ok("…e ela diz que vai para o Beto (menor carga entre os aptos)", /→ .*Beto \(/.test(itemApta?.texto ?? ""), itemApta?.texto ?? "")

    const ex1 = await executarR1(admin.id)
    ok("executar: 1 atribuída, 2 sem apto — IGUAL à simulação", ex1.executou === true && ex1.atribuidas === sim1.numeros.atribuiria && ex1.semApto === sim1.numeros.semApto && ex1.falhas === 0, JSON.stringify(ex1))
    const depois = await prisma.tarefa.findUnique({ where: { id: apta.tarefaId }, select: { responsavelId: true } })
    ok("a tarefa da equipe foi para o Beto — apto de menor carga (não a Ana com 2, nem a Cris sem aptidão)", depois?.responsavelId === beto.id && depois.responsavelId !== cris.id, String(depois?.responsavelId))
    ok("as 2 sem apto seguem sem dono", (await prisma.tarefa.count({ where: { id: { in: [semApto1.tarefaId, semApto2.tarefaId] }, responsavelId: null } })) === 2)
    ok("a atribuição tem a auditoria da regra", (await prisma.logAuditoria.count({ where: { acao: "TAREFA_ATRIBUIDA", entidadeId: apta.tarefaId, detalhes: { path: ["motivo"], string_contains: "auto-atribuição (regra r1)" } } })) === 1)
    const ex2 = await executarR1(admin.id)
    ok("idempotente: rodar de novo não atribui nada e mantém as 2 sem apto", ex2.executou === true && ex2.atribuidas === 0 && ex2.semApto === 2)
  } finally {
    await prisma.grupoUsuario.deleteMany({ where: { code: EQUIPE } })
    await c.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
