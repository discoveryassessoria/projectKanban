// scripts/casamento-dono-unico.test.ts
// Caso Fogli (08/10/2026): o dono da certidão de casamento é o cônjuge da linha reta que a MANTÉM; pessoa dispensada não herda a união; reapontar muda SÓ o titular.
import { readFileSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { titularDaUniao } from "../src/services/genealogia/titular-uniao"
import { reapontarDonoDoCasamento, casamentosForaDoDono } from "../src/services/genealogia/dono-casamento"
import { garantirNecessidade } from "../src/services/necessidade-documental"
import { projetarIndicadores } from "../src/lib/genealogia/documental/indicadores"
import { indicadorDaPessoa } from "../src/lib/genealogia/documental/indicadores"

let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }
const C = (linhaReta: boolean, documentacao: boolean, documentosExigidos: string[] | null) => ({ linhaReta, documentacao, documentosExigidos }) as never

async function main() {
  exigirBancoDeTeste("casamento-dono-unico.test.ts")

  console.log("\n1) A regra pura")
  const u = (a: unknown, b: unknown) => ({ pessoa1Id: 1, pessoa2Id: 2, pessoa1: a, pessoa2: b }) as never
  ok("Fogli: Sebastião (fora, sem documentação) + Ilaine (linha reta, NAS+CAS) → Ilaine", titularDaUniao(u(C(false, false, null), C(true, true, ["NAS", "CAS"]))) === 2)
  ok("o lado gravado não importa: invertido também → Ilaine", titularDaUniao({ pessoa1Id: 2, pessoa2Id: 1, pessoa1: C(true, true, ["NAS", "CAS"]), pessoa2: C(false, false, null) } as never) === 2)
  ok("linha reta que NÃO mantém o casamento (só NAS) e o outro cônjuge com documentação que mantém → o outro", titularDaUniao(u(C(true, true, ["NAS"]), C(false, true, null))) === 2)
  ok("fora da linha com documentação ligada e CAS mantém, linha reta mantém → a linha reta", titularDaUniao(u(C(true, true, null), C(false, true, null))) === 1)
  ok("sem dados dos cônjuges (leitura antiga) → comportamento anterior (linha reta primeiro)", titularDaUniao({ pessoa1Id: 1, pessoa2Id: 2, pessoa1: { linhaReta: false }, pessoa2: { linhaReta: true } } as never) === 2)

  console.log("\n2) O painel: pessoa dispensada não herda a união; dossiê conta recebida E validada")
  const nec = (o: Record<string, unknown>) => ({ id: 1, status: "ATENDIDA", obrigatoriedade: "OBRIGATORIA", ...o }) as never
  const proj = projetarIndicadores([nec({ id: 10, uniaoId: 500, donoId: 2, certidao: { recebida: true, validada: true } })])
  ok("o dono (2) conta o casamento; o dispensado (1) não", indicadorDaPessoa(proj, 2, [500]).necessarias === 1 && indicadorDaPessoa(proj, 1, [500]).necessarias === 0)
  const proj2 = projetarIndicadores([nec({ id: 11, pessoaId: 2, certidao: { recebida: true, validada: false } }), nec({ id: 12, pessoaId: 2, certidao: null })])
  const ind = indicadorDaPessoa(proj2, 2, [])
  ok("registro localizado + certidão NÃO validada = em atendimento (não 100%); sem documento operacional segue atendida", ind.atendidas === 1 && ind.emAtendimento === 1 && ind.progresso === 50, JSON.stringify(ind))

  const soDispensada = projetarIndicadores([nec({ id: 20, pessoaId: 9, status: "DISPENSADA" })])
  const indD = indicadorDaPessoa(soDispensada, 9, [])
  ok("pessoa com SÓ necessidade dispensada = «sem exigência» (não «100% do dossiê»)", indD.progresso === null && indD.situacao === "sem_exigencia", JSON.stringify(indD))

  console.log("\n3) Banco: reapontar muda SÓ o titular")
  const c = await montarCenario("CASDONO")
  try {
    const o = await c.novaObrigacao()
    const proc = await prisma.processo.findUniqueOrThrow({ where: { id: o.processoId }, select: { arvoreId: true } })
    const arv = proc.arvoreId!
    const mk = (nome: string, extra: Record<string, unknown>) => prisma.pessoa.create({ data: { arvoreId: arv, nome, sobrenome: "Teste", requerente: "nao", ...extra } as never, select: { id: true } })
    const seb = await mk("Sebastiao", { linhaReta: false, documentacao: false })
    const ila = await mk("Ilaine", { linhaReta: true, documentacao: true, documentosExigidos: ["NAS", "CAS"], casado: true })
    const uniao = await prisma.uniao.create({ data: { pessoa1Id: seb.id, pessoa2Id: ila.id }, select: { id: true } })
    await prisma.itemCatalogo.deleteMany({ where: { code: "CASDONO_ITEM" } })
    const item = await prisma.itemCatalogo.create({ data: { code: "CASDONO_ITEM", name: "Certidão de Casamento - Inteiro Teor", natureza: "DOCUMENTO" }, select: { id: true } })
    const { necessidade } = await garantirNecessidade({ processoId: o.processoId, itemCatalogoId: item.id, uniaoId: uniao.id, varianteKey: "t:cas", origem: "MANUAL", obrigatoriedade: "OBRIGATORIA" })
    const docAberto = await prisma.documento.create({ data: { pessoaId: seb.id, necessidadeId: necessidade.id, status: "PENDENTE", origem: "automatica" } as never, select: { id: true } })
    const tAberta = await prisma.tarefa.create({ data: { titulo: "Certidão de casamento - Inteiro Teor · Sebastiao Teste", processoId: o.processoId, pessoaId: seb.id, documentoId: docAberto.id, necessidadeId: necessidade.id, statusTarefa: "NAO_INICIADA", faseMacroKey: c.PHASE_KEY, origem: "MANUAL", chaveIdempotencia: "casdono-aberta" } as never, select: { id: true } })
    const fora0 = await casamentosForaDoDono(o.processoId)
    ok("antes: o casamento está fora do dono", fora0.length === 1 && fora0[0].pessoaId === seb.id && fora0[0].donoId === ila.id)

    // documento JÁ recebido e validado (o caso 2368): só o titular pode mudar
    const docRecebido = await prisma.documento.create({ data: { pessoaId: seb.id, necessidadeId: necessidade.id, status: "RECEBIDO", origem: "automatica" } as never, select: { id: true } })
    const tConcluida = await prisma.tarefa.create({ data: { titulo: "Certidão de casamento (concluída)", processoId: o.processoId, pessoaId: seb.id, documentoId: docRecebido.id, statusTarefa: "CONCLUIDO_RECEBIDO", faseMacroKey: c.PHASE_KEY, origem: "MANUAL", chaveIdempotencia: "casdono-concl", dataConclusao: new Date() } as never, select: { id: true, dataConclusao: true } })
    const antes = await prisma.documento.findUniqueOrThrow({ where: { id: docRecebido.id }, select: { status: true, updatedAt: true } })

    const r1 = await reapontarDonoDoCasamento(o.processoId, prisma, { motivo: "teste", autorizadoPor: "Marco" })
    ok("reapontou os dois documentos para a Ilaine", r1.length === 2 && r1.every((x) => x.para.id === ila.id))
    const da = await prisma.documento.findUniqueOrThrow({ where: { id: docAberto.id }, select: { pessoaId: true } })
    const dr = await prisma.documento.findUniqueOrThrow({ where: { id: docRecebido.id }, select: { pessoaId: true, status: true } })
    ok("o titular mudou nos dois", da.pessoaId === ila.id && dr.pessoaId === ila.id)
    ok("documento recebido: STATUS intacto", dr.status === antes.status && dr.status === "RECEBIDO")
    const ta = await prisma.tarefa.findUniqueOrThrow({ where: { id: tAberta.id }, select: { pessoaId: true, titulo: true } })
    ok("tarefa aberta acompanhou (pessoa e nome no título)", ta.pessoaId === ila.id && ta.titulo.endsWith("· Ilaine Teste"), ta.titulo)
    const tc = await prisma.tarefa.findUniqueOrThrow({ where: { id: tConcluida.id }, select: { pessoaId: true, statusTarefa: true, dataConclusao: true, titulo: true } })
    ok("tarefa concluída: intocada (pessoa, status, data, título)", tc.pessoaId === seb.id && tc.statusTarefa === "CONCLUIDO_RECEBIDO" && tc.dataConclusao?.getTime() === tConcluida.dataConclusao?.getTime() && tc.titulo === "Certidão de casamento (concluída)")
    const log = await prisma.logAuditoria.findFirst({ where: { acao: "CASAMENTO_DONO_REAPONTADO", entidadeId: docAberto.id } })
    ok("histórico registra de/para, motivo e autorização", !!log && /Sebastiao Teste/.test(log.descricao) && /Ilaine Teste/.test(log.descricao) && /Autorizado por Marco/.test(log.descricao))
    ok("idempotente: rodar de novo não escreve nada", (await reapontarDonoDoCasamento(o.processoId, prisma)).length === 0 && (await casamentosForaDoDono(o.processoId)).length === 0)
  } finally {
    await prisma.logAuditoria.deleteMany({ where: { acao: "CASAMENTO_DONO_REAPONTADO", descricao: { contains: "Teste" } } })
    await prisma.tarefa.deleteMany({ where: { chaveIdempotencia: { in: ["casdono-aberta", "casdono-concl"] } } })
    await prisma.documento.deleteMany({ where: { necessidade: { varianteKey: "t:cas" } } })
    await prisma.necessidadeDocumental.deleteMany({ where: { varianteKey: "t:cas" } })
    await c.limpar()
    await prisma.itemCatalogo.deleteMany({ where: { code: "CASDONO_ITEM" } })
    await prisma.$disconnect()
  }

  console.log("\n4) Fiação")
  const ler = (f: string) => readFileSync(f, "utf8")
  ok("materializar reaponta o dono a cada reconciliação", /reapontarDonoDoCasamento\(processoId, db/.test(ler("src/services/genealogia/materializar-genealogia.ts")))
  ok("o endpoint do painel entrega o dono e a etapa real da certidão", /donoId: n\.uniaoId != null \? titularDaUniao/.test(ler("src/app/api/processos/[processoId]/genealogia/operacional/route.ts")) && /certidao: etapaDe\(n\)/.test(ler("src/app/api/processos/[processoId]/genealogia/operacional/route.ts")))
  ok("vigia 'o' registrado", /detectarRegraO/.test(ler("lib/saude/verificacoes/regras-do-marco.ts")))
  console.log(`\n${n - falhou}/${n} verificações`)
  if (falhou > 0) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })
