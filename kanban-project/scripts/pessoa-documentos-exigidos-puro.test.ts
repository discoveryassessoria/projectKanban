// scripts/pessoa-documentos-exigidos-puro.test.ts
// ============================================================================
// Pessoa.documentosExigidos — o FILTRO SUBTRATIVO de certidões (NAS/CAS/OBI) — parte PURA e ESTÁTICA (sem banco).
//   • lista fechada de três; resolução do code real do tipo ('IT - NAS', 'NAS', 'PREFIXO-NAS');
//   • validação da API (lista fechada, sem repetição, [] válido, três = null, null = regra automática);
//   • decisões 1–3: filtro vale para QUALQUER pessoa (linha reta, requerente, fora da linhagem — revisto em 01/10/2026), NULL idêntico a hoje, Casamento por união (ao menos um cônjuge mantém);
//   • migration EXATA; schema; rotas; UI (texto corrigido, enviar só se mudou); registros no CI.
//
//   node scripts/ci/gate-build.mjs --suite todas --so pessoa-documentos-exigidos-puro
// ============================================================================
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DOCUMENTOS_EXIGIVEIS, CODIGOS_DOCUMENTOS_EXIGIVEIS, codigoExigivelDoTipo, validarDocumentosExigidos, lerDocumentosExigidosGravado,
  marcadosParaTela, filtroSeAplica, documentoEscolhidoParaPessoa, documentoDaUniaoEscolhido, mesmaEscolha, descreverMudancaDocumentosExigidos,
  rotuloDaLista, type PessoaParaFiltroDocumental,
} from "../src/lib/genealogia/documentos-exigidos"
import { descreverMudancaPessoa } from "../src/services/genealogia/propagar-arvore"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${extra}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf-8")

const P = (o: Partial<PessoaParaFiltroDocumental>): PessoaParaFiltroDocumental => ({ classificacao: "FORA_DA_LINHAGEM", documentacao: true, documentosExigidos: null, ...o })

console.log("PESSOA.documentosExigidos — filtro subtrativo (puro/estático)")

secao("1) Lista fechada de três e resolução do code do tipo")
ok("exatamente Nascimento, Casamento, Óbito (NAS, CAS, OBI)", JSON.stringify(DOCUMENTOS_EXIGIVEIS.map((d) => [d.code, d.rotulo])) === JSON.stringify([["NAS", "Nascimento"], ["CAS", "Casamento"], ["OBI", "Óbito"]]))
ok("code real do cadastro: 'IT - NAS' / 'IT - CAS' / 'IT - OBI' (regras da Genealogia)", codigoExigivelDoTipo("IT - NAS") === "NAS" && codigoExigivelDoTipo("IT - CAS") === "CAS" && codigoExigivelDoTipo("IT - OBI") === "OBI")
ok("code simples 'NAS'/'CAS'/'OBI' e fixture 'ARVF-NAS'", codigoExigivelDoTipo("NAS") === "NAS" && codigoExigivelDoTipo("CAS") === "CAS" && codigoExigivelDoTipo("ARVF-OBI") === "OBI")
ok("RG, comprovante, procuração, batismo e vazio NÃO são dos três (o filtro não os toca)", ["RG", "COMP-RES", "OUTRO", "BAT", "", null, undefined].every((c) => codigoExigivelDoTipo(c as string | null | undefined) === null))

secao("2) Validação (a mesma da API e do preview)")
const v = validarDocumentosExigidos
ok("null → regra automática", (() => { const r = v(null); return r.ok && r.valor === null })())
ok("os três → null (nada a filtrar), em qualquer ordem", (() => { const a = v(["CAS", "OBI", "NAS"]); return a.ok && a.valor === null })())
ok("subconjunto → ordem canônica", (() => { const r = v(["OBI", "NAS"]); return r.ok && JSON.stringify(r.valor) === JSON.stringify(["NAS", "OBI"]) })())
ok("lista vazia é VÁLIDA e significa 'nenhum documento'", (() => { const r = v([]); return r.ok && Array.isArray(r.valor) && r.valor.length === 0 })())
ok("code fora da lista, repetição, string e objeto são recusados", !v(["XXX"]).ok && !v(["NAS", "NAS"]).ok && !v("NAS").ok && !v({}).ok && !v([1]).ok && !v(["nas"]).ok)
ok("leitura do gravado é defensiva: lixo = null (regra automática)", lerDocumentosExigidosGravado("x") === null && lerDocumentosExigidosGravado({}) === null && JSON.stringify(lerDocumentosExigidosGravado(["NAS", "ZZZ"])) === JSON.stringify(["NAS"]))
ok("tela: NULL ⇒ os três marcados; lista ⇒ a lista", JSON.stringify(marcadosParaTela(null)) === JSON.stringify(CODIGOS_DOCUMENTOS_EXIGIVEIS) && JSON.stringify(marcadosParaTela(["CAS"])) === JSON.stringify(["CAS"]) && marcadosParaTela([]).length === 0)
ok("NULL ≡ os três; [] ≠ NULL", mesmaEscolha(null, ["NAS", "CAS", "OBI"]) && !mesmaEscolha(null, []) && !mesmaEscolha(["NAS"], null) && mesmaEscolha(["NAS", "OBI"], ["OBI", "NAS"]))

