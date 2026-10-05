// scripts/coleta-pendentes-prazo.test.ts — o link vale até o processo sair de "Aguardando fechamento"; o PENDENTE que ficou segue a contagem
// de 30 dias DEPOIS do encerramento, qualquer que seja o motivo do encerramento (FASE_MUDOU, MANUAL, CONFERENCIA) (storage de MENTIRA + banco de TESTE; só mexe no que ele mesmo criou).
//   PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/coleta-pendentes-prazo.test.ts
import { readFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { purgarEnviosDescartados, rodarRetencaoDaColeta, encerrarLinksDeProcessosQueSairamDaFase, DIAS_RETENCAO_PENDENTES } from "@/src/services/coleta/coleta-purga"
import { linksAtivosAntigosComPendentes, DIAS_LINK_ATIVO_ANTIGO } from "@/src/services/conferidor-orfaos"

const MARCA = "PENDPRAZO-TEST"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${x}`) } }
const AGORA = new Date("2026-10-06T12:00:00Z")
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 86_400_000)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const ids = procs.map((p) => p.id)
  await prisma.logAuditoria.deleteMany({ where: { OR: [{ acao: "COLETA_PENDENTE_PURGADO_POR_PRAZO", descricao: { contains: "link" }, detalhes: { path: ["marca"], equals: MARCA } }, { entidade: "COLETA_LINK", descricao: { contains: MARCA } }] } }).catch(() => {})
  await prisma.processo.deleteMany({ where: { id: { in: ids } } }) // cascata: links, envios, arquivos, logs do motor
}

let seq = 0
async function cenario(args: { fase?: string; link: { encerradoEm: Date | null; motivo?: string | null; criadoEm?: Date }; envio: { status: string } }) {
  seq++
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} ${seq}`, faseAtualKey: args.fase ?? "a_iniciar" }, select: { id: true } })
  const link = await prisma.coletaLink.create({
    data: { codigo: `${MARCA}-${Date.now()}-${seq}-xxxxxxxxxxxxxxxx`, processoId: proc.id, criadoEm: args.link.criadoEm ?? diasAtras(200), encerradoEm: args.link.encerradoEm, motivoEncerramento: args.link.motivo ?? null },
    select: { id: true },
  })
  const envio = await prisma.coletaEnvio.create({ data: { linkId: link.id, papel: "REQUERENTE", cpf: `9${String(seq).padStart(10, "0")}`, dados: { nome: "Fulano Teste" }, ipHash: "h", consentimentoEm: diasAtras(300), consentimentoVersao: "t", status: args.envio.status }, select: { id: true } })
  const chave = `privado/coleta/${link.id}/u-${seq}/rg.png`
  await prisma.coletaArquivo.create({ data: { envioId: envio.id, tipo: "IDENTIDADE", chave, nome: "rg.png", tamanho: 1, mime: "image/png" } })
  return { procId: proc.id, linkId: link.id, envioId: envio.id, chave }
}

