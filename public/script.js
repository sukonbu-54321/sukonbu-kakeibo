// Firebase SDK インポート（バージョン統一: 12.3.0）
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, initializeFirestore, persistentLocalCache
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// スキーマバージョン（ロールフォワード管理）
const SCHEMA_VERSION = 2;

/**
 * 旧データを現在のスキーマに移行する
 * @param {object} data - Firebaseまたはlocalから読み込んだデータ
 * @returns {object} - マイグレーション後のデータ
 */
function migrateData(data) {
  const ver = data.schemaVersion || 1;

  if (ver < 2) {
    // v1 → v2: investmentCategory / investmentPlan フィールドを補完
    data.entries = (data.entries || []).map(e => ({
      investmentCategory: null,
      investmentPlan: null,
      ...e
    }));
    data.schemaVersion = 2;
    console.log("📦 データをスキーマ v2 にマイグレーション完了");
  }

  return data;
}

// Firebase 初期化（APIキーを /__/firebase/init.json から取得）
let auth, db;

async function initFirebase() {
  try {
    const res = await fetch("/__/firebase/init.json");
    if (!res.ok) throw new Error(`init.json の取得失敗: ${res.status}`);
    const firebaseConfig = await res.json();

    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);

    // オフライン永続化を有効にした Firestore を初期化
    db = initializeFirestore(app, {
      localCache: persistentLocalCache()
    });

    console.log("✅ Firebase 初期化完了（オフライン永続化 ON）");
    setupAuthListeners();
  } catch (e) {
    console.error("Firebase 初期化エラー:", e);
    showToast("⚠️ Firebase への接続に失敗しました。ローカルデータで動作します。", "error");
    // Firebaseなしでも画面は動作させる（localStorageのみ）
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

// 認証リスナーのセットアップ
function setupAuthListeners() {
  // ログイン処理
  loginBtn.addEventListener("click", async () => {
    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;
    try {
      await signInWithEmailAndPassword(auth, email, password);
      statusEl.textContent = "ログイン成功";
    } catch (err) {
      statusEl.textContent = "エラー: " + err.message;
    }
  });

  // 新規登録
  signupBtn.addEventListener("click", async () => {
    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      statusEl.textContent = "アカウント作成成功！ログイン中";
    } catch (err) {
      statusEl.textContent = "エラー: " + err.message;
    }
  });

  // ログアウト
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (err) {
      showToast("⚠️ ログアウトに失敗しました: " + err.message, "error");
    }
  });

  // 認証状態監視
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      loginSection.style.display = "none";
      mainApp.style.display = "block";
      await loadDataFromFirebase();
    } else {
      loginSection.style.display = "block";
      mainApp.style.display = "none";
    }
  });
}

// Firebase なしでも UI を起動（localStorageのみモード）
function setupUIWithoutAuth() {
  loginSection.style.display = "none";
  mainApp.style.display = "block";
}

// Firebase 読み書き
async function saveDataToFirebase() {
  if (!auth || !auth.currentUser) return;
  try {
    await setDoc(doc(db, "users", auth.currentUser.uid), {
      entries,
      goal,
      genres,
      schemaVersion: SCHEMA_VERSION
    });
    console.log("✅ Firebase に保存完了");
  } catch (e) {
    console.error("Firebase 保存エラー:", e);
    showToast("⚠️ クラウド保存に失敗しました。ローカルには保存済みです。", "error");
  }
}

async function loadDataFromFirebase() {
  if (!auth || !auth.currentUser) return;
  try {
    const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
    if (snap.exists()) {
      const raw = snap.data();
      const data = migrateData(raw);
      entries = data.entries || [];
      goal = data.goal || null;
      genres = data.genres || ["投資", "副業", "ポイ活", "生活費", "シミュレーション"];
      renderLists();
      renderGoal();
      updateSummary();
      updateGenreSelects();
      console.log("📦 Firebase からデータ復元完了");
    }
  } catch (e) {
    console.error("Firebase 読み込みエラー:", e);
    showToast("⚠️ クラウドからの読み込みに失敗しました。ローカルデータを使用します。", "error");
  }
}

