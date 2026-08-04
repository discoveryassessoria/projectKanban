/**
 * CONTRATO DOCUMENTAL — Fatia 1: o cadastro declara, o guard cobra, a tela mostra.
 *
 * Rodar: npm run test:contrato-doc            (puro + guardas de código)
 *        npm run test:contrato-doc -- --banco (confere o cadastro real)
 *
 * (A) GUARDS — puros. As seis recusas, e o que NÃO deve ser recusado.
 * (B) ESTRUTURA — rotas e telas consomem o contrato por ID, não por texto.
 * (C) BANCO — DOC1/2/3 no perfil, DOC21 fora, workflow e cardinalidade.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import {
  conferirTipoDocumento,
  conferirPerfil,
  conferirWorkflow,
  respostaDeRecusa,
  MOTIVO_CONTRATO,
  EXPLICACAO_CONTRATO,
} from "../src/lib/documentos/contrato-documental"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8")
const COM_BANCO = process.argv.includes("--banco")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

console.log("CONTRATO DOCUMENTAL — Fatia 1\n")

// ════════════════════════════════════════════════════════════════
// (A) GUARDS
// ════════════════════════════════════════════════════════════════
console.log("(A) Guards administrativos:")

ok(conferirTipoDocumento({ naturezaExigeWorkflow: true, perfilOperacionalId: null })[0]?.motivo
     === MOTIVO_CONTRATO.DOC_SEM_PERFIL,
  "1. natureza que exige workflow SEM perfil é recusada")
ok(conferirTipoDocumento({ naturezaExigeWorkflow: true, perfilOperacionalId: 7 }).length === 0,
  "2. natureza que exige workflow COM perfil passa")
ok(conferirTipoDocumento({ naturezaExigeWorkflow: false, perfilOperacionalId: null }).length === 0,
  "3. evidência de etapa passa SEM perfil — é o caso do requerimento")

ok(conferirPerfil({ ativo: true, workflowId: null, workflowPublicado: false })[0]?.motivo
     === MOTIVO_CONTRATO.PERFIL_SEM_WORKFLOW,
  "4. perfil ATIVO sem workflow é recusado")
ok(conferirPerfil({ ativo: true, workflowId: 12, workflowPublicado: false }).length === 1,
  "5. perfil ativo apontando para workflow NÃO publicado é recusado")
ok(conferirPerfil({ ativo: false, workflowId: null, workflowPublicado: false }).length === 0,
  "6. perfil INATIVO sem workflow não é cobrado")

const wfDocOk = { escopoExecucao: "DOCUMENTO", exigeDocumento: true, tipoProcessoId: null,
                  tipoProcessoExiste: true, cardinalidadeDosPassos: ["DOCUMENTO", "DOCUMENTO"] }
ok(conferirWorkflow(wfDocOk).length === 0, "7. workflow documental bem declarado passa")
ok(conferirWorkflow({ ...wfDocOk, exigeDocumento: false })[0]?.motivo
     === MOTIVO_CONTRATO.WF_DOC_SEM_EXIGE_DOCUMENTO,
  "8. escopo DOCUMENTO sem exigeDocumento é recusado")
ok(conferirWorkflow({ ...wfDocOk, escopoExecucao: null })[0]?.motivo
     === MOTIVO_CONTRATO.WF_DOC_SEM_ESCOPO,
  "9. exigeDocumento sem escopo declarado é recusado")
ok(conferirWorkflow({ ...wfDocOk, cardinalidadeDosPassos: ["DOCUMENTO", null] })
     .some((f) => f.motivo === MOTIVO_CONTRATO.PASSO_SEM_CARDINALIDADE),
  "10. passo publicado com cardinalidade NULL é recusado")
ok(conferirWorkflow({ ...wfDocOk, tipoProcessoId: 2, tipoProcessoExiste: false })
     .some((f) => f.motivo === MOTIVO_CONTRATO.WF_TIPO_PROCESSO_INEXISTENTE),
  "11. workflow com tipoProcessoId inexistente é detectado (é o caso do wf 21)")
ok(conferirWorkflow({ escopoExecucao: null, exigeDocumento: false, tipoProcessoId: null,
                      tipoProcessoExiste: true, cardinalidadeDosPassos: [null, null] }).length === 0,
  "12. workflow NÃO documental segue herdando da fase — nada é cobrado dele")

ok(Object.values(MOTIVO_CONTRATO).every((m) => EXPLICACAO_CONTRATO[m]?.length > 40),
  "13. todo motivo tem explicação que diz o que fazer")
const recusa = respostaDeRecusa(conferirTipoDocumento({ naturezaExigeWorkflow: true, perfilOperacionalId: null }))
ok(recusa.error.startsWith("CONTRATO_DOCUMENTAL:") && recusa.contrato.length === 1,
  "14. a recusa é estruturada — código + motivo, nunca texto solto")

// ════════════════════════════════════════════════════════════════
// (B) ESTRUTURA
// ════════════════════════════════════════════════════════════════
console.log("\n(B) Rotas e telas:")

const rotaPost = ler("src/app/api/gerenciamento/tipos-documento/route.ts")
const rotaPut = ler("src/app/api/gerenciamento/tipos-documento/[id]/route.ts")
const compartilhado = ler("src/lib/documentos/contrato-tipo-documento.ts")
const telaTipo = ler("src/components/gerenciamentoComponents/TiposDocumentoTab.tsx")
const telaWf = ler("src/components/gerenciamentoComponents/PhaseWorkflowsFasesTab.tsx")

ok(rotaPost.includes("conferirContratoDoTipo") && rotaPut.includes("conferirContratoDoTipo"),
  "15. criar E editar cobram o MESMO guard (sem regra divergente)")
ok(!rotaPost.includes("function conferirContrato(") && compartilhado.includes("export async function conferirContratoDoTipo"),
  "16. o guard vive em um módulo só — não foi copiado para as duas rotas")
ok(compartilhado.includes("atual?.naturezaOperacionalId"),
  "17. o guard confere o estado RESULTANTE, não só o que veio no corpo")
ok(/familiaDocumentalId|naturezaOperacionalId|perfilOperacionalId/.test(compartilhado) &&
   !/familiaDocumentalNome|perfilNome|naturezaNome/.test(compartilhado),
  "18. o contrato grava por ID — nome não é aceito em lugar nenhum")
ok(!rotaPut.match(/DELETE[\s\S]{0,600}conferirContratoDoTipo/),
  "19. o guard não vazou para o DELETE — excluir não é gravar contrato")

ok(telaTipo.includes("/api/gerenciamento/contrato-documental"),
  "20. a tela do Cadastro Mestre carrega as opções do servidor")
ok(telaTipo.includes("familiaDocumentalId") && telaTipo.includes("naturezaOperacionalId") && telaTipo.includes("perfilOperacionalId"),
  "21. os três campos do contrato estão no formulário")
ok(telaTipo.includes("Versão publicada") && telaTipo.includes("Escopo de execução") &&
   telaTipo.includes("Exige documento") && telaTipo.includes("Exige pessoa") && telaTipo.includes("Passos"),
  "22. o painel do perfil mostra workflow, versão, escopo, exigências e nº de passos")
ok(telaTipo.includes("Os passos são editados no Workflow Interno"),
  "23. a tela diz onde os passos se editam — e não os edita")
ok(telaTipo.includes("exigePerfil"),
  "24. a tela avisa quando a natureza torna o perfil obrigatório (mesma regra do servidor)")

ok(telaWf.includes("wf.escopoExecucao") && telaWf.includes("exige documento") && telaWf.includes("exige pessoa"),
  "25. o cabeçalho do Workflow Interno mostra escopo e exigências")
ok(telaWf.includes("wf.perfis?.[0]") && telaWf.includes("wf.familiaDocumental"),
  "26. o cabeçalho mostra perfil e família por NOME, vindos da relação")
ok(telaWf.includes("CARDINALIDADE_LABEL[st.cardinalidade"),
  "27. cada passo continua exibindo a própria cardinalidade")
ok(!/escopoExecucao[\s\S]{0,200}onChange/.test(telaWf),
  "28. o contrato é só leitura na tela do workflow — declara-se no cadastro")

// a migration da Fatia 1 não voltou a ser tocada
const mig = ler("prisma/migrations/20260804c_contrato_documental/migration.sql")
ok(!/DROP TABLE|TRUNCATE|DELETE FROM/i.test(mig.replace(/^--.*$/gm, "")),
  "29. a migration do contrato continua estritamente aditiva")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }

// ════════════════════════════════════════════════════════════════
// (C) BANCO
// ════════════════════════════════════════════════════════════════
if (!COM_BANCO) {
  console.log("\n(C) Banco: pulado (use --banco).")
  console.log("Contrato documental: Fatia 1 validada ✅")
  process.exit(0)
}

async function noBanco() {
  const { prisma } = await import("../src/lib/prisma")
  console.log("\n(C) Cadastro real:")
  try {
    const tipos = await prisma.tipoDocumentoCadastro.findMany({
      where: { publicCode: { in: ["DOC1", "DOC2", "DOC3", "DOC21"] } },
      select: {
        publicCode: true,
        familiaDocumental: { select: { code: true } },
        naturezaOperacional: { select: { code: true, exigeWorkflow: true } },
        perfilOperacional: { select: { code: true, escopoInstanciacao: true, workflowId: true } },
      },
    })
    const por = (c: string) => tipos.find((t) => t.publicCode === c)
    for (const c of ["DOC1", "DOC2", "DOC3"]) {
      const t = por(c)
      ok(t?.perfilOperacional?.code === "EMISSAO_CERTIDAO" &&
         t?.familiaDocumental?.code === "CERTIDAO_REGISTRO_CIVIL" &&
         t?.naturezaOperacional?.code === "OBTIDO_EXTERNAMENTE",
        `30. ${c} → família CERTIDAO_REGISTRO_CIVIL · natureza OBTIDO_EXTERNAMENTE · perfil EMISSAO_CERTIDAO`)
    }
    const d21 = por("DOC21")
    ok(d21?.perfilOperacional == null, "31. DOC21 permanece SEM perfil operacional")
    ok(d21?.familiaDocumental?.code === "REQUERIMENTO" &&
       d21?.naturezaOperacional?.code === "EVIDENCIA_DE_ETAPA" &&
       d21?.naturezaOperacional?.exigeWorkflow === false,
      "32. DOC21 é evidência de etapa — natureza que NÃO exige workflow")

    const wf = await prisma.phaseInternalWorkflow.findUnique({
      where: { id: 12 },
      select: {
        escopoExecucao: true, exigeDocumento: true, exigePessoa: true, familiaDocumentalId: true,
        passos: { select: { key: true, cardinalidade: true }, orderBy: { ordem: "asc" } },
      },
    })
    ok(wf?.escopoExecucao === "DOCUMENTO", "33. workflow vigente declara escopo DOCUMENTO")
    ok(wf?.exigeDocumento === true && wf?.exigePessoa === true, "34. workflow exige documento e pessoa")
    ok(wf?.passos.length === 5 && wf.passos.every((p) => p.cardinalidade === "DOCUMENTO"),
      "35. os cinco passos declaram cardinalidade DOCUMENTO")
    ok(JSON.stringify(wf?.passos.map((p) => p.key)) ===
       JSON.stringify(["solicitar_certidao", "aguardar_retorno_do_cartorio", "receber_certidao", "conferir_certidao", "validar_certidao"]),
      "36. a ORDEM dos cinco passos não mudou")

    const wf21 = await prisma.phaseInternalWorkflow.findUnique({
      where: { id: 21 }, select: { tipoProcessoId: true, escopoExecucao: true, exigeDocumento: true },
    })
    ok(wf21?.escopoExecucao == null && wf21?.exigeDocumento === false,
      "37. workflow 21 permanece isolado — não recebeu contrato")
    const tipoDoWf21 = wf21?.tipoProcessoId
      ? await prisma.tipoProcessoNacionalidade.findUnique({ where: { id: wf21.tipoProcessoId }, select: { id: true } })
      : null
    ok(wf21?.tipoProcessoId != null && tipoDoWf21 === null,
      "38. workflow 21 continua apontando para tipo de processo inexistente (o guard o detecta)")

    const p505 = await prisma.processo.findUnique({ where: { id: 505 }, select: { faseAtualKey: true } })
    const tarefas = await prisma.tarefa.count()
    const steps = await prisma.phaseWorkflowStepInstance.count()
    ok(p505?.faseAtualKey === "emissao_documental", "39. processo 505 permanece em emissao_documental")
    ok(tarefas === 8 && steps === 5, `40. nada operacional mudou (tarefas=${tarefas}, stepInstances=${steps})`)
  } catch (e) {
    failed++
    console.log(`  ❌ consulta ao banco falhou: ${String(e).slice(0, 180)}`)
  } finally {
    await prisma.$disconnect()
  }
}

void noBanco().then(() => {
  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
  console.log("Contrato documental: Fatia 1 validada ✅")
})
