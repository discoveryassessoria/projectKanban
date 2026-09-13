// scripts/ui-fixtures-delete-processo.ts
//
// Fixtures para a validação autenticada (Playwright) do DELETE de Processo,
// SÓ NO BANCO DE TESTE LOCAL. Cria 2 usuários (autorizado/não-autorizado) e
// 3 processos (limpo, bloqueado por fato financeiro, e um par em árvore
// compartilhada) e assina um token para cada usuário.
//
// Rodar:
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   npx tsx scripts/ui-fixtures-delete-processo.ts [--limpar]
import { prisma } from "@/lib/prisma"
import { signAuthToken } from "@/lib/auth-jwt"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const MARCA = "UIDELPROC"

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacao: { processoId: { in: ids } } } })
  await prisma.obrigacaoEconomica.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  const arvoreIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
  if (arvoreIds.length) {
    await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvoreIds } } })
    await prisma.arvore.deleteMany({ where: { id: { in: arvoreIds } } })
  }
  await prisma.usuario.deleteMany({ where: { email: { startsWith: `${MARCA.toLowerCase()}-` } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Processo", descricao: { contains: MARCA } } })
}

async function main() {
  exigirBancoDeTeste("ui-fixtures-delete-processo.ts")
  await limpar()
  if (process.argv.includes("--limpar")) {
    console.log("limpo.")
    return
  }

  // ── Usuários ────────────────────────────────────────────────────────────
  // Os dois são `tipo='admin'` (base ampla, sem 403 incidental de widgets do
  // /kanban que não são o que este smoke testa) — a ÚNICA variável que muda
  // entre os dois é a concessão NOMINAL da permissão EXCLUSIVA, exatamente o
  // que a auditoria provou que precisa existir para esta ação específica.
  const autorizado = await prisma.usuario.create({
    data: {
      nome: `${MARCA} Autorizado`, email: `${MARCA.toLowerCase()}-autorizado@teste.local`,
      senha: "x", tipo: "admin",
      permissoesCustom: { "processos.excluirDefinitivo": true },
    },
    select: { id: true, email: true, nome: true, tipo: true },
  })

  // Não-autorizado: `tipo='admin'` SEM a concessão nominal — tem tudo o mais,
  // mas não isto. É a prova mais forte de que a permissão é mesmo exclusiva.
  const naoAutorizado = await prisma.usuario.create({
    data: {
      nome: `${MARCA} NaoAutorizado`, email: `${MARCA.toLowerCase()}-naoautorizado@teste.local`,
      senha: "x", tipo: "admin",
    },
    select: { id: true, email: true, nome: true, tipo: true },
  })

  // País/tipo REAIS do cadastro (a Lista de Processos só mostra o que casa
  // com um país do catálogo — não criamos país novo, reusamos o existente).
  const tipo = await prisma.tipoProcessoNacionalidade.findFirst({
    where: { ativo: true, arquivado: false },
    select: { id: true, paisId: true, pais: { select: { countryKey: true, countryLabel: true } } },
  })
  if (!tipo) throw new Error("nenhum TipoProcessoNacionalidade ativo no banco de teste — não é possível montar o fixture da Lista")
  const paisFixture = { paisId: tipo.paisId, tipoProcessoMotorId: tipo.id }
  console.error(`[fixture] usando país existente: ${tipo.pais.countryLabel} (${tipo.pais.countryKey})`)

  // ── Processo 1: limpo, deletável ──────────────────────────────────────────
  const procLimpo = await prisma.processo.create({
    data: { nome: `${MARCA} Processo Limpo`, ...paisFixture },
    select: { id: true },
  })

  // ── Processo 2: bloqueado por fato financeiro (obrigação PAGA, sem pessoa/documento) ──
  const procBloqueado = await prisma.processo.create({
    data: { nome: `${MARCA} Processo Bloqueado`, ...paisFixture },
    select: { id: true },
  })
  const obrig = await prisma.obrigacaoEconomica.create({
    data: {
      processoId: procBloqueado.id, natureza: "RECEITA", direcao: "ENTRADA",
      codigoOperacional: `${MARCA}-OBR`, moedaContratual: "BRL", moedaContabil: "BRL",
      valorContratado: "1000.00",
    },
    select: { id: true },
  })
  await prisma.ocorrenciaFinanceira.create({
    data: { obrigacaoId: obrig.id, tipo: "PAGAMENTO", status: "PROCESSADA", valor: "1000.00", data: new Date() },
  })

  // ── Processos 3/4: árvore compartilhada — excluir um não pode afetar o outro ──
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} Arvore Compartilhada` }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({
    data: { arvoreId: arvore.id, nome: MARCA, sobrenome: "Compartilhada" }, select: { id: true },
  })
  const procA = await prisma.processo.create({ data: { nome: `${MARCA} Processo A (arvore)`, arvoreId: arvore.id, ...paisFixture }, select: { id: true } })
  const procB = await prisma.processo.create({ data: { nome: `${MARCA} Processo B (arvore)`, arvoreId: arvore.id, ...paisFixture }, select: { id: true } })

  const resumo = {
    usuarios: { autorizado, naoAutorizado },
    processos: {
      limpo: procLimpo.id, bloqueado: procBloqueado.id, obrigacaoId: obrig.id,
      arvoreCompartilhada: { arvoreId: arvore.id, pessoaId: pessoa.id, procA: procA.id, procB: procB.id },
    },
  }
  console.log(JSON.stringify(resumo, null, 2))

  // ── Tokens + storageState para os dois personas ─────────────────────────
  const base = process.env.UI_TEST_BASE_URL ?? "http://localhost:3480"
  const { hostname } = new URL(base)
  const destino = join(process.cwd(), "tests/ui/.auth")
  mkdirSync(destino, { recursive: true })
  writeFileSync(join(destino, "delete-processo-fixture.json"), JSON.stringify(resumo, null, 2))

  for (const [nomeArq, u] of [["delete-processo-autorizado.json", autorizado], ["delete-processo-nao-autorizado.json", naoAutorizado]] as const) {
    const token = await signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })
    const estado = {
      cookies: [{
        name: "authToken", value: token, domain: hostname, path: "/",
        expires: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
        httpOnly: false, secure: false, sameSite: "Lax" as const,
      }],
      origins: [{ origin: base, localStorage: [
        { name: "authToken", value: token },
        { name: "user", value: JSON.stringify({ id: u.id, nome: u.nome, email: u.email, tipo: u.tipo }) },
      ] }],
    }
    writeFileSync(join(destino, nomeArq), JSON.stringify(estado, null, 2))
  }
  console.log("[ui] identidades técnicas prontas (autorizado + não-autorizado)")
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
