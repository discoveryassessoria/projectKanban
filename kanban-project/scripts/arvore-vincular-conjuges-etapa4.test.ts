// scripts/arvore-vincular-conjuges-etapa4.test.ts
// ============================================================================
// ETAPA 4 (h) — VINCULAR CÔNJUGES SEM FILHO. "A árvore é a única fonte de verdade
// documental" (CLAUDE.md §37): casar duas pessoas que já existem na árvore passa
// pela porta oficial (POST /api/unioes → aplicarMudancaNaArvore) e propaga, na
// MESMA transação, para necessidade → documento → passo → tarefa.
//
//   VALIDA   a mesma pessoa, árvores diferentes → 400 e NADA gravado;
//   IDA      união + casado=true dos dois + data/local do casamento no vínculo +
//            UMA necessidade de casamento POR UNIÃO (pessoaId nulo) + documento + tarefa;
//   IDEMP.   repetir com `idempotente` → 200 `jaExistia`, sem 2ª união/necessidade/tarefa;
//            repetir SEM `idempotente` mantém o 400 de sempre;
//   VOLTA    o comando `comandoVincularConjuges` (Ctrl+Z da tela) remove a união e
//            devolve o estado civil de antes → necessidade DISPENSADA, tarefa
//            CANCELADA, nada órfão;
//   REFAZER  aplicar de novo REATIVA o mesmo registro (sem duplicar).
//
// Roda contra o banco de TESTE:
//   node scripts/ci/gate-build.mjs --suite todas --so arvore-vincular-conjuges-etapa4
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarPalco } from "./_fixture-arvore-fonte"
import { comandoVincularConjuges, type Http } from "../src/lib/genealogia/vinculos-edicao"

