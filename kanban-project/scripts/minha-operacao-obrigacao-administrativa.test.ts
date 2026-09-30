// scripts/minha-operacao-obrigacao-administrativa.test.ts
// ============================================================================
// SEM TAREFA ADMINISTRATIVA "Atribuir tarefas" EM MINHA OPERAÇÃO — descontinuada em 30/09/2026 (era: correção 17/09).
// A obrigação foi substituída pela Torre de Controle: 15 tarefas sem dono NÃO geram tarefa administrativa; o gestor é
// avisado (1 SEM_RESPONSAVEL por família, que leva à Torre) e a fila de quem recebe continua exata.
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/minha-operacao-obrigacao-administrativa.test.ts
//
// ACHADO REAL (prod, leitura): a Grisotto tinha 15 Tarefa NORMAL sem
// responsável, mas NENHUMA Tarefa ADMINISTRATIVA — a reconciliação é
// disparada por EVENTO (materialização/atribuição/devolução), e essas 15
// já existiam ANTES do motor da obrigação ser ligado; nenhum evento novo
// tocou nelas depois. Backend e projeção (`minhaFila`, `indicadoresGerenciais`,
// `/api/operacao/tarefas`, `/api/home`) SEMPRE estiveram corretos — provado
// aqui reconciliando o processo primeiro (`reconciliarObrigacaoDeAtribuicao`,
// a MESMA porta que qualquer evento real chama) e só então lendo as rotas
// reais como o Admin as leria.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { signAuthToken } from "@/lib/auth-jwt"
import { criarTarefaManual } from "@/lib/operacional/tarefa-ciclo"
import { redistribuirTarefas } from "@/lib/operacional/tarefa-comandos"
import { usuarioResponsavelPelaDistribuicao } from "@/lib/operacional/obrigacao-atribuicao"
import { avisarGestores } from "@/lib/operacional/avisos-sino"
import { LINK_SEM_RESPONSAVEL_NA_TORRE } from "@/lib/operacional/navegacao"
import { GET as getTarefasOperacao } from "@/src/app/api/operacao/tarefas/route"
import { GET as getHome } from "@/src/app/api/home/route"
import { GET as getNotificacoes } from "@/src/app/api/notificacoes/route"
import { NextRequest } from "next/server"

