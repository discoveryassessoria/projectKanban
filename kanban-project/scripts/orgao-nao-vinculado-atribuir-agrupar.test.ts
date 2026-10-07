// scripts/orgao-nao-vinculado-atribuir-agrupar.test.ts
// ============================================================================
// GUARDA do pacote "órgão a definir" (A1–A4) e da fila (B5–B6), 06/10/2026.
//   A1 coluna Órgão: "texto · não vinculado" + atalho; "a definir" só sem vínculo e sem texto
//   A2 concluir "Localizar registro" exige órgão VINCULADO em qualquer país (servidor + editor); cadastro rápido exige nome/cidade/país;
//      busca ignora acento
//   A4 bloco "Cartórios" da Torre conta o órgão do documento (coberto em torre-nova-processo-detalhe.test.ts)
//   B5 "Atribuir" da fila ligado à porta canônica (/api/tarefas/:id/comando) com a permissão tarefas.editar — sem botão morto
//   B6 Aguardando e Acompanhamento agrupam por pessoa dentro da família
//   npx tsx scripts/orgao-nao-vinculado-atribuir-agrupar.test.ts
// ============================================================================
import { readFileSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("orgao-nao-vinculado-atribuir-agrupar.test.ts")

import { prisma } from "../lib/prisma"
import { garantirOferta } from "./_fixture-oferta"
import { orgaoTxt, orgaoSoEmTexto } from "../src/components/operacao/operacao-v3-derivacoes"
import type { LinhaOperacaoV3 } from "../src/components/operacao/operacao-v3-tipos"
import { buscarOrgaos, cadastrarOrgaoRapido } from "../src/services/orgao-vinculo-documento"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const L = (o: Partial<LinhaOperacaoV3>) => ({ terceiroNome: null, cartorioTexto: null, documentoId: 10, faseMacroKey: "genealogia", ...o }) as LinhaOperacaoV3

async function main() {
  secao("A1) coluna Órgão")
  ok("texto livre sem vínculo → «Aguila · não vinculado»", orgaoTxt(L({ cartorioTexto: "Aguila" })) === "Aguila · não vinculado")
  ok("com vínculo mostra o órgão", orgaoTxt(L({ terceiroNome: "Registro Civil de Águilas", cartorioTexto: "Aguila" })) === "Registro Civil de Águilas")
  ok("«a definir» só sem vínculo E sem texto (Genealogia)", orgaoTxt(L({})) === "a definir")
  ok("atalho «vincular órgão» só quando há texto sem vínculo", orgaoSoEmTexto(L({ cartorioTexto: "Aguila" })) && !orgaoSoEmTexto(L({})) && !orgaoSoEmTexto(L({ terceiroNome: "X", cartorioTexto: "Aguila" })))
  const abas = src("src/components/operacao/operacao-v3-abas.tsx")
  ok("o atalho existe nas abas (AtalhoVincularOrgao)", /function AtalhoVincularOrgao/.test(abas) && (abas.match(/<AtalhoVincularOrgao/g) ?? []).length >= 3)

  secao("A2) conclusão exige órgão vinculado em qualquer país")
  const op = src("src/services/documento-operacao.ts")
  ok("servidor: concluir localizar_registro sem Documento.orgaoId → 422 ORGAO_NAO_VINCULADO", /stepKey === "localizar_registro"[\s\S]{0,400}orgaoId == null\) return \{ ok: false, error: "VALIDATION_ERROR:ORGAO_NAO_VINCULADO", status: 422 \}/.test(op))
  const ed = src("src/components/kanban/workflow/EditorRegistralModal.tsx")
  ok("editor: orgaoOk NÃO depende de ser Brasil", /const orgaoOk = !cartorioOk \|\| form\.orgaoId != null/.test(ed))
  const campo = src("src/components/orgaos/CartorioOrgaoField.tsx")
  ok("cadastro rápido: país obrigatório no botão", /f\.city\.trim\(\) && f\.paisId/.test(campo))
  const r1 = await cadastrarOrgaoRapido(prisma, { name: "Standesamt Teste", tipo: "CARTORIO", city: "Zürich", state: null, paisId: null }, null)
  ok("cadastro rápido sem país → CAMPOS_OBRIGATORIOS", !r1.ok && r1.code === "CAMPOS_OBRIGATORIOS")
  const oferta = await garantirOferta(prisma, { countryKey: "OBVAG_PAIS", countryLabel: "País Obvag", modalityKey: "administrativa", modalityLabel: "Administrativa" })
  await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: "OBVAG" } } })
  const r2 = await cadastrarOrgaoRapido(prisma, { name: "OBVAG Standesamt Zürich", tipo: "CARTORIO", city: "Zürich", state: null, paisId: oferta.paisId }, null)
  ok("cadastro rápido com nome, cidade e país → ok", r2.ok)
  const achou = await buscarOrgaos(prisma, "obvag zurich")
  ok("busca sem acento acha «Zürich» digitando «zurich»", achou.some((o) => o.name === "OBVAG Standesamt Zürich"), JSON.stringify(achou.map((o) => o.name)))
  const achouCidade = await buscarOrgaos(prisma, "obvag", { cidade: "zurich" })
  ok("busca por texto + cidade sem acento", achouCidade.some((o) => o.name === "OBVAG Standesamt Zürich"))
  await prisma.logAuditoria.deleteMany({ where: { acao: "ORGAO_CRIADO_PAINEL_DOCUMENTO", descricao: { contains: "OBVAG" } } })
  await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: "OBVAG" } } })

  secao("B5) «Atribuir» da fila leva à Torre (Lei da Torre, L4 — sem botão morto)")
  const v3 = src("src/components/operacao/operacao-v3.tsx")
  ok("não há mais «ação ainda não ligada»", !/ainda não ligada/.test(v3) && !/onNaoLigado/.test(v3))
  ok("não atribui mais pela fila: sem porta de comando atribuir|transferir", !/"atribuir" : "transferir"/.test(v3) && !/atribuirSelecionadas/.test(v3))
  ok("o botão é um link «Atribuir na Torre» para /torre?aba=tarefas", /href="\/torre\?aba=tarefas"[^>]*>Atribuir na Torre/.test(v3))
  ok("não abre mais o seletor de responsável", !/<SeletorResponsavel/.test(v3))

  secao("B6) Aguardando e Acompanhamento agrupam por pessoa")
  ok("helper por pessoa dentro da família usado nas duas abas", /const porPessoaSeAtivo/.test(abas) && /porPessoaSeAtivo\(grupo\.linhas, !!onVerFamilia\)/.test(abas) && /porPessoaSeAtivo\(g\.linhas, true\)/.test(abas))

  console.log(`\n${passou} ok, ${falhou} falha(s)`)
  if (falhou) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
