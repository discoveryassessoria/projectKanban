// scripts/identidade-canonica-cobertura.ts
//
// PROVA DE COBERTURA das identidades canônicas.
//
// "FK criada" não é migração concluída. Este script responde, contra o banco
// REAL, a única pergunta que importa antes de tornar um vínculo obrigatório:
// existe alguma linha que a identidade canônica não sabe resolver?
//
//   npx tsx scripts/identidade-canonica-cobertura.ts
import { prisma } from "../src/lib/prisma"

async function main() {
  const q = (sql: string) => prisma.$queryRawUnsafe<any[]>(sql)
  const n = async (sql: string) => Number((await q(sql))[0]?.n ?? 0)
  let falhas = 0
  const linha = async (nome: string, total: string, semFk: string) => {
    const t = await n(total)
    const s = await n(semFk)
    const cobertura = t === 0 ? 100 : Math.round(((t - s) / t) * 1000) / 10
    const ok = s === 0
    if (!ok) falhas++
    console.log(`  ${ok ? "✅" : "❌"} ${nome.padEnd(42)} ${String(t).padStart(6)} linhas · ${cobertura}% · sem identidade: ${s}`)
  }

  console.log("COBERTURA DA IDENTIDADE CANÔNICA\n")
  await linha("Processo → CatalogoPais (identidade única)",
    `SELECT COUNT(*)::int n FROM "Processo"`,
    `SELECT COUNT(*)::int n FROM "Processo" WHERE "paisId" IS NULL`)
  // A identidade do tipo documental JÁ EXISTIA como `documentTypeId` (dual-write
  // desde antes desta migração). Criar outra coluna teria sido a terceira fonte.
  await linha("Documento.tipo → TipoDocumentoCadastro",
    `SELECT COUNT(*)::int n FROM "Documento" WHERE tipo IS NOT NULL`,
    `SELECT COUNT(*)::int n FROM "Documento" WHERE tipo IS NOT NULL AND "documentTypeId" IS NULL`)
  await linha("Solicitacao.canal → CanalOperacional",
    `SELECT COUNT(*)::int n FROM "SolicitacaoDocumento"`,
    `SELECT COUNT(*)::int n FROM "SolicitacaoDocumento" WHERE "canalOperacionalId" IS NULL`)
  await linha("MatrizDocumental → TipoDocumentoCadastro",
    `SELECT COUNT(*)::int n FROM "MatrizDocumental"`,
    `SELECT COUNT(*)::int n FROM "MatrizDocumental" WHERE "documentoTipoId" IS NULL`)
  await linha("MatrizDocumental → TipoProcesso",
    `SELECT COUNT(*)::int n FROM "MatrizDocumental"`,
    `SELECT COUNT(*)::int n FROM "MatrizDocumental" WHERE "tipoProcessoRefId" IS NULL`)

  // DIVERGÊNCIA ESPELHO × IDENTIDADE. Enquanto a string existir, ela precisa
  // CONCORDAR com a FK — no dia em que discordarem, a fonte de verdade virou
  // uma questão de opinião, que é exatamente o que esta arquitetura proíbe.
  console.log("\nEspelho concorda com a identidade:")
  const div = async (nome: string, sql: string) => {
    const d = await n(sql)
    if (d > 0) falhas++
    console.log(`  ${d === 0 ? "✅" : "❌"} ${nome} — divergentes: ${d}`)
  }
  // A COLUNA ESPELHO NÃO EXISTE MAIS — e este guard prova isso contra o banco,
  // não contra o schema: recriá-la (por migration manual, por engano ou por
  // "compatibilidade") volta a falhar aqui.
  await div("coluna legada Processo.pais não existe",
    `SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_name = 'Processo' AND column_name = 'pais'`)
  // AS OUTRAS IDENTIDADES TEXTUAIS DE PAÍS TAMBÉM NÃO PODEM VOLTAR.
  // `Status.pais` era a segunda fonte, `Tarefa.pais` a terceira — nenhuma das
  // duas era um conceito diferente: guardavam a nacionalidade do trabalho em
  // texto, ao lado do Cadastro Mestre.
  await div("coluna legada Status.pais não existe",
    `SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_name = 'Status' AND column_name = 'pais'`)
  await div("coluna legada Tarefa.pais não existe",
    `SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_name = 'Tarefa' AND column_name = 'pais'`)
  await div("Status aponta para o cadastro (FK)",
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Status' AND column_name='paisId') THEN 0 ELSE 1 END n`)
  await div("trigger do espelho não existe",
    `SELECT COUNT(*)::int n FROM pg_trigger WHERE tgrelid = '"Processo"'::regclass AND NOT tgisinternal AND tgname ILIKE '%pais%'`)
  await div("Documento.tipo × legacyEnumKey",
    `SELECT COUNT(*)::int n FROM "Documento" d JOIN "TipoDocumentoCadastro" t ON t.id = d."documentTypeId" WHERE d.tipo IS NOT NULL AND t."legacyEnumKey" IS DISTINCT FROM d.tipo::text`)
  await div("Solicitacao.canal × CanalOperacional.key",
    `SELECT COUNT(*)::int n FROM "SolicitacaoDocumento" s JOIN "CanalOperacional" c ON c.id = s."canalOperacionalId" WHERE c.key <> s.canal::text`)
  await div("MatrizDocumental.documentTypeCode × code",
    `SELECT COUNT(*)::int n FROM "MatrizDocumental" m JOIN "TipoDocumentoCadastro" t ON t.id = m."documentoTipoId" WHERE t.code <> m."documentTypeCode"`)

  // ── GUARD DE REGRESSÃO ────────────────────────────────────────────────
  // A cobertura pode estar perfeita hoje e a fonte paralela voltar amanhã por
  // um writer novo. Estas verificações olham o CÓDIGO, não o banco.
  console.log("\nNenhum writer novo grava a string sem a identidade:")
  const { readFileSync, readdirSync, statSync } = await import("fs")
  const { join, dirname } = await import("path")
  const { fileURLToPath } = await import("url")
  const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
  const varrer = (dir: string, out: string[] = []): string[] => {
    let itens: string[] = []
    try { itens = readdirSync(join(RAIZ, dir)) } catch { return out }
    for (const f of itens) {
      const rel = `${dir}/${f}`
      if (statSync(join(RAIZ, rel)).isDirectory()) varrer(rel, out)
      else if (rel.endsWith(".ts") || rel.endsWith(".tsx")) out.push(rel)
    }
    return out
  }
  const fontes = [...varrer("src"), ...varrer("lib")]
  const semComentario = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

  // Quem grava `pais:` num create de Processo tem de gravar `paisId` junto.
  const writersProcesso = fontes.filter((f) => {
    const src = semComentario(readFileSync(join(RAIZ, f), "utf8"))
    if (!/(prisma|tx)\.processo\.create/.test(src)) return false
    return /\bpais:\s/.test(src) && !/\bpaisId:\s/.test(src)
  })
  const okGuard = (cond: boolean, nome: string) => {
    if (!cond) falhas++
    console.log(`  ${cond ? "✅" : "❌"} ${nome}`)
  }
  okGuard(writersProcesso.length === 0,
    `todo create de Processo grava paisId${writersProcesso.length ? ` (falta em: ${writersProcesso.join(", ")})` : ""}`)

  // Nenhum filtro de negócio comparando país por texto fora do resolvedor.
  const filtrosPorTexto = fontes.filter((f) => {
    if (f.includes("identidade/canonica")) return false
    const src = semComentario(readFileSync(join(RAIZ, f), "utf8"))
    return /pais\s*===\s*["'`](espanha|italia|it[áa]lia|portugal|alemanha)["'`]/i.test(src)
  })
  okGuard(filtrosPorTexto.length === 0,
    `nenhuma comparação de país por nome${filtrosPorTexto.length ? ` (${filtrosPorTexto.join(", ")})` : ""}`)

  // NENHUMA LISTA LOCAL DE PAÍSES. Três mapas fixos existiam — todos em
  // MAIÚSCULAS, comparados contra o valor que o banco grava em minúsculas: não
  // falhavam, devolviam vazio. País novo cadastrado nunca apareceria.
  // O QUE ESTE GUARD PROÍBE, E O QUE ELE NÃO PROÍBE.
  //
  // Proíbe ENUMERAR o universo de países em código — array de chaves ou mapa
  // percorrido com Object.keys/entries. É isso que faz um país cadastrado novo
  // nunca aparecer, e foi assim que a quebra por país do Receber ficou zerada.
  //
  // NÃO proíbe dicionário de APRESENTAÇÃO ou de PARSING consultado por chave:
  // o adjetivo pátrio ("português") e o dicionário de variantes textuais que a
  // genealogia usa para ler certidão ("REGNO D ITALIA") são linguagem, não
  // cadastro. Transformar isso em tabela seria criar cadastro inútil.
  const EXCECOES_DE_LINGUAGEM = ["identidade/canonica", "migracao-motor", "MigracaoMotorTab",
    "genealogia/motor/regras/linhagem", "arvore/tree-onboarding"]
  const listasLocais = fontes.filter((f) => {
    if (EXCECOES_DE_LINGUAGEM.some((e) => f.includes(e))) return false
    const src = semComentario(readFileSync(join(RAIZ, f), "utf8"))
    const enumeraEmArray = /\[\s*["'](ITALIA|ESPANHA|PORTUGAL|ALEMANHA)["']\s*,/i.test(src)
    const mapaDePais = /\b(PORTUGAL|ESPANHA|ALEMANHA|ITALIA)\s*:\s*["']/.test(src)
    const percorreMapa = /Object\.(keys|entries|values)\s*\(\s*PAIS/.test(src)
    return enumeraEmArray || (mapaDePais && percorreMapa)
  })
  okGuard(listasLocais.length === 0,
    `nenhuma lista local de países${listasLocais.length ? ` (${listasLocais.join(", ")})` : ""}`)

  // FILTRO DE PROCESSO POR PAÍS usa o resolvedor de identidade, não `{ pais }`.
  const filtroCru = fontes.filter((f) => {
    if (f.includes("identidade/canonica")) return false
    const src = semComentario(readFileSync(join(RAIZ, f), "utf8"))
    return /where[^\n]*\.processo\s*=\s*\{\s*pais\s*\}/.test(src)
      || /processo:\s*\{\s*pais\s*\}/.test(src)
  })
  okGuard(filtroCru.length === 0,
    `nenhum filtro de processo por texto de país${filtroCru.length ? ` (${filtroCru.join(", ")})` : ""}`)

  console.log(falhas === 0
    ? "\n✅ Cobertura total. A identidade canônica resolve todas as linhas."
    : `\n❌ ${falhas} verificação(ões) falharam — NÃO tornar o vínculo obrigatório.`)
  process.exit(falhas === 0 ? 0 : 1)
}
main()
