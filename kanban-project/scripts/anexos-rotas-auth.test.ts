// scripts/anexos-rotas-auth.test.ts
// ============================================================================
// ROTAS DE ANEXO EXIGEM LOGIN + PERMISSÃO (/api/anexos GET/POST/DELETE e /api/protocolos/[id]/anexos GET/POST/DELETE + [anexoId]).
//   sem login → 401 · logado sem permissão → 403 · logado com permissão → funciona · DELETE audita e apaga o objeto DEPOIS do commit.
// Perfil, usuário e JWT REAIS no banco de TESTE. O storage é um FAKE injetado (nenhum byte vai ao R2).
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(48)
import { prisma } from "@/lib/prisma"
import { signAuthToken } from "@/lib/auth-jwt"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { excluirAnexos } from "@/src/services/anexos-exclusao"
import * as rotaAnexos from "@/src/app/api/anexos/route"
import * as rotaProtocolo from "@/src/app/api/protocolos/[protocoloId]/anexos/route"
import * as rotaProtocoloUm from "@/src/app/api/protocolos/[protocoloId]/anexos/[anexoId]/route"
import { NextRequest } from "next/server"
import { readFileSync } from "node:fs"

const MARCA = "ANEXO-AUTH-TEST"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}${x ? ` — ${x}` : ""}`) } else { falhou++; console.log(`  ❌ ${n}${x ? ` — ${x}` : ""}`) } }
const TS = Date.now()

const req = (url: string, metodo = "GET", token?: string, body?: unknown) =>
  new NextRequest(`http://t${url}`, { method: metodo, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })

async function limpar() {
  await prisma.anexoContratante.deleteMany({ where: { nome: { startsWith: MARCA } } })
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  await prisma.processo.deleteMany({ where: { id: { in: procs.map((p) => p.id) } } })
  await prisma.contratante.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { startsWith: "anexoauth-" } } })
  await prisma.perfil.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.logAuditoria.deleteMany({ where: { acao: { in: ["anexo_excluido", "anexo_arquivos_apagados", "anexo_arquivos_nao_apagados"] }, descricao: { contains: "(Anexo" }, criadoEm: { gte: new Date(TS - 1000) } } })
}

async function usuarioCom(nome: string, permissoes: Record<string, boolean>) {
  const perfil = await prisma.perfil.create({ data: { nome: `${MARCA} ${nome} ${TS}`, descricao: "t", permissoes }, select: { id: true } })
  const email = `anexoauth-${nome}-${TS}@t.t`
  const u = await prisma.usuario.create({ data: { nome, email, senha: "x", tipo: "operador", perfilId: perfil.id }, select: { id: true } })
  return { id: u.id, token: await signAuthToken({ userId: u.id, email, tipo: "operador" }) }
}

