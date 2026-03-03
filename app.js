let plans = [];

const state = { search: "", status: "all", sort: "desc", editingId: null };
const STORAGE_KEY = "myplans-data";
const VALID_STATUSES = new Set(["planned", "completed", "canceled"]);

const REMOTE_CONFIG = {
  owner: "MOIOLDWIN",
  repo: "checklist",
  branch: "main",
  path: "resources/plans.txt",
  // Reemplazar por token real con permisos de contenido para habilitar guardado compartido.
  token: "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",
};

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

init();

async function init() {
  bindEvents();

  // Prioriza siempre el archivo remoto compartido.
  const loadedRemote = await loadPlansFromGithub();

  if (!loadedRemote) {
    const loadedLocal = loadFromLocalStorage();
    if (!loadedLocal) {
      await loadFromResourceFile();
    }
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
  els.syncBtn.addEventListener("click", savePlansToGithub);
}

function setSyncMessage(msg, isError = false) {
  els.syncMessage.textContent = msg;
  els.syncMessage.style.color = isError ? "#8f3d3d" : "#4f6f5f";
}

function generateId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `plan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : generateId(),
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

function parseTxtToPlans(text) {
  if (typeof text !== "string" || !text.trim()) return [];

  return text
    .split(/\n-{3,}\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const plan = {};

      block.split("\n").forEach((line) => {
        const idx = line.indexOf(":");
        if (idx < 1) return;

        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key) plan[key] = value;
      });

      return normalizePlan(plan);
    })
    .filter((p) => p.title.length >= 3);
}

function serializePlansToTxt(items) {
  if (!Array.isArray(items)) return "";

  return items
    .map((plan) => {
      const p = normalizePlan(plan);
      return [
        `id: ${p.id}`,
        `title: ${p.title}`,
        `date: ${p.date}`,
        `time: ${p.time}`,
        `description: ${p.description.replace(/\n/g, " ")}`,
        `status: ${p.status}`,
        `createdAt: ${p.createdAt}`,
        `updatedAt: ${p.updatedAt}`,
      ].join("\n");
    })
    .join("\n---\n");
}

async function loadFromResourceFile() {
  try {
    const response = await fetch("resources/plans.txt");
    if (!response.ok) throw new Error();
    plans = parseTxtToPlans(await response.text());
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
    plans = parsed.map(normalizePlan).filter((p) => p.title.length >= 3);
    return true;
  } catch {
    return false;
  }
}

function persistToLocalStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
}

async function githubGetFile() {
  const url = `https://api.github.com/repos/${REMOTE_CONFIG.owner}/${REMOTE_CONFIG.repo}/contents/${REMOTE_CONFIG.path}?ref=${REMOTE_CONFIG.branch}`;
  const headers = REMOTE_CONFIG.token ? { Authorization: `Bearer ${REMOTE_CONFIG.token}` } : {};

  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error("No se pudo sincronizar ahora.");

  const data = await response.json();
  const content = data.content ? atob(data.content.replace(/\n/g, "")) : "";
  return { sha: data.sha, content };
}

async function loadPlansFromGithub() {
  try {
    const { content } = await githubGetFile();
    plans = parseTxtToPlans(content);
    persistToLocalStorage();
    setSyncMessage("Datos sincronizados.");
    return true;
  } catch {
    setSyncMessage("Se cargó tu copia local.", true);
    return false;
  }
}

async function savePlansToGithub() {
  if (!REMOTE_CONFIG.token) {
    setSyncMessage("Guardado online no disponible en este momento.", true);
    return;
  }

  try {
    const current = await githubGetFile();
    const content = serializePlansToTxt(plans);
    const url = `https://api.github.com/repos/${REMOTE_CONFIG.owner}/${REMOTE_CONFIG.repo}/contents/${REMOTE_CONFIG.path}`;

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${REMOTE_CONFIG.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Update plans from My Plans",
        content: btoa(unescape(encodeURIComponent(content))),
        sha: current.sha,
        branch: REMOTE_CONFIG.branch,
      }),
    });

    if (!response.ok) throw new Error();
    setSyncMessage("Cambios guardados correctamente.");
  } catch {
    setSyncMessage("No fue posible guardar ahora.", true);
  }
}

function getFilteredAndSortedPlans() {
  return plans
    .filter((plan) => {
      const matchesStatus = state.status === "all" || plan.status === state.status;
      const q = state.search;
      const matchesSearch =
        !q || plan.title.toLowerCase().includes(q) || plan.description.toLowerCase().includes(q);
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

function handleCardAction(event) {
  const action = event.currentTarget.dataset.action;
  const card = event.currentTarget.closest(".plan-card");
  if (!card) return;

  const id = card.dataset.id;
  const plan = plans.find((item) => item.id === id);
  if (!plan) return;

  if (action === "edit") return openModal(plan);

  if (action === "complete") {
    plan.status = "completed";
    plan.updatedAt = new Date().toISOString();
    persistToLocalStorage();
    return renderPlans();
  }

  if (action === "delete") {
    plans = plans.filter((item) => item.id !== id);
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
    plans = plans.map((plan) =>
      plan.id !== state.editingId
        ? plan
        : normalizePlan({ ...plan, ...payload, createdAt: plan.createdAt, updatedAt: now })
    );
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
