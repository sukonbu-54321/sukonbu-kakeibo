// Firebase SDK インポート（バージョン統一: 12.3.0）
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, initializeFirestore, persistentLocalCache
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// スキーマバージョン（ロールフォワード管理）
const SCHEMA_VERSION = 3;

/**
 * HTMLエスケープ（XSS対策）
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  if (typeof str !== "string") return String(str ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * 旧データを現在のスキーマに移行する
 * バージョンが上がるたびに if 節を追加する（ロールフォワード対応）
 * @param {object} data - Firebaseまたはローカルから読み込んだデータ
 * @returns {object} - マイグレーション後のデータ
 */
function migrateData(data) {
  if (!data || typeof data !== "object") return { entries: [], goal: null, genres: ["投資", "副業", "ポイ活", "生活費", "シミュレーション"], schemaVersion: SCHEMA_VERSION };
  const ver = data.schemaVersion || 1;

  if (ver < 2) {
    data.entries = (data.entries || []).map(e => ({
      investmentCategory: null,
      investmentPlan: null,
      ...e
    }));
    data.schemaVersion = 2;
  }

  if (ver < 3) {
    data.entries = (data.entries || []).map(e => ({
      tags: [],
      ...e
    }));
    data.schemaVersion = 3;
  }

  return data;
}

// Firebase 初期化
let auth, db;

async function initFirebase() {
  try {
    let firebaseConfig = null;

    const isLocalStaticServer = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port !== "5000";

    // 1次: Firebase Hosting 自動提供のURL
    if (!isLocalStaticServer) {
      try {
        const res = await fetch("/__/firebase/init.json");
        if (res.ok) firebaseConfig = await res.json();
      } catch (_) {}
    }

    // 2次フォールバック: ローカル設定ファイル
    if (!firebaseConfig) {
      try {
        const res2 = await fetch("./firebase-config.json");
        if (res2.ok) {
          const rawConfig = await res2.json();
          if (rawConfig && Object.keys(rawConfig).length > 0) {
            firebaseConfig = rawConfig;
          }
        }
      } catch (_) {}
    }

    if (!firebaseConfig) {
      console.log("ℹ️ Firebase設定ファイルが無効または見つからないため、ローカルモードで起動します。");
      setupUIWithoutAuth();
      return;
    }

    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);

    db = initializeFirestore(app, {
      localCache: persistentLocalCache()
    });

    console.log("✅ Firebase 初期化完了（オフライン永続化 ON）");
    setupAuthListeners();
  } catch (e) {
    console.error("Firebase 初期化エラー:", e);
    showToast("⚠️ Firebase の初期化中にエラーが発生しました。ローカルデータで動作します。", "error");
    setupUIWithoutAuth();
  }
}

// DOM 取得
const loginSection = document.getElementById("login-section");
const mainApp = document.getElementById("mainApp");
const loginBtn = document.getElementById("loginBtn");
const signupBtn = document.getElementById("signupBtn");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl = document.getElementById("loginStatus");

/**
 * Firebase Auth のエラーコードを日本語の安全なメッセージに変換
 * @param {object} err
 * @returns {string}
 */
function getFriendlyAuthErrorMessage(err) {
  const code = err?.code || "";
  switch (code) {
    case "auth/invalid-email":
      return "メールアドレスの形式が正しくありません。";
    case "auth/user-disabled":
      return "このアカウントは無効化されています。";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "メールアドレスまたはパスワードが間違っています。";
    case "auth/email-already-in-use":
      return "このメールアドレスは既に登録されています。";
    case "auth/weak-password":
      return "パスワードは6文字以上で設定してください。";
    case "auth/network-request-failed":
      return "通信エラーが発生しました。ネットワーク接続を確認してください。";
    case "auth/too-many-requests":
      return "試行回数が多すぎます。しばらく待ってから再度お試しください。";
    default:
      return "認証処理中にエラーが発生しました。入力内容を確認してください。";
  }
}

// 認証リスナーのセットアップ
function setupAuthListeners() {
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      const email = document.getElementById("loginEmail")?.value?.trim() || "";
      const password = document.getElementById("loginPassword")?.value || "";
      if (!email || !password) {
        if (statusEl) statusEl.textContent = "メールアドレスとパスワードを入力してください。";
        return;
      }
      try {
        if (statusEl) statusEl.textContent = "ログイン中...";
        await signInWithEmailAndPassword(auth, email, password);
        if (statusEl) statusEl.textContent = "ログイン成功";
      } catch (err) {
        if (statusEl) statusEl.textContent = getFriendlyAuthErrorMessage(err);
      }
    });
  }

  if (signupBtn) {
    signupBtn.addEventListener("click", async () => {
      const email = document.getElementById("loginEmail")?.value?.trim() || "";
      const password = document.getElementById("loginPassword")?.value || "";
      if (!email || !password) {
        if (statusEl) statusEl.textContent = "メールアドレスとパスワードを入力してください。";
        return;
      }
      if (password.length < 6) {
        if (statusEl) statusEl.textContent = "パスワードは6文字以上で設定してください。";
        return;
      }
      try {
        if (statusEl) statusEl.textContent = "アカウント作成中...";
        await createUserWithEmailAndPassword(auth, email, password);
        if (statusEl) statusEl.textContent = "アカウント作成成功！ログイン中";
      } catch (err) {
        if (statusEl) statusEl.textContent = getFriendlyAuthErrorMessage(err);
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
      } catch (err) {
        showToast("⚠️ ログアウトに失敗しました: " + getFriendlyAuthErrorMessage(err), "error");
      }
    });
  }

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      if (loginSection) loginSection.style.display = "none";
      if (mainApp) mainApp.style.display = "block";
      await loadDataFromFirebase();
    } else {
      if (loginSection) loginSection.style.display = "block";
      if (mainApp) mainApp.style.display = "none";
    }
  });
}

