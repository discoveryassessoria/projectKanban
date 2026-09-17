// scripts/minha-operacao-obrigacao-administrativa.test.ts
// ============================================================================
// A TAREFA ADMINISTRATIVA DENTRO DE MINHA OPERAÇÃO — correção 17/09/2026.
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
import { reconciliarObrigacaoDeAtribuicao, usuarioResponsavelPelaDistribuicao } from "@/lib/operacional/obrigacao-atribuicao"
import { urlDistribuicaoDoProcesso } from "@/lib/operacional/navegacao"
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
  return (await resp.json()) as { vencidas: Array<{ id: number }>; hoje: Array<{ id: number }>; proximos3Dias: Array<{ id: number }>; acontecimentos: Array<{ tipo: string; link: string }> }
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
  secao("A) 15 tarefas NORMAL sem responsável → 1 tarefa ADMINISTRATIVA")
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
  // A RECONCILIAÇÃO É DISPARADA POR EVENTO — aqui simula o evento que criou
  // as 15 (o mesmo `reconciliarObrigacaoDeAtribuicao` que `passo-tarefa.ts`/
  // `reconciliar-tarefas.ts`/`atribuirTarefa`/`devolverAFila` já chamam).
  await reconciliarObrigacaoDeAtribuicao(prisma, proc.id)

  const dono = await usuarioResponsavelPelaDistribuicao(prisma)
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { id: dono! }, select: { id: true, email: true, tipo: true } })

  const obrigacao = await prisma.tarefa.findFirst({
    where: { processoId: proc.id, tipo: "ADMINISTRATIVA", origem: "obrigacao-atribuicao", concluida: false },
    select: { id: true, responsavelId: true, titulo: true },
  })
  ok("A) a tarefa administrativa nasceu, atribuída ao competente", obrigacao?.responsavelId === admin.id)

  const filaAdmin = await minhaFilaDe(admin.id, admin.email, admin.tipo)
  const linhaAdmin = filaAdmin.linhas.find((l) => l.taskId === obrigacao?.id)
  ok("A) Minha Operação do Admin CONTÉM a tarefa administrativa", linhaAdmin != null)
  ok("A) com origem identificável (obrigacao-atribuicao)", linhaAdmin?.origem === "obrigacao-atribuicao")
  ok("A) e contexto de família/processo (Grisotto)", (linhaAdmin?.familiaNome ?? linhaAdmin?.processoNome ?? "").includes("Grisotto"))

  const somaAtencao = (h: { centralOperacional?: { indicadores?: { executavelAgora?: number; atrasadas?: number; bloqueadas?: number } } }) => {
    const i = h?.centralOperacional?.indicadores
    return (i?.executavelAgora ?? 0) + (i?.atrasadas ?? 0) + (i?.bloqueadas ?? 0)
  }
  const homeAdmin = await homeDe(admin.id, admin.email, admin.tipo)
  const atencaoA = somaAtencao(homeAdmin)
  ok("A) Home do Admin conta pelo menos 1 (executavelAgora+atrasadas+bloqueadas) — a obrigação exige atenção", atencaoA >= 1, String(atencaoA))

  const sinoAntes = await sinoDe(admin.id, admin.email, admin.tipo)
  const idsPessoaisAntes = [...sinoAntes.vencidas, ...sinoAntes.hoje, ...sinoAntes.proximos3Dias].map((x) => x.id)
  ok("A) nenhuma das 15 certidões vaza como notificação pessoal de prazo do Admin", tarefaIds.every((id) => !idsPessoaisAntes.includes(id)))
  const distribNotifAntes = sinoAntes.acontecimentos.filter((a) => a.tipo === "DISTRIBUICAO_NECESSARIA" && a.link.includes(`processo=${proc.id}`))
  ok("A) existe exatamente a notificação administrativa pertinente", distribNotifAntes.length === 1, String(distribNotifAntes.length))
  ok("A) o link da notificação leva à Distribuição, escopado à Grisotto", distribNotifAntes[0]?.link === urlDistribuicaoDoProcesso(proc.id))

  // ══════════════════════════════════════════════════════════════════════
  secao("B) Admin distribui 10 para Daniela — mesma obrigação, contador vira 5")
  // ══════════════════════════════════════════════════════════════════════
  const dez = tarefaIds.slice(0, 10)
  const resB = await redistribuirTarefas({ tarefaIds: dez, novoResponsavelId: daniela.id, autorId: admin.id, motivo: "teste — parcial" })
  ok("B) as 10 foram atribuídas a Daniela", resB.sucesso === 10, `${resB.sucesso}/${resB.total}`)

  const obrigacaoDepoisB = await prisma.tarefa.findUnique({ where: { id: obrigacao!.id }, select: { id: true, concluida: true } })
  ok("B) a MESMA obrigação continua aberta (não criou outra)", obrigacaoDepoisB?.concluida === false)
  const abertasB = await prisma.tarefa.count({ where: { processoId: proc.id, tipo: "ADMINISTRATIVA", origem: "obrigacao-atribuicao", concluida: false } })
  ok("B) só 1 obrigação aberta para este processo", abertasB === 1)

  const filaAdminB = await minhaFilaDe(admin.id, admin.email, admin.tipo)
  ok("B) Minha Operação do Admin continua com a MESMA tarefa administrativa (mesmo taskId)", filaAdminB.linhas.some((l) => l.taskId === obrigacao?.id))

  const filaDanielaB = await minhaFilaDe(daniela.id, daniela.email, daniela.tipo)
  const idsDanielaB = filaDanielaB.linhas.map((l) => l.taskId)
  ok("B) Minha Operação da Daniela já projeta as 10 tarefas dela", dez.every((id) => idsDanielaB.includes(id)))

  // ══════════════════════════════════════════════════════════════════════
  secao("C) Admin distribui as últimas 5 — obrigação conclui")
  // ══════════════════════════════════════════════════════════════════════
  const cinco = tarefaIds.slice(10)
  const resC = await redistribuirTarefas({ tarefaIds: cinco, novoResponsavelId: daniela.id, autorId: admin.id, motivo: "teste — final" })
  ok("C) as últimas 5 foram atribuídas a Daniela", resC.sucesso === 5, `${resC.sucesso}/${resC.total}`)

  const obrigacaoDepoisC = await prisma.tarefa.findUnique({ where: { id: obrigacao!.id }, select: { concluida: true } })
  ok("C) a obrigação administrativa foi CONCLUÍDA", obrigacaoDepoisC?.concluida === true)

  const filaAdminC = await minhaFilaDe(admin.id, admin.email, admin.tipo)
  ok("C) a tarefa administrativa NÃO aparece mais em Minha Operação do Admin", !filaAdminC.linhas.some((l) => l.taskId === obrigacao?.id))

  // COMPARATIVO, nunca zero absoluto — o banco de teste é compartilhado
  // entre suítes, e outro admin (mesmo id resolvido por competência) pode
  // ter uma obrigação de OUTRO processo/OUTRA suíte ainda pendente. O que
  // esta obrigação especificamente resolvida precisa provar é QUEDA de pelo
  // menos 1 — a fatia que era dela.
  const homeAdminC = await homeDe(admin.id, admin.email, admin.tipo)
  const atencaoC = somaAtencao(homeAdminC)
  ok("C) Home do Admin caiu em pelo menos 1 (a fatia desta obrigação resolvida)", atencaoC <= atencaoA - 1, `${atencaoA} → ${atencaoC}`)

  const sinoDepoisC = await sinoDe(admin.id, admin.email, admin.tipo)
  const aindaPendenteC = sinoDepoisC.acontecimentos.filter((a) => a.tipo === "DISTRIBUICAO_NECESSARIA" && a.link.includes(`processo=${proc.id}`))
  ok("C) a notificação administrativa foi resolvida (não fica pendente)", aindaPendenteC.length === 0)

  const filaDanielaC = await minhaFilaDe(daniela.id, daniela.email, daniela.tipo)
  const idsDanielaC = filaDanielaC.linhas.map((l) => l.taskId)
  ok("C) Minha Operação da Daniela projeta as 15 tarefas operacionais", tarefaIds.every((id) => idsDanielaC.includes(id)))

  // ══════════════════════════════════════════════════════════════════════
  secao("E) Deep-link — a URL da obrigação leva direto à Distribuição, no contexto da Grisotto")
  // ══════════════════════════════════════════════════════════════════════
  const url = urlDistribuicaoDoProcesso(proc.id)
  ok("E) a URL aponta para Operação → Distribuição", url.startsWith("/operacao?") && url.includes("aba=distribuicao"))
  ok("E) a URL carrega o processoId da Grisotto (nunca nome/posição)", url.includes(`processo=${proc.id}`))

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(", ")); process.exitCode = 1 }
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