secao("3) Decisão 2 (REVISTA em 01/10/2026): o filtro vale para QUALQUER pessoa")
const so = ["NAS"]
ok("FORA + lista [NAS]: NAS fica; CAS e OBI saem", documentoEscolhidoParaPessoa(P({ documentosExigidos: so }), "NAS") && !documentoEscolhidoParaPessoa(P({ documentosExigidos: so }), "CAS") && !documentoEscolhidoParaPessoa(P({ documentosExigidos: so }), "OBI"))
ok("LINHA_PRINCIPAL APLICA a lista: [NAS] mantém Nascimento e tira Casamento/Óbito; [] tira os três", documentoEscolhidoParaPessoa(P({ classificacao: "LINHA_PRINCIPAL", documentosExigidos: so }), "NAS") && !documentoEscolhidoParaPessoa(P({ classificacao: "LINHA_PRINCIPAL", documentosExigidos: so }), "CAS") && !documentoEscolhidoParaPessoa(P({ classificacao: "LINHA_PRINCIPAL", documentosExigidos: so }), "OBI") && (["NAS", "CAS", "OBI"] as const).every((c) => !documentoEscolhidoParaPessoa(P({ classificacao: "LINHA_PRINCIPAL", documentosExigidos: [] }), c)))
ok("PENDENTE_CLASSIFICACAO também aplica a lista", !documentoEscolhidoParaPessoa(P({ classificacao: "PENDENTE_CLASSIFICACAO", documentosExigidos: ["NAS", "OBI"] }), "CAS") && documentoEscolhidoParaPessoa(P({ classificacao: "PENDENTE_CLASSIFICACAO", documentosExigidos: ["NAS", "OBI"] }), "OBI"))
ok("campo NULL em LINHA_PRINCIPAL: tudo continua exigido (pessoas existentes não mudam)", (["NAS", "CAS", "OBI"] as const).every((c) => documentoEscolhidoParaPessoa(P({ classificacao: "LINHA_PRINCIPAL" }), c)))
ok("campo NULL: tudo continua exigido (idêntico a hoje)", (["NAS", "CAS", "OBI"] as const).every((c) => documentoEscolhidoParaPessoa(P({}), c)))
ok("lista [] em FORA: nada dos três é exigido", (["NAS", "CAS", "OBI"] as const).every((c) => !documentoEscolhidoParaPessoa(P({ documentosExigidos: [] }), c)))
ok("tipo fora dos três (code null) nunca é filtrado", documentoEscolhidoParaPessoa(P({ documentosExigidos: [] }), null))
ok("filtroSeAplica: lista gravada em qualquer classificação; só NÃO vale sem lista, ou FORA com a documentação desligada", filtroSeAplica(P({ documentosExigidos: [] })) && filtroSeAplica(P({ classificacao: "LINHA_PRINCIPAL", documentosExigidos: [] })) && filtroSeAplica(P({ classificacao: "PENDENTE_CLASSIFICACAO", documentosExigidos: ["NAS"] })) && !filtroSeAplica(P({})) && !filtroSeAplica(P({ classificacao: "LINHA_PRINCIPAL" })) && !filtroSeAplica(P({ documentacao: false, documentosExigidos: [] })))

