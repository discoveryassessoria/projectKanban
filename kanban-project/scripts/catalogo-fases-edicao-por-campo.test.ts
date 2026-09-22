// scripts/catalogo-fases-edicao-por-campo.test.ts
//
// MANDATO "MÓDULO DE FASES" — item 4 da matriz de blindagem: editar
// label/descricao/ordem/obrigatoriedade/condicionalidade/escopo/efeitos/
// ativo SEPARADAMENTE, provando que mudar UM campo nunca move os outros.
//
// `catalogo-fases-gerenciamento-completo.test.ts` já cobre a maioria destes
// campos em corpos combinados; nenhum teste existente edita um campo por vez
// e prova que os demais preservam o valor ANTERIOR (não o original — os
// PUTs são cumulativos, como um admin editando aos poucos numa sessão real).
// É exatamente o tipo de regressão que pega "editar X reseta Y por engano".
//
// Fixture 100% genérica e sintética própria — nunca TESTEVIS_fase.
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("catalogo-fases-edicao-por-campo.test.ts")

import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { POST } from "../src/app/api/gerenciamento/catalogo-fases/route"
import { PUT } from "../src/app/api/gerenciamento/catalogo-fases/[id]/route"
import { NextRequest } from "next/server"

const MARCA = "EDICAOCAMPO"
let ok = 0, falhou = 0
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; console.error(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

interface Fase {
  id: number; phaseKey: string; label: string; descricao: string | null
  ordemPadrao: number; requiredPadrao: boolean; conditionalPadrao: boolean
  escopo: string | null; efeitosPermitidos: string[] | null; ativo: boolean; status: string
  revisaoAtual: number
}

async function limpar() {
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: MARCA.toLowerCase() } } })
  await prisma.usuario.deleteMany({ where: { email: `admin@${MARCA.toLowerCase()}.test` } })
}

