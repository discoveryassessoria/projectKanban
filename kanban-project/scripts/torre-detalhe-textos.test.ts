// scripts/torre-detalhe-textos.test.ts
// ============================================================================
// TRÊS TEXTOS DO DETALHE DO PROCESSO DA TORRE (correção de 01/10/2026):
//   (1) certidão cancelada: o motivo CODIFICADO (CAUSA_REMOVIDA) aparece em português — a MESMA frase do histórico;
//   (2) "cancelada … por o Sistema" → "cancelada … pelo Sistema";
//   (3) cartão "Próxima ação" sem dono: "sem responsável" (nunca "responsável: nenhum").
//
//   node scripts/ci/gate-build.mjs --so torre-detalhe-textos
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-detalhe-textos.test.ts")

import { prisma } from "../lib/prisma"
import { criarPalco } from "./_fixture-arvore-fonte"
import { controlarOperacaoV2 } from "../src/services/documento-operacao"
import { encerramentosDosDocumentos } from "../src/services/encerramento-documental"
import { ROTULO_MOTIVO_CANCELAMENTO, rotuloDoMotivoDeCancelamento } from "../lib/operacional/historico-processo"
import { linhaEncerrada, focoDaFamilia, type CertidaoEncerradaDoFoco } from "../lib/operacional/torre-foco"
import { cartaoDaProximaAcao } from "../lib/operacional/torre-processo-puro"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "DETTXT"
const LEGIVEL = "a exigência deixou de existir (o workflow que a originou foi encerrado)"
const CRU = /\bCAUSA_REMOVIDA\b/

const encerrada = (o: Partial<NonNullable<CertidaoEncerradaDoFoco["encerramento"]>>): CertidaoEncerradaDoFoco => ({
  documentoId: 1, titulo: "Certidão de nascimento", pessoa: "Ana", tipo: "CANCELADA",
  encerramento: { tipo: "CANCELADA", quando: "2026-10-01T12:00:00.000Z", quandoRotulo: "hoje 09:00", porId: null, porNome: null, motivo: null, justificativa: null, tarefaReabrivelId: null, observacao: null, ...o },
})