secao("4) Decisão 3: Casamento (união) vale se PELO MENOS UM cônjuge o mantém")
const semCas = P({ documentosExigidos: ["NAS", "OBI"] })
ok("dois FORA, ambos sem Casamento → some", !documentoDaUniaoEscolhido([semCas, semCas], "CAS"))
ok("dois FORA, um mantém → fica", documentoDaUniaoEscolhido([semCas, P({ documentosExigidos: ["CAS"] })], "CAS"))
ok("FORA sem Casamento + FORA com campo NULL (automático) → fica", documentoDaUniaoEscolhido([semCas, P({})], "CAS"))
ok("FORA sem Casamento + LINHA_PRINCIPAL sem lista (automático) → fica", documentoDaUniaoEscolhido([semCas, P({ classificacao: "LINHA_PRINCIPAL" })], "CAS"))
ok("FORA sem Casamento + LINHA_PRINCIPAL TAMBÉM sem Casamento → some (a lista da linha reta vale)", !documentoDaUniaoEscolhido([semCas, P({ classificacao: "LINHA_PRINCIPAL", documentosExigidos: ["NAS", "OBI"] })], "CAS"))
ok("LINHA_PRINCIPAL com Casamento marcado sustenta a união mesmo com o outro cônjuge sem", documentoDaUniaoEscolhido([semCas, P({ classificacao: "LINHA_PRINCIPAL", documentosExigidos: ["CAS"] })], "CAS"))
ok("FORA sem Casamento + FORA com documentação DESLIGADA → some (quem não quer documento não sustenta a união)", !documentoDaUniaoEscolhido([semCas, P({ documentacao: false })], "CAS"))
ok("união de outro tipo/code null nunca é filtrada", documentoDaUniaoEscolhido([P({ documentosExigidos: [] })], null))

secao("5) Auditoria (texto) e descreverMudancaPessoa")
ok("sem mudança real (NULL → os três) não descreve nada", descreverMudancaDocumentosExigidos(null, ["NAS", "CAS", "OBI"]) === null)
ok("descreve de/para legível", descreverMudancaDocumentosExigidos(null, ["NAS"]) === "documentos exigidos da pessoa alterados: de Nascimento, Casamento, Óbito para Nascimento")
ok("lista vazia = 'nenhum documento'", rotuloDaLista([]) === "nenhum documento")
const base = { casado: false, vivo: true, paiId: null, maeId: null, linhaReta: false, requerente: "nao", documentacao: true }
ok("descreverMudancaPessoa cobre a lista", descreverMudancaPessoa({ ...base, documentosExigidos: null }, { ...base, documentosExigidos: ["OBI"] }).some((m) => /documentos exigidos da pessoa alterados/.test(m)))
ok("e NÃO acusa mudança quando a lista não mudou", descreverMudancaPessoa({ ...base, documentosExigidos: null }, { ...base, documentosExigidos: null }).length === 0)

