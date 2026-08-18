/**
 * ABAS DA CENTRAL OPERACIONAL — o que o operador vê, e o que ficou no domínio.
 *
 * Rodar: npm run test:abas
 *
 * A limpeza é de APRESENTAÇÃO. Este teste prova as duas metades:
 *   (A) as abas de configuração e as abas-placeholder sumiram da interface;
 *   (B) o DOMÍNIO por trás delas continua vivo — solicitação, protocolo, SLA,
 *       dependências, automações e auditoria não foram tocados.
 *
 * A segunda metade é a que importa: esconder uma aba é fácil; provar que nada foi
 * apagado junto é o que impede a "limpeza" de virar perda de dado.
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

console.log("ABAS DA CENTRAL OPERACIONAL — interface enxuta, domínio intacto\n")

const drawerEtapa = ler("src/components/kanban/workflow/CentralDaEtapaDrawer.tsx")
const drawerDoc = ler("src/components/kanban/DocumentoOperationalDrawer.tsx")
const abas = ler("src/components/kanban/documento/AbasDocumentais.tsx")
const editores = ler("src/components/kanban/workflow/StepEditors.tsx")

/** Rótulo de aba declarado no array de tabs (não em texto qualquer do arquivo). */
const temAba = (fonte: string, label: string) =>
  new RegExp(`label:\\s*"${label}"`).test(fonte)

// ════════════════════════════════════════════════════════════════
// (A) ETAPA DO WORKFLOW
// ════════════════════════════════════════════════════════════════
console.log("(A) Abas da etapa:")

for (const removida of ["Campos", "Dependências", "SLA", "Automação"]) {
  ok(!temAba(drawerEtapa, removida), `1. a aba "${removida}" não existe mais na etapa`)
}
for (const mantida of ["Anexos", "Observações", "Timeline"]) {
  ok(temAba(drawerEtapa, mantida), `2. a aba "${mantida}" continua na etapa`)
}
ok(/type TabId = "anexos" \| "comentarios" \| "timeline"/.test(drawerEtapa),
  "3. o tipo TabId da etapa tem exatamente três abas — nada escondido por trás")

// os componentes das abas removidas foram REMOVIDOS, não escondidos
ok(!/function TabCampos|function TabSla|function Placeholder/.test(drawerEtapa),
  "4. os componentes das abas removidas saíram do arquivo (não ficaram órfãos)")
ok(!/display:\s*none|hidden.*activeTab|featureFlag|FEATURE_/.test(drawerEtapa),
  "5. nenhuma aba foi escondida por CSS ou feature flag")

// o editor continua acessível pelos botões oficiais
ok(drawerEtapa.includes("Ver campos preenchidos") && drawerEtapa.includes("Abrir editor"),
  "6. \"Ver campos preenchidos\" e \"Abrir editor\" continuam na barra de ações")
ok(drawerEtapa.includes("Reabrir etapa") && drawerEtapa.includes("handleReabrir"),
  "7. \"Reabrir etapa\" continua funcionando")
ok(drawerEtapa.includes("StepEditorRouter") && drawerEtapa.includes("EditorRegistralModal"),
  "8. os editores de etapa continuam montados pelo drawer")

// zero texto técnico
ok(!/requer modelo \w+ no schema|WorkflowStepHistory|WorkflowStepAttachment/i.test(drawerEtapa),
  "9. nenhuma mensagem de \"modelo ausente\" sobrou na etapa")

// ════════════════════════════════════════════════════════════════
// (B) MODAL DO DOCUMENTO
// ════════════════════════════════════════════════════════════════
console.log("\n(B) Abas do documento:")

for (const removida of ["Divergências", "Protocolo", "Devoluções", "Tentativas", "Auditoria"]) {
  ok(!temAba(drawerDoc, removida), `10. a aba "${removida}" não existe mais no documento`)
}

