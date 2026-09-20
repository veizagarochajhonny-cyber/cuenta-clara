import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";

export default function App() {
  const urlParams = new URLSearchParams(window.location.search);
  const tokenUrl = urlParams.get("token");

  const [session, setSession] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [loading, setLoading] = useState(false);

  const [clientes, setClientes] = useState([]);
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [lugares, setLugares] = useState({});
  const [montosViaje, setMontosViaje] = useState({});
  const [historiales, setHistoriales] = useState({});
  const [historialVisible, setHistorialVisible] = useState({});

  const [clientePublico, setClientePublico] = useState(null);
  const [historialClientePublico, setHistorialClientePublico] = useState([]);
  const [errorPublico, setErrorPublico] = useState("");

  useEffect(() => {
    if (tokenUrl) {
      cargarDatosClientePublico(tokenUrl);
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session);
        if (session) fetchClientes(session.user.id);
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setSession(session);
        if (session) fetchClientes(session.user.id);
      });

      return () => subscription.unsubscribe();
    }
  }, [tokenUrl]);

  const cargarDatosClientePublico = async (token) => {
    setLoading(true);
    const { data: clienteData, error: errCliente } = await supabase
      .from("clientes")
      .select("*")
      .eq("token_acceso", token)
      .single();

    if (errCliente || !clienteData) {
      setErrorPublico("El enlace de acceso no es válido o ha expirado.");
      setLoading(false);
      return;
    }

    setClientePublico(clienteData);

    const { data: viajesData } = await supabase
      .from("viajes")
      .select("*")
      .eq("cliente_id", clienteData.id)
      .order("fecha", { ascending: false });

    setHistorialClientePublico(viajesData || []);
    setLoading(false);
  };

  const fetchClientes = async (userId) => {
    const { data, error } = await supabase
      .from("clientes")
      .select("*")
      .eq("chofer_id", userId)
      .order("created_at", { ascending: false });
    if (!error) setClientes(data || []);
  };

  const fetchHistorial = async (clienteId, forzarAbrir = false) => {
    const { data, error } = await supabase
      .from("viajes")
      .select("*")
      .eq("cliente_id", clienteId)
      .order("fecha", { ascending: false });
      
    if (!error) {
      setHistoriales((prev) => ({ ...prev, [clienteId]: data || [] }));
      if (forzarAbrir) {
        setHistorialVisible((prev) => ({ ...prev, [clienteId]: true }));
      } else {
        setHistorialVisible((prev) => ({ ...prev, [clienteId]: !prev[clienteId] }));
      }
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isRegistering) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
          alert("Error al registrar: " + error.message);
        } else if (data.user) {
          await supabase.from("choferes").insert([{ id: data.user.id, nombre }]);
          alert("Chofer registrado correctamente.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) alert("Error al ingresar: " + error.message);
      }
    } catch (err) {
      alert("Error de conexión: " + err.message);
    }
    setLoading(false);
  };

  const handleLogout = () => supabase.auth.signOut();

  const handleCrearCliente = async (e) => {
    e.preventDefault();
    if (!clienteNombre.trim() || !session) return;

    setLoading(true);
    const tokenAcceso = Math.random().toString(36).substring(2, 10);

    const { error } = await supabase.from("clientes").insert([
      { 
        nombre: clienteNombre, 
        telefono: clienteTelefono, 
        token_acceso: tokenAcceso,
        chofer_id: session.user.id,
        saldo: 0
      }
    ]);

    setLoading(false);
    if (!error) {
      setClienteNombre("");
      setClienteTelefono("");
      fetchClientes(session.user.id);
    } else {
      alert("Error al crear cliente: " + error.message);
    }
  };

  const handleAgregarViaje = async (cliente) => {
    const lugar = lugares[cliente.id] || "";
    const montoStr = montosViaje[cliente.id] || "";
    const valorMonto = parseFloat(montoStr);

    if (!lugar.trim() || isNaN(valorMonto) || valorMonto <= 0) {
      alert("Ingrese el destino y un monto válido.");
      return;
    }

    setLoading(true);

    const { error: errorViaje } = await supabase.from("viajes").insert([
      {
        cliente_id: cliente.id,
        chofer_id: session.user.id,
        lugar: lugar,
        monto: valorMonto,
        pagado: false
      }
    ]);

    if (errorViaje) {
      alert("Error al registrar carrera: " + errorViaje.message);
      setLoading(false);
      return;
    }

    const nuevoSaldo = (cliente.saldo || 0) + valorMonto;
    await supabase.from("clientes").update({ saldo: nuevoSaldo }).eq("id", cliente.id);

    setLoading(false);

    setLugares((prev) => ({ ...prev, [cliente.id]: "" }));
    setMontosViaje((prev) => ({ ...prev, [cliente.id]: "" }));

    fetchClientes(session.user.id);

    if (historialVisible[cliente.id]) {
      fetchHistorial(cliente.id, true);
    }

    enviarWhatsApp(cliente, valorMonto, lugar, nuevoSaldo);
  };

  const handlePagarViajeIndividual = async (cliente, viaje) => {
    if (viaje.monto <= 0 || viaje.pagado) return;

    const confirmacion = window.confirm(`¿Confirmar cobro de este viaje (${formatPesos(viaje.monto)})?`);
    if (!confirmacion) return;

    setLoading(true);

    await supabase.from("viajes").update({ pagado: true }).eq("id", viaje.id);

    await supabase.from("viajes").insert([
      {
        cliente_id: cliente.id,
        chofer_id: session.user.id,
        lugar: `PAGO CARRERA: ${viaje.lugar}`,
        monto: -viaje.monto,
        pagado: true
      }
    ]);

    const nuevoSaldo = Math.max(0, (cliente.saldo || 0) - viaje.monto);
    await supabase.from("clientes").update({ saldo: nuevoSaldo }).eq("id", cliente.id);

    setLoading(false);
    fetchClientes(session.user.id);
    fetchHistorial(cliente.id, true);
  };

  const handlePagarTodoSaldo = async (cliente) => {
    if (cliente.saldo <= 0) {
      alert("El cliente no tiene saldo pendiente.");
      return;
    }

    const confirmacion = window.confirm(`¿Confirmar cancelación total de la deuda (${formatPesos(cliente.saldo)})?`);
    if (!confirmacion) return;

    setLoading(true);

    await supabase.from("viajes").update({ pagado: true }).eq("cliente_id", cliente.id).eq("pagado", false);

    await supabase.from("viajes").insert([
      {
        cliente_id: cliente.id,
        chofer_id: session.user.id,
        lugar: "PAGO / CANCELACIÓN TOTAL DE DEUDA",
        monto: -cliente.saldo,
        pagado: true
      }
    ]);

    await supabase.from("clientes").update({ saldo: 0 }).eq("id", cliente.id);

    setLoading(false);
    fetchClientes(session.user.id);
    fetchHistorial(cliente.id, true);
  };

  // BORRAR ITEM INDIVIDUAL
  const handleBorrarViajeUnico = async (cliente, viajeId) => {
    if (!window.confirm("¿Deseas borrar este registro del historial?")) return;

    setLoading(true);
    const { error } = await supabase.from("viajes").delete().eq("id", viajeId);

    if (error) {
      alert("Error al borrar el registro: " + error.message);
    } else {
      fetchHistorial(cliente.id, true);
    }
    setLoading(false);
  };

  // VACIAR TODO EL HISTORIAL DE UN CLIENTE
  const handleVaciarHistorialCliente = async (cliente) => {
    if (!window.confirm(`¿Estás seguro de que deseas borrar TODO el historial de ${cliente.nombre}?`)) return;

    setLoading(true);
    const { error } = await supabase.from("viajes").delete().eq("cliente_id", cliente.id);

    if (error) {
      alert("Error al borrar historial: " + error.message);
    } else {
      await supabase.from("clientes").update({ saldo: 0 }).eq("id", cliente.id);
      fetchClientes(session.user.id);
      fetchHistorial(cliente.id, true);
    }
    setLoading(false);
  };

  // DAR DE BAJA AL CLIENTE
  const handleDarDeBajaCliente = async (cliente) => {
    if (!window.confirm(`⚠️ ¿Deseas dar de baja a ${cliente.nombre}? Se eliminará el cliente y todo su historial.`)) return;

    setLoading(true);
    const { error } = await supabase.from("clientes").delete().eq("id", cliente.id);

    if (error) {
      alert("Error al eliminar cliente: " + error.message);
    } else {
      fetchClientes(session.user.id);
    }
    setLoading(false);
  };

  const enviarWhatsApp = (cliente, monto, destino, nuevoSaldo) => {
    if (!cliente.telefono) {
      alert("El cliente no tiene un teléfono registrado para enviar WhatsApp.");
      return;
    }

    const formatoARS = (valor) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(valor);
    
    let originUrl = window.location.origin;
    if (!originUrl.startsWith("http://") && !originUrl.startsWith("https://")) {
      originUrl = "https://" + originUrl;
    }
    
    const urlEstadoCuenta = `${originUrl}/?token=${cliente.token_acceso}`;

    const mensaje = [
      "🚕 *Cuenta Clara - Remis*",
      "",
      `Hola *${cliente.nombre}*, se registró un nuevo viaje:`,
      "",
      `📍 *Destino:* ${destino}`,
      `💵 *Monto:* ${formatoARS(monto)}`,
      `📌 *Saldo Total:* ${formatoARS(nuevoSaldo)}`,
      "",
      "📲 *Ver detalle e historial de cuenta aquí:*",
      urlEstadoCuenta
    ].join("\n");

    const mensajeEncoded = encodeURIComponent(mensaje);
    const numLimpio = cliente.telefono.replace(/[^0-9]/g, "");
    
    window.open(`https://wa.me/${numLimpio}?text=${mensajeEncoded}`, "_blank");
  };

  const formatPesos = (monto) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(monto || 0);
  };

  if (tokenUrl) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "#0f172a", color: "white", padding: "1.5rem", fontFamily: "sans-serif" }}>
        <div style={{ maxWidth: "32rem", margin: "0 auto" }}>
          <header style={{ textAlign: "center", marginBottom: "1.5rem", borderBottom: "1px solid #334155", paddingBottom: "1rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#facc15" }}>🚕 Cuenta Clara</h1>
            <p style={{ color: "#94a3b8", fontSize: "0.875rem" }}>Estado de Cuenta y Lista de Carreras</p>
          </header>

          {loading ? (
            <p style={{ textAlign: "center", color: "#94a3b8" }}>Cargando información...</p>
          ) : errorPublico ? (
            <div style={{ backgroundColor: "#ef444422", color: "#f87171", padding: "1rem", borderRadius: "0.5rem", textAlign: "center", border: "1px solid #ef4444" }}>
              {errorPublico}
            </div>
          ) : (
            <main style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div style={{ backgroundColor: "#1e293b", padding: "1.25rem", borderRadius: "0.75rem", border: "1px solid #334155", textAlign: "center" }}>
                <h2 style={{ fontSize: "1.125rem", color: "#f8fafc" }}>Hola, <b>{clientePublico?.nombre}</b></h2>
                <p style={{ fontSize: "0.875rem", color: "#94a3b8", marginTop: "0.25rem" }}>Tu saldo total pendiente es:</p>
                <div style={{ fontSize: "2rem", fontWeight: "bold", marginTop: "0.5rem", color: (clientePublico?.saldo || 0) > 0 ? "#ef4444" : "#34d399" }}>
                  {formatPesos(clientePublico?.saldo)}
                </div>
              </div>

              <div style={{ backgroundColor: "#1e293b", padding: "1.25rem", borderRadius: "0.75rem", border: "1px solid #334155" }}>
                <h3 style={{ fontSize: "1rem", fontWeight: "bold", color: "#facc15", marginBottom: "1rem" }}>📋 Historial de Servicios</h3>
                
                {historialClientePublico.length === 0 ? (
                  <p style={{ color: "#64748b", textAlign: "center" }}>No hay carreras ni pagos registrados.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {historialClientePublico.map((v) => (
                      <div key={v.id} style={{ backgroundColor: "#0f172a", padding: "0.875rem", borderRadius: "0.5rem", border: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <p style={{ fontWeight: "bold", fontSize: "0.95rem", color: "#f8fafc" }}>{v.lugar}</p>
                          <p style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.2rem" }}>
                            📅 {new Date(v.fecha).toLocaleDateString("es-AR")} | 🕒 {new Date(v.fecha).toLocaleTimeString("es-AR", { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <div style={{ fontWeight: "bold", fontSize: "1rem", color: v.monto < 0 ? "#34d399" : "#ef4444" }}>
                          {v.monto < 0 ? `-${formatPesos(Math.abs(v.monto))}` : `+${formatPesos(v.monto)}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </main>
          )}
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "#0f172a", color: "white", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", fontFamily: "sans-serif" }}>
        <div style={{ maxWidth: "24rem", width: "100%", backgroundColor: "#1e293b", padding: "1.5rem", borderRadius: "0.75rem", border: "1px solid #334155" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#facc15", textAlign: "center", marginBottom: "0.5rem" }}>
            🚕 Cuenta Clara
          </h1>
          <p style={{ color: "#94a3b8", textAlign: "center", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
            {isRegistering ? "Alta de Chofer Administrador" : "Ingreso Chofer"}
          </p>

          <form onSubmit={handleAuth} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {isRegistering && (
              <input
                type="text"
                placeholder="Nombre completo"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                style={{ backgroundColor: "#0f172a", border: "1px solid #334155", color: "white", padding: "0.75rem", borderRadius: "0.5rem" }}
                required
              />
            )}
            <input
              type="email"
              placeholder="Correo electrónico"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ backgroundColor: "#0f172a", border: "1px solid #334155", color: "white", padding: "0.75rem", borderRadius: "0.5rem" }}
              required
            />
            <input
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ backgroundColor: "#0f172a", border: "1px solid #334155", color: "white", padding: "0.75rem", borderRadius: "0.5rem" }}
              required
            />

            <button
              type="submit"
              disabled={loading}
              style={{ backgroundColor: "#facc15", color: "#0f172a", fontWeight: "bold", padding: "0.75rem", borderRadius: "0.5rem", border: "none", cursor: "pointer", marginTop: "0.5rem" }}
            >
              {loading ? "Cargando..." : isRegistering ? "Registrar Chofer" : "Ingresar"}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: "1.25rem" }}>
            <button
              onClick={() => setIsRegistering(!isRegistering)}
              style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "0.875rem", textDecoration: "underline" }}
            >
              {isRegistering ? "¿Ya tienes cuenta? Inicia sesión" : "¿Nuevo chofer? Regístrate aquí"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0f172a", color: "white", padding: "1.5rem", fontFamily: "sans-serif" }}>
      <header style={{ maxWidth: "48rem", margin: "0 auto 2rem auto", borderBottom: "1px solid #334155", paddingBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#facc15" }}>🚕 Cuenta Clara</h1>
          <p style={{ color: "#94a3b8", fontSize: "0.875rem" }}>Sesión iniciada: {session.user.email}</p>
        </div>
        <button
          onClick={handleLogout}
          style={{ backgroundColor: "#ef4444", color: "white", border: "none", padding: "0.5rem 1rem", borderRadius: "0.5rem", cursor: "pointer", fontWeight: "bold" }}
        >
          Cerrar Sesión
        </button>
      </header>

      <main style={{ maxWidth: "48rem", margin: "0 auto", display: "flex", flexDirection: "column", gap: "2rem" }}>
        <section style={{ backgroundColor: "#1e293b", padding: "1.25rem", borderRadius: "0.75rem", border: "1px solid #334155" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginBottom: "1rem", color: "#f8fafc" }}>Agregar Nuevo Cliente</h2>
          <form onSubmit={handleCrearCliente} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <input
              type="text"
              placeholder="Nombre del cliente"
              value={clienteNombre}
              onChange={(e) => setClienteNombre(e.target.value)}
              style={{ backgroundColor: "#0f172a", border: "1px solid #334155", color: "white", padding: "0.75rem", borderRadius: "0.5rem" }}
              required
            />
            <input
              type="text"
              placeholder="Teléfono ej: 5491112345678"
              value={clienteTelefono}
              onChange={(e) => setClienteTelefono(e.target.value)}
              style={{ backgroundColor: "#0f172a", border: "1px solid #334155", color: "white", padding: "0.75rem", borderRadius: "0.5rem" }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{ backgroundColor: "#facc15", color: "#0f172a", fontWeight: "bold", padding: "0.75rem", borderRadius: "0.5rem", border: "none", cursor: "pointer" }}
            >
              {loading ? "Guardando..." : "Crear Cliente"}
            </button>
          </form>
        </section>

        <section style={{ backgroundColor: "#1e293b", padding: "1.25rem", borderRadius: "0.75rem", border: "1px solid #334155" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginBottom: "1rem", color: "#f8fafc" }}>Clientes Registrados</h2>
          {clientes.length === 0 ? (
            <p style={{ color: "#64748b" }}>No tienes clientes registrados aún.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {clientes.map((c) => (
                <div key={c.id} style={{ backgroundColor: "#0f172a", padding: "1rem", borderRadius: "0.5rem", border: "1px solid #334155" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <div>
                      <h3 style={{ fontWeight: "bold", fontSize: "1.125rem", color: "#f8fafc" }}>{c.nombre}</h3>
                      <p style={{ fontSize: "0.875rem", color: "#94a3b8" }}>Tel: {c.telefono || "Sin registrar"}</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Saldo Pendiente</p>
                      <span style={{ fontSize: "1.25rem", fontWeight: "bold", color: c.saldo > 0 ? "#ef4444" : "#34d399" }}>
                        {formatPesos(c.saldo)}
                      </span>
                    </div>
                  </div>

                  <div style={{ backgroundColor: "#1e293b", padding: "0.75rem", borderRadius: "0.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <p style={{ fontSize: "0.875rem", fontWeight: "bold", color: "#facc15" }}>🚕 Registrar Nueva Carrera</p>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      <input
                        type="text"
                        placeholder="Lugar / Destino"
                        value={lugares[c.id] || ""}
                        onChange={(e) => setLugares({ ...lugares, [c.id]: e.target.value })}
                        style={{ flex: "2", minWidth: "140px", backgroundColor: "#0f172a", border: "1px solid #334155", color: "white", padding: "0.5rem", borderRadius: "0.25rem" }}
                      />
                      <input
                        type="number"
                        placeholder="Monto ($ ARS)"
                        value={montosViaje[c.id] || ""}
                        onChange={(e) => setMontosViaje({ ...montosViaje, [c.id]: e.target.value })}
                        style={{ flex: "1", minWidth: "90px", backgroundColor: "#0f172a", border: "1px solid #334155", color: "white", padding: "0.5rem", borderRadius: "0.25rem" }}
                      />
                      <button
                        onClick={() => handleAgregarViaje(c)}
                        style={{ backgroundColor: "#3b82f6", color: "white", border: "none", padding: "0.5rem 1rem", borderRadius: "0.25rem", cursor: "pointer", fontWeight: "bold" }}
                      >
                        Añadir y Enviar WA
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
                    <button
                      onClick={() => fetchHistorial(c.id)}
                      style={{ background: "none", border: "none", color: "#38bdf8", cursor: "pointer", fontSize: "0.875rem", textDecoration: "underline" }}
                    >
                      {historialVisible[c.id] ? "Ocultar historial" : "Ver historial de carreras"}
                    </button>

                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {c.saldo > 0 && (
                        <button
                          onClick={() => handlePagarTodoSaldo(c)}
                          style={{ backgroundColor: "#22c55e", color: "white", border: "none", padding: "0.4rem 0.75rem", borderRadius: "0.25rem", cursor: "pointer", fontSize: "0.8rem", fontWeight: "bold" }}
                        >
                          ✔ Cancelar Deuda Total
                        </button>
                      )}
                      <button
                        onClick={() => handleDarDeBajaCliente(c)}
                        style={{ backgroundColor: "#dc2626", color: "white", border: "none", padding: "0.4rem 0.75rem", borderRadius: "0.25rem", cursor: "pointer", fontSize: "0.8rem", fontWeight: "bold" }}
                        title="Eliminar cliente por completo"
                      >
                        ❌ Dar de baja
                      </button>
                    </div>
                  </div>

                  {historialVisible[c.id] && (
                    <div style={{ marginTop: "0.75rem", borderTop: "1px dashed #334155", paddingTop: "0.5rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                        <p style={{ fontSize: "0.75rem", color: "#94a3b8", margin: 0 }}>Historial de viajes y pagos:</p>
                        {historiales[c.id] && historiales[c.id].length > 0 && (
                          <button
                            onClick={() => handleVaciarHistorialCliente(c)}
                            style={{ backgroundColor: "#b91c1c", color: "white", border: "none", padding: "0.2rem 0.5rem", borderRadius: "0.25rem", cursor: "pointer", fontSize: "0.75rem", fontWeight: "bold" }}
                          >
                            🗑️ Vaciar Historial
                          </button>
                        )}
                      </div>

                      {(!historiales[c.id] || historiales[c.id].length === 0) ? (
                        <p style={{ fontSize: "0.875rem", color: "#64748b" }}>No hay viajes registrados.</p>
                      ) : (
                        historiales[c.id].map((v) => (
                          <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.875rem", padding: "0.5rem 0", borderBottom: "1px solid #1e293b" }}>
                            <div>
                              <p style={{ margin: 0 }}>
                                {new Date(v.fecha).toLocaleDateString("es-AR")} {new Date(v.fecha).toLocaleTimeString("es-AR", { hour: '2-digit', minute: '2-digit' })} - <b>{v.lugar}</b>
                              </p>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ fontWeight: "bold", color: v.monto < 0 ? "#34d399" : "#ef4444" }}>
                                {v.monto < 0 ? `-${formatPesos(Math.abs(v.monto))}` : `+${formatPesos(v.monto)}`}
                              </span>
                              {v.monto > 0 && (
                                v.pagado ? (
                                  <span style={{ color: "#34d399", fontSize: "0.75rem", fontWeight: "bold", backgroundColor: "#064e3b", padding: "0.2rem 0.4rem", borderRadius: "0.25rem" }}>
                                    ✓ Pagado
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => handlePagarViajeIndividual(c, v)}
                                    style={{ backgroundColor: "#0284c7", color: "white", border: "none", padding: "0.25rem 0.5rem", borderRadius: "0.25rem", cursor: "pointer", fontSize: "0.75rem", fontWeight: "bold" }}
                                    title="Marcar este viaje como pagado"
                                  >
                                    💳 Pagar este
                                  </button>
                                )
                              )}
                              <button
                                onClick={() => handleBorrarViajeUnico(c, v.id)}
                                style={{ backgroundColor: "transparent", color: "#ef4444", border: "none", cursor: "pointer", fontSize: "1rem", padding: "0 0.25rem" }}
                                title="Borrar este registro individual"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