function setupUIWithoutAuth() {
  if (loginSection) loginSection.style.display = "none";
  if (mainApp) mainApp.style.display = "block";
}

// Firebase 読み書き
async function saveDataToFirebase() {
  if (!auth || !auth.currentUser || !db) return;
  try {
    await setDoc(doc(db, "users", auth.currentUser.uid), {
      entries,
      goal,
      genres,
      schemaVersion: SCHEMA_VERSION
    });
  } catch (e) {
    console.error("Firebase 保存エラー:", e);
    showToast("⚠️ クラウド保存に失敗しました。ローカルには保存済みです。", "error");
  }
}

async function loadDataFromFirebase() {
  if (!auth || !auth.currentUser || !db) return;
  try {
    const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
    if (snap.exists()) {
      const raw = snap.data();
      const data = migrateData(raw);
      entries = Array.isArray(data.entries) ? data.entries : [];
      goal = data.goal || null;
      genres = Array.isArray(data.genres) ? data.genres : ["投資", "副業", "ポイ活", "生活費", "シミュレーション"];
      updateGenreSelects();
      refreshUI();
    }
  } catch (e) {
    console.error("Firebase 読み込みエラー:", e);
    showToast("⚠️ クラウドからの読み込みに失敗しました。ローカルデータを使用します。", "error");
  }
}

// ローカルキャッシュの読み込みとロールフォワード
let localData = {
  entries: JSON.parse(localStorage.getItem("entries") || "[]"),
  goal: JSON.parse(localStorage.getItem("goal") || "null"),
  genres: JSON.parse(localStorage.getItem("genres") || '["投資", "副業", "ポイ活", "生活費", "シミュレーション"]'),
  schemaVersion: JSON.parse(localStorage.getItem("schemaVersion") || "1")
};
localData = migrateData(localData);

let entries = localData.entries;
let goal = localData.goal;
let genres = localData.genres;

const investmentCategories = ["投資信託", "米国株", "日本株", "米国ETF", "日本ETF"];

// Undo 機能（最大10段階）
const MAX_UNDO = 10;
let undoStack = [];

function takeSnapshot() {
  undoStack.push({
    entries: JSON.parse(JSON.stringify(entries)),
    goal: goal ? { ...goal } : null,
    genres: [...genres]
  });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function undo() {
  if (undoStack.length === 0) {
    showToast("⚠️ これ以上戻せません", "error");
    return;
  }
  const prev = undoStack.pop();
  entries = prev.entries;
  goal = prev.goal;
  genres = prev.genres;
  saveData();
  updateGenreSelects();
  refreshUI();
  showToast(`✅ 元に戻しました（残り ${undoStack.length} 歩）`, "info");
}
window.undo = undo;

async function saveData() {
  try {
    localStorage.setItem("entries", JSON.stringify(entries));
    localStorage.setItem("goal", JSON.stringify(goal));
    localStorage.setItem("genres", JSON.stringify(genres));
    localStorage.setItem("schemaVersion", JSON.stringify(SCHEMA_VERSION));
  } catch (e) {
    console.error("localStorage 保存エラー:", e);
    showToast("⚠️ ローカルストレージの保存中にエラーが発生しました。", "error");
  }
  await saveDataToFirebase();
}

// トースト通知
function showToast(message, type = "info", duration = 5000) {
  const container = document.getElementById("toast-container");
  if (!container) return null;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const msgSpan = document.createElement("span");
  msgSpan.textContent = message;
  toast.appendChild(msgSpan);

  if (type === "undo") {
    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "toast-undo-btn";
    undoBtn.textContent = "元に戻す";
    undoBtn.addEventListener("click", () => {
      undo();
      removeToast(toast);
    });
    toast.appendChild(undoBtn);
  }

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "toast-close-btn";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => removeToast(toast));
  toast.appendChild(closeBtn);

  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => removeToast(toast), duration);
  }
  return toast;
}

function removeToast(toast) {
  toast.style.animation = "toast-out 0.3s ease forwards";
  setTimeout(() => toast.remove(), 300);
}

// ジャンル管理
function addGenre() {
  const inputEl = document.getElementById("newGenre");
  const newG = inputEl ? inputEl.value.trim() : "";

  if (!newG) {
    showToast("⚠️ ジャンル名を入力してください", "error");
    return;
  }
  if (newG.length > 50) {
    showToast("⚠️ ジャンル名は50文字以内で入力してください", "error");
    return;
  }
  if (genres.includes(newG)) {
    showToast("⚠️ そのジャンルは既に存在します", "error");
    return;
  }

  takeSnapshot();
  genres.push(newG);
  updateGenreSelects();
  saveData();
  showToast(`✅ ジャンル「${newG}」を追加しました`, "undo");
  if (inputEl) inputEl.value = "";
}
window.addGenre = addGenre;

