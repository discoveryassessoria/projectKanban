// scripts/usuario-publico-sem-segredo-estatico.test.ts
//
// Guarda ESTÁTICA do incidente 30/09/2026 (hash de senha e permissoesCustom em `tarefas[].responsavel`).
// Um `responsavel: true` num include/select traz TODAS as colunas escalares de Usuario. Regras (sobre
// src/** e lib/**, sem componentes nem testes):
//   R1. nenhuma relação que aponta para Usuario (nomes lidos de prisma/schema.prisma) recebe `: true`;
//   R2. nenhuma relação para Usuario recebe `{ include: ... }` (só `{ select: ... }`);
//   R3. `senha: true` e `senhaHash: true` nunca aparecem num select;
//   R4. toda chamada prisma.usuario.find*/create/update/upsert sob src/app/api tem `select`
//       (salvo allowlist nominal);
//   R5. `permissoesCustom: true` só nos arquivos da allowlist nominal (uso interno p/ calcular permissão, ou o
//       editor de permissões do admin) — a serialização é provada pelo teste dinâmico.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, sep } from "node:path"

let ok = 0, falhou = 0
const check = (n: string, c: boolean, extra?: string) => {
  if (c) { ok++; console.log(`  ✅ ${n}`) } else { falhou++; console.error(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) }
}

// ALLOWLIST NOMINAL (arquivo → justificativa). Nada entra sem motivo.
const USUARIO_SEM_SELECT: Record<string, string> = {
  "src/app/api/auth/login/route.ts": "precisa do hash para comparar a senha; a resposta é projetada campo a campo (id, publicCode, nome, email, tipo, perfilId)",
  "src/app/api/user/update-password/route.ts": "precisa do hash para validar a senha atual; nada é devolvido além da mensagem",
}
// Falso positivo de NOME: coluna ESCALAR (Int) que tem o mesmo nome de uma relação para Usuario em outro model.
const R1_ESCALAR_HOMONIMO: Record<string, string> = {
  "lib/operacional/regras-torre.ts": "ConfiguracaoSistema.atualizadoPor é Int (id), não a relação CapacidadeOperacional.atualizadoPor",
}
const PERMISSOES_CUSTOM: Record<string, string> = {
  "src/app/api/usuarios/[id]/permissoes/route.ts": "editor de permissões do admin (usuarios.gerenciar): o GET entrega as do usuário editado de propósito",
  "src/app/api/operacao/capacidade/route.ts": "lê para calcularPermissoes; a resposta só leva podeExecutar",
  "src/app/api/operacao/atribuiveis/route.ts": "lê para calcularPermissoes; a resposta só leva id/nome/email/carga",
  "src/lib/verificar-permissao.ts": "núcleo de autorização — devolve o mapa calculado, não o JSON cru",
  "src/services/regularizacao-historica.ts": "checa permissão do ator; não serializa",
  "lib/operacional/torre-equipe.ts": "calcula aptidão; não serializa a coluna",
  "lib/operacional/obrigacao-atribuicao.ts": "calcula elegibilidade; não serializa",
  "lib/operacional/precisa-de-voce.ts": "calcula elegibilidade; não serializa",
  "lib/operacional/elegibilidade.ts": "calcula elegibilidade; não serializa",
}

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === ".next") continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) arquivos(p, acc)
    else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) acc.push(p.split(sep).join("/"))
  }
  return acc
}
const fontes = [...arquivos("src"), ...arquivos("lib")].filter((f) => !f.startsWith("src/components/") && !f.startsWith("src/app/") || f.startsWith("src/app/api/") )

// Relações que apontam para Usuario, lidas do schema.
const schema = readFileSync("prisma/schema.prisma", "utf8")
const rels = new Set<string>()
for (const l of schema.split("\n")) {
  const m = /^\s+(\w+)\s+Usuario\??(\s|$)/.exec(l)
  if (m) rels.add(m[1])
}
check("o schema expõe relações para Usuario (leitura não vazia)", rels.size >= 15, `n=${rels.size}`)
check("inclui 'responsavel' (a do incidente)", rels.has("responsavel"))
const alt = [...rels].join("|")
const reTrue = new RegExp(`\\b(${alt})\\s*:\\s*true\\b`)
const reInclude = new RegExp(`\\b(${alt})\\s*:\\s*\\{\\s*include\\b`)

