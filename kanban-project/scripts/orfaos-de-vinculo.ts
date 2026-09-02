// scripts/orfaos-de-vinculo.ts
//
// TODA COLUNA DE VÍNCULO SEM CHAVE ESTRANGEIRA, E O QUE ELA DEIXOU PARA TRÁS.
//
// Foi assim que 61 famílias, 174 eventos de workflow, 127 avanços de fase e 11
// obrigações econômicas ficaram apontando para registros deletados: a coluna
// existia, a constraint não, e o banco não tinha como cascatear.
//
// Este script varre TODAS as colunas `<algo>Id` sem FK, num SQL só — a leitura
// coluna a coluna estourava o tempo num banco remoto lento.
//
//   npx tsx scripts/orfaos-de-vinculo.ts

import { prisma } from "@/lib/prisma"

/** Coluna → tabela que ela deveria referenciar. */
const PAI: Record<string, string> = {
  processoId: "Processo", pessoaId: "Pessoa", arvoreId: "Arvore", familiaId: "Familia",
  orgaoId: "OrgaoProtocolo", requerenteId: "Requerente", contratanteId: "Contratante",
  usuarioId: "Usuario", responsavelId: "Usuario", itemCatalogoId: "ItemCatalogo",
  tipoProcessoId: "TipoProcessoNacionalidade", paisId: "CatalogoPais",
  modalidadeId: "ModalidadePais", documentoId: "Documento", tarefaId: "Tarefa",
  protocoloId: "Protocolo", solicitacaoId: "SolicitacaoDocumento",
  necessidadeId: "NecessidadeDocumental", fornecedorId: "Fornecedor", uniaoId: "Uniao",
}

async function r<T>(f: () => Promise<T>, n = 25): Promise<T> {
  for (let i = 0; i < n; i++) {
    try { return await f() } catch (e) {
      if (i === n - 1) throw e
      await new Promise((x) => setTimeout(x, Math.min(15000, 1500 * (i + 1))))
    }
  }
  throw new Error("sem conexão")
}

async function main() {
  const cols = await r(() => prisma.$queryRawUnsafe<{ t: string; col: string }[]>(`
    SELECT c.table_name t, c.column_name col FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.column_name = ANY($1)
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name
        WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name = c.table_name AND k.column_name = c.column_name)
    ORDER BY 1, 2`, Object.keys(PAI)))

  console.log(`COLUNAS DE VÍNCULO SEM FK: ${cols.length}\n`)
  if (!cols.length) { console.log("✅ Toda coluna de vínculo é protegida pelo banco."); return }

  // UM SQL só: uma subconsulta por coluna, unidas por UNION ALL. Ir uma a uma
  // custava uma ida ao banco por coluna, e o banco está a segundos por consulta.
  const partes = cols.map(({ t, col }) => {
    const pai = PAI[col]
    return `SELECT '${t}' tabela, '${col}' coluna, '${pai}' pai,
      (SELECT COUNT(*)::int FROM "${t}") total,
      (SELECT COUNT(*)::int FROM "${t}" x WHERE x."${col}" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "${pai}" p WHERE p.id = x."${col}")) orfaos`
  })
  const linhas = await r(() => prisma.$queryRawUnsafe<any[]>(partes.join("\nUNION ALL\n")))

  const comOrfao = linhas.filter((l) => Number(l.orfaos) > 0)
  for (const l of linhas.sort((a, b) => Number(b.orfaos) - Number(a.orfaos))) {
    const n = Number(l.orfaos)
    console.log(`  ${n > 0 ? "⚠" : "·"} ${`${l.tabela}.${l.coluna}`.padEnd(46)} → ${String(l.pai).padEnd(26)} ${String(n).padStart(5)} órfão(s) de ${l.total}`)
  }
  const total = comOrfao.reduce((s, l) => s + Number(l.orfaos), 0)
  console.log(`\n  ${cols.length} coluna(s) sem FK · ${comOrfao.length} com órfão · ${total} linha(s) órfã(s)`)
  if (total > 0) {
    console.log("\n  Estas precisam de limpeza + FK com cascata, como foi feito com processoId.")
    process.exit(1)
  }
  console.log("\n  ✅ Nenhuma linha órfã — mas as colunas acima seguem sem proteção do banco.")
}

main().finally(() => prisma.$disconnect())
