/* =========================================================
   My Plans — Supabase (NO LOGIN) + Realtime + CRUD
   Requiere en index.html:
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   <script> window.sb = supabase.createClient(SUPABASE_URL, ANON_KEY); </script>
   <script src="app.js"></script>
========================================================= */

let plans = [];

const state = { search: "", status: "all", sort: "desc", editingId: null };
const STORAGE_KEY = "myplans-data";
const VALID_STATUSES = new Set(["planned", "completed", "canceled"]);

const els = {
  plansList: document.getElementById("plansList"),
  emptyState: document.getElementById("emptyState"),
  planCounter: document.getElementById("planCounter"),
  syncMessage: document.getElementById("syncMessage"),
  newPlanBtn: document.getElementById("newPlanBtn"),
  mobileNewPlanBtn: document.getElementById("mobileNewPlanBtn"),
  exportBtn: document.getElementById("exportBtn"),
  syncBtn: document.getElementById("syncBtn"),
  searchInput: document.getElementById("searchInput"),
  statusFilter: document.getElementById("statusFilter"),
  sortByDate: document.getElementById("sortByDate"),
  modalBackdrop: document.getElementById("planModalBackdrop"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  cancelFormBtn: document.getElementById("cancelFormBtn"),
  modalTitle: document.getElementById("modalTitle"),
  planForm: document.getElementById("planForm"),
  planId: document.getElementById("planId"),
  titleInput: document.getElementById("titleInput"),
  dateInput: document.getElementById("dateInput"),
  timeInput: document.getElementById("timeInput"),
  descriptionInput: document.getElementById("descriptionInput"),
  statusInput: document.getElementById("statusInput"),
  titleError: document.getElementById("titleError"),
};

const sb = window.sb; // supabase client from HTML
let realtimeChannel = null;
let isRealtimeReady = false;

init();

async function init() {
  bindEvents();

  if (!sb) {
    setSyncMessage("Supabase no está configurado (window.sb no existe).", true);
    // Igual carga local para que no se rompa.
    const loadedLocal = loadFromLocalStorage();
    if (!loadedLocal) plans = [];
    renderPlans();
    return;
  }

  // 1) intenta cargar desde Supabase
  const loadedRemote = await loadPlansFromSupabase();
  if (!loadedRemote) {
    // 2) si falla, local
    const loadedLocal = loadFromLocalStorage();
    if (!loadedLocal) plans = [];
  }

  renderPlans();

  // 3) suscripción realtime
  subscribeRealtime();
}

function bindEvents() {
  els.newPlanBtn.addEventListener("click", () => openModal());
  els.mobileNewPlanBtn.addEventListener("click", () => openModal());
  els.closeModalBtn.addEventListener("click", closeModal);
  els.cancelFormBtn.addEventListener("click", closeModal);

  els.modalBackdrop.addEventListener("click", (event) => {
    if (event.target === els.modalBackdrop) closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.modalBackdrop.classList.contains("hidden")) {
      closeModal();
    }
  });

  els.planForm.addEventListener("submit", handleFormSubmit);

  els.searchInput.addEventListener("input", () => {
    state.search = els.searchInput.value.trim().toLowerCase();
    renderPlans();
  });

  els.statusFilter.addEventListener("change", () => {
    state.status = els.statusFilter.value;
    renderPlans();
  });

  els.sortByDate.addEventListener("change", () => {
    state.sort = els.sortByDate.value;
    renderPlans();
  });

  // Exportar: ahora exporta JSON (por si quieres backup local)
  els.exportBtn.addEventListener("click", exportPlans);

  // “Guardar cambios”: en Supabase se guarda automático.
  // Este botón lo usaremos como “Refrescar ahora”.
  els.syncBtn.addEventListener("click", async () => {
    await loadPlansFromSupabase(true);
    renderPlans();
  });
}

