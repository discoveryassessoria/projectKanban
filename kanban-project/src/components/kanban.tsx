'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus } from 'lucide-react';

// Define interfaces based on schema and page.tsx
interface Status {
  id: number;
  nome: string;
}

interface Atividade {
  id: number;
  nome: string;
  descricao: string | null;
  statusId: number;
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
  onStatusAdd: () => void; // Function to trigger refetch
}

export function KanbanBoard({ projeto, onStatusAdd }: KanbanBoardProps) {
  const [newStatusName, setNewStatusName] = useState('');
  const [isAddingStatus, setIsAddingStatus] = useState(false);

  const handleAddNewStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStatusName.trim()) return;

    try {
      const response = await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: newStatusName,
          projetoId: projeto.id,
        }),
      });

      if (!response.ok) {
        throw new Error('Falha ao criar novo status');
      }

      setNewStatusName('');
      setIsAddingStatus(false);
      onStatusAdd(); // Notify parent to refetch data
    } catch (error) {
      console.error(error);
      alert('Não foi possível adicionar a coluna.');
    }
  };

  return (
    <div className="flex gap-6 h-full overflow-x-auto p-1">
      {/* Columns for each status */}
      {projeto.status.sort((a, b) => a.id - b.id).map((status) => (
        <div key={status.id} className="w-80 flex-shrink-0">
          <Card className="h-full flex flex-col bg-gray-50">
            <CardHeader>
              <CardTitle className="text-lg">{status.nome}</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              <div className="flex flex-col gap-4">
                {projeto.atividades
                  .filter((atividade) => atividade.statusId === status.id)
                  .map((atividade) => (
                    <Card key={atividade.id} className="bg-white">
                      <CardContent className="p-4">
                        <p>{atividade.nome}</p>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ))}

      {/* Add new status column */}
      <div className="w-80 flex-shrink-0">
        {isAddingStatus ? (
          <Card className="bg-gray-100">
            <CardContent className="p-4">
              <form onSubmit={handleAddNewStatus}>
                <Input
                  autoFocus
                  placeholder="Nome da nova coluna"
                  value={newStatusName}
                  onChange={(e) => setNewStatusName(e.target.value)}
                  className="mb-2"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAddingStatus(false)}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" size="sm">
                    Adicionar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
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
  );
}
