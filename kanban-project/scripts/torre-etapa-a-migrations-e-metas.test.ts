// scripts/torre-etapa-a-migrations-e-metas.test.ts
// ============================================================================
// TORRE NOVA, ETAPA A (01/10/2026) — M1..M5 (migrations aditivas) e as METAS DE TEMPO POR FASE E PAÍS.
//
//   npx tsx scripts/torre-etapa-a-migrations-e-metas.test.ts   (banco de teste, montado pelas migrations REAIS)
//
// PROVA:
//   A1  as cinco migrations existem, estão em MIGRATIONS_POS_BASELINE, são ADITIVAS (sem DROP/RENAME/mudança de tipo) e
//       IDEMPOTENTES (IF NOT EXISTS), e o banco montado por elas tem as tabelas/colunas/índices parciais esperados;
//   A2a metas: CRUD com auditoria na mesma transação; resolução país → padrão → "—"; recusa de fase fora do Catálogo, país
//       inexistente e meta inválida; a API é do Gerenciamento (403 para quem não gerencia); SOMENTE EXIBIÇÃO — nenhum módulo
//       do motor de prazo/risco/notificação importa as metas; a categoria de organização aceita só o vocabulário fechado do
//       "bola com" (M5) pelo cadastro genérico.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-etapa-a-migrations-e-metas.test.ts")

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { definirMeta, excluirMeta, listarMetas, metaDaFase, resolverMeta, metaValida } from "../lib/operacional/torre-metas"
import { GET as getMetas, PUT as putMetas, DELETE as delMetas } from "../src/app/api/torre/metas/route"
import { POST as postCategoria } from "../src/app/api/gerenciamento/cadastros/[entidade]/route"
import { PUT as putCategoria } from "../src/app/api/gerenciamento/cadastros/[entidade]/[id]/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREA_META"
const ler = (p: string) => readFileSync(p, "utf8")
const req = (method: string, url: string, token: string | null, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })

const MIGRATIONS = [
  "20261001100000_torre_meta_tempo_fase",
  "20261001100100_torre_processo_pausa",
  "20261001100200_torre_aptidao_operacional_pais",
  "20261001100300_torre_indicador_diario_totais",
  "20261001100400_categoria_organizacao_rotulo_bola",
]

async function limpar() {
  await prisma.metaTempoFase.deleteMany({})
  await prisma.logAuditoria.deleteMany({ where: { acao: { startsWith: "META_TEMPO_FASE" } } })
  await prisma.categoriaOrganizacao.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA.toLowerCase() } } })
}

