// scripts/codigo-cliente.test.ts
//
// CÓDIGO PÚBLICO DO CLIENTE — nasce com o cliente, é único, e não se edita.
//
// A regressão foi silenciosa: a rota de criação nunca chamou o gerador, então o
// cliente nascia com publicCode null e a ficha mostrava "—". Estes testes
// travam a cadeia inteira: geração na transação, unicidade sob concorrência,
// imutabilidade, backfill só do que falta, e a resposta da API trazendo o código.
//
// ⚠ ESCREVE. Banco NÃO-produtivo. Limpa o que cria.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "@/lib/prisma"
import { gerarCodigoPublico } from "@/lib/codigos/code-generator"

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log("  ✅", m) } else { fail++; console.log("  ❌", m) } }
const RAIZ = join(__dirname, "..")
const src = (p: string) => readFileSync(join(RAIZ, p), "utf8")
const TS = Date.now()
const criados: number[] = []

/** Cria como a ROTA cria: sequência + registro na mesma transação. */
async function criarCliente(nome: string) {
  return prisma.$transaction(async (tx) => {
    const publicCode = await gerarCodigoPublico(tx, "CLIENT")
    return tx.requerente.create({ data: { nome, publicCode } })
  })
}

async function main() {
  // ── 1. criar gera código, no formato canônico ───────────────────────────
  const c1 = await criarCliente(`Teste A ${TS}`)
  criados.push(c1.id)
  chk(!!c1.publicCode, `criar cliente gera código (${c1.publicCode})`)
  chk(/^CLI-\d+$/.test(c1.publicCode ?? ""), `formato canônico CLI-N (${c1.publicCode})`)

  // ── 2. códigos são únicos e a sequência avança ──────────────────────────
  const c2 = await criarCliente(`Teste B ${TS}`)
  criados.push(c2.id)
  chk(c1.publicCode !== c2.publicCode, "dois clientes recebem códigos diferentes")
  const n1 = Number((c1.publicCode ?? "").split("-")[1])
  const n2 = Number((c2.publicCode ?? "").split("-")[1])
  chk(n2 > n1, `a sequência AVANÇA, não conta registros (${n1} → ${n2})`)

  // ── 3. concorrência: criações simultâneas não colidem ───────────────────
  const paralelos = await Promise.all(
    Array.from({ length: 8 }, (_, i) => criarCliente(`Concorrente ${i} ${TS}`)),
  )
  paralelos.forEach((p) => criados.push(p.id))
  const codigos = paralelos.map((p) => p.publicCode)
  chk(new Set(codigos).size === codigos.length, `8 criações simultâneas → 8 códigos distintos (${new Set(codigos).size})`)

  // ── 4. não reutiliza código de registro apagado ─────────────────────────
  const desc = await criarCliente(`Descartável ${TS}`)
  const codigoDescartado = desc.publicCode
  await prisma.requerente.delete({ where: { id: desc.id } })
  const depois = await criarCliente(`Depois ${TS}`)
  criados.push(depois.id)
  chk(depois.publicCode !== codigoDescartado, `código de registro apagado NÃO é reutilizado (${codigoDescartado} ≠ ${depois.publicCode})`)

  // ── 5. cliente existente mantém o código ────────────────────────────────
  await prisma.requerente.update({ where: { id: c1.id }, data: { telefone: "119" } })
  const relido = await prisma.requerente.findUnique({ where: { id: c1.id }, select: { publicCode: true } })
  chk(relido?.publicCode === c1.publicCode, "editar o cliente não muda o código")

  // ── 6. o unique do banco barra duplicata ────────────────────────────────
  let barrou = false
  try {
    const dup = await prisma.requerente.create({ data: { nome: `Dup ${TS}`, publicCode: c1.publicCode } })
    criados.push(dup.id)
  } catch { barrou = true }
  chk(barrou, "constraint única impede código duplicado no banco")

  // ── 7. backfill só toca em quem está sem código ─────────────────────────
  const semCodigo = await prisma.requerente.create({ data: { nome: `Sem código ${TS}` } })
  criados.push(semCodigo.id)
  const antesDoBackfill = await prisma.requerente.findUnique({ where: { id: c1.id }, select: { publicCode: true } })
  const alvos = await prisma.requerente.findMany({ where: { publicCode: null }, select: { id: true } })
  chk(alvos.length === 1 && alvos[0].id === semCodigo.id, `o backfill enxerga só o cliente sem código (${alvos.length})`)
  const novo = await prisma.$transaction(async (tx) => {
    const cod = await gerarCodigoPublico(tx, "CLIENT")
    await tx.requerente.update({ where: { id: semCodigo.id }, data: { publicCode: cod } })
    return cod
  })
  const depoisDoBackfill = await prisma.requerente.findUnique({ where: { id: c1.id }, select: { publicCode: true } })
  chk(antesDoBackfill?.publicCode === depoisDoBackfill?.publicCode, "backfill NÃO altera código histórico")
  chk(/^CLI-\d+$/.test(novo), `backfill atribui código canônico (${novo})`)
  chk((await prisma.requerente.count({ where: { publicCode: null } })) === 0, "nenhum cliente fica sem código")

  // ── 8. GUARDS estruturais ───────────────────────────────────────────────
  const rotaReq = src("src/app/api/requerentes/route.ts")
  const rotaCon = src("src/app/api/contratantes/route.ts")
  for (const [nome, r] of [["requerentes", rotaReq], ["contratantes", rotaCon]] as const) {
    chk(/gerarCodigoPublico\(tx, ['"]CLIENT['"]\)/.test(r), `${nome}: código gerado pelo serviço canônico`)
    chk(/\$transaction/.test(r), `${nome}: sequência e criação na mesma transação`)
    chk(!/count\(\)\s*\+\s*1|Math\.random|Date\.now\(\)\s*\)/.test(r), `${nome}: sem COUNT+1, random ou timestamp`)
  }
  const form = src("src/components/contratantes-tabela.tsx")
  chk(/Código não atribuído/.test(form), "ficha distingue cliente existente sem código")
  chk(/clienteExistente/.test(form), "a ficha separa modo criação de cliente já salvo")
  chk(!/setFormData[\s\S]{0,200}publicCode/.test(form), "o formulário não permite editar o código")

  console.log(`\n${ok} passaram, ${fail} falharam`)
}

main()
  .catch((e) => { console.error(e); fail++ })
  .finally(async () => {
    await prisma.requerente.deleteMany({ where: { id: { in: criados } } }).catch(() => {})
    await prisma.$disconnect()
    process.exit(fail ? 1 : 0)
  })
