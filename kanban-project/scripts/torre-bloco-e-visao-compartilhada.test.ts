// scripts/torre-bloco-e-visao-compartilhada.test.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO E7 (29/09/2026) — visão salva compartilhável com a
// equipe. A visão continua pertencendo a quem criou; compartilhar só muda
// VISIBILIDADE, nunca dono. Ver src/app/api/relatorios/visoes/route.ts.
//
//   npx tsx scripts/torre-bloco-e-visao-compartilhada.test.ts
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bloco-e-visao-compartilhada.test.ts")

import { prisma } from "../lib/prisma"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

const MARCA = "TORRE_E7_"
const DOMINIO = "torre_e7_teste"

async function limpar() {
  await prisma.relatorioVisao.deleteMany({ where: { dominio: DOMINIO } })
  await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } })
}

async function main() {
  await limpar()

  const dona = await prisma.usuario.create({ data: { nome: `${MARCA}Dona`, email: `${MARCA}dona@teste.com`, senha: "x", tipo: "assistente" } })
  const colega = await prisma.usuario.create({ data: { nome: `${MARCA}Colega`, email: `${MARCA}colega@teste.com`, senha: "x", tipo: "assistente" } })

  const visao = await prisma.relatorioVisao.create({
    data: { usuarioId: dona.id, dominio: DOMINIO, nome: "minha visão", spec: { dominio: DOMINIO, filtros: [] } },
  })
  ok("nasce NÃO compartilhada por padrão", visao.compartilhada === false)

  const vistaPorColegaAntes = await prisma.relatorioVisao.findMany({
    where: { compartilhada: true, usuarioId: { not: colega.id }, dominio: DOMINIO },
  })
  ok("colega não vê a visão antes de ser compartilhada", vistaPorColegaAntes.length === 0)

  // Só o DONO compartilha — o `where` da porta real inclui usuarioId; aqui
  // provamos a garantia no nível do dado: um updateMany com usuarioId errado
  // não afeta a linha de outro dono.
  const tentativaDeOutroDono = await prisma.relatorioVisao.updateMany({
    where: { id: visao.id, usuarioId: colega.id }, data: { compartilhada: true },
  })
  ok("update com usuarioId errado não afeta a visão de outro dono", tentativaDeOutroDono.count === 0)

  await prisma.relatorioVisao.updateMany({ where: { id: visao.id, usuarioId: dona.id }, data: { compartilhada: true } })

  const vistaPorColegaDepois = await prisma.relatorioVisao.findMany({
    where: { compartilhada: true, usuarioId: { not: colega.id }, dominio: DOMINIO },
  })
  ok("colega vê a visão DEPOIS de compartilhada", vistaPorColegaDepois.length === 1)
  ok("a visão continua pertencendo à dona", vistaPorColegaDepois[0]?.usuarioId === dona.id)

  const propriaListaDaDona = await prisma.relatorioVisao.findMany({ where: { usuarioId: dona.id, dominio: DOMINIO } })
  ok("a dona vê a própria visão na lista de dono, não duplicada", propriaListaDaDona.length === 1)

  await prisma.relatorioVisao.updateMany({ where: { id: visao.id, usuarioId: dona.id }, data: { compartilhada: false } })
  const vistaPorColegaAposDescompartilhar = await prisma.relatorioVisao.findMany({
    where: { compartilhada: true, usuarioId: { not: colega.id }, dominio: DOMINIO },
  })
  ok("descompartilhar remove da lista da equipe", vistaPorColegaAposDescompartilhar.length === 0)

  await limpar()

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
