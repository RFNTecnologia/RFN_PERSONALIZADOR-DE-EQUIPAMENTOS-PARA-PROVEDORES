import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ProvedorEstado } from '@/lib/store'
import { AppShell } from '@/components/layout/app-shell'
import { Painel } from '@/pages/painel'
import { Equipamentos } from '@/pages/equipamentos'
import { EquipamentoDetalhe } from '@/pages/equipamento-detalhe'
import { Personalizacao } from '@/pages/personalizacao'
import { Perfis } from '@/pages/perfis'
import { Restauracao } from '@/pages/restauracao'
import { Simulador } from '@/pages/simulador'
import { Auditoria } from '@/pages/auditoria'
import { Conexao } from '@/pages/conexao'
import { Varredura } from '@/pages/varredura'

export default function App() {
  return (
    <ProvedorEstado>
      <BrowserRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<Painel />} />
            <Route path="/equipamentos" element={<Equipamentos />} />
            <Route path="/equipamentos/:id" element={<EquipamentoDetalhe />} />
            <Route path="/personalizacao" element={<Personalizacao />} />
            <Route path="/perfis" element={<Perfis />} />
            <Route path="/restauracao" element={<Restauracao />} />
            <Route path="/simulador" element={<Simulador />} />
            <Route path="/auditoria" element={<Auditoria />} />
            <Route path="/conexao" element={<Conexao />} />
            <Route path="/varredura" element={<Varredura />} />
            <Route path="*" element={<Painel />} />
          </Routes>
        </AppShell>
        <Toaster position="top-right" richColors />
      </BrowserRouter>
    </ProvedorEstado>
  )
}
