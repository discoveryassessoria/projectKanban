// scripts/certidao-recebida-so-pela-emissao.test.ts
// ============================================================================
// REGRA (Marco, 07/10/2026): «Localizar registro» na Genealogia NÃO recebe nem valida a certidão.
//   • RECEBIDA só com «Receber certidão» (Registrar recebimento) concluída na Emissão;  • VALIDADA só com «Conferir e validar» (passo 4) concluída;
//   • bolinha da árvore, coluna «Certidão» e contagens leem UMA lógica no servidor (`etapaDaCertidao`, em documento-estado.ts);
//   • vigia (regra l do INT-003) acusa certidão recebida/validada sem o passo correspondente.
// A causa: a Tarefa da Genealogia termina em CONCLUIDO_RECEBIDO — o mesmo valor de qualquer tarefa concluída — e a leitura tratava «alguma tarefa concluída» como recebida.
//   node scripts/ci/gate-build.mjs --suite todas --so certidao-recebida-so-pela-emissao
// ============================================================================
import { readFileSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { estadoOperacionalDosDocumentos, rotularEstadoDoDocumento, etapaDaCertidao } from "../lib/operacional/documento-estado"
import { detectarRegraL, problemasDeRecebimento } from "../lib/saude/verificacoes/regras-do-marco"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (f: string) => readFileSync(f, "utf8")
const MARCA = "RECEM"

async function main() {
  exigirBancoDeTeste("certidao-recebida-so-pela-emissao.test.ts")

  secao("A) A regra pura")
  const base = { statusDocumento: "SOLICITAR", recebimentoRegistrado: false, validacaoRegistrada: false, tarefaDeEmissaoConcluida: false }
  ok("sem nenhuma evidência da Emissão: nem recebida nem validada (a Genealogia concluída não entra na conta)", JSON.stringify(etapaDaCertidao(base)) === JSON.stringify({ recebida: false, validada: false }))
  ok("«Receber certidão» concluída → recebida, não validada", JSON.stringify(etapaDaCertidao({ ...base, recebimentoRegistrado: true })) === JSON.stringify({ recebida: true, validada: false }))
  ok("«Conferir e validar» concluída → validada (e recebida)", JSON.stringify(etapaDaCertidao({ ...base, validacaoRegistrada: true })) === JSON.stringify({ recebida: true, validada: true }))
  ok("tarefa de Emissão concluída (os 4 passos) → validada", etapaDaCertidao({ ...base, tarefaDeEmissaoConcluida: true }).validada)
  ok("recebimento direto (upload do cliente: Documento.status RECEBIDO) → recebida, nunca validada", JSON.stringify(etapaDaCertidao({ ...base, statusDocumento: "RECEBIDO" })) === JSON.stringify({ recebida: true, validada: false }))

  secao("B) No banco de teste — Genealogia concluída NÃO é recebimento")
  const c = await montarCenario(MARCA, {
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
    // A Tarefa deste documento é a da GENEALOGIA, concluída («Localizar registro» feito): é o caso real do Ginez Abellan.
    await prisma.tarefa.update({ where: { id: o.tarefaId }, data: { faseMacroKey: "genealogia", statusTarefa: "CONCLUIDO_RECEBIDO" } })
    await prisma.documento.update({ where: { id: docId }, data: { status: "SOLICITAR" } })
    const estado = async () => (await estadoOperacionalDosDocumentos([docId])).get(docId)!
    const rotulo = async () => rotularEstadoDoDocumento("SOLICITAR", await estado())

    let e = await estado(), r = await rotulo()
    ok("Genealogia concluída e Emissão vazia: NÃO recebida, NÃO validada (a bolinha da árvore e a coluna Certidão não mudam)", !e.jaRecebido && !e.validado && !r.isRecebido && !r.isValidado && r.status === "PENDENTE", JSON.stringify([e.jaRecebido, e.validado, r.status]))
    ok("o vigia fica quieto (nada aparece como recebido)", (await detectarRegraL()).filter((v) => v.registroId === docId).length === 0)

    await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: o.stepInstanceId, subtaskKey: "receber_certidao" }, data: { status: "CONCLUIDO" } })
    e = await estado(); r = await rotulo()
    ok("«Receber certidão» concluída: RECEBIDA, ainda não validada", e.jaRecebido && !e.validado && r.isRecebido && !r.isValidado && r.status === "RECEBIDO", JSON.stringify([r.status, r.isRecebido, r.isValidado]))
    ok("e o vigia continua quieto (a Emissão tem o passo)", (await detectarRegraL()).filter((v) => v.registroId === docId).length === 0)

    await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: o.stepInstanceId, subtaskKey: "conferir_validar_certidao" }, data: { status: "CONCLUIDO" } })
    e = await estado(); r = await rotulo()
    ok("«Conferir e validar» concluída: VALIDADA", e.validado && r.isValidado && r.isRecebido)

    // controle positivo do vigia: recebida/validada SEM o passo.
    await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: o.stepInstanceId, subtaskKey: { in: ["receber_certidao", "conferir_validar_certidao"] } }, data: { status: "PENDENTE" } })
    await prisma.documento.update({ where: { id: docId }, data: { status: "RECEBIDO" } })
    const vRec = (await detectarRegraL()).filter((v) => v.registroId === docId)
    ok("controle positivo: Documento.status RECEBIDO sem «Receber certidão» concluída é ACUSADO", vRec.length === 1 && /RECEBIDA/.test(vRec[0].detalhe), vRec[0]?.detalhe)
    await prisma.documento.update({ where: { id: docId }, data: { status: "SOLICITAR" } })
    await prisma.tarefa.update({ where: { id: o.tarefaId }, data: { faseMacroKey: "emissao_documental", statusTarefa: "CONCLUIDO_RECEBIDO" } })
    const vVal = (await detectarRegraL()).filter((v) => v.registroId === docId)
    ok("controle positivo: tarefa de Emissão concluída sem os passos 3 e 4 é ACUSADA (recebida e validada sem passo)", vVal.length === 2 && vVal.some((v) => /VALIDADA/.test(v.detalhe)), vVal.map((v) => v.detalhe).join(" | "))
    ok("função pura acusa a regressão (leitura diz recebida só pela Genealogia)", problemasDeRecebimento({ statusDocumento: "SOLICITAR", recebimentoConcluido: false, validacaoConcluida: false, tarefaDeEmissaoConcluida: false, tarefaDaGenealogiaConcluida: true, leituraDizRecebida: true }).length === 1)
  } finally {
    await c.limpar()
  }

  secao("C) Uma lógica só, no servidor")
  const estadoSrc = ler("lib/operacional/documento-estado.ts")
  ok("a leitura oficial não trata mais «qualquer tarefa concluída» como recebida", !/jaRecebido: doDocumento\.some\(\(t\) => STATUS_TERMINAL_SUCESSO/.test(estadoSrc) && /etapaDaCertidao\(/.test(estadoSrc) && /!== FASE_GENEALOGIA/.test(estadoSrc))
  ok("a coluna «Certidão» da aba Documentos só diz «Validada» com isValidado (decisão do servidor)", /if \(isValidado\) return "validada"/.test(ler("src/components/kanban/ProcessoDocumentos.tsx")) && /isValidado: derivado\.isValidado/.test(ler("src/app/api/processos/[processoId]/documentos/route.ts")))
  ok("a bolinha da árvore vem da MESMA função (rotularEstadoDoDocumento), sem regra própria", /rotularEstadoDoDocumento\(d\.status, estados\.get\(d\.id\)\)/.test(ler("src/app/api/arvore/[arvoreid]/route.ts")))
  ok("a Saúde do Sistema registra a regra l (INT-003)", /detectarRegraL/.test(ler("lib/saude/verificacoes/regras-do-marco.ts")) && /l: 'Certidão recebida/.test(ler("lib/saude/verificacoes/regras-do-marco.ts")))

  console.log(`\n${falhou === 0 ? "✅" : "❌"} CERTIDÃO RECEBIDA SÓ PELA EMISSÃO — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
}
main().catch((e) => { console.log(`  ❌ ERRO: ${String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(-700)}`); process.exit(1) }).finally(() => prisma.$disconnect())
