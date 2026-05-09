// TodoMaster — 순수 JS 할 일 관리 앱

// ===== 상수 =====
const STORAGE_KEY = "todoApp.tasks";
const CATEGORIES = ["학교 공부", "개인 공부", "업무", "개인 일정"];
const FILTER_ALL = "전체";

// 카테고리명을 CSS 클래스로 변환할 때 공백 제거 ("학교 공부" -> "학교공부")
const categoryClass = (cat) => cat.replace(/\s+/g, "");

// ===== 상태 =====
let tasks = [];
let currentFilter = FILTER_ALL;
let editingId = null;
let selectedDate = null; // 'YYYY-MM-DD' 또는 null (전체 날짜)
const _now = new Date();
let calYear = _now.getFullYear();
let calMonth = _now.getMonth(); // 0-11

// Date를 'YYYY-MM-DD' 문자열로 변환
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const todayStr = () => formatDate(new Date());

// ===== DOM 캐시 =====
const $input = document.getElementById("task-input");
const $select = document.getElementById("category-select");
const $addBtn = document.getElementById("add-btn");
const $list = document.getElementById("todo-list");
const $emptyState = document.getElementById("empty-state");
const $progress = document.getElementById("progress-text");
const $filterTabs = document.getElementById("filter-tabs");

// ===== localStorage =====

// localStorage에서 tasks 복원 (파싱 에러 방어)
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      tasks = [];
      return;
    }
    const parsed = JSON.parse(raw);
    tasks = Array.isArray(parsed) ? parsed : [];
    // 구버전 데이터 마이그레이션: date 필드가 없으면 createdAt으로부터 채움
    tasks.forEach((t) => {
      if (!t.date) t.date = formatDate(new Date(t.createdAt || Date.now()));
    });
  } catch (err) {
    console.warn("저장된 데이터를 불러오지 못했습니다.", err);
    tasks = [];
  }
}

// 현재 tasks를 localStorage에 직렬화하여 저장
function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (err) {
    console.warn("저장에 실패했습니다.", err);
  }
}

// ===== 핵심 로직 =====

// 입력값을 검증하고 새 task를 추가
function addTask() {
  const content = $input.value.trim();
  const category = $select.value;

  if (!content) {
    $input.classList.remove("shake");
    // reflow 트리거하여 애니메이션 재시작
    void $input.offsetWidth;
    $input.classList.add("shake");
    $input.focus();
    return;
  }

  const now = Date.now();
  // 달력에서 날짜를 선택했다면 그 날짜로, 아니면 오늘로
  const taskDate = selectedDate || todayStr();
  tasks.push({
    id: String(now),
    content,
    category,
    completed: false,
    date: taskDate,
    createdAt: now,
  });

  $input.value = "";
  $input.focus();

  saveToStorage();
  renderTasks();
}

// id로 task 찾기
function findTask(id) {
  return tasks.find((t) => t.id === id);
}

// 완료 상태 토글
function toggleComplete(id) {
  const task = findTask(id);
  if (!task) return;
  task.completed = !task.completed;
  saveToStorage();
  renderTasks();
}

// 삭제 (확인 다이얼로그 후)
function deleteTask(id) {
  if (!confirm("정말 삭제하시겠습니까?")) return;
  tasks = tasks.filter((t) => t.id !== id);
  if (editingId === id) editingId = null;
  saveToStorage();
  renderTasks();
}

// 편집 모드 진입 (한 번에 하나만)
function startEdit(id) {
  editingId = id;
  renderTasks();
}

// 편집 저장
function saveEdit(id, newContent, newCategory) {
  const task = findTask(id);
  if (!task) return;
  const trimmed = newContent.trim();
  if (!trimmed) {
    alert("내용을 입력해주세요.");
    return;
  }
  task.content = trimmed;
  task.category = newCategory;
  editingId = null;
  saveToStorage();
  renderTasks();
}

// 편집 취소
function cancelEdit() {
  editingId = null;
  renderTasks();
}

// 필터 변경
function setFilter(filter) {
  currentFilter = filter;
  // 필터 변경 시 편집 중이던 항목이 사라질 수 있으므로 편집 종료
  editingId = null;

  // 활성 탭 표시 갱신
  $filterTabs.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.filter === filter);
  });

  renderTasks();
}

// 현재 필터(카테고리 + 날짜)에 해당하는 task만 추려내기
function getVisibleTasks() {
  return tasks.filter((t) => {
    if (currentFilter !== FILTER_ALL && t.category !== currentFilter) return false;
    if (selectedDate && t.date !== selectedDate) return false;
    return true;
  });
}

// ===== 렌더링 =====

// tasks 배열을 화면에 그리기
function renderTasks() {
  $list.innerHTML = "";
  const visible = getVisibleTasks();

  if (visible.length === 0) {
    $emptyState.hidden = false;
    if (selectedDate) {
      $emptyState.textContent =
        "이 날짜에 할 일이 없어요. 새로 추가하면 이 날짜로 등록돼요!";
    } else if (currentFilter !== FILTER_ALL) {
      $emptyState.textContent = "이 카테고리에 할 일이 없어요. 새로 추가해보세요!";
    } else {
      $emptyState.textContent = "아직 할 일이 없어요. 위에서 새로 추가해보세요!";
    }
  } else {
    $emptyState.hidden = true;
    visible.forEach((task) => {
      const li =
        editingId === task.id ? renderEditingItem(task) : renderItem(task);
      $list.appendChild(li);
    });
  }

  updateProgress();
  renderCalendar();
}

// ===== 달력 =====

