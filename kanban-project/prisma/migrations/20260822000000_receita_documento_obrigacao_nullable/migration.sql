-- Aditivo/reversível: ReceitaDocumento passa a ter obrigacaoId como fonte única
-- de vínculo (cobre RECEITA e CUSTO). receitaId vira legado/opcional — CUSTO
-- não tem Receita de origem (origemTipo='nativo'), então não pode satisfazer
-- NOT NULL. Nenhum dado existente é tocado; apenas relaxa a constraint.
ALTER TABLE "ReceitaDocumento" ALTER COLUMN "receitaId" DROP NOT NULL;
