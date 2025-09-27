'use client';

import { useState, useEffect } from 'react';
import { DndContext, closestCorners, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove } from "@dnd-kit/sortable";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus } from 'lucide-react';
import { KanbanColumn } from './kanban/kanban-column';

// Interfaces
interface Status {
  id: number;
  nome: string;
}

interface Atividade {
  id: number;
  nome: string;
  descricao: string | null;
  statusId: number;
  // Campos adicionados para o novo card
  data?: string;
  responsavel?: string;
  tags?: { texto: string; cor: string }[];
}

interface Projeto {
  id: number;
  nome: string;
  descricao: string | null;
  status: Status[];
  atividades: Atividade[];
}

interface KanbanBoardProps {
  projeto: Projeto;
  onStatusAdd: () => void;
}

export function KanbanBoard({ projeto, onStatusAdd }: KanbanBoardProps) {
  const [atividades, setAtividades] = useState<Atividade[]>([]);
  const [newStatusName, setNewStatusName] = useState('');
  const [isAddingStatus, setIsAddingStatus] = useState(false);

  useEffect(() => {
    setAtividades(projeto.atividades);
  }, [projeto.atividades]);

  const handleAddNewStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStatusName.trim()) return;

    try {
      const response = await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: newStatusName, projetoId: projeto.id }),
      });

      if (!response.ok) throw new Error('Falha ao criar novo status');

      setNewStatusName('');
      setIsAddingStatus(false);
      onStatusAdd();
    } catch (error) {
      console.error(error);
      alert('Não foi possível adicionar a coluna.');
    }
  };

  const handleAddNewAtividade = async (nome: string, statusId: number) => {
    try {
      const response = await fetch('/api/atividades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, statusId, projetoId: projeto.id }),
      });

      if (!response.ok) throw new Error('Falha ao criar nova atividade');

      const { atividade } = await response.json();
      setAtividades(prev => [...prev, atividade]);
    } catch (error) {
      console.error(error);
      alert('Não foi possível adicionar a atividade.');
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    const activeContainer = active.data.current?.sortable.containerId;
    const overContainer = over.data.current?.sortable.containerId || over.id;

    if (activeContainer !== overContainer) {
      const numericOverContainer = parseInt(String(overContainer), 10);

      if (isNaN(numericOverContainer)) {
        console.error("Invalid drop container id:", overContainer);
        return;
      }

      setAtividades((prev) => {
        const activeIndex = prev.findIndex((a) => a.id === activeId);
        if (activeIndex === -1) {
          return prev;
        }
        return prev.map((item, index) => {
          if (index === activeIndex) {
            return { ...item, statusId: numericOverContainer };
          }
          return item;
        });
      });

      fetch(`/api/atividades/${activeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statusId: numericOverContainer }),
      }).catch(console.error);
    }
  };

  return (
    <DndContext onDragEnd={onDragEnd} collisionDetection={closestCorners}>
      <div className="overflow-x-auto rounded-lg bg-gray-200">
        <div 
          className="grid h-full gap-px"
          style={{ gridTemplateColumns: `repeat(${projeto.status.length + 1}, minmax(320px, 1fr))` }}
        >
          {projeto.status.sort((a, b) => a.id - b.id).map((status, index) => (
            <KanbanColumn
              key={status.id}
              id={status.id}
              title={status.nome}
              atividades={atividades.filter((a) => a.statusId === status.id)}
              headerColor="#f1f5f9" // Example color, you can make this dynamic
              isFirst={index === 0}
              isLast={index === projeto.status.length - 1}
              onAtividadeAdd={handleAddNewAtividade}
            />
          ))}

          {/* Add new status column */}
          <div className="w-80 flex-shrink-0 p-2">
            {isAddingStatus ? (
              <div className="p-4 rounded-lg bg-gray-100">
                <form onSubmit={handleAddNewStatus}>
                  <Input
                    autoFocus
                    placeholder="Nome da nova coluna"
                    value={newStatusName}
                    onChange={(e) => setNewStatusName(e.target.value)}
                    className="mb-2"
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setIsAddingStatus(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" size="sm">Adicionar</Button>
                  </div>
                </form>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="w-full h-12 border-2 border-dashed"
                onClick={() => setIsAddingStatus(true)}
              >
                <Plus className="mr-2 h-4 w-4" /> Adicionar outra coluna
              </Button>
            )}
          </div>
        </div>
      </div>
    </DndContext>
  );
}