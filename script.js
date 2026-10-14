/* =========================================================
   TaskFlow — script.js
   Vanilla JavaScript. Works with index.html and style.css.
   ========================================================= */
"use strict";

/* ---------- 1. Constants & state ---------- */
const STORAGE_KEY = "taskflow.tasks";
const THEME_KEY = "taskflow.theme";

const PRIORITIES = ["high", "medium", "low"];
const CATEGORIES = ["study", "work", "personal", "shopping", "other"];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

const VIEW_TITLES = {
  dashboard: "All Tasks",
  all: "All Tasks",
  today: "Due Today",
  upcoming: "Upcoming",
  completed: "Completed",
  overdue: "Overdue",
};

// All task data lives here — the DOM is only a reflection of it.
const state = {
  tasks: [],
  view: "dashboard",
  filter: "all",
  category: "all",
  priority: "all",
  sort: "due",
  search: "",
  pendingDeleteId: null,
};

/* ---------- 2. DOM references ---------- */
const $ = (id) => document.getElementById(id);

const el = {
  root: document.documentElement,
  sidebar: $("sidebar"),
  sidebarToggle: $("sidebar-toggle"),
  navLinks: document.querySelectorAll(".nav-link"),
  currentDate: $("current-date"),
  searchForm: $("search-form"),
  searchInput: $("search-input"),
  themeToggle: $("theme-toggle"),
  addTaskBtn: $("add-task-btn"),
  emptyAddBtn: $("empty-add-btn"),

  statTotal: $("stat-total"),
  statCompleted: $("stat-completed"),
  statPending: $("stat-pending"),
  statOverdue: $("stat-overdue"),
  progressBar: $("progress-bar"),
  progressText: $("progress-text"),

  formSection: $("task-form-section"),
  formHeading: $("form-heading"),
  form: $("task-form"),
  taskId: $("task-id"),
  title: $("task-title"),
  titleError: $("task-title-error"),
  description: $("task-description"),
  category: $("task-category"),
  due: $("task-due"),
  saveBtn: $("save-task-btn"),
  cancelBtn: $("cancel-task-btn"),

  tasksHeading: $("tasks-heading"),
  filterButtons: document.querySelectorAll("[data-filter]"),
  filterCategory: $("filter-category"),
  filterPriority: $("filter-priority"),
  sortSelect: $("sort-select"),
  tasksCount: $("tasks-count"),
  taskList: $("task-list"),
  emptyState: $("empty-state"),
  template: $("task-template"),

  dialog: $("delete-dialog"),
  footerYear: $("footer-year"),
};

/* ---------- 3. Date helpers (date-only, local time, no timezone drift) ---------- */

// Today's date as "YYYY-MM-DD" in the user's local time.
function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Turn "YYYY-MM-DD" into a local Date (new Date("YYYY-MM-DD") would use UTC).
function parseDateKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return null;
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Readable label such as "Today", "Tomorrow" or "Mon, Oct 19".
function formatDue(key) {
  const date = parseDateKey(key);
  if (!date) return "";
  const today = parseDateKey(todayKey());
  const diffDays = Math.round((date - today) / 86400000);
  if (diffDays === 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";
  if (diffDays === -1) return "Due yesterday";
  const opts = { weekday: "short", month: "short", day: "numeric" };
  if (date.getFullYear() !== today.getFullYear()) opts.year = "numeric";
  return "Due " + date.toLocaleDateString(undefined, opts);
}

// "YYYY-MM-DD" strings compare correctly as plain strings.
const isDueToday = (t) => !t.completed && t.dueDate === todayKey();
const isUpcoming = (t) => !t.completed && !!t.dueDate && t.dueDate > todayKey();
const isOverdue = (t) => !t.completed && !!t.dueDate && t.dueDate < todayKey();

/* ---------- 4. Storage ---------- */

// Make sure a saved task has every field with a valid value.
function normalizeTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : createId(),
    title,
    description: typeof raw.description === "string" ? raw.description : "",
    priority: PRIORITIES.includes(raw.priority) ? raw.priority : "medium",
    category: CATEGORIES.includes(raw.category) ? raw.category : "other",
    dueDate: parseDateKey(raw.dueDate) ? raw.dueDate : "",
    completed: raw.completed === true,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    completedAt: raw.completed === true && Number.isFinite(raw.completedAt) ? raw.completedAt : null,
  };
}

function loadTasks() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(data)) return [];
    return data.map(normalizeTask).filter(Boolean);
  } catch (err) {
    console.warn("TaskFlow: saved tasks were unreadable and have been reset.", err);
    return [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
  } catch (err) {
    announce("Could not save tasks in this browser.");
  }
}

function createId() {
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------- 5. Accessible status messages ---------- */
const statusRegion = document.createElement("p");
statusRegion.className = "visually-hidden";
statusRegion.setAttribute("role", "status");
statusRegion.setAttribute("aria-live", "polite");
document.body.appendChild(statusRegion);

function announce(message) {
  statusRegion.textContent = "";
  // Small delay so screen readers notice a repeated message.
  setTimeout(() => { statusRegion.textContent = message; }, 50);
}

/* ---------- 6. Task actions ---------- */
function addTask(data) {
  const task = normalizeTask({ ...data, id: createId(), createdAt: Date.now(), completed: false });
  state.tasks.push(task);
  commit(`Task "${task.title}" added.`);
}

function updateTask(id, data) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  Object.assign(task, {
    title: data.title,
    description: data.description,
    priority: data.priority,
    category: data.category,
    dueDate: data.dueDate,
  });
  commit(`Task "${task.title}" updated.`);
}

function toggleTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  task.completedAt = task.completed ? Date.now() : null;
  commit(task.completed ? `"${task.title}" marked complete.` : `"${task.title}" marked active.`);
}

function deleteTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  state.tasks = state.tasks.filter((t) => t.id !== id);
  commit(`Task "${task.title}" deleted.`);
}

// Save, re-render and announce after every change.
function commit(message) {
  saveTasks();
  render();
  if (message) announce(message);
}

/* ---------- 7. Filtering & sorting ---------- */
function matchesView(task) {
  switch (state.view) {
    case "today": return isDueToday(task);
    case "upcoming": return isUpcoming(task);
    case "completed": return task.completed;
    case "overdue": return isOverdue(task);
    default: return true; // dashboard & all
  }
}

function matchesFilter(task) {
  switch (state.filter) {
    case "active": return !task.completed;
    case "completed": return task.completed;
    case "overdue": return isOverdue(task);
    default: return true;
  }
}

function matchesSearch(task) {
  const q = state.search.trim().toLowerCase();
  if (!q) return true;
  return task.title.toLowerCase().includes(q) || task.description.toLowerCase().includes(q);
}

function getVisibleTasks() {
  return state.tasks
    .filter((t) =>
      matchesView(t) &&
      matchesFilter(t) &&
      (state.category === "all" || t.category === state.category) &&
      (state.priority === "all" || t.priority === state.priority) &&
      matchesSearch(t)
    )
    .sort(compareTasks);
}

function compareTasks(a, b) {
  if (state.sort === "priority") {
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || compareDue(a, b);
  }
  if (state.sort === "recent") return b.createdAt - a.createdAt;
  return compareDue(a, b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

// Tasks with a due date come first (earliest first); undated tasks go last.
function compareDue(a, b) {
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return b.createdAt - a.createdAt;
}

/* ---------- 8. Rendering ---------- */
function render() {
  renderStats();
  renderTasks();
}

function renderStats() {
  const total = state.tasks.length;
  const completed = state.tasks.filter((t) => t.completed).length;
  const overdue = state.tasks.filter(isOverdue).length;
  const pending = total - completed;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  setText(el.statTotal, total);
  setText(el.statCompleted, completed);
  setText(el.statPending, pending);
  setText(el.statOverdue, overdue);
  setText(el.progressText, `${percent}%`);
  if (el.progressBar) {
    el.progressBar.value = percent;
    el.progressBar.textContent = `${percent}%`;
    el.progressBar.setAttribute("aria-valuenow", String(percent));
    el.progressBar.setAttribute("aria-valuetext", `${completed} of ${total} tasks completed`);
  }
}

function renderTasks() {
  if (!el.taskList || !el.template) return;
  const visible = getVisibleTasks();

  el.taskList.replaceChildren(...visible.map(createTaskElement));
  setText(el.tasksHeading, VIEW_TITLES[state.view] || "All Tasks");
  setText(el.tasksCount, `${visible.length} ${visible.length === 1 ? "task" : "tasks"}`);
  renderEmptyState(visible.length);
}

// Build one task card from the <template> using safe textContent.
function createTaskElement(task) {
  const item = el.template.content.firstElementChild.cloneNode(true);
  item.dataset.id = task.id;
  item.classList.toggle("is-completed", task.completed);
  item.classList.toggle("is-overdue", isOverdue(task));

  const checkbox = item.querySelector(".task-item__checkbox");
  checkbox.checked = task.completed;
  checkbox.setAttribute("aria-label", `Mark "${task.title}" as ${task.completed ? "active" : "complete"}`);

  item.querySelector(".task-item__title").textContent = task.title;
  item.querySelector(".task-item__description").textContent = task.description;

  const badge = item.querySelector(".task-item__priority");
  badge.textContent = `${task.priority} priority`;
  badge.classList.add(`badge--${task.priority}`);

  const tag = item.querySelector(".task-item__category");
  tag.textContent = task.category;
  tag.classList.add(`tag--${task.category}`);

  const due = item.querySelector(".task-item__due");
  due.textContent = formatDue(task.dueDate);
  due.setAttribute("datetime", task.dueDate);

  item.querySelector(".task-item__edit").setAttribute("aria-label", `Edit "${task.title}"`);
  item.querySelector(".task-item__delete").setAttribute("aria-label", `Delete "${task.title}"`);
  return item;
}

function renderEmptyState(count) {
  if (!el.emptyState) return;
  el.emptyState.hidden = count > 0;
  if (count > 0) return;

  const title = el.emptyState.querySelector(".empty-state__title");
  const text = el.emptyState.querySelector(".empty-state__text");
  const filtersOn =
    state.search.trim() || state.filter !== "all" || state.category !== "all" ||
    state.priority !== "all" || !["dashboard", "all"].includes(state.view);

  if (state.tasks.length === 0) {
    setText(title, "No tasks here yet");
    setText(text, "Add your first task to start getting things done.");
  } else if (filtersOn) {
    setText(title, "No matching tasks");
    setText(text, "Try a different search, filter or view.");
  }
}

function setText(node, value) {
  if (node) node.textContent = String(value);
}

/* ---------- 9. Task form ---------- */
function openForm(task) {
  if (!el.formSection || !el.form) return;
  el.form.reset();
  hideTitleError();

  if (task) {
    el.taskId.value = task.id;
    el.title.value = task.title;
    el.description.value = task.description;
    el.category.value = task.category;
    el.due.value = task.dueDate;
    const radio = el.form.querySelector(`input[name="priority"][value="${task.priority}"]`);
    if (radio) radio.checked = true;
    setText(el.formHeading, "Edit Task");
    setText(el.saveBtn, "Update Task");
  } else {
    el.taskId.value = "";
    setText(el.formHeading, "Add Task");
    setText(el.saveBtn, "Save Task");
  }

  el.formSection.hidden = false;
  if (el.addTaskBtn) el.addTaskBtn.setAttribute("aria-expanded", "true");
  el.formSection.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  el.title.focus({ preventScroll: true });
}

function closeForm() {
  if (!el.formSection) return;
  el.formSection.hidden = true;
  el.form.reset();
  el.taskId.value = "";
  hideTitleError();
  if (el.addTaskBtn) {
    el.addTaskBtn.setAttribute("aria-expanded", "false");
    el.addTaskBtn.focus();
  }
}

function showTitleError() {
  el.title.setAttribute("aria-invalid", "true");
  if (el.titleError) el.titleError.hidden = false;
  el.title.focus();
}

function hideTitleError() {
  if (!el.title) return;
  el.title.removeAttribute("aria-invalid");
  if (el.titleError) el.titleError.hidden = true;
}

function readForm() {
  const priorityInput = el.form.querySelector('input[name="priority"]:checked');
  return {
    title: el.title.value.trim(),
    description: el.description.value.trim(),
    priority: priorityInput ? priorityInput.value : "medium",
    category: el.category.value,
    dueDate: el.due.value,
  };
}

function handleFormSubmit(event) {
  event.preventDefault(); // stop the page from reloading
  const data = readForm();
  if (!data.title) {
    showTitleError();
    return;
  }
  const id = el.taskId.value;
  if (id) updateTask(id, data);
  else addTask(data);
  closeForm();
}

/* ---------- 10. Delete dialog ---------- */
function askDelete(id) {
  state.pendingDeleteId = id;
  if (el.dialog && typeof el.dialog.showModal === "function") {
    el.dialog.showModal();
  } else if (window.confirm("Delete this task? This cannot be undone.")) {
    deleteTask(id);
    state.pendingDeleteId = null;
  }
}

// Runs whenever the dialog closes (Cancel, Delete or Escape).
function handleDialogClose() {
  if (el.dialog.returnValue === "confirm" && state.pendingDeleteId) {
    deleteTask(state.pendingDeleteId);
  }
  state.pendingDeleteId = null;
  el.dialog.returnValue = "";
}

/* ---------- 11. Navigation & filters ---------- */
function setView(view) {
  if (!VIEW_TITLES[view]) view = "dashboard";
  state.view = view;
  el.navLinks.forEach((link) => {
    const active = link.dataset.view === view;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  renderTasks();
}

function setFilter(filter) {
  state.filter = filter;
  el.filterButtons.forEach((btn) => {
    const active = btn.dataset.filter === filter;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  renderTasks();
}

function handleNavClick(event) {
  const link = event.target.closest(".nav-link");
  if (!link) return;
  event.preventDefault();
  setView(link.dataset.view);
  history.replaceState(null, "", `#${link.dataset.view}`);
  closeSidebar();
  const target = link.dataset.view === "dashboard" ? $("dashboard") : $("tasks-section");
  if (target) target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

/* ---------- 12. Sidebar (mobile) ---------- */
function openSidebar() {
  if (!el.sidebar) return;
  el.sidebar.classList.add("is-open");
  el.sidebarToggle?.setAttribute("aria-expanded", "true");
  el.sidebarToggle?.setAttribute("aria-label", "Close navigation menu");
}

function closeSidebar() {
  if (!el.sidebar || !el.sidebar.classList.contains("is-open")) return;
  el.sidebar.classList.remove("is-open");
  el.sidebarToggle?.setAttribute("aria-expanded", "false");
  el.sidebarToggle?.setAttribute("aria-label", "Open navigation menu");
}

function toggleSidebar() {
  if (el.sidebar?.classList.contains("is-open")) closeSidebar();
  else openSidebar();
}

/* ---------- 13. Theme ---------- */
function applyTheme(theme) {
  const dark = theme === "dark";
  el.root.classList.toggle("dark", dark);
  el.root.dataset.theme = dark ? "dark" : "light";
  if (el.themeToggle) {
    el.themeToggle.textContent = dark ? "☀️" : "🌙";
    el.themeToggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    el.themeToggle.setAttribute("aria-pressed", String(dark));
  }
}

function loadTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (err) { /* storage blocked */ }
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function toggleTheme() {
  const next = el.root.classList.contains("dark") ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* storage blocked */ }
  announce(`${next === "dark" ? "Dark" : "Light"} mode on.`);
}

/* ---------- 14. Helpers ---------- */
function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function renderHeaderDate() {
  if (el.currentDate) {
    const now = new Date();
    el.currentDate.textContent = now.toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
    el.currentDate.setAttribute("datetime", todayKey());
  }
  setText(el.footerYear, new Date().getFullYear());
}

/* ---------- 15. Event listeners (attached once) ---------- */
function bindEvents() {
  el.sidebarToggle?.addEventListener("click", toggleSidebar);
  el.sidebar?.addEventListener("click", handleNavClick);
  el.themeToggle?.addEventListener("click", toggleTheme);

  el.addTaskBtn?.addEventListener("click", () => {
    if (el.formSection && !el.formSection.hidden && !el.taskId.value) closeForm();
    else openForm(null);
  });
  el.emptyAddBtn?.addEventListener("click", () => openForm(null));
  el.cancelBtn?.addEventListener("click", closeForm);
  el.form?.addEventListener("submit", handleFormSubmit);
  el.title?.addEventListener("input", () => {
    if (el.title.value.trim()) hideTitleError();
  });

  // Search: live filtering; pressing Enter must not reload the page.
  el.searchForm?.addEventListener("submit", (e) => e.preventDefault());
  el.searchInput?.addEventListener("input", () => {
    state.search = el.searchInput.value;
    renderTasks();
  });

  el.filterButtons.forEach((btn) =>
    btn.addEventListener("click", () => setFilter(btn.dataset.filter))
  );
  el.filterCategory?.addEventListener("change", () => {
    state.category = el.filterCategory.value;
    renderTasks();
  });
  el.filterPriority?.addEventListener("change", () => {
    state.priority = el.filterPriority.value;
    renderTasks();
  });
  el.sortSelect?.addEventListener("change", () => {
    state.sort = el.sortSelect.value;
    renderTasks();
  });

  // One listener for every task card (event delegation).
  el.taskList?.addEventListener("click", (event) => {
    const item = event.target.closest(".task-item");
    if (!item) return;
    const id = item.dataset.id;
    if (event.target.closest(".task-item__edit")) {
      openForm(state.tasks.find((t) => t.id === id));
    } else if (event.target.closest(".task-item__delete")) {
      askDelete(id);
    }
  });
  el.taskList?.addEventListener("change", (event) => {
    if (!event.target.classList.contains("task-item__checkbox")) return;
    const item = event.target.closest(".task-item");
    if (item) toggleTask(item.dataset.id);
  });

  el.dialog?.addEventListener("close", handleDialogClose);
  // Clicking the dark backdrop closes the dialog without deleting.
  el.dialog?.addEventListener("click", (event) => {
    if (event.target === el.dialog) el.dialog.close("cancel");
  });

  // Escape closes the open form or the mobile sidebar (the dialog handles Escape itself).
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || el.dialog?.open) return;
    if (el.formSection && !el.formSection.hidden) closeForm();
    else closeSidebar();
  });

  // Close the mobile sidebar when clicking outside it.
  document.addEventListener("click", (event) => {
    if (!el.sidebar?.classList.contains("is-open")) return;
    if (!el.sidebar.contains(event.target) && !el.sidebarToggle?.contains(event.target)) closeSidebar();
  });

  // Support links like index.html#today.
  window.addEventListener("hashchange", () => setView(location.hash.slice(1)));
}

/* ---------- 16. Start the app ---------- */
function init() {
  applyTheme(loadTheme());
  renderHeaderDate();
  state.tasks = loadTasks();
  bindEvents();
  setView(location.hash.slice(1) || "dashboard"); // also renders the task list
  renderStats();
}

init();