const viol: Record<string, string[]> = { R1: [], R2: [], R3: [], R4: [], R5: [] }
for (const f of fontes) {
  const s = readFileSync(f, "utf8")
  const linhas = s.split("\n")
  linhas.forEach((l, i) => {
    const t = l.trim()
    if (t.startsWith("//") || t.startsWith("*")) return
    if (reTrue.test(l) && !(f in R1_ESCALAR_HOMONIMO && /atualizadoPor/.test(l))) viol.R1.push(`${f}:${i + 1}`)
    if (reInclude.test(l)) viol.R2.push(`${f}:${i + 1}`)
    if (/\b(senha|senhaHash)\s*:\s*true\b/.test(l)) viol.R3.push(`${f}:${i + 1}`)
    if (/\bpermissoesCustom\s*:\s*true\b/.test(l) && !(f in PERMISSOES_CUSTOM)) viol.R5.push(`${f}:${i + 1}`)
  })
  // R4 — só rotas.
  if (f.startsWith("src/app/api/") && !(f in USUARIO_SEM_SELECT)) {
    const re = /\b(?:prisma|tx|db)\.usuario\.(findMany|findUnique|findFirst|findUniqueOrThrow|findFirstOrThrow|create|update|upsert)\s*\(/g
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) {
      let prof = 1, i = m.index + m[0].length
      while (i < s.length && prof > 0) { if (s[i] === "(") prof++; else if (s[i] === ")") prof--; i++ }
      if (!/\bselect\s*:/.test(s.slice(m.index, i))) viol.R4.push(`${f}:${s.slice(0, m.index).split("\n").length}`)
    }
  }
}
check("R1 nenhuma relação para Usuario com ': true'", viol.R1.length === 0, viol.R1.join(", "))
check("R2 nenhuma relação para Usuario com 'include'", viol.R2.length === 0, viol.R2.join(", "))
check("R3 'senha: true' nunca em select", viol.R3.length === 0, viol.R3.join(", "))
check("R4 consultas de Usuario nas rotas sempre com select (exceto allowlist)", viol.R4.length === 0, viol.R4.join(", "))
check("R5 'permissoesCustom: true' só nos arquivos da allowlist", viol.R5.length === 0, viol.R5.join(", "))
for (const f of [...Object.keys(USUARIO_SEM_SELECT), ...Object.keys(PERMISSOES_CUSTOM)]) {
  check(`allowlist aponta para arquivo existente: ${f}`, (() => { try { statSync(f); return true } catch { return false } })())
}

// Self-test da regra: o padrão do incidente TEM que ser detectado.
check("self-test: 'responsavel: true' é detectado", reTrue.test("            responsavel: true"))
check("self-test: 'responsavel: { select: ... }' não é", !reTrue.test("responsavel: { select: USUARIO_PUBLICO_SELECT }"))

// Helper canônico presente e com o select mínimo.
const h = readFileSync("src/lib/seguranca/usuario-publico.ts", "utf8")
check("helper: USUARIO_PUBLICO_SELECT = id, nome, publicCode", /USUARIO_PUBLICO_SELECT = \{\s*id: true,\s*nome: true,\s*publicCode: true,?\s*\}/.test(h))
for (const rota of ["src/app/api/processos/route.ts", "src/app/api/processos/[processoId]/route.ts"]) {
  const s = readFileSync(rota, "utf8")
  check(`${rota}: responsável com USUARIO_PUBLICO_SELECT e rede removerSegredosDeUsuario`, s.includes("USUARIO_PUBLICO_SELECT") && s.includes("removerSegredosDeUsuario("))
}

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
