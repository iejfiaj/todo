// TodoMaster — Firebase 동기화 버전

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  setPersistence,
  indexedDBLocalPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ===== Firebase 초기화 =====
const firebaseConfig = {
  apiKey: "AIzaSyA9lscur8ydR8I5B4dRSHPRX9imHjRgZPE",
  authDomain: "mytodo-soyeon.firebaseapp.com",
  projectId: "mytodo-soyeon",
  storageBucket: "mytodo-soyeon.firebasestorage.app",
  messagingSenderId: "768481336176",
  appId: "1:768481336176:web:732891bd92f6d69bd3cdb5",
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const provider = new GoogleAuthProvider();

// Safari ITP 환경에서도 인증 상태가 유지되도록 indexedDB 우선 사용
const persistenceReady = setPersistence(auth, indexedDBLocalPersistence)
  .catch(() => setPersistence(auth, browserLocalPersistence))
  .catch((err) => console.warn("persistence 설정 실패", err));

// iOS Safari/Chrome은 모두 WebKit 기반 — popup이 조용히 막혀서 redirect만 동작
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// ===== 상수 =====
const STORAGE_KEY = "todoApp.tasks"; // 마이그레이션 전용
const CATEGORIES = ["학교 공부", "개인 공부", "업무", "개인 일정"];
const FILTER_ALL = "전체";

// ===== 상태 =====
let currentUser = null;
let unsubscribeTasks = null;
let tasks = [];
let currentFilter = FILTER_ALL;
let editingId = null;
let selectedDate = null;
const _now = new Date();
let calYear = _now.getFullYear();
let calMonth = _now.getMonth();

// ===== 헬퍼 =====
const formatDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayStr = () => formatDate(new Date());
const categoryClass = (cat) => cat.replace(/\s+/g, "");

// ===== DOM =====
const $login = document.getElementById("login-screen");
const $loginBtn = document.getElementById("login-btn");
const $loginStatus = document.getElementById("login-status");
const $logoutBtn = document.getElementById("logout-btn");
const $userBadge = document.getElementById("user-badge");
const $appMain = document.getElementById("app-main");
const $input = document.getElementById("task-input");
const $select = document.getElementById("category-select");
const $addBtn = document.getElementById("add-btn");
const $list = document.getElementById("todo-list");
const $emptyState = document.getElementById("empty-state");
const $progress = document.getElementById("progress-text");
const $filterTabs = document.getElementById("filter-tabs");

// ===== 인증 =====

function showLoginStatus(msg, isError = false) {
  $loginStatus.hidden = false;
  $loginStatus.textContent = msg;
  $loginStatus.classList.toggle("error", isError);
}

function clearLoginStatus() {
  $loginStatus.hidden = true;
  $loginStatus.textContent = "";
}

$loginBtn.addEventListener("click", async () => {
  clearLoginStatus();
  showLoginStatus("로그인 시도 중...");
  try {
    await persistenceReady;
    if (isIOS) {
      // iOS는 redirect만 사용
      await signInWithRedirect(auth, provider);
      return;
    }
    // 데스크탑/Android: 팝업 먼저
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error("로그인 오류", err);
    if (
      err.code === "auth/popup-blocked" ||
      err.code === "auth/popup-closed-by-user" ||
      err.code === "auth/cancelled-popup-request" ||
      err.code === "auth/operation-not-supported-in-this-environment"
    ) {
      try {
        await signInWithRedirect(auth, provider);
        return;
      } catch (err2) {
        showLoginStatus("로그인 실패: " + (err2.message || err2.code), true);
        return;
      }
    }
    showLoginStatus("로그인 실패: " + (err.message || err.code), true);
  }
});

$logoutBtn.addEventListener("click", async () => {
  if (unsubscribeTasks) unsubscribeTasks();
  unsubscribeTasks = null;
  tasks = [];
  await signOut(auth);
});

// 페이지 로드 시 redirect 결과 처리
getRedirectResult(auth).catch((err) => {
  console.error("Redirect 결과 오류", err);
  showLoginStatus("로그인 실패: " + (err.message || err.code), true);
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    showApp(user);
    await maybeMigrateLocalStorage(user.uid);
    listenToTasks(user.uid);
  } else {
    currentUser = null;
    showLogin();
  }
});

function showLogin() {
  $login.hidden = false;
  $appMain.hidden = true;
}

function showApp(user) {
  $login.hidden = true;
  $appMain.hidden = false;
  $userBadge.textContent = user.displayName || user.email || "로그인됨";
  renderTodayDate();
  renderTasks();
  $input.focus();
}

