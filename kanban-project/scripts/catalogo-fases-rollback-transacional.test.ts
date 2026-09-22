// scripts/catalogo-fases-rollback-transacional.test.ts
//
// ROLLBACK TRANSACIONAL — mandato "blindagem do Catálogo de Fases"
// (22/09/2026), itens 28 e 29 da matriz de regressão:
//   28) falha transacional deve produzir rollback INTEGRAL;
//   29) publicação/reconciliação parcialmente falha não pode deixar
//       configuração intermediária — a CatalogoFase nunca fica com
//       revisaoAtual e CatalogoFaseRevisao fora de sincronia.
//
// Item 28 é forçado com uma falha REAL de banco (violação de constraint
// única), não mock: `publicarRevisaoCatalogoFase` (src/lib/motor/catalogo-
// fase-revisao.ts) faz DOIS writes na MESMA transação — `catalogoFase.update`
// e, se algo mudou, `catalogoFaseRevisao.create` — dentro de
// `@@unique([catalogoFaseId, revisao])`. Pré-inserindo a revisão que o
// próximo PUT real tentaria congelar, o segundo write da transação colide de
// verdade (P2002) DEPOIS do primeiro já ter rodado — e é exatamente essa
// ordem que prova (ou reprova) o rollback.
//
// Item 29 prova o invariante complementar já fechado no commit 99d2c10b
// (reconciliação isolada em try/catch PRÓPRIO, fora da transação de
// persistência): mesmo com N publicações reais consecutivas, CatalogoFase.
// revisaoAtual sempre bate com a contagem de CatalogoFaseRevisao, e
// ativo/status nunca divergem — nunca uma "configuração intermediária".
//
// Fixture 100% genérica e sintética própria (MARCA ROLLBACKFASE).
//
// Roda com:
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//     npx tsx scripts/catalogo-fases-rollback-transacional.test.ts
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("catalogo-fases-rollback-transacional.test.ts")

import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { PUT } from "../src/app/api/gerenciamento/catalogo-fases/[id]/route"
import { NextRequest } from "next/server"