// A aba "Operação" SAIU: era um segundo cockpit com status, próxima ação,
// responsável, SLA, aging e atalhos — a linha da Central já responde tudo isso,
// e a régua de prazo dele era própria. O painel abre direto no WORKFLOW, que é
// onde o trabalho acontece. O que só existia lá (iniciar a operação de um
// documento não materializado) virou o corpo do painel, não uma aba.
const ordemEsperada = ["Workflow", "Dados Registrais", "Histórico", "Anexos", "Observações"]
const ordemReal = [...drawerDoc.matchAll(/\{ id: "(\w+)", label: "([^"]+)" \}/g)].map((m) => m[2])
ok(JSON.stringify(ordemReal) === JSON.stringify(ordemEsperada),
  `11. as cinco abas do documento estão na ordem canônica (${ordemReal.join(" · ")})`)
ok(!temAba(drawerDoc, "Operação"),
  "11b. a aba \"Operação\" não existe mais — uma Central dentro da Central")

ok(!/function Placeholder/.test(drawerDoc),
  "12. o componente de placeholder saiu do documento — não sobrou aba vazia")
ok(!drawerDoc.includes("AbaProtocoloDocumento") && !abas.includes("export function AbaProtocoloDocumento"),
  "13. o componente da aba Protocolo foi REMOVIDO, não deixado inacessível")
ok(!/display:\s*none|featureFlag|FEATURE_/.test(drawerDoc),
  "14. nenhuma aba do documento foi escondida por CSS ou feature flag")
ok(!/overflow-x-auto/.test(drawerDoc.slice(drawerDoc.indexOf("{/* TABS */}"), drawerDoc.indexOf("{/* BODY */}"))),
  "15. a barra de abas do documento não depende de rolagem horizontal")

// ════════════════════════════════════════════════════════════════
// (C) O DOMÍNIO CONTINUA VIVO
// ════════════════════════════════════════════════════════════════
console.log("\n(C) Domínio preservado (a parte que importa):")

const schema = ler("prisma/schema.prisma")
ok(schema.includes("model SolicitacaoDocumento") && schema.includes("model Protocolo") &&
   schema.includes("model ProtocoloDocumento"),
  "16. solicitação e protocolo continuam no schema — nada foi dropado")
ok(schema.includes("model LogAuditoria"),
  "17. a auditoria continua no schema (saiu a aba, não o registro)")
ok(existsSync(join(ROOT, "src/services/solicitacao-documento.ts")) &&
   ler("src/services/solicitacao-documento.ts").includes("informarProtocoloPosterior"),
  "18. o serviço que informa protocolo depois continua existindo")
ok(existsSync(join(ROOT, "src/app/api/documentos/[id]/solicitacoes/[solicitacaoId]/protocolos/route.ts")),
  "19. a rota de protocolo da solicitação continua no ar")

// a AÇÃO de informar protocolo migrou para onde o fato acontece
ok(editores.includes("InformarProtocoloInline") &&
   editores.includes("/solicitacoes/${solicitacaoId}/protocolos"),
  "20. informar protocolo passou para \"Aguardar retorno\" — a capacidade não sumiu com a aba")
ok(editores.includes("Requerimento enviado ao cartório") && editores.includes("requerimentoUrl"),
  "21. \"Aguardar retorno\" exibe o requerimento já registrado, sem pedir reenvio")

// SLA / dependências / automações continuam no motor
ok(existsSync(join(ROOT, "src/lib/process-stage/sla-projection.ts")),
  "22. o motor de SLA continua intacto (a aba era vitrine, não a regra)")
ok(ler("src/services/documento-operacao.ts").includes("aplicarTransicaoDoPassoTx"),
  "23. a sequência/liberação de passos continua no motor")
ok(existsSync(join(ROOT, "src/lib/motor/executor.ts")),
  "24. o executor de automações continua no lugar")

// DOC21 intocado pela limpeza
ok(drawerEtapa.includes("AbaAnexosDocumentais") && drawerEtapa.includes("stepInstanceId={step.id}"),
  "25. os Anexos da ETAPA continuam escopados ao passo — o requerimento aparece lá")
ok(drawerDoc.includes("<AbaAnexosDocumentais documentoId={documentoId} podeAnexar />"),
  "26. os Anexos do DOCUMENTO continuam consolidando o mesmo registro")
ok(abas.includes("documentoMestre"),
  "27. a linha do arquivo continua mostrando o documento mestre (DOC21)")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("Abas: interface enxuta com domínio preservado ✅")
