// scripts/usuarios-permissoes-exclusivas.test.ts
// ============================================================================
// O BOTÃO DE EXCLUIR PROCESSO SUMIU DO ADMINISTRADOR (01/10/2026) — a causa e a correção:
//   • `processos.excluirDefinitivo` é EXCLUSIVA: nem `tipo = 'admin'` a concede; só `permissoesCustom` com `true`;
//   • a tela de Usuários não a oferecia e, ao salvar QUALQUER edição de um admin, gravava `permissoesCustom: null`;
//   • não havia auditoria de alteração de usuário/permissão.
//
//   node scripts/ci/gate-build.mjs --so usuarios-permissoes-exclusivas
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("usuarios-permissoes-exclusivas.test.ts")

import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { criarPalco } from "./_fixture-arvore-fonte"
import { calcularPermissoes, PERMISSOES, PERMISSOES_EXCLUSIVAS } from "../src/lib/permissoes"
import { EXCLUSIVAS_DA_TELA, diffPermissoesCustom, exclusivasPerdidas, normalizarCustom, semMudanca } from "../src/lib/usuarios-permissoes"
import { PUT as putPermissoes, GET as getPermissoes } from "../src/app/api/usuarios/[id]/permissoes/route"
import { PUT as putUsuario } from "../src/app/api/usuarios/[id]/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
const MARCA = "USREXCL"
const EXCL = "processos.excluirDefinitivo"

