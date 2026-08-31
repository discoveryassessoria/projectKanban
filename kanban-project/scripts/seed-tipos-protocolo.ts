// scripts/seed-tipos-protocolo.ts
//
// Os 7 valores do enum `TipoProtocolo` viram linhas do cadastro.
//
// Migrar o enum sem trazer os valores existentes deixaria a tela de protocolo com
// um seletor vazio no primeiro dia. O `code` é o próprio valor do enum: é ele que
// permite converter o histórico depois, sem adivinhação por nome.
// Idempotente pela chave `code`.
import { prisma } from "../src/lib/prisma"

const TIPOS: { code: string; nome: string; descricao: string }[] = [
  { code: "CONSULAR", nome: "Consular", descricao: "Protocolo em consulado ou embaixada." },
  { code: "JUDICIAL", nome: "Judicial", descricao: "Protocolo em ação judicial." },
  { code: "ADMINISTRATIVO", nome: "Administrativo", descricao: "Protocolo em via administrativa." },
  { code: "COMUNE", nome: "Comune", descricao: "Protocolo em comune italiano." },
  { code: "CARTORIO", nome: "Cartório", descricao: "Protocolo em cartório de registro civil ou de notas." },
  { code: "TRIBUNAL", nome: "Tribunal", descricao: "Protocolo em tribunal." },
  { code: "OUTRO", nome: "Outro", descricao: "Ato que não se enquadra nos demais tipos." },
]

async function main() {
  const aplicar = process.argv.includes("--aplicar")
  let i = 0
  for (const t of TIPOS) {
    const ja = await prisma.tipoProtocoloCadastro.findUnique({ where: { code: t.code }, select: { id: true } })
    if (!aplicar) { console.log(`  ${ja ? "=" : "+"} ${t.code} — ${t.nome}`); i++; continue }
    const r = await prisma.tipoProtocoloCadastro.upsert({
      where: { code: t.code },
      update: {},
      create: { code: t.code, nome: t.nome, descricao: t.descricao, ordem: i, ativo: true },
      select: { id: true, code: true, nome: true },
    })
    console.log(`  ✅ ${r.code} — ${r.nome}`)
    i++
  }
  if (!aplicar) console.log("\n(dry-run — rode com --aplicar para gravar)")
  process.exit(0)
}
main()