// 현재 calYear/calMonth 기준으로 달력 렌더
function renderCalendar() {
  const $title = document.getElementById("cal-title");
  const $grid = document.getElementById("cal-grid");
  const $clear = document.getElementById("cal-clear");
  if (!$title || !$grid) return;

  $title.textContent = `${calYear}년 ${calMonth + 1}월`;
  $grid.innerHTML = "";

  const startWeekday = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = todayStr();

  // 1일이 있는 요일 전까지 빈 셀
  for (let i = 0; i < startWeekday; i++) {
    const empty = document.createElement("div");
    empty.className = "cal-day empty";
    $grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-day";
    const num = document.createElement("span");
    num.className = "cal-day-num";
    num.textContent = d;
    cell.appendChild(num);
    if (dateStr === today) cell.classList.add("today");
    if (dateStr === selectedDate) cell.classList.add("selected");
    const dayTasks = tasks.filter((t) => t.date === dateStr);
    if (dayTasks.length > 0) {
      cell.classList.add("has-tasks");
      // 그 날짜의 모든 할 일이 완료되면 하트 표시
      if (dayTasks.every((t) => t.completed)) cell.classList.add("all-done");
    }
    cell.addEventListener("click", () => toggleSelectedDate(dateStr));
    $grid.appendChild(cell);
  }

  $clear.hidden = !selectedDate;
}

// 같은 날짜를 다시 클릭하면 선택 해제
function toggleSelectedDate(dateStr) {
  selectedDate = selectedDate === dateStr ? null : dateStr;
  editingId = null;
  renderTasks();
}

// 날짜 필터 해제
function clearSelectedDate() {
  selectedDate = null;
  editingId = null;
  renderTasks();
}

// 달력 월 이동 (-1 또는 +1)
function navMonth(delta) {
  calMonth += delta;
  if (calMonth < 0) {
    calMonth = 11;
    calYear -= 1;
  } else if (calMonth > 11) {
    calMonth = 0;
    calYear += 1;
  }
  renderCalendar();
}

// 일반 모드 li 생성
function renderItem(task) {
  const li = document.createElement("li");
  li.className = "todo-item" + (task.completed ? " completed" : "");
  li.dataset.id = task.id;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "todo-checkbox";
  checkbox.checked = task.completed;
  checkbox.addEventListener("change", () => toggleComplete(task.id));

  const content = document.createElement("span");
  content.className = "todo-content";
  content.textContent = task.content;

  const category = document.createElement("span");
  category.className = `todo-category ${categoryClass(task.category)}`;
  category.textContent = task.category;

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "icon-btn";
  editBtn.title = "수정";
  editBtn.textContent = "✏️";
  editBtn.addEventListener("click", () => startEdit(task.id));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn";
  deleteBtn.title = "삭제";
  deleteBtn.textContent = "🗑️";
  deleteBtn.addEventListener("click", () => deleteTask(task.id));

  li.append(checkbox, content, category, editBtn, deleteBtn);
  return li;
}

// 편집 모드 li 생성
function renderEditingItem(task) {
  const li = document.createElement("li");
  li.className = "todo-item editing";
  li.dataset.id = task.id;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "edit-input";
  input.value = task.content;

  const select = document.createElement("select");
  select.className = "edit-select";
  CATEGORIES.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    if (c === task.category) opt.selected = true;
    select.appendChild(opt);
  });

  const actions = document.createElement("div");
  actions.className = "edit-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "save-btn";
  saveBtn.textContent = "저장";
  saveBtn.addEventListener("click", () =>
    saveEdit(task.id, input.value, select.value)
  );

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "cancel-btn";
  cancelBtn.textContent = "취소";
  cancelBtn.addEventListener("click", cancelEdit);

  actions.append(saveBtn, cancelBtn);

  // Enter로 저장, Escape로 취소
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveEdit(task.id, input.value, select.value);
    else if (e.key === "Escape") cancelEdit();
  });

  li.append(input, select, actions);

  // 편집 진입 시 input에 포커스 (다음 tick에)
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);

  return li;
}

// 진행률 텍스트 갱신 (현재 필터 기준)
function updateProgress() {
  const visible = getVisibleTasks();
  const total = visible.length;
  const done = visible.filter((t) => t.completed).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  $progress.textContent = `진행: ${done}/${total} 완료 (${percent}%)`;
}

// ===== 이벤트 바인딩 =====

function bindEvents() {
  $addBtn.addEventListener("click", addTask);

  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTask();
  });

  $filterTabs.addEventListener("click", (e) => {
    const tab = e.target.closest(".filter-tab");
    if (!tab) return;
    setFilter(tab.dataset.filter);
  });

  document.getElementById("cal-prev").addEventListener("click", () => navMonth(-1));
  document.getElementById("cal-next").addEventListener("click", () => navMonth(1));
  document.getElementById("cal-clear").addEventListener("click", clearSelectedDate);
}

// ===== 초기화 =====

// 오늘 날짜를 한국어 형식으로 표시 (예: 2026년 5월 9일 (토))
function renderTodayDate() {
  const $date = document.getElementById("today-date");
  if (!$date) return;
  const now = new Date();
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const w = days[now.getDay()];
  $date.textContent = `${y}년 ${m}월 ${d}일 (${w})`;
}

function init() {
  loadFromStorage();
  bindEvents();
  renderTodayDate();
  renderTasks();
  $input.focus();
}

init();

// 서비스 워커 등록 (http://, https://, file:// 환경에 따라 동작 다름)
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch((err) => console.warn("ServiceWorker 등록 실패", err));
  });
}