secao("6) Migration, schema, rotas, UI e registros (estático)")
const mig = ler("prisma/migrations/20261002100000_pessoa_documentos_exigidos/migration.sql")
const sql = mig.split("\n").filter((l) => !l.trim().startsWith("--") && l.trim()).join("\n")
ok("migration: UM ALTER aditivo e idempotente, JSONB nullable, sem backfill", sql === 'ALTER TABLE "Pessoa" ADD COLUMN IF NOT EXISTS "documentosExigidos" JSONB;', sql)
ok("migration: comentário explica (aditiva, idempotente, nullable, sem backfill, NULL = regra automática)", /ADITIVA/.test(mig) && /IDEMPOTENTE/.test(mig) && /NULLABLE/.test(mig) && /SEM BACKFILL/.test(mig) && /NULL = regra automática/.test(mig))
ok("schema.prisma: documentosExigidos Json? @db.JsonB em Pessoa", /documentosExigidos\s+Json\?\s+@db\.JsonB/.test(ler("prisma/schema.prisma")))
ok("baseline-verificar declara a migration", ler("scripts/baseline-verificar.test.ts").includes("'20261002100000_pessoa_documentos_exigidos'"))
const post = ler("src/app/api/pessoas/route.ts"), put = ler("src/app/api/pessoas/[id]/route.ts")
ok("POST valida pela constante única e ignora com documentacao=false", /validarDocumentosExigidos\(documentosExigidos\)/.test(post) && /documentacao === false \? null/.test(post))
ok("PUT valida, ignora com documentacao=false e só grava quando MUDOU", /validarDocumentosExigidos\(body\.documentosExigidos\)/.test(put) && /documentacaoFinal/.test(put) && /!mesmaEscolha\(antes\?\.documentosExigidos/.test(put))
ok("PUT audita a decisão e continua com 'arvore.editar'", /auditarDocumentosExigidos/.test(put) && /verificarPermissao\(request, 'arvore\.editar'\)/.test(put))
const sim = ler("src/app/api/processos/[processoId]/genealogia/simular-impacto/route.ts")
ok("simular-impacto: campo na lista fechada, validado", /"documentosExigidos"/.test(sim) && /validarDocumentosExigidos/.test(sim))
ok("simular-impacto (serviço): MudancasPropostas e aplicação da mudança", /documentosExigidos\?: string\[\] \| null/.test(ler("src/services/genealogia/simular-impacto.ts")))
const nucleo = ler("src/services/genealogia/materializar-genealogia.ts")
ok("núcleo: lê o campo, aplica o filtro e expõe as removidas por escolha", /documentacao: true, documentosExigidos: true/.test(nucleo) && /documentoDaUniaoEscolhido/.test(nucleo) && /removidasPorEscolha/.test(nucleo))
ok("núcleo: pessoaExigeDocumentacao INTACTA (documentacao=false só tem efeito FORA da linhagem)", /classificacao === "FORA_DA_LINHAGEM" \? documentacao === true : true/.test(nucleo))
ok("núcleo: a_iniciar = retorno antecipado ANTES de calcular/reconciliar", nucleo.indexOf("ehFaseAguardandoFechamento(posicao?.faseAtualKey)") > 0 && nucleo.indexOf("ehFaseAguardandoFechamento(posicao?.faseAtualKey)") < nucleo.indexOf("const calculo = await calcularExigenciasDaGenealogia(processoId, db)"))
const view = ler("src/components/arvore/arvore-genealogica-view.tsx"), campo = ler("src/components/arvore/documentos-exigidos-campo.tsx")
ok("UI: texto da caixa explica a lista e a exceção da linha principal, nas DUAS modais; sem o aviso antigo de que a lista não vale", (view.match(/TEXTO_PRECISA_DOCUMENTACAO/g) ?? []).length >= 3 && /escolha abaixo quais certidões ela precisa/.test(campo) && /exceto quem está na linha principal \(linha reta ou requerente\), que continua entrando/.test(campo) && /Central Operacional \/ workflow/.test(campo) && !/Vale para pessoas fora da linha reta do requerente/.test(campo + view))
ok("UI: a lista NUNCA é desabilitada por linha reta/requerente (sem `aplicavel`, sem aviso 'a lista não se aplica')", !/aplicavel/.test(campo + view) && !/a lista não se aplica/.test(campo) && !/disabled=\{!aplic/.test(campo))
ok("UI: a multi-seleção abre nas duas modais, abaixo da caixa", (view.match(/<DocumentosExigidosCampo/g) ?? []).length === 2 && (view.match(/precisaDocumentacao && <DocumentosExigidosCampo/g) ?? []).length === 2)
ok("UI: o aviso do 'sumiço silencioso' está na tela", /NÃO volta sozinho se a pessoa casar ou falecer depois/.test(campo))
ok("UI: Editar só envia a lista quando MUDOU e reflete o salvo (NULL ⇒ três)", /\.\.\.\(documentosExigidosMudou \? \{ documentosExigidos: docsMarcados \} : \{\}\)/.test(view) && /marcadosParaTela\(\(pessoa as any\)\.documentosExigidos\)/.test(view))
ok("UI: a lista entra em documentacaoMudou/mudancaRelevante/preview", /documentosExigidosMudou \|\| paiMudou/.test(view) && /\.\.\.\(documentosExigidosMudou \? \{ documentosExigidos: docsMarcados \} : \{\}\),\n\s+paiId/.test(view) && /campo: 'Certidões exigidas'/.test(view))
ok("UI: sem botão morto — cada checkbox tem onChange; sem texto de exemplo", !/TODO|lorem|exemplo/i.test(campo) && (campo.match(/onChange=/g) ?? []).length === 1)
const suite = ler("scripts/ci/suite-critica.json")
for (const t of ["pessoa-documentos-exigidos-puro", "pessoa-documentos-exigidos-integracao"]) {
  ok(`suite-critica registra ${t} nas DUAS listas (grupos e arquivos)`, (suite.match(new RegExp(`${t}\\.test\\.ts`, "g")) ?? []).length === 2)
}

console.log(`\n${falhou === 0 ? "✅" : "❌"} DOCUMENTOS EXIGIDOS (puro) — ${passou} ok, ${falhou} falhas`)
if (falhou > 0) process.exit(1)
