-- Preço "base + adicional por unidade" (ex.: honorários por requerente). Aditivo, nullable.
ALTER TABLE "TabelaValor" ADD COLUMN "valorBase" DECIMAL(12,2);
ALTER TABLE "TabelaValor" ADD COLUMN "valorAdicional" DECIMAL(12,2);
-- modoCalculo passa de VarChar(20) para VarChar(40) p/ comportar 'honorario_por_requerente'.
ALTER TABLE "TabelaValor" ALTER COLUMN "modoCalculo" TYPE VARCHAR(40);
