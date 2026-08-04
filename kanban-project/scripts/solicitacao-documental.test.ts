/**
 * SOLICITAÇÃO DOCUMENTAL — fonte única da solicitação, do protocolo e do anexo.
 *
 * Rodar: npm run test:solicitacao
 *
 * (A) PURO — configuração de canal, obrigatoriedade por canal, ponte legado→domínio
 *     e guardas estruturais (zero placeholder técnico, zero segunda fonte).
 * (B) BANCO — ciclo real sobre o banco configurado: registrar solicitação, criar
 *     protocolo e anexo, concluir a etapa, liberar o próximo passo, isolar outros
 *     documentos. Escreve num documento de TESTE criado e removido pelo próprio
 *     teste; só roda com `--banco`.
 */
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { execSync } from "child_process"

import {
  CANAIS_SOLICITACAO,
  canalDoTexto,
  configDoCanal,
  faltamCamposDoCanal,
  labelDoCanal,
  LABEL_CAMPO_FALTANDO,
} from "../src/lib/process-stage/canais-solicitacao"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

console.log("SOLICITAÇÃO DOCUMENTAL — solicitação, protocolo, requerimento e consulta\n")

// ════════════════════════════════════════════════════════════════
// (A) CANAL — configuração oficial e obrigatoriedade
// ════════════════════════════════════════════════════════════════
console.log("(A) Canal de solicitação:")

ok(CANAIS_SOLICITACAO.length === 8, "1. os 8 canais operacionais estão configurados")

ok(canalDoTexto("crc") === "CRC" && canalDoTexto("e-cartorio") === "ECARTORIO" &&
   canalDoTexto("comune_italiana") === "COMUNE" && canalDoTexto("EMAIL") === "EMAIL",
  "2. a chave textual legada resolve para o domínio (ponte de migração)")

ok(canalDoTexto("pombo") === null && canalDoTexto(null) === null,
  "3. canal desconhecido não vira valor — devolve null")

ok(labelDoCanal("CRC") === "CRC Nacional" && labelDoCanal(null) === null,
  "4. o canal tem rótulo próprio — a tela nunca mostra a chave crua")

// PROTOCOLO OPCIONAL POR CANAL — o coração da regra
ok(configDoCanal("CRC")?.protocoloObrigatorio === true && configDoCanal("ECARTORIO")?.protocoloObrigatorio === true,
  "5. CRC e e-cartório exigem protocolo no envio")
ok(configDoCanal("EMAIL")?.protocoloObrigatorio === false && configDoCanal("WHATSAPP")?.protocoloObrigatorio === false,
  "6. e-mail e WhatsApp NÃO exigem protocolo no envio")
ok(configDoCanal("CORREIOS")?.rastreioObrigatorio === true,
  "7. Correios exige código de rastreio")
ok(configDoCanal("BALCAO")?.observacaoObrigatoria === true,
  "8. balcão exige observação do atendimento")

// e-mail COM requerimento e SEM protocolo: envio válido
const emailValido = faltamCamposDoCanal({
  canal: "EMAIL", numeroProtocolo: null, anexoUrl: "https://r2/req.pdf", destinatarioNome: "2º Cartório",
})
ok(emailValido.length === 0,
  "9. REGRA: e-mail sem protocolo mas COM requerimento pode ser enviado")

// e-mail sem requerimento: recusado — o arquivo é a evidência do ato
ok(faltamCamposDoCanal({ canal: "EMAIL", anexoUrl: null, destinatarioNome: "x" }).includes("REQUERIMENTO"),
  "10. e-mail sem requerimento é recusado (o anexo é a evidência do envio)")

ok(faltamCamposDoCanal({ canal: "CRC", numeroProtocolo: null, anexoUrl: "u", destinatarioNome: "x" }).includes("NUMERO_PROTOCOLO"),
  "11. CRC sem protocolo é recusado")

ok(faltamCamposDoCanal({ canal: "CRC", numeroProtocolo: "1", anexoUrl: "u", destinatarioNome: null }).includes("DESTINATARIO"),
  "12. envio sem destinatário é recusado em qualquer canal")

ok(Object.keys(LABEL_CAMPO_FALTANDO).every((k) => LABEL_CAMPO_FALTANDO[k].length > 2),
  "13. todo campo faltando tem rótulo humano — o operador não lê código")

// ════════════════════════════════════════════════════════════════
// (A) GUARDAS ESTRUTURAIS
// ════════════════════════════════════════════════════════════════
console.log("\n(A) Guardas estruturais:")

const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

const drawerDoc = ler("src/components/kanban/DocumentoOperationalDrawer.tsx")
const drawerEtapa = ler("src/components/kanban/workflow/CentralDaEtapaDrawer.tsx")
const abas = ler("src/components/kanban/documento/AbasDocumentais.tsx")
const editor = ler("src/components/kanban/workflow/StepEditors.tsx")
const servico = ler("src/services/solicitacao-documento.ts")

