import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/components/layout/AppShell";
import RotaProtegida from "@/components/layout/RotaProtegida";
import Dashboard from "@/pages/Dashboard";
import Imoveis from "@/pages/Imoveis";
import Proprietarios from "@/pages/Proprietarios";
import ProprietarioDetalhe from "@/pages/ProprietarioDetalhe";
import Negocios from "@/pages/Negocios";
import NegocioDetalhe from "@/pages/NegocioDetalhe";
import Leads from "@/pages/Leads";
import CrmConfig from "@/pages/CrmConfig";
import Perfil from "@/pages/Perfil";
import Assinar from "@/pages/Assinar";
import Vitrine from "@/pages/Vitrine";
import RelatorioProprietario from "@/pages/RelatorioProprietario";
import Relatorios from "@/pages/Relatorios";
import Chat from "@/pages/Chat";
import Financeiro from "@/pages/Financeiro";
import Agenda from "@/pages/Agenda";
import Contratos from "@/pages/Contratos";
import Empresas from "@/pages/Empresas";
import Configuracoes from "@/pages/Configuracoes";
import Usuarios from "@/pages/Usuarios";
import AtivarAcesso from "@/pages/AtivarAcesso";
import Login from "@/pages/Login";
import { Toaster } from "@/components/ui/sonner";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <>
      <Routes>
        <Route path="/ativar-acesso" element={<AtivarAcesso />} />
        <Route path="/login" element={<Login />} />
        {/* Página pública de assinatura (link enviado ao cliente; sem login) */}
        <Route path="/assinar/:token" element={<Assinar />} />
        <Route path="/vitrine/:token" element={<Vitrine />} />
        <Route path="/proprietario/:token" element={<RelatorioProprietario />} />

        <Route element={<RotaProtegida />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/imoveis" element={<Imoveis />} />
            <Route path="/proprietarios" element={<Proprietarios />} />
            <Route path="/proprietarios/:id" element={<ProprietarioDetalhe />} />
            <Route path="/crm" element={<Negocios />} />
            <Route path="/negocios/:id" element={<NegocioDetalhe />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/perfil" element={<Perfil />} />
            <Route path="/relatorios" element={<Relatorios />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/financeiro" element={<Financeiro />} />
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/contratos" element={<Contratos />} />
            {/* Somente admin: a rota também é barrada no servidor (403) */}
            <Route element={<RotaProtegida somenteAdmin />}>
              <Route path="/usuarios" element={<Usuarios />} />
              <Route path="/crm/configurar" element={<CrmConfig />} />
            </Route>
            {/* Configurador: exclusivo do Administrador de Sistema (servidor nega com 403) */}
            <Route element={<RotaProtegida somenteSysadmin />}>
              <Route path="/configuracoes" element={<Configuracoes />} />
              <Route path="/empresas" element={<Empresas />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}