// 로컬 저장소에 남은 항목이 있으면 클라우드로 마이그레이션 제안
async function maybeMigrateLocalStorage(uid) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    if (
      !confirm(
        `이 기기에 저장된 ${parsed.length}개의 할 일이 있어요. 클라우드로 옮길까요?`
      )
    ) {
      return;
    }
    const batch = writeBatch(db);
    for (const t of parsed) {
      if (!t.date) t.date = formatDate(new Date(t.createdAt || Date.now()));
      const ref = doc(db, "users", uid, "tasks", t.id);
      batch.set(ref, t);
    }
    await batch.commit();
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn("마이그레이션 실패", err);
  }
}

function listenToTasks(uid) {
  if (unsubscribeTasks) unsubscribeTasks();
  const tasksRef = collection(db, "users", uid, "tasks");
  unsubscribeTasks = onSnapshot(
    tasksRef,
    (snap) => {
      tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderTasks();
    },
    (err) => {
      console.error("실시간 동기화 오류", err);
    }
  );
}

// ===== 태스크 CRUD (Firestore) =====

async function addTask() {
  if (!currentUser) return;
  const content = $input.value.trim();
  const category = $select.value;

  if (!content) {
    $input.classList.remove("shake");
    void $input.offsetWidth;
    $input.classList.add("shake");
    $input.focus();
    return;
  }

  const now = Date.now();
  const taskDate = selectedDate || todayStr();
  const task = {
    id: String(now),
    content,
    category,
    completed: false,
    date: taskDate,
    createdAt: now,
  };

  $input.value = "";
  $input.focus();

  try {
    await setDoc(doc(db, "users", currentUser.uid, "tasks", task.id), task);
  } catch (err) {
    alert("저장 실패: " + err.message);
  }
}

async function toggleComplete(id) {
  if (!currentUser) return;
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  try {
    await setDoc(doc(db, "users", currentUser.uid, "tasks", id), {
      ...task,
      completed: !task.completed,
    });
  } catch (err) {
    alert("업데이트 실패: " + err.message);
  }
}

async function deleteTask(id) {
  if (!currentUser) return;
  if (!confirm("정말 삭제하시겠습니까?")) return;
  if (editingId === id) editingId = null;
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "tasks", id));
  } catch (err) {
    alert("삭제 실패: " + err.message);
  }
}

async function saveEdit(id, newContent, newCategory) {
  if (!currentUser) return;
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  const trimmed = newContent.trim();
  if (!trimmed) {
    alert("내용을 입력해주세요.");
    return;
  }
  editingId = null;
  try {
    await setDoc(doc(db, "users", currentUser.uid, "tasks", id), {
      ...task,
      content: trimmed,
      category: newCategory,
    });
  } catch (err) {
    alert("저장 실패: " + err.message);
  }
}

function startEdit(id) {
  editingId = id;
  renderTasks();
}

function cancelEdit() {
  editingId = null;
  renderTasks();
}

function setFilter(filter) {
  currentFilter = filter;
  editingId = null;
  $filterTabs.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.filter === filter);
  });
  renderTasks();
}

function getVisibleTasks() {
  return tasks.filter((t) => {
    if (currentFilter !== FILTER_ALL && t.category !== currentFilter) return false;
    if (selectedDate && t.date !== selectedDate) return false;
    return true;
  });
}

// ===== 렌더링 =====

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

  // IME 조합 중 Enter는 무시
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
      saveEdit(task.id, input.value, select.value);
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  });

  li.append(input, select, actions);

  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);

  return li;
}

function updateProgress() {
  const visible = getVisibleTasks();
  const total = visible.length;
  const done = visible.filter((t) => t.completed).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  $progress.textContent = `진행: ${done}/${total} 완료 (${percent}%)`;
}

// ===== 달력 =====

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
      if (dayTasks.every((t) => t.completed)) cell.classList.add("all-done");
    }
    cell.addEventListener("click", () => toggleSelectedDate(dateStr));
    $grid.appendChild(cell);
  }

  $clear.hidden = !selectedDate;
}

function toggleSelectedDate(dateStr) {
  selectedDate = selectedDate === dateStr ? null : dateStr;
  editingId = null;
  renderTasks();
}

function clearSelectedDate() {
  selectedDate = null;
  editingId = null;
  renderTasks();
}

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

// ===== 이벤트 바인딩 =====

$addBtn.addEventListener("click", addTask);

$input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) addTask();
});

$filterTabs.addEventListener("click", (e) => {
  const tab = e.target.closest(".filter-tab");
  if (!tab) return;
  setFilter(tab.dataset.filter);
});

document.getElementById("cal-prev").addEventListener("click", () => navMonth(-1));
document.getElementById("cal-next").addEventListener("click", () => navMonth(1));
document.getElementById("cal-clear").addEventListener("click", clearSelectedDate);

// ===== 서비스 워커 =====

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch((err) => console.warn("ServiceWorker 등록 실패", err));
  });
}