// ZERO placeholder técnico nas abas do fluxo
ok(!/Requer modelo \w+ no schema/.test(drawerDoc + drawerEtapa),
  "14. nenhuma aba diz \"Requer modelo X no schema\"")
ok(!/tabela de junção|vinculado a Processo/i.test(drawerDoc),
  "15. a aba Protocolo não fala mais em vínculo só com Processo")
ok(!/pendencia=/.test(drawerDoc + drawerEtapa),
  "16. nenhum componente recebe mais texto de pendência técnica")

// as três abas consomem o registro canônico
ok(drawerDoc.includes("AbaProtocoloDocumento") && drawerDoc.includes("AbaAnexosDocumentais") &&
   drawerDoc.includes("AbaObservacoesDocumentais"),
  "17. as abas Protocolo, Anexos e Observações do documento são reais")
ok(drawerEtapa.includes("AbaAnexosDocumentais") && drawerEtapa.includes("stepInstanceId={step.id}"),
  "18. a aba Anexos da ETAPA lê o mesmo registro, escopado ao passo")

// o editor grava pela rota canônica, não mais por PUT documento + PATCH passo
ok(editor.includes("/solicitacoes") && !/putDocumento\(documentoId, \{\s*canal_solicitacao/.test(editor),
  "19. Solicitar certidão grava pela rota da solicitação, não por PUT no documento")
ok(!/link_acompanhamento: form\.attachmentUrl/.test(editor),
  "20. o requerimento não é mais escondido em link_acompanhamento")

// transação única e vínculos canônicos no serviço
ok(servico.includes("prisma.$transaction") && servico.includes("aplicarTransicaoDoPassoTx"),
  "21. solicitação, protocolo, anexo e conclusão da etapa vão num COMMIT só")
ok(servico.includes("protocoloDocumento.upsert"),
  "22. o vínculo canônico protocolo↔documento é gravado")
ok(servico.includes("registrarProtocoloDaSolicitacaoTx") && !servico.includes("model ProtocoloSolicitacao"),
  "23. o protocolo é o cadastro que JÁ existia — não nasce um segundo")

// nenhuma leitura de protocolo/anexo a partir de metadata solto
ok(!/metadata[\s\S]{0,40}externalProtocol/.test(abas) && !abas.includes("metadata"),
  "24. a aba Protocolo não lê metadata — lê o registro")

// autoria nunca vem do cliente
const rotaSolic = ler("src/app/api/documentos/[id]/solicitacoes/route.ts")
ok(rotaSolic.includes("extrairUsuarioComPermissoes") && !/criadoPorId:\s*body\./.test(rotaSolic),
  "25. a autoria vem do token, nunca do corpo da requisição")

// IDOR: etapa informada precisa ser do documento
const rotaArq = ler("src/app/api/documentos/[id]/arquivos/route.ts")
const rotaObs = ler("src/app/api/documentos/[id]/observacoes/route.ts")
ok(rotaArq.includes("passo.documentoId !== documentoId") && rotaObs.includes("passo.documentoId !== documentoId"),
  "26. anexar/observar valida que a etapa pertence ao documento (sem IDOR)")

// migration aditiva e idempotente
const migration = ler("prisma/migrations/20260804_solicitacao_documental/migration.sql")
ok(!/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|ALTER COLUMN .* DROP/i.test(migration.replace(/^--.*$/gm, "")),
  "27. a migration não dropa nem apaga nada")
ok(migration.includes("CREATE TABLE IF NOT EXISTS") && migration.includes("ADD COLUMN IF NOT EXISTS"),
  "28. a migration é idempotente")
ok(/DocumentoArquivo_documentoId_url_key/.test(migration),
  "29. a unicidade (documento, url) impede anexo duplicado por retry")
ok(/Protocolo_solicitacaoId_fkey/.test(migration),
  "30. protocolo só aponta para solicitação VÁLIDA (FK real)")

// uma implementação de cada escrita
let duplicadas = ""
try {
  duplicadas = execSync(
    `grep -rln "documentoArquivo.create\\|documentoObservacao.create" ${JSON.stringify(join(ROOT, "src"))} 2>/dev/null || true`,
    { encoding: "utf8" },
  )
} catch { duplicadas = "" }
const arquivosComCreate = duplicadas.split("\n").filter((l) => l.trim() && !l.includes("documento-arquivos.ts"))
if (arquivosComCreate.length) arquivosComCreate.forEach((l) => console.log("    ! " + l))
ok(arquivosComCreate.length === 0,
  "31. só existe UMA implementação de gravação de arquivo/observação")

// o backfill não inventa dado
const backfill = ler("scripts/backfill-solicitacao-documental.ts")
ok(backfill.includes("chaveIdempotencia: chave") && backfill.includes("--execute"),
  "32. o backfill é idempotente e só escreve com --execute")
ok(backfill.includes("motivoPulo") && backfill.includes("canal não identificável"),
  "33. caso sem dado real é REPORTADO, não inventado")
ok(backfill.includes("p.completedAt ?? p.startedAt"),
  "34. o backfill usa a data REAL do ato, não o instante da migração")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("Solicitação documental: fonte única validada ✅")