const MARCA = "ARV4"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  exigirBancoDeTeste("arvore-vincular-conjuges-etapa4.test.ts")
  const P = criarPalco(MARCA)
  await P.montar()
  console.log("ETAPA 4 (h) — VINCULAR CÔNJUGES\n")

  const postUniao = async (body: Record<string, unknown>) => {
    const { POST } = await import("../src/app/api/unioes/route")
    return POST(P.req("/api/unioes", "POST", body))
  }
  // O MESMO caminho da tela: o comando chama as rotas reais por este adaptador.
  const http: Http = async (metodo, url, corpo) => {
    let resp: Response
    if (url === "/api/unioes" && metodo === "POST") resp = await postUniao(corpo as Record<string, unknown>)
    else if (/^\/api\/unioes\/\d+$/.test(url) && metodo === "DELETE") resp = await P.deleteUniao(Number(url.split("/").pop()))
    else if (/^\/api\/pessoas\/\d+$/.test(url) && metodo === "PUT") resp = await P.putPessoa(Number(url.split("/").pop()), corpo as Record<string, unknown>)
    else throw new Error(`rota inesperada ${metodo} ${url}`)
    return { ok: resp.ok, status: resp.status, corpo: await resp.json().catch(() => null) }
  }

  const c = await P.novoCenario("casal", { conjuge: true })

  // ══ VALIDAÇÕES ════════════════════════════════════════════════════════════
  secao("VALIDAÇÕES — recusa antes de gravar qualquer coisa")
  const rMesma = await postUniao({ pessoa1Id: c.titularId, pessoa2Id: c.titularId, marcarCasados: true })
  ok("a MESMA pessoa não se une a si mesma (400)", rMesma.status === 400, String(rMesma.status))
  const outra = await P.novoCenario("outra-arvore", {})
  const rCruz = await postUniao({ pessoa1Id: c.titularId, pessoa2Id: outra.titularId, marcarCasados: true })
  ok("pessoas de ÁRVORES diferentes não se unem (400)", rCruz.status === 400, `${rCruz.status} ${(await rCruz.json()).error ?? ""}`)
  ok("nada foi gravado pelas recusas: nenhuma união, ninguém virou casado",
    (await prisma.uniao.count({ where: { OR: [{ pessoa1Id: c.titularId }, { pessoa2Id: c.titularId }] } })) === 0 &&
    (await prisma.pessoa.count({ where: { id: { in: [c.titularId, outra.titularId, c.conjugeId!] }, casado: true } })) === 0)

  // ══ IDA ═══════════════════════════════════════════════════════════════════
  secao("IDA — casal sem filho: união + estado civil + data/local + necessidade, numa transação")
  const antes = await P.foto(c.processoId)
  ok("pré: ainda não há necessidade de casamento", antes.necDe("CAS").length === 0)
  const r1 = await postUniao({
    pessoa1Id: c.titularId, pessoa2Id: c.conjugeId!, tipo: "casamento",
    data_inicio: "1990-05-12T00:00:00.000Z", local: "Caxias do Sul - RS", marcarCasados: true, idempotente: true,
  })
  const corpo1 = await r1.json()
  ok("POST /api/unioes responde 201", r1.status === 201, String(r1.status))
  ok("a resposta traz o estado civil de ANTES (para o Desfazer)", corpo1.casadoAntes?.pessoa1 === false && corpo1.casadoAntes?.pessoa2 === false, JSON.stringify(corpo1.casadoAntes))
  const uniao = await prisma.uniao.findFirstOrThrow({ where: { pessoa1Id: c.titularId, pessoa2Id: c.conjugeId! } })
  ok("a união guarda DATA e LOCAL do casamento", uniao.data_inicio?.toISOString().startsWith("1990-05-12") === true && uniao.local === "Caxias do Sul - RS")
  const pessoas = await prisma.pessoa.findMany({ where: { id: { in: [c.titularId, c.conjugeId!] } }, select: { casado: true } })
  ok("as DUAS pessoas ficaram casado=true (mesma transação)", pessoas.length === 2 && pessoas.every((p) => p.casado))
  let f = await P.foto(c.processoId)
  const cas = f.necDe("CAS", { uniaoId: uniao.id })
  ok("nasceu UMA necessidade de casamento, por UNIÃO (pessoaId nulo)", cas.length === 1 && cas[0].pessoaId === null, JSON.stringify(cas))
  const necId = cas[0].id
  ok("nasceu o Documento do casamento", f.docs.filter((d) => d.necessidadeId === necId).length === 1)
  const tarefaAberta = f.tarefas.filter((t) => t.necessidadeId === necId && !P.TAREFA_FECHADA.includes(t.statusTarefa))
  ok("nasceu UMA tarefa aberta (síncrono, já na resposta)", tarefaAberta.length === 1, String(tarefaAberta.length))
  const tarefaId = tarefaAberta[0].id

  // ══ LEITURA que alimenta a fila ═══════════════════════════════════════════
  secao("LEITURA — o endpoint da fila entrega a situação real do pedido e a fase do processo")
  const lerOperacional = async (processoId: number) => {
    const { GET } = await import("../src/app/api/processos/[processoId]/genealogia/operacional/route")
    const resp = await GET(P.req(`/api/processos/${processoId}/genealogia/operacional`, "GET"), { params: Promise.resolve({ processoId: String(processoId) }) })
    return { status: resp.status, corpo: await resp.json() }
  }
  // A rota só devolve REGISTRO CIVIL (a Árvore só conhece nascimento/casamento/óbito): classifica
  // os tipos da fixture como o cadastro real faz — por `CategoriaDocumental.code`, nunca por nome.
  const registroCivil = await prisma.categoriaDocumental.upsert({
    where: { code: "REGISTRO_CIVIL" }, update: {}, create: { code: "REGISTRO_CIVIL", name: "Registro civil", sistema: true },
  })
  await prisma.tipoDocumentoCadastro.updateMany({ where: { code: { startsWith: MARCA } }, data: { categoriaDocumentalId: registroCivil.id } })
  const op = await lerOperacional(c.processoId)
  const necOp = (op.corpo.necessidades as Array<{ id: number; situacaoCertidao: string | null }>).find((n) => n.id === necId)
  ok("GET operacional responde 200", op.status === 200, String(op.status))
  ok("a necessidade de casamento vem com a situação da PROJEÇÃO oficial (registro ainda não localizado)", necOp?.situacaoCertidao === "NAO_LOCALIZADA", String(necOp?.situacaoCertidao))
  ok("e vem a fase REAL do processo", op.corpo.faseAtualKey === "genealogia", String(op.corpo.faseAtualKey))
  await prisma.processo.update({ where: { id: c.processoId }, data: { faseAtualKey: "a_iniciar" } })
  const opAntes = await lerOperacional(c.processoId)
  ok("processo em 'Aguardando fechamento' devolve a fase real (a fila decide a mensagem por ela)", opAntes.corpo.faseAtualKey === "a_iniciar", String(opAntes.corpo.faseAtualKey))
  await prisma.processo.update({ where: { id: c.processoId }, data: { faseAtualKey: "genealogia" } })

  // ══ IDEMPOTÊNCIA ══════════════════════════════════════════════════════════
  secao("IDEMPOTÊNCIA — repetir o pedido não cria nada nem dá erro")
  const r2 = await postUniao({ pessoa1Id: c.titularId, pessoa2Id: c.conjugeId!, tipo: "casamento", marcarCasados: true, idempotente: true })
  const corpo2 = await r2.json()
  ok("200 com `jaExistia` (não 201, não 400)", r2.status === 200 && corpo2.jaExistia === true && corpo2.id === uniao.id, `${r2.status}`)
  const rInv = await postUniao({ pessoa1Id: c.conjugeId!, pessoa2Id: c.titularId, tipo: "casamento", marcarCasados: true, idempotente: true })
  ok("o par invertido também é o MESMO casal (200 jaExistia)", rInv.status === 200 && (await rInv.json()).jaExistia === true, String(rInv.status))
  f = await P.foto(c.processoId)
  ok("continua UMA união, UMA necessidade, UMA tarefa (sem duplicar)",
    (await prisma.uniao.count({ where: { OR: [{ pessoa1Id: c.titularId }, { pessoa2Id: c.titularId }] } })) === 1 &&
    f.necDe("CAS").length === 1 && f.tarefas.filter((t) => t.necessidadeId === necId).length === 1)
  const r3 = await postUniao({ pessoa1Id: c.titularId, pessoa2Id: c.conjugeId!, tipo: "casamento" })
  ok("SEM `idempotente` o contrato antigo se mantém: 400 'Já existe uma união'", r3.status === 400)

  // ══ VOLTA (Desfazer da tela) ══════════════════════════════════════════════
  secao("VOLTA — o comando de Desfazer remove a união e devolve o estado civil")
  // Cenário próprio: o comando precisa ser quem CRIA (só ele conhece o `casadoAntes`).
  const d = await P.novoCenario("desfazer", { conjuge: true })
  const cmd = comandoVincularConjuges(
    { pessoa1Id: d.titularId, pessoa2Id: d.conjugeId!, pessoa1Nome: "Edison", pessoa2Nome: "Luana", dataCasamento: "1990-05-12T00:00:00.000Z", localCasamento: "Caxias do Sul - RS" },
    http,
  )
  const ra = await cmd.aplicar()
  ok("comando.aplicar() ok", ra.ok === true, JSON.stringify(ra))
  const ud = await prisma.uniao.findFirstOrThrow({ where: { pessoa1Id: d.titularId, pessoa2Id: d.conjugeId! } })
  let fd = await P.foto(d.processoId)
  const necD = fd.necDe("CAS", { uniaoId: ud.id })[0]
  ok("pré-desfazer: necessidade de casamento criada", !!necD)
  const tarD = fd.tarefas.find((t) => t.necessidadeId === necD.id)!
  const rd = await cmd.desfazer()
  ok("comando.desfazer() ok", rd.ok === true, JSON.stringify(rd))
  ok("a união saiu", (await prisma.uniao.count({ where: { id: ud.id } })) === 0)
  ok("o estado civil voltou ao de antes (casado=false nos dois)",
    (await prisma.pessoa.count({ where: { id: { in: [d.titularId, d.conjugeId!] }, casado: true } })) === 0)
  fd = await P.foto(d.processoId)
  ok("nenhuma necessidade de casamento ativa sobrou (sem órfão)", fd.necDe("CAS").filter((n) => n.status !== "DISPENSADA").length === 0, JSON.stringify(fd.necDe("CAS")))
  ok("a tarefa aberta foi CANCELADA", (await prisma.tarefa.findUniqueOrThrow({ where: { id: tarD.id } })).statusTarefa === "CANCELADA")

  // ══ REFAZER ═══════════════════════════════════════════════════════════════
  secao("REFAZER — aplicar de novo traz o casamento de volta, sem duplicar")
  const rr = await cmd.aplicar()
  ok("comando.aplicar() de novo ok", rr.ok === true, JSON.stringify(rr))
  fd = await P.foto(d.processoId)
  const ativas = fd.necDe("CAS").filter((n) => n.status !== "DISPENSADA")
  ok("há UMA necessidade de casamento ativa", ativas.length === 1, JSON.stringify(fd.necDe("CAS")))
  ok("e UMA tarefa aberta para ela", fd.tarefas.filter((t) => ativas.some((n) => n.id === t.necessidadeId) && !P.TAREFA_FECHADA.includes(t.statusTarefa)).length === 1)

  // Mantém a tarefa/necessidade do 1º cenário íntimas: nada do 2º as tocou.
  ok("o 1º casal continua intacto (tarefa aberta, necessidade viva)",
    (await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId } })).statusTarefa !== "CANCELADA" &&
    (await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: necId } })).status !== "DISPENSADA")

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} ETAPA 4 (h) — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