const MARCA = "ROLLBACKFASE"
let ok = 0, falhou = 0
function check(nome: string, cond: boolean, detalhe?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? " — " + detalhe : ""}`) }
  else { falhou++; console.error(`  ❌ ${nome}${detalhe ? " — " + detalhe : ""}`) }
}

async function limpar() {
  await prisma.catalogoFaseRevisao.deleteMany({ where: { phaseKey: { startsWith: MARCA.toLowerCase() } } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: MARCA.toLowerCase() } } })
  await prisma.usuario.deleteMany({ where: { email: `admin@${MARCA.toLowerCase()}.test` } })
}

async function chamarPut(id: number, body: Record<string, unknown>, token: string) {
  const res = await PUT(
    new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${id}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: String(id) }) },
  )
  const j = await res.json().catch(() => ({}))
  return { status: res.status, j }
}

async function invarianteDeSincronia(faseId: number) {
  const fase = await prisma.catalogoFase.findUniqueOrThrow({ where: { id: faseId } })
  const revisoes = await prisma.catalogoFaseRevisao.count({ where: { catalogoFaseId: faseId } })
  const ultimaRevisao = await prisma.catalogoFaseRevisao.findFirst({ where: { catalogoFaseId: faseId }, orderBy: { revisao: "desc" } })
  return {
    revisaoAtualBateComContagem: fase.revisaoAtual === revisoes,
    statusBateComAtivo: (fase.ativo && fase.status === "PUBLICADA") || (!fase.ativo && (fase.status === "INATIVA" || fase.status === "RASCUNHO")),
    ultimaRevisaoCongelaEstadoAtual: ultimaRevisao != null && ultimaRevisao.label === fase.label && ultimaRevisao.escopo === fase.escopo,
    fase, revisoes,
  }
}

async function main() {
  await limpar()
  const admin = await prisma.usuario.create({ data: { nome: MARCA, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })

  const CHAVE = `${MARCA.toLowerCase()}_fase`
  const fase = await prisma.catalogoFase.create({
    data: { phaseKey: CHAVE, label: `[${MARCA}] original`, escopo: "PROCESSO", ordemPadrao: 1, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] },
  })
  await prisma.catalogoFaseRevisao.create({
    data: { catalogoFaseId: fase.id, revisao: 1, phaseKey: CHAVE, label: fase.label, descricao: null, escopo: "PROCESSO", ordemPadrao: 1, requiredPadrao: true, conditionalPadrao: false, status: "PUBLICADA", efeitosPermitidos: ["REGISTER_ONLY"], congeladoPorId: admin.id, origem: "CRIACAO" },
  })

  console.log("\n1) Item 28 — forçar falha REAL na segunda escrita da MESMA transação (unique constraint)")
  // Pré-insere a revisão 2 — exatamente a que o PUT abaixo vai tentar congelar
  // depois de já ter rodado `catalogoFase.update` (revisaoAtual: 1→2) na
  // mesma transação. `catalogoFaseRevisao.create` colide de verdade.
  await prisma.catalogoFaseRevisao.create({
    data: { catalogoFaseId: fase.id, revisao: 2, phaseKey: CHAVE, label: "colisão plantada", descricao: null, escopo: "PROCESSO", ordemPadrao: 1, requiredPadrao: true, conditionalPadrao: false, status: "PUBLICADA", efeitosPermitidos: ["REGISTER_ONLY"], congeladoPorId: admin.id, origem: "BACKFILL" },
  })

  let excecaoReal = false
  try {
    await chamarPut(fase.id, { phaseKey: CHAVE, label: `[${MARCA}] renomeada — não pode persistir`, escopo: "PROCESSO", efeitosPermitidos: ["REGISTER_ONLY"], ordemPadrao: 1, requiredPadrao: true, conditionalPadrao: false, ativo: true, id: fase.id }, token)
  } catch {
    // A rota tem catch genérico (500) — não deveria escapar como exceção não
    // tratada. Se chegar aqui, registra como achado, não interrompe o teste.
    excecaoReal = true
  }
  check("a rota NÃO deixou a exceção escapar sem tratamento (sempre responde, nunca crasha o processo chamador)", !excecaoReal)

  const depoisDaFalha = await prisma.catalogoFase.findUniqueOrThrow({ where: { id: fase.id } })
  check("rollback INTEGRAL: revisaoAtual continua 1 (o update da fase foi desfeito)", depoisDaFalha.revisaoAtual === 1, `revisaoAtual=${depoisDaFalha.revisaoAtual}`)
  check("rollback INTEGRAL: label continua o ORIGINAL (não ficou 'renomeada — não pode persistir')", depoisDaFalha.label === `[${MARCA}] original`, depoisDaFalha.label)
  const revisoesReais = await prisma.catalogoFaseRevisao.count({ where: { catalogoFaseId: fase.id, origem: "PUBLICACAO" } })
  check("nenhuma CatalogoFaseRevisao nova de origem PUBLICACAO foi criada pela tentativa falha", revisoesReais === 0, `origem=PUBLICACAO: ${revisoesReais}`)

  // Remove a revisão-armadilha antes da parte 2, senão toda publicação real
  // esbarraria nela de novo por acidente (não é o que a parte 2 quer provar).
  await prisma.catalogoFaseRevisao.deleteMany({ where: { catalogoFaseId: fase.id, revisao: 2 } })

  console.log("\n2) Item 29 — N publicações reais consecutivas nunca deixam configuração intermediária")
  const mudancas = [
    { label: `[${MARCA}] v2`, escopo: "PROCESSO" },
    { label: `[${MARCA}] v2`, escopo: "DOCUMENTO" }, // fase sem uso — sem exigir confirmarMudancaEscopo
    { ativo: false }, // inativar
    { ativo: true, escopo: "DOCUMENTO", label: `[${MARCA}] v4 reativada` },
  ]
  for (let i = 0; i < mudancas.length; i++) {
    const atual = await prisma.catalogoFase.findUniqueOrThrow({ where: { id: fase.id } })
    const corpo = {
      phaseKey: CHAVE, id: fase.id,
      label: (mudancas[i] as { label?: string }).label ?? atual.label,
      escopo: (mudancas[i] as { escopo?: string }).escopo ?? atual.escopo,
      efeitosPermitidos: atual.efeitosPermitidos, ordemPadrao: atual.ordemPadrao,
      requiredPadrao: atual.requiredPadrao, conditionalPadrao: atual.conditionalPadrao,
      ativo: (mudancas[i] as { ativo?: boolean }).ativo ?? atual.ativo,
    }
    const r = await chamarPut(fase.id, corpo, token)
    check(`publicação ${i + 1}/${mudancas.length}: 200`, r.status === 200, JSON.stringify(r.j.fase ?? r.j))
    const inv = await invarianteDeSincronia(fase.id)
    check(`publicação ${i + 1}: revisaoAtual bate com a contagem de revisões congeladas`, inv.revisaoAtualBateComContagem, `revisaoAtual=${inv.fase.revisaoAtual}, revisoes=${inv.revisoes}`)
    check(`publicação ${i + 1}: status/ativo em sincronia (nunca duas verdades)`, inv.statusBateComAtivo, `ativo=${inv.fase.ativo}, status=${inv.fase.status}`)
    check(`publicação ${i + 1}: última revisão congelada reflete o estado atual`, inv.ultimaRevisaoCongelaEstadoAtual)
    check(`publicação ${i + 1}: reconciliacaoErro é campo explícito (nunca omitido)`, "reconciliacaoErro" in r.j)
  }
  // NOTA HONESTA: isto prova o invariante de sincronia através de N escritas
  // reais consecutivas — não força uma falha genuína e determinística DENTRO
  // de `enqueueReconciliacaoCatalogoFase` num banco de teste local (o caminho
  // real que falhou em produção foi um timeout de rede contra
  // pooled.db.prisma.io, não reproduzível contra Postgres local). O commit
  // 99d2c10b e `scripts/escopo-fase-reconciliacao-resiliente.test.ts` já
  // cobrem o contrato de resposta quando a reconciliação FALHA de verdade
  // (reconciliacaoErro explícito, fase ainda assim persistida); este arquivo
  // cobre o lado que faltava: a CatalogoFase em si nunca sai de sincronia,
  // independentemente de quantas publicações reais se acumulem.

  await limpar()
  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  if (falhou > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