async function main() {
  secao("(1) rótulo oficial do motivo codificado — a mesma frase do histórico")
  ok("CAUSA_REMOVIDA → frase em português", rotuloDoMotivoDeCancelamento("CAUSA_REMOVIDA") === LEGIVEL && ROTULO_MOTIVO_CANCELAMENTO.CAUSA_REMOVIDA === LEGIVEL)
  ok("texto digitado por pessoa passa sem mudança", rotuloDoMotivoDeCancelamento("Documento não necessário") === "Documento não necessário")
  ok("vazio/nulo → null", rotuloDoMotivoDeCancelamento(null) === null && rotuloDoMotivoDeCancelamento("  ") === null)

  secao("(2) linha da certidão cancelada: 'pelo Sistema' / 'por <nome>' — nunca 'por o Sistema'")
  const sistema = linhaEncerrada(encerrada({ motivo: LEGIVEL }), new Map(), new Date("2026-10-01T15:00:00.000Z"))
  ok("sem autor registrado → 'cancelada hoje 09:00 pelo Sistema · <motivo>'", sistema.encerramentoTexto === `cancelada hoje 09:00 pelo Sistema · ${LEGIVEL}`, String(sistema.encerramentoTexto))
  ok("nunca 'por o Sistema'", !/por o Sistema/.test(String(sistema.encerramentoTexto) + String(sistema.motivoTexto)))
  const humano = linhaEncerrada(encerrada({ porId: 3, porNome: "Daniela Brait", motivo: "Documento não necessário", justificativa: "Não trava o avanço" }), new Map(), new Date("2026-10-01T15:00:00.000Z"))
  ok("com autor → 'cancelada hoje 09:00 por Daniela Brait · <motivo>'", humano.encerramentoTexto === "cancelada hoje 09:00 por Daniela Brait · Documento não necessário", String(humano.encerramentoTexto))
  ok("o Motivo mostra quem, o motivo e a justificativa", humano.motivoTexto === "Cancelada por Daniela Brait · Documento não necessário (Não trava o avanço)", String(humano.motivoTexto))

  secao("(3) cartão 'Próxima ação': 'sem responsável' / 'responsável: <nome>'")
  const base = { texto: "Distribuir as 12 certidões", tipo: "distribuir", urgencia: null as null }
  const semDono = cartaoDaProximaAcao({ ...base, responsavelNome: null }, "hoje", "Emissão documental", true)
  ok("sem dono → 'sem responsável · prazo: hoje · por isso este processo está em \"Precisa de você\"'", semDono.detalhe === 'sem responsável · prazo: hoje · por isso este processo está em "Precisa de você"', semDono.detalhe)
  ok("nunca 'nenhum'", !/nenhum/i.test(semDono.detalhe))
  const comDono = cartaoDaProximaAcao({ ...base, responsavelNome: "Priscila Mota" }, "amanhã", null, false)
  ok("com dono → 'responsável: Priscila Mota · prazo: amanhã'", comDono.detalhe === "responsável: Priscila Mota · prazo: amanhã", comDono.detalhe)

  secao("(1, ponta a ponta) certidão cancelada de verdade: o código cru nunca chega à tela do Detalhe")
  const P = criarPalco(MARCA)
  await P.montar()
  try {
    const c = await P.novoCenario("casal", { conjuge: true })
    await P.putPessoa(c.titularId, { casado: true })
    await P.postUniao(c.titularId, c.conjugeId!)
    const f0 = await P.foto(c.processoId)
    const nasc = f0.docs.find((d) => d.pessoaId === c.titularId && f0.necs.find((n) => n.id === d.necessidadeId)?.cod === "NAS")!
    const ctxOp = { usuarioId: P.adminId, permissoes: { "tarefas.excluir": true, "workflow.iniciarPasso": true, "tarefas.bloquear": true }, isAdmin: true } as never
    // o motivo gravado é o CÓDIGO do cancelamento automático (como o reconciliador grava), não texto digitado
    const r = await controlarOperacaoV2(nasc.id, "cancelar", "CAUSA_REMOVIDA", ctxOp)
    ok("cancelar pela porta real", (r as { ok: boolean }).ok === true, JSON.stringify(r).slice(0, 120))
    const enc = (await encerramentosDosDocumentos([nasc.id])).get(nasc.id)
    ok("a leitura da Central/Detalhe devolve a frase em português, não o código", enc?.motivo === LEGIVEL, String(enc?.motivo))
    const foco = await focoDaFamilia(c.processoId)
    const noFoco = foco?.encerradas.find((e) => e.documentoId === nasc.id)
    ok("o Foco da família carrega o mesmo motivo legível", noFoco?.encerramento?.motivo === LEGIVEL, String(noFoco?.encerramento?.motivo))
    const linha = noFoco ? linhaEncerrada(noFoco, new Map(), new Date()) : null
    const texto = `${linha?.encerramentoTexto ?? ""} | ${linha?.motivoTexto ?? ""}`
    ok("a linha da tabela do Detalhe não contém CAUSA_REMOVIDA", !!linha && !CRU.test(texto) && texto.includes(LEGIVEL), texto.slice(0, 200))
    const log = await prisma.logAuditoria.findFirst({ where: { acao: "TAREFA_CANCELADA", entidadeId: { in: (await prisma.tarefa.findMany({ where: { documentoId: nasc.id }, select: { id: true } })).map((t) => t.id) } }, select: { detalhes: true } })
    ok("o fato gravado continua com o código (só a EXIBIÇÃO é traduzida)", JSON.stringify(log?.detalhes ?? {}).includes("CAUSA_REMOVIDA"))
  } finally {
    await P.limpar()
  }
}

main().then(async () => {
  await prisma.$disconnect()
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