async function main() {
  secao("1) Regras puras — exclusivas e diff")
  ok("a tela oferece EXATAMENTE as três exclusivas (as mesmas de PERMISSOES_EXCLUSIVAS)", EXCLUSIVAS_DA_TELA.map((e) => e.chave).sort().join("|") === [...PERMISSOES_EXCLUSIVAS].sort().join("|") && EXCLUSIVAS_DA_TELA.length === 3)
  ok("as três existem em PERMISSOES (com texto oficial)", EXCLUSIVAS_DA_TELA.every((e) => e.chave in PERMISSOES))
  ok("exclusiva concedida que sumiria → 'perdida'", exclusivasPerdidas({ [EXCL]: true }, null).join() === EXCL && exclusivasPerdidas({ [EXCL]: true }, {}).join() === EXCL && exclusivasPerdidas({ [EXCL]: true }, { [EXCL]: false }).join() === EXCL)
  ok("exclusiva mantida (ou só outras mudando) → nada perdido", exclusivasPerdidas({ [EXCL]: true }, { [EXCL]: true, "tarefas.ver": true }).length === 0 && exclusivasPerdidas(null, null).length === 0 && exclusivasPerdidas({ "tarefas.ver": true }, null).length === 0)
  const d = diffPermissoesCustom({ a: true, b: false }, { a: true, c: true, [EXCL]: true })
  ok("diff: concedidas / revogadas / mudanças", d.concedidas.sort().join() === ["c", EXCL].sort().join() && d.revogadas.length === 0 && d.mudancas.length === 3, JSON.stringify(d.mudancas))
  ok("diff: nada mudou ⇒ semMudanca", semMudanca(diffPermissoesCustom({ a: true }, { a: true })) && semMudanca(diffPermissoesCustom(null, {})))
  ok("normalizarCustom ignora lixo", JSON.stringify(normalizarCustom({ a: true, b: "x", c: 1 })) === '{"a":true}' && JSON.stringify(normalizarCustom([1, 2])) === "{}" && JSON.stringify(normalizarCustom(null)) === "{}")

  secao("2) Como o servidor calcula: admin NÃO tem a exclusiva por padrão; a concessão nominal vale")
  const semConcessao = calcularPermissoes("admin", null, null)
  const comConcessao = calcularPermissoes("admin", null, { [EXCL]: true })
  ok("admin sem concessão: exclusiva DESLIGADA (o resto ligado)", semConcessao[EXCL] === false && semConcessao["tarefas.ver"] === true)
  ok("admin COM concessão nominal: exclusiva LIGADA", comConcessao[EXCL] === true)
  ok("admin com `permissoesCustom: null` volta a NÃO ter (é o que o salvamento antigo causava)", calcularPermissoes("admin", null, null)[EXCL] === false)

  secao("3) A tela (código): oferece as três, só envia o que foi editado, verifica a resposta")
  const tela = ler("src/components/gerenciamentoComponents/UsersTab.tsx")
  ok("o grupo 'Exclusivas (concessão nominal)' vem de EXCLUSIVAS_DA_TELA", /modulo: "Exclusivas \(concessão nominal\)"/.test(tela) && /EXCLUSIVAS_DA_TELA\.map/.test(tela))
  ok("NUNCA mais `permissoesCustom: ... \"admin\" ? null`", !/tipo === "admin" \? null/.test(tela))
  ok("admin: o 'tudo ligado' exclui as exclusivas", /if \(formData\.tipo === "admin"\) for \(const c of TODAS_CHAVES\) if \(!PERMISSOES_EXCLUSIVAS\.has\(c\)\) resultado\[c\] = true/.test(tela))
  ok("admin pode ligar/desligar SÓ as exclusivas (togglePermissao e toggleModulo)", /formData\.tipo === "admin" && !PERMISSOES_EXCLUSIVAS\.has\(chave\)\) return/.test(tela) && /formData\.tipo === "admin" && !modulo\.permissoes\.every\(\(p\) => PERMISSOES_EXCLUSIVAS\.has\(p\.chave\)\)\) return/.test(tela))
  ok("só envia permissões se foram editadas (`permissoesEditadas || perfilEditado`)", /const mexeuNasPermissoes = permissoesEditadas \|\| perfilEditado/.test(tela) && /if \(mexeuNasPermissoes\) \{/.test(tela))
  ok("a segunda chamada é VERIFICADA (`resp.ok`) e o erro aparece", /if \(!resp\.ok\)/.test(tela) && /as permissões NÃO/.test(tela))
  ok("permissões não carregadas ⇒ recusa alterar", /!permissoesCarregadas/.test(tela))
  ok("remover exclusiva pede confirmação na tela e manda `confirmarRemocaoExclusivas`", /window\.confirm\(`Esta alteração REMOVE a permissão exclusiva/.test(tela) && /confirmarRemocaoExclusivas = true/.test(tela))

  secao("4) As rotas reais (banco efêmero): trava, auditoria e e-mail sem apagar a concessão")
  const P = criarPalco(MARCA)
  await P.montar()
  const criados: number[] = []
  try {
    const mk = async (tipo: string, sufixo: string) => {
      const u = await prisma.usuario.create({ data: { nome: `${MARCA} ${sufixo}`, email: `${MARCA.toLowerCase()}.${sufixo}.${Date.now()}@teste.local`, senha: "x", tipo }, select: { id: true, email: true } })
      criados.push(u.id); return u
    }
    const req = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost${url}`, { method, headers: { Authorization: `Bearer ${P.token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) })
    const custom = async (id: number) => (await prisma.usuario.findUniqueOrThrow({ where: { id }, select: { permissoesCustom: true } })).permissoesCustom
    const logs = (acao: string, id: number) => prisma.logAuditoria.findMany({ where: { acao, entidade: "Usuario", entidadeId: id }, orderBy: { id: "asc" } })

    const adm = await mk("admin", "adm")

    // (a) conceder a exclusiva nominalmente
    const r1 = await putPermissoes(req("PUT", `/api/usuarios/${adm.id}/permissoes`, { permissoesCustom: { [EXCL]: true } }), ctx(adm.id))
    ok("conceder a exclusiva a um admin: 200 e fica gravada", r1.status === 200 && (await custom(adm.id) as Record<string, boolean>)?.[EXCL] === true, `status ${r1.status}`)
    const l1 = await logs("USUARIO_PERMISSOES_ALTERADAS", adm.id)
    ok("a concessão FICA NA AUDITORIA: quem (o admin do palco), o quê (concedidas) e quando", l1.length === 1 && l1[0].usuarioId === P.adminId && JSON.stringify(l1[0].detalhes).includes(EXCL) && (l1[0].detalhes as { concedidas: string[] }).concedidas.includes(EXCL) && l1[0].criadoEm instanceof Date)
    const g = await (await getPermissoes(req("GET", `/api/usuarios/${adm.id}/permissoes`), ctx(adm.id))).json()
    ok("o GET devolve a concessão (é o que a tela carrega ao abrir a edição)", g.permissoesCustom?.[EXCL] === true)

    // (b) trocar o E-MAIL (o caso real) não apaga a concessão — e fica auditado, sem senha
    const novoEmail = `${MARCA.toLowerCase()}.novo.${Date.now()}@discovery.local`
    const r2 = await putUsuario(req("PUT", `/api/usuarios/${adm.id}`, { nome: `${MARCA} adm`, email: novoEmail, tipo: "admin" }), ctx(adm.id))
    ok("trocar só o e-mail pela rota de dados: 200", r2.status === 200, `status ${r2.status}`)
    ok("…e a concessão nominal CONTINUA (a rota de dados nunca toca em permissões)", (await custom(adm.id) as Record<string, boolean>)?.[EXCL] === true)
    const l2 = await logs("USUARIO_ATUALIZADO", adm.id)
    ok("a troca de e-mail FICA NA AUDITORIA (de → para) e sem senha", l2.length === 1 && JSON.stringify(l2[0].detalhes).includes(novoEmail) && (l2[0].detalhes as { senhaAlterada: boolean }).senhaAlterada === false && !JSON.stringify(l2[0].detalhes).includes("$2"))
    const r2b = await putUsuario(req("PUT", `/api/usuarios/${adm.id}`, { senha: "NovaSenhaSecreta#1" }), ctx(adm.id))
    const l2b = await logs("USUARIO_ATUALIZADO", adm.id)
    const ultimo = l2b[l2b.length - 1]
    ok("trocar a senha audita SÓ o fato (nunca a senha nem o hash)", r2b.status === 200 && (ultimo.detalhes as { senhaAlterada: boolean }).senhaAlterada === true && !JSON.stringify(ultimo.detalhes).includes("NovaSenha") && !JSON.stringify(ultimo.detalhes).includes("$2") && !ultimo.descricao.includes("NovaSenha"))

    // (c) a TRAVA: apagar o conjunto (era o salvamento antigo do admin) revoga a exclusiva ⇒ recusado sem confirmação
    const r3 = await putPermissoes(req("PUT", `/api/usuarios/${adm.id}/permissoes`, { permissoesCustom: null }), ctx(adm.id))
    const b3 = await r3.json()
    ok("`permissoesCustom: null` que revogaria a exclusiva ⇒ 409 REMOVE_EXCLUSIVA_SEM_CONFIRMACAO", r3.status === 409 && b3.code === "REMOVE_EXCLUSIVA_SEM_CONFIRMACAO" && b3.exclusivas?.includes(EXCL), `status ${r3.status}`)
    ok("…e NADA foi gravado (a concessão segue lá)", (await custom(adm.id) as Record<string, boolean>)?.[EXCL] === true)
    const r3b = await putPermissoes(req("PUT", `/api/usuarios/${adm.id}/permissoes`, { permissoesCustom: { "tarefas.ver": true } }), ctx(adm.id))
    ok("conjunto que OMITE a exclusiva também é recusado (omitir = revogar)", r3b.status === 409 && (await custom(adm.id) as Record<string, boolean>)?.[EXCL] === true)

    // (d) campo ausente = não mexer
    const antesLogs = (await logs("USUARIO_PERMISSOES_ALTERADAS", adm.id)).length
    const r4 = await putPermissoes(req("PUT", `/api/usuarios/${adm.id}/permissoes`, {}), ctx(adm.id))
    ok("corpo sem `permissoesCustom` ⇒ não mexe (200) e preserva a concessão", r4.status === 200 && (await custom(adm.id) as Record<string, boolean>)?.[EXCL] === true)
    ok("…e sem mudança NÃO gera linha de auditoria falsa", (await logs("USUARIO_PERMISSOES_ALTERADAS", adm.id)).length === antesLogs)

    // (e) manter a exclusiva e mexer em outras: livre
    const r5 = await putPermissoes(req("PUT", `/api/usuarios/${adm.id}/permissoes`, { permissoesCustom: { [EXCL]: true, "tarefas.ver": true } }), ctx(adm.id))
    ok("manter a exclusiva e acrescentar outra permissão ⇒ 200", r5.status === 200 && Object.keys(await custom(adm.id) as object).length === 2)

    // (f) revogar de propósito: confirmando, vale — e fica auditado como revogada
    const r6 = await putPermissoes(req("PUT", `/api/usuarios/${adm.id}/permissoes`, { permissoesCustom: {}, confirmarRemocaoExclusivas: true }), ctx(adm.id))
    ok("revogar COM confirmação explícita ⇒ 200 e limpa", r6.status === 200 && (await custom(adm.id)) === null)
    const l6 = await logs("USUARIO_PERMISSOES_ALTERADAS", adm.id)
    const rev = l6[l6.length - 1]
    ok("a revogação fica na auditoria (revogadas + confirmou)", (rev.detalhes as { revogadas: string[] }).revogadas.includes(EXCL) && (rev.detalhes as { removeuExclusivasComConfirmacao: boolean }).removeuExclusivasComConfirmacao === true)

    // (g) quem NUNCA teve a exclusiva: limpar é livre (a trava só protege o que foi concedido)
    const comum = await mk("gerente", "ger")
    await prisma.usuario.update({ where: { id: comum.id }, data: { permissoesCustom: { "tarefas.ver": true } } })
    const r7 = await putPermissoes(req("PUT", `/api/usuarios/${comum.id}/permissoes`, { permissoesCustom: null }), ctx(comum.id))
    ok("limpar permissões de quem não tem exclusiva concedida ⇒ 200 (sem trava)", r7.status === 200 && (await custom(comum.id)) === null)
    const r8 = await putPermissoes(req("PUT", `/api/usuarios/999999999/permissoes`, { permissoesCustom: {} }), ctx(999999999))
    ok("usuário inexistente ⇒ 404 (não 500)", r8.status === 404)
  } finally {
    await prisma.logAuditoria.deleteMany({ where: { entidade: "Usuario", entidadeId: { in: criados } } }).catch(() => {})
    await prisma.usuario.deleteMany({ where: { id: { in: criados } } }).catch(() => {})
    await P.limpar()
  }
}

main().then(async () => {
  await prisma.$disconnect()
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
