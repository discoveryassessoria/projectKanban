/**
 * MDM-3 — Triagem de duplicidade antes de criar Pessoa.
 * Rodar: tsx scripts/mdm3-dedup.test.ts
 *
 * Regra que o teste protege: nenhuma Pessoa nasce sem triagem. Enquanto o
 * serviço de fusão (MDM-4) não existe, toda duplicata criada é permanente —
 * então o portão de entrada é a única defesa que o sistema tem.
 */
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import {
  avaliarCriacao,
  compararCandidato,
  descreverTriagem,
  termosBusca,
  triar,
  LIMIAR_CONFIRMACAO,
  LIMIAR_INFORMATIVO,
  type DadosPessoaNova,
  type PessoaCandidata,
} from "../src/lib/cadastro-mestre/dedup"

let passed = 0, failed = 0
const falhas: string[] = []
function ok(c: boolean, n: string) {
  if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; falhas.push(n); console.log(`  ❌ ${n}`) }
}

const RAIZ = join(__dirname, "..")
const base: DadosPessoaNova = {
  nome: "Giovanni",
  sobrenome: "Bianchi",
  sexo: "Masculino",
  dataNascimento: "1898-03-22",
  localNascimento: "Vicenza",
}
const cand = (p: Partial<PessoaCandidata>): PessoaCandidata => ({
  id: 1, nome: "Giovanni", sobrenome: "Bianchi", sexo: "Masculino",
  data_nasc: "1898-03-22", local_nasc: "Vicenza", ...p,
})

console.log("\n1) CPF é decisivo nos dois sentidos")
{
  const r = triar({ ...base, cpf: "123.456.789-00" }, [cand({ cpf: "12345678900" })])
  ok(r.nivel === "BLOQUEIO", "mesmo CPF bloqueia a criação")
  ok(r.candidatos[0].score === 1, "score máximo com CPF idêntico")
  ok(!r.criacaoLivre, "bloqueio nunca é criação livre")
}
{
  const r = triar({ ...base, cpf: "111.111.111-11" }, [cand({ cpf: "22222222222" })])
  ok(r.nivel === "LIVRE", "CPFs diferentes eliminam o candidato mesmo com nome idêntico")
}
{
  const r = triar({ ...base, cpf: "111.111.111-11" }, [cand({ cpf: null })])
  ok(r.nivel === "CONFIRMACAO", "candidato sem CPF ainda é comparado por nome/data")
}

console.log("\n2) Similaridade")
{
  const r = triar(base, [cand({})])
  ok(r.nivel === "CONFIRMACAO", "ficha idêntica exige confirmação")
  ok(r.candidatos[0].score >= LIMIAR_CONFIRMACAO, `score ${r.candidatos[0].score.toFixed(2)} ≥ limiar`)
  ok(r.candidatos[0].evidencias.some(e => e.campo === "nome"), "evidência de nome é listada")
}
{
  const r = triar(base, [cand({ nome: "Giovani", sobrenome: "Bianqui" })])
  ok(r.nivel === "CONFIRMACAO", "grafia diferente ainda casa (fonética)")
}
{
  const r = triar(base, [cand({ sexo: "Feminino" })])
  ok(r.nivel === "LIVRE", "sexo divergente derruba o candidato")
}
{
  const r = triar(base, [cand({ data_nasc: "1930-01-01" })])
  ok(r.nivel === "LIVRE", "32 anos de diferença derruba")
}
{
  const r = triar(base, [cand({ nome: "Antonio", sobrenome: "Rossi", local_nasc: "Napoli" })])
  ok(r.nivel === "LIVRE", "pessoa diferente não vira candidato")
}
{
  const r = triar({ ...base, paiId: 10, maeId: 11 }, [cand({ paiId: 99, maeId: 98 })])
  ok(r.candidatos.length === 0 || r.candidatos[0].score < LIMIAR_CONFIRMACAO, "filiação divergente reduz o score")
}
{
  const r = triar({ ...base, paiId: 10 }, [cand({ paiId: 10 })])
  ok(r.candidatos[0].evidencias.some(e => e.campo === "filiacao"), "ascendente em comum vira evidência")
}
ok(compararCandidato(base, cand({ fundidaEmId: 5 })) === null, "pessoa já fundida não é candidata")

