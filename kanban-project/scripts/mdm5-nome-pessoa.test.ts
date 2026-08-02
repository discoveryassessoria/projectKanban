/**
 * MDM-5 — Nomes alternativos + contrato de afirmação auditável.
 * Rodar: tsx scripts/mdm5-nome-pessoa.test.ts
 *
 * Cobre os dois complementos obrigatórios da arquitetura aprovada:
 *   1. nenhum domínio novo copia dado do Cadastro Mestre;
 *   2. nenhuma hipótese vira fato silenciosamente.
 *
 * A lógica testada é pura de propósito: o único banco do Discovery é produção,
 * então a invariante precisa estar coberta sem banco — senão não está coberta.
 */
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import {
  descreverAfirmacao,
  ehPeloMenos,
  maisForte,
  validarAfirmacao,
  validarPromocao,
  MINIMO_PARA_LINHA,
  type AfirmacaoAuditavel,
} from "../src/lib/cadastro-mestre/afirmacao"
import {
  chaveIdempotenciaNome,
  formasBuscaveis,
  planejarAdicionar,
  planejarReafirmar,
  planejarRemover,
  planejarTrocarPrincipal,
  afirmacaoDeImportacao,
  type NomeExistente,
} from "../src/services/cadastro-mestre/nome-pessoa"

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}`)
  }
}

const RAIZ = join(__dirname, "..")
const AGORA = new Date("2026-07-28T12:00:00Z")

function afirmacao(p: Partial<AfirmacaoAuditavel> = {}): AfirmacaoAuditavel {
  return {
    origem: "OPERADOR",
    confianca: "PROVAVEL",
    responsavelId: 7,
    afirmadoEm: AGORA,
    justificativa: "Consta assim na certidão de casamento.",
    evidenciaNecessidadeId: null,
    ...p,
  }
}

// ============================================================
console.log("\n1) Escala única de confiança")
ok(maisForte("HIPOTESE", "CONFIRMADO") === "CONFIRMADO", "confirmado é mais forte que hipótese")
ok(maisForte("CONTESTADO", "HIPOTESE") === "HIPOTESE", "contestado é o mais fraco da escala")
ok(ehPeloMenos("PROVAVEL", MINIMO_PARA_LINHA), "provável sustenta a linha de cidadania")
ok(!ehPeloMenos("HIPOTESE", MINIMO_PARA_LINHA), "hipótese NÃO sustenta a linha")
ok(!ehPeloMenos("CONTESTADO", MINIMO_PARA_LINHA), "contestado NÃO sustenta a linha")

// ============================================================
console.log("\n2) Complemento 2 — hipótese nunca vira fato silenciosamente")
{
  const r = validarAfirmacao(afirmacao({ origem: "IA", confianca: "CONFIRMADO" }))
  ok(!r.valido && r.codigo === "IA_NAO_CONFIRMA", "IA não pode nascer confirmada")
}
{
  const r = validarAfirmacao(afirmacao({ origem: "IA", confianca: "PROVAVEL" }))
  ok(!r.valido && r.codigo === "IA_NAO_CONFIRMA", "IA não pode nascer nem como provável")
}
ok(
  validarAfirmacao(afirmacao({ origem: "IA", confianca: "HIPOTESE" })).valido,
  "IA pode nascer como hipótese",
)
{
  const r = validarAfirmacao(afirmacao({ confianca: "CONFIRMADO", evidenciaNecessidadeId: null }))
  ok(!r.valido && r.codigo === "CONFIRMADO_SEM_EVIDENCIA", "confirmar exige evidência documental")
}
ok(
  validarAfirmacao(afirmacao({ confianca: "CONFIRMADO", evidenciaNecessidadeId: 42 })).valido,
  "confirmado com evidência é válido",
)
ok(
  validarAfirmacao(afirmacao({ origem: "DOCUMENTO", confianca: "CONFIRMADO", justificativa: null })).valido,
  "origem DOCUMENTO dispensa justificativa e evidência avulsa",
)
{
  const r = validarAfirmacao(afirmacao({ responsavelId: null }))
  ok(!r.valido && r.codigo === "SEM_RESPONSAVEL", "afirmação humana exige responsável")
}
ok(
  validarAfirmacao(afirmacao({ origem: "MOTOR", responsavelId: null })).valido,
  "origem automática (MOTOR) dispensa responsável",
)
ok(
  validarAfirmacao(afirmacao({ origem: "IMPORTACAO", responsavelId: null })).valido,
  "importação dispensa responsável",
)
{
  const r = validarAfirmacao(afirmacao({ justificativa: "   " }))
  ok(!r.valido && r.codigo === "SEM_JUSTIFICATIVA", "justificativa em branco é rejeitada")
}
ok(
  descreverAfirmacao(afirmacao({ confianca: "HIPOTESE" })).includes("não confirmado"),
  "hipótese nunca é apresentada com a voz de fato",
)

console.log("\n3) Promoção de confiança")
ok(validarPromocao("CONFIRMADO", "HIPOTESE", afirmacao()).valido, "rebaixar é sempre permitido")
{
  const r = validarPromocao("HIPOTESE", "CONFIRMADO", afirmacao({ evidenciaNecessidadeId: null }))
  ok(!r.valido && r.codigo === "PROMOCAO_SEM_EVIDENCIA", "promover a confirmado exige evidência")
}
{
  const r = validarPromocao("CONTESTADO", "PROVAVEL", afirmacao({ evidenciaNecessidadeId: null }))
  ok(!r.valido && r.codigo === "PROMOCAO_DE_CONTESTADO", "sair de contestado exige prova, não reafirmação")
}
ok(
  validarPromocao("CONTESTADO", "PROVAVEL", afirmacao({ evidenciaNecessidadeId: 9 })).valido,
  "contestado volta a valer com evidência",
)
ok(
  validarPromocao("HIPOTESE", "PROVAVEL", afirmacao()).valido,
  "hipótese → provável com justificativa e responsável",
)

// ============================================================
console.log("\n4) Idempotência do nome")
{
  const a = chaveIdempotenciaNome({ pessoaId: 1, nome: "Giovanni", sobrenome: "Bianchi", tipo: "REGISTRAL" })
  const b = chaveIdempotenciaNome({ pessoaId: 1, nome: " giovanni ", sobrenome: "BIANCHI", tipo: "REGISTRAL" })
  ok(a === b, "mesma forma com grafia/caixa diferente gera a mesma chave")
  const c = chaveIdempotenciaNome({ pessoaId: 1, nome: "Giovanni", sobrenome: "Bianchi", tipo: "CASADA" })
  ok(a !== c, "tipo diferente é afirmação diferente")
  const d = chaveIdempotenciaNome({ pessoaId: 2, nome: "Giovanni", sobrenome: "Bianchi", tipo: "REGISTRAL" })
  ok(a !== d, "pessoa diferente é afirmação diferente")
  ok(a.length <= 200, "chave cabe no VarChar(200)")
}

// ============================================================
console.log("\n5) Invariante: um principal ativo por pessoa")
const registral: NomeExistente = {
  id: 1,
  nome: "Giovanni",
  sobrenome: "Bianchi",
  tipo: "REGISTRAL",
  principal: true,
  confianca: "CONFIRMADO",
  ativo: true,
}
{
  const r = planejarAdicionar(
    { pessoaId: 1, nome: "Giovanni", sobrenome: "Bianchi", tipo: "REGISTRAL", afirmacao: afirmacao() },
    [],
  )
  ok(r.ok && r.plano.tornarPrincipal, "primeira forma vira principal por definição")
  ok(r.ok && r.plano.rebaixarId === null, "não há quem rebaixar na primeira")
}
{
  const r = planejarAdicionar(
    { pessoaId: 1, nome: "Giovani", sobrenome: "Bianqui", tipo: "GRAFIA_DOCUMENTO", afirmacao: afirmacao() },
    [registral],
  )
  ok(r.ok && !r.plano.tornarPrincipal, "forma adicional não vira principal sozinha")
  ok(r.ok && r.plano.chaveFonetica.length > 0, "chave fonética é derivada, não digitada")
}
{
  const r = planejarAdicionar(
    { pessoaId: 1, nome: "Giovanni", sobrenome: "Bianchi", tipo: "CASADA", principal: true, afirmacao: afirmacao() },
    [registral],
  )
  ok(r.ok && r.plano.tornarPrincipal && r.plano.rebaixarId === 1, "pedir principal rebaixa o anterior")
}
{
  const r = planejarAdicionar(
    { pessoaId: 1, nome: "  Giovanni ", sobrenome: "bianchi", tipo: "REGISTRAL", afirmacao: afirmacao() },
    [registral],
  )
  ok(r.ok && r.plano.jaExiste, "adicionar forma idêntica é no-op idempotente")
}
{
  const r = planejarAdicionar(
    { pessoaId: 1, nome: "", tipo: "REGISTRAL", afirmacao: afirmacao() },
    [],
  )
  ok(!r.ok && r.codigo === "NOME_VAZIO", "nome vazio é rejeitado")
}
{
  const r = planejarAdicionar(
    { pessoaId: 1, nome: "X", tipo: "REGISTRAL", afirmacao: afirmacao({ origem: "IA", confianca: "CONFIRMADO" }) },
    [],
  )
  ok(!r.ok && r.codigo === "AFIRMACAO_INVALIDA", "afirmação inválida barra a adição")
}

console.log("\n6) Trocar principal e remover")
const casada: NomeExistente = { ...registral, id: 2, nome: "Giovanna", tipo: "CASADA", principal: false }
{
  const r = planejarTrocarPrincipal(2, [registral, casada])
  ok(r.ok && r.plano.promoverId === 2 && r.plano.rebaixarId === 1, "troca promove um e rebaixa o outro")
}
{
  const r = planejarTrocarPrincipal(99, [registral, casada])
  ok(!r.ok && r.codigo === "PRINCIPAL_INEXISTENTE", "não promove nome inexistente")
}
{
  const r = planejarRemover(2, [registral, casada])
  ok(r.ok && r.plano.novoPrincipalId === null, "remover não-principal não elege sucessor")
}
{
  const r = planejarRemover(1, [registral, casada])
  ok(r.ok && r.plano.novoPrincipalId === 2, "remover o principal elege sucessor automaticamente")
}
{
  const r = planejarRemover(1, [registral])
  ok(!r.ok && r.codigo === "REMOVER_UNICO_PRINCIPAL", "não remove a única forma ativa")
}
{
  const inativo: NomeExistente = { ...casada, id: 3, ativo: false }
  const r = planejarRemover(1, [registral, inativo])
  ok(!r.ok, "forma inativa não serve de sucessora")
}
{
  // sucessor preferencial é o REGISTRAL, não o primeiro da lista
  const apelido: NomeExistente = { ...registral, id: 4, tipo: "APORTUGUESADO", principal: false }
  const outroRegistral: NomeExistente = { ...registral, id: 5, tipo: "REGISTRAL", principal: false }
  const r = planejarRemover(1, [registral, apelido, outroRegistral])
  ok(r.ok && r.plano.novoPrincipalId === 5, "sucessão prefere a forma registral")
}

console.log("\n7) Reafirmar")
{
  const r = planejarReafirmar(1, "CONFIRMADO", afirmacao({ evidenciaNecessidadeId: 5 }), [
    { ...registral, confianca: "HIPOTESE" },
  ])
  ok(r.ok && r.plano.de === "HIPOTESE" && r.plano.para === "CONFIRMADO", "promoção válida é planejada")
}
{
  const r = planejarReafirmar(1, "CONFIRMADO", afirmacao(), [{ ...registral, confianca: "HIPOTESE" }])
  ok(!r.ok && r.codigo === "PROMOCAO_INVALIDA", "promoção sem evidência é barrada no serviço")
}

console.log("\n8) Busca")
{
  const formas = formasBuscaveis([registral, casada, { ...casada, id: 9, ativo: false, nome: "Antiga" }])
  ok(formas.length === 2, "só formas ativas entram na busca")
  ok(formas.some((f) => f.includes("Giovanna")), "todas as formas ativas são buscáveis")
}
{
  const a = afirmacaoDeImportacao(AGORA)
  ok(a.origem === "IMPORTACAO" && a.confianca === "PROVAVEL", "backfill entra como provável, não confirmado")
  ok(validarAfirmacao(a).valido, "afirmação de importação é válida sem responsável")
}

// ============================================================
console.log("\n9) Complemento 1 — nenhum domínio copia o Cadastro Mestre")
{
  const schema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8")
  const modelo = schema.match(/model NomePessoa \{([\s\S]*?)\n\}/)?.[1] ?? ""
  ok(modelo.length > 0, "modelo NomePessoa presente no schema")

  // NomePessoa é o DONO do nome (inversão de fonte, prevista na spec). Os demais
  // campos do mestre não podem aparecer.
  const proibidos = ["data_nasc", "dataNascimento", "sexo", "nacionalidade", "estadoCivil", "cpf", "rg", "paiId", "maeId"]
  for (const campo of proibidos) {
    ok(!new RegExp(`^\\s+${campo}\\s`, "m").test(modelo), `NomePessoa não copia '${campo}'`)
  }
  ok(/pessoaId\s+Int/.test(modelo), "NomePessoa apenas REFERENCIA Pessoa")

  // Os seis campos de afirmação auditável.
  for (const campo of ["origem", "confianca", "responsavelId", "afirmadoEm", "justificativa", "evidenciaNecessidadeId"]) {
    ok(new RegExp(`^\\s+${campo}\\s`, "m").test(modelo), `campo de afirmação auditável: ${campo}`)
  }
  ok(/supersedidoPorId/.test(modelo), "histórico append-only (supersessão)")
  ok(/chaveIdempotencia\s+String\s+@unique/.test(modelo), "idempotência garantida no banco")
  ok(!/publicCode/.test(modelo), "não recebe publicCode (escopo corrigido em 20/07)")
}

console.log("\n10) Migration aditiva e reversível")
{
  const dir = join(RAIZ, "prisma/migrations-arquivo/20260828000000_mdm5_nome_pessoa")
  ok(existsSync(join(dir, "migration.sql")), "migration existe")
  const sql = readFileSync(join(dir, "migration.sql"), "utf8")

  ok(/CREATE TABLE IF NOT EXISTS "NomePessoa"/.test(sql), "cria a tabela de forma idempotente")
  ok(!/DROP\s+(TABLE|COLUMN)/i.test(sql), "nenhum DROP — migração é aditiva")
  ok(!/ALTER TABLE "Pessoa"/i.test(sql), "não altera a tabela Pessoa nesta fase")
  ok(!/UPDATE\s+"/i.test(sql), "não escreve em dado existente (sem backfill na F1)")
  ok(/NomePessoa_um_principal_ativo/.test(sql), "invariante de principal único vive no banco")
  ok(/NomePessoa_ia_nao_confirma_check/.test(sql), "regra 'IA não confirma' também é CHECK no banco")
  ok(/NomePessoa_confianca_check/.test(sql), "escala de confiança restrita por CHECK")
  ok((sql.match(/IF NOT EXISTS|duplicate_object/g) || []).length >= 8, "todos os passos são idempotentes")
}

console.log("\n11) Serviço é o único portão de escrita")
{
  const svc = readFileSync(join(RAIZ, "src/services/cadastro-mestre/nome-pessoa.ts"), "utf8")
  ok(/planejarAdicionar/.test(svc) && /planejarRemover/.test(svc), "decisão é pura e separada da persistência")
  ok(/validarAfirmacao/.test(svc), "o serviço aplica o contrato de afirmação")
  ok(!/prisma\./.test(svc), "não importa o client global — opera na transação do chamador")
  ok(/ativo: false/.test(svc), "remover é desativar, nunca apagar")

  const afirm = readFileSync(join(RAIZ, "src/lib/cadastro-mestre/afirmacao.ts"), "utf8")
  ok(!/prisma|fetch\(/.test(afirm), "contrato de afirmação é puro")
}

console.log(`\n${failed === 0 ? "✅" : "❌"} MDM-5 — ${passed} ok, ${failed} falhas`)
if (failed > 0) {
  console.log("Falhas: " + falhas.join("; "))
  process.exit(1)
}
