// scripts/processo-arquivos-orfaos.test.ts — regras PURAS do ponto (b) e do conferidor semanal (sem banco, sem storage).
//   npx tsx scripts/processo-arquivos-orfaos.test.ts
import { readFileSync } from "node:fs"
import { chaveDeUrlOuChave, montarLevantamento, apagarChavesComNovaTentativa } from "../src/services/processo-arquivos"
import { compararObjetosComReferencias, FONTES_DE_CHAVES, NOTA_DO_RELATORIO } from "../src/services/conferidor-orfaos"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${x}`) } }
const f = (p: string) => readFileSync(p, "utf8")
const sem = (p: string) => f(p).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n")
const BASE = "https://pub-abc.r2.dev"

async function main() {
  console.log("chave a partir de endereço ou chave")
  ok("endereço público → chave (decodificada, sem query)", chaveDeUrlOuChave(`${BASE}/documentos/12/a%20b.pdf?x=1`, BASE) === "documentos/12/a b.pdf")
  ok("chave pura fica como está", chaveDeUrlOuChave("privado/coleta/3/u/rg.png", BASE) === "privado/coleta/3/u/rg.png")
  ok("endereço de OUTRO serviço não é nosso (null)", chaveDeUrlOuChave("https://utfs.io/f/abc", BASE) === null)
  ok("vazio → null", chaveDeUrlOuChave("  ", BASE) === null && chaveDeUrlOuChave(null, BASE) === null)

  console.log("levantamento")
  const lev = montarLevantamento({
    urlPublica: BASE,
    linhas: [
      { fonte: "COLETA", id: 1, valor: "privado/coleta/3/u/rg.png" },
      { fonte: "ANEXO_PROCESSO", id: 2, valor: `${BASE}/documentos/9/a.pdf` },
      { fonte: "ANEXO_PROTOCOLO", id: 3, valor: `${BASE}/documentos/9/a.pdf` },       // mesma chave: conta uma vez
      { fonte: "DOCUMENTO_FINANCEIRO", id: 4, valor: "https://utfs.io/f/x" },          // externo
      { fonte: "RECIBO", id: 5, valor: null },                                          // sem arquivo
    ],
    documentosFinanceirosSemCascata: [4], geradosPreservados: [{ documentoGeradoId: 7, versoes: 2 }],
  })
  ok("chaves únicas: 2 (a duplicada conta uma vez)", lev.arquivos.length === 2 && lev.arquivos.map((a) => a.chave).sort().join() === "documentos/9/a.pdf,privado/coleta/3/u/rg.png")
  ok("externo registrado, sem arquivo ignorado", lev.externos.length === 1 && lev.externos[0].id === 4)
  ok("documentos gerados vão como PRESERVADOS (nunca como arquivos a apagar)", lev.geradosPreservados.length === 1 && !lev.arquivos.some((a) => /documento_gerado/i.test(a.fonte)))

  console.log("apagar com nova tentativa")
  const noStorage = new Set(["a", "b", "c"])
  let falhasDeB = 0
  const r = await apagarChavesComNovaTentativa(["a", "b", "c", "a"], async (k) => { if (k === "b" && falhasDeB++ < 2) throw new Error("rede"); noStorage.delete(k) }, { esperaMs: 1 })
  ok("falhou 2x e na 3ª apagou; chave repetida só uma vez", r.apagadas.sort().join() === "a,b,c" && r.falhas.length === 0 && noStorage.size === 0)
  const r2 = await apagarChavesComNovaTentativa(["x", "y"], async (k) => { if (k === "x") throw new Error("negado") }, { tentativas: 3, esperaMs: 1 })
  ok("falha PERSISTENTE é devolvida (3 tentativas) e não impede as outras", r2.falhas.length === 1 && r2.falhas[0].chave === "x" && r2.falhas[0].tentativas === 3 && r2.apagadas.join() === "y")

  console.log("conferidor — comparação")
  const ob = (chave: string, tamanho = 10) => ({ chave, tamanho, data: null })
  const rel = compararObjetosComReferencias({
    buckets: { publico: "pub", privado: "priv" },
    chavesReferenciadas: new Set(["documentos/1/a.pdf", "privado/documentos/m/x.docx", "privado/documentos/g/falta.pdf"]),
    objetos: {
      publico: [ob("documentos/1/a.pdf"), ob("documentos/sobra.jpg", 500), ob("privado/documentos/m/x.docx"), ob("backup-algo/doc.pdf")],
      privado: [ob("privado/documentos/m/x.docx"), ob("privado/coleta/9/u/orfao.png", 70), ob("backup-reset-antao/doc.pdf")],
    },
  })
  ok("órfãos: só o que nenhuma linha referencia (1 em cada bucket), com bytes somados", rel.orfaos.length === 2 && rel.bytesOrfaos === 570 && rel.orfaos.map((o) => `${o.bucket}:${o.chave}`).sort().join() === "privado:privado/coleta/9/u/orfao.png,publico:documentos/sobra.jpg")
  ok("referência sem objeto: a chave que ninguém tem", rel.referenciasSemObjeto.join() === "privado/documentos/g/falta.pdf")
  ok("cópia legada: privado/ ainda no público (plano B) é listada à parte, não é órfã", rel.copiasLegadasNoPublico.join() === "privado/documentos/m/x.docx")
  ok("backup intencional não é órfão (2 contados)", rel.backupsIntencionais === 2 && !rel.orfaos.some((o) => o.chave.startsWith("backup-")))
  ok("o relatório diz que NÃO apaga", rel.nota === NOTA_DO_RELATORIO && /Nada foi apagado/.test(rel.nota))

  console.log("conferidor — nunca apaga (estático)")
  const conf = sem("src/services/conferidor-orfaos.ts") + sem("src/app/api/cron/conferidor-orfaos/route.ts")
  ok("nenhuma exclusão no conferidor nem no cron (DeleteObject, removerObjeto, apagar*, .delete/.deleteMany, DELETE FROM)", !/DeleteObject|removerObjeto|apagarChaves|apagarObjeto|\.delete\(|\.deleteMany\(|DELETE FROM|DeleteObjectsCommand/i.test(conf))
  ok("só SELECT no banco (a única consulta crua é SELECT)", [...conf.matchAll(/\$queryRawUnsafe[^`]*`([^`]*)`/g)].every((m) => /^\s*SELECT/i.test(m[1])))

  console.log("conferidor — não pode ficar cego para coluna de arquivo nova")
  const schema = f("prisma/schema.prisma").split("\n")
  const achadas: string[] = []
  let modelo = ""
  for (const l of schema) {
    const m = l.match(/^model (\w+) \{/); if (m) { modelo = m[1]; continue }
    const c = l.match(/^\s+(urlArquivo|arquivoUrl|arquivoChave|docxChave|pdfChave|pdfUrl)\s+String/)
    const g = l.match(/^\s+(url|chave)\s+String/)
    if (c || (g && /Arquivo|Anexo/.test(modelo))) achadas.push(`${modelo}.${(c ?? g)![1]}`)
  }
  const registradas = new Set(FONTES_DE_CHAVES.map((x) => `${x.tabela}.${x.coluna}`))
  ok("toda coluna de arquivo do schema está em FONTES_DE_CHAVES", achadas.every((a) => registradas.has(a)), achadas.filter((a) => !registradas.has(a)).join(", "))
  ok("e toda fonte registrada existe no schema", [...registradas].every((r) => achadas.includes(r)), [...registradas].filter((r) => !achadas.includes(r)).join(", "))

  console.log("cron semanal")
  const vj = JSON.parse(f("vercel.json")) as { crons: Array<{ path: string; schedule: string }> }
  const cron = vj.crons.find((c) => c.path === "/api/cron/conferidor-orfaos")
  ok("cron semanal registrado (1x por semana) e liberado no middleware", !!cron && /^\d+ \d+ \* \* \d$/.test(cron.schedule) && f("middleware.ts").includes('"/api/cron/conferidor-orfaos"'))

  console.log("a exclusão levanta ANTES e apaga DEPOIS do commit (estático)")
  const ciclo = sem("src/services/processo-ciclo-vida.ts")
  const iLev = ciclo.indexOf("levantarArquivosDoProcesso(input.processoId, tx)"), iDel = ciclo.indexOf("tx.processo.delete("), iFim = ciclo.indexOf("apagarArquivosDoProcessoExcluido(input, lev)")
  ok("levantar < apagar a linha do processo < apagar os objetos", iLev > 0 && iLev < iDel && iDel < iFim)
  ok("as chaves vão para a auditoria da exclusão e o apagar nunca lança", ciclo.includes("arquivosNoStorage") && /catch \(e\) \{[\s\S]*falhas: lev\.arquivos\.map/.test(ciclo))
  console.log(`\n${passou} ok, ${falhou} falhas`)
  process.exit(falhou ? 1 : 0)
}
void main()
