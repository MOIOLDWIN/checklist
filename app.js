(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const sb = window.sb;

  const visibleCountEl = $("#visibleCount");
  const btnNew = $("#btnNew");
  const btnEmptyNew = $("#btnEmptyNew");
  const btnExport = $("#btnExport");
  const btnSave = $("#btnSave");
  const fab = $("#fab");

  const searchInput = $("#searchInput");
  const statusSelect = $("#statusSelect");
  const orderSelect = $("#orderSelect");

  const feedbackEl = $("#feedback");
  const gridEl = $("#plansGrid");
  const emptyEl = $("#emptyState");

  const modalEl = $("#modal");
  const modalTitleEl = $("#modalTitle");
  const modalEyebrowEl = $("#modalEyebrow");
  const btnModalClose = $("#btnModalClose");
  const btnCancel = $("#btnCancel");

  const formEl = $("#planForm");
  const titleInput = $("#titleInput");
  const dateInput = $("#dateInput");
  const timeInput = $("#timeInput");
  const statusInput = $("#statusInput");
  const descInput = $("#descInput");

  const cardTpl = $("#cardTemplate");

  let plans = [];
  let editingId = null;
  let lastFeedbackTimer = null;

  const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  const isoNow = () => new Date().toISOString();

  function normalizeTime(t) {
    if (!t) return "";
    return String(t).slice(0, 5);
  }

  function formatDate(yyyyMmDd) {
    if (!yyyyMmDd) return "";
    const [y, m, d] = yyyyMmDd.split("-").map(Number);
    if (!y || !m || !d) return yyyyMmDd;
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  }

  function toDisplayDateTime(plan) {
    const hasDate = !!plan.date;
    const hasTime = !!plan.time;
    if (!hasDate && !hasTime) return "Sin fecha";
    if (!hasDate && hasTime) return `Sin fecha · ${normalizeTime(plan.time)}`;
    if (hasDate && !hasTime) return formatDate(plan.date);
    return `${formatDate(plan.date)} · ${normalizeTime(plan.time)}`;
  }

  function formatUpdated(updatedAt) {
    const ts = updatedAt ? Date.parse(updatedAt) : Date.now();
    const diff = Math.max(0, Date.now() - ts);
    const min = Math.floor(diff / 60000);
    if (min < 1) return "Actualizado: ahora";
    if (min < 60) return `Actualizado: hace ${min} min`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `Actualizado: hace ${hrs} h`;
    const days = Math.floor(hrs / 24);
    return `Actualizado: hace ${days} d`;
  }

  function plannedSortKey(plan) {
    if (plan.date) {
      const t = plan.time ? normalizeTime(plan.time) : "23:59";
      return Date.parse(`${plan.date}T${t}:00`);
    }
    return plan.updated_at ? Date.parse(plan.updated_at) : 0;
  }

  function showFeedback(message, type = "success") {
    clearTimeout(lastFeedbackTimer);
    feedbackEl.textContent = message || "";
    feedbackEl.classList.remove("is-success", "is-error");
    if (!message) return;

    feedbackEl.classList.add(type === "error" ? "is-error" : "is-success");
    lastFeedbackTimer = setTimeout(() => {
      feedbackEl.textContent = "";
      feedbackEl.classList.remove("is-success", "is-error");
    }, 2200);
  }

  function openModal(mode) {
    modalEl.classList.add("is-open");
    modalEl.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    modalEyebrowEl.textContent = "My Plans";
    modalTitleEl.textContent = mode === "edit" ? "Editar Plan" : "Nuevo Plan";

    setTimeout(() => titleInput.focus(), 0);
  }

  function closeModal() {
    modalEl.classList.remove("is-open");
    modalEl.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    editingId = null;
    formEl.reset();
    statusInput.value = "planned";
    titleInput.setCustomValidity("");
  }

  function getFilters() {
    return {
      q: searchInput.value.trim().toLowerCase(),
      status: statusSelect.value,
      order: orderSelect.value
    };
  }

  function applyFiltersAndSort() {
    const { q, status, order } = getFilters();
    let filtered = plans.slice();

    if (status !== "all") filtered = filtered.filter(p => p.status === status);

    if (q) {
      filtered = filtered.filter(p => {
        const hay = `${p.title} ${p.description || ""}`.toLowerCase();
        return hay.includes(q);
      });
    }

    filtered.sort((a, b) => {
      const ka = plannedSortKey(a);
      const kb = plannedSortKey(b);
      return order === "asc" ? (ka - kb) : (kb - ka);
    });

    return filtered;
  }

  function render() {
    const list = applyFiltersAndSort();
    visibleCountEl.textContent = String(list.length);

    gridEl.innerHTML = "";
    if (list.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    const frag = document.createDocumentFragment();
    for (const plan of list) frag.appendChild(renderCard(plan));
    gridEl.appendChild(frag);
  }

  function renderCard(plan) {
    const node = cardTpl.content.firstElementChild.cloneNode(true);

    const titleEl = $(".card__title", node);
    const badgeEl = $("[data-badge]", node);
    const dtEl = $("[data-datetime]", node);
    const updatedEl = $("[data-updated]", node);
    const descEl = $("[data-desc]", node);

    titleEl.textContent = plan.title;

    badgeEl.textContent = plan.status;
    badgeEl.classList.remove("badge--planned", "badge--completed", "badge--canceled");
    badgeEl.classList.add(`badge--${plan.status}`);

    dtEl.textContent = toDisplayDateTime(plan);
    updatedEl.textContent = formatUpdated(plan.updated_at);

    descEl.textContent = plan.description?.trim() ? plan.description.trim() : "Sin descripción";

    $$("button[data-action]", node).forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        if (action === "edit") onEdit(plan.id);
        if (action === "complete") onComplete(plan.id);
        if (action === "delete") onDelete(plan.id);
      });
    });

    return node;
  }

  function validateTitle() {
    const v = titleInput.value.trim();
    if (v.length < 3) {
      titleInput.setCustomValidity("El título debe tener al menos 3 caracteres.");
      return false;
    }
    titleInput.setCustomValidity("");
    return true;
  }

  async function loadPlans() {
    try {
      const { data, error } = await sb
        .from("plans")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) throw error;

      plans = (data || []).map(p => ({ ...p, time: normalizeTime(p.time) }));
      render();
      showFeedback("Listo", "success");
    } catch (e) {
      console.error(e);
      plans = [];
      render();
      showFeedback("Error cargando planes", "error");
    }
  }

  const created = await createPlan({
  title, date, time, status, description
});

  async function updatePlan(id, patch) {
    const { data, error } = await sb
      .from("plans")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  async function deletePlan(id) {
    const { error } = await sb.from("plans").delete().eq("id", id);
    if (error) throw error;
  }

  function onNew() {
    editingId = null;
    formEl.reset();
    statusInput.value = "planned";
    openModal("new");
  }

  function onEdit(id) {
    const plan = plans.find(p => p.id === id);
    if (!plan) return;

    editingId = id;
    titleInput.value = plan.title || "";
    dateInput.value = plan.date || "";
    timeInput.value = plan.time || "";
    statusInput.value = plan.status || "planned";
    descInput.value = plan.description || "";

    openModal("edit");
  }

  async function onComplete(id) {
    const plan = plans.find(p => p.id === id);
    if (!plan) return;

    if (plan.status === "completed") {
      showFeedback("Ya está en Completed");
      return;
    }

    try {
      const updated = await updatePlan(id, { status: "completed", updated_at: isoNow() });
      plans = plans.map(p => (p.id === id ? { ...updated, time: normalizeTime(updated.time) } : p));
      showFeedback("Marcado como Completed");
      render();
    } catch (e) {
      console.error(e);
      showFeedback("Error al completar", "error");
    }
  }

  async function onDelete(id) {
    const plan = plans.find(p => p.id === id);
    if (!plan) return;

    const ok = confirm(`Eliminar "${plan.title}"?`);
    if (!ok) return;

    try {
      await deletePlan(id);
      plans = plans.filter(p => p.id !== id);
      showFeedback("Eliminado");
      render();
    } catch (e) {
      console.error(e);
      showFeedback("Error al eliminar", "error");
    }
  }

  btnNew.addEventListener("click", onNew);
  btnEmptyNew.addEventListener("click", onNew);
  fab.addEventListener("click", onNew);

  btnExport.addEventListener("click", () => showFeedback("Exportar listo (UI)"));
  btnSave.addEventListener("click", () => showFeedback("Cambios guardados", "success"));

  searchInput.addEventListener("input", render);
  statusSelect.addEventListener("change", render);
  orderSelect.addEventListener("change", render);

  titleInput.addEventListener("input", validateTitle);

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateTitle()) {
      showFeedback("Revisa el título", "error");
      titleInput.reportValidity();
      return;
    }

    const title = titleInput.value.trim();
    const date = dateInput.value || null;
    const time = timeInput.value || null;
    const status = statusInput.value || "planned";
    const description = (descInput.value || "").trim() || null;

    try {
      if (editingId) {
        const updated = await updatePlan(editingId, {
          title, date, time, status, description,
          updated_at: isoNow()
        });
        plans = plans.map(p => (p.id === editingId ? { ...updated, time: normalizeTime(updated.time) } : p));
        showFeedback("Actualizado");
      } else {
        const created = await createPlan({
          id: uid(),
          title, date, time, status, description,
          created_at: isoNow(),
          updated_at: isoNow()
        });
        plans = [{ ...created, time: normalizeTime(created.time) }, ...plans];
        showFeedback("Creado");
      }

      closeModal();
      render();
    } catch (e2) {
      console.error(e2);
      showFeedback("Error guardando", "error");
    }
  });

  btnCancel.addEventListener("click", closeModal);
  btnModalClose.addEventListener("click", closeModal);

  modalEl.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.matches("[data-close='true']")) closeModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalEl.classList.contains("is-open")) closeModal();
  });

  if (!sb) {
    showFeedback("Falta inicializar el cliente", "error");
    render();
  } else {
    loadPlans();
  }
})();
