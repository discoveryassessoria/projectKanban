const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const [{ size }] = await prisma.$queryRaw`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size
  `;
  console.log('\n📦 Tamanho total do banco:', size);

  const tables = await prisma.$queryRaw`
    SELECT 
      tablename AS tabela,
      pg_size_pretty(pg_total_relation_size('"' || tablename || '"')) AS tamanho
    FROM pg_tables 
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size('"' || tablename || '"') DESC 
    LIMIT 10
  `;
  console.log('\n🔝 Top 10 maiores tabelas:');
  console.table(tables);
}

main().finally(() => prisma.$disconnect());