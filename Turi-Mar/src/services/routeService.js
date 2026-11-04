import { supabase } from "../supabaseClient";

const API_URL = import.meta.env.VITE_API_URL ?? "https://turimar-backend.onrender.com";
const ROUTE_CACHE_PREFIX = "turimar_routes_";

function canUseSupabaseFallback(error) {
  return error.status === 404 || error.status === 405 || error.message.includes("prepared statement");
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.text();
  let data = null;
  if (body) {
    try {
      data = JSON.parse(body);
    } catch {
      data = body;
    }
  }
  if (!response.ok) {
    const message = typeof data === "string" ? data : data?.message ?? data?.error;
    const error = new Error(message || `Error ${response.status} del backend`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function generarRutaIA(preferences = {}) {
  return request("/api/routes/generate", {
    method: "POST",
    body: JSON.stringify({
      preferencias_comida: preferences.foods ?? [],
      tipo_acompanante: preferences.companion ?? "solo",
      presupuesto_nivel: preferences.budget ?? "medio",
      tiempo_disponible_horas: preferences.hours ?? 4,
      ubicacion_origen: preferences.location ?? null,
    }),
  });
}

export async function crearRutaComunidad(route, points) {
  let created;
  let createdWithSupabase = false;
  try {
    created = await request("/api/v1/rutas", {
      method: "POST",
      body: JSON.stringify(route),
    });
  } catch (error) {
    if (!canUseSupabaseFallback(error)) throw error;
    const routeRow = {
      usuario_id: route.usuario_id,
      titulo: route.titulo,
      descripcion: route.descripcion ?? null,
      categoria: route.categoria ?? null,
      filtros: route.filtros ?? null,
      es_publica: route.es_publica ?? true,
      mostrar_propietario: route.mostrar_propietario ?? true,
    };
    const { data, error: insertError } = await supabase
      .from("rutas")
      .insert(routeRow)
      .select()
      .single();
    if (insertError) throw new Error(`Render no pudo guardar la ruta y Supabase la rechazó: ${insertError.message}`);
    created = data;
    createdWithSupabase = true;
  }

  const record = created?.data ?? created?.ruta ?? created;
  const routeId = record?.id ?? record?.ruta_id ?? record?.id_ruta;
  if (!routeId) {
    throw new Error("El backend creó la solicitud, pero no devolvió el ID de la ruta.");
  }

  for (const [index, point] of points.entries()) {
    const pointRow = {
      ruta_id: routeId,
      orden: index + 1,
      nombre: point.name,
      latitud: point.latitude,
      longitud: point.longitude,
      comentario_tramo: point.comment ?? null,
    };
    if (createdWithSupabase) {
      const { error: pointError } = await supabase.from("ruta_puntos").insert(pointRow);
      if (pointError) throw new Error(`La ruta se creó, pero Supabase rechazó una parada: ${pointError.message}`);
      continue;
    }

    try {
      const requestPoint = {
        orden: pointRow.orden,
        nombre: pointRow.nombre,
        latitud: pointRow.latitud,
        longitud: pointRow.longitud,
        comentario_tramo: pointRow.comentario_tramo,
      };
      await request(`/api/v1/rutas/${encodeURIComponent(routeId)}/puntos`, {
        method: "POST",
        body: JSON.stringify(requestPoint),
      });
    } catch (error) {
      if (!canUseSupabaseFallback(error)) throw error;
      const { error: pointError } = await supabase.from("ruta_puntos").insert(pointRow);
      if (pointError) throw new Error(`La ruta se creó, pero Supabase rechazó una parada: ${pointError.message}`);
    }
  }

  return { ...record, id: routeId };
}

export async function getUserRoutes(userId) {
  let data;
  try {
    data = await request(`/api/v1/rutas/usuario/${encodeURIComponent(userId)}`);
  } catch (error) {
    if (!canUseSupabaseFallback(error)) throw error;

    const { data: savedRoutes, error: queryError } = await supabase
      .from("rutas")
      .select("*")
      .eq("usuario_id", userId)
      .order("created_at", { ascending: false });
    if (queryError) {
      throw new Error(`Render no pudo leer las rutas y Supabase rechazó la consulta: ${queryError.message}`);
    }
    if (!savedRoutes?.length) {
      throw new Error("No se pudieron recuperar rutas: verifica que la policy SELECT de rutas permita consultar las rutas propias. Render también presenta un error SQLx.");
    }
    data = savedRoutes;
  }
  const routes = [data, data?.rutas, data?.routes, data?.data, data?.data?.rutas, data?.data?.routes]
    .find(Array.isArray);
  if (!Array.isArray(routes)) {
    throw new Error("El backend devolvió un formato inesperado para tus rutas.");
  }
  return routes;
}

export async function getPublicRoutes() {
  let data;
  try {
    data = await request("/api/v1/rutas");
  } catch (error) {
    if (!canUseSupabaseFallback(error)) throw error;
    const { data: routes, error: queryError } = await supabase
      .from("rutas")
      .select("*, ruta_puntos(*)")
      .eq("es_publica", true)
      .order("created_at", { ascending: false });
    if (queryError) throw new Error(`No se pudieron cargar las rutas públicas: ${queryError.message}`);
    data = routes;
  }
  const routes = [data, data?.rutas, data?.routes, data?.data, data?.data?.rutas, data?.data?.routes]
    .find(Array.isArray);
  if (!routes) throw new Error("El backend devolvió un formato inesperado para las rutas públicas.");
  return routes.filter((route) => route.es_publica !== false);
}

export function getCachedUserRoutes(userId) {
  try {
    const routes = JSON.parse(localStorage.getItem(`${ROUTE_CACHE_PREFIX}${userId}`) ?? "[]");
    return Array.isArray(routes) ? routes : [];
  } catch {
    return [];
  }
}

export function cacheUserRoute(userId, route) {
  try {
    const routes = getCachedUserRoutes(userId);
    const routeId = route.id ?? route.ruta_id;
    const filtered = routes.filter((item) => (item.id ?? item.ruta_id) !== routeId);
    localStorage.setItem(`${ROUTE_CACHE_PREFIX}${userId}`, JSON.stringify([route, ...filtered]));
  } catch {
    // Route publication remains successful even if browser storage is unavailable.
  }
}

export function removeCachedUserRoute(userId, routeId) {
  try {
    const routes = getCachedUserRoutes(userId).filter(
      (route) => String(route.id ?? route.ruta_id) !== String(routeId),
    );
    localStorage.setItem(`${ROUTE_CACHE_PREFIX}${userId}`, JSON.stringify(routes));
  } catch {
    // The server/database operation remains authoritative if browser storage is unavailable.
  }
}

export async function deleteUserRoute(routeId, userId) {
  try {
    await request(`/api/v1/rutas/${encodeURIComponent(routeId)}`, { method: "DELETE" });
  } catch (error) {
    if (!canUseSupabaseFallback(error)) throw error;

    const { error: routeError } = await supabase
      .from("rutas")
      .delete()
      .eq("id", routeId)
      .eq("usuario_id", userId);
    if (routeError) {
      throw new Error(`Render no tiene habilitado el borrado. Supabase rechazó eliminar la ruta: ${routeError.message}`);
    }

    const remainingRoutes = await getUserRoutes(userId);
    if (remainingRoutes.some((route) => String(route.id ?? route.ruta_id) === String(routeId))) {
      throw new Error("No se eliminó la ruta. Revisa la política RLS DELETE para permitir que cada usuario elimine sus propias rutas.");
    }
  }

  removeCachedUserRoute(userId, routeId);
}

export async function getRoutePoints(routeId) {
  let data;
  try {
    data = await request(`/api/v1/rutas/${encodeURIComponent(routeId)}/puntos`);
  } catch (error) {
    if (!canUseSupabaseFallback(error)) throw error;
    const { data: savedPoints, error: queryError } = await supabase
      .from("ruta_puntos")
      .select("*")
      .eq("ruta_id", routeId)
      .order("orden", { ascending: true });
    if (queryError) {
      throw new Error(`Render no pudo leer las paradas y Supabase rechazó la consulta: ${queryError.message}`);
    }
    if (!savedPoints?.length) {
      throw new Error("No se pudieron recuperar las paradas. Verifica la policy SELECT de ruta_puntos.");
    }
    return savedPoints;
  }
  return [data, data?.puntos, data?.points, data?.data, data?.data?.puntos, data?.data?.points]
    .find(Array.isArray) ?? [];
}
