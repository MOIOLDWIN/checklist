/* Estado central de planes */
let plans = [];

const state = {
  search: "",
  status: "all",
  sort: "desc",
  editingId: null,
};

const STORAGE_KEY = "myplans-data";
const VALID_STATUSES = new Set(["planned", "completed", "canceled"]);

const els = {
  plansList: document.getElementById("plansList"),
  emptyState: document.getElementById("emptyState"),
  planCounter: document.getElementById("planCounter"),
  newPlanBtn: document.getElementById("newPlanBtn"),
  mobileNewPlanBtn: document.getElementById("mobileNewPlanBtn"),
  exportBtn: document.getElementById("exportBtn"),
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

init();

async function init() {
  bindEvents();
  const loadedFromLocal = loadFromLocalStorage();

  if (!loadedFromLocal) {
    await loadFromResourceFile();
  }

  renderPlans();
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

  els.exportBtn.addEventListener("click", exportPlans);
}

function generateId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `plan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeText(value = "") {
  const str = String(value);
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizePlan(input = {}) {
  const nowIso = new Date().toISOString();
  const status = VALID_STATUSES.has(input.status) ? input.status : "planned";

  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : generateId(),
    title: typeof input.title === "string" ? input.title.trim() : "",
    date: typeof input.date === "string" ? input.date.trim() : "",
    time: typeof input.time === "string" ? input.time.trim() : "",
    description: typeof input.description === "string" ? input.description.trim() : "",
    status,
    createdAt:
      typeof input.createdAt === "string" && !Number.isNaN(Date.parse(input.createdAt))
        ? input.createdAt
        : nowIso,
    updatedAt:
      typeof input.updatedAt === "string" && !Number.isNaN(Date.parse(input.updatedAt))
        ? input.updatedAt
        : nowIso,
  };
}

function parseTxtToPlans(text) {
  if (typeof text !== "string" || !text.trim()) return [];

  const blocks = text
    .split(/\n-{3,}\n/g)
    .map((item) => item.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const plan = {};
      const lines = block.split("\n");

      for (const line of lines) {
        const idx = line.indexOf(":");
        if (idx < 1) continue;

        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!key) continue;
        plan[key] = value;
      }

      return normalizePlan(plan);
    })
    .filter((plan) => plan.title.length >= 3);
}

function serializePlansToTxt(currentPlans) {
  if (!Array.isArray(currentPlans)) return "";

  return currentPlans
    .map((plan) => {
      const safePlan = normalizePlan(plan);
      return [
        `id: ${safePlan.id}`,
        `title: ${safePlan.title}`,
        `date: ${safePlan.date}`,
        `time: ${safePlan.time}`,
        `description: ${safePlan.description.replace(/\n/g, " ")}`,
        `status: ${safePlan.status}`,
        `createdAt: ${safePlan.createdAt}`,
        `updatedAt: ${safePlan.updatedAt}`,
      ].join("\n");
    })
    .join("\n---\n");
}

async function loadFromResourceFile() {
  try {
    const response = await fetch("resources/plans.txt");
    if (!response.ok) throw new Error("load failed");
    const text = await response.text();
    plans = parseTxtToPlans(text);
    persistToLocalStorage();
  } catch {
    plans = [];
  }
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return false;
    plans = parsed.map((plan) => normalizePlan(plan)).filter((plan) => plan.title.length >= 3);
    return true;
  } catch {
    return false;
  }
}

function persistToLocalStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
}

function getFilteredAndSortedPlans() {
  const query = state.search;

  return plans
    .filter((plan) => {
      const matchesStatus = state.status === "all" || plan.status === state.status;
      const title = plan.title.toLowerCase();
      const description = plan.description.toLowerCase();
      const matchesSearch = !query || title.includes(query) || description.includes(query);
      return matchesStatus && matchesSearch;
    })
    .sort((a, b) => {
      const dateA = buildDateValue(a);
      const dateB = buildDateValue(b);
      return state.sort === "asc" ? dateA - dateB : dateB - dateA;
    });
}

function buildDateValue(plan) {
  if (plan.date) {
    const composed = `${plan.date}T${plan.time || "00:00"}`;
    const timestamp = Date.parse(composed);
    if (!Number.isNaN(timestamp)) return timestamp;
  }

  const updatedTimestamp = Date.parse(plan.updatedAt);
  return Number.isNaN(updatedTimestamp) ? 0 : updatedTimestamp;
}

function getBadgeLabel(status) {
  if (status === "completed") return "Completed";
  if (status === "canceled") return "Canceled";
  return "Planned";
}

function renderPlans() {
  const visiblePlans = getFilteredAndSortedPlans();
  els.planCounter.textContent = `${visiblePlans.length} ${visiblePlans.length === 1 ? "plan" : "planes"}`;

  els.plansList.innerHTML = visiblePlans
    .map((plan) => {
      const title = sanitizeText(plan.title);
      const description = sanitizeText(plan.description || "Sin descripción");
      const dateInfo = plan.date
        ? `${sanitizeText(plan.date)}${plan.time ? ` · ${sanitizeText(plan.time)}` : ""}`
        : "Sin fecha";

      return `
      <article class="plan-card" data-id="${sanitizeText(plan.id)}">
        <div class="card-head">
          <div>
            <h3 class="plan-title">${title}</h3>
            <div class="plan-date">${dateInfo}</div>
          </div>
          <span class="badge badge-${sanitizeText(plan.status)}">${getBadgeLabel(plan.status)}</span>
        </div>
        <p class="plan-description">${description}</p>
        <div class="card-actions">
          <button class="btn btn-soft" data-action="edit" type="button">Editar</button>
          <button class="btn btn-primary" data-action="complete" type="button">Completar</button>
          <button class="btn btn-danger" data-action="delete" type="button">Eliminar</button>
        </div>
      </article>`;
    })
    .join("");

  els.emptyState.classList.toggle("hidden", visiblePlans.length > 0);

  els.plansList.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", handleCardAction);
  });
}

function handleCardAction(event) {
  const action = event.currentTarget.dataset.action;
  const card = event.currentTarget.closest(".plan-card");
  if (!card) return;

  const planId = card.dataset.id;
  const plan = plans.find((item) => item.id === planId);
  if (!plan) return;

  if (action === "edit") {
    openModal(plan);
    return;
  }

  if (action === "complete") {
    plan.status = "completed";
    plan.updatedAt = new Date().toISOString();
    persistToLocalStorage();
    renderPlans();
    return;
  }

  if (action === "delete") {
    plans = plans.filter((item) => item.id !== planId);
    persistToLocalStorage();
    renderPlans();
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

function handleFormSubmit(event) {
  event.preventDefault();
  if (!validateForm()) return;

  const now = new Date().toISOString();
  const payload = {
    id: els.planId.value || generateId(),
    title: els.titleInput.value.trim(),
    date: els.dateInput.value.trim(),
    time: els.timeInput.value.trim(),
    description: els.descriptionInput.value.trim(),
    status: els.statusInput.value,
    updatedAt: now,
  };

  if (state.editingId) {
    plans = plans.map((plan) => {
      if (plan.id !== state.editingId) return plan;
      return normalizePlan({ ...plan, ...payload, createdAt: plan.createdAt, updatedAt: now });
    });
  } else {
    plans.unshift(normalizePlan({ ...payload, createdAt: now, updatedAt: now }));
  }

  persistToLocalStorage();
  renderPlans();
  closeModal();
}

function exportPlans() {
  const text = serializePlansToTxt(plans);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "my-plans-export.txt";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
