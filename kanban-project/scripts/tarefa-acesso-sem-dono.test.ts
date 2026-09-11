// scripts/tarefa-acesso-sem-dono.test.ts
// ============================================================================
// SEM DONO ≠ QUALQUER UM PODE EXECUTAR.
//
// Achado real (11/09/2026): Daniela concluiu a Genealogia de um processo; ele
// avançou para Emissão Documental. A linha da Central mostrava corretamente
// "Sem responsável" — mas o botão "Iniciar" funcionava do mesmo jeito, e ela
// conseguiu executar a etapa sem que ninguém estivesse formalmente responsável
// por ela.
//
// CAUSA: `negarSeNaoForDonoDaTarefa` (src/lib/tarefa-acesso.ts) tratava
// `responsavelId === null` como "é dono" para TODA chamada — a mesma régua
// usada tanto por rotas de LEITURA (ver na lista, abrir o deep-link) quanto
// por rotas que EXECUTAM (iniciar, concluir, bloquear, agir num passo do
// workflow). `iniciarTarefa()` (lib/operacional/tarefa-comandos.ts) já
// aplicava a regra certa há tempos — "iniciar sem dono deixaria o trabalho em
// andamento e sem ninguém responsável por ele" — mas essa regra não estava em
// `negarSeNaoForDonoDaTarefa`, e é ELA que protege as ações do PASSO do
// workflow (onde o clique da Daniela realmente passou).
//
// CORREÇÃO: o padrão virou NEGAR sem dono; `permiteSemDono: true` é o opt-in
// explícito, usado só pelas duas rotas que são LEITURA de verdade (navegação
// do deep-link, GET do histórico).
//
//   npx tsx scripts/tarefa-acesso-sem-dono.test.ts
// ============================================================================
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48)
import { readFileSync } from "fs"
import { prisma } from "@/lib/prisma"
import { signAuthToken } from "@/lib/auth-jwt"
import { negarSeNaoForDonoDaTarefa, negarSeNaoForDonoDaTarefaPorId } from "@/src/lib/tarefa-acesso"
import { exigirBancoDeTeste } from "./_banco-de-teste"

exigirBancoDeTeste("cria usuários e tarefa reais para provar o gate de acesso")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const read = (p: string) => readFileSync(p, "utf8")
const req = (token: string) => new Request("http://t/x", { headers: { Authorization: `Bearer ${token}` } })

const MARCA = "SEMDONO"

async function limpar() {
  await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@semdono.test" } } })
}

