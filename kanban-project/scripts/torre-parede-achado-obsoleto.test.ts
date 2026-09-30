// scripts/torre-parede-achado-obsoleto.test.ts
// ============================================================================
// TORRE — "PAREDE À FRENTE" NÃO LISTA ACHADO DE VERIFICAÇÃO JÁ CORRIGIDA (30/09/2026).
//
// Achado real: a CAD-012 foi corrigida no código, mas "Apostilar documento" e "Registrar necessidade de
// retificação" continuaram no "Precisa de você". O achado antigo seguia ABERTO no banco porque a Saúde só o
// resolve quando reexecuta a verificação (CAD-012/WF-004 são dos modos COMPLETO/PROFUNDO; o cron horário é
// RÁPIDO). A Torre passa a CONFIRMAR agora, só em leitura: reexecuta a verificação e mantém apenas o achado
// que ela ainda acusa. Ausência de resultado não é ausência de problema: se a confirmação não é possível, o
// achado permanece.
//
//   npx tsx scripts/torre-parede-achado-obsoleto.test.ts   (banco de teste)
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-parede-achado-obsoleto.test.ts")

import { prisma } from "../lib/prisma"
import { achadosVigentesDaParede } from "../lib/saude/parede-a-frente"
import { itensPrecisaDeVoce } from "../lib/operacional/precisa-de-voce"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORRE_PAREDE_OBS"

const semear = (codigo: string, chave: string, extra: Record<string, unknown> = {}) =>
  prisma.saudeAchado.create({
    data: {
      chave, codigo, dominio: "WORKFLOW", modulo: "teste", severidade: "ERRO", titulo: `${MARCA} ${chave}`,
      descricao: "d", versaoCatalogo: "t", evidencia: { fase: "apostilamento" }, ...extra,
    } as never,
  })

async function main() {
  await prisma.saudeAchado.deleteMany({ where: { titulo: { startsWith: MARCA } } })
  try {
    const agora = new Date()
    // Um achado com a FORMA de chave do motor (`CODIGO::local`) que a verificação, hoje, NÃO produz: é resíduo.
    const velho = await semear("CAD-012", `CAD-012::passo-sem-execucao:${MARCA}-velho`)
    const velhoWf = await semear("WF-004", `WF-004::${MARCA}-velho`)

    secao("A VERIFICAÇÃO REAL (contra o banco) já não acusa o achado antigo — a Torre não o lista")
    const vigentes = await achadosVigentesDaParede(prisma, agora)
    ok("CAD-012 residual não é vigente", !vigentes.some((a) => a.id === velho.id))
    ok("WF-004 residual não é vigente", !vigentes.some((a) => a.id === velhoWf.id))
    const itens = await itensPrecisaDeVoce({ agora, linhas: [] })
    const idsNaParede = itens.filter((i) => i.tipo === "PAREDE_A_FRENTE").map((i) => (i.contexto as { achadoId?: number }).achadoId)
    ok("o 'Precisa de você' não devolve PAREDE_A_FRENTE para o achado residual", !idsNaParede.includes(velho.id) && !idsNaParede.includes(velhoWf.id))

    secao("SÓ LEITURA — o achado antigo continua aberto para a Saúde resolver na próxima rodada")
    const depois = await prisma.saudeAchado.findUniqueOrThrow({ where: { id: velho.id } })
    ok("status continua ABERTO e a última detecção não foi tocada", depois.status === "ABERTO" && depois.ultimaDeteccao.getTime() === velho.ultimaDeteccao.getTime() && depois.resolvidoEm == null)

    secao("QUANDO A VERIFICAÇÃO AINDA ACUSA, O ACHADO PERMANECE")
    const acusa = async (codigo: string) => new Set(codigo === "CAD-012" ? [velho.chave] : [velhoWf.chave])
    const mantidos = await achadosVigentesDaParede(prisma, agora, { reconfirmar: acusa })
    ok("CAD-012 e WF-004 acusados agora → ambos permanecem", mantidos.some((a) => a.id === velho.id) && mantidos.some((a) => a.id === velhoWf.id))
    const soWf = await achadosVigentesDaParede(prisma, agora, { reconfirmar: async (c) => new Set(c === "WF-004" ? [velhoWf.chave] : []) })
    ok("é por achado: só o que ainda é acusado permanece", !soWf.some((a) => a.id === velho.id) && soWf.some((a) => a.id === velhoWf.id))

    secao("SEM CONFIRMAÇÃO POSSÍVEL, PERMANECE (ausência de resultado não é ausência de problema)")
    const falhou_ = await achadosVigentesDaParede(prisma, agora, { reconfirmar: async () => null })
    ok("verificação falhou/estourou/sumiu do catálogo → o achado permanece", falhou_.some((a) => a.id === velho.id) && falhou_.some((a) => a.id === velhoWf.id))
    const foraDoMotor = await semear("CAD-012", `${MARCA}::sem-forma-do-motor`)
    const semForma = await achadosVigentesDaParede(prisma, agora, { reconfirmar: async () => new Set() })
    ok("chave que não tem a forma do motor não pode ser confirmada → permanece", semForma.some((a) => a.id === foraDoMotor.id) && !semForma.some((a) => a.id === velho.id))

    secao("IGNORADO E RESOLVIDO CONTINUAM FORA (regra anterior preservada)")
    await prisma.saudeAchado.update({ where: { id: foraDoMotor.id }, data: { status: "IGNORADO", ignoradoAte: new Date(Date.now() + 86_400_000) } })
    const ign = await achadosVigentesDaParede(prisma, agora, { reconfirmar: async () => null })
    ok("ignorado até o futuro não volta", !ign.some((a) => a.id === foraDoMotor.id))
    await prisma.saudeAchado.update({ where: { id: velho.id }, data: { status: "RESOLVIDO", resolvidoEm: new Date() } })
    const res = await achadosVigentesDaParede(prisma, agora, { reconfirmar: async () => null })
    ok("resolvido não volta", !res.some((a) => a.id === velho.id))
  } finally {
    await prisma.saudeAchado.deleteMany({ where: { titulo: { startsWith: MARCA } } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