function editGenre() {
  const select = document.getElementById("genreSelect");
  const oldName = select ? select.value : "";
  if (!oldName) {
    showToast("⚠️ 編集するジャンルを選択してください", "error");
    return;
  }

  const newName = prompt("新しいジャンル名を入力してください:", oldName);
  if (newName !== null) {
    const trimmed = newName.trim();
    if (!trimmed) {
      showToast("⚠️ 有効なジャンル名を入力してください", "error");
      return;
    }
    if (trimmed.length > 50) {
      showToast("⚠️ ジャンル名は50文字以内で入力してください", "error");
      return;
    }
    if (genres.includes(trimmed)) {
      showToast("⚠️ そのジャンルは既に存在します", "error");
      return;
    }
    takeSnapshot();
    genres = genres.map(g => g === oldName ? trimmed : g);
    entries = entries.map(e => e.genre === oldName ? { ...e, genre: trimmed } : e);
    saveData();
    updateGenreSelects();
    refreshUI();
    showToast(`✅ 「${oldName}」を「${trimmed}」に変更しました`, "undo");
  }
}
window.editGenre = editGenre;

function deleteGenre() {
  const select = document.getElementById("genreSelect");
  const target = select ? select.value : "";
  if (!target) {
    showToast("⚠️ 削除するジャンルを選択してください", "error");
    return;
  }

  if (confirm(`ジャンル「${target}」を削除しますか？\n※このジャンルの収支データもすべて削除されます。`)) {
    takeSnapshot();
    genres = genres.filter(g => g !== target);
    entries = entries.filter(e => e.genre !== target);
    saveData();
    updateGenreSelects();
    refreshUI();
    showToast(`🗑️ ジャンル「${target}」を削除しました`, "undo");
  }
}
window.deleteGenre = deleteGenre;