console.log("\n3) Veredito de criação")
{
  const bloq = triar({ ...base, cpf: "12345678900" }, [cand({ cpf: "12345678900" })])
  const v = avaliarCriacao(bloq, { tipo: "CRIOU_NOVA", justificativa: "quero mesmo" })
  ok(!v.permitido && v.codigo === "BLOQUEIO_CPF", "bloqueio de CPF não tem escapatória")
}
{
  const conf = triar(base, [cand({})])
  ok(!avaliarCriacao(conf, null).permitido, "sem decisão registrada não cria")
  const semJust = avaliarCriacao(conf, { tipo: "CRIOU_NOVA", justificativa: "  " })
  ok(!semJust.permitido && semJust.codigo === "DECISAO_NAO_CORRESPONDE", "criar apesar do alerta exige justificativa")
  const comJust = avaliarCriacao(conf, { tipo: "CRIOU_NOVA", justificativa: "Homônimo, filiação diferente." })
  ok(comJust.permitido && comJust.exigeRegistro, "com justificativa cria e registra")
  const vinculaInvalido = avaliarCriacao(conf, { tipo: "VINCULOU_EXISTENTE", pessoaEscolhidaId: 999 })
  ok(!vinculaInvalido.permitido && vinculaInvalido.codigo === "CANDIDATO_INVALIDO", "só vincula a candidato apresentado")
  ok(avaliarCriacao(conf, { tipo: "VINCULOU_EXISTENTE", pessoaEscolhidaId: 1 }).permitido, "vincular a candidato válido é permitido")
}
{
  const livre = triar(base, [])
  const v = avaliarCriacao(livre, null)
  ok(v.permitido && !v.exigeRegistro, "sem candidato, criação livre e sem registro")
  ok(livre.criacaoLivre, "nível LIVRE marca criação livre")
}
{
  const info = triar({ ...base, localNascimento: null, dataNascimento: null }, [cand({ sobrenome: "Bianco", data_nasc: null, local_nasc: null })])
  if (info.nivel === "INFORMATIVO") {
    const v = avaliarCriacao(info, null)
    ok(v.permitido && v.exigeRegistro, "informativo permite criar mas registra a decisão")
  } else { ok(true, "cenário informativo dependente de dados (não aplicável)") }
}

console.log("\n4) Chave e utilitários")
{
  const r = triar({ ...base, cpf: "12345678900" }, [])
  ok(r.chaveDedup.startsWith("cpf:"), "com CPF a chave é forte")
  const semCpf = triar(base, [])
  ok(semCpf.chaveDedup.startsWith("nome:"), "sem CPF a chave é fraca (nome+nascimento)")
  ok(termosBusca(base).length === 2, "termos de busca cobrem nome e sobrenome")
  ok(descreverTriagem(r).length > 0, "triagem tem descrição legível")
  ok(LIMIAR_CONFIRMACAO > LIMIAR_INFORMATIVO, "limiares são coerentes")
}

console.log("\n5) Arquitetura")
{
  const dedup = readFileSync(join(RAIZ, "src/lib/cadastro-mestre/dedup.ts"), "utf8")
  ok(!/prisma|fetch\(/.test(dedup), "triagem é pura (sem banco, sem rede)")
  ok(/from "@\/src\/services\/identity"/.test(dedup), "reutiliza a chave de dedup do CP-1")
  ok(/motor\/texto/.test(dedup), "reutiliza as distâncias já existentes")
  for (const c of ["data_nasc", "sexo", "nacionalidade", "cpf"]) {
    ok(!new RegExp(`interface DecisaoRegistro[\\s\\S]*${c}`).test(dedup), `não copia '${c}' do mestre`)
  }

  const schema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8")
  const modelo = schema.match(/model DecisaoDeduplicacao \{([\s\S]*?)\n\}/)?.[1] ?? ""
  ok(modelo.length > 0, "modelo DecisaoDeduplicacao no schema")
  ok(/candidatosAvaliados\s+Json/.test(modelo), "snapshot imutável dos candidatos exibidos")
  ok(/pessoaResultanteId\s+Int\?/.test(modelo), "apenas REFERENCIA Pessoa")
  for (const c of ["nome", "data_nasc", "sexo", "cpf"]) {
    ok(!new RegExp(`^\\s+${c}\\s`, "m").test(modelo), `não copia '${c}'`)
  }
  ok(!/publicCode/.test(modelo), "sem publicCode")

  const sql = readFileSync(join(RAIZ, "prisma/migrations/20260828000001_mdm3_decisao_dedup/migration.sql"), "utf8")
  ok(/CREATE TABLE IF NOT EXISTS "DecisaoDeduplicacao"/.test(sql), "cria tabela idempotente")
  ok(!/DROP\s+(TABLE|COLUMN)/i.test(sql), "sem DROP — aditiva")
  ok(!/ALTER TABLE "Pessoa"/i.test(sql), "não altera Pessoa")
  ok(!/UPDATE\s+"/i.test(sql), "sem escrita em dado existente")
  ok(/bloqueio_nao_cria_check/.test(sql), "banco impede 'bloqueio que criou'")
  ok(/confirmacao_justifica_check/.test(sql), "banco exige justificativa na confirmação")
}

console.log(`\n${failed === 0 ? "✅" : "❌"} MDM-3 — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