// データ初期化（localStorage キャッシュ）
let entries = JSON.parse(localStorage.getItem("entries")) || [];
let goal = JSON.parse(localStorage.getItem("goal")) || null;
let genres = JSON.parse(localStorage.getItem("genres")) || ["投資", "副業", "ポイ活", "生活費", "シミュレーション"];

// 投資カテゴリ（資産割合グラフ用の固定ラベル）
const investmentCategories = ["投資信託", "米国株", "日本株", "米国ETF", "日本ETF"];

// Undo 機能
let previousState = null;

/**
 * 現在の状態をスナップショット保存（Undo 用）
 */
function takeSnapshot() {
  previousState = {
    entries: JSON.parse(JSON.stringify(entries)),
    goal: goal ? { ...goal } : null,
    genres: [...genres]
  };
}

/**
 * スナップショットに戻す
 */
function undo() {
  if (!previousState) return;
  entries = previousState.entries;
  goal = previousState.goal;
  genres = previousState.genres;
  previousState = null;
  saveData();
  renderLists();
  renderGoal();
  updateSummary();
  updateGenreSelects();
  showToast("✅ 元に戻しました", "info");
}
window.undo = undo;

// ローカル保存（localStorage + Firebase）
async function saveData() {
  // localStorage に保険として保存
  try {
    localStorage.setItem("entries", JSON.stringify(entries));
    localStorage.setItem("goal", JSON.stringify(goal));
    localStorage.setItem("genres", JSON.stringify(genres));
  } catch (e) {
    console.error("localStorage 保存エラー（容量超過の可能性）:", e);
    showToast("⚠️ ローカルストレージの容量が不足しています。", "error");
  }
  // Firebase にも保存
  await saveDataToFirebase();
}

// トースト通知
/**
 * トーストを画面右下に表示する
 * @param {string} message - 表示メッセージ
 * @param {"undo"|"error"|"info"} type - スタイル種別
 * @param {number} duration - 自動消去ミリ秒（0なら消えない）
 * @returns {HTMLElement} - 作成されたトースト要素
 */
function showToast(message, type = "info", duration = 5000) {
  const container = document.getElementById("toast-container");
  if (!container) return null;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const msgSpan = document.createElement("span");
  msgSpan.textContent = message;
  toast.appendChild(msgSpan);

  // Undo ボタン
  if (type === "undo") {
    const undoBtn = document.createElement("button");
    undoBtn.className = "toast-undo-btn";
    undoBtn.textContent = "元に戻す";
    undoBtn.onclick = () => {
      undo();
      removeToast(toast);
    };
    toast.appendChild(undoBtn);
  }

  // 閉じるボタン
  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close-btn";
  closeBtn.textContent = "✕";
  closeBtn.onclick = () => removeToast(toast);
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
  const newG = document.getElementById("newGenre").value.trim();
  if (newG && !genres.includes(newG)) {
    genres.push(newG);
    updateGenreSelects();
    saveData();
  }
  document.getElementById("newGenre").value = "";
}
window.addGenre = addGenre;

function editGenre() {
  const select = document.getElementById("genreSelect");
  const oldName = select.value;
  if (!oldName) return;

  const newName = prompt("新しいジャンル名を入力してください:", oldName);
  if (newName && !genres.includes(newName)) {
    genres = genres.map(g => g === oldName ? newName : g);
    entries = entries.map(e => e.genre === oldName ? { ...e, genre: newName } : e);
    saveData();
    updateGenreSelects();
    renderLists();
    alert(`「${oldName}」を「${newName}」に変更しました`);
  }
}
window.editGenre = editGenre;

function deleteGenre() {
  const select = document.getElementById("genreSelect");
  const target = select.value;
  if (!target) return;

  if (confirm(`ジャンル「${target}」を削除しますか？\n※このジャンルの収支データもすべて削除されます。`)) {
    takeSnapshot(); // ← Undo 用スナップショット
    genres = genres.filter(g => g !== target);
    entries = entries.filter(e => e.genre !== target);
    saveData();
    updateGenreSelects();
    renderLists();
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
      sel.appendChild(opt);
    });
  });
}

// 目標設定
function setGoal() {
  const name = document.getElementById("goalName").value;
  const amount = parseInt(document.getElementById("goalAmount").value);
  const period = parseInt(document.getElementById("goalPeriod").value);
  if (!name || !amount || !period) { alert("目標名・金額・期間を入力してください"); return; }
  goal = { name, amount, period };
  saveData();
  renderGoal();
  updateSummary();
}
window.setGoal = setGoal;