function updateGenreSelects() {
  const selects = [
    document.getElementById("genre"),
    document.getElementById("compareGenre"),
    document.getElementById("genreSelect")
  ];

  selects.forEach(sel => {
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "ジャンルを選択";
    placeholder.disabled = true;
    placeholder.selected = true;
    sel.appendChild(placeholder);

    genres.forEach(g => {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      if (g === currentVal) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

// 目標設定
function setGoal() {
  const nameInput = document.getElementById("goalName");
  const amountInput = document.getElementById("goalAmount");
  const periodInput = document.getElementById("goalPeriod");

  const name = nameInput ? nameInput.value.trim() : "";
  const amount = amountInput ? parseInt(amountInput.value, 10) : NaN;
  const period = periodInput ? parseInt(periodInput.value, 10) : NaN;

  if (!name || isNaN(amount) || isNaN(period) || amount <= 0 || period <= 0) {
    showToast("⚠️ 目標名・金額・期間を正しく入力してください", "error");
    return;
  }
  if (name.length > 100) {
    showToast("⚠️ 目標名は100文字以内で入力してください", "error");
    return;
  }
  if (amount > 100000000000) {
    showToast("⚠️ 金額の上限を超えています", "error");
    return;
  }

  takeSnapshot();
  goal = { name, amount, period };
  saveData();
  refreshUI();
  showToast("🎯 目標を設定しました", "undo");
}
window.setGoal = setGoal;

// 収支入力
function addEntry() {
  const genreEl = document.getElementById("genre");
  const typeEl = document.getElementById("type");
  const amountEl = document.getElementById("amount");
  const memoEl = document.getElementById("memo");

  const genre = genreEl ? genreEl.value : "";
  const type = typeEl ? typeEl.value : "expense";
  const amount = amountEl ? parseInt(amountEl.value, 10) : NaN;
  const memoRaw = memoEl ? memoEl.value.trim() : "";
  const memo = memoRaw ? memoRaw.slice(0, 200) : "-";
  const date = new Date().toISOString();

  if (!genre) {
    showToast("⚠️ ジャンルを選択してください", "error");
    return;
  }
  if (isNaN(amount) || amount <= 0 || amount > 100000000000) {
    showToast("⚠️ 1円以上 1,000億円以下の正しい金額を入力してください", "error");
    return;
  }

  let investmentCategory = null;
  let investmentPlan = null;
  if (genre === "投資") {
    investmentCategory = document.getElementById("investmentCategory")?.value || null;
    investmentPlan = document.getElementById("investmentPlan")?.value || null;
  }

  takeSnapshot();

  const existing = entries.find(e =>
    e.genre === genre &&
    e.memo === memo &&
    e.type === type &&
    (e.investmentCategory || null) === investmentCategory &&
    (e.investmentPlan || null) === investmentPlan
  );
  if (existing) {
    existing.amount += amount;
  } else {
    entries.push({ genre, type, amount, memo, date, investmentCategory, investmentPlan, tags: [] });
  }

  saveData();
  refreshUI();
  showToast("✅ 収支を追加しました", "undo");

  if (amountEl) amountEl.value = "";
  if (memoEl) memoEl.value = "";
}
window.addEntry = addEntry;

// 削除
function deleteEntry(index) {
  if (index < 0 || index >= entries.length) return;
  takeSnapshot();
  entries.splice(index, 1);
  saveData();
  refreshUI();
  showToast("🗑️ 収支を削除しました", "undo");
}
window.deleteEntry = deleteEntry;

// 履歴レンダリング（XSS対策: textContent による安全なDOM生成）
function renderLists() {
  const container = document.getElementById("entryLists");
  if (!container) return;
  container.innerHTML = "";
  const grouped = {};
  entries.forEach((entry, index) => {
    if (!grouped[entry.genre]) grouped[entry.genre] = [];
    grouped[entry.genre].push({ ...entry, index });
  });

  if (Object.keys(grouped).length === 0) {
    const emptyP = document.createElement("p");
    emptyP.textContent = "履歴はありません。";
    container.appendChild(emptyP);
    return;
  }

  for (let genre in grouped) {
    const div = document.createElement("div");
    div.className = "genre-list";

    const h3 = document.createElement("h3");
    h3.textContent = genre;
    div.appendChild(h3);

    const ul = document.createElement("ul");
    grouped[genre].forEach(e => {
      const dateStr = new Date(e.date).toLocaleDateString("ja-JP");
      const li = document.createElement("li");

      const span = document.createElement("span");
      const memoText = e.memo && e.memo !== "-" ? ` (${e.memo})` : "";
      span.textContent = `${dateStr} | ${e.type === "income" ? "収入" : "支出"}: ${Number(e.amount).toLocaleString()}円${memoText}`;

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "delete-btn";
      delBtn.textContent = "削除";
      delBtn.addEventListener("click", () => deleteEntry(e.index));

      li.appendChild(span);
      li.appendChild(delBtn);
      ul.appendChild(li);
    });

    div.appendChild(ul);
    container.appendChild(div);
  }
}

// 集計
function updateSummary() {
  const now = new Date();
  const nowYear  = now.getFullYear();
  const nowMonth = now.getMonth();

  const monthlyEntries = entries.filter(e => {
    const d = new Date(e.date);
    return d.getFullYear() === nowYear && d.getMonth() === nowMonth;
  });

  const totalIncome  = monthlyEntries.filter(e => e.type === "income").reduce((sum, e) => sum + e.amount, 0);
  const totalExpense = monthlyEntries.filter(e => e.type === "expense").reduce((sum, e) => sum + e.amount, 0);
  const balance = totalIncome - totalExpense;

  const incomeEl = document.getElementById("totalIncome");
  const expenseEl = document.getElementById("totalExpense");
  const balanceEl = document.getElementById("balance");
  const progressEl = document.getElementById("progress");
  const goalRateEl = document.getElementById("goalRate");

  if (incomeEl) incomeEl.textContent = totalIncome.toLocaleString();
  if (expenseEl) expenseEl.textContent = totalExpense.toLocaleString();
  if (balanceEl) balanceEl.textContent = balance.toLocaleString();

  if (goal && goal.amount > 0) {
    const progressPercent = Math.min((balance / goal.amount) * 100, 100);
    if (progressEl) progressEl.style.width = Math.max(0, progressPercent) + "%";
    if (goalRateEl) goalRateEl.textContent = Math.max(0, Math.floor(progressPercent));
  } else {
    if (progressEl) progressEl.style.width = "0%";
    if (goalRateEl) goalRateEl.textContent = "0";
  }
}

function refreshUI() {
  renderLists();
  renderGoal();
  updateSummary();
  refreshAllData();
}
window.refreshUI = refreshUI;

function renderGoal() {
  const goalDisplay = document.getElementById("goalDisplay");
  if (!goalDisplay) return;
  if (goal) {
    goalDisplay.textContent = `目標: ${goal.name} (${goal.amount.toLocaleString()}円 / ${goal.period}年)`;
  } else {
    goalDisplay.textContent = "目標未設定";
  }
}

// セクション開閉
function toggleSection(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const section = target.parentElement;
  if (!section) return;

  if (section.classList.contains("open")) {
    target.style.display = "none";
    section.classList.remove("open");
  } else {
    target.style.display = "block";
    section.classList.add("open");
  }
}
window.toggleSection = toggleSection;

function toggleCalculator() {
  const section = document.getElementById("calculatorInput");
  if (!section) return;
  const isHidden = section.style.display === "none";
  section.style.display = isHidden ? "flex" : "none";
  localStorage.setItem("calculator_visible", isHidden ? "true" : "false");
}
window.toggleCalculator = toggleCalculator;

function restoreCalculator(defaultDisplay = "flex") {
  const section = document.getElementById("calculatorInput");
  if (!section) return;
  const saved = localStorage.getItem("calculator_visible");
  section.style.display = (saved === "true") ? defaultDisplay : "none";
}

// 比較・差額シミュレーション
function toggleInterestFields() {
  const genreEl = document.getElementById("compareGenre");
  const interestFields = document.getElementById("interestFields");
  if (!genreEl || !interestFields) return;
  interestFields.style.display = (genreEl.value === "投資") ? "block" : "none";
}
window.toggleInterestFields = toggleInterestFields;

function toggleInvestmentMode() {
  const yearsLabel = document.getElementById("compareYearsLabel");
  if (yearsLabel) yearsLabel.textContent = "運用期間 (年) ";
}
window.toggleInvestmentMode = toggleInvestmentMode;

function calculateCompare() {
  const genre = document.getElementById("compareGenre")?.value || "";
  const mode = document.getElementById("investmentMode")?.value || "once";
  const aAmount = parseFloat(document.getElementById("aAmount")?.value) || 0;
  const bAmount = parseFloat(document.getElementById("bAmount")?.value) || 0;
  const years = parseFloat(document.getElementById("compareYears")?.value) || 1;
  const aRate = (parseFloat(document.getElementById("aRate")?.value) || 0) / 100;
  const bRate = (parseFloat(document.getElementById("bRate")?.value) || 0) / 100;

  let aTotal = aAmount, bTotal = bAmount;

  if (genre === "投資") {
    const months = years * 12;

    if (mode === "once") {
      aTotal = aAmount * Math.pow(1 + aRate, years);
      bTotal = bAmount * Math.pow(1 + bRate, years);
    } else if (mode === "monthly") {
      const aMonthlyRate = aRate / 12;
      const bMonthlyRate = bRate / 12;
      aTotal = aMonthlyRate === 0
        ? aAmount * months
        : aAmount * ((Math.pow(1 + aMonthlyRate, months) - 1) / aMonthlyRate);
      bTotal = bMonthlyRate === 0
        ? bAmount * months
        : bAmount * ((Math.pow(1 + bMonthlyRate, months) - 1) / bMonthlyRate);
    } else if (mode === "yearly") {
      aTotal = 0; bTotal = 0;
      for (let i = 0; i < years; i++) {
        aTotal = (aTotal + aAmount) * (1 + aRate);
        bTotal = (bTotal + bAmount) * (1 + bRate);
      }
    }
  } else {
    aTotal = aAmount * years;
    bTotal = bAmount * years;
  }

  const diff = aTotal - bTotal;
  const resultContainer = document.getElementById("differenceResult");
  if (!resultContainer) return;

  const safeGenre = escapeHTML(genre);
  const modeText = mode === "once" ? "1回投資" : mode === "monthly" ? "毎月投資" : "年1回投資";

  resultContainer.innerHTML = `
    <h3>結果 (${safeGenre} - ${modeText})</h3>
    <p>期間: ${years} 年</p>
    <p>Aプラン最終額: <strong>${Math.round(aTotal).toLocaleString()}</strong> 円</p>
    <p>Bプラン最終額: <strong>${Math.round(bTotal).toLocaleString()}</strong> 円</p>
    <p>差額: <strong>${Math.round(diff).toLocaleString()}</strong> 円</p>
  `;
}
window.calculateCompare = calculateCompare;

// ============================================================
// 電卓（Zero-Eval: 安全な再帰下降パーサー）
// ============================================================
let calcValue = "0";
let calcHistory = JSON.parse(localStorage.getItem("calcHistory") || "[]");

function updateDisplay() {
  const display = document.getElementById("display");
  if (display) display.value = calcValue;
}

function press(key) {
  if (calcValue === "0" && key !== ".") calcValue = "";
  calcValue += key;
  updateDisplay();
}
window.press = press;

function clearDisplay() {
  calcValue = "0";
  updateDisplay();
}
window.clearDisplay = clearDisplay;

function backspace() {
  calcValue = calcValue.slice(0, -1) || "0";
  updateDisplay();
}
window.backspace = backspace;

/**
 * eval や new Function を一切使わない安全な数式計算パーサー
 * @param {string} expr
 * @returns {number}
 */
function safeEval(expr) {
  const cleanExpr = String(expr).replace(/\s+/g, "");
  if (!cleanExpr) throw new Error("式が空です");

  // トークナイズ
  const tokens = [];
  let i = 0;
  while (i < cleanExpr.length) {
    const ch = cleanExpr[i];
    if ("+-*/()".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
    } else if (/[0-9.]/.test(ch)) {
      let numStr = "";
      while (i < cleanExpr.length && /[0-9.]/.test(cleanExpr[i])) {
        numStr += cleanExpr[i];
        i++;
      }
      if ((numStr.match(/\./g) || []).length > 1) {
        throw new Error("数値形式エラー");
      }
      const num = parseFloat(numStr);
      if (isNaN(num)) throw new Error("数値パースエラー");
      tokens.push({ type: "num", value: num });
    } else {
      throw new Error("不正な文字が含まれています");
    }
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = (expectedVal) => {
    const tok = tokens[pos];
    if (expectedVal !== undefined && (!tok || tok.value !== expectedVal)) {
      throw new Error(`予期しないトークン: ${tok ? tok.value : "EOF"}`);
    }
    pos++;
    return tok;
  };

  const parseExpression = () => {
    let node = parseTerm();
    while (peek() && (peek().value === "+" || peek().value === "-")) {
      const op = consume().value;
      const right = parseTerm();
      node = op === "+" ? node + right : node - right;
    }
    return node;
  };

  const parseTerm = () => {
    let node = parseFactor();
    while (peek() && (peek().value === "*" || peek().value === "/")) {
      const op = consume().value;
      const right = parseFactor();
      if (op === "/") {
        if (right === 0) throw new Error("0で割ることはできません");
        node = node / right;
      } else {
        node = node * right;
      }
    }
    return node;
  };

  const parseFactor = () => {
    if (peek() && (peek().value === "+" || peek().value === "-")) {
      const sign = consume().value;
      const val = parseFactor();
      return sign === "-" ? -val : val;
    }
    return parsePrimary();
  };

  const parsePrimary = () => {
    const tok = peek();
    if (!tok) throw new Error("式が途中で終了しています");
    if (tok.type === "num") {
      consume();
      return tok.value;
    }
    if (tok.value === "(") {
      consume("(");
      const val = parseExpression();
      consume(")");
      return val;
    }
    throw new Error(`予期しないトークン: ${tok.value}`);
  };

  const result = parseExpression();
  if (pos < tokens.length) throw new Error("余剰トークンがあります");
  if (typeof result !== "number" || !isFinite(result)) throw new Error("計算結果が無効です");
  return result;
}

function calculate() {
  try {
    const result = safeEval(calcValue);
    calcHistory.unshift({ expr: calcValue, result });
    if (calcHistory.length > 50) calcHistory.pop();
    saveCalcHistory();
    renderHistory();
    calcValue = result.toString();
    updateDisplay();
  } catch (err) {
    showToast(`⚠️ 計算エラー: ${err.message || "不正な式です"}`, "error");
    calcValue = "0";
    updateDisplay();
  }
}
window.calculate = calculate;

function saveCalcHistory() {
  try {
    localStorage.setItem("calcHistory", JSON.stringify(calcHistory));
  } catch (e) {
    console.error("電卓履歴の保存エラー:", e);
  }
}

function renderHistory() {
  const container = document.getElementById("history-list");
  if (!container) return;
  container.innerHTML = "";
  calcHistory.forEach((h, i) => {
    const div = document.createElement("div");
    div.className = "history-item";

    const span = document.createElement("span");
    span.textContent = `${h.expr} = ${h.result}`;

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "削除";
    delBtn.addEventListener("click", () => deleteHistory(i));

    div.appendChild(span);
    div.appendChild(delBtn);
    container.appendChild(div);
  });
}

function deleteHistory(index) {
  if (index < 0 || index >= calcHistory.length) return;
  calcHistory.splice(index, 1);
  saveCalcHistory();
  renderHistory();
}
window.deleteHistory = deleteHistory;

// ============================================================
// 積立投資シミュレーション
// ============================================================
function switchInvestMode() {
  const modeEl = document.getElementById("investMode");
  const monthlyEl = document.getElementById("monthlyInvestment");
  const yearsEl = document.getElementById("years");
  const targetField = document.getElementById("targetFields");

  if (!modeEl || !monthlyEl || !yearsEl || !targetField) return;

  const mode = modeEl.value;
  const monthlyField = monthlyEl.parentElement;
  const yearsField = yearsEl.parentElement;

  if (monthlyField) monthlyField.style.display = "flex";
  if (yearsField) yearsField.style.display = "flex";
  targetField.style.display = "none";

  if (mode === "target") {
    if (monthlyField) monthlyField.style.display = "none";
    targetField.style.display = "flex";
  } else if (mode === "period") {
    if (yearsField) yearsField.style.display = "none";
    targetField.style.display = "flex";
  }
}
window.switchInvestMode = switchInvestMode;

function simulateInvestment() {
  const mode = document.getElementById("investMode")?.value || "normal";
  const initial = parseFloat(document.getElementById("initialInvestment")?.value) || 0;
  const monthly = parseFloat(document.getElementById("monthlyInvestment")?.value) || 0;
  const years = parseFloat(document.getElementById("years")?.value) || 0;
  const target = parseFloat(document.getElementById("targetAmount")?.value) || 0;
  const annualRate = (parseFloat(document.getElementById("annualRate")?.value) || 0) / 100;
  const riskRate = (parseFloat(document.getElementById("riskRate")?.value) || 0) / 100;

  const months = years * 12;

  const calcFutureValue = (rate) => {
    const monthlyRate = rate / 12;
    if (monthlyRate === 0) {
      return initial + monthly * months;
    }
    return (
      initial * Math.pow(1 + monthlyRate, months) +
      monthly * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate)
    );
  };

  const rateLow  = annualRate - riskRate;
  const rateMid  = annualRate;
  const rateHigh = annualRate + riskRate;

  let resultText = "";

  if (mode === "normal") {
    const low  = calcFutureValue(rateLow);
    const mid  = calcFutureValue(rateMid);
    const high = calcFutureValue(rateHigh);

    resultText = `
      <h3>💰 投資結果（${years}年後の予測）</h3>
      <p>最低: <strong>${Math.round(low).toLocaleString()}</strong>円（年利 ${(rateLow * 100).toFixed(1)}%）</p>
      <p>中央値: <strong>${Math.round(mid).toLocaleString()}</strong>円（年利 ${(rateMid * 100).toFixed(1)}%）</p>
      <p>最高: <strong>${Math.round(high).toLocaleString()}</strong>円（年利 ${(rateHigh * 100).toFixed(1)}%）</p>
      <hr>
      <p>投資元本: ${(initial + monthly * months).toLocaleString()}円</p>
    `;

  } else if (mode === "target") {
    const monthlyRate = rateMid / 12;
    let requiredMonthly;
    if (monthlyRate === 0) {
      requiredMonthly = months > 0 ? (target - initial) / months : 0;
    } else {
      const numerator   = target - initial * Math.pow(1 + monthlyRate, months);
      const denominator = (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate;
      requiredMonthly   = numerator / denominator;
    }
    resultText = `
      <h3>🎯 目標金額からの逆算</h3>
      <p>目標金額 ${target.toLocaleString()}円 に到達するには、</p>
      <p><strong>毎月 約 ${Math.round(requiredMonthly).toLocaleString()}円</strong> の積立が必要です。</p>
    `;

  } else if (mode === "period") {
    const monthlyRate = rateMid / 12;
    let n = 0;
    let balance = initial;
    const MAX_MONTHS = 1000 * 12;

    if (target <= initial) {
      resultText = `<h3>⏳ 期間シミュレーション</h3><p>すでに目標金額に到達しています！</p>`;
    } else if (monthly <= 0 && monthlyRate <= 0) {
      resultText = `<h3>⏳ 期間シミュレーション</h3><p>⚠️ 月積立額か年利を1以上に設定してください。</p>`;
    } else {
      while (balance < target && n < MAX_MONTHS) {
        balance = monthlyRate > 0
          ? balance * (1 + monthlyRate) + monthly
          : balance + monthly;
        n++;
      }
      if (n >= MAX_MONTHS) {
        resultText = `<h3>⏳ 期間シミュレーション</h3><p>⚠️ 設定された条件では ${MAX_MONTHS / 12} 年以内に目標到達できません。月積立額や年利を見直してください。</p>`;
      } else {
        const yearsNeeded = (n / 12).toFixed(1);
        resultText = `
          <h3>⏳ 期間シミュレーション</h3>
          <p>目標金額 ${target.toLocaleString()}円 に到達するには、</p>
          <p><strong>${yearsNeeded} 年</strong> の積立が必要です。</p>
        `;
      }
    }
  }

  const resultEl = document.getElementById("investmentResult");
  if (resultEl) resultEl.innerHTML = resultText;
}
window.simulateInvestment = simulateInvestment;

// ============================================================
// グラフ描画
// ============================================================
function renderInvestChart(labels, values) {
  const ctx = document.getElementById("investChart");
  if (!ctx) return;
  if (typeof Chart === "undefined") {
    console.warn("Chart.js が読み込まれていません。");
    return;
  }
  if (window.investChart) window.investChart.destroy();
  window.investChart = new Chart(ctx.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: ["#3a86ff", "#ff9f1c", "#70e000"].slice(0, values.length),
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { color: "#e0e0e0" }, grid: { color: "#444" } },
        x: { ticks: { color: "#e0e0e0" }, grid: { color: "#444" } }
      }
    }
  });
}
window.renderInvestChart = renderInvestChart;

function showTool(toolId) {
  const sections = ["dashboard-section", "invest-section", "vision-section", "history-section"];
  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === toolId + "-section") ? "block" : "none";
  });
  refreshAllData();
}
window.showTool = showTool;

