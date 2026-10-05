// scripts/coleta-orfaos.test.ts — arquivo da coleta sem formulário: relatório, folga de 48 h, exclusão desligada por padrão (storage de MENTIRA).
//   PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/coleta-orfaos.test.ts
import { readFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { classificarObjetosDaColeta, exclusaoLigada, varrerColeta, rodarVarreduraDaColeta, HORAS_DE_FOLGA, VARIAVEL_PARA_APAGAR, type PortasDaColeta, type ObjetoDaColeta } from "@/src/services/coleta/coleta-orfaos"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${x}`) } }
const sem = (p: string) => readFileSync(p, "utf8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n")

const AGORA = new Date("2026-10-06T12:00:00Z")
const h = (horasAtras: number) => new Date(AGORA.getTime() - horasAtras * 3600_000).toISOString()
const obj = (chave: string, horasAtras: number | null, bucket = "priv", tamanho = 100): ObjetoDaColeta => ({ bucket, chave, tamanho, data: horasAtras == null ? null : h(horasAtras) })

/** O storage de mentira: um mapa chave → {bucket, data}; "linhas" = o que o banco de mentira conhece. */
function mundo(objetos: ObjetoDaColeta[], comLinha: string[]) {
  const storage = new Map(objetos.map((o) => [o.chave, { ...o }]))
  const linhas = new Set(comLinha)
  const apagadas: string[] = []
  const portas: PortasDaColeta = {
    listar: async () => [...storage.values()],
    chavesComLinha: async () => new Set(linhas),
    temLinha: async (k) => linhas.has(k),
    dataAtual: async (_b, k) => storage.get(k)?.data ?? null,
    apagar: async (k) => { storage.delete(k); apagadas.push(k) },
    bucketDeEscrita: () => "priv",
  }
  return { storage, linhas, apagadas, portas }
}

async function main() {
  exigirBancoDeTeste("coleta-orfaos.test.ts")

  console.log("a regra: sem linha E mais de 48 h")
  const objetos = [
    obj("privado/coleta/1/a/velho-sem-linha.png", 72),      // entra no relatório
    obj("privado/coleta/1/b/novo-sem-linha.png", 10),       // menos de 48 h: NÃO
    obj("privado/coleta/1/c/velho-com-linha.png", 500),     // tem linha: NUNCA
    obj("privado/coleta/1/d/justo-48h.png", 48),            // exatamente 48 h: ainda protegido (precisa passar de 48)
    obj("privado/coleta/1/e/sem-data.png", null),           // idade desconhecida: protegido
    obj("privado/coleta/1/f/49h.png", 49),                  // passou de 48 h: entra
  ]
  const c = classificarObjetosDaColeta({ objetos, chavesComLinha: new Set(["privado/coleta/1/c/velho-com-linha.png"]), agora: AGORA })
  ok("sem linha e > 48 h → candidato (72 h e 49 h)", c.candidatos.map((o) => o.chave).sort().join() === "privado/coleta/1/a/velho-sem-linha.png,privado/coleta/1/f/49h.png")
  ok("sem linha e < 48 h → protegido; exatamente 48 h → protegido; sem data → protegido", c.protegidosPorIdade.map((o) => o.chave).sort().join() === "privado/coleta/1/b/novo-sem-linha.png,privado/coleta/1/d/justo-48h.png,privado/coleta/1/e/sem-data.png")
  ok("com linha no banco → nunca (mesmo com 500 h)", c.comLinha === 1 && !c.candidatos.some((o) => o.chave.includes("velho-com-linha")))
  ok("a folga é de 48 horas", HORAS_DE_FOLGA === 48)

  console.log("variável de ambiente: DESLIGADA por padrão")
  ok("sem a variável → só relatar", exclusaoLigada({}) === false)
  ok("só o valor exato '1' liga (nada de '0', 'true', 'sim', vazio)", exclusaoLigada({ [VARIAVEL_PARA_APAGAR]: "1" }) === true && ["0", "true", "sim", "", " 1", "ON"].every((v) => exclusaoLigada({ [VARIAVEL_PARA_APAGAR]: v }) === false))

  console.log("modo SÓ RELATAR: lista e NÃO apaga")
  const m1 = mundo(objetos, ["privado/coleta/1/c/velho-com-linha.png"])
  const r1 = await varrerColeta(m1.portas, { agora: AGORA })
  ok("relatório lista os 2 candidatos e conta os 3 protegidos + 1 com linha", r1.modo === "SO_RELATAR" && r1.totais.candidatos === 2 && r1.totais.protegidosPorIdade === 3 && r1.totais.comLinha === 1 && r1.totais.bytesDosCandidatos === 200)
  ok("NADA foi apagado e o storage continua com os 6 objetos", m1.apagadas.length === 0 && m1.storage.size === 6 && r1.apagados.length === 0)

  console.log("modo APAGANDO (só no teste, com storage de mentira)")
  const m2 = mundo(objetos, ["privado/coleta/1/c/velho-com-linha.png"])
  const r2 = await varrerColeta(m2.portas, { agora: AGORA, apagarLigado: true })
  ok("apaga só os 2 candidatos, um por um", r2.modo === "APAGANDO" && m2.apagadas.sort().join() === "privado/coleta/1/a/velho-sem-linha.png,privado/coleta/1/f/49h.png")
  ok("o novo, o de 48 h, o sem data e o com linha continuam lá", ["b/novo-sem-linha", "d/justo-48h", "e/sem-data", "c/velho-com-linha"].every((k) => [...m2.storage.keys()].some((x) => x.includes(k))))

  console.log("reconferência imediatamente antes de apagar")
  const m3 = mundo([obj("privado/coleta/2/x/ganhou-linha.png", 100), obj("privado/coleta/2/y/regravado.png", 100), obj("privado/coleta/2/z/normal.png", 100)], [])
  const portas3: PortasDaColeta = {
    ...m3.portas,
    // entre a listagem e a exclusão: x GANHOU linha (o cliente enviou o formulário) e y foi REGRAVADO (objeto novo)
    listar: async () => { const l = [...m3.storage.values()].map((o) => ({ ...o })); m3.linhas.add("privado/coleta/2/x/ganhou-linha.png"); m3.storage.get("privado/coleta/2/y/regravado.png")!.data = h(1); return l },
    chavesComLinha: async () => new Set(),
  }
  const r3 = await varrerColeta(portas3, { agora: AGORA, apagarLigado: true })
  ok("ganhou linha entre a lista e a exclusão → pulado, NÃO apagado", r3.pulados.some((p) => p.chave.includes("ganhou-linha") && /linha/.test(p.motivo)) && !m3.apagadas.some((k) => k.includes("ganhou-linha")))
  ok("regravado (objeto novo) → pulado, NÃO apagado", r3.pulados.some((p) => p.chave.includes("regravado")) && !m3.apagadas.some((k) => k.includes("regravado")))
  ok("o normal foi apagado", m3.apagadas.join() === "privado/coleta/2/z/normal.png")

  console.log("falha de um objeto não derruba a rotina; cópia no público só é relatada")
  const m4 = mundo([obj("privado/coleta/3/a/falha.png", 100), obj("privado/coleta/3/b/ok.png", 100), obj("privado/coleta/3/c/no-publico.png", 100, "pub")], [])
  const portas4: PortasDaColeta = { ...m4.portas, apagar: async (k) => { if (k.includes("falha")) throw new Error("negado"); await m4.portas.apagar(k) } }
  const r4 = await varrerColeta(portas4, { agora: AGORA, apagarLigado: true })
  ok("a falha é registrada e a rotina segue", r4.falhas.length === 1 && r4.falhas[0].chave.includes("falha") && m4.apagadas.join() === "privado/coleta/3/b/ok.png")
  ok("objeto `privado/` que está no bucket PÚBLICO (plano B) não é apagado por esta rotina", r4.pulados.some((p) => p.chave.includes("no-publico") && /público/.test(p.motivo)) && m4.storage.has("privado/coleta/3/c/no-publico.png"))

  console.log("a rotina inteira: grava o relatório na auditoria e, sem a variável, não apaga")
  const m5 = mundo([obj("privado/coleta/9/a/x.png", 100)], [])
  const antes = await prisma.logAuditoria.count({ where: { acao: "coleta_orfaos_relatorio" } })
  const r5 = await rodarVarreduraDaColeta(m5.portas, {})
  const depois = await prisma.logAuditoria.count({ where: { acao: "coleta_orfaos_relatorio" } })
  ok("relatório gravado na auditoria; modo SO_RELATAR; nada apagado", depois === antes + 1 && r5.modo === "SO_RELATAR" && m5.apagadas.length === 0 && m5.storage.size === 1)
  const r6 = await rodarVarreduraDaColeta(m5.portas, { [VARIAVEL_PARA_APAGAR]: "1" })
  ok("com a variável '1' (só neste teste, storage de mentira) apaga", r6.modo === "APAGANDO" && m5.apagadas.length === 1)
  await prisma.logAuditoria.deleteMany({ where: { acao: "coleta_orfaos_relatorio", entidade: "ColetaArquivo" } })

  console.log("estático: cron e configuração")
  const cod = sem("src/services/coleta/coleta-orfaos.ts")
  ok("nada de regra de ciclo de vida do R2 (PutBucketLifecycle…)", !/Lifecycle/i.test(cod))
  ok("o padrão do código é SÓ RELATAR (exclusão só com a variável)", /exclusaoLigada\(env\)/.test(cod) && /env\[VARIAVEL_PARA_APAGAR\] === "1"/.test(cod))
  ok("a variável NÃO está ligada em nenhum arquivo do repositório (vercel.json, .env.example)", !/COLETA_ORFAOS_APAGAR/.test(readFileSync("vercel.json", "utf8")) && !(() => { try { return /COLETA_ORFAOS_APAGAR\s*=\s*1/.test(readFileSync(".env.example", "utf8")) } catch { return false } })())
  const vj = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> }
  ok("cron DIÁRIO registrado e liberado no middleware", vj.crons.some((c) => c.path === "/api/cron/coleta-orfaos" && /^\d+ \d+ \* \* \*$/.test(c.schedule)) && readFileSync("middleware.ts", "utf8").includes('"/api/cron/coleta-orfaos"'))
  ok("o cron se auto-verifica (CRON_SECRET / x-vercel-cron)", /x-vercel-cron/.test(sem("src/app/api/cron/coleta-orfaos/route.ts")) && /CRON_SECRET/.test(sem("src/app/api/cron/coleta-orfaos/route.ts")))

  await prisma.$disconnect()
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  process.exit(falhou ? 1 : 0)
}
void main()