// 収支入力
function addEntry() {
  const genre = document.getElementById("genre").value;
  const type = document.getElementById("type").value;
  const amount = parseInt(document.getElementById("amount").value);
  const memo = document.getElementById("memo").value || "-";
  const date = new Date().toISOString();

  let investmentCategory = null;
  let investmentPlan = null;
  if (genre === "投資") {
    investmentCategory = document.getElementById("investmentCategory")?.value || null;
    investmentPlan = document.getElementById("investmentPlan")?.value || null;
  }

  if (!amount) { alert("金額を入力してください"); return; }

  const existing = entries.find(e =>
    e.genre === genre &&
    e.memo === memo &&
    e.type === type &&
    (e.investmentCategory || null) === investmentCategory &&
    (e.investmentPlan || null) === investmentPlan
  );
  if (existing) existing.amount += amount;
  else entries.push({ genre, type, amount, memo, date, investmentCategory, investmentPlan });

  saveData();
  renderLists();
  updateSummary();

  document.getElementById("amount").value = "";
  document.getElementById("memo").value = "";
}
window.addEntry = addEntry;

// 削除（Undo 対応）
function deleteEntry(index) {
  takeSnapshot(); // ← Undo 用スナップショット
  entries.splice(index, 1);
  saveData();
  renderLists();
  updateSummary();
  showToast("🗑️ 収支を削除しました", "undo");
}
window.deleteEntry = deleteEntry;

// 履歴レンダリング
function renderLists() {
  const container = document.getElementById("entryLists");
  container.innerHTML = "";
  const grouped = {};
  entries.forEach((entry, index) => {
    if (!grouped[entry.genre]) grouped[entry.genre] = [];
    grouped[entry.genre].push({ ...entry, index });
  });

  for (let genre in grouped) {
    const div = document.createElement("div");
    div.className = "genre-list";
    div.innerHTML = `<h3>${genre}</h3>`;
    const ul = document.createElement("ul");

    grouped[genre].forEach(e => {
      const dateStr = new Date(e.date).toLocaleDateString("ja-JP");
      const li = document.createElement("li");
      li.innerHTML = `<span>${dateStr} | ${e.type === "income" ? "収入" : "支出"}: ${e.amount}円 (${e.memo})</span>
                      <button class="delete-btn" onclick="deleteEntry(${e.index})">削除</button>`;
      ul.appendChild(li);
    });

    div.appendChild(ul);
    container.appendChild(div);
  }
}

// 集計
function updateSummary() {
  const nowMonth = new Date().getMonth() + 1;
  const monthlyEntries = entries.filter(e => (new Date(e.date).getMonth() + 1) === nowMonth);

  const totalIncome = monthlyEntries.filter(e => e.type === "income").reduce((sum, e) => sum + e.amount, 0);
  const totalExpense = monthlyEntries.filter(e => e.type === "expense").reduce((sum, e) => sum + e.amount, 0);
  const balance = totalIncome - totalExpense;

  document.getElementById("totalIncome").textContent = totalIncome;
  document.getElementById("totalExpense").textContent = totalExpense;
  document.getElementById("balance").textContent = balance;

  if (goal) {
    const progressPercent = Math.min((balance / goal.amount) * 100, 100);
    document.getElementById("progress").style.width = progressPercent + "%";
    document.getElementById("goalRate").textContent = Math.floor(progressPercent);
  }
}

// 目標表示
function renderGoal() {
  if (goal) {
    document.getElementById("goalDisplay").textContent =
      `目標: ${goal.name} (${goal.amount}円 / ${goal.period}年)`;
  } else {
    document.getElementById("goalDisplay").textContent = "目標未設定";
  }
}

// セクション開閉
function toggleSection(id) {
  const target = document.getElementById(id);
  const section = target.parentElement;

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
  const isHidden = section.style.display === "none";
  section.style.display = isHidden ? "flex" : "none";
  localStorage.setItem("calculator_visible", isHidden ? "true" : "false");
}
window.toggleCalculator = toggleCalculator;

