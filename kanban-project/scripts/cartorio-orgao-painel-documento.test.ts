// scripts/cartorio-orgao-painel-documento.test.ts
// ============================================================================
// Campo "Cartório" do painel do documento: busca no cadastro, cadastro inline,
// texto livre legado "a mapear" e bloqueio de duplicado (29/09/2026).
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { signAuthToken } from "@/lib/auth-jwt"
import { POST as postOrgaoDoc } from "@/src/app/api/documentos/[id]/orgao/route"
import { GET as getBusca } from "@/src/app/api/operacao/orgaos/busca/route"
import { GET as getAMapear } from "@/src/app/api/operacao/orgaos-a-mapear/route"
import { PUT as putDocumento } from "@/src/app/api/documentos/[id]/route"

const MARCA = "CARTPAINEL"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvore: { nome: { startsWith: MARCA } } } } })
  await prisma.pessoa.deleteMany({ where: { arvore: { nome: { startsWith: MARCA } } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.logAuditoria.deleteMany({ where: { acao: "ORGAO_CRIADO_PAINEL_DOCUMENTO", descricao: { contains: MARCA } } })
  await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
}

const req = (method: string, url: string, token: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) })

async function main() {
  exigirBancoDeTeste("cartorio-orgao-painel-documento.test.ts")
  await limpar()
  console.log("Cartório do painel do documento — busca, cadastro inline, a mapear, duplicado\n")

  const admin = await prisma.usuario.create({ data: { nome: "Admin Cart", email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" }, select: { id: true } })
  const token = await signAuthToken({ userId: admin.id, email: `admin@${MARCA.toLowerCase()}.test`, tipo: "admin", sessaoInicio: Date.now() })

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { nome: `${MARCA} Antão`, arvoreId: arv.id }, select: { id: true } })
  const novoDoc = async (cartorio: string | null) => {
    const d = await prisma.documento.create({ data: { pessoaId: pessoa.id, tipo: "CERTIDAO_NASCIMENTO_INTEIRO_TEOR", status: "SOLICITAR", cartorio }, select: { id: true } })
    const t = await prisma.tarefa.create({ data: { titulo: `${MARCA} tarefa ${d.id}`, documentoId: d.id }, select: { id: true } })
    return { docId: d.id, tarefaId: t.id }
  }
  const existente = await prisma.orgaoProtocolo.create({ data: { name: `${MARCA} Santos - 2º Subdistrito`, type: "cartorio", city: "Santos", state: "SP" }, select: { id: true } })

  // 1) BUSCA + selecionar existente
  console.log("1) Selecionar existente")
  const busca = await (await getBusca(req("GET", `/api/operacao/orgaos/busca?q=${encodeURIComponent(`${MARCA} Santos`)}`, token))).json()
  ok("busca por nome+cidade acha o órgão", busca.orgaos.some((o: { id: number }) => o.id === existente.id))
  const buscaUf = await (await getBusca(req("GET", `/api/operacao/orgaos/busca?q=${MARCA}&uf=RJ`, token))).json()
  ok("filtro de UF exclui", !buscaUf.orgaos.some((o: { id: number }) => o.id === existente.id))
  const a = await novoDoc(`${MARCA} Santos texto`)
  const rSel = await postOrgaoDoc(req("POST", `/api/documentos/${a.docId}/orgao`, token, { orgaoId: existente.id }), ctx(a.docId))
  const jSel = await rSel.json()
  const da = await prisma.documento.findUnique({ where: { id: a.docId }, select: { orgaoId: true } })
  const ta = await prisma.tarefa.findUnique({ where: { id: a.tarefaId }, select: { orgaoId: true } })
  ok("vincula Documento.orgaoId", rSel.status === 200 && da?.orgaoId === existente.id)
  ok("vincula Tarefa.orgaoId na mesma porta", ta?.orgaoId === existente.id, `tarefas=${jSel.tarefasVinculadas}`)
  const rInv = await postOrgaoDoc(req("POST", `/api/documentos/${a.docId}/orgao`, token, { orgaoId: 99999999 }), ctx(a.docId))
  ok("órgão inexistente é 404, nada muda", rInv.status === 404 && (await prisma.documento.findUnique({ where: { id: a.docId }, select: { orgaoId: true } }))?.orgaoId === existente.id)

  // 2) CADASTRAR NOVO E VINCULAR
  console.log("\n2) Cadastrar novo e vincular")
  const b = await novoDoc(null)
  const rIncompleto = await postOrgaoDoc(req("POST", `/api/documentos/${b.docId}/orgao`, token, { novo: { name: `${MARCA} X`, tipo: "CARTORIO", city: "" } }), ctx(b.docId))
  ok("nome+tipo+cidade obrigatórios", rIncompleto.status === 400 && (await rIncompleto.json()).code === "CAMPOS_OBRIGATORIOS")
  const rTipo = await postOrgaoDoc(req("POST", `/api/documentos/${b.docId}/orgao`, token, { novo: { name: `${MARCA} X`, tipo: "ZZZ", city: "Santos" } }), ctx(b.docId))
  ok("tipo fora de CARTORIO/CONSULADO/JUIZO/OUTRO é recusado", rTipo.status === 400)
  const novo = { name: `${MARCA} Santos - 1º Subdistrito`, tipo: "CARTORIO", city: "Santos", state: "SP", email: "s1@x.test", telefone: "1333" }
  const rNovo = await postOrgaoDoc(req("POST", `/api/documentos/${b.docId}/orgao`, token, { novo }), ctx(b.docId))
  const jNovo = await rNovo.json()
  ok("cria (201/200) e devolve criado", rNovo.status === 200 && jNovo.criado === true)
  const org = await prisma.orgaoProtocolo.findFirst({ where: { name: novo.name } })
  ok("OrgaoProtocolo gravado com tipo/cidade/UF/contato", org?.type === "cartorio" && org.city === "Santos" && org.state === "SP" && org.email === "s1@x.test" && org.telefone === "1333")
  const db = await prisma.documento.findUnique({ where: { id: b.docId }, select: { orgaoId: true } })
  const tb = await prisma.tarefa.findUnique({ where: { id: b.tarefaId }, select: { orgaoId: true } })
  ok("Documento.orgaoId e Tarefa.orgaoId preenchidos", !!org && db?.orgaoId === org.id && tb?.orgaoId === org.id)

  // 4) DUPLICADO
  console.log("\n3) Bloqueio de duplicado")
  const c = await novoDoc(null)
  const dup = { ...novo, name: `${MARCA.toLowerCase()} SANTOS – 1o subdistrito`.replace("–", "-").replace("1o", "1º") }
  const rDup = await postOrgaoDoc(req("POST", `/api/documentos/${c.docId}/orgao`, token, { novo: { ...dup, name: novo.name.toUpperCase() } }), ctx(c.docId))
  const jDup = await rDup.json()
  ok("nome normalizado igual na mesma cidade/UF → 409 DUPLICADO com o existente", rDup.status === 409 && jDup.code === "DUPLICADO" && jDup.existente?.id === org?.id)
  ok("não criou segundo órgão", (await prisma.orgaoProtocolo.count({ where: { name: { startsWith: `${MARCA} Santos - 1` } } })) === 1
    && (await prisma.orgaoProtocolo.count({ where: { name: novo.name.toUpperCase() } })) === 0)
  ok("documento segue sem órgão após o bloqueio", (await prisma.documento.findUnique({ where: { id: c.docId }, select: { orgaoId: true } }))?.orgaoId == null)
  const rUsa = await postOrgaoDoc(req("POST", `/api/documentos/${c.docId}/orgao`, token, { orgaoId: jDup.existente.id }), ctx(c.docId))
  ok("usar o existente vincula", rUsa.status === 200 && (await prisma.documento.findUnique({ where: { id: c.docId }, select: { orgaoId: true } }))?.orgaoId === org?.id)
  const outraCidade = await postOrgaoDoc(req("POST", `/api/documentos/${c.docId}/orgao`, token, { novo: { ...novo, name: `${MARCA} Santos - 1º Subdistrito B`, city: "Guarujá" } }), ctx(c.docId))
  ok("nome diferente é cadastro novo (sem falso positivo)", outraCidade.status === 200)

  // 3) TEXTO LIVRE LEGADO → a mapear
  console.log("\n4) Texto livre legado")
  const l1 = await novoDoc(`${MARCA} Cartório Legado Lençóis`)
  const l2 = await novoDoc(`${MARCA.toLowerCase()} cartorio legado lencois`)
  const jMap = await (await getAMapear(req("GET", "/api/operacao/orgaos-a-mapear", token))).json()
  const grupo = jMap.grupos.find((g: { texto: string }) => g.texto.toLowerCase().includes("legado len"))
  ok("texto sem orgaoId aparece agrupado com contagem", !!grupo && grupo.documentos === 2 && grupo.tarefas === 2, JSON.stringify(grupo && { d: grupo.documentos, t: grupo.tarefas }))
  ok("documento já vinculado NÃO aparece", !jMap.grupos.some((g: { texto: string }) => g.texto.includes("Santos texto")))
  // PUT do documento (outra porta) também espelha na Tarefa
  const rPut = await putDocumento(req("PUT", `/api/documentos/${l1.docId}`, token, { orgaoId: existente.id }), ctx(l1.docId))
  ok("PUT documento com orgaoId espelha Tarefa.orgaoId", rPut.status === 200 && (await prisma.tarefa.findUnique({ where: { id: l1.tarefaId }, select: { orgaoId: true } }))?.orgaoId === existente.id)
  const jMap2 = await (await getAMapear(req("GET", "/api/operacao/orgaos-a-mapear", token))).json()
  const g2 = jMap2.grupos.find((g: { texto: string }) => g.texto.toLowerCase().includes("legado len"))
  ok("após vincular um, o grupo cai para 1", g2?.documentos === 1 && g2.documentoIds.includes(l2.docId))

  await limpar()
  console.log(`\n${passou} ok, ${falhou} falha(s)`)
  if (falhou) { console.log(falhas.map((f) => ` - ${f}`).join("\n")); process.exit(1) }
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await limpar().catch(() => null); process.exit(1) })
