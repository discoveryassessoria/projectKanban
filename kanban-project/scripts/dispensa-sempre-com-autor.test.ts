// scripts/dispensa-sempre-com-autor.test.ts
// Passo B (08/10/2026): toda dispensa de necessidade registra autor (usuário ou «sistema» + motivo). Banco de TESTE.
import { readFileSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { garantirNecessidade, dispensarNecessidade, dispensaDoSistema, removerNecessidadesDaUniao } from "../src/services/necessidade-documental"
import { montarCenario } from "./_fixture-torre-gh"

let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }
const ler = (f: string) => readFileSync(f, "utf8")

async function main() {
  exigirBancoDeTeste("dispensa-sempre-com-autor.test.ts")
  const c = await montarCenario("DISPAUT")
  try {
    const o = await c.novaObrigacao()
    const proc = await prisma.processo.findUniqueOrThrow({ where: { id: o.processoId }, select: { arvoreId: true } })
    await prisma.itemCatalogo.deleteMany({ where: { code: "DISPAUT_ITEM" } })
    const item = await prisma.itemCatalogo.create({ data: { code: "DISPAUT_ITEM", name: "Certidão de Casamento - Inteiro Teor", natureza: "DOCUMENTO" }, select: { id: true } })
    const p1 = await prisma.pessoa.create({ data: { arvoreId: proc.arvoreId!, nome: "Ana", sobrenome: "Teste", requerente: "nao" } as never, select: { id: true } })
    const p2 = await prisma.pessoa.create({ data: { arvoreId: proc.arvoreId!, nome: "Beto", sobrenome: "Teste", requerente: "nao" } as never, select: { id: true } })
    const admin = await prisma.usuario.findFirstOrThrow({ select: { id: true, nome: true } })
    const nova = async (pessoaId: number, chave: string) => (await garantirNecessidade({ processoId: o.processoId, itemCatalogoId: item.id, pessoaId, varianteKey: chave, origem: "MANUAL", obrigatoriedade: "OBRIGATORIA" })).necessidade

    console.log("\n1) Usuário que dispensa pela tela / cancelando a operação")
    const a = await nova(p1.id, "dispaut:a")
    await dispensarNecessidade(a.id, "cliente não precisa", prisma, true, { usuarioId: admin.id, origem: "cancelamento da operação do documento" })
    const la = await prisma.logAuditoria.findFirst({ where: { acao: "NECESSIDADE_DISPENSADA", entidadeId: a.id } })
    ok("linha de histórico com o usuário, a origem e o motivo", !!la && la.usuarioId === admin.id && /cancelamento da operação do documento/.test(la.descricao) && /cliente não precisa/.test(la.descricao) && la.descricao.includes(admin.nome), la?.descricao)
    const ev = await prisma.necessidadeDocumentalEvento.findFirst({ where: { necessidadeId: a.id, tipo: "DISPENSADA" } })
    ok("o evento da necessidade também guarda o autor", JSON.stringify(ev?.dados).includes(`"autorId":${admin.id}`))

    console.log("\n2) Sistema (reconciliação / união desfeita)")
    const b = await nova(p2.id, "dispaut:b")
    await dispensarNecessidade(b.id, "regra deixou de ser aplicável", prisma, false, dispensaDoSistema("reconciliação da Genealogia"))
    const lb = await prisma.logAuditoria.findFirst({ where: { acao: "NECESSIDADE_DISPENSADA", entidadeId: b.id } })
    ok("«sistema (origem)» + motivo, sem usuário", !!lb && lb.usuarioId === null && /sistema \(reconciliação da Genealogia\)/.test(lb.descricao) && /regra deixou de ser aplicável/.test(lb.descricao), lb?.descricao)
    const uniao = await prisma.uniao.create({ data: { pessoa1Id: p1.id, pessoa2Id: p2.id }, select: { id: true } })
    const cn = (await garantirNecessidade({ processoId: o.processoId, itemCatalogoId: item.id, uniaoId: uniao.id, varianteKey: "dispaut:u", origem: "MANUAL", obrigatoriedade: "OBRIGATORIA" })).necessidade
    await removerNecessidadesDaUniao(uniao.id, prisma, undefined, { usuarioId: admin.id, origem: "união desfeita na árvore" })
    const lc = await prisma.logAuditoria.findFirst({ where: { acao: "NECESSIDADE_DISPENSADA", entidadeId: cn.id } })
    ok("união desfeita: dispensa registrada com o autor", !!lc && lc.usuarioId === admin.id && /união desfeita na árvore/.test(lc.descricao), lc?.descricao)

    console.log("\n3) Todo caminho passa o autor (o parâmetro é obrigatório — não compila sem)")
    ok("cancelar operação do documento passa o usuário", /dispensarNecessidade\(docAlvo\.necessidadeId, obs \|\| "Operação cancelada", tx, true, \{ usuarioId: ctx\?\.usuarioId/.test(ler("src/services/documento-operacao.ts")))
    ok("tela da necessidade passa o usuário da sessão", /extrairUsuarioComPermissoes\(request\)\)\?\.userId \?\? null, origem: "dispensa pela tela da necessidade"/.test(ler("src/app/api/processos/[processoId]/necessidades/[necessidadeId]/route.ts")))
    ok("materializar passa o autor da árvore ou a reconciliação", /dispensarNecessidade\(n\.id, motivo, db, false, \{ usuarioId: opts\.autor\?\.id/.test(ler("src/services/genealogia/materializar-genealogia.ts")))
    ok("união desfeita na tela passa o usuário", /origem: "união desfeita na árvore" \}/.test(ler("src/app/api/unioes/[id]/route.ts")))

    console.log("\n4) O vigia reprova dispensa sem autor")
    const { detectarRegraP } = await import("../lib/saude/verificacoes/regras-do-marco")
    const inicio = new Date(Date.now() - 60_000)
    const d = await nova(p1.id, "dispaut:sem")
    await prisma.necessidadeDocumental.update({ where: { id: d.id }, data: { status: "DISPENSADA" } }) // sem passar pelo serviço: sem autor
    const viol = (await detectarRegraP(inicio)).filter((v) => v.registroId === d.id)
    ok("dispensa feita por fora do serviço é reprovada", viol.length === 1)
    ok("dispensa pelo serviço (com autor) NÃO é reprovada", !(await detectarRegraP(inicio)).some((v) => v.registroId === a.id || v.registroId === b.id))
  } finally {
    await prisma.logAuditoria.deleteMany({ where: { acao: "NECESSIDADE_DISPENSADA", descricao: { contains: "Teste" } } })
    await prisma.uniao.deleteMany({ where: { pessoa1: { sobrenome: "Teste", nome: "Ana" } } })
    await prisma.necessidadeDocumental.deleteMany({ where: { varianteKey: { startsWith: "dispaut:" } } })
    await prisma.pessoa.deleteMany({ where: { sobrenome: "Teste", nome: { in: ["Ana", "Beto"] } } })
    await c.limpar()
    await prisma.itemCatalogo.deleteMany({ where: { code: "DISPAUT_ITEM" } })
    await prisma.$disconnect()
  }
  console.log(`\n${n - falhou}/${n} verificações`)
  if (falhou > 0) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })
