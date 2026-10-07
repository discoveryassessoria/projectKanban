// scripts/confirmacao-arvore-cadastro.test.ts
// ============================================================================
// REGRA GERAL DO MARCO (07/10/2026) — dado registral DIFERENTE do da árvore só é gravado com a escolha explícita (árvore · cadastro · cancelar), no SERVIDOR:
//   • valor igual / só grafia diferente → salva normalmente, sem pergunta;     • valor diferente SEM escolha → 409 `CONFIRMACAO_ARVORE`, nada é salvo;
//   • «ARVORE» → a Genealogia assume o da árvore (o digitado não é salvo);      • «CADASTRO» → salva e corrige a árvore; histórico nos DOIS lados;
//   • árvore vazia → salva e preenche a árvore, sem pergunta;                   • cada campo só contra o seu: «Santos – 1º Subdistrito» (cartório) × «Santos» (cidade) NÃO dispara;
//   • a sincronização automática nunca sobrescreve a árvore com valor diferente; • vigia: nenhuma porta de escrita do Documento fica de fora da guarda.
//   node scripts/ci/gate-build.mjs --suite todas --so confirmacao-arvore-cadastro
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { criarPalco } from "./_fixture-arvore-fonte"
import { diferencasDoEvento, CAMPOS_SINCRONIZAVEIS } from "../src/lib/genealogia/sincronizacao-registral"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const MARCA = "CONFARV"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const dia = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

async function main() {
  exigirBancoDeTeste("confirmacao-arvore-cadastro.test.ts")

  secao("A) Mapa campo × campo (puro)")
  const reg = (o: Record<string, unknown>) => o as never
  const uniao = { data_inicio: null, local: "Santos", estado: "SP", pais: "Brasil", data_registro: null, cartorio: "Cartório X", livro: "A1", folha: "10", termo: "20" }
  const dc = diferencasDoEvento("CASAMENTO", reg({ cartorio: "Santos - 1º Subdistrito", cidade_registro: "Santos", livro: "A1", folha: "10", termo: "20" }), uniao)
  ok("casamento: «Santos – 1º Subdistrito» (cartório) contra a CIDADE «Santos» não dispara — só contra o cartório da união", !dc.some((d) => d.campo.chave === "UNIAO.local") && dc.filter((d) => d.tipo === "CONFLITO").map((d) => d.campo.chave).join() === "UNIAO.cartorio", dc.map((d) => `${d.campo.chave}:${d.tipo}`).join())
  ok("cidade «Santos» contra «Campinas» DISPARA (conflito na cidade)", diferencasDoEvento("CASAMENTO", reg({ cidade_registro: "Campinas" }), uniao).some((d) => d.campo.chave === "UNIAO.local" && d.tipo === "CONFLITO"))
  ok("livro, folha e termo, cada um contra o seu: folha diferente dispara só a folha", diferencasDoEvento("CASAMENTO", reg({ livro: "A1", folha: "11", termo: "20" }), uniao).filter((d) => d.tipo === "CONFLITO").map((d) => d.campo.chave).join() === "UNIAO.folha")
  ok("«0» em livro/folha/termo não é dado (não compara nem preenche)", diferencasDoEvento("CASAMENTO", reg({ livro: "0", folha: "0", termo: "0" }), { ...uniao, livro: null, folha: null, termo: null }).length === 0)
  ok("nascimento e óbito NÃO têm cartório, livro, folha, termo nem data do registro na árvore (sem equivalente → sem comparação)", !CAMPOS_SINCRONIZAVEIS.some((c) => c.evento !== "CASAMENTO" && ["cartorio", "livro", "folha", "termo", "data_registro"].includes(c.origem)))
  ok("data do registro só contra a data do registro; data do evento só contra a do evento", diferencasDoEvento("CASAMENTO", reg({ data_registro: "2019-07-16" }), { ...uniao, data_inicio: new Date("1961-07-20T00:00:00Z") }).every((d) => d.campo.chave === "UNIAO.data_registro" && d.tipo === "PREENCHER"))
  ok("«SP (2º Subd.)» no estado da árvore = «São Paulo» (o parêntese é ignorado; não dispara)", diferencasDoEvento("NASCIMENTO", reg({ estado_registro: "São Paulo" }), { estado_nasc: "SP (2º Subd.)" }).length === 0)
  ok("«São Paulo (Lapa)» na cidade da árvore = «São Paulo»", diferencasDoEvento("NASCIMENTO", reg({ cidade_registro: "São Paulo" }), { local_nasc: "São Paulo (Lapa)" }).length === 0)

  secao("B) No banco de teste — PUT /api/documentos/:id (a porta da tela)")
  const P = criarPalco(MARCA)
  await P.montar()
  const { PUT } = await import("../src/app/api/documentos/[id]/route")
  const { editarDadosRegistrais } = await import("../src/services/genealogia/editar-dados-registrais")
  const { sincronizarDocumento } = await import("../src/services/genealogia/sincronizar-com-registro")
  for (const [code, chave] of [[P.COD.NAS, "CERTIDAO_NASCIMENTO"], [P.COD.CAS, "CERTIDAO_CASAMENTO"], [P.COD.OBI, "CERTIDAO_OBITO"]] as const) {
    if (!(await prisma.tipoDocumentoCadastro.findFirst({ where: { legacyEnumKey: chave }, select: { id: true } }))) await prisma.tipoDocumentoCadastro.updateMany({ where: { code }, data: { legacyEnumKey: chave } })
  }
  const c = await P.novoCenario("confarv")
  await P.putPessoa(c.titularId, { vivo: false, documentacao: true })
  const doc = await prisma.documento.findFirstOrThrow({ where: { pessoaId: c.titularId, documentType: { legacyEnumKey: "CERTIDAO_NASCIMENTO" }, status: { notIn: ["NAO_EXIGIDO", "CANCELADO"] }, necessidadeId: { not: null } }, select: { id: true } })
  const arv = () => prisma.pessoa.findUniqueOrThrow({ where: { id: c.titularId }, select: { data_nasc: true, local_nasc: true, estado_nasc: true, pais_nasc: true } })
  const docAgora = () => prisma.documento.findUniqueOrThrow({ where: { id: doc.id }, select: { data_evento: true, cidade_registro: true, estado_registro: true, pais_registro: true, cartorio: true, livro: true } })
  const put = async (body: Record<string, unknown>) => { const r = await PUT(P.req(`/api/documentos/${doc.id}`, "PUT", body), P.ctx(doc.id)); return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> } }
  const logs = (lado: string) => prisma.logAuditoria.findMany({ where: { acao: "CONFIRMACAO_ARVORE_CADASTRO", entidade: lado === "ARVORE" ? "Pessoa" : "Documento", entidadeId: lado === "ARVORE" ? c.titularId : doc.id }, orderBy: { id: "asc" }, select: { usuarioId: true, detalhes: true, descricao: true } })

  await prisma.pessoa.update({ where: { id: c.titularId }, data: { data_nasc: new Date("1937-10-03T00:00:00Z"), local_nasc: "Santos", estado_nasc: "SP", pais_nasc: null } })

  const r1 = await put({ data_evento: "1937-10-03", cidade_registro: "Santos", estado_registro: "São Paulo", cartorio: "Santos - 1º Subdistrito", livro: "A1" })
  ok("valor IGUAL (e «SP» × «São Paulo», e cartório «Santos – 1º Subdistrito» × cidade «Santos») salva sem modal", r1.status === 200 && (await logs("DOC")).length === 0, `status ${r1.status}`)
  ok("e grava o cadastro", dia((await docAgora()).data_evento) === "1937-10-03" && (await docAgora()).cartorio === "Santos - 1º Subdistrito")

  const r2 = await put({ data_evento: "1937-10-12" })
  const j2 = r2.json as { codigo?: string; divergencias?: Array<{ arvoreTexto: string; digitadoTexto: string; chave: string }> }
  ok("data DIFERENTE sem escolha → 409 CONFIRMACAO_ARVORE, com «na árvore» e «digitado» em dd/mm/aaaa", r2.status === 409 && j2.codigo === "CONFIRMACAO_ARVORE" && j2.divergencias?.[0]?.arvoreTexto === "03/10/1937" && j2.divergencias?.[0]?.digitadoTexto === "12/10/1937", JSON.stringify(j2).slice(0, 160))
  ok("nada foi salvo (cadastro e árvore intactos)", dia((await docAgora()).data_evento) === "1937-10-03" && dia((await arv()).data_nasc) === "1937-10-03")
  const r2b = await put({ data_evento: "1937-10-12", decisoes: { "PESSOA.data_nasc": "TALVEZ" } })
  ok("escolha inválida não vale (sem escolha padrão)", r2b.status === 409)

  const r3 = await put({ data_evento: "1937-10-12", decisoes: { "PESSOA.data_nasc": "ARVORE" } })
  ok("opção ÁRVORE: salva, a Genealogia assume o valor da árvore (03/10) e o digitado NÃO é salvo", r3.status === 200 && dia((await docAgora()).data_evento) === "1937-10-03" && dia((await arv()).data_nasc) === "1937-10-03")
  const lg = (await logs("DOC")).at(-1), la = (await logs("ARVORE")).at(-1)
  const dg = (lg?.detalhes ?? {}) as Record<string, unknown>, da = (la?.detalhes ?? {}) as Record<string, unknown>
  ok("histórico nos DOIS lados com campo, valor antigo, valor novo, quem escolheu e a opção (ÁRVORE)", dg.opcao === "ARVORE" && da.opcao === "ARVORE" && dg.campo === "data do nascimento" && da.campo === "data do nascimento" && dg.antes === "1937-10-03" && dg.depois === "1937-10-03" && da.valorDigitado === "1937-10-12" && lg?.usuarioId === P.adminId && la?.usuarioId === P.adminId, JSON.stringify([dg.opcao, da.opcao]))

  const r4 = await put({ data_evento: "1937-10-12", decisoes: { "PESSOA.data_nasc": "CADASTRO" } })
  ok("opção CADASTRO: salva o digitado e CORRIGE a árvore (03/10 → 12/10)", r4.status === 200 && dia((await docAgora()).data_evento) === "1937-10-12" && dia((await arv()).data_nasc) === "1937-10-12")
  const lg2 = (await logs("DOC")).at(-1), la2 = (await logs("ARVORE")).at(-1)
  const dg2 = (lg2?.detalhes ?? {}) as Record<string, unknown>, da2 = (la2?.detalhes ?? {}) as Record<string, unknown>
  ok("histórico dos DOIS lados: Genealogia 03/10 → 12/10 e árvore 03/10 → 12/10, opção CADASTRO, com quem escolheu", dg2.opcao === "CADASTRO" && da2.opcao === "CADASTRO" && dg2.antes === "1937-10-03" && dg2.depois === "1937-10-12" && da2.antes === "1937-10-03" && da2.depois === "1937-10-12" && da2.escolhidoPorUsuarioId === P.adminId, JSON.stringify([dg2.antes, dg2.depois, da2.antes, da2.depois]))

  // cidade: «Santos» × «Campinas»
  const r5 = await put({ cidade_registro: "Campinas" })
  ok("cidade «Santos» (árvore) × «Campinas» (digitado) DISPARA o modal", r5.status === 409 && (r5.json as { divergencias?: Array<{ chave: string }> }).divergencias?.[0]?.chave === "PESSOA.local_nasc")
  ok("e o cadastro continua com «Santos»", (await docAgora()).cidade_registro === "Santos")

  // árvore vazia
  await prisma.pessoa.update({ where: { id: c.titularId }, data: { pais_nasc: null } })
  const r6 = await put({ pais_registro: "Brasil" })
  ok("árvore VAZIA no campo: salva e preenche a árvore, sem modal", r6.status === 200 && (await arv()).pais_nasc === "Brasil" && (await docAgora()).pais_registro === "Brasil")
  const lv = (await logs("ARVORE")).at(-1)
  ok("com histórico (árvore vazia → Brasil)", (lv?.detalhes as Record<string, unknown>)?.opcao === "ARVORE_VAZIA" && (lv?.detalhes as Record<string, unknown>)?.antes == null && (lv?.detalhes as Record<string, unknown>)?.depois === "Brasil")

  // sem equivalente
  const r7 = await put({ cartorio: "Outro Cartório Qualquer", livro: "ZZ9", folha: "9", termo: "9" })
  ok("nascimento: cartório, livro, folha e termo não têm equivalente na árvore → não comparam e não abrem modal", r7.status === 200 && (await docAgora()).livro === "ZZ9")

  // estado com complemento na árvore
  await prisma.pessoa.update({ where: { id: c.titularId }, data: { estado_nasc: "SP (2º Subd.)" } })
  const r8 = await put({ estado_registro: "São Paulo" })
  ok("«SP (2º Subd.)» no ESTADO da árvore contra «São Paulo»: não dispara (dado fora do lugar vai para a lista do Marco)", r8.status === 200)
  const r9 = await put({ estado_registro: "Minas Gerais" })
  ok("estado de OUTRO lugar dispara", r9.status === 409)

  secao("C) A outra porta — editarDadosRegistrais (PATCH /dados-registrais)")
  await prisma.pessoa.update({ where: { id: c.titularId }, data: { data_nasc: new Date("1937-10-12T00:00:00Z"), estado_nasc: "SP", local_nasc: "Santos" } })
  const e1 = await editarDadosRegistrais({ documentoId: doc.id, autorId: P.adminId, valores: { data_evento: "1937-11-01" } })
  ok("valor diferente sem escolha é recusado também aqui (CONFIRMACAO_ARVORE)", !e1.ok && e1.codigo === "CONFIRMACAO_ARVORE" && dia((await docAgora()).data_evento) === "1937-10-12")
  const e2 = await editarDadosRegistrais({ documentoId: doc.id, autorId: P.adminId, valores: { data_evento: "1937-11-01" }, decisoes: { "PESSOA.data_nasc": "CADASTRO" } })
  ok("com «cadastro»: grava e corrige a árvore", e2.ok && dia((await docAgora()).data_evento) === "1937-11-01" && dia((await arv()).data_nasc) === "1937-11-01")
  const e3 = await editarDadosRegistrais({ documentoId: doc.id, autorId: P.adminId, valores: { data_evento: "1937-12-25" }, decisoes: { "PESSOA.data_nasc": "ARVORE" } })
  ok("com «árvore»: o digitado não é salvo (cadastro volta ao da árvore)", e3.ok === false ? e3.codigo === "SEM_MUDANCA" || e3.codigo === "MOTIVO_OBRIGATORIO" : dia((await docAgora()).data_evento) === "1937-11-01")

  secao("D) A sincronização automática nunca sobrescreve a árvore com valor diferente")
  await prisma.documento.update({ where: { id: doc.id }, data: { data_evento: new Date("1999-09-09T00:00:00Z") } }) // dado legado divergente, gravado por fora
  const passo = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { documentoId: doc.id, stepKey: "localizar_registro" }, select: { id: true } })
  await prisma.phaseWorkflowStepInstance.update({ where: { id: passo.id }, data: { status: "CONCLUIDO" } })
  const s = await sincronizarDocumento(doc.id, P.adminId, "CONCLUSAO_DO_REGISTRO")
  ok("conclusão do «Localizar registro» com valor diferente NÃO muda a árvore", dia((await arv()).data_nasc) === "1937-11-01" && s.aplicados.every((a) => a.tipo === "PREENCHER"))

  secao("E) Vigia — nenhuma porta de escrita do Documento fica fora da guarda")
  const varrer = (dir: string, out: string[] = []): string[] => { for (const n of readdirSync(dir)) { const f = join(dir, n); const st = statSync(f); if (st.isDirectory()) { if (!["node_modules", ".next"].includes(n)) varrer(f, out) } else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) out.push(f) } return out }
  const arquivos = [...varrer("src/app/api"), ...varrer("src/services"), ...varrer("lib")]
  const colunas = /\b(data_evento|data_registro|cidade_registro|estado_registro|pais_registro)\b/
  const escreve = /(prisma|tx|db)\.documento\.(update|create|upsert|updateMany|createMany)\(/
  // Fora da guarda por motivo escrito: copia da certidão de origem para a «nova via» (mesma pessoa, mesmo evento); leitura/OCR que só toca JSON; a própria guarda.
  const PERMITIDOS = new Set(["src/services/efeitos-de-dominio.ts", "src/services/genealogia/confirmacao-arvore.ts", "src/services/genealogia/sincronizar-com-registro.ts",
    // Análise Documental: só LÊ as colunas do registro (select) e grava os JSON `registral`/`structuredData`, nunca data/cidade/estado/país do registro.
    "src/app/api/processos/[processoId]/analise-v2/extrair/route.ts", "src/app/api/processos/[processoId]/analise-v2/route.ts"])
  const fora = arquivos.filter((f) => { const c = readFileSync(f, "utf8").replace(/\/\/.*$/gm, ""); return escreve.test(c) && colunas.test(c) && !/confirmacao-arvore/.test(c) && !PERMITIDOS.has(f) })
  ok("todo arquivo que grava Documento com data/local do registro passa pela guarda (confirmacao-arvore)", fora.length === 0, fora.join(", "))
  const ler = (f: string) => readFileSync(f, "utf8")
  ok("PUT /api/documentos/:id, POST /api/documentos e editarDadosRegistrais usam planejarConfirmacao + aplicarPlanoNaArvore", ["src/app/api/documentos/[id]/route.ts", "src/app/api/documentos/route.ts", "src/services/genealogia/editar-dados-registrais.ts"].every((f) => /planejarConfirmacao/.test(ler(f)) && /aplicarPlanoNaArvore/.test(ler(f))))
  ok("a tela: o modal tem as opções «O correto é o da árvore», «O correto é o que estou cadastrando» e «Cancelar», sem opção pré-marcada", (() => { const m = ler("src/components/kanban/documento/ModalConfirmacaoArvore.tsx"); return /O correto é o da árvore/.test(m) && /O correto é o que estou cadastrando/.test(m) && />Cancelar</.test(m) && /useState<EscolhasDaArvore>\(\{\}\)/.test(m) })())
  ok("Editor Registral e Editar dados registrais abrem o modal ao receber o 409", ["src/components/kanban/workflow/EditorRegistralModal.tsx", "src/components/kanban/documento/EditarDadosRegistrais.tsx"].every((f) => /ModalConfirmacaoArvore/.test(ler(f)) && /divergenciasDaResposta/.test(ler(f))))

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} CONFIRMAÇÃO ÁRVORE × CADASTRO — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
}
main().catch((e) => { console.log(`  ❌ ERRO: ${String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(-700)}`); process.exit(1) }).finally(() => prisma.$disconnect())
