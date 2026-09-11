import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { gerarCodigoPublico, modoReutilizaLacunaProcessoLigado, proximoNumeroProcessoComPossivelLacuna } from "@/lib/codigos/code-generator"
import { isoDoPais, formatarCodigo } from "@/lib/codigos/code-patterns"

let passou = 0, falhou = 0
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function main() {
  exigirBancoDeTeste("prova o modo reaproveita-lacuna de código de Processo")

  await prisma.configuracaoSistema.deleteMany({ where: { chave: "processo_reutiliza_codigo_lacuna" } })
  await prisma.processo.deleteMany({ where: { codigo: { startsWith: "XT-" } } })
  await prisma.codeSequence.deleteMany({ where: { scope: "XT" } })

  const criar = (codigo: string) => prisma.processo.create({ data: { codigo, nome: `Seed ${codigo}` }, select: { id: true } })

  console.log("MODO REAPROVEITA-LACUNA — Processo\n")

  // 1) três processos, exclui o do meio (o cenário exato do usuário)
  await criar("XT-1")
  const p2 = await criar("XT-2")
  await criar("XT-3")
  await prisma.processo.delete({ where: { id: p2.id } })

  // 2) flag DESLIGADA (padrão): gerarCodigoPublico normal, sem qualquer noção de furo
  // (o escopo real do país é "ES", independente do "XT" usado para isolar o resto do cenário)
  ok("2a) modo está desligado por padrão", (await modoReutilizaLacunaProcessoLigado(prisma)) === false)
  const normal = await gerarCodigoPublico(prisma, "PROCESS", { pais: "espanha" })
  // a sequência "ES" é global/compartilhada (outros testes/seeds podem já tê-la avançado) —
  // por isso não fixamos o número, só provamos que usa o escopo real do país (não o "XT" do cenário)
  ok("2b) sem o interruptor, gerarCodigoPublico segue normal (escopo ES, não enxerga os furos do XT)", /^ES-\d+$/.test(normal), normal)

  // 3) liga o interruptor
  await prisma.configuracaoSistema.upsert({
    where: { chave: "processo_reutiliza_codigo_lacuna" },
    create: { chave: "processo_reutiliza_codigo_lacuna", valor: "1", grupo: "geral" },
    update: { valor: "1" },
  })
  ok("3a) modo agora está ligado", (await modoReutilizaLacunaProcessoLigado(prisma)) === true)

  // 4) com XT-1 e XT-3 existentes (XT-2 excluído), o próximo deve ser 2 (o furo)
  const iso = "XT"
  const candidato1 = await proximoNumeroProcessoComPossivelLacuna(prisma, iso)
  ok("4a) acha o furo (2), não o próximo depois do maior (4)", candidato1 === 2, String(candidato1))
  await criar(formatarCodigo("PROCESS", candidato1, "espanha").replace(/^ES/, iso)) // grava XT-2 de novo

  // 5) sem furo nenhum sobrando (1,2,3 ocupados) — cai pro próximo normal (4)
  const candidato2 = await proximoNumeroProcessoComPossivelLacuna(prisma, iso)
  ok("5a) sem furo, cai no próximo normal (4)", candidato2 === 4, String(candidato2))
  await criar(`${iso}-${candidato2}`)

  // 6) desliga o interruptor — volta a nunca reutilizar
  await prisma.configuracaoSistema.update({
    where: { chave: "processo_reutiliza_codigo_lacuna" },
    data: { valor: "0" },
  })
  ok("6a) modo desligado de novo", (await modoReutilizaLacunaProcessoLigado(prisma)) === false)

  // exclui XT-3 pra abrir um furo de propósito, e confirma que desligado NÃO reaproveita
  const p3 = await prisma.processo.findFirst({ where: { codigo: `${iso}-3` }, select: { id: true } })
  if (p3) await prisma.processo.delete({ where: { id: p3.id } })
  // a sequência "XT" nunca foi semeada por gerarCodigoPublico (só usei XT diretamente,
  // sem chamar gerarCodigoPublico pra esse escopo) — confirma via CodeSequence que o
  // "ultimo" ficou em 4 (o maior emitido), e não recua pro furo do 3.
  const seq = await prisma.codeSequence.findUnique({ where: { scope: iso }, select: { ultimo: true } })
  ok("6b) CodeSequence ficou em 4 (o maior já emitido), não recuou pro furo", seq?.ultimo === 4, String(seq?.ultimo))

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  await prisma.processo.deleteMany({ where: { codigo: { startsWith: "XT-" } } })
  await prisma.codeSequence.deleteMany({ where: { scope: "XT" } })
  await prisma.configuracaoSistema.deleteMany({ where: { chave: "processo_reutiliza_codigo_lacuna" } })
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
