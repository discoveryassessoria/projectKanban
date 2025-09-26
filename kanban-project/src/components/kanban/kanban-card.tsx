
'use client';

import { Card, CardContent } from "@/components/ui/card";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Interface para as props do KanbanCard
interface KanbanCardProps {
  id: number;
  nome: string;
  data?: string; // Supondo que a data seja uma string formatada
  responsavel?: string; // Nome do responsável
  tags?: { texto: string; cor: string }[]; // Array de tags com texto e cor
}

export function KanbanCard({ id, nome, data = '', responsavel = '', tags = [] }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card className="mb-4 bg-white shadow-sm hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <h3 className="font-bold text-md mb-2">{nome}</h3>
          <p className="text-sm text-gray-500 mb-2">{data}</p>
          <p className="text-sm font-medium text-gray-700 mb-3">{responsavel}</p>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag, index) => (
              <span
                key={index}
                className={`px-2 py-1 text-xs font-semibold rounded-full`}
                style={{ backgroundColor: tag.cor, color: '#fff' }}
              >
                {tag.texto}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
