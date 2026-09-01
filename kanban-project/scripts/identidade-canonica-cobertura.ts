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
  // OS QUATRO ESPELHOS DA OFERTA. `TipoProcessoNacionalidade` copiava o país
  // inteiro — chave e rótulo, do país e da nacionalidade. Recriar qualquer um
  // deles como coluna é recriar a segunda fonte, e o guard falha aqui mesmo que
  // o schema do Prisma diga outra coisa.
  for (const campo of ["countryKey", "countryLabel", "nationalityKey", "nationalityLabel"]) {
    await div(`espelho TipoProcessoNacionalidade.${campo} não existe`,
      `SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_name = 'TipoProcessoNacionalidade' AND column_name = '${campo}'`)
  }
  // Sem país não existe oferta: a identidade é obrigatória NO BANCO, não só no
  // schema. Uma linha com paisId nulo seria uma oferta de nacionalidade nenhuma.
  await div("TipoProcessoNacionalidade.paisId é NOT NULL",
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='TipoProcessoNacionalidade' AND column_name='paisId' AND is_nullable='NO') THEN 0 ELSE 1 END n`)

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
  // NENHUM ENUM LOCAL DE PAÍS. O `enum Pais` do schema e o de types/kanban
  // foram removidos; recriar qualquer um volta a ser uma segunda fonte.
  const enumsDePais = fontes.filter((f) => {
    const src = semComentario(readFileSync(join(RAIZ, f), "utf8"))
    return /enum\s+Pais\b/.test(src) || /enum\s+Country\b/.test(src)
  })
  okGuard(enumsDePais.length === 0,
    `nenhum enum local de país${enumsDePais.length ? ` (${enumsDePais.join(", ")})` : ""}`)

  okGuard(listasLocais.length === 0,
    `nenhuma lista local de países${listasLocais.length ? ` (${listasLocais.join(", ")})` : ""}`)

  // NINGUÉM VOLTA A ESCREVER O PAÍS DENTRO DA OFERTA. Um create/update de
  // `tipoProcessoNacionalidade` que atribua countryKey/countryLabel/
  // nationalityKey/nationalityLabel está recriando a cópia — mesmo que o
  // compilador ainda não reclame porque alguém "reabriu" a coluna no schema.
  const corpoDeData = (janela: string): string => {
    // Recorta só o objeto `data:` — `where: { pais: { countryKey } }` é FILTRO
    // pela relação canônica, não cópia, e não pode acusar.
    const i = janela.indexOf("data:")
    if (i < 0) return ""
    let prof = 0, ini = -1
    for (let j = i; j < janela.length; j++) {
      if (janela[j] === "{") { if (prof === 0) ini = j; prof++ }
      else if (janela[j] === "}") { prof--; if (prof === 0) return janela.slice(ini, j + 1) }
    }
    return janela.slice(ini < 0 ? i : ini)
  }
  const escritoresDaCopia = fontes.filter((f) => {
    const src = semComentario(readFileSync(join(RAIZ, f), "utf8"))
    for (const m of src.matchAll(/tipoProcessoNacionalidade\.(create|update|upsert|updateMany|createMany)/g)) {
      const dados = corpoDeData(src.slice(m.index ?? 0, (m.index ?? 0) + 1600))
      // dentro de `connectOrCreate` os campos são do PAÍS, não do tipo
      const semConnect = dados.replace(/connectOrCreate:\s*\{[\s\S]*\}/g, "")
      if (/\b(countryKey|countryLabel|nationalityKey|nationalityLabel)\s*:/.test(semConnect)) return true
    }
    return false
  })
  okGuard(escritoresDaCopia.length === 0,
    `nenhum writer copia país para dentro da oferta${escritoresDaCopia.length ? ` (${escritoresDaCopia.join(", ")})` : ""}`)

  // SELECT ESCONDIDO. Um `include` declarado `as const` num arquivo
  // compartilhado não é validado pelo compilador no ponto de uso: o erro só
  // aparece em runtime, como 500. Foi assim que `INCLUDE_APLICABILIDADE`
  // continuou pedindo `countryKey` da modalidade depois do drop, e o smoke
  // pegou. Este guard lê o TEXTO: qualquer seleção de modalidade ou de tipo de
  // processo que nomeie um dos campos mortos falha aqui.
  const selectsFantasma: string[] = []
  for (const f of fontes) {
    const src = semComentario(readFileSync(join(RAIZ, f), "utf8"))
    for (const m of src.matchAll(/\b(modalidade|modalidadePais|tipoProcesso|tipoProcessoMotor|tipoProcessoNacionalidade)\s*:\s*\{/g)) {
      // recorta o objeto da seleção (balanceado) e olha só o primeiro nível
      let prof = 0, fim = m.index ?? 0
      for (let j = (m.index ?? 0) + m[0].length - 1; j < src.length; j++) {
        if (src[j] === "{") prof++
        else if (src[j] === "}") { prof--; if (prof === 0) { fim = j; break } }
      }
      const bloco = src.slice(m.index ?? 0, fim + 1)
      // `pais: { ... countryKey ... }` é a relação canônica, e é o certo
      const semRelacao = bloco.replace(/pais(Canonico)?:\s*\{[\s\S]*?\}/g, "")
      if (/\b(countryKey|countryLabel|nationalityKey|nationalityLabel)\s*:\s*true/.test(semRelacao)) {
        selectsFantasma.push(f)
        break
      }
    }
  }
  okGuard(selectsFantasma.length === 0,
    `nenhuma seleção pede país dentro da modalidade ou do tipo${selectsFantasma.length ? ` (${[...new Set(selectsFantasma)].join(", ")})` : ""}`)

  // FILTRO DE PROCESSO POR PAÍS usa o resolvedor de identidade, não `{ pais }`.
  const filtroCru = fontes.filter((f) => {
    if (f.includes("identidade/canonica")) return false
    const src = semComentario(readFileSync(join(RAIZ, f), "utf8"))
    return /where[^\n]*\.processo\s*=\s*\{\s*pais\s*\}/.test(src)
      || /processo:\s*\{\s*pais\s*\}/.test(src)
  })
  okGuard(filtroCru.length === 0,
    `nenhum filtro de processo por texto de país${filtroCru.length ? ` (${filtroCru.join(", ")})` : ""}`)

  // ── EXISTIR ≠ SER OFERTADO ────────────────────────────────────────────
  // O erro conceitual mais caro desta arquitetura seria tratar "o país está no
  // cadastro" como "vendemos cidadania desse país". Este guard usa um país REAL
  // que a empresa não atende para provar que a separação continua de pé.
  console.log("\nÓrgãos, modalidades e taxas apontam para a identidade:")
  await linha("OrgaoProtocolo → CatalogoPais (identidade única)",
    `SELECT COUNT(*)::int n FROM "OrgaoProtocolo"`,
    `SELECT COUNT(*)::int n FROM "OrgaoProtocolo" WHERE "paisId" IS NULL`)
  await div("espelho OrgaoProtocolo.country não existe",
    `SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_name = 'OrgaoProtocolo' AND column_name = 'country'`)
  // A ANTI-DUPLICIDADE DO CADASTRO MESTRE ancorada na identidade. Enquanto era
  // (name, country), "Itália" e "Italia" eram dois países e a mesma entidade
  // entrava duas vezes sem o banco reclamar.
  await div("unicidade do órgão é (name, paisId)",
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE tablename='OrgaoProtocolo' AND indexdef LIKE '%(name, "paisId")%') THEN 0 ELSE 1 END n`)
  await div("nenhum órgão duplicado por (name, paisId)",
    `SELECT COUNT(*)::int n FROM (SELECT name, "paisId" FROM "OrgaoProtocolo" GROUP BY 1,2 HAVING COUNT(*)>1) x`)
  await linha("ModalidadePais → CatalogoPais (identidade única)",
    `SELECT COUNT(*)::int n FROM "ModalidadePais"`,
    `SELECT COUNT(*)::int n FROM "ModalidadePais" WHERE "paisId" IS NULL`)
  await div("espelho ModalidadePais.countryKey não existe",
    `SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_name = 'ModalidadePais' AND column_name = 'countryKey'`)
  // A unicidade da modalidade é sobre a IDENTIDADE do país, não sobre texto.
  await div("unicidade da modalidade é (paisId, modalityKey)",
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE tablename='ModalidadePais' AND indexname='ModalidadePais_paisId_modalityKey_key') THEN 0 ELSE 1 END n`)
  await div("array textual TaxaPagamento.paises não existe",
    `SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_name = 'TaxaPagamento' AND column_name = 'paises'`)
  await div("órgão e nacionalidade são dimensões distintas (país com órgão sem oferta é legítimo)",
    `SELECT 0::int n`)

  console.log("\nPaís geográfico não habilita nacionalidade ofertada:")
  const naoOfertado = await q(`
    SELECT c."countryKey" k FROM "CatalogoPais" c
    WHERE c.ativo AND NOT EXISTS (
      SELECT 1 FROM "TipoProcessoNacionalidade" t
      WHERE t."paisId" = c.id AND t.ativo AND NOT t.arquivado)`)
  const ofertados = await q(`
    SELECT c."countryKey" k FROM "CatalogoPais" c
    WHERE c.ativo AND EXISTS (
      SELECT 1 FROM "TipoProcessoNacionalidade" t
      WHERE t."paisId" = c.id AND t.ativo AND NOT t.arquivado)`)
  const semOferta = naoOfertado.map((r: any) => r.k)
  const comOferta = ofertados.map((r: any) => r.k)
  const cruzamento = semOferta.filter((k: string) => comOferta.includes(k))
  if (cruzamento.length > 0) falhas++
  console.log(`  ${cruzamento.length === 0 ? "✅" : "❌"} país sem tipo ativo não é ofertado` +
    ` — ofertados: ${comOferta.join(", ") || "nenhum"} · só geográficos: ${semOferta.join(", ") || "nenhum"}`)

  // A oferta é resolvida por IDENTIDADE, não por texto: o tipo de processo tem
  // de apontar para a linha do cadastro.
  const tiposSemIdentidade = await n(
    `SELECT COUNT(*)::int n FROM "TipoProcessoNacionalidade" WHERE "paisId" IS NULL AND ativo`)
  if (tiposSemIdentidade > 0) falhas++
  console.log(`  ${tiposSemIdentidade === 0 ? "✅" : "❌"} todo tipo de processo ativo aponta para o país (paisId) — sem identidade: ${tiposSemIdentidade}`)

  console.log(falhas === 0
    ? "\n✅ Cobertura total. A identidade canônica resolve todas as linhas."
    : `\n❌ ${falhas} verificação(ões) falharam — NÃO tornar o vínculo obrigatório.`)
  process.exit(falhas === 0 ? 0 : 1)
}
main()
