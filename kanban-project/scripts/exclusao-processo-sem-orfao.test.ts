// scripts/exclusao-processo-sem-orfao.test.ts
// ============================================================================
// PROVA POR IDs — excluir um PROCESSO DE TESTE não deixa objeto órfão no storage.
// O storage é UM FAKE em memória (nenhum byte vai ao R2); o banco é o de TESTE (cria e apaga só o que ele mesmo criou).
//   PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/exclusao-processo-sem-orfao.test.ts
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { excluirProcesso, analisarExclusaoProcesso } from "@/src/services/processo-ciclo-vida"

const MARCA = "ORFAO-TEST"
const BASE = "https://pub-teste.r2.dev"
process.env.R2_PUBLIC_URL = BASE

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}${x ? ` — ${x}` : ""}`) } else { falhou++; console.log(`  ❌ ${n}${x ? ` — ${x}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const ids = procs.map((p) => p.id)
  const obrs = await prisma.obrigacaoEconomica.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.receitaDocumento.deleteMany({ where: { OR: [{ obrigacaoId: { in: obrs.map((o) => o.id) } }, { arquivoNome: { startsWith: MARCA } }] } })
  await prisma.anexoContratante.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.obrigacaoEconomica.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.contratante.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Processo", descricao: { contains: "processo " }, entidadeId: { in: ids } } })
}

async function main() {
  exigirBancoDeTeste("exclusao-processo-sem-orfao.test.ts")
  await limpar()

  // ── A REGRA DE CASCATA, lida do próprio banco (o que a proposta deixou "a conferir") ───────────────────────────────────────
  secao("Regra de cascata (pg_constraint do banco de teste = o mesmo schema das migrations de produção)")
  const tipo = async (filho: string, pai: string) => (await prisma.$queryRawUnsafe<Array<{ t: string }>>(`SELECT c.confdeltype AS t FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_class pl ON pl.oid=c.confrelid WHERE c.contype='f' AND cl.relname='${filho}' AND pl.relname='${pai}'`)).map((r) => r.t)
  ok("DocumentoGerado.processoId → Processo é SET NULL (o documento gerado SOBREVIVE à exclusão do processo)", (await tipo("DocumentoGerado", "Processo")).includes("n"))
  ok("DocumentoGeradoVersao → DocumentoGerado é CASCADE (versões somem se o documento gerado for apagado)", (await tipo("DocumentoGeradoVersao", "DocumentoGerado")).includes("c"))
  ok("ColetaLink→Processo, ColetaEnvio→ColetaLink, ColetaArquivo→ColetaEnvio, AnexoProcesso→Processo, Protocolo→Processo, AnexoProtocolo→Protocolo, Recibo→Processo: todos CASCADE",
    (await tipo("ColetaLink", "Processo")).includes("c") && (await tipo("ColetaEnvio", "ColetaLink")).includes("c") && (await tipo("ColetaArquivo", "ColetaEnvio")).includes("c")
    && (await tipo("AnexoProcesso", "Processo")).includes("c") && (await tipo("Protocolo", "Processo")).includes("c") && (await tipo("AnexoProtocolo", "Protocolo")).includes("c") && (await tipo("Recibo", "Processo")).includes("c"))
  ok("ReceitaDocumento.obrigacaoId NÃO tem chave estrangeira (sem cascata: a linha ficaria órfã)", (await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int n FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.contype='f' AND cl.relname='ReceitaDocumento' AND a.attname='obrigacaoId'`))[0].n === 0)

  // ── O PROCESSO DE TESTE, com arquivo em cada lugar ─────────────────────────────────────────────────────────────────────────
  secao("Processo de teste com arquivos em todas as fontes")
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo` }, select: { id: true } })
  const cli = await prisma.contratante.create({ data: { nome: `${MARCA} cliente` } as never, select: { id: true } })
  const chaves = {
    coleta: `privado/coleta/${proc.id}/uuid-1/rg.png`,
    anexoProc: `documentos/${proc.id}/anexo.pdf`,
    anexoProt: `documentos/${proc.id}/protocolo.pdf`,
    finObr: `documentos/${proc.id}/comprovante.png`,
    recibo: `documentos/${proc.id}/recibo.pdf`,
    compartilhada: `documentos/${proc.id}/compartilhada.pdf`,   // o MESMO endereço também num anexo de CLIENTE (que sobrevive)
    doCliente: `documentos/cliente-${proc.id}/ficha.pdf`,
    estranha: `documentos/outro-processo/estranha.pdf`,
  }
  const url = (k: string) => `${BASE}/${k.split("/").map(encodeURIComponent).join("/")}`
  const link = await prisma.coletaLink.create({ data: { codigo: `${MARCA}-${Date.now()}-${proc.id}`, processoId: proc.id }, select: { id: true } })
  const envio = await prisma.coletaEnvio.create({ data: { linkId: link.id, papel: "REQUERENTE", consentimentoEm: new Date(), consentimentoVersao: "t" }, select: { id: true } })
  await prisma.coletaArquivo.create({ data: { envioId: envio.id, tipo: "IDENTIDADE", chave: chaves.coleta, nome: "rg.png", tamanho: 1, mime: "image/png" } })
  await prisma.anexoProcesso.create({ data: { nome: `${MARCA} a`, tipo: "x", nomeArquivo: "anexo.pdf", urlArquivo: url(chaves.anexoProc), processoId: proc.id } })
  await prisma.anexoProcesso.create({ data: { nome: `${MARCA} b`, tipo: "x", nomeArquivo: "compartilhada.pdf", urlArquivo: url(chaves.compartilhada), processoId: proc.id } })
  const prot = await prisma.protocolo.create({ data: { processoId: proc.id }, select: { id: true } })
  await prisma.anexoProtocolo.create({ data: { nome: `${MARCA} p`, nomeArquivo: "protocolo.pdf", urlArquivo: url(chaves.anexoProt), protocoloId: prot.id } })
  const obr = await prisma.obrigacaoEconomica.create({ data: { processoId: proc.id, natureza: "RECEITA", direcao: "ENTRADA", codigoOperacional: `${MARCA}-OBR`, moedaContratual: "BRL", moedaContabil: "BRL", valorContratado: "10.00" }, select: { id: true } })
  const docFin = await prisma.receitaDocumento.create({ data: { obrigacaoId: obr.id, receitaId: null, arquivoUrl: url(chaves.finObr), arquivoNome: `${MARCA} comprovante.png`, tipo: "comprovante" }, select: { id: true } })
  await prisma.recibo.create({ data: { processoId: proc.id, numero: `${MARCA}-${Date.now()}`.slice(0, 20), valorTotal: "10.00", descricao: "t", pdfUrl: url(chaves.recibo) } })
  const anexoCliente = await prisma.anexoContratante.create({ data: { nome: `${MARCA} cliente`, nomeArquivo: "ficha.pdf", urlArquivo: url(chaves.doCliente), contratanteId: cli.id }, select: { id: true } })
  const anexoClienteMesmoEndereco = await prisma.anexoContratante.create({ data: { nome: `${MARCA} cliente 2`, nomeArquivo: "compartilhada.pdf", urlArquivo: url(chaves.compartilhada), contratanteId: cli.id }, select: { id: true } })

  const storage = new Set<string>(Object.values(chaves))
  const apagados: string[] = []
  const falhasDe = new Map<string, number>()
  const apagarObjeto = async (k: string) => { if ((falhasDe.get(k) ?? 0) > 0) { falhasDe.set(k, falhasDe.get(k)! - 1); throw new Error("storage fora do ar") } storage.delete(k); apagados.push(k) }

  const plano = await analisarExclusaoProcesso(proc.id)
  ok("o plano (preview) já conta os arquivos que sairão do storage", plano?.arquivosNoStorage === 6, String(plano?.arquivosNoStorage))

  // uma chave falha 2x e na 3ª apaga (nova tentativa)
  falhasDe.set(chaves.anexoProt, 2)
  const r = await excluirProcesso({ processoId: proc.id, actorUserId: null, apagarObjeto, novaTentativa: { tentativas: 3, esperaMs: 1 } })

  secao("Depois da exclusão")
  ok("a exclusão deu certo", r.ok === true)
  ok("o processo não existe mais", (await prisma.processo.findUnique({ where: { id: proc.id } })) === null)
  const deviamSair = [chaves.coleta, chaves.anexoProc, chaves.anexoProt, chaves.finObr, chaves.recibo]
  ok("NENHUM dos 5 objetos exclusivos do processo sobrou no storage (prova por chave)", deviamSair.every((k) => !storage.has(k)), deviamSair.filter((k) => storage.has(k)).join(", "))
  ok("a chave que falhou 2x foi apagada na nova tentativa", !storage.has(chaves.anexoProt) && r.arquivos?.falhas.length === 0)
  ok("o resultado reporta 6 levantadas, 5 apagadas e 1 preservada", r.arquivos?.levantadas === 6 && r.arquivos?.apagadas === 5 && r.arquivos?.aindaReferenciadas.length === 1, `${r.arquivos?.levantadas}/${r.arquivos?.apagadas}`)
  ok("a chave que um anexo de CLIENTE ainda usa FICA (apagar quebraria o anexo que sobrou)", storage.has(chaves.compartilhada) && !apagados.includes(chaves.compartilhada) && (r.arquivos?.aindaReferenciadas ?? []).includes(chaves.compartilhada))
  ok("o arquivo do cliente e o de outro processo ficaram intactos", storage.has(chaves.doCliente) && storage.has(chaves.estranha))
  ok("os anexos do cliente continuam no banco", (await prisma.anexoContratante.count({ where: { id: { in: [anexoCliente.id, anexoClienteMesmoEndereco.id] } } })) === 2)
  ok("o documento financeiro SÓ com obrigacaoId (sem cascata) foi apagado junto — nenhuma linha órfã", (await prisma.receitaDocumento.findUnique({ where: { id: docFin.id } })) === null)

  const log = await prisma.logAuditoria.findFirst({ where: { acao: "processo_excluido_definitivo", entidadeId: proc.id }, orderBy: { id: "desc" } })
  const det = log?.detalhes as { arquivosNoStorage?: { total: number; chaves: Array<{ chave: string }> } } | null
  ok("a auditoria da exclusão registra as CHAVES levantadas (antes de apagar)", det?.arquivosNoStorage?.total === 6, JSON.stringify(det?.arquivosNoStorage?.total))
  ok("…e inclui cada chave do processo", deviamSair.every((k) => det?.arquivosNoStorage?.chaves.some((c) => c.chave === k)))
  const logApagar = await prisma.logAuditoria.findFirst({ where: { acao: "processo_arquivos_apagados", entidadeId: proc.id } })
  ok("e há uma segunda linha de auditoria com o resultado do apagar", !!logApagar)

  // ── FALHA PERSISTENTE: registra, reporta, não lança ────────────────────────────────────────────────────────────────────────
  secao("Falha persistente no storage: a exclusão vale, a falha é registrada e reportada")
  const p2 = await prisma.processo.create({ data: { nome: `${MARCA} processo 2` }, select: { id: true } })
  const k2 = `documentos/${p2.id}/preso.pdf`
  await prisma.anexoProcesso.create({ data: { nome: `${MARCA} x`, tipo: "x", nomeArquivo: "preso.pdf", urlArquivo: url(k2), processoId: p2.id } })
  const storage2 = new Set([k2])
  const r2 = await excluirProcesso({ processoId: p2.id, actorUserId: null, apagarObjeto: async () => { throw new Error("negado") }, novaTentativa: { tentativas: 2, esperaMs: 1 } })
  ok("a exclusão do processo vale mesmo com o storage falhando", r2.ok === true && (await prisma.processo.findUnique({ where: { id: p2.id } })) === null)
  ok("a falha vem no resultado (chave + motivo + tentativas)", r2.arquivos?.falhas.length === 1 && r2.arquivos.falhas[0].chave === k2 && r2.arquivos.falhas[0].tentativas === 2 && storage2.has(k2))
  const logFalha = await prisma.logAuditoria.findFirst({ where: { acao: "processo_arquivos_nao_apagados", entidadeId: p2.id } })
  ok("e fica na auditoria como 'não apagados' (para o conferidor e para o dono)", !!logFalha && JSON.stringify(logFalha.detalhes).includes(k2))

  // ── processo sem arquivo nenhum ─────────────────────────────────────────────────────────────────────────────────────────────
  const p3 = await prisma.processo.create({ data: { nome: `${MARCA} processo 3` }, select: { id: true } })
  const r3 = await excluirProcesso({ processoId: p3.id, actorUserId: null, apagarObjeto: async () => { throw new Error("não devia ser chamado") } })
  ok("processo sem arquivo: nada a apagar e nenhuma chamada ao storage", r3.ok && r3.arquivos?.levantadas === 0 && r3.arquivos.apagadas === 0)

  await limpar()
  await prisma.$disconnect()
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  process.exit(falhou ? 1 : 0)
}
void main()