async function main() {
  secao("A1 — as cinco migrations: registradas, aditivas, idempotentes")
  const baseline = ler("scripts/baseline-verificar.test.ts")
  const pastas = new Set(readdirSync("prisma/migrations"))
  for (const m of MIGRATIONS) {
    const sql = ler(join("prisma/migrations", m, "migration.sql"))
    const semComentario = sql.replace(/--[^\n]*/g, "")
    ok(`${m}: existe e está em MIGRATIONS_POS_BASELINE`, pastas.has(m) && baseline.includes(`'${m}'`))
    ok(`${m}: ADITIVA — sem DROP, RENAME, TRUNCATE, DELETE nem mudança de tipo/NOT NULL de coluna existente`, !/\bDROP\b|\bRENAME\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|ALTER\s+COLUMN|\bSET\s+NOT\s+NULL\b/i.test(semComentario))
    const criacoes = [...semComentario.matchAll(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(?!IF NOT EXISTS)/gi)]
    const colunas = [...semComentario.matchAll(/ADD\s+COLUMN\s+(?!IF NOT EXISTS)/gi)]
    ok(`${m}: IDEMPOTENTE — todo CREATE/ADD COLUMN usa IF NOT EXISTS`, criacoes.length === 0 && colunas.length === 0)
  }
  ok("as migrations vêm DEPOIS da última anterior, em ordem", MIGRATIONS.every((m, i) => i === 0 || m > MIGRATIONS[i - 1]) && MIGRATIONS[0] > "20260930020000_documento_status_nao_exigido")
  ok("o schema.prisma tem os quatro modelos e a coluna do bola-com", /model MetaTempoFase \{/.test(ler("prisma/schema.prisma")) && /model ProcessoPausa \{/.test(ler("prisma/schema.prisma")) && /model AptidaoOperacionalPais \{/.test(ler("prisma/schema.prisma")) && /rotuloBola\s+String\?/.test(ler("prisma/schema.prisma")))

  secao("A1 — o banco montado pelas migrations reais tem a forma esperada")
  const colunasDe = async (tabela: string) => (await prisma.$queryRawUnsafe<Array<{ column_name: string; is_nullable: string }>>(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = '${tabela}'`))
  const indicador = await colunasDe("TorreIndicadorDiario")
  ok("M4: as 4 colunas novas existem e são NULLABLE (foto antiga fica sem valor)", ["processosAtivos", "tarefasAbertas", "comEquipe", "comCartorio"].every((c) => indicador.find((x) => x.column_name === c)?.is_nullable === "YES"))
  ok("M5: CategoriaOrganizacao.rotuloBola existe e é NULLABLE", (await colunasDe("CategoriaOrganizacao")).find((x) => x.column_name === "rotuloBola")?.is_nullable === "YES")
  const metaCols = await colunasDe("MetaTempoFase")
  ok("M1: colunas reais", ["phaseKey", "paisId", "metaDias", "ativo", "atualizadoPorId", "criadoEm", "atualizadoEm"].every((c) => metaCols.some((x) => x.column_name === c)) && metaCols.find((x) => x.column_name === "paisId")?.is_nullable === "YES")
  const pausaCols = await colunasDe("ProcessoPausa")
  ok("M2: ProcessoPausa com processoId, pausadoEm, pausadoPorId, motivo, retomadoEm (nullable), retomadoPorId", ["processoId", "pausadoEm", "pausadoPorId", "motivo", "retomadoEm", "retomadoPorId"].every((c) => pausaCols.some((x) => x.column_name === c)) && pausaCols.find((x) => x.column_name === "retomadoEm")?.is_nullable === "YES")
  const idx = await prisma.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('ProcessoPausa','MetaTempoFase','AptidaoOperacionalPais')`)
  ok("M2: índice parcial ÚNICO — no máximo uma pausa vigente por processo (retomadoEm IS NULL)", idx.some((i) => i.indexname === "ProcessoPausa_vigente_key" && /UNIQUE/i.test(i.indexdef) && /retomadoEm" IS NULL/i.test(i.indexdef)))
  ok("M1: meta PADRÃO da fase (sem país) é única — índice parcial", idx.some((i) => i.indexname === "MetaTempoFase_phaseKey_padrao_key" && /UNIQUE/i.test(i.indexdef) && /paisId" IS NULL/i.test(i.indexdef)))
  ok("M3: AptidaoOperacionalPais único por (usuário, país)", idx.some((i) => i.indexname === "AptidaoOperacionalPais_usuarioId_paisId_key" && /UNIQUE/i.test(i.indexdef)))

  await limpar()
  try {
    const mk = (nome: string, tipo: string, perms?: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const admin = await mk("Admin", "admin")
    const comum = await mk("Comum", "assistente", { "tarefas.ver": true })
    const tAdmin = await tokenDe(admin), tComum = await tokenDe(comum)
    const fase = await prisma.catalogoFase.findFirstOrThrow({ where: { ativo: true }, orderBy: { ordemPadrao: "asc" }, select: { phaseKey: true, label: true } })
    const pais = await prisma.catalogoPais.findFirstOrThrow({ select: { id: true, countryLabel: true } })

    secao("A2a — resolução PURA: país → padrão → nada")
    const metas = [
      { phaseKey: "a", paisId: null, metaDias: 30, ativo: true },
      { phaseKey: "a", paisId: 7, metaDias: 45, ativo: true },
      { phaseKey: "b", paisId: 7, metaDias: 10, ativo: true },
      { phaseKey: "c", paisId: null, metaDias: 5, ativo: false },
    ]
    ok("o país tem meta própria → vale a dele", resolverMeta(metas, "a", 7) === 45)
    ok("país sem meta própria → vale a padrão da fase", resolverMeta(metas, "a", 8) === 30 && resolverMeta(metas, "a", null) === 30)
    ok("fase com meta só de outro país e sem padrão → nada (a tela mostra “—”)", resolverMeta(metas, "b", 8) === null && resolverMeta(metas, "b", null) === null)
    ok("meta inativa não conta", resolverMeta(metas, "c", null) === null)
    ok("fase sem nenhuma meta → null (nunca inventada)", resolverMeta(metas, "z", 7) === null)
    ok("meta válida = inteiro de 1 a 3650", metaValida(1) && metaValida(3650) && !metaValida(0) && !metaValida(3651) && !metaValida(2.5) && !metaValida("7") && !metaValida(-1))

    secao("A2a — CRUD com auditoria na mesma transação")
    const c1 = await definirMeta({ phaseKey: fase.phaseKey, paisId: null, metaDias: 30, autorId: admin.id })
    ok("cria a meta PADRÃO da fase", c1.ok && c1.meta.metaDias === 30 && c1.meta.paisId === null && c1.meta.faseLabel === fase.label)
    const c2 = await definirMeta({ phaseKey: fase.phaseKey, paisId: pais.id, metaDias: 45, autorId: admin.id })
    ok("cria a meta do PAÍS (outra linha)", c2.ok && c2.meta.paisId === pais.id && c2.meta.paisLabel === pais.countryLabel)
    ok("a mesma chamada de novo ATUALIZA (idempotente por par), não duplica", (await definirMeta({ phaseKey: fase.phaseKey, paisId: null, metaDias: 20, autorId: admin.id })).ok && (await prisma.metaTempoFase.count({ where: { phaseKey: fase.phaseKey, paisId: null } })) === 1)
    ok("metaDaFase: do país quando existe, senão a padrão", (await metaDaFase(fase.phaseKey, pais.id)) === 45 && (await metaDaFase(fase.phaseKey, null)) === 20)
    const lista = await listarMetas()
    ok("listarMetas traz fase pelo CADASTRO (rótulo), país e quem atualizou", lista.length === 2 && lista.every((m) => m.faseLabel === fase.label && m.atualizadoPor?.id === admin.id))
    const logs = await prisma.logAuditoria.findMany({ where: { entidade: "MetaTempoFase" }, orderBy: { id: "asc" } })
    ok("cada escrita grava histórico (quem, o quê, quando): 2 criações + 1 alteração", logs.length === 3 && logs.filter((l) => l.acao === "META_TEMPO_FASE_CRIADA").length === 2 && logs.filter((l) => l.acao === "META_TEMPO_FASE_ALTERADA").length === 1 && logs.every((l) => l.usuarioId === admin.id && l.criadoEm instanceof Date))
    const alterada = logs.find((l) => l.acao === "META_TEMPO_FASE_ALTERADA")
    ok("a alteração guarda o antes e o depois", JSON.stringify(alterada?.detalhes).includes('"metaDias":30') && JSON.stringify(alterada?.detalhes).includes('"metaDias":20'))
    ok("a descrição diz que é só exibição (não é prazo)", /não gera prazo/i.test(alterada?.descricao ?? ""))

    secao("A2a — recusas")
    ok("fase fora do Catálogo → recusa", !(await definirMeta({ phaseKey: "fase_que_nao_existe", metaDias: 10, autorId: admin.id })).ok)
    ok("país inexistente → recusa", !(await definirMeta({ phaseKey: fase.phaseKey, paisId: 999999, metaDias: 10, autorId: admin.id })).ok)
    for (const n of [0, -3, 2.5, 5000]) ok(`meta ${n} é recusada`, !(await definirMeta({ phaseKey: fase.phaseKey, metaDias: n, autorId: admin.id })).ok)
    ok("nada foi gravado pelas recusas", (await prisma.metaTempoFase.count()) === 2)

    secao("A2a — a API é do Gerenciamento")
    const g1 = await getMetas(req("GET", "/api/torre/metas", tAdmin))
    const corpo = await g1.json()
    ok("GET: metas + fases do Catálogo + países, para o cartão do Gerenciamento", g1.status === 200 && corpo.metas.length === 2 && corpo.fases.length > 0 && corpo.paises.length > 0)
    ok("sem usuarios.gerenciar: 403 em GET, PUT e DELETE", (await getMetas(req("GET", "/api/torre/metas", tComum))).status === 403 && (await putMetas(req("PUT", "/api/torre/metas", tComum, { phaseKey: fase.phaseKey, metaDias: 9 }))).status === 403 && (await delMetas(req("DELETE", "/api/torre/metas?id=1", tComum))).status === 403)
    ok("sem sessão: 401", (await getMetas(req("GET", "/api/torre/metas", null))).status === 401)
    const p1 = await putMetas(req("PUT", "/api/torre/metas", tAdmin, { phaseKey: fase.phaseKey, paisId: pais.id, metaDias: 50 }))
    ok("PUT atualiza", p1.status === 200 && (await metaDaFase(fase.phaseKey, pais.id)) === 50)
    ok("PUT com meta inválida: 422 e nada muda", (await putMetas(req("PUT", "/api/torre/metas", tAdmin, { phaseKey: fase.phaseKey, paisId: pais.id, metaDias: 0 }))).status === 422 && (await metaDaFase(fase.phaseKey, pais.id)) === 50)
    ok("PUT com paisId lixo: 400", (await putMetas(req("PUT", "/api/torre/metas", tAdmin, { phaseKey: fase.phaseKey, paisId: 1.5, metaDias: 5 }))).status === 400)
    const idPais = (await prisma.metaTempoFase.findFirstOrThrow({ where: { phaseKey: fase.phaseKey, paisId: pais.id } })).id
    ok("DELETE exclui a meta e registra o histórico", (await delMetas(req("DELETE", `/api/torre/metas?id=${idPais}`, tAdmin))).status === 200 && (await prisma.metaTempoFase.count({ where: { id: idPais } })) === 0 && (await prisma.logAuditoria.count({ where: { acao: "META_TEMPO_FASE_EXCLUIDA", entidadeId: idPais } })) === 1)
    ok("excluir de novo: 404 (nada a excluir)", (await delMetas(req("DELETE", `/api/torre/metas?id=${idPais}`, tAdmin))).status === 404 && !(await excluirMeta(idPais, admin.id)).ok)
    ok("depois de excluir a do país, vale a padrão", (await metaDaFase(fase.phaseKey, pais.id)) === 20)

    secao("A2a — SOMENTE EXIBIÇÃO: nenhum módulo do motor de prazo/risco/notificação importa as metas")
    const motor = [
      "lib/operacional/tempo-operacional.ts", "lib/operacional/tarefa-projecoes.ts", "lib/operacional/precisa-de-voce.ts", "lib/operacional/proximo-acontecimento.ts",
      "lib/operacional/avisos-sino.ts", "lib/operacional/torre-kpis.ts", "lib/operacional/torre-processos.ts", "lib/operacional/tarefa-ciclo.ts", "lib/operacional/sla-pausa.ts",
      "src/services/task-step-sync.ts", "src/services/phase-workflow.ts", "src/lib/motor/phase-advance.ts",
    ].filter(existsSync)
    ok("o motor de prazo/risco/aviso/fase NÃO importa torre-metas", motor.length >= 8 && motor.every((f) => !/torre-metas|MetaTempoFase|metaTempoFase/.test(ler(f))), `${motor.length} arquivos`)
    const motorUso = [...readdirSync("lib/operacional").map((f) => `lib/operacional/${f}`)].filter((f) => f.endsWith(".ts") && !f.endsWith("torre-metas.ts"))
    ok("só a Torre/Gerenciamento lê as metas: nenhum arquivo de lib/operacional além de torre-metas.ts as usa", motorUso.every((f) => !/MetaTempoFase|metaTempoFase/.test(ler(f))))
    ok("o texto do cartão diz que NÃO é prazo", /Não são prazo/.test(ler("src/components/gerenciamentoComponents/saude/SaudeMetas.tsx")) && /SOMENTE EXIBIÇÃO/.test(ler("lib/operacional/torre-metas.ts")))
    ok("a sub-aba 'Metas de tempo' está na Saúde do sistema, com o deep-link ?sub=metas", /\["metas", "Metas de tempo"\]/.test(ler("src/components/gerenciamentoComponents/SaudeSistemaTab.tsx")) && /<SaudeMetas/.test(ler("src/components/gerenciamentoComponents/SaudeSistemaTab.tsx")) && /v === "metas"/.test(ler("src/components/gerenciamentoComponents/SaudeSistemaTab.tsx")))
    ok("todo botão da tela de metas tem handler", [...ler("src/components/gerenciamentoComponents/saude/SaudeMetas.tsx").matchAll(/<button\b[^>]*>/g)].every((m) => /onClick=/.test(m[0])))

    secao("M5 — o rótulo da bola é DADO da categoria, de vocabulário fechado")
    const ctx = (entidade: string) => ({ params: Promise.resolve({ entidade }) })
    const criar = await postCategoria(req("POST", "/api/gerenciamento/cadastros/categorias-organizacao", tAdmin, { nome: `${MARCA} Tradutores`, rotuloBola: "Tradutor" }), ctx("categorias-organizacao"))
    const criada = (await criar.json()).registro as { id: number; rotuloBola: string | null }
    ok("criar categoria com rotuloBola 'Tradutor'", criar.status === 201 && criada.rotuloBola === "Tradutor")
    const invalido = await postCategoria(req("POST", "/api/gerenciamento/cadastros/categorias-organizacao", tAdmin, { nome: `${MARCA} Outra`, rotuloBola: "Ninguém" }), ctx("categorias-organizacao"))
    ok("rotuloBola fora do vocabulário → 400 e nada gravado", invalido.status === 400 && (await prisma.categoriaOrganizacao.count({ where: { nome: { startsWith: `${MARCA} Outra` } } })) === 0)
    const edita = await putCategoria(req("PUT", `/api/gerenciamento/cadastros/categorias-organizacao/${criada.id}`, tAdmin, { rotuloBola: "Juízo" }), { params: Promise.resolve({ entidade: "categorias-organizacao", id: String(criada.id) }) })
    ok("editar para 'Juízo' vale", edita.status === 200 && (await prisma.categoriaOrganizacao.findUniqueOrThrow({ where: { id: criada.id } })).rotuloBola === "Juízo")
    const limpa = await putCategoria(req("PUT", `/api/gerenciamento/cadastros/categorias-organizacao/${criada.id}`, tAdmin, { rotuloBola: "" }), { params: Promise.resolve({ entidade: "categorias-organizacao", id: String(criada.id) }) })
    ok("em branco = 'a categoria não diz' (volta a null)", limpa.status === 200 && (await prisma.categoriaOrganizacao.findUniqueOrThrow({ where: { id: criada.id } })).rotuloBola === null)
    const editaLixo = await putCategoria(req("PUT", `/api/gerenciamento/cadastros/categorias-organizacao/${criada.id}`, tAdmin, { rotuloBola: "Cartorio-qualquer" }), { params: Promise.resolve({ entidade: "categorias-organizacao", id: String(criada.id) }) })
    ok("editar para valor fora do vocabulário → 400", editaLixo.status === 400)
  } finally {
    await limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