function renderBudgetChart(spent, remaining) {
  const ctx = document.getElementById("budgetGaugeChart");
  if (!ctx) return;
  if (typeof Chart === "undefined") {
    console.warn("Chart.js が読み込まれていません。");
    return;
  }
  if (window.myBudgetChart) window.myBudgetChart.destroy();
  window.myBudgetChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["使用済み", "残り予算"],
      datasets: [{
        data: [spent, remaining > 0 ? remaining : 0],
        backgroundColor: ["#1e2937", "#38bdf8"],
        borderWidth: 0
      }]
    },
    options: {
      cutout: "80%",
      plugins: { legend: { display: false } }
    }
  });
}

// Vision / FIRE 目標
function updateVisionLogic() {
  const targetAmount = 5000000;
  const totalIncome  = entries.filter(e => e.type === "income").reduce((sum, e) => sum + e.amount, 0);
  const totalExpense = entries.filter(e => e.type === "expense").reduce((sum, e) => sum + e.amount, 0);
  const currentNetWorth = totalIncome - totalExpense;
  const deficit = targetAmount - currentNetWorth;

  const targetDate = new Date("2028-04-01");
  const now = new Date();
  const monthsLeft = (targetDate.getFullYear() - now.getFullYear()) * 12 + (targetDate.getMonth() - now.getMonth());

  const requiredMonthly = deficit > 0 ? Math.ceil(deficit / (monthsLeft || 1)) : 0;
  const progressPercent = Math.min(100, Math.floor((currentNetWorth / targetAmount) * 100));

  const suggestionEl = document.getElementById("ai-suggestion-text");
  if (suggestionEl) {
    suggestionEl.innerHTML = `
      <p>目標金額まであと: <strong>¥${deficit.toLocaleString()}</strong></p>
      <p>FIRE達成率: <strong>${progressPercent}%</strong></p>
      <hr>
      <p style="color: #fbbf24;">参謀の助言: 2028年4月達成には月間 <strong>¥${requiredMonthly.toLocaleString()}</strong> の蓄積が必要です。一点集中で入金力を高めてください。</p>
    `;
  }
}

function refreshAllData() {
  const now = new Date();
  const currentMonthEntries = entries.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const spent = currentMonthEntries
    .filter(e => e.type === "expense")
    .reduce((sum, e) => sum + e.amount, 0);

  const budget = 150000;
  const remainingAmount = budget - spent;

  updateFireCountdown();
  updateTotalAssets();
  updateBudgetVisuals(spent, remainingAmount);
  updateAssetVisuals();
  if (typeof updateVisionLogic === "function") updateVisionLogic();
}
window.refreshAllData = refreshAllData;

function updateFireCountdown() {
  const target = new Date("2028-04-01");
  const now = new Date();
  const diff = target - now;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  const el = document.getElementById("days-to-fire");
  if (el) el.textContent = days > 0 ? days : 0;
}

function updateAssetVisuals() {
  const ctx = document.getElementById("assetPieChart");
  const listEl = document.getElementById("asset-detail-list");

  const assetData = {};
  investmentCategories.forEach(cat => { assetData[cat] = 0; });

  entries.forEach(e => {
    if (e.genre === "投資" && e.investmentCategory && assetData[e.investmentCategory] !== undefined) {
      const sign = (e.type === "expense") ? 1 : -1;
      assetData[e.investmentCategory] += sign * e.amount;
    }
  });

  const labels = Object.keys(assetData);
  const values = labels.map(k => Math.max(0, assetData[k]));

  if (listEl) {
    listEl.innerHTML = "";
    labels.forEach((l, i) => {
      const item = document.createElement("div");
      item.className = "history-item";
      const nameSpan = document.createElement("span");
      nameSpan.textContent = l;
      const valSpan = document.createElement("span");
      valSpan.textContent = `¥${values[i].toLocaleString()}`;
      item.appendChild(nameSpan);
      item.appendChild(valSpan);
      listEl.appendChild(item);
    });
  }

  if (!ctx || typeof Chart === "undefined") return;

  if (window.myAssetChart) window.myAssetChart.destroy();
  window.myAssetChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: ["#38bdf8", "#4ade80", "#fbbf24", "#f87171", "#a78bfa"]
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function updateBudgetVisuals(spent, remainingAmount) {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const remainingDays = lastDay - now.getDate() + 1;

  if (spent === undefined) {
    spent = entries
      .filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === now.getMonth() && e.type === "expense";
      })
      .reduce((sum, e) => sum + e.amount, 0);
    const budget = 150000;
    remainingAmount = budget - spent;
  }

  const budget = 150000;
  const remAmtEl = document.getElementById("month-rem-amount");
  if (remAmtEl) remAmtEl.textContent = (budget - spent).toLocaleString();

  const remDaysEl = document.getElementById("month-rem-days");
  if (remDaysEl) remDaysEl.textContent = remainingDays;

  const dailyBudget = Math.floor((budget - spent) / remainingDays);
  const dailyEl = document.getElementById("daily-limit");
  if (dailyEl) dailyEl.textContent = "¥" + (dailyBudget > 0 ? dailyBudget : 0).toLocaleString();

  renderBudgetChart(spent, remainingAmount);
}

