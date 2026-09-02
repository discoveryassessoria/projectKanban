// scripts/backfill-permissao-relatorios.ts
//
// `relatorios.ver` nasceu agora. Sem backfill, quem já via relatório perderia o
// acesso no deploy — permissão nova começa false para todo mundo.
//
// A REGRA DA MIGRAÇÃO: quem hoje enxerga o menu de Relatórios enxerga pela
// permissão EMPRESTADA `processos.ver_paginas`. Então é exatamente esse conjunto
// que recebe a permissão nova. Ninguém ganha acesso que não tinha, ninguém
// perde o que tinha, e a partir daí o desligamento é individual — que é o ponto
// de ter permissão própria.
//
// Seco por padrão. Só escreve com `--aplicar`.

import { prisma } from "@/lib/prisma"

type Mapa = Record<string, boolean>

async function main() {
  const aplicar = process.argv.includes("--aplicar")

  const perfis = await prisma.perfil.findMany({ select: { id: true, nome: true, permissoes: true } })
  const usuarios = await prisma.usuario.findMany({
    select: { id: true, nome: true, tipo: true, permissoesCustom: true },
  })

  const perfisAlvo = perfis.filter((p) => (p.permissoes as Mapa | null)?.["processos.ver_paginas"] === true)
  const usuariosAlvo = usuarios.filter(
    (u) => (u.permissoesCustom as Mapa | null)?.["processos.ver_paginas"] === true,
  )

  console.log(`Perfis: ${perfis.length} · com a permissão emprestada: ${perfisAlvo.length}`)
  for (const p of perfisAlvo) {
    const ja = (p.permissoes as Mapa)["relatorios.ver"] === true
    console.log(`  ${ja ? "—" : "+"} perfil "${p.nome}"${ja ? " (já tinha)" : ""}`)
  }
  console.log(`\nUsuários: ${usuarios.length} · com concessão nominal: ${usuariosAlvo.length}`)
  for (const u of usuariosAlvo) {
    const ja = (u.permissoesCustom as Mapa)["relatorios.ver"] === true
    console.log(`  ${ja ? "—" : "+"} ${u.nome}${ja ? " (já tinha)" : ""}`)
  }
  const admins = usuarios.filter((u) => u.tipo === "admin").length
  console.log(`\n${admins} administrador(es) já recebem por serem admin — não precisam de backfill.`)

  if (!aplicar) {
    console.log("\nSECO. Rode de novo com --aplicar para gravar.")
    await prisma.$disconnect()
    return
  }

  let escritos = 0
  for (const p of perfisAlvo) {
    const mapa = { ...(p.permissoes as Mapa), "relatorios.ver": true }
    await prisma.perfil.update({ where: { id: p.id }, data: { permissoes: mapa } })
    escritos++
  }
  for (const u of usuariosAlvo) {
    const mapa = { ...(u.permissoesCustom as Mapa), "relatorios.ver": true }
    await prisma.usuario.update({ where: { id: u.id }, data: { permissoesCustom: mapa } })
    escritos++
  }

  const conferencia = await prisma.perfil.findMany({ select: { nome: true, permissoes: true } })
  const semAcesso = conferencia.filter(
    (p) => (p.permissoes as Mapa)?.["processos.ver_paginas"] === true
      && (p.permissoes as Mapa)?.["relatorios.ver"] !== true,
  )
  console.log(`\n${escritos} registro(s) atualizados.`)
  console.log(`Perfis que veriam relatório e ficaram sem a permissão nova: ${semAcesso.length} (tem de ser 0)`)
  await prisma.$disconnect()
  if (semAcesso.length) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
