// scripts/seed-modalidades-italia.ts (era seed-modalidade-italia-judicial.ts)
//
// A BASE JURÍDICA DA ROTA ITALIANA JUDICIAL entra no cadastro.
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
// A regra "um requerimento por pessoa" vs "um requerimento pela família" não é
// código: é o campo `cardinalidadeRequerimento` da Modalidade Legal. Sem a
// modalidade italiana cadastrada, o processo italiano não tem onde ler a regra e
// o sistema cai na mais restritiva (INDIVIDUAL) — o oposto do certo, porque o
// ricorso ao Tribunale cobre a família inteira sob um único ruolo generale.
//
// A espanhola (LMD, consular) é declarada INDIVIDUAL de forma EXPLÍCITA. Ela já
// cairia nisso pelo default da coluna, mas default não é declaração: quem ler o
// cadastro depois precisa ver a decisão escrita, não deduzi-la de uma ausência.
//
// Nomes vieram do usuário. Nada aqui é inventado; `descricao` fica nula.
// Idempotente pela chave `code`.
import { prisma } from "../src/lib/prisma"

const PAIS_ITALIA = "italia"

async function main() {
  const aplicar = process.argv.includes("--aplicar")

  const italia = await prisma.catalogoPais.findFirst({
    where: { countryKey: PAIS_ITALIA },
    select: { id: true, countryLabel: true },
  })
  if (!italia) throw new Error("País Itália não está no CatalogoPais — nada a fazer.")

  const plano: string[] = []

  const jaModalidade = await prisma.modalidadeLegal.findUnique({ where: { code: "IT_JUDICIAL" }, select: { id: true } })
  if (!jaModalidade) plano.push('criar ModalidadeLegal IT_JUDICIAL "Processo Judicial" (Itália) — COLETIVO')
  else plano.push('ModalidadeLegal IT_JUDICIAL já existe — garantir cardinalidade COLETIVO')

  const jaEnquadramento = await prisma.enquadramentoLegal.findUnique({ where: { code: "IT_JUDICIAL" }, select: { id: true } })
  if (!jaEnquadramento) plano.push('criar EnquadramentoLegal IT_JUDICIAL "Processo Judicial" (a rota italiana judicial é uma só)')

  plano.push("declarar ES_LMD como INDIVIDUAL (explícito, não por default)")
  for (const p of plano) console.log(`  · ${p}`)

  if (!aplicar) {
    console.log("\n(dry-run — rode com --aplicar para gravar)")
    process.exit(0)
  }

  // ── ITÁLIA · ADMINISTRATIVA ──────────────────────────────────────────────
  // O usuário declarou que a rota italiana tem DUAS modalidades: judicial e
  // administrativa. O nome segue a simetria da que ele nomeou.
  //
  // A CARDINALIDADE aqui é INFERIDA, não declarada: a via administrativa
  // tramita no consulado/comune, onde o fascicolo é por pessoa — mesmo padrão da
  // rota espanhola. Fica INDIVIDUAL, que é também a regra restritiva. Se estiver
  // errado, agora se corrige na TELA (Gerenciamento › Processos › Modalidades
  // Legais), sem deploy — foi para isso que o cadastro virou tela.
  const administrativa = await prisma.modalidadeLegal.upsert({
    where: { code: "IT_ADMINISTRATIVO" },
    update: {},
    create: {
      code: "IT_ADMINISTRATIVO",
      nome: "Processo Administrativo",
      paisId: italia.id,
      cardinalidadeRequerimento: "INDIVIDUAL",
      ordem: 1,
      ativo: true,
    },
    select: { id: true, code: true, nome: true, cardinalidadeRequerimento: true },
  })

  const modalidade = await prisma.modalidadeLegal.upsert({
    where: { code: "IT_JUDICIAL" },
    update: { cardinalidadeRequerimento: "COLETIVO" },
    create: {
      code: "IT_JUDICIAL",
      nome: "Processo Judicial",
      paisId: italia.id,
      // O ricorso ao Tribunale é UM processo para a família inteira, com um só
      // número de ruolo generale. É esta linha que faz a aba Protocolos oferecer
      // a lista de requerentes em vez de uma escolha única.
      cardinalidadeRequerimento: "COLETIVO",
      ordem: 0,
      ativo: true,
    },
    select: { id: true, code: true, nome: true, cardinalidadeRequerimento: true },
  })
  console.log(`\n✅ Modalidade ${modalidade.code} — ${modalidade.nome} · ${modalidade.cardinalidadeRequerimento}`)

  const enquadramento = await prisma.enquadramentoLegal.upsert({
    where: { code: "IT_JUDICIAL" },
    update: {},
    create: {
      code: "IT_JUDICIAL",
      nome: "Processo Judicial",
      modalidadeLegalId: modalidade.id,
      ordem: 0,
      ativo: true,
    },
    select: { id: true, code: true, nome: true },
  })
  console.log(`✅ Enquadramento ${enquadramento.code} — ${enquadramento.nome}`)

  const enqAdm = await prisma.enquadramentoLegal.upsert({
    where: { code: "IT_ADMINISTRATIVO" },
    update: {},
    create: { code: "IT_ADMINISTRATIVO", nome: "Processo Administrativo", modalidadeLegalId: administrativa.id, ordem: 1, ativo: true },
    select: { code: true, nome: true },
  })
  console.log(`✅ Modalidade ${administrativa.code} — ${administrativa.nome} · ${administrativa.cardinalidadeRequerimento} (cardinalidade INFERIDA da via consular; editável na tela)`)
  console.log(`✅ Enquadramento ${enqAdm.code} — ${enqAdm.nome}`)

  const es = await prisma.modalidadeLegal.updateMany({
    where: { code: "ES_LMD" },
    data: { cardinalidadeRequerimento: "INDIVIDUAL" },
  })
  console.log(`✅ ES_LMD declarada INDIVIDUAL (${es.count} linha)`)
  process.exit(0)
}
main()
