import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import RealMap from "../components/dashboard/RealMap";
import { createLocal, createLocalDish, deleteLocal, getLocalMenu, getOwnerLocals, updateLocal, uploadLocalImage } from "../services/localService";
import { reverseGeocode } from "../services/placeLookup";
import { deleteUserRoute, getCachedUserRoutes, getRoutePoints, getUserRoutes } from "../services/routeService";
import { getDrivingRoute } from "../services/directionsService";

const clientTabs = [
  { id: "my-routes", icon: "⌁", label: "Mis rutas" },
  { id: "settings", icon: "⚙", label: "Configuración" },
];
const ownerTabs = [
  { id: "my-routes", icon: "⌁", label: "Mis rutas" },
  { id: "my-locals", icon: "🏪", label: "Mis locales" },
  { id: "add-local", icon: "+", label: "Agregar local" },
  { id: "settings", icon: "⚙", label: "Configuración" },
];

// Perfil con rutas, locales del propietario y configuración de la cuenta.
export default function PerfilCuenta({ profile, onBack }) {
  const [displayName, setDisplayName] = useState(profile?.user_metadata?.full_name || profile?.email?.split("@")[0] || "Usuario Turi-Mar");
  const name = displayName;
  const initials = name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  const [role, setRole] = useState("propietario");
  const tabs = role === "propietario" ? ownerTabs : clientTabs;
  const [tab, setTab] = useState("my-routes");
  const [localForm, setLocalForm] = useState({
    nombre: "",
    categoria: "restaurante",
    direccion: "",
    horario: "",
    telefono: "",
    descripcion: "",
    imagen_url: "",
    latitud: "",
    longitud: "",
  });
  const [locals, setLocals] = useState([]);
  const [viewingLocal, setViewingLocal] = useState(null);
  const [localDetailTab, setLocalDetailTab] = useState("details");
  const [menuItems, setMenuItems] = useState([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuSaving, setMenuSaving] = useState(false);
  const [menuError, setMenuError] = useState("");
  const [dishForm, setDishForm] = useState({ nombre: "", descripcion: "", precio: "" });
  const [localsLoading, setLocalsLoading] = useState(false);
  const [localSaving, setLocalSaving] = useState(false);
  const [localImageFile, setLocalImageFile] = useState(null);
  const [localImagePreview, setLocalImagePreview] = useState("");
  const [editingLocalId, setEditingLocalId] = useState(null);
  const [deletingLocalId, setDeletingLocalId] = useState(null);
  const [addressLookupStatus, setAddressLookupStatus] = useState("");
  const addressLookupController = useRef(null);
  const [routes, setRoutes] = useState([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesError, setRoutesError] = useState("");
  const [followingRoute, setFollowingRoute] = useState(null);
  const [followLoadingId, setFollowLoadingId] = useState(null);
  const [followError, setFollowError] = useState("");
  const [deletingRouteId, setDeletingRouteId] = useState(null);
  const [accountForm, setAccountForm] = useState({
    nombre: profile?.user_metadata?.full_name ?? profile?.email?.split("@")[0] ?? "",
    email: profile?.email ?? "",
    password: "",
  });
  const [settings, setSettings] = useState(() => ({
    push: true,
    gps: true,
    language: "Español",
    currency: "Soles (PEN)",
    ...profile?.user_metadata?.turimar_settings,
  }));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (tab !== "my-routes" || !profile?.id) return;

    let active = true;
    setRoutesLoading(true);
    setRoutesError("");
    getUserRoutes(profile.id)
      .then(async (records) => {
        const expandedRoutes = await Promise.all(records.map(async (route) => {
          if (Array.isArray(route.puntos) || Array.isArray(route.points)) return route;
          const routeId = route.id ?? route.ruta_id;
          if (!routeId) return route;
          try {
            const points = await getRoutePoints(routeId);
            return { ...route, puntos: points };
          } catch {
            return route;
          }
        }));
        if (active) setRoutes(expandedRoutes);
      })
      .catch((error) => {
        if (active) {
          const cachedRoutes = getCachedUserRoutes(profile.id);
          setRoutes(cachedRoutes);
          setRoutesError(cachedRoutes.length
            ? `Mostrando las rutas guardadas en este dispositivo. No se pudo sincronizar: ${error.message}`
            : `No se pudieron cargar tus rutas: ${error.message}`);
        }
      })
      .finally(() => {
        if (active) setRoutesLoading(false);
      });

    return () => { active = false; };
  }, [tab, profile?.id]);
  useEffect(() => {
    if (role !== "propietario" || !profile?.id) return;

    let active = true;
    setLocalsLoading(true);
    getOwnerLocals(profile.id)
      .then((data) => {
        if (!active) return;
        setLocals(Array.isArray(data) ? data : data?.locales ?? data?.data ?? []);
        setMessage("");
      })
      .catch((error) => {
        if (active) {
          const detail = error.message.includes("prepared statement")
            ? "La base de datos del servidor está fallando (SQLx). El backend debe corregir su conexión."
            : error.message;
          setMessage(`No se pudieron cargar tus locales: ${detail}`);
        }
      })
      .finally(() => {
        if (active) setLocalsLoading(false);
      });

    return () => { active = false; };
  }, [role, profile?.id]);
  useEffect(() => {
    if (!viewingLocal || localDetailTab !== "menu") return;

    let active = true;
    setMenuLoading(true);
    setMenuError("");
    getLocalMenu(viewingLocal.id)
      .then((items) => {
        if (active) setMenuItems(items);
      })
      .catch((error) => {
        if (active) setMenuError(`No se pudo cargar la carta: ${error.message}`);
      })
      .finally(() => {
        if (active) setMenuLoading(false);
      });

    return () => { active = false; };
  }, [viewingLocal?.id, localDetailTab]);
  const memberSince = useMemo(() => {
    if (!profile?.created_at) return "Sin fecha registrada";

    return new Date(profile.created_at).toLocaleDateString("es-PE", {
      month: "long",
      year: "numeric",
    });
  }, [profile?.created_at]);

  // Persiste los metadatos del perfil y comunica errores o éxito en la interfaz.
  const persist = async (metadata, success) => {
    setSaving(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.updateUser({ data: metadata });
      if (error) throw error;
      setMessage(success);
    } catch (error) {
      setMessage(`No se pudo guardar la configuración: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };
  const saveAccount = async (event) => {
    event.preventDefault();
    const cleanName = accountForm.nombre.trim().replace(/\s+/g, " ");
    if (cleanName.length < 2) {
      setMessage("Escribe tu nombre completo.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const attributes = { data: { full_name: cleanName, nombre: cleanName } };
      const cleanEmail = accountForm.email.trim();
      if (cleanEmail && cleanEmail !== profile?.email) attributes.email = cleanEmail;
      if (accountForm.password) attributes.password = accountForm.password;

      const { error } = await supabase.auth.updateUser(attributes);
      if (error) throw error;

      setDisplayName(cleanName);
      setAccountForm((current) => ({ ...current, nombre: cleanName, password: "" }));
      const { error: profileError } = await supabase
        .from("usuarios")
        .update({ nombre: cleanName, email: cleanEmail || profile?.email })
        .eq("id", profile.id);

      setMessage(profileError
        ? `Nombre y acceso de Supabase actualizados. La tabla usuarios rechazó sincronizar los datos: ${profileError.message}`
        : attributes.email && attributes.email !== profile?.email
          ? "Cambios guardados. Confirma el correo nuevo desde tu bandeja de entrada."
          : "Datos de cuenta actualizados.");
    } catch (error) {
      setMessage(`No se pudo actualizar la cuenta: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };
  const followSavedRoute = async (route) => {
    const routeId = route.id ?? route.ruta_id;
    const savedStops = (route.puntos ?? route.points ?? []).map((point) => ({
      name: point.nombre ?? point.name ?? "Parada",
      latitude: Number(point.latitud ?? point.latitude),
      longitude: Number(point.longitud ?? point.longitude),
    }));
    if (savedStops.length < 2 || savedStops.some((point) => !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude))) {
      setFollowError("Esta ruta no tiene al menos dos paradas con coordenadas válidas.");
      return;
    }
    if (!navigator.geolocation) {
      setFollowError("Este navegador no permite obtener tu ubicación.");
      return;
    }

    setFollowLoadingId(routeId);
    setFollowError("");
    setFollowingRoute(null);
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 30000,
        });
      });
      const origin = { name: "Tu ubicación", latitude: position.coords.latitude, longitude: position.coords.longitude };
      const stops = [origin, ...savedStops];
      const segments = [];
      for (let index = 0; index < stops.length - 1; index += 1) {
        segments.push(await getDrivingRoute(stops[index], stops[index + 1]));
      }

      const coordinates = segments.flatMap((segment, index) => (
        index === 0 ? segment.coordinates : segment.coordinates.slice(1)
      ));
      setFollowingRoute({
        id: routeId,
        title: route.titulo ?? route.titulo_ruta ?? route.nombre ?? "Ruta guardada",
        stops,
        coordinates,
        distanceMeters: segments.reduce((total, segment) => total + segment.distanceMeters, 0),
        durationSeconds: segments.reduce((total, segment) => total + segment.durationSeconds, 0),
      });
    } catch (error) {
      if (error?.code === 1) setFollowError("Permite el acceso a tu ubicación para seguir esta ruta.");
      else if (error?.code === 2 || error?.code === 3) setFollowError("No se pudo obtener tu ubicación. Inténtalo nuevamente.");
      else setFollowError(error instanceof Error ? error.message : "No se pudo calcular el recorrido por calles.");
    } finally {
      setFollowLoadingId(null);
    }
  };
  const removeRoute = async (route) => {
    const routeId = route.id ?? route.ruta_id;
    if (!window.confirm(`¿Eliminar la ruta “${route.titulo ?? route.titulo_ruta ?? "Ruta guardada"}” y sus paradas?`)) return;
    setDeletingRouteId(routeId);
    setRoutesError("");
    try {
      await deleteUserRoute(routeId, profile.id);
      setRoutes((current) => current.filter((item) => String(item.id ?? item.ruta_id) !== String(routeId)));
      if (String(followingRoute?.id) === String(routeId)) setFollowingRoute(null);
    } catch (error) {
      setRoutesError(`No se pudo eliminar la ruta: ${error.message}`);
    } finally {
      setDeletingRouteId(null);
    }
  };
  const reloadLocals = async () => {
    const data = await getOwnerLocals(profile.id);
    setLocals(Array.isArray(data) ? data : data?.locales ?? data?.data ?? []);
  };
  const switchRole = (nextRole) => {
    setRole(nextRole);
    setTab("my-routes");
  };

  const resetLocalForm = () => {
    setLocalForm({ nombre: "", categoria: "restaurante", direccion: "", horario: "", telefono: "", descripcion: "", imagen_url: "", latitud: "", longitud: "" });
    if (localImagePreview.startsWith("blob:")) URL.revokeObjectURL(localImagePreview);
    setLocalImagePreview("");
    setLocalImageFile(null);
    setEditingLocalId(null);
  };

  const saveLocal = async () => {
    const latitude = Number(localForm.latitud);
    const longitude = Number(localForm.longitud);
    if (!profile?.id) {
      setMessage("Inicia sesión nuevamente para asociar el local a tu cuenta.");
      return;
    }
    if (!localForm.nombre.trim() || !localForm.direccion.trim()) {
      setMessage("Completa el nombre y la dirección del local.");
      return;
    }
    if (!localForm.latitud.trim() || !localForm.longitud.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      setMessage("Selecciona la ubicación en el mapa o ingresa coordenadas válidas.");
      return;
    }

    const payload = {
      usuario_id: profile.id,
      nombre: localForm.nombre.trim(),
      categoria: localForm.categoria,
      descripcion: localForm.descripcion.trim(),
      direccion: localForm.direccion.trim(),
      horario: localForm.horario.trim(),
      telefono: localForm.telefono.trim(),
      imagen_url: localForm.imagen_url || null,
      latitud: latitude,
      longitud: longitude,
    };

    setLocalSaving(true);
    setMessage("");
    try {
      if (localImageFile) payload.imagen_url = await uploadLocalImage(localImageFile, profile.id);
      if (editingLocalId) await updateLocal(editingLocalId, payload);
      else await createLocal(payload);
      const successMessage = editingLocalId ? "Local actualizado." : "Local publicado correctamente.";
      resetLocalForm();
      setTab("my-locals");
      setMessage(successMessage);
      try {
        await reloadLocals();
      } catch {
        setMessage(`${successMessage} No se pudo actualizar la lista; vuelve a abrir Mis locales.`);
      }
    } catch (error) {
      setMessage(`No se pudo guardar el local: ${error.message}`);
    } finally {
      setLocalSaving(false);
    }
  };

  const editLocal = (local) => {
    if (localImagePreview.startsWith("blob:")) URL.revokeObjectURL(localImagePreview);
    setLocalForm({
      nombre: local.nombre ?? "",
      categoria: local.categoria ?? "restaurante",
      direccion: local.direccion ?? "",
      horario: local.horario ?? "",
      telefono: local.telefono ?? "",
      descripcion: local.descripcion ?? "",
      imagen_url: local.imagen_url ?? "",
      latitud: String(local.latitud ?? local.latitude ?? ""),
      longitud: String(local.longitud ?? local.longitude ?? ""),
    });
    setLocalImageFile(null);
    setLocalImagePreview(local.imagen_url ?? "");
    setEditingLocalId(local.id);
    setMessage("");
    setTab("add-local");
  };

  const removeLocal = async (local) => {
    if (!window.confirm(`¿Eliminar ${local.nombre ?? "este local"}? Esta acción no se puede deshacer.`)) return;
    setDeletingLocalId(local.id);
    setMessage("");
    try {
      await deleteLocal(local.id, profile.id);
      await reloadLocals();
      setMessage("Local eliminado.");
    } catch (error) {
      setMessage(`No se pudo eliminar el local: ${error.message}`);
    } finally {
      setDeletingLocalId(null);
    }
  };

  const saveDish = async (event) => {
    event.preventDefault();
    if (!viewingLocal || !dishForm.nombre.trim()) {
      setMenuError("Escribe el nombre del plato.");
      return;
    }

    const price = Number(dishForm.precio);
    if (!dishForm.precio.trim() || !Number.isFinite(price) || price < 0) {
      setMenuError("Escribe un precio válido en soles.");
      return;
    }

    setMenuSaving(true);
    setMenuError("");
    try {
      await createLocalDish(viewingLocal.id, {
        nombre: dishForm.nombre.trim(),
        descripcion: dishForm.descripcion.trim(),
        precio: price,
      });
      setMenuItems(await getLocalMenu(viewingLocal.id));
      setDishForm({ nombre: "", descripcion: "", precio: "" });
    } catch (error) {
      setMenuError(`No se pudo guardar el plato: ${error.message}`);
    } finally {
      setMenuSaving(false);
    }
  };

  const selectLocalPosition = async (latitude, longitude) => {
    addressLookupController.current?.abort();
    const controller = new AbortController();
    addressLookupController.current = controller;
    setLocalForm((current) => ({
      ...current,
      latitud: latitude.toFixed(6),
      longitud: longitude.toFixed(6),
    }));
    setAddressLookupStatus("Buscando dirección…");

    try {
      const result = await reverseGeocode(latitude, longitude, controller.signal);
      if (controller.signal.aborted) return;
      const address = result.address || result.name;
      setLocalForm((current) => ({ ...current, direccion: address }));
      setAddressLookupStatus(address ? `Dirección detectada: ${result.name}` : "No se encontró una dirección; puedes escribirla manualmente.");
    } catch {
      if (!controller.signal.aborted) setAddressLookupStatus("No se pudo detectar la dirección. Puedes escribirla manualmente.");
    }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setMessage("Este navegador no permite obtener la ubicación.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => selectLocalPosition(coords.latitude, coords.longitude),
      () => setMessage("No se pudo obtener tu ubicación. Revisa el permiso de GPS."),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  return (
    <main className="fig-profile">
      <header className="fig-profile-bar">
        <div className="fig-brand">
          <span>◒</span>
          <strong>Turi<span>-Mar</span></strong>
          <i />
          Mi Perfil
        </div>
        <button onClick={onBack}>← Volver</button>
      </header>

      <section className="fig-profile-hero">
        <div className="fig-profile-inner">
          <div className="fig-role-switch">
            <button className={role === "cliente" ? "active" : ""} onClick={() => switchRole("cliente")}>Cliente</button>
            <button className={role === "propietario" ? "active" : ""} onClick={() => switchRole("propietario")}>Propietario</button>
          </div>
          <div className="fig-identity">
            <div className="fig-avatar">
              {initials}
            </div>
            <div className="fig-identity-copy">
              <h1>{name}</h1>
              {profile?.email && <a>@{profile.email.split("@")[0].toLowerCase()}</a>}
              <p>
                Miembro desde {memberSince} ·
                <em>{role === "propietario" ? "Dueño de Local" : "Turista Explorador"}</em>
              </p>
            </div>
          </div>

          <div className="fig-stats profile-real-stats">
            {[
              ["⌁", routesLoading ? "…" : String(routes.length), "Mis rutas"],
              ...(role === "propietario" ? [["⌂", localsLoading ? "…" : String(locals.length), "Mis locales"]] : []),
            ].map(([icon, count, label]) => (
              <div key={label}>
                <span>{icon}</span>
                <strong>{count}</strong>
                <small>{label}</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="fig-profile-content">
        <nav className="fig-tabs" aria-label="Secciones del perfil">
          {tabs.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => {
                setTab(item.id);
                setMessage("");
              }}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        {message && (
          <p className={`fig-feedback ${message.toLowerCase().startsWith("no se pudo") || message.toLowerCase().startsWith("no se pudieron") ? "fig-feedback-error" : ""}`} role="status">{message}</p>
        )}

        {tab === "my-routes" && (
          <section className="fig-box fig-my-routes">
            <div className="fig-section-title">
              <h2>Mis rutas <small>({routes.length})</small></h2>
              <button onClick={async () => {
                setRoutesLoading(true);
                setRoutesError("");
                try {
                  const records = await getUserRoutes(profile.id);
                  const expanded = await Promise.all(records.map(async (route) => {
                    if (Array.isArray(route.puntos) || Array.isArray(route.points)) return route;
                    const id = route.id ?? route.ruta_id;
                    if (!id) return route;
                    try { return { ...route, puntos: await getRoutePoints(id) }; } catch { return route; }
                  }));
                  setRoutes(expanded);
                } catch (error) {
                  const cachedRoutes = getCachedUserRoutes(profile.id);
                  setRoutes(cachedRoutes);
                  setRoutesError(cachedRoutes.length
                    ? `Mostrando las rutas guardadas en este dispositivo. No se pudo sincronizar: ${error.message}`
                    : `No se pudieron cargar tus rutas: ${error.message}`);
                } finally {
                  setRoutesLoading(false);
                }
              }} disabled={routesLoading}>{routesLoading ? "Actualizando…" : "Actualizar"}</button>
            </div>
            {routesLoading ? <p className="fig-empty">Cargando tus rutas…</p> : null}
            {routesError && <p className="fig-feedback fig-feedback-error" role="alert">{routesError}</p>}
            {!routesLoading && !routesError && routes.length === 0 && (
              <div className="fig-empty-state">
                <strong>Aún no aparecen rutas en tu perfil</strong>
                <p>Las rutas creadas con esta cuenta se mostrarán aquí cuando el backend las devuelva.</p>
              </div>
            )}
            <div className="fig-user-route-list">
              {routes.map((route) => {
                const routeId = route.id ?? route.ruta_id;
                const routeTitle = route.titulo ?? route.titulo_ruta ?? route.nombre ?? "Ruta sin título";
                const points = route.puntos ?? route.points ?? [];
                return (
                  <article className="fig-user-route" key={routeId ?? routeTitle}>
                    <div className="fig-user-route-heading">
                      <div><span>RUTA</span><h3>{routeTitle}</h3></div>
                      <small>{route.categoria ?? "Sin categoría"}</small>
                    </div>
                    {route.descripcion && <p>{route.descripcion}</p>}
                    <div className="fig-user-route-meta">
                      {route.duracion_total_horas != null && <span>{route.duracion_total_horas} h</span>}
                      {route.presupuesto_total_estimado != null && <span>S/ {Number(route.presupuesto_total_estimado).toFixed(2)}</span>}
                      <span>{points.length} paradas</span>
                    </div>
                    {points.length > 0 && <ol>{points.map((point, index) => <li key={point.id ?? `${point.nombre}-${index}`}>{point.nombre ?? point.name ?? `Parada ${index + 1}`}</li>)}</ol>}
                    <div className="fig-user-route-actions">
                      <button className="fig-primary" onClick={() => followSavedRoute(route)} disabled={followLoadingId === routeId}>
                        {followLoadingId === routeId ? "Calculando desde tu ubicación…" : "⌖ Seguir ruta"}
                      </button>
                      <button className="fig-danger" onClick={() => removeRoute(route)} disabled={deletingRouteId === routeId}>
                        {deletingRouteId === routeId ? "Eliminando…" : "Eliminar ruta"}
                      </button>
                    </div>
                    {followError && <p className="fig-feedback fig-feedback-error" role="alert">{followError}</p>}
                    {followingRoute && String(followingRoute.id) === String(routeId) && (
                      <div className="fig-follow-route">
                        <div className="fig-follow-route-map">
                          <RealMap
                            locations={followingRoute.stops.map((stop, index) => ({
                              ...stop,
                              address: index === 0 ? "Punto de partida" : `Parada ${index}`,
                              kind: index === 0 ? "start" : "destination",
                            }))}
                            routeLine={followingRoute.coordinates}
                            fitLocations
                            showToolbar={false}
                            showUserMarker={false}
                            requestUserLocation={false}
                          />
                        </div>
                        <div className="fig-follow-route-summary">
                          <strong>{(followingRoute.distanceMeters / 1000).toFixed(1)} km</strong>
                          <strong>{Math.max(1, Math.round(followingRoute.durationSeconds / 60))} min aprox.</strong>
                          <button className="fig-secondary" onClick={() => setFollowingRoute(null)}>Cerrar recorrido</button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {role === "propietario" && tab === "my-locals" && (
          <section className="fig-owner-locals fig-box">
            <div className="fig-section-title">
              <h2>{viewingLocal ? viewingLocal.nombre : <>Mis locales <small>({locals.length})</small></>}</h2>
              {viewingLocal ? (
                <button onClick={() => { setViewingLocal(null); setLocalDetailTab("details"); }}>← Mis locales</button>
              ) : <button onClick={() => { resetLocalForm(); setTab("add-local"); }}>＋ Agregar local</button>}
            </div>
            {viewingLocal ? (
              <>
                <nav className="fig-local-tabs" aria-label="Secciones del local">
                  <button className={localDetailTab === "details" ? "active" : ""} onClick={() => setLocalDetailTab("details")}>Información</button>
                  <button className={localDetailTab === "menu" ? "active" : ""} onClick={() => setLocalDetailTab("menu")}>Carta</button>
                </nav>
                {localDetailTab === "details" ? (
                  <div className="fig-local-detail">
                    <p>{viewingLocal.descripcion || "Sin descripción."}</p>
                    <dl>
                      <div><dt>Categoría</dt><dd>{viewingLocal.categoria ?? viewingLocal.tipo_local ?? "Local"}</dd></div>
                      <div><dt>Dirección</dt><dd>{viewingLocal.direccion || "Sin dirección"}</dd></div>
                      <div><dt>Horario</dt><dd>{viewingLocal.horario || "Sin horario registrado"}</dd></div>
                      <div><dt>Teléfono</dt><dd>{viewingLocal.telefono || "Sin teléfono registrado"}</dd></div>
                    </dl>
                    <button className="fig-secondary" onClick={() => editLocal(viewingLocal)}>Editar local</button>
                  </div>
                ) : (
                  <div className="fig-local-menu">
                    <div className="fig-section-title"><h3>Carta y platos</h3><span>{menuItems.length} platos</span></div>
                    {menuLoading && <p className="fig-empty">Cargando carta…</p>}
                    {menuError && <p className="fig-feedback fig-feedback-error" role="alert">{menuError}</p>}
                    {!menuLoading && !menuError && menuItems.length === 0 && <p className="fig-empty">Todavía no hay platos en la carta.</p>}
                    <div className="fig-dish-list">
                      {menuItems.map((dish) => (
                        <article className="fig-dish-item" key={dish.id ?? `${dish.nombre}-${dish.precio}`}>
                          <div><strong>{dish.nombre ?? dish.name ?? "Plato"}</strong>{dish.descripcion && <small>{dish.descripcion}</small>}</div>
                          <b>S/ {Number(dish.precio ?? 0).toFixed(2)}</b>
                        </article>
                      ))}
                    </div>
                    <form className="fig-dish-form" onSubmit={saveDish}>
                      <h3>Agregar plato</h3>
                      <label>Nombre del plato<input required maxLength={100} value={dishForm.nombre} onChange={(event) => setDishForm((current) => ({ ...current, nombre: event.target.value }))} placeholder="Ej. Ceviche mixto" /></label>
                      <label>Descripción<input maxLength={240} value={dishForm.descripcion} onChange={(event) => setDishForm((current) => ({ ...current, descripcion: event.target.value }))} placeholder="Ingredientes o presentación" /></label>
                      <label>Precio (S/)<input required type="number" min="0" step="0.01" value={dishForm.precio} onChange={(event) => setDishForm((current) => ({ ...current, precio: event.target.value }))} placeholder="0.00" /></label>
                      <button className="fig-primary" disabled={menuSaving}>{menuSaving ? "Guardando…" : "Guardar plato"}</button>
                    </form>
                  </div>
                )}
              </>
            ) : localsLoading ? <p className="fig-empty">Cargando locales…</p> : locals.length ? (
              <div className="fig-local-list">
                {locals.map((local) => (
                  <article className="fig-local-item" key={local.id}>
                    <div>
                      <strong>{local.nombre ?? "Local sin nombre"}</strong>
                      <small>{local.categoria ?? "Local"} · {local.direccion ?? "Sin dirección"}</small>
                      <small>{local.latitud ?? local.latitude}, {local.longitud ?? local.longitude}</small>
                    </div>
                    <div className="fig-local-actions">
                      <button className="fig-secondary" onClick={() => { setViewingLocal(local); setLocalDetailTab("details"); setMenuItems([]); setMenuError(""); }}>Ver local</button>
                      <button className="fig-secondary" onClick={() => editLocal(local)}>Editar</button>
                      <button className="fig-danger" onClick={() => removeLocal(local)} disabled={deletingLocalId === local.id}>
                        {deletingLocalId === local.id ? "Eliminando…" : "Eliminar"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="fig-empty">Todavía no tienes locales publicados.</p>}
          </section>
        )}

        {role === "propietario" && tab === "add-local" && (
          <section className="fig-owner-card fig-add-local">
            <div className="fig-owner-header">
              <h2>{editingLocalId ? "Editar local" : "Agregar local"}</h2>
              <span>Ubicación requerida</span>
            </div>
              <div className="fig-owner-form">
                <label>
                  Nombre del local
                  <input value={localForm.nombre} onChange={(event) => setLocalForm((current) => ({ ...current, nombre: event.target.value }))} />
                </label>
                <label>
                  Categoría
                  <select value={localForm.categoria} onChange={(event) => setLocalForm((current) => ({ ...current, categoria: event.target.value }))}>
                    <option value="restaurante">Restaurante</option>
                    <option value="hotel">Hotel</option>
                    <option value="tour">Tour</option>
                    <option value="tienda">Tienda</option>
                    <option value="mirador">Mirador</option>
                    <option value="servicio">Servicio</option>
                  </select>
                </label>
                <label className="full-width">
                  Descripción
                  <textarea value={localForm.descripcion} rows={3} onChange={(event) => setLocalForm((current) => ({ ...current, descripcion: event.target.value }))} />
                </label>
                <div className="full-width fig-local-image-field">
                  <label htmlFor="local-image-upload">Imagen del local <small>(JPG, PNG o WebP · máximo 5 MB)</small></label>
                  <input id="local-image-upload" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (localImagePreview.startsWith("blob:")) URL.revokeObjectURL(localImagePreview);
                    setLocalImageFile(file);
                    setLocalImagePreview(URL.createObjectURL(file));
                  }} />
                  {localImagePreview && <img className="fig-local-image-preview" src={localImagePreview} alt="Vista previa de la imagen del local" />}
                  {localImagePreview && <button type="button" className="fig-secondary" onClick={() => {
                    if (localImagePreview.startsWith("blob:")) URL.revokeObjectURL(localImagePreview);
                    setLocalImageFile(null);
                    setLocalImagePreview("");
                    setLocalForm((current) => ({ ...current, imagen_url: "" }));
                  }}>Quitar imagen</button>}
                </div>
                <label>
                  Dirección
                  <input value={localForm.direccion} placeholder="Haz clic en el mapa para detectar la dirección" onChange={(event) => { setLocalForm((current) => ({ ...current, direccion: event.target.value })); setAddressLookupStatus(""); }} />
                  {addressLookupStatus && <small className="fig-local-map-status" role="status">{addressLookupStatus}</small>}
                </label>
                <label>
                  Horario
                  <input value={localForm.horario} onChange={(event) => setLocalForm((current) => ({ ...current, horario: event.target.value }))} />
                </label>
                <label>
                  Teléfono
                  <input value={localForm.telefono} onChange={(event) => setLocalForm((current) => ({ ...current, telefono: event.target.value }))} />
                </label>
                <label>
                  Latitud
                  <input type="number" step="any" value={localForm.latitud} onChange={(event) => setLocalForm((current) => ({ ...current, latitud: event.target.value }))} />
                </label>
                <label>
                  Longitud
                  <input type="number" step="any" value={localForm.longitud} onChange={(event) => setLocalForm((current) => ({ ...current, longitud: event.target.value }))} />
                </label>
                <div className="fig-local-map-block full-width">
                  <div className="fig-local-map-heading">
                    <strong>Marca la ubicación exacta</strong>
                    <button type="button" className="fig-secondary" onClick={useCurrentLocation}>◎ Usar mi ubicación</button>
                  </div>
                  <div className="fig-local-map">
                    <RealMap
                      showToolbar={false}
                      showUserMarker={false}
                      requestUserLocation={false}
                      locations={localForm.latitud && localForm.longitud ? [{
                        name: localForm.nombre || "Ubicación del local",
                        address: localForm.direccion,
                        latitude: Number(localForm.latitud),
                        longitude: Number(localForm.longitud),
                      }] : []}
                      onMapClick={selectLocalPosition}
                    />
                  </div>
                  <small>Haz clic en el mapa para fijar el punto. Puedes ajustar las coordenadas en los campos.</small>
                </div>
              </div>
              <div className="fig-owner-actions">
                <button className="fig-secondary" onClick={() => { resetLocalForm(); setTab("my-locals"); }}>Cancelar</button>
                <button className="fig-primary" onClick={saveLocal} disabled={localSaving}>{localSaving ? "Guardando…" : editingLocalId ? "Guardar cambios" : "Publicar local"}</button>
              </div>
          </section>
        )}

        {tab === "settings" ? (
          <div className="fig-account-settings">
            <Settings
              settings={settings}
              setSettings={setSettings}
              save={() => persist({ turimar_settings: settings }, "Configuración guardada.")}
              saving={saving}
            />
            <form className="fig-box fig-account-form" onSubmit={saveAccount}>
              <h2>Datos de cuenta</h2>
              <label>
                Nombre completo
                <input required minLength={2} maxLength={100} autoComplete="name" value={accountForm.nombre} onChange={(event) => setAccountForm((current) => ({ ...current, nombre: event.target.value }))} />
              </label>
              <label>
                Correo electrónico
                <input required type="email" autoComplete="email" value={accountForm.email} onChange={(event) => setAccountForm((current) => ({ ...current, email: event.target.value }))} />
              </label>
              <label>
                Nueva contraseña <small>(déjala vacía para no cambiarla)</small>
                <input type="password" minLength={8} autoComplete="new-password" value={accountForm.password} onChange={(event) => setAccountForm((current) => ({ ...current, password: event.target.value }))} placeholder="Mínimo 8 caracteres" />
              </label>
              <button className="fig-primary" disabled={saving}>{saving ? "Guardando…" : "Guardar datos de cuenta"}</button>
            </form>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Settings({ settings, setSettings, save, saving }) {
  const toggleSetting = (key) => {
    setSettings((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <section className="fig-box fig-settings">
      <h2>Privacidad y alertas</h2>
      <Toggle
        label="Notificaciones push"
        hint="Eventos y nuevos lugares cercanos"
        checked={settings.push}
        onClick={() => toggleSetting("push")}
      />
      <Toggle
        label="GPS por defecto"
        hint="Activar ubicación al abrir la app"
        checked={settings.gps}
        onClick={() => toggleSetting("gps")}
      />
      <label className="fig-setting-select">
        <span>🌐　Idioma</span>
        <select
          value={settings.language}
          onChange={(event) =>
            setSettings((current) => ({ ...current, language: event.target.value }))
          }
        >
          <option>Español</option>
          <option>English</option>
        </select>
      </label>
      <label className="fig-setting-select">
        <span>🪙　Moneda</span>
        <select
          value={settings.currency}
          onChange={(event) =>
            setSettings((current) => ({ ...current, currency: event.target.value }))
          }
        >
          <option>Soles (PEN)</option>
          <option>Dólares (USD)</option>
        </select>
      </label>
      <button className="fig-save-prefs" onClick={save} disabled={saving}>
        {saving ? "Guardando…" : "Guardar configuración"}
      </button>
    </section>
  );
}

function Toggle({ label, hint, checked, onClick }) {
  return (
    <div className="fig-toggle">
      <div>
        <strong>{label}</strong>
        <small>{hint}</small>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={checked ? "on" : ""}
        onClick={onClick}
      >
        <i />
      </button>
    </div>
  );
}