async function main() {
  await limpar()
  const admin = await prisma.usuario.create({ data: { nome: MARCA, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${token}` }

  console.log("\n0) Baseline — fase criada com todos os campos conhecidos, usos=0 (edição de escopo não exige confirmação)")
  const resCriar = await POST(new NextRequest("http://localhost/api/gerenciamento/catalogo-fases", {
    method: "POST", headers: auth,
    body: JSON.stringify({
      label: `${MARCA} Fase Base`, descricao: "Descrição original", escopo: "PROCESSO",
      ordemPadrao: 10, requiredPadrao: true, conditionalPadrao: false, efeitosPermitidos: ["REGISTER_ONLY"],
    }),
  }))
  check("criação aceita", resCriar.status === 201, `status=${resCriar.status}`)
  let atual = (await resCriar.json()).fase as Fase
  const id = atual.id

  // Cada passo muda EXATAMENTE um campo e prova que todo o resto ficou igual
  // ao estado anterior (não ao original — edição é cumulativa, como na UI).
  async function editarUmCampo(nome: string, corpo: Record<string, unknown>, campoMudado: keyof Fase) {
    const res = await PUT(new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${id}`, {
      method: "PUT", headers: auth, body: JSON.stringify(corpo),
    }), { params: Promise.resolve({ id: String(id) }) })
    check(`${nome}: 200`, res.status === 200, `status=${res.status}`)
    const nova = (await res.json()).fase as Fase
    const revisaoAntes = atual.revisaoAtual
    // `status` é derivado de `ativo` (checado à parte); `atualizadoEm` e
    // `revisaoAtual` DEVEM mudar em TODA revisão real — não são "o campo
    // sendo editado", são o metadado de que uma revisão nova nasceu.
    const CAMPOS_DE_META = new Set(["status", "atualizadoEm", "revisaoAtual"])
    for (const campo of Object.keys(atual) as Array<keyof Fase>) {
      if (campo === campoMudado || CAMPOS_DE_META.has(campo)) continue
      const igual = JSON.stringify(nova[campo]) === JSON.stringify(atual[campo])
      check(`${nome}: campo "${campo}" preservado (não mudou por engano)`, igual, `antes=${JSON.stringify(atual[campo])} depois=${JSON.stringify(nova[campo])}`)
    }
    check(`${nome}: revisaoAtual avançou (mudança real gerou revisão nova)`, nova.revisaoAtual === revisaoAntes + 1, `${revisaoAntes} → ${nova.revisaoAtual}`)
    atual = nova
    return nova
  }

  console.log("\n1) Editar SÓ o nome (label)")
  await editarUmCampo("label", { label: `${MARCA} Fase Renomeada` }, "label")
  check("label realmente mudou", atual.label === `${MARCA} Fase Renomeada`, atual.label)

  console.log("\n2) Editar SÓ a descrição")
  await editarUmCampo("descricao", { descricao: "Descrição nova, editada isoladamente" }, "descricao")
  check("descricao realmente mudou", atual.descricao === "Descrição nova, editada isoladamente", atual.descricao ?? "null")

  console.log("\n3) Editar SÓ a ordem")
  await editarUmCampo("ordemPadrao", { ordemPadrao: 77 }, "ordemPadrao")
  check("ordemPadrao realmente mudou", atual.ordemPadrao === 77, String(atual.ordemPadrao))

  console.log("\n4) Editar SÓ a obrigatoriedade (requiredPadrao)")
  await editarUmCampo("requiredPadrao", { requiredPadrao: false }, "requiredPadrao")
  check("requiredPadrao realmente mudou", atual.requiredPadrao === false, String(atual.requiredPadrao))

  console.log("\n5) Editar SÓ a condicionalidade (conditionalPadrao)")
  await editarUmCampo("conditionalPadrao", { conditionalPadrao: true }, "conditionalPadrao")
  check("conditionalPadrao realmente mudou", atual.conditionalPadrao === true, String(atual.conditionalPadrao))

  console.log("\n6) Editar SÓ o escopo (fase sem uso — sem confirmação exigida)")
  await editarUmCampo("escopo", { escopo: "DOCUMENTO" }, "escopo")
  check("escopo realmente mudou", atual.escopo === "DOCUMENTO", atual.escopo ?? "null")

  console.log("\n7) Editar SÓ os efeitos permitidos")
  await editarUmCampo("efeitosPermitidos", { efeitosPermitidos: ["REGISTER_ONLY", "COMPLETE_STEP"] }, "efeitosPermitidos")
  check("efeitosPermitidos realmente mudou", JSON.stringify(atual.efeitosPermitidos) === JSON.stringify(["REGISTER_ONLY", "COMPLETE_STEP"]), JSON.stringify(atual.efeitosPermitidos))

  console.log("\n8) Editar SÓ o estado ativo/inativo (publicar — já tem efeito, passa)")
  // A checagem "nenhum outro campo moveu" já acontece DENTRO de
  // editarUmCampo (o loop compara todos os campos exceto o mudado).
  await editarUmCampo("ativo", { ativo: true }, "ativo")
  check("ativo realmente mudou", atual.ativo === true, String(atual.ativo))
  check("status virou PUBLICADA (derivado de ativo, não um campo solto)", atual.status === "PUBLICADA", atual.status)

  console.log("\n9) Estado final acumulado — todos os 8 campos com o valor da ÚLTIMA edição de cada um")
  const final = await prisma.catalogoFase.findUniqueOrThrow({ where: { id } })
  check("label", final.label === `${MARCA} Fase Renomeada`, final.label)
  check("descricao", final.descricao === "Descrição nova, editada isoladamente", final.descricao ?? "null")
  check("ordemPadrao", final.ordemPadrao === 77, String(final.ordemPadrao))
  check("requiredPadrao", final.requiredPadrao === false, String(final.requiredPadrao))
  check("conditionalPadrao", final.conditionalPadrao === true, String(final.conditionalPadrao))
  check("escopo", final.escopo === "DOCUMENTO", String(final.escopo))
  check("efeitosPermitidos", JSON.stringify(final.efeitosPermitidos) === JSON.stringify(["REGISTER_ONLY", "COMPLETE_STEP"]))
  check("ativo", final.ativo === true, String(final.ativo))
  check("revisaoAtual acumulou 1 por edição real (8 edições + criação = revisão 9)", final.revisaoAtual === 9, String(final.revisaoAtual))

  await limpar()
  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  if (falhou > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