async function main() {
  exigirBancoDeTeste("coleta-pendentes-prazo.test.ts")
  await limpar()
  const storage = new Set<string>()
  const apagadas: string[] = []
  const apagar = async (k: string) => { storage.delete(k); apagadas.push(k) }

  const A = await cenario({ link: { encerradoEm: diasAtras(31), motivo: "FASE_MUDOU" }, envio: { status: "PENDENTE" } })      // PURGA (31 dias)
  const B = await cenario({ link: { encerradoEm: diasAtras(29), motivo: "FASE_MUDOU" }, envio: { status: "PENDENTE" } })      // ainda não (29)
  const C = await cenario({ link: { encerradoEm: diasAtras(100), motivo: "FASE_MUDOU" }, envio: { status: "CONFIRMADO" } })    // NUNCA
  const D = await cenario({ link: { encerradoEm: null }, envio: { status: "PENDENTE" } })                                      // link ATIVO: nunca
  const E = await cenario({ link: { encerradoEm: diasAtras(100), motivo: "MANUAL" }, envio: { status: "PENDENTE" } })          // fechado à mão: PURGA
  const E2 = await cenario({ link: { encerradoEm: diasAtras(40), motivo: "CONFERENCIA" }, envio: { status: "PENDENTE" } })     // fim da conferência: PURGA
  const E3 = await cenario({ link: { encerradoEm: diasAtras(10), motivo: "MANUAL" }, envio: { status: "PENDENTE" } })          // manual há 10 dias: ainda não
  const C2 = await cenario({ link: { encerradoEm: diasAtras(100), motivo: "MANUAL" }, envio: { status: "CONFIRMADO" } })       // confirmado de link manual: NUNCA
  const F = await cenario({ link: { encerradoEm: diasAtras(31), motivo: "CONFERENCIA" }, envio: { status: "DESCARTADO" } })    // descartado: como sempre
  for (const x of [A, B, C, D, E, E2, E3, C2, F]) storage.add(x.chave)
  const cpfDeA = (await prisma.coletaEnvio.findUnique({ where: { id: A.envioId }, select: { cpf: true } }))!.cpf!

  console.log("purga com prazo de 30 dias")
  ok("o prazo dos pendentes é o mesmo dos descartados: 30 dias", DIAS_RETENCAO_PENDENTES === 30)
  const r = await purgarEnviosDescartados(AGORA, apagar)
  const env = async (id: number) => prisma.coletaEnvio.findUnique({ where: { id }, include: { arquivos: true } })
  const a = await env(A.envioId), b = await env(B.envioId), c = await env(C.envioId), d = await env(D.envioId), e = await env(E.envioId), f = await env(F.envioId)
  ok("PENDENTE de link encerrado por saída da fase há 31 dias → dados e arquivo apagados", a?.dados === null && a?.cpf === null && a?.ipHash === null && a?.purgadoEm != null && a?.arquivos.length === 0 && !storage.has(A.chave))
  ok("…e fica só o registro: passa a DESCARTADO (decisão do sistema, sem usuário) e deixa de contar como conferência pendente", a?.status === "DESCARTADO" && a?.decididoPorId === null && (await prisma.coletaEnvio.count({ where: { id: A.envioId, status: "PENDENTE" } })) === 0)
  ok("PENDENTE com 29 dias → intacto (dados, cpf e arquivo)", b?.status === "PENDENTE" && b?.cpf != null && b?.dados != null && b?.arquivos.length === 1 && storage.has(B.chave))
  ok("CONFIRMADO → NUNCA apagado (nem com 100 dias): dados e arquivo ficam no processo", c?.status === "CONFIRMADO" && c?.dados != null && c?.purgadoEm === null && c?.arquivos.length === 1 && storage.has(C.chave))
  ok("link ATIVO → nunca (mesmo com envio antigo)", d?.status === "PENDENTE" && d?.dados != null && storage.has(D.chave))
  const e2 = await env(E2.envioId), e3 = await env(E3.envioId), c2 = await env(C2.envioId)
  ok("PENDENTE de link fechado MANUALMENTE há 100 dias → apagado (dados, cpf e arquivo) e vira DESCARTADO", e?.dados === null && e?.cpf === null && e?.status === "DESCARTADO" && e?.arquivos.length === 0 && !storage.has(E.chave))
  ok("PENDENTE de link encerrado por CONFERÊNCIA há 40 dias → apagado", e2?.dados === null && e2?.status === "DESCARTADO" && !storage.has(E2.chave))
  ok("PENDENTE de link manual com só 10 dias → intacto (a contagem é de 30)", e3?.status === "PENDENTE" && e3?.dados != null && storage.has(E3.chave))
  ok("CONFIRMADO de link fechado manualmente → NUNCA apagado", c2?.status === "CONFIRMADO" && c2?.dados != null && c2?.purgadoEm === null && storage.has(C2.chave))
  ok("DESCARTADO continua sendo purgado aos 30 dias (como antes)", f?.dados === null && f?.purgadoEm != null && !storage.has(F.chave))
  ok("4 envios purgados (3 pendentes por prazo + 1 descartado)", r.envios === 4 && r.pendentesPorPrazo === 3 && apagadas.length === 4)
  const aud = await prisma.logAuditoria.findFirst({ where: { acao: "COLETA_PENDENTE_PURGADO_POR_PRAZO", entidadeId: A.envioId } })
  ok("auditoria do pendente purgado existe e NÃO leva dado pessoal (nem CPF nem nome)", !!aud && !JSON.stringify(aud).includes("Fulano") && !JSON.stringify(aud).includes(cpfDeA) && JSON.stringify(aud.detalhes).includes(String(A.linkId)))
  const r2 = await purgarEnviosDescartados(AGORA, apagar)
  ok("idempotente: rodar de novo não apaga nada", r2.envios === 0 && apagadas.length === 4)
  // 31 dias depois do dia seguinte, o de 29 dias vira candidato
  const r3 = await purgarEnviosDescartados(new Date(AGORA.getTime() + 2 * 86_400_000), apagar)
  ok("o de 29 dias é purgado quando completa mais de 30 (dois dias depois)", r3.pendentesPorPrazo === 1 && !storage.has(B.chave))

  console.log("o link de processo que JÁ saiu da fase mas ninguém abriu")
  const G = await cenario({ fase: "genealogia", link: { encerradoEm: null, criadoEm: diasAtras(80) }, envio: { status: "PENDENTE" } })   // saiu há 40 dias
  await prisma.phaseAdvanceLog.create({ data: { processoId: G.procId, faseAtual: "a_iniciar", fasePretendida: "genealogia", regrasAvaliadas: [], pendencias: [], resultado: "MOVIDO", origem: "teste", correlationId: `${MARCA}-g`, chaveIdempotencia: `${MARCA}-g-${Date.now()}`, criadoEm: diasAtras(40) } })
  const H = await cenario({ fase: "a_iniciar", link: { encerradoEm: null, criadoEm: diasAtras(10) }, envio: { status: "PENDENTE" } })       // continua na fase: link segue ativo
  const I = await cenario({ fase: "genealogia", link: { encerradoEm: null, criadoEm: diasAtras(5) }, envio: { status: "PENDENTE" } })      // saiu SEM registro: encerra agora
  storage.add(G.chave); storage.add(H.chave); storage.add(I.chave)
  const rr = await rodarRetencaoDaColeta(AGORA, apagar)
  const lg = await prisma.coletaLink.findUnique({ where: { id: G.linkId } }), lh = await prisma.coletaLink.findUnique({ where: { id: H.linkId } }), li = await prisma.coletaLink.findUnique({ where: { id: I.linkId } })
  ok("link de processo que saiu da fase é carimbado FASE_MUDOU com a data REAL da saída (40 dias atrás)", lg?.motivoEncerramento === "FASE_MUDOU" && lg?.encerradoEm != null && Math.abs(lg.encerradoEm.getTime() - diasAtras(40).getTime()) < 1000)
  ok("…e, como já passou de 30 dias da saída, o pendente dele é apagado na mesma rotina", !storage.has(G.chave) && rr.pendentesPorPrazo >= 1)
  ok("link de processo que continua em Aguardando fechamento segue ATIVO e intacto", lh?.encerradoEm === null && storage.has(H.chave))
  ok("saída sem registro no motor: encerra com a data de agora (a contagem não começa antes) e o pendente fica", li?.encerradoEm != null && Math.abs(li.encerradoEm.getTime() - AGORA.getTime()) < 1000 && storage.has(I.chave))
  const r4 = await encerrarLinksDeProcessosQueSairamDaFase(AGORA)
  ok("carimbar é idempotente", r4.encerrados === 0)

  console.log("extra de relatório: link ativo há mais de 90 dias com pendentes (só aviso)")
  const antigos = linksAtivosAntigosComPendentes([
    { linkId: 1, processoId: 10, criadoEm: diasAtras(91), pendentes: 2 },   // entra
    { linkId: 2, processoId: 11, criadoEm: diasAtras(90), pendentes: 1 },   // exatamente 90: não (precisa passar)
    { linkId: 3, processoId: 12, criadoEm: diasAtras(300), pendentes: 0 },  // sem pendente: não
    { linkId: 4, processoId: 13, criadoEm: diasAtras(200), pendentes: 5 },  // entra, o mais antigo primeiro
  ], AGORA)
  ok("lista só os com mais de 90 dias E pendentes, do mais antigo para o mais novo", antigos.map((l) => l.linkId).join() === "4,1" && antigos[0].diasAtivo === 200 && antigos[0].pendentes === 5)
  ok("o limite é de 90 dias", DIAS_LINK_ATIVO_ANTIGO === 90)
  const conf = readFileSync("src/services/conferidor-orfaos.ts", "utf8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n")
  ok("o conferidor continua sem apagar NADA (nenhuma exclusão no arquivo)", !/DeleteObject|removerObjeto|apagarChaves|apagarObjeto|\.delete\(|\.deleteMany\(|DELETE FROM/i.test(conf))

  await limpar()
  await prisma.$disconnect()
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  process.exit(falhou ? 1 : 0)
}
void main()
