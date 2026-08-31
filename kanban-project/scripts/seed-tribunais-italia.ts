// scripts/seed-tribunais-italia.ts
//
// Os TRIBUNAIS ORDINÁRIOS italianos entram no cadastro de Órgãos e Organizações.
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
// O tribunal do processo italiano vivia num ENUM do schema (`Tribunal`, 26
// valores). Enum não tem endereço, não tem canal, não tem função, não aparece no
// cadastro e não pode ser filtrado num relatório junto com os consulados — era
// uma segunda fonte de verdade ao lado de Órgãos e Organizações, que já é a
// fonte única de "onde se protocola".
//
// Este seed traz para o cadastro os tribunais que faltavam. NADA é inventado:
// só nome oficial, cidade e região. Endereço, telefone, e-mail e horário ficam
// NULOS — quem tem esse dado é o operador, e contato fabricado é pior que campo
// vazio.
//
// Idempotente: a chave é (name, country), que já é @@unique no modelo.
import { prisma } from "../src/lib/prisma"

/** Os 26 tribunais do enum legado, com a região a que pertencem. */
const TRIBUNAIS: { cidade: string; regiao: string }[] = [
  { cidade: "Ancona",          regiao: "Marche" },
  { cidade: "Bari",            regiao: "Puglia" },
  { cidade: "Bologna",         regiao: "Emilia-Romagna" },
  { cidade: "Brescia",         regiao: "Lombardia" },
  { cidade: "Cagliari",        regiao: "Sardegna" },
  { cidade: "Caltanissetta",   regiao: "Sicilia" },
  { cidade: "Campobasso",      regiao: "Molise" },
  { cidade: "Catania",         regiao: "Sicilia" },
  { cidade: "Catanzaro",       regiao: "Calabria" },
  { cidade: "Firenze",         regiao: "Toscana" },
  { cidade: "Genova",          regiao: "Liguria" },
  { cidade: "L'Aquila",        regiao: "Abruzzo" },
  { cidade: "Lecce",           regiao: "Puglia" },
  { cidade: "Messina",         regiao: "Sicilia" },
  { cidade: "Milano",          regiao: "Lombardia" },
  { cidade: "Napoli",          regiao: "Campania" },
  { cidade: "Palermo",         regiao: "Sicilia" },
  { cidade: "Perugia",         regiao: "Umbria" },
  { cidade: "Potenza",         regiao: "Basilicata" },
  { cidade: "Reggio Calabria", regiao: "Calabria" },
  { cidade: "Roma",            regiao: "Lazio" },
  { cidade: "Salerno",         regiao: "Campania" },
  { cidade: "Torino",          regiao: "Piemonte" },
  { cidade: "Trento",          regiao: "Trentino-Alto Adige" },
  { cidade: "Trieste",         regiao: "Friuli-Venezia Giulia" },
  { cidade: "Venezia",         regiao: "Veneto" },
]

const PAIS = "Itália"
const nomeOficial = (cidade: string) => `Tribunale Ordinario di ${cidade}`

async function main() {
  const aplicar = process.argv.includes("--aplicar")
  let criados = 0, existentes = 0
  for (const t of TRIBUNAIS) {
    const name = nomeOficial(t.cidade)
    const ja = await prisma.orgaoProtocolo.findUnique({ where: { name_country: { name, country: PAIS } }, select: { id: true, publicCode: true } })
    if (ja) { existentes++; continue }
    if (!aplicar) { console.log(`  + ${name} · ${t.cidade} · ${t.regiao}`); criados++; continue }
    const criado = await prisma.orgaoProtocolo.create({
      data: {
        name,
        type: "tribunal",
        country: PAIS,
        state: t.regiao,
        city: t.cidade,
        idioma: "it",
        // Mesmas funções dos tribunais que já estavam no cadastro: o tribunal
        // recebe protocolo (ORGAO) e cobra custas (FORNECEDOR).
        funcoes: ["ORGAO", "FORNECEDOR"],
        ativo: true,
      },
      select: { id: true, publicCode: true, name: true },
    })
    console.log(`  ✅ ${criado.publicCode} — ${criado.name}`)
    criados++
  }
  console.log(`\n${aplicar ? "CRIADOS" : "A CRIAR"}: ${criados} · já existentes: ${existentes} · total esperado: ${TRIBUNAIS.length}`)
  if (!aplicar) console.log("\n(dry-run — rode com --aplicar para gravar)")
  process.exit(0)
}
main()
