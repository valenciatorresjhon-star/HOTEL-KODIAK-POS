import React, { useState } from 'react';
import { Users, Search, Plus, MapPin, Phone, Mail, Car, HelpCircle, X, ShieldCheck } from 'lucide-react';
import { Client, VehicleType } from '../types';
import { formatSafeDate, isInvalidValue } from '../utils/storage';

interface ClientesProps {
  clients: Client[];
  onUpdateClients: (updated: Client[]) => void;
}

export const ClientesView: React.FC<ClientesProps> = ({
  clients = [],
  onUpdateClients
}) => {
  const safeClients = Array.isArray(clients) ? clients : [];
  const [searchTerm, setSearchTerm] = useState<string>('');
  
  // Create client Modal state
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [nombre, setNombre] = useState<string>('');
  const [cedula, setCedula] = useState<string>('');
  const [celular, setCelular] = useState<string>('');
  const [correo, setCorreo] = useState<string>('');
  const [direccion, setDireccion] = useState<string>('');

  const [esEmpresa, setEsEmpresa] = useState<boolean>(false);
  const [empresa, setEmpresa] = useState<string>('');
  const [nit, setNit] = useState<string>('');

  const [tipoVehiculo, setTipoVehiculo] = useState<VehicleType>('Moto');
  const [placa, setPlaca] = useState<string>('');
  const [marca, setMarca] = useState<string>('');
  const [color, setColor] = useState<string>('');
  const [observacionVehiculo, setObservacionVehiculo] = useState<string>('');

  const [errorMsg, setErrorMsg] = useState<string>('');

  // Search logic
  const filtered = safeClients.filter((c) => {
    const term = searchTerm.toLowerCase();
    const acompanantesMatch = (c.acompanantes || []).some((a) =>
      String(a.nombre || '').toLowerCase().includes(term) ||
      String(a.cedula || '').includes(term) ||
      String(a.celular || '').includes(term)
    );

    return (
      String(c.nombre || '').toLowerCase().includes(term) ||
      String(c.cedula || '').includes(term) ||
      String(c.celular || '').includes(term) ||
      String(c.placa || '').toLowerCase().includes(term) ||
      String(c.acompananteDe || '').toLowerCase().includes(term) ||
      acompanantesMatch
    );
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    // Verification check exactly as requested
    if (isInvalidValue(nombre)) {
      setErrorMsg('Nombre completo es de registro obligatorio.');
      return;
    }
    if (isInvalidValue(cedula)) {
      setErrorMsg('Cédula de ciudadanía o NIT es obligatorio.');
      return;
    }
    if (isInvalidValue(celular)) {
      setErrorMsg('Nro. de Celular es obligatorio.');
      return;
    }

    // Check for duplicated client
    const duplicated = safeClients.some((c) => c.cedula === cedula);
    if (duplicated) {
      setErrorMsg('Ya existe un cliente registrado con esta cédula de ciudadanía.');
      return;
    }

    const now = new Date();
    const newClient: Client = {
      id: `client-${now.getTime()}`,
      nombre: nombre.trim().toUpperCase(),
      cedula: cedula.trim(),
      celular: celular.trim(),
      correo: correo.trim() || 'sin_correo@hotelkodiak.com',
      direccion: direccion.trim() || 'Medellín, Antioquia',
      esEmpresa,
      empresa: esEmpresa ? empresa.trim().toUpperCase() : undefined,
      nit: esEmpresa ? nit.trim() : undefined,
      tipoVehiculo,
      placa: placa.trim().toUpperCase() || 'S/P',
      marca: marca.trim().toUpperCase() || 'S/M',
      color: color.trim().toUpperCase() || 'S/C',
      observacionVehiculo: observacionVehiculo.trim() || 'Ninguna novedad registrada.',
      visitas: 1,
      tipoCliente: 'principal',
      numeroPersonas: 1,
      acompanantes: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    onUpdateClients([...safeClients, newClient]);
    setShowCreateModal(false);

    // Reset states
    setNombre('');
    setCedula('');
    setCelular('');
    setCorreo('');
    setDireccion('');
    setEsEmpresa(false);
    setEmpresa('');
    setNit('');
    setPlaca('');
    setMarca('');
    setColor('');
    setObservacionVehiculo('');
  };

  return (
    <div className="space-y-6">
      
      {/* Top action header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-900 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-emerald-400" />
            <span>Fichero de Clientes (Huéspedes)</span>
          </h2>
          <p className="text-xs text-slate-400">Administre el registro obligatorio de visitantes, controle sus visitas acumuladas y placas de vehículos.</p>
        </div>

        <button
          onClick={() => {
            setErrorMsg('');
            setShowCreateModal(true);
          }}
          className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-[0.98] transition-all"
        >
          <Plus className="h-4 w-4" />
          <span>Registrar Cliente</span>
        </button>
      </div>

      {/* Search Input bar */}
      <div className="relative max-w-md">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Buscar por nombre, cédula, celular, o placa de vehículo..."
          className="w-full bg-slate-900 border border-slate-800 text-xs text-white pl-10 pr-4 py-2.5 rounded-xl focus:outline-none focus:border-emerald-500"
        />
        <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
      </div>

      {/* Grid of clients cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.length === 0 ? (
          <p className="text-xs text-slate-500 italic py-8 col-span-2">No se encontraron huéspedes con esos criterios de búsqueda.</p>
        ) : (
          filtered.map((c) => (
            <div key={c.id} className="p-5 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col justify-between space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-sm font-bold text-slate-100 uppercase tracking-tight">{c.nombre}</h3>
                  <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">C.C. {c.cedula}</span>
                  {c.tipoCliente === 'acompanante' && (
                    <span className="text-[9px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5 inline-block mt-1">
                      Acompañante de {c.acompananteDe || 'cliente principal'}
                    </span>
                  )}
                </div>

                <div className="bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg text-emerald-400 text-center shrink-0">
                  <span className="text-[9px] uppercase font-bold block text-slate-500 leading-none">Visitas</span>
                  <strong className="text-sm font-black">{c.visitas || 1}</strong>
                </div>
              </div>

              {/* Data layout */}
              <div className="grid grid-cols-2 gap-3 text-xs border-t border-slate-800/60 pt-3">
                <div className="flex items-center gap-1.5 text-slate-300">
                  <Phone className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>{c.celular}</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-300 truncate">
                  <Mail className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">{c.correo}</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-300 col-span-2">
                  <MapPin className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>{c.direccion}</span>
                </div>
              </div>

              {c.acompanantes && c.acompanantes.length > 0 && (
                <div className="p-3 bg-slate-950 border border-slate-900 rounded-xl text-[11px] space-y-1">
                  <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wide block">
                    Acompañantes última visita
                  </span>
                  {c.acompanantes.map((a, idx) => (
                    <div key={a.id || idx} className="flex justify-between gap-2 text-slate-300">
                      <span className="truncate">{a.nombre}</span>
                      <span className="font-mono text-slate-500 shrink-0">C.C. {a.cedula}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Vehicle profile layout */}
              <div className="p-3 bg-slate-950 border border-slate-900 rounded-xl flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2">
                  <Car className="h-4 w-4 text-emerald-400" />
                  <div>
                    <span className="text-slate-400 font-bold block">{c.tipoVehiculo} • {c.marca}</span>
                    <span className="text-[10px] text-slate-500">Color: {c.color}</span>
                  </div>
                </div>
                <span className="font-mono font-black text-xs uppercase px-2 py-0.5 bg-slate-900 border border-slate-800 rounded text-amber-400">
                  {c.placa}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal: Create Client */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <form onSubmit={handleCreate} className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">REGISTRAR HUÉSPED NUEVO</h3>
                <p className="text-[10px] text-slate-400">Complete el perfil e ingrese los datos requeridos.</p>
              </div>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-semibold block">Nombre Completo *</label>
                <input
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej. MARIO GOMEZ"
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-300 font-semibold block">Cédula de Ciudadanía *</label>
                  <input
                    type="text"
                    value={cedula}
                    onChange={(e) => setCedula(e.target.value)}
                    placeholder="Ej. 10982345"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-300 font-semibold block">Celular de Contacto *</label>
                  <input
                    type="text"
                    value={celular}
                    onChange={(e) => setCelular(e.target.value)}
                    placeholder="Ej. 3001234567"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-300 font-semibold block">Correo Electrónico</label>
                  <input
                    type="email"
                    value={correo}
                    onChange={(e) => setCorreo(e.target.value)}
                    placeholder="Ej. correo@mail.com"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-300 font-semibold block">Dirección de Residencia</label>
                  <input
                    type="text"
                    value={direccion}
                    onChange={(e) => setDireccion(e.target.value)}
                    placeholder="Dirección, Ciudad"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              {/* Corporate profile toggles */}
              <div className="space-y-3 bg-slate-950/40 p-4 rounded-xl border border-slate-900">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">¿Es un Cliente Corporativo / Empresa?</span>
                  <button
                    type="button"
                    onClick={() => setEsEmpresa(!esEmpresa)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      esEmpresa ? 'bg-emerald-600' : 'bg-slate-800'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        esEmpresa ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {esEmpresa && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400">Razón Social</label>
                      <input
                        type="text"
                        value={empresa}
                        onChange={(e) => setEmpresa(e.target.value)}
                        placeholder="Ej. Industrias S.A.S."
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400">NIT Corporativo</label>
                      <input
                        type="text"
                        value={nit}
                        onChange={(e) => setNit(e.target.value)}
                        placeholder="Ej. 901234567-9"
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Vehicle profile */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-slate-400 block border-b border-slate-800 pb-1">Datos del Vehículo</span>
                
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <label className="text-slate-400">Tipo de Vehículo</label>
                    <select
                      value={tipoVehiculo}
                      onChange={(e) => setTipoVehiculo(e.target.value as VehicleType)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                    >
                      <option value="Moto">Moto</option>
                      <option value="Carro">Carro</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">Placa</label>
                    <input
                      type="text"
                      value={placa}
                      onChange={(e) => setPlaca(e.target.value)}
                      placeholder="Ej. ABC12D"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white font-mono uppercase"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">Marca</label>
                    <input
                      type="text"
                      value={marca}
                      onChange={(e) => setMarca(e.target.value)}
                      placeholder="Ej. Honda"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">Color</label>
                    <input
                      type="text"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      placeholder="Ej. Azul"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-slate-400">Novedad / Observación Vehículo</label>
                    <input
                      type="text"
                      value={observacionVehiculo}
                      onChange={(e) => setObservacionVehiculo(e.target.value)}
                      placeholder="Ej. Rasguños leves, maletero trasero..."
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                </div>
              </div>

              {errorMsg && (
                <div className="text-xs bg-red-500/10 border border-red-500/20 text-red-200 p-2.5 rounded-xl">
                  ⚠️ {errorMsg}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition-all shadow-md"
              >
                REGISTRAR HUÉSPED
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
};