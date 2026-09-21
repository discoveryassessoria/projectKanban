// scripts/publicacao-exige-efeitos.test.ts
//
// DEFEITO 2 do mandato "Módulo de Fases" (21/09/2026): "fase publicada sem
// efeitos". Testado diretamente contra a rota real (fase 35, [TESTE VISUAL]
// Chave duplicada, em produção): PUT ativo:true + efeitosPermitidos:[] já
// rejeita com 400/EFEITOS_OBRIGATORIOS_PARA_PUBLICAR no código atualmente
// implantado — não reproduzido. Este teste fixa a garantia contra regressão
// futura, local, sem tocar nada sintético/real.
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("publicacao-exige-efeitos.test.ts")

import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { POST } from "../src/app/api/gerenciamento/catalogo-fases/route"
import { PUT } from "../src/app/api/gerenciamento/catalogo-fases/[id]/route"
import { NextRequest } from "next/server"

const MARCA = "PUBLICAEFEITOS"
let ok = 0, falhou = 0
function check(nome: string, cond: boolean) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) } else { falhou++; console.error(`  ❌ ${nome}`) }
}

async function main() {
  await prisma.usuario.deleteMany({ where: { email: `admin@${MARCA.toLowerCase()}.test` } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: MARCA.toLowerCase() } } })
  const admin = await prisma.usuario.create({ data: { nome: MARCA, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${token}` }

  console.log("\n1) Criar com ativo:true e efeitos:[] — nasce RASCUNHO, nunca publicada por omissão")
  const resCriar = await POST(new NextRequest("http://localhost/api/gerenciamento/catalogo-fases", {
    method: "POST", headers: auth, body: JSON.stringify({ label: `${MARCA}_fase1`, escopo: "PROCESSO", ativo: true, efeitosPermitidos: [] }),
  }))
  const jCriar = await resCriar.json()
  check("criação: 201, mas status=RASCUNHO/ativo=false", resCriar.status === 201 && jCriar.fase.status === "RASCUNHO" && jCriar.fase.ativo === false)
  const faseId = jCriar.fase.id

  console.log("\n2) Publicar sem efeitos (PUT ativo:true, efeitos:[]) — REJEITADO")
  const antesRev = await prisma.catalogoFase.findUniqueOrThrow({ where: { id: faseId } })
  const resPubVazio = await PUT(new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${faseId}`, {
    method: "PUT", headers: auth, body: JSON.stringify({ ativo: true, efeitosPermitidos: [] }),
  }), { params: Promise.resolve({ id: String(faseId) }) })
  const jPubVazio = await resPubVazio.json()
  check("400 + código estável EFEITOS_OBRIGATORIOS_PARA_PUBLICAR", resPubVazio.status === 400 && jPubVazio.code === "EFEITOS_OBRIGATORIOS_PARA_PUBLICAR")
  const depoisRev = await prisma.catalogoFase.findUniqueOrThrow({ where: { id: faseId } })
  check("não criou revisão nova (revisaoAtual inalterado)", depoisRev.revisaoAtual === antesRev.revisaoAtual)
  check("não mudou status/ativo", depoisRev.status === antesRev.status && depoisRev.ativo === antesRev.ativo)
  const revisoes1 = await prisma.catalogoFaseRevisao.count({ where: { catalogoFaseId: faseId } })

  console.log("\n3) Publicar com um efeito — ACEITO")
  const resPubUm = await PUT(new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${faseId}`, {
    method: "PUT", headers: auth, body: JSON.stringify({ ativo: true, efeitosPermitidos: ["REGISTER_ONLY"] }),
  }), { params: Promise.resolve({ id: String(faseId) }) })
  const jPubUm = await resPubUm.json()
  check("200, status=PUBLICADA", resPubUm.status === 200 && jPubUm.fase.status === "PUBLICADA")

  console.log("\n4) Retirar todos os efeitos de fase JÁ publicada — REJEITADO")
  const resRetirar = await PUT(new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${faseId}`, {
    method: "PUT", headers: auth, body: JSON.stringify({ efeitosPermitidos: [] }),
  }), { params: Promise.resolve({ id: String(faseId) }) })
  const jRetirar = await resRetirar.json()
  check("400 EFEITOS_OBRIGATORIOS_PARA_PUBLICAR (fica ativa, não pode ficar sem efeito)", resRetirar.status === 400 && jRetirar.code === "EFEITOS_OBRIGATORIOS_PARA_PUBLICAR")
  const aindaPublicada = await prisma.catalogoFase.findUniqueOrThrow({ where: { id: faseId } })
  check("continua PUBLICADA com o efeito original", aindaPublicada.status === "PUBLICADA" && (aindaPublicada.efeitosPermitidos as string[]).includes("REGISTER_ONLY"))

  console.log("\n5) Requisição direta à API sem token/dados extras, só o payload cru — mesma rejeição")
  const resDireta = await PUT(new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${faseId}`, {
    method: "PUT", headers: auth, body: JSON.stringify({ ativo: true, efeitosPermitidos: [] }),
  }), { params: Promise.resolve({ id: String(faseId) }) })
  check("400 mesmo por chamada direta (não é só a UI que valida)", resDireta.status === 400)

  const revisoesFinal = await prisma.catalogoFaseRevisao.count({ where: { catalogoFaseId: faseId } })
  check("tentativas rejeitadas não geraram revisão extra (só a publicação válida do passo 3)", revisoesFinal === revisoes1 + 1)

  await prisma.catalogoFaseRevisao.deleteMany({ where: { catalogoFaseId: faseId } })
  await prisma.catalogoFase.delete({ where: { id: faseId } })
  await prisma.usuario.delete({ where: { id: admin.id } })

  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  if (falhou > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
