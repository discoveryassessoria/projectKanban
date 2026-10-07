// scripts/vinculo-requerente-servico-unico.test.ts
// ============================================================================
// O VÍNCULO REQUERENTE × PESSOA × PROCESSO TEM UM DONO SÓ (07/10/2026): `src/services/processo-requerentes.ts`.
//   • guarda de código: nenhum outro arquivo escreve ProcessoRequerente, Requerente.personId ou Pessoa.requerente (marcar/desmarcar);
//   • no banco de teste: o requerente só entra na árvore se estiver no processo dela; a lista do processo é um DIFF que preserva o histórico;
//     quem sai fica com `removidoEm` e a pessoa dele deixa de ser requerente; quem volta é reativado; nada é apagado.
//   node scripts/ci/gate-build.mjs --suite todas --so vinculo-requerente-servico-unico
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "VINCSU"

/** Texto da chamada `...(` até o parêntese que fecha (para olhar o `data` dela). */
function chamada(src: string, ini: number): string {
  let d = 0
  for (let i = src.indexOf("(", ini); i < src.length; i++) {
    if (src[i] === "(") d++
    else if (src[i] === ")" && --d === 0) return src.slice(ini, i + 1)
  }
  return src.slice(ini)
}
const varrer = (dir: string, out: string[] = []): string[] => { for (const n of readdirSync(dir)) { const f = join(dir, n); const st = statSync(f); if (st.isDirectory()) { if (!["node_modules", ".next"].includes(n)) varrer(f, out) } else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) out.push(f) } return out }

