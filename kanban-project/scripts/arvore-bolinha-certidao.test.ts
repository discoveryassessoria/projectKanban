// scripts/arvore-bolinha-certidao.test.ts
// ============================================================================
// REGRESSÃO (PR #77): depois que «Localizar registro» deixou de contar como recebimento, a certidão pendente caiu em PENDENTE e a árvore, que só desenhava
// os estados «em andamento», ficou SEM bolinha (Ginez, Ângela, Valdir…). Regra: toda certidão EXIGIDA tem bolinha — pendente = laranja (mesmo com o registro
// localizado), azul só com o recebimento registrado na Emissão. A cor sai do servidor (`bolinhaDaCertidao`, ao lado de `etapaDaCertidao`); a tela só desenha.
// ============================================================================
import { readFileSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { estadoOperacionalDosDocumentos, rotularEstadoDoDocumento, bolinhaDaCertidao } from "../lib/operacional/documento-estado"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (f: string) => readFileSync(f, "utf8")

async function main() {
  exigirBancoDeTeste("arvore-bolinha-certidao.test.ts")
  const r = (status: string, isRecebido = false, isValidado = false) => ({ status, statusShort: "", statusClass: "", isRecebido, isValidado, emOperacao: false })

  secao("A) A cor, decidida no servidor (pura)")
  ok("pendente (a solicitar) = laranja", bolinhaDaCertidao(r("PENDENTE")) === "solicitar" && bolinhaDaCertidao(r("A_FAZER")) === "solicitar" && bolinhaDaCertidao(r("SEM_RESPONSAVEL")) === "solicitar")
  ok("em andamento / aguardando terceiros = verde (solicitado)", bolinhaDaCertidao(r("EM_ANDAMENTO")) === "solicitado" && bolinhaDaCertidao(r("AGUARDANDO_TERCEIRO")) === "solicitado")
  ok("recebida (e validada) = azul, mesmo com a tarefa da Emissão ainda viva", bolinhaDaCertidao(r("EM_ANDAMENTO", true)) === "recebido" && bolinhaDaCertidao(r("RECEBIDO", true, true)) === "recebido")
  ok("bloqueada / inválida / não encontrada = vermelha (continua exigida)", bolinhaDaCertidao(r("BLOQUEADA")) === "em_busca" && bolinhaDaCertidao(r("INVALIDO")) === "em_busca" && bolinhaDaCertidao(r("NAO_ENCONTRADO")) === "em_busca")
  ok("só some quando a exigência acabou (cancelada / não exigida)", bolinhaDaCertidao(r("CANCELADO")) === null && bolinhaDaCertidao(r("NAO_EXIGIDO")) === null)

  secao("B) No banco de teste — Genealogia concluída mantém a bolinha LARANJA")
  const c = await montarCenario("BOLCERT", {
    slaDays: 10, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    subs: [
      { key: "enviar_requerimento_cartorio", label: "Enviar requerimento ao cartório", ordem: 1, espera: false, dependeDe: [] },
      { key: "receber_confirmacao_pedido", label: "Receber confirmação do pedido", ordem: 2, espera: true, dependeDe: ["enviar_requerimento_cartorio"] },
      { key: "receber_certidao", label: "Receber certidão", ordem: 3, espera: true, dependeDe: ["receber_confirmacao_pedido"] },
      { key: "conferir_validar_certidao", label: "Conferir e validar certidão", ordem: 4, espera: false, dependeDe: ["receber_certidao"] },
    ],
  })
  try {
    const o = await c.novaObrigacao({ responsavelId: null, comSolicitacao: { canal: "EMAIL" } })
    const docId = o.documentoId!
    await prisma.phaseWorkflowStepInstance.update({ where: { id: o.stepInstanceId }, data: { documentoId: docId } })
    await prisma.tarefa.update({ where: { id: o.tarefaId }, data: { faseMacroKey: "genealogia", statusTarefa: "CONCLUIDO_RECEBIDO" } }) // «Localizar registro» feito
    const cor = async () => { const e = (await estadoOperacionalDosDocumentos([docId])).get(docId); return bolinhaDaCertidao(rotularEstadoDoDocumento("SOLICITAR", e)) }
    ok("certidão LOCALIZADA mas não solicitada: bolinha LARANJA (não some, não fica azul)", (await cor()) === "solicitar", String(await cor()))
    await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: o.stepInstanceId, subtaskKey: "receber_certidao" }, data: { status: "CONCLUIDO" } })
    ok("depois de «Registrar recebimento»: AZUL", (await cor()) === "recebido", String(await cor()))
    ok("nunca uma certidão exigida fica sem bolinha (todo estado exigido tem cor)", ["PENDENTE", "SEM_RESPONSAVEL", "A_FAZER", "EM_ANDAMENTO", "AGUARDANDO_TERCEIRO", "BLOQUEADA", "INVALIDO", "NAO_ENCONTRADO"].every((s) => bolinhaDaCertidao(r(s)) !== null))
  } finally {
    await c.limpar()
  }

  secao("C) A tela só desenha o que o servidor decide")
  const rf = ler("src/components/arvore/react-flow-tree.tsx"), pc = ler("src/components/arvore/pessoa-card.tsx"), api = ler("src/app/api/arvore/[arvoreid]/route.ts")
  ok("a API manda bolinha / isRecebido / isValidado vindos de rotularEstadoDoDocumento + bolinhaDaCertidao", /bolinhaDaCertidao\(rotulo\)/.test(api) && /isValidado: rotulo\.isValidado/.test(api))
  ok("a árvore (react-flow-tree) não tem mapa próprio de estado → cor", !/CORES_POR_ESTADO/.test(rf) && /doc\.bolinha/.test(rf))
  ok("o cartão (pessoa-card) lê doc.bolinha e não tem mais «PENDENTE = sem bolinha»", /doc\.bolinha/.test(pc) && !/PENDENTE = sem bolinha/.test(pc))

  console.log(`\n${falhou === 0 ? "✅" : "❌"} BOLINHA DA CERTIDÃO — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
}
main().catch((e) => { console.log(`  ❌ ERRO: ${String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(-700)}`); process.exit(1) }).finally(() => prisma.$disconnect())
