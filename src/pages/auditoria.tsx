import { useMemo, useState } from 'react'
import { Download, Filter } from 'lucide-react'
import { useEstado } from '@/lib/store'
import { formatarData } from '@/lib/format'
import type { TipoEvento } from '@/lib/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const tipos: TipoEvento[] = [
  'provisionamento',
  'reset',
  'restauracao',
  'branding',
  'firmware',
  'alerta',
]

const variantes: Record<string, 'success' | 'secondary' | 'warning' | 'info' | 'danger'> = {
  sucesso: 'success',
  falha: 'danger',
  pendente: 'warning',
}

export function Auditoria() {
  const { logs, equipamentos } = useEstado()
  const [tipo, setTipo] = useState<string>('todos')
  const [busca, setBusca] = useState('')

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return logs.filter((l) => {
      if (tipo !== 'todos' && l.tipo !== tipo) return false
      if (termo && !`${l.mensagem} ${l.detalhe}`.toLowerCase().includes(termo)) return false
      return true
    })
  }, [logs, tipo, busca])

  function exportar() {
    const cabecalho = ['data', 'tipo', 'equipamento', 'mensagem', 'detalhe', 'resultado']
    const linhas = lista.map((l) => {
      const eq = equipamentos.find((e) => e.id === l.equipamentoId)
      return [
        l.em,
        l.tipo,
        eq?.serial ?? 'frota',
        l.mensagem,
        l.detalhe,
        l.resultado,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(';')
    })
    const conteudo = [cabecalho.join(';'), ...linhas].join('\n')
    const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'auditoria-provisionamento.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Auditoria</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Histórico de provisionamento, resets, restaurações e publicação de personalização.
          </p>
        </div>
        <Button variant="outline" onClick={exportar}>
          <Download aria-hidden="true" /> Exportar CSV
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="busca-log">Buscar</Label>
              <Input
                id="busca-log"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Mensagem ou detalhe do evento"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tipo-log">Tipo de evento</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger id="tipo-log">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os tipos</SelectItem>
                  {tipos.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="size-4" aria-hidden="true" />
            {lista.length} evento(s)
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Equipamento</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Resultado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((l) => {
                const eq = equipamentos.find((e) => e.id === l.equipamentoId)
                return (
                  <TableRow key={l.id}>
                    <TableCell className="text-muted-foreground">{formatarData(l.em)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{l.tipo}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{eq?.serial ?? '—'}</TableCell>
                    <TableCell className="max-w-md whitespace-normal">
                      <p className="font-medium">{l.mensagem}</p>
                      <p className="text-xs text-muted-foreground">{l.detalhe}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={variantes[l.resultado]}>{l.resultado}</Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
              {lista.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    Nenhum evento encontrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
