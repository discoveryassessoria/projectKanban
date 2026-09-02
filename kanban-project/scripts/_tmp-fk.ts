import { prisma } from "@/lib/prisma"
async function r<T>(f:()=>Promise<T>,n=20):Promise<T>{for(let i=0;i<n;i++){try{return await f()}catch(e:any){if(i===n-1)throw e;await new Promise(x=>setTimeout(x,1500*(i+1)))}}throw new Error("x")}
async function main(){
  const fks = await r(()=>prisma.$queryRawUnsafe<any[]>(`
    SELECT tc.table_name AS filho, kcu.column_name AS coluna, rc.delete_rule AS ao_apagar_o_pai
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='Familia'`))
  for(const f of fks) console.log(`  ${f.filho}.${f.coluna}  →  apagar a Família faz: ${f.ao_apagar_o_pai}`)
  console.log("\n  (o inverso — apagar o PROCESSO — não toca na Família: ela é o PAI da relação)")
}
main().finally(()=>prisma.$disconnect())