function updateTotalAssets() {
  const totalIncome  = entries.filter(e => e.type === "income").reduce((sum, e) => sum + e.amount, 0);
  const totalExpense = entries.filter(e => e.type === "expense").reduce((sum, e) => sum + e.amount, 0);
  const netWorth = totalIncome - totalExpense;
  const el = document.getElementById("display-total-assets");
  if (el) el.textContent = "¥" + netWorth.toLocaleString();
}

// ============================================================
// イベントリスナーの登録と初期化
// ============================================================
function setupEventListeners() {
  // セクション開閉ボタン
  document.querySelectorAll("button[data-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-toggle");
      if (targetId) toggleSection(targetId);
    });
  });

  // 目標設定ボタン
  const setGoalBtn = document.getElementById("setGoalBtn");
  if (setGoalBtn) setGoalBtn.addEventListener("click", setGoal);

  // 収支追加ボタン
  const addEntryBtn = document.getElementById("addEntryBtn");
  if (addEntryBtn) addEntryBtn.addEventListener("click", addEntry);

  // ジャンル操作ボタン
  const addGenreBtn = document.getElementById("addGenreBtn");
  if (addGenreBtn) addGenreBtn.addEventListener("click", addGenre);

  const editGenreBtn = document.getElementById("editGenreBtn");
  if (editGenreBtn) editGenreBtn.addEventListener("click", editGenre);

  const deleteGenreBtn = document.getElementById("deleteGenreBtn");
  if (deleteGenreBtn) deleteGenreBtn.addEventListener("click", deleteGenre);

  // 計算ツール開閉
  const toggleCalculatorBtn = document.getElementById("toggleCalculatorBtn");
  if (toggleCalculatorBtn) toggleCalculatorBtn.addEventListener("click", toggleCalculator);

  // 電卓プッシュボタン群
  const pushContainer = document.querySelector(".calculator .push");
  if (pushContainer) {
    pushContainer.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const action = btn.getAttribute("data-calc-action");
      const key = btn.getAttribute("data-calc-key");
      if (action === "clear") {
        clearDisplay();
      } else if (action === "backspace") {
        backspace();
      } else if (action === "calculate") {
        calculate();
      } else if (key !== null) {
        press(key);
      }
    });
  }

  // 積立投資シミュレーション
  const investModeEl = document.getElementById("investMode");
  if (investModeEl) investModeEl.addEventListener("change", switchInvestMode);

  const simulateInvestmentBtn = document.getElementById("simulateInvestmentBtn");
  if (simulateInvestmentBtn) simulateInvestmentBtn.addEventListener("click", simulateInvestment);

  // 比較シミュレーション
  const compareGenreEl = document.getElementById("compareGenre");
  if (compareGenreEl) compareGenreEl.addEventListener("change", toggleInterestFields);

  const investmentModeEl = document.getElementById("investmentMode");
  if (investmentModeEl) investmentModeEl.addEventListener("change", toggleInvestmentMode);

  const calculateCompareBtn = document.getElementById("calculateCompareBtn");
  if (calculateCompareBtn) calculateCompareBtn.addEventListener("click", calculateCompare);

  // 投資ジャンル選択時のオプション表示
  const genreSelectForInvestment = document.getElementById("genre");
  if (genreSelectForInvestment) {
    const toggleInvestmentInputs = () => {
      const isInvestment = genreSelectForInvestment.value === "投資";
      const optEl  = document.getElementById("investment-options");
      const planEl = document.getElementById("investment-plan-options");
      if (optEl)  optEl.style.display  = isInvestment ? "flex" : "none";
      if (planEl) planEl.style.display = isInvestment ? "flex" : "none";
    };
    genreSelectForInvestment.addEventListener("change", toggleInvestmentInputs);
    toggleInvestmentInputs();
  }
}

// ページロード時
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  restoreCalculator("none");
  renderHistory();
  updateDisplay();
  updateGenreSelects();
  refreshUI();
});

// Firebase 初期化
initFirebase();