async function main() {
  exigirBancoDeTeste("anexos-rotas-auth.test.ts")
  await limpar()

  const dono = await usuarioCom("dono", { "clientes.ver": true, "clientes.editar": true, "clientes.criar": true, "processos.ver": true, "processos.editar": true, "processos.editar_paginas": true })
  const semNada = await usuarioCom("semnada", {})
  const soVer = await usuarioCom("sover", { "clientes.ver": true, "processos.ver": true })

  const cli = await prisma.contratante.create({ data: { nome: `${MARCA} cliente` } as never, select: { id: true } })
  const outro = await prisma.contratante.create({ data: { nome: `${MARCA} outro` } as never, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} proc` }, select: { id: true } })
  const prot = await prisma.protocolo.create({ data: { processoId: proc.id }, select: { id: true } })
  const mk = (n: string, url: string, contratanteId = cli.id) => prisma.anexoContratante.create({ data: { nome: `${MARCA} ${n}`, nomeArquivo: `${n}.pdf`, urlArquivo: url, contratanteId }, select: { id: true } })
  const mkP = (n: string, url: string) => prisma.anexoProtocolo.create({ data: { nome: `${MARCA} ${n}`, nomeArquivo: `${n}.pdf`, urlArquivo: url, protocoloId: prot.id }, select: { id: true } })

  console.log("\n/api/anexos — GET")
  ok("sem login → 401", (await rotaAnexos.GET(req(`/api/anexos?id=${cli.id}`))).status === 401)
  ok("logado sem permissão → 403", (await rotaAnexos.GET(req(`/api/anexos?id=${cli.id}`, "GET", semNada.token))).status === 403)
  ok("logado com clientes.ver → 200", (await rotaAnexos.GET(req(`/api/anexos?id=${cli.id}`, "GET", soVer.token))).status === 200)

  console.log("\n/api/anexos — POST")
  const corpo = (url: string, id = cli.id) => ({ nomeArquivo: `${MARCA}.pdf`, nome: `${MARCA} novo`, urlArquivo: url, tipoCliente: "contratante", contratanteId: String(id) })
  ok("sem login → 401", (await rotaAnexos.POST(req("/api/anexos", "POST", undefined, corpo("https://ext.example/a.pdf")))).status === 401)
  ok("logado sem permissão → 403", (await rotaAnexos.POST(req("/api/anexos", "POST", semNada.token, corpo("https://ext.example/a.pdf")))).status === 403)
  ok("só ver (sem criar/editar) → 403", (await rotaAnexos.POST(req("/api/anexos", "POST", soVer.token, corpo("https://ext.example/a.pdf")))).status === 403)
  ok("chave de OUTRO cliente colada neste → 403", (await rotaAnexos.POST(req("/api/anexos", "POST", dono.token, corpo(`privado/anexos/contratante/${outro.id}/1-aaaa-x.pdf`)))).status === 403)
  ok("chave do próprio cliente → 201", (await rotaAnexos.POST(req("/api/anexos", "POST", dono.token, corpo(`privado/anexos/contratante/${cli.id}/1-aaaa-x.pdf`)))).status === 201)

  console.log("\n/api/anexos — DELETE")
  const a1 = await mk("a1", "https://ext.example/a1.pdf")
  ok("sem login → 401 e a linha continua", (await rotaAnexos.DELETE(req(`/api/anexos?id=${a1.id}`, "DELETE"))).status === 401 && !!(await prisma.anexoContratante.findUnique({ where: { id: a1.id } })))
  ok("logado sem permissão → 403 e a linha continua", (await rotaAnexos.DELETE(req(`/api/anexos?id=${a1.id}`, "DELETE", soVer.token))).status === 403 && !!(await prisma.anexoContratante.findUnique({ where: { id: a1.id } })))
  const r = await rotaAnexos.DELETE(req(`/api/anexos?id=${a1.id}`, "DELETE", dono.token))
  ok("logado com clientes.editar → 200 e a linha some", r.status === 200 && !(await prisma.anexoContratante.findUnique({ where: { id: a1.id } })))
  const aud = await prisma.logAuditoria.findFirst({ where: { acao: "anexo_excluido", entidade: "AnexoContratante", entidadeId: a1.id } })
  ok("LogAuditoria: quem (usuarioId), qual chave e quando", aud?.usuarioId === dono.id && JSON.stringify(aud.detalhes).includes("ANEXO-AUTH-TEST a1") && JSON.stringify(aud.detalhes).includes("chave") && JSON.stringify(aud.detalhes).includes('"em"'))
  ok("anexo inexistente → 404", (await rotaAnexos.DELETE(req(`/api/anexos?id=${a1.id}`, "DELETE", dono.token))).status === 404)

  console.log("\n/api/protocolos/[id]/anexos")
  const pc = ctx({ protocoloId: String(prot.id) })
  ok("GET sem login → 401", (await rotaProtocolo.GET(req("/x"), pc)).status === 401)
  ok("GET sem permissão → 403", (await rotaProtocolo.GET(req("/x", "GET", semNada.token), pc)).status === 403)
  ok("GET com processos.ver → 200", (await rotaProtocolo.GET(req("/x", "GET", soVer.token), pc)).status === 200)
  const bodyP = (url: string) => ({ nomeArquivo: "p.pdf", urlArquivo: url })
  ok("POST sem login → 401", (await rotaProtocolo.POST(req("/x", "POST", undefined, bodyP("https://ext.example/p.pdf")), pc)).status === 401)
  ok("POST sem permissão → 403", (await rotaProtocolo.POST(req("/x", "POST", soVer.token, bodyP("https://ext.example/p.pdf")), pc)).status === 403)
  ok("POST com chave de outro protocolo → 403", (await rotaProtocolo.POST(req("/x", "POST", dono.token, bodyP(`privado/anexos/protocolo/${prot.id + 999}/1-aaaa-x.pdf`)), pc)).status === 403)
  ok("POST com chave do próprio protocolo → 201", (await rotaProtocolo.POST(req("/x", "POST", dono.token, bodyP(`privado/anexos/protocolo/${prot.id}/1-aaaa-x.pdf`)), pc)).status === 201)
  const p1 = await mkP("p1", "https://ext.example/p1.pdf")
  const pu = ctx({ protocoloId: String(prot.id), anexoId: String(p1.id) })
  ok("DELETE [anexoId] sem login → 401", (await rotaProtocoloUm.DELETE(req("/x", "DELETE"), pu)).status === 401)
  ok("DELETE [anexoId] sem permissão → 403", (await rotaProtocoloUm.DELETE(req("/x", "DELETE", soVer.token), pu)).status === 403)
  ok("DELETE [anexoId] em OUTRO protocolo → 404", (await rotaProtocoloUm.DELETE(req("/x", "DELETE", dono.token), ctx({ protocoloId: String(prot.id + 999), anexoId: String(p1.id) }))).status === 404 && !!(await prisma.anexoProtocolo.findUnique({ where: { id: p1.id } })))
  ok("DELETE [anexoId] logado no protocolo certo → 200", (await rotaProtocoloUm.DELETE(req("/x", "DELETE", dono.token), pu)).status === 200 && !(await prisma.anexoProtocolo.findUnique({ where: { id: p1.id } })))
  ok("DELETE em massa sem login → 401", (await rotaProtocolo.DELETE(req("/x", "DELETE"), pc)).status === 401)
  ok("DELETE em massa sem permissão → 403", (await rotaProtocolo.DELETE(req("/x", "DELETE", soVer.token), pc)).status === 403)
  await mkP("p2", "https://ext.example/p2.pdf")
  ok("DELETE em massa com permissão → 200 e protocolo fica sem anexos", (await rotaProtocolo.DELETE(req("/x", "DELETE", dono.token), pc)).status === 200 && (await prisma.anexoProtocolo.count({ where: { protocoloId: prot.id } })) === 0)

  console.log("\nServiço: objeto apagado DEPOIS do commit, sem chave órfã")
  process.env.R2_PUBLIC_URL = "https://pub-teste.r2.dev"
  const kA = `privado/anexos/contratante/${cli.id}/1-aaaa-s1.pdf`, kB = `privado/anexos/contratante/${cli.id}/2-bbbb-s2.pdf`
  const s1 = await mk("s1", kA); const s2 = await mk("s2", kB); await mk("s2-copia", kB)
  const apagados: string[] = []; let linhaExistiaNaHora: boolean | null = null
  const res = await excluirAnexos({ tabela: "AnexoContratante", ids: [s1.id, s2.id], donoId: cli.id, usuarioId: dono.id, apagarObjeto: async (k) => { linhaExistiaNaHora = !!(await prisma.anexoContratante.findUnique({ where: { id: s1.id } })); apagados.push(k) } })
  ok("apaga o objeto da linha sem outra referência (kA)", apagados.includes(kA) && res.apagadas.includes(kA))
  ok("NÃO apaga o objeto que outra linha ainda usa (kB)", !apagados.includes(kB) && res.aindaReferenciadas.includes(kB))
  ok("o objeto só é apagado depois que a linha já foi apagada (pós-commit)", linhaExistiaNaHora === false)
  ok("auditoria do apagar registrada", !!(await prisma.logAuditoria.findFirst({ where: { acao: "anexo_arquivos_apagados", usuarioId: dono.id }, orderBy: { id: "desc" } })))
  const s3 = await mk("s3", `privado/anexos/contratante/${cli.id}/3-cccc-s3.pdf`)
  const falha = await excluirAnexos({ tabela: "AnexoContratante", ids: [s3.id], usuarioId: dono.id, apagarObjeto: async () => { throw new Error("negado") }, novaTentativa: { tentativas: 2, esperaMs: 1 } })
  ok("falha no storage: a exclusão vale e a falha é reportada + auditada (nunca em silêncio)", falha.excluidos === 1 && falha.falhas.length === 1 && !!(await prisma.logAuditoria.findFirst({ where: { acao: "anexo_arquivos_nao_apagados", usuarioId: dono.id } })))
  const alheio = await mk("alheio", "https://ext.example/z.pdf", outro.id)
  const trav = await excluirAnexos({ tabela: "AnexoContratante", ids: [alheio.id], donoId: cli.id, usuarioId: dono.id })
  ok("linha de outro dono não é apagada quando o dono informado não confere", trav.excluidos === 0 && !!(await prisma.anexoContratante.findUnique({ where: { id: alheio.id } })))

  console.log("\nTela: toda chamada de /api/anexos manda o token (senão a rota fechada derrubaria a tela)")
  const tela = readFileSync("src/components/contratantes-tabela.tsx", "utf8")
  const chamadas = [...tela.matchAll(/fetch\((?:"\/api\/anexos"|`\/api\/anexos\?[^`]*`)/g)]
  ok("a tela chama /api/anexos", chamadas.length >= 4, String(chamadas.length))
  ok("cada chamada leva authHeaders()/jsonHeaders()", chamadas.every((m) => /authHeaders\(\)|jsonHeaders\(\)/.test(tela.slice(m.index!, m.index! + 200))))

  await limpar()
  await prisma.$disconnect()
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  process.exit(falhou ? 1 : 0)
}
void main()