async function main() {
  console.log("SEM DONO ≠ QUALQUER UM PODE EXECUTAR\n")
  await limpar()

  const assistente = await prisma.usuario.create({
    data: { nome: `${MARCA} Assistente`, email: "assistente@semdono.test", senha: "x", tipo: "assistente" },
    select: { id: true },
  })
  const outraPessoa = await prisma.usuario.create({
    data: { nome: `${MARCA} Outra`, email: "outra@semdono.test", senha: "x", tipo: "assistente" },
    select: { id: true },
  })
  const admin = await prisma.usuario.create({
    data: { nome: `${MARCA} Admin`, email: "admin@semdono.test", senha: "x", tipo: "admin" },
    select: { id: true },
  })

  const tarefaSemDono = await prisma.tarefa.create({
    data: { titulo: `${MARCA} Certidão sem responsável`, statusTarefa: "NAO_INICIADA", responsavelId: null, chaveIdempotencia: `${MARCA}-1` },
    select: { id: true },
  })
  const tarefaDaAssistente = await prisma.tarefa.create({
    data: { titulo: `${MARCA} Certidão da assistente`, statusTarefa: "NAO_INICIADA", responsavelId: assistente.id, chaveIdempotencia: `${MARCA}-2` },
    select: { id: true },
  })
  const tarefaDeOutra = await prisma.tarefa.create({
    data: { titulo: `${MARCA} Certidão de outra pessoa`, statusTarefa: "NAO_INICIADA", responsavelId: outraPessoa.id, chaveIdempotencia: `${MARCA}-3` },
    select: { id: true },
  })

  const tokenAssistente = await signAuthToken({ userId: assistente.id, email: "assistente@semdono.test", tipo: "assistente" })
  const tokenAdmin = await signAuthToken({ userId: admin.id, email: "admin@semdono.test", tipo: "admin" })

  secao("1) O CASO REAL — o relato da Daniela, reproduzido")
  const r1 = await negarSeNaoForDonoDaTarefa(req(tokenAssistente), null)
  check("1a) EXECUTAR (default) sobre tarefa SEM dono: NEGADO", r1 !== null)
  check("1b) status 422 (é 'atribua antes', não 'você não tem acesso')", r1?.status === 422)
  const corpo1 = r1 ? await r1.clone().json() : null
  check("1c) código SEM_RESPONSAVEL — o mesmo que iniciarTarefa() já usava", corpo1?.codigo === "SEM_RESPONSAVEL")

  secao("2) LEITURA continua liberada sem dono — não é a mesma pergunta")
  const r2 = await negarSeNaoForDonoDaTarefa(req(tokenAssistente), null, { permiteSemDono: true })
  check("2a) opt-in explícito permiteSemDono: PERMITE", r2 === null)

  secao("3) Nada mudou para quem JÁ é dono, ou para quem tenta a tarefa alheia")
  const r3 = await negarSeNaoForDonoDaTarefa(req(tokenAssistente), assistente.id)
  check("3a) a PRÓPRIA tarefa continua liberada (default estrito)", r3 === null)
  const r4 = await negarSeNaoForDonoDaTarefa(req(tokenAssistente), outraPessoa.id)
  check("3b) tarefa de OUTRA pessoa continua negada (403, não 422)", r4 !== null && r4.status === 403)

  secao("4) Admin continua isento — inclusive sem dono")
  const r5 = await negarSeNaoForDonoDaTarefa(req(tokenAdmin), null)
  check("4a) admin PASSA mesmo sem dono, mesmo em modo estrito", r5 === null)

  secao("5) A variante PorId (usada pelo /comando) herda a MESMA regra")
  const r6 = await negarSeNaoForDonoDaTarefaPorId(req(tokenAssistente), tarefaSemDono.id)
  check("5a) tarefa sem dono, por id: NEGADO por padrão", r6 !== null && r6.status === 422)
  const r7 = await negarSeNaoForDonoDaTarefaPorId(req(tokenAssistente), tarefaDaAssistente.id)
  check("5b) a própria, por id: PERMITE", r7 === null)
  const r8 = await negarSeNaoForDonoDaTarefaPorId(req(tokenAssistente), tarefaDeOutra.id)
  check("5c) a de outra pessoa, por id: NEGADO (403)", r8 !== null && r8.status === 403)

  secao("6) AS ROTAS QUE EXECUTAM chamam SEM permiteSemDono — herdam o padrão estrito")
  const ROTAS_ESTRITAS = [
    "src/app/api/tarefas/[tarefaId]/bloquear/route.ts",
    "src/app/api/tarefas/[tarefaId]/cancelar/route.ts",
    "src/app/api/tarefas/[tarefaId]/concluir/route.ts",
    "src/app/api/tarefas/[tarefaId]/desbloquear/route.ts",
    "src/app/api/tarefas/[tarefaId]/iniciar/route.ts",
    "src/app/api/workflow-step-instances/[id]/[acao]/route.ts",
    "src/app/api/workflow-step-instances/[id]/execucao/route.ts",
    "src/app/api/workflow-step-instances/[id]/reabrir/route.ts",
    "src/app/api/workflow-step-instances/[id]/reexecutar/route.ts",
    "src/app/api/tarefas/[tarefaId]/comando/route.ts",
  ]
  for (const arquivo of ROTAS_ESTRITAS) {
    const conteudo = read(arquivo)
    check(`6) ${arquivo} não passa permiteSemDono: true`, !conteudo.includes("permiteSemDono: true"), arquivo.includes("comando") ? "via negarSeNaoForDonoDaTarefaPorId" : undefined)
  }

  secao("7) AS DUAS ROTAS DE LEITURA passam permiteSemDono explicitamente")
  const navegacao = read("src/app/api/operacao/tarefas/[tarefaId]/navegacao/route.ts")
  check("7a) navegacao/route.ts (deep-link) passa permiteSemDono: true", navegacao.includes("{ permiteSemDono: true }"))
  const historico = read("src/app/api/tarefas/[tarefaId]/historico/route.ts")
  check("7b) historico/route.ts GET passa permiteSemDono: true", historico.includes("{ permiteSemDono: true }"))

  await limpar()
  console.log(`\n${ok} passaram, ${falhas.length} falharam`)
  if (falhas.length) console.log("Falhas:", falhas.join(", "))
  await prisma.$disconnect()
  process.exit(falhas.length > 0 ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