function setSyncMessage(msg, isError = false) {
  if (!els.syncMessage) return;
  els.syncMessage.textContent = msg;
  els.syncMessage.style.color = isError ? "#8f3d3d" : "#4f6f5f";
}

function sanitizeText(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizePlan(input = {}) {
  const now = new Date().toISOString();
  const status = VALID_STATUSES.has(input.status) ? input.status : "planned";

  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : cryptoId(),
    title: typeof input.title === "string" ? input.title.trim() : "",
    date: typeof input.date === "string" ? input.date.trim() : "",
    time: typeof input.time === "string" ? input.time.trim() : "",
    description: typeof input.description === "string" ? input.description.trim() : "",
    status,
    createdAt:
      typeof input.createdAt === "string" && !Number.isNaN(Date.parse(input.createdAt))
        ? input.createdAt
        : now,
    updatedAt:
      typeof input.updatedAt === "string" && !Number.isNaN(Date.parse(input.updatedAt))
        ? input.updatedAt
        : now,
  };
}

function cryptoId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `plan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function persistToLocalStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return false;
    plans = parsed.map(normalizePlan).filter((p) => p.title.length >= 3);
    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   Supabase helpers
========================================================= */

function rowToPlan(row) {
  return normalizePlan({
    id: row.id,
    title: row.title,
    date: row.date ?? "",
    time: row.time ?? "",
    description: row.description ?? "",
    status: row.status ?? "planned",
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  });
}

function planToRow(plan) {
  const p = normalizePlan(plan);

  // Supabase columns:
  // id uuid, title text, date date, time time, description text, status text
  // created_at timestamptz, updated_at timestamptz
  return {
    id: p.id, // si es uuid válido, perfecto; si no, Supabase puede rechazarlo. Mejor dejar que Supabase cree el id.
    title: p.title,
    date: p.date ? p.date : null,
    time: p.time ? p.time : null,
    description: p.description ? p.description : null,
    status: p.status,
    updated_at: new Date().toISOString(),
  };
}

async function loadPlansFromSupabase(showMessage = false) {
  try {
    const { data, error } = await sb
      .from("plans")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    plans = (data || []).map(rowToPlan).filter((p) => p.title.length >= 3);
    persistToLocalStorage();

    if (showMessage) setSyncMessage("Actualizado desde la nube.");
    else setSyncMessage("Datos sincronizados.");
    return true;
  } catch (err) {
    setSyncMessage(`No se pudo cargar desde la nube: ${err.message}`, true);
    return false;
  }
}

async function createPlanSupabase(plan) {
  // Deja que Supabase genere el UUID si no quieres depender de randomUUID.
  // Si quieres usar tu id local, asegúrate que sea uuid válido. Aquí: si no parece uuid, lo quitamos.
  const p = normalizePlan(plan);
  const looksUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    p.id
  );

  const payload = {
    title: p.title,
    date: p.date || null,
    time: p.time || null,
    description: p.description || null,
    status: p.status,
    updated_at: new Date().toISOString(),
  };

  if (looksUuid) payload.id = p.id;

  const { data, error } = await sb.from("plans").insert(payload).select("*").single();
  if (error) throw error;
  return rowToPlan(data);
}

async function updatePlanSupabase(id, changes) {
  const payload = {
    title: typeof changes.title === "string" ? changes.title.trim() : undefined,
    date: changes.date ? changes.date : null,
    time: changes.time ? changes.time : null,
    description: typeof changes.description === "string" ? changes.description.trim() : null,
    status: changes.status && VALID_STATUSES.has(changes.status) ? changes.status : undefined,
    updated_at: new Date().toISOString(),
  };

  // elimina undefined para no pisar campos
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  const { data, error } = await sb.from("plans").update(payload).eq("id", id).select("*").single();
  if (error) throw error;
  return rowToPlan(data);
}

async function deletePlanSupabase(id) {
  const { error } = await sb.from("plans").delete().eq("id", id);
  if (error) throw error;
}

/* =========================================================
   Realtime
========================================================= */

function subscribeRealtime() {
  try {
    if (realtimeChannel) {
      sb.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }

    realtimeChannel = sb
      .channel("plans-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "plans" }, async () => {
        // Cuando alguien cambie algo, refresca lista.
        await loadPlansFromSupabase();
        renderPlans();
      })
      .subscribe((status) => {
        // statuses: SUBSCRIBED, TIMED_OUT, CHANNEL_ERROR, CLOSED
        if (status === "SUBSCRIBED") {
          isRealtimeReady = true;
          setSyncMessage("Realtime activo ✅");
        }
      });
  } catch (err) {
    setSyncMessage(`Realtime no disponible: ${err.message}`, true);
  }
}

/* =========================================================
   UI logic
========================================================= */

function getFilteredAndSortedPlans() {
  return plans
    .filter((plan) => {
      const matchesStatus = state.status === "all" || plan.status === state.status;
      const q = state.search;
      const matchesSearch =
        !q ||
        plan.title.toLowerCase().includes(q) ||
        plan.description.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    })
    .sort((a, b) =>
      state.sort === "asc"
        ? buildDateValue(a) - buildDateValue(b)
        : buildDateValue(b) - buildDateValue(a)
    );
}

function buildDateValue(plan) {
  if (plan.date) {
    const timestamp = Date.parse(`${plan.date}T${plan.time || "00:00"}`);
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  const updated = Date.parse(plan.updatedAt);
  return Number.isNaN(updated) ? 0 : updated;
}

function badgeLabel(status) {
  if (status === "completed") return "Completed";
  if (status === "canceled") return "Canceled";
  return "Planned";
}

function renderPlans() {
  const visible = getFilteredAndSortedPlans();
  els.planCounter.textContent = `${visible.length} ${visible.length === 1 ? "plan" : "planes"}`;

  els.plansList.innerHTML = visible
    .map(
      (plan) => `
    <article class="plan-card" data-id="${sanitizeText(plan.id)}">
      <div class="card-head">
        <div>
          <h3 class="plan-title">${sanitizeText(plan.title)}</h3>
          <div class="plan-date">${
            plan.date
              ? `${sanitizeText(plan.date)}${plan.time ? ` · ${sanitizeText(plan.time)}` : ""}`
              : "Sin fecha"
          }</div>
        </div>
        <span class="badge badge-${sanitizeText(plan.status)}">${badgeLabel(plan.status)}</span>
      </div>
      <p class="plan-description">${sanitizeText(plan.description || "Sin descripción")}</p>
      <div class="card-actions">
        <button class="btn btn-soft" data-action="edit" type="button">Editar</button>
        <button class="btn btn-primary" data-action="complete" type="button">Completar</button>
        <button class="btn btn-danger" data-action="delete" type="button">Eliminar</button>
      </div>
    </article>`
    )
    .join("");

  els.emptyState.classList.toggle("hidden", visible.length > 0);
  els.plansList
    .querySelectorAll("[data-action]")
    .forEach((button) => button.addEventListener("click", handleCardAction));
}

async function handleCardAction(event) {
  const action = event.currentTarget.dataset.action;
  const card = event.currentTarget.closest(".plan-card");
  if (!card) return;

  const id = card.dataset.id;
  const plan = plans.find((item) => item.id === id);
  if (!plan) return;

  if (action === "edit") return openModal(plan);

  if (action === "complete") {
    try {
      // Optimista
      plan.status = "completed";
      plan.updatedAt = new Date().toISOString();
      persistToLocalStorage();
      renderPlans();

      await updatePlanSupabase(id, { status: "completed" });
      setSyncMessage("Marcado como completado ✅");
    } catch (err) {
      setSyncMessage(`No se pudo completar: ${err.message}`, true);
      await loadPlansFromSupabase(true);
      renderPlans();
    }
    return;
  }

  if (action === "delete") {
    try {
      // Optimista
      plans = plans.filter((item) => item.id !== id);
      persistToLocalStorage();
      renderPlans();

      await deletePlanSupabase(id);
      setSyncMessage("Eliminado ✅");
    } catch (err) {
      setSyncMessage(`No se pudo eliminar: ${err.message}`, true);
      await loadPlansFromSupabase(true);
      renderPlans();
    }
  }
}

function openModal(plan = null) {
  state.editingId = plan?.id ?? null;
  els.modalTitle.textContent = state.editingId ? "Editar Plan" : "Nuevo Plan";
  els.planId.value = plan?.id ?? "";
  els.titleInput.value = plan?.title ?? "";
  els.dateInput.value = plan?.date ?? "";
  els.timeInput.value = plan?.time ?? "";
  els.descriptionInput.value = plan?.description ?? "";
  els.statusInput.value = plan?.status ?? "planned";
  els.titleError.textContent = "";
  els.modalBackdrop.classList.remove("hidden");
  els.modalBackdrop.setAttribute("aria-hidden", "false");
  els.titleInput.focus();
}

function closeModal() {
  els.modalBackdrop.classList.add("hidden");
  els.modalBackdrop.setAttribute("aria-hidden", "true");
  els.planForm.reset();
  els.titleError.textContent = "";
  state.editingId = null;
}

function validateForm() {
  const title = els.titleInput.value.trim();
  const date = els.dateInput.value.trim();

  if (!title || title.length < 3) {
    els.titleError.textContent = "El título debe tener al menos 3 caracteres.";
    return false;
  }

  if (date && Number.isNaN(Date.parse(`${date}T00:00:00`))) {
    els.titleError.textContent = "Ingresa una fecha válida.";
    return false;
  }

  els.titleError.textContent = "";
  return true;
}

async function handleFormSubmit(event) {
  event.preventDefault();
  if (!validateForm()) return;

  const now = new Date().toISOString();

  const payload = {
    id: els.planId.value || cryptoId(),
    title: els.titleInput.value.trim(),
    date: els.dateInput.value.trim(),
    time: els.timeInput.value.trim(),
    description: els.descriptionInput.value.trim(),
    status: els.statusInput.value,
    updatedAt: now,
  };

  // Optimista en UI
  if (state.editingId) {
    plans = plans.map((p) =>
      p.id !== state.editingId
        ? p
        : normalizePlan({ ...p, ...payload, createdAt: p.createdAt, updatedAt: now })
    );
  } else {
    plans.unshift(normalizePlan({ ...payload, createdAt: now, updatedAt: now }));
  }

  persistToLocalStorage();
  renderPlans();
  closeModal();

  // Persistencia en Supabase
  try {
    if (!sb) throw new Error("Supabase no está configurado.");

    if (state.editingId) {
      await updatePlanSupabase(state.editingId, {
        title: payload.title,
        date: payload.date,
        time: payload.time,
        description: payload.description,
        status: payload.status,
      });
      setSyncMessage("Actualizado ✅");
    } else {
      // Crear en Supabase y sincronizar ID real si Supabase generó uno distinto
      const created = await createPlanSupabase(payload);

      // Si Supabase generó ID diferente al optimista, reemplaza en array
      const idx = plans.findIndex((p) => p.id === payload.id);
      if (idx >= 0 && created.id !== payload.id) {
        plans[idx] = created;
        persistToLocalStorage();
        renderPlans();
      }
      setSyncMessage("Creado ✅");
    }
  } catch (err) {
    setSyncMessage(`No se pudo guardar en la nube: ${err.message}`, true);
    // Re-sync para evitar que quede desalineado
    await loadPlansFromSupabase(true);
    renderPlans();
  }
}

/* Exporta backup local (JSON) */
function exportPlans() {
  const blob = new Blob([JSON.stringify(plans, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "my-plans-backup.json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