function restoreCalculator(defaultDisplay = "flex") {
  const section = document.getElementById("calculatorInput");
  const saved = localStorage.getItem("calculator_visible");
  section.style.display = (saved === "true") ? defaultDisplay : "none";
}

// 比較・差額シミュレーション
function toggleInterestFields() {
  const genre = document.getElementById("compareGenre").value;
  const interestFields = document.getElementById("interestFields");
  interestFields.style.display = (genre === "投資") ? "block" : "none";
}
window.toggleInterestFields = toggleInterestFields;

function toggleInvestmentMode() {
  const mode = document.getElementById("investmentMode").value;
  const yearsLabel = document.getElementById("compareYearsLabel");
  yearsLabel.textContent = "運用期間 (年) ";
  // モードによって表示を分けたい場合はここで分岐可能
}
window.toggleInvestmentMode = toggleInvestmentMode;

function calculateCompare() {
  const genre = document.getElementById("compareGenre").value;
  const mode = document.getElementById("investmentMode").value;
  const aAmount = parseFloat(document.getElementById("aAmount").value) || 0;
  const bAmount = parseFloat(document.getElementById("bAmount").value) || 0;
  const years = parseFloat(document.getElementById("compareYears").value) || 1;
  const aRate = (parseFloat(document.getElementById("aRate").value) || 0) / 100;
  const bRate = (parseFloat(document.getElementById("bRate").value) || 0) / 100;

  let aTotal = aAmount, bTotal = bAmount;

  if (genre === "投資") {
    const months = years * 12;

    if (mode === "once") {
      aTotal = aAmount * Math.pow(1 + aRate, years);
      bTotal = bAmount * Math.pow(1 + bRate, years);
    } else if (mode === "monthly") {
      const aMonthlyRate = aRate / 12;
      const bMonthlyRate = bRate / 12;
      // ゼロ除算ガード
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
  document.getElementById("differenceResult").innerHTML = `
    <h3>結果 (${genre} - ${mode === "once" ? "1回投資" : mode === "monthly" ? "毎月投資" : "年1回投資"})</h3>
    <p>期間: ${years} 年</p>
    <p>Aプラン最終額: <strong>${Math.round(aTotal).toLocaleString()}</strong> 円</p>
    <p>Bプラン最終額: <strong>${Math.round(bTotal).toLocaleString()}</strong> 円</p>
    <p>差額: <strong>${Math.round(diff).toLocaleString()}</strong> 円</p>
  `;
}
window.calculateCompare = calculateCompare;

// 月別・年別集計
function getEntriesByMonth(year, month) {
  return entries.filter(e => {
    const d = new Date(e.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

function getEntriesByYear(year) {
  return entries.filter(e => {
    const d = new Date(e.date);
    return d.getFullYear() === year;
  });
}

function showMonthlySummary(year, month) {
  const monthly = getEntriesByMonth(year, month);
  const income = monthly.filter(e => e.type === "income").reduce((s, e) => s + e.amount, 0);
  const expense = monthly.filter(e => e.type === "expense").reduce((s, e) => s + e.amount, 0);
  const balance = income - expense;
  alert(`${year}年${month + 1}月\n収入: ${income}円\n支出: ${expense}円\n残高: ${balance}円`);
}
window.showMonthlySummary = showMonthlySummary;

function showYearlySummary(year) {
  const yearly = getEntriesByYear(year);
  const income = yearly.filter(e => e.type === "income").reduce((s, e) => s + e.amount, 0);
  const expense = yearly.filter(e => e.type === "expense").reduce((s, e) => s + e.amount, 0);
  const balance = income - expense;
  alert(`${year}年\n収入: ${income}円\n支出: ${expense}円\n残高: ${balance}円`);
}
window.showYearlySummary = showYearlySummary;

// ============================================================
// 電卓（eval を安全パーサーに置き換え）
// ============================================================
let calcValue = "0";
let calcHistory = JSON.parse(localStorage.getItem("calcHistory")) || [];

function updateDisplay() {
  document.getElementById("display").value = calcValue;
}

function press(key) {
  if (calcValue === "0") calcValue = "";
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
 * 安全な数式評価（eval を使わない独自パーサー）
 * 許可トークン: 数字, ., +, -, *, /, (, )
 * @param {string} expr - 数式文字列
 * @returns {number} - 計算結果
 * @throws {Error} - 不正な式の場合
 */
function safeEval(expr) {
  // 許可されていない文字が含まれていたら即エラー
  if (/[^0-9+\-*/().\s]/.test(expr)) {
    throw new Error("不正な文字が含まれています");
  }
  // Function コンストラクタで strict モード評価（グローバルスコープから分離）
  // eslint-disable-next-line no-new-func
  const result = new Function('"use strict"; return (' + expr + ')')();
  if (typeof result !== "number" || !isFinite(result)) {
    throw new Error("計算結果が無効です");
  }
  return result;
}

function calculate() {
  try {
    const result = safeEval(calcValue);
    calcHistory.unshift({ expr: calcValue, result });
    saveCalcHistory();
    renderHistory();
    calcValue = result.toString();
    updateDisplay();
  } catch {
    alert("計算エラー：不正な式です");
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
  container.innerHTML = "";
  calcHistory.forEach((h, i) => {
    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `
      <span>${h.expr} = ${h.result}</span>
      <button onclick="deleteHistory(${i})">削除</button>
    `;
    container.appendChild(div);
  });
}

function deleteHistory(index) {
  calcHistory.splice(index, 1);
  saveCalcHistory();
  renderHistory();
}
window.deleteHistory = deleteHistory;

// ============================================================
// 積立投資シミュレーション（ゼロ除算ガード対応）
// ============================================================
function switchInvestMode() {
  const mode = document.getElementById("investMode").value;
  const monthlyField = document.getElementById("monthlyInvestment").parentElement;
  const yearsField = document.getElementById("years").parentElement;
  const targetField = document.getElementById("targetFields");

  monthlyField.style.display = "flex";
  yearsField.style.display = "flex";
  targetField.style.display = "none";

  if (mode === "target") {
    monthlyField.style.display = "none";
    targetField.style.display = "flex";
  } else if (mode === "period") {
    yearsField.style.display = "none";
    targetField.style.display = "flex";
  }
}
window.switchInvestMode = switchInvestMode;

function simulateInvestment() {
  const mode = document.getElementById("investMode").value;
  const initial = parseFloat(document.getElementById("initialInvestment").value) || 0;
  const monthly = parseFloat(document.getElementById("monthlyInvestment").value) || 0;
  const years = parseFloat(document.getElementById("years").value) || 0;
  const target = parseFloat(document.getElementById("targetAmount").value) || 0;
  const annualRate = (parseFloat(document.getElementById("annualRate").value) || 0) / 100;
  const riskRate = (parseFloat(document.getElementById("riskRate").value) || 0) / 100;

  const months = years * 12;

  /**
   * 将来価値計算（ゼロ除算ガード付き）
   * @param {number} rate - 年利（小数）
   * @returns {number}
   */
  const calcFutureValue = (rate) => {
    const monthlyRate = rate / 12;
    if (monthlyRate === 0) {
      // 年利0% → 単純積算
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
      // ゼロ除算ガード：単純積算で逆算
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

  document.getElementById("investmentResult").innerHTML = resultText;
}
window.simulateInvestment = simulateInvestment;

// ============================================================
// グラフ描画
// ============================================================
function renderInvestChart(labels, values) {
  const ctx = document.getElementById("investChart");
  if (!ctx) return;
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

// ============================================================
// Vision / FIRE 目標
// ============================================================
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
  if (!ctx) return;

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

  const listEl = document.getElementById("asset-detail-list");
  if (listEl) {
    listEl.innerHTML = labels.map((l, i) =>
      `<div class="history-item"><span>${l}</span><span>¥${values[i].toLocaleString()}</span></div>`
    ).join("");
  }
}

let budgetChart = null;
function updateBudgetVisuals(spent, remainingAmount) {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const remainingDays = lastDay - now.getDate() + 1;

  // 引数がない場合は自前で計算
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
// 投資ジャンル選択時の追加入力欄
// ============================================================
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

// ============================================================
// ページロード時の初期化
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  restoreCalculator("none");
  renderHistory();
  updateDisplay();
  updateGenreSelects();
  renderLists();
  renderGoal();
  updateSummary();
  updateFireCountdown();
  updateBudgetVisuals();
  updateAssetVisuals();
  updateTotalAssets();
});

// Firebase 初期化を起動（非同期）
initFirebase();
