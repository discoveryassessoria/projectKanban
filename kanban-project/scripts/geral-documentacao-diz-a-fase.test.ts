// scripts/geral-documentacao-diz-a-fase.test.ts
// Item 6.2 (30/09/2026): a aba Geral do Antão mostrava "0% · 0 de 12 recebidos" e "12 documentos ainda não recebidos"
// sem dizer a fase, contradizendo as 12 certidões localizadas/validadas na Genealogia. A contagem é da FASE ATIVA.
import { readFileSync } from "node:fs"
import { textoDoCartaoDeDocumentacao, textoDoAlertaDeDocumentos } from "../src/lib/process-stage/texto-documentacao"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }

ok("cartão diz a fase: 'Emissão documental: 0 de 12 certidões recebidas'", textoDoCartaoDeDocumentacao({ recebidos: 0, total: 12, faseLabel: "Emissão documental" }) === "Emissão documental: 0 de 12 certidões recebidas")
ok("singular", textoDoCartaoDeDocumentacao({ recebidos: 0, total: 1, faseLabel: "Emissão documental" }) === "Emissão documental: 0 de 1 certidão recebida")
ok("sem fase conhecida, o texto continua correto (sem prefixo)", textoDoCartaoDeDocumentacao({ recebidos: 3, total: 13, faseLabel: null }) === "3 de 13 certidões recebidas")
ok("o alerta fala de certidão A RECEBER na fase, nunca 'não recebidos' genérico", textoDoAlertaDeDocumentos({ aplicavel: true, pendentes: 12, faseLabel: "Emissão documental" }) === "12 certidões ainda a receber na fase Emissão documental")
ok("alerta no singular", textoDoAlertaDeDocumentos({ aplicavel: true, pendentes: 1, faseLabel: "Emissão documental" }) === "1 certidão ainda a receber na fase Emissão documental")
ok("sem pendência → sem alerta", textoDoAlertaDeDocumentos({ aplicavel: true, pendentes: 0, faseLabel: "Emissão documental" }) === null)
ok("fase que não trabalha certidões (ex.: Genealogia) → sem alerta de 'a receber'", textoDoAlertaDeDocumentos({ aplicavel: false, pendentes: 12, faseLabel: "Genealogia" }) === null)
const rota = readFileSync("src/app/api/processos/[processoId]/estatisticas/route.ts", "utf8")
ok("a rota usa a fonte única e manda a fase no payload", /documentacaoRequeridaDoProcesso\(id\)/.test(rota) && /faseLabel: faseLabelDocs/.test(rota) && /textoDoAlertaDeDocumentos\(/.test(rota))
ok("nenhum texto fixo 'ainda não recebido(s)' sobrou na rota", !/ainda não recebido\(s\)/.test(rota))
const tela = readFileSync("src/components/kanban/ProcessoEstatisticas.tsx", "utf8")
ok("a tela monta o cartão pela função pura", /textoDoCartaoDeDocumentacao\(/.test(tela) && !/documentos recebidos`/.test(tela))
console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