async function main() {
  exigirBancoDeTeste("vinculo-requerente-servico-unico.test.ts")

  secao("A) Guarda de código — nenhuma escrita fora do dono único")
  const DONO = "src/services/processo-requerentes.ts"
  const arquivos = [...varrer("src"), ...varrer("lib")].filter((f) => f !== DONO)
  const violacoes: string[] = []
  for (const f of arquivos) {
    const src = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
    for (const m of src.matchAll(/\bprocessoRequerente\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)) violacoes.push(`${f}: processoRequerente.${m[1]}`)
    for (const m of src.matchAll(/\b(?:requerente)\.(update|updateMany|upsert)\(/g)) { const c = chamada(src, m.index!); if (/\bpersonId\b/.test(c)) violacoes.push(`${f}: requerente.${m[1]}(personId)`) }
    for (const m of src.matchAll(/\bpessoa\.(update|updateMany|upsert)\(/g)) { const c = chamada(src, m.index!); if (/\brequerente\s*:/.test(c)) violacoes.push(`${f}: pessoa.${m[1]}(requerente)`) }
    for (const m of src.matchAll(/\bpessoa\.create\(/g)) { const c = chamada(src, m.index!); const v = /\brequerente\s*:\s*([^,}\n]+)/.exec(c); if (v && !/^["'`]nao["'`]$/.test(v[1].trim())) violacoes.push(`${f}: pessoa.create(requerente: ${v[1].trim()})`) }
  }
  ok("nenhum arquivo, fora de processo-requerentes.ts, escreve ProcessoRequerente / Requerente.personId / Pessoa.requerente", violacoes.length === 0, violacoes.join(" | "))
  const dono = readFileSync(DONO, "utf8")
  ok("o dono único existe com as operações do vínculo", ["atualizarRequerentesDoProcesso", "definirPessoaDoRequerente", "definirFlagDaPessoa", "incluirNoProcesso", "retirarDoProcesso", "exigirRequerenteNoProcessoDaArvore"].every((n) => new RegExp(`export (async )?function ${n}`).test(dono)))
  ok("o PUT do processo não apaga mais tudo (deleteMany) — usa o diff do dono", /atualizarRequerentesDoProcesso/.test(readFileSync("src/app/api/processos/[processoId]/route.ts", "utf8")) && !/processoRequerente\.deleteMany/.test(readFileSync("src/app/api/processos/[processoId]/route.ts", "utf8")))

  secao("B) No banco de teste")
  const svc = await import("../src/services/processo-requerentes")
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} proc`, arvoreId: arv.id }, select: { id: true } })
  const outroProc = await prisma.processo.create({ data: { nome: `${MARCA} outro` }, select: { id: true } })
  const mkReq = (n: string) => prisma.requerente.create({ data: { nome: `${MARCA} ${n}`, cpf: `${Math.floor(Math.random() * 1e11)}` } as never, select: { id: true } })
  const mkPes = (n: string) => prisma.pessoa.create({ data: { arvoreId: arv.id, nome: `${MARCA} ${n}`, requerente: "nao" }, select: { id: true } })
  const r1 = await mkReq("Ana"), r2 = await mkReq("Bia"), r3 = await mkReq("Caio")
  const p1 = await mkPes("Ana"), p2 = await mkPes("Bia")
  const erro = async (f: () => Promise<unknown>) => { try { await f(); return null } catch (e) { return e instanceof svc.VinculoRecusado ? e.codigo : `outro:${(e as Error).message}` } }
  const vinc = (processoId: number) => prisma.processoRequerente.findMany({ where: { processoId }, select: { requerenteId: true, removidoEm: true }, orderBy: { requerenteId: "asc" } })
  const ativos = async () => (await vinc(proc.id)).filter((v) => v.removidoEm == null).map((v) => v.requerenteId).sort()

  ok("requerente FORA do processo da árvore não pode apontar para uma pessoa dela (REQUERENTE_FORA_DO_PROCESSO_DA_ARVORE) e nada é gravado", (await erro(() => svc.definirPessoaDoRequerente(prisma, r1.id, p1.id))) === "REQUERENTE_FORA_DO_PROCESSO_DA_ARVORE" && (await prisma.requerente.findUniqueOrThrow({ where: { id: r1.id } })).personId == null)
  ok("o requerente de OUTRO processo (sem esta árvore) também não pode", (await (async () => { await svc.incluirNoProcesso(prisma, outroProc.id, [r1.id]); return erro(() => svc.definirPessoaDoRequerente(prisma, r1.id, p1.id)) })()) === "REQUERENTE_FORA_DO_PROCESSO_DA_ARVORE")
  ok("e a marca de requerente na pessoa também exige o vínculo", (await erro(() => svc.definirFlagDaPessoa(prisma, p1.id, "sim"))) !== null && (await prisma.pessoa.findUniqueOrThrow({ where: { id: p1.id } })).requerente === "nao")

  const l1 = await svc.atualizarRequerentesDoProcesso({ processoId: proc.id, requerenteIds: [r1.id, r2.id] })
  ok("a lista do processo entra por diff (r1 e r2 adicionados)", l1.adicionados.length === 2 && JSON.stringify(await ativos()) === JSON.stringify([r1.id, r2.id].sort()))
  await svc.definirPessoaDoRequerente(prisma, r1.id, p1.id); await svc.definirFlagDaPessoa(prisma, p1.id, "maior")
  await svc.definirPessoaDoRequerente(prisma, r2.id, p2.id); await svc.definirFlagDaPessoa(prisma, p2.id, "sim")
  ok("agora (no processo da árvore) o requerente pode apontar para a pessoa e ela vira requerente", (await prisma.requerente.findUniqueOrThrow({ where: { id: r1.id } })).personId === p1.id && (await prisma.pessoa.findUniqueOrThrow({ where: { id: p1.id } })).requerente === "maior")

  const l2 = await svc.atualizarRequerentesDoProcesso({ processoId: proc.id, requerenteIds: [r1.id, r3.id] })
  const todos = await vinc(proc.id)
  ok("tirar o r2 e pôr o r3 é um DIFF: r1 não é tocado, r2 sai, r3 entra", l2.retirados.join() === String(r2.id) && l2.adicionados.join() === String(r3.id) && JSON.stringify(await ativos()) === JSON.stringify([r1.id, r3.id].sort()))
  ok("quem saiu NÃO foi apagado: o vínculo existe com `removidoEm` (histórico preservado)", todos.some((v) => v.requerenteId === r2.id && v.removidoEm != null))
  ok("a pessoa de quem saiu deixa de ser requerente na árvore (sem «sim» sem vínculo) e o ponteiro de identidade fica", (await prisma.pessoa.findUniqueOrThrow({ where: { id: p2.id } })).requerente === "nao" && (await prisma.requerente.findUniqueOrThrow({ where: { id: r2.id } })).personId === p2.id)
  const l3 = await svc.atualizarRequerentesDoProcesso({ processoId: proc.id, requerenteIds: [r1.id, r2.id, r3.id] })
  ok("quem volta é REATIVADO (não duplica) e a pessoa volta a ser requerente", l3.reativados.join() === String(r2.id) && (await vinc(proc.id)).filter((v) => v.requerenteId === r2.id).length === 1 && (await prisma.pessoa.findUniqueOrThrow({ where: { id: p2.id } })).requerente !== "nao")
  const l4 = await svc.atualizarRequerentesDoProcesso({ processoId: proc.id, requerenteIds: [r1.id, r2.id, r3.id] })
  ok("repetir a mesma lista não muda nada (idempotente)", l4.adicionados.length === 0 && l4.retirados.length === 0 && l4.reativados.length === 0)
  const l5 = await svc.atualizarRequerentesDoProcesso({ processoId: proc.id, requerenteIds: [] })
  ok("esvaziar a lista também preserva tudo (nenhuma linha apagada)", (await vinc(proc.id)).length === 3 && (await ativos()).length === 0 && l5.retirados.length === 3)

  secao("C) INT-004 acusa os quatro casos (controle positivo)")
  const { detectarVinculosDeRequerente, severidadeDaDiferencaDeNome, mesmoNome } = await import("../lib/saude/verificacoes/vinculo-requerente-arvore")
  const antes = (await detectarVinculosDeRequerente()).filter((v) => /VINCSU/.test(v.requerente + (v.pessoa ?? "") + v.processo)).length
  await svc.atualizarRequerentesDoProcesso({ processoId: proc.id, requerenteIds: [r1.id] })
  const edison = await prisma.requerente.create({ data: { nome: `${MARCA} Edison Junior`, cpf: `${Math.floor(Math.random() * 1e11)}` } as never, select: { id: true } })
  const emerson = await prisma.requerente.create({ data: { nome: `${MARCA} Emerson Silva`, cpf: `${Math.floor(Math.random() * 1e11)}` } as never, select: { id: true } })
  await svc.incluirNoProcesso(prisma, proc.id, [edison.id, emerson.id])
  const pEmerson = await mkPes("Emerson Silva"), pEdison = await mkPes("Edison Junior"), pSolta = await mkPes("Solta")
  await svc.definirPessoaDoRequerente(prisma, edison.id, pEmerson.id) // CRUZADO: o requerente Edison aponta para a pessoa Emerson…
  await svc.definirPessoaDoRequerente(prisma, emerson.id, pEdison.id) // …e o Emerson para a pessoa Edison
  await prisma.pessoa.update({ where: { id: pSolta.id }, data: { requerente: "sim" } }) // escrita por fora do dono (controle positivo): marcada sem requerente
  await prisma.requerente.update({ where: { id: r1.id }, data: { personId: null } }) // A: ativo no processo da árvore e sem pessoa
  await prisma.requerente.update({ where: { id: r3.id }, data: { personId: p1.id } }) // r3 está só em outro lugar: aponta para a pessoa desta árvore
  await svc.incluirNoProcesso(prisma, outroProc.id, [r3.id])
  const v = (await detectarVinculosDeRequerente()).filter((x) => /VINCSU/.test(x.requerente + (x.pessoa ?? "") + x.processo))
  const por = (c: string) => v.filter((x) => x.caso === c)
  ok("A — requerente do processo sem pessoa na árvore", por("A").some((x) => x.registroId === r1.id))
  ok("B1 — pessoa marcada como requerente sem requerente ligado", por("B1").some((x) => x.registroId === pSolta.id))
  ok("C — o par trocado (Edison ↔ Emerson) é ERRO nos dois lados", por("C").filter((x) => x.severidade === "ERRO").length >= 2 && por("C").some((x) => /CRUZADO/.test(x.detalhe)))
  ok("D — requerente de um processo ligado a pessoa de árvore de OUTRO processo", por("D").some((x) => x.registroId === r3.id))
  ok("todos os achados têm família, pessoa/requerente e processo por nome (nunca só número)", v.every((x) => x.familia && x.processo && (x.pessoa || x.requerente)))
  ok("grafia (sobrenome a mais, mesma data) é só ALERTA; primeiro nome diferente é ERRO", severidadeDaDiferencaDeNome({ nomeReq: "Daniela Fogli Serpa Gimenez", nomePessoa: "Daniela Fogli Serpa", nascReq: null, nascPessoa: null, trocado: false }) === "ALERTA" && severidadeDaDiferencaDeNome({ nomeReq: "Ana Souza", nomePessoa: "Bia Souza", nascReq: null, nascPessoa: null, trocado: false }) === "ERRO" && mesmoNome("Maria da Silva", "silva Maria"))
  ok("a verificação está registrada (INT-004, ERRO, sem correção automática) e na Saúde do Sistema", /INT-004/.test(readFileSync("lib/saude/verificacoes/vinculo-requerente-arvore.ts", "utf8")) && /correcaoAutomatica: null/.test(readFileSync("lib/saude/verificacoes/vinculo-requerente-arvore.ts", "utf8")) && /vinculo-requerente-arvore/.test(readFileSync("lib/saude/index.ts", "utf8")) && antes >= 0)
  await prisma.requerente.deleteMany({ where: { id: { in: [edison.id, emerson.id] } } })

  // limpeza
  await prisma.processoRequerente.deleteMany({ where: { processoId: { in: [proc.id, outroProc.id] } } })
  await prisma.requerente.deleteMany({ where: { id: { in: [r1.id, r2.id, r3.id] } } })
  await prisma.pessoa.deleteMany({ where: { arvoreId: arv.id } })
  await prisma.processo.deleteMany({ where: { id: { in: [proc.id, outroProc.id] } } })
  await prisma.arvore.delete({ where: { id: arv.id } })

  console.log(`\n${falhou === 0 ? "✅" : "❌"} VÍNCULO REQUERENTE — DONO ÚNICO — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
}
main().catch((e) => { console.log(`  ❌ ERRO: ${String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(-700)}`); process.exit(1) }).finally(() => prisma.$disconnect())
