// scripts/seed-fixture-minima-teste.ts
//
// FIXTURE MÍNIMA do banco de teste local/CI — o que TODO teste de Catálogo de
// Fases (e boa parte dos outros) precisa encontrar já existindo: um admin e
// um país+modalidade (Cadastro Mestre). `prisma/seed.ts` cria o admin mas não
// cadastra país/modalidade nenhum — sem isso, qualquer teste que cria um
// TipoProcessoNacionalidade sintético (`prisma.modalidadePais.findFirst()`)
// falha com "nenhuma modalidade de país no banco de teste", não porque o
// PRODUTO está quebrado, mas porque o banco ficou vazio (rebuild local, CI
// do zero). Idempotente — upsert por chave, rodar de novo não duplica nada.
//
// Uso:
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//     npx tsx scripts/seed-fixture-minima-teste.ts
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("seed-fixture-minima-teste.ts")

import { prisma } from "../lib/prisma"

async function main() {
  // KILL SWITCH GLOBAL DO RUNTIME V2 — default `false` (MotorConfig.id=1
  // simplesmente não existe num banco recém-criado). Sem isto, TODA
  // materialização real (`instanciarWorkflowDaFase`) recusa com
  // RUNTIME_V2_DESABILITADO antes mesmo de olhar a fase — achado real ao
  // rodar a suíte de Fases contra um banco de teste genuinamente vazio
  // (CI, ou um `mrg-banco-teste.mjs up` do zero): o motor v2 nunca liga
  // sozinho, e sem esta linha boa parte dos testes de reconciliação falha
  // por um motivo que não tem nada a ver com a fase sendo testada.
  await prisma.motorConfig.upsert({
    where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true },
  })
  console.log("✅ MotorConfig#1: runtimeV2Habilitado=true")

  const pais = await prisma.catalogoPais.upsert({
    where: { countryKey: "ITALIA" },
    update: {},
    create: { countryKey: "ITALIA", countryLabel: "Itália", nationalityKey: "ITALIANA", nationalityLabel: "Italiana", defaultCurrency: "EUR", ativo: true },
  })
  const jaTemModalidade = await prisma.modalidadePais.findFirst({ where: { paisId: pais.id } })
  const modalidade = jaTemModalidade ?? await prisma.modalidadePais.create({
    data: { paisId: pais.id, modalityKey: "JUDICIAL", modalityLabel: "Judicial", ordem: 1, ativo: true },
  })
  console.log(`✅ país #${pais.id} (${pais.countryLabel}) · modalidade #${modalidade.id} (${modalidade.modalityLabel})`)

  const jaTemAdmin = await prisma.usuario.findFirst({ where: { tipo: "admin" } })
  if (!jaTemAdmin) {
    const admin = await prisma.usuario.create({
      data: { nome: "Administrador", email: "admin@teste.com", senha: "$2b$10$K7L1OJ0TfPY5Z1q9Z9Z9ZO", tipo: "admin" },
    })
    console.log(`✅ admin #${admin.id} (${admin.email}) — criado (senha de login não vale para JWT direto)`)
  } else {
    console.log(`· admin já existia: #${jaTemAdmin.id}`)
  }
}

main().finally(() => prisma.$disconnect())