const MARCA = "MOADMIN"

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
  await prisma.notificacaoOperacional.deleteMany({ where: { OR: [{ tarefaId: { in: ts.map((t) => t.id) } }, { processoId: { in: ids } }] } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
}

async function tokenPara(userId: number, email: string, tipo: string): Promise<string> {
  return signAuthToken({ userId, email, tipo, sessaoInicio: Date.now() })
}

async function minhaFilaDe(userId: number, email: string, tipo: string) {
  const token = await tokenPara(userId, email, tipo)
  const req = new NextRequest("http://localhost/api/operacao/tarefas?visao=minha_fila", { headers: { Authorization: `Bearer ${token}` } })
  const resp = await getTarefasOperacao(req)
  if (resp.status !== 200) throw new Error(`minha_fila respondeu ${resp.status}`)
  return (await resp.json()) as { linhas: Array<{ taskId: number; titulo: string; origem: string | null; processoId: number | null; familiaNome: string | null; processoNome: string | null }> }
}

async function homeDe(userId: number, email: string, tipo: string) {
  const token = await tokenPara(userId, email, tipo)
  const req = new NextRequest("http://localhost/api/home", { headers: { Authorization: `Bearer ${token}` } })
  const resp = await getHome(req)
  if (resp.status !== 200) throw new Error(`home respondeu ${resp.status}`)
  return await resp.json()
}

async function sinoDe(userId: number, email: string, tipo: string) {
  const token = await tokenPara(userId, email, tipo)
  const req = new NextRequest("http://localhost/api/notificacoes", { headers: { Authorization: `Bearer ${token}` } })
  const resp = await getNotificacoes(req)
  if (resp.status !== 200) throw new Error(`notificacoes respondeu ${resp.status}`)
  // Sino agrupado: { avisos, anteriores, total } — só a tabela de avisos, nenhum balde de Tarefa.
  return (await resp.json()) as { avisos: Array<{ id: number; tipo: string; link: string | null; familiaId: number | null; contagem: number }>; anteriores: unknown[]; total: number }
}

async function main() {
  exigirBancoDeTeste("prova a obrigação administrativa dentro de Minha Operação (correção 17/09/2026)")
  await limpar()
  // `finally` — uma asserção que lança (ex.: HTTP inesperado) não pode
  // deixar resíduo pro próximo teste que rodar no mesmo banco compartilhado
  // (achado real desta mesma rodada: um crash sem `finally` deixou um admin
  // remanescente com id menor, e `usuarioResponsavelPelaDistribuicao` —
  // determinística por menor id — passou a resolver para ELE em vez do
  // admin local de outra suíte).
  try {
    await corpo()
  } finally {
    await limpar()
  }
}

async function corpo() {
  console.log("A TAREFA ADMINISTRATIVA DENTRO DE MINHA OPERAÇÃO (cenário Grisotto)\n")

  const marco = await prisma.usuario.create({
    data: { nome: `${MARCA} Marco`, email: `marco@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" },
    select: { id: true, email: true, tipo: true },
  })
  // "assistente" sem perfil/custom não tem NENHUMA permissão por padrão
  // (regra-base de `calcularPermissoes`) — `tarefas.ver` precisa vir de
  // algum lugar, aqui via `permissoesCustom`, para o GET real da rota
  // (não a função de biblioteca) autorizar a leitura da própria fila.
  const daniela = await prisma.usuario.create({
    data: {
      nome: `${MARCA} Daniela`, email: `daniela@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "assistente",
      permissoesCustom: { "tarefas.ver": true } as never,
    },
    select: { id: true, email: true, tipo: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} Grisotto`, arvoreId: arv.id }, select: { id: true } })

  // ══════════════════════════════════════════════════════════════════════
  secao("A) 15 tarefas NORMAL sem responsável → NENHUMA tarefa administrativa")
  // ══════════════════════════════════════════════════════════════════════
  const tarefaIds: number[] = []
  for (let i = 0; i < 15; i++) {
    const r = await criarTarefaManual({
      processoId: proc.id, titulo: `${MARCA} certidao ${i}`, autorId: marco.id,
      responsavelId: null, motivo: "cenário de teste — Minha Operação", confirmarDuplicidade: true,
    })
    if (!r.ok) throw new Error(`falha ao criar tarefa de teste #${i}: ${r.mensagem}`)
    tarefaIds.push(r.tarefaId)
  }
  const dono = await usuarioResponsavelPelaDistribuicao(prisma)
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { id: dono! }, select: { id: true, email: true, tipo: true } })
  const administrativas = () => prisma.tarefa.count({ where: { processoId: proc.id, tipo: "ADMINISTRATIVA" } })
  ok("A) nenhuma tarefa administrativa 'Atribuir tarefas' nasceu", (await administrativas()) === 0)

  const filaAdmin = await minhaFilaDe(admin.id, admin.email, admin.tipo)
  ok("A) Minha Operação do Admin não ganha item administrativo desta família", !filaAdmin.linhas.some((l) => l.processoId === proc.id))
  ok("A) as 15 sem dono NÃO aparecem na fila pessoal do Admin (não são dele)", tarefaIds.every((id) => !filaAdmin.linhas.some((l) => l.taskId === id)))

  await prisma.tarefa.updateMany({ where: { id: { in: tarefaIds } }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } })
  await avisarGestores({ agora: new Date() })
  const sinoAntes = await sinoDe(admin.id, admin.email, admin.tipo)
  const pessoaisDaFamilia = await prisma.notificacaoOperacional.findMany({
    where: { destinatarioId: admin.id, agrupado: true, tipo: { in: ["PRECISA_AGIR", "CHEGOU_TRABALHO"] }, tarefaIds: { hasSome: tarefaIds } },
  })
  ok("A) nenhuma das 15 certidões vaza como aviso pessoal (PRECISA_AGIR/CHEGOU_TRABALHO) do Admin", pessoaisDaFamilia.length === 0, String(pessoaisDaFamilia.length))
  const distribNotifAntes = sinoAntes.avisos.filter((a) => a.familiaId === proc.id && a.tipo === "SEM_RESPONSAVEL")
  ok("A) o gestor recebe exatamente UM SEM_RESPONSAVEL da família, cobrindo as 15", distribNotifAntes.length === 1 && distribNotifAntes[0].contagem === 15, String(distribNotifAntes.length))
  ok("A) o link do aviso leva à TORRE (aba Tarefas, visão Sem responsável)", distribNotifAntes[0]?.link === LINK_SEM_RESPONSAVEL_NA_TORRE, distribNotifAntes[0]?.link ?? "")
  ok("A) nem DISTRIBUICAO_NECESSARIA existe mais", (await prisma.notificacaoOperacional.count({ where: { processoId: proc.id, tipo: "DISTRIBUICAO_NECESSARIA" } })) === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("B) Admin distribui 10 para Daniela — nada administrativo, fila dela exata")
  // ══════════════════════════════════════════════════════════════════════
  const dez = tarefaIds.slice(0, 10)
  const resB = await redistribuirTarefas({ tarefaIds: dez, novoResponsavelId: daniela.id, autorId: admin.id, motivo: "teste — parcial" })
  ok("B) as 10 foram atribuídas a Daniela", resB.sucesso === 10, `${resB.sucesso}/${resB.total}`)
  ok("B) continua sem tarefa administrativa", (await administrativas()) === 0)
  const filaDanielaB = await minhaFilaDe(daniela.id, daniela.email, daniela.tipo)
  const idsDanielaB = filaDanielaB.linhas.map((l) => l.taskId)
  ok("B) Minha Operação da Daniela já projeta as 10 tarefas dela", dez.every((id) => idsDanielaB.includes(id)))

  // ══════════════════════════════════════════════════════════════════════
  secao("C) Admin distribui as últimas 5 — aviso resolvido, fila da Daniela com as 15")
  // ══════════════════════════════════════════════════════════════════════
  const cinco = tarefaIds.slice(10)
  const resC = await redistribuirTarefas({ tarefaIds: cinco, novoResponsavelId: daniela.id, autorId: admin.id, motivo: "teste — final" })
  ok("C) as últimas 5 foram atribuídas a Daniela", resC.sucesso === 5, `${resC.sucesso}/${resC.total}`)
  ok("C) continua sem tarefa administrativa", (await administrativas()) === 0)
  const sinoDepoisC = await sinoDe(admin.id, admin.email, admin.tipo)
  ok("C) o aviso SEM_RESPONSAVEL foi resolvido (não fica pendente)", sinoDepoisC.avisos.filter((a) => a.tipo === "SEM_RESPONSAVEL" && a.familiaId === proc.id).length === 0)
  const filaDanielaC = await minhaFilaDe(daniela.id, daniela.email, daniela.tipo)
  ok("C) Minha Operação da Daniela projeta as 15 tarefas operacionais", tarefaIds.every((id) => filaDanielaC.linhas.some((l) => l.taskId === id)))
  ok("C) nenhuma tarefa foi duplicada: 15 continuam sendo 15", (await prisma.tarefa.count({ where: { processoId: proc.id, tipo: "NORMAL" } })) === 15)

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(", ")); process.exitCode = 1 }
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
