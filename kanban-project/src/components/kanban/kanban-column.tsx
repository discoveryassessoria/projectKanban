'use client';

import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { KanbanCard } from './kanban-card';
import { Input } from "@/components/ui/input";

// Interfaces
interface Atividade {
  id: number;
  nome: string;
  // Adicionar outros campos conforme o novo design do card
  data?: string;
  responsavel?: string;
  tags?: { texto: string; cor: string }[];
}

interface KanbanColumnProps {
  id: number;
  title: string;
  atividades: Atividade[];
  headerColor?: string;
  isFirst?: boolean;
  isLast?: boolean;
  onAtividadeAdd: (nome: string, statusId: number) => void;
}

export function KanbanColumn({ id, title, atividades, headerColor = '#e2e8f0', isFirst, isLast, onAtividadeAdd }: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({ id });
  const [isAdding, setIsAdding] = useState(false);
  const [newAtividadeName, setNewAtividadeName] = useState('');

  const atividadesIds = useMemo(() => atividades.map((a) => a.id), [atividades]);

  const headerClasses = `p-4 flex items-center justify-between ${isFirst ? 'rounded-tl-lg' : ''} ${isLast ? 'rounded-tr-lg' : ''}`;
  const contentClasses = `flex-1 overflow-y-auto p-4 bg-gray-50 ${isFirst ? 'rounded-bl-lg' : ''} ${isLast ? 'rounded-br-lg' : ''}`;

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAtividadeName.trim()) return;
    onAtividadeAdd(newAtividadeName, id);
    setNewAtividadeName('');
    setIsAdding(false);
  };


  return (
    <div ref={setNodeRef} className="flex flex-col">
      <div 
        className={headerClasses}
        style={{ backgroundColor: headerColor }}
      >
        <h3 className="font-bold text-lg">{title} <span className="text-sm font-normal">({atividades.length})</span></h3>
        <Button variant="ghost" size="sm" onClick={() => setIsAdding(true)} className="hover:bg-gray-200">
          <Plus className="h-4 w-4 mr-1" /> Adicionar
        </Button>
      </div>
      <div className={contentClasses}>
        <SortableContext items={atividadesIds}>
          {atividades.map((atividade) => (
            <KanbanCard key={atividade.id} {...atividade} />
          ))}
        </SortableContext>

        {isAdding && (
          <form onSubmit={handleAddSubmit} className="mt-4">
            <Input
              autoFocus
              placeholder="Nome da atividade"
              value={newAtividadeName}
              onChange={(e) => setNewAtividadeName(e.target.value)}
              className="mb-2"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsAdding(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm">Adicionar</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
