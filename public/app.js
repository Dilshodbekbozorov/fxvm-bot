const app = document.querySelector(".app");
const balanceEl = document.getElementById("balance");
const statusEl = document.getElementById("status");
const cooldownEl = document.getElementById("cooldown");
const userNameEl = document.getElementById("userName");
const tierEl = document.getElementById("tier");
const hintEl = document.getElementById("hint");
const coinButton = document.getElementById("coinButton");

const tg = window.Telegram ? window.Telegram.WebApp : null;
const initData = tg ? tg.initData : "";
const initDataUnsafe = tg ? tg.initDataUnsafe : null;
const urlParams = new URLSearchParams(window.location.search);
const apiParam = urlParams.get("api");
const API_BASE = (apiParam || window.location.origin).replace(/\/$/, "");

let cooldownTimer = null;
let remainingSeconds = 0;
let pending = false;

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setCooldown(seconds) {
  remainingSeconds = seconds;
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = null;
  }
  if (remainingSeconds <= 0) {
    cooldownEl.textContent = "";
    return;
  }
  cooldownEl.textContent = `Next mine in ${remainingSeconds}s`;
  cooldownTimer = setInterval(() => {
    remainingSeconds -= 1;
    if (remainingSeconds <= 0) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      cooldownEl.textContent = "";
      return;
    }
    cooldownEl.textContent = `Next mine in ${remainingSeconds}s`;
  }, 1000);
}

function showGain(amount) {
  const gain = document.createElement("div");
  gain.className = "gain";
  gain.textContent = `+${amount} FX`;
  const coinRect = coinButton.getBoundingClientRect();
  const appRect = app.getBoundingClientRect();
  gain.style.left = `${coinRect.left - appRect.left + coinRect.width / 2}px`;
  gain.style.top = `${coinRect.top - appRect.top + 20}px`;
  app.appendChild(gain);
  setTimeout(() => gain.remove(), 1100);
}

async function callApi(path) {
  const postRequest = async () => {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": initData,
      },
      body: JSON.stringify({ initData }),
    });
    return await response.json();
  };

  const getRequest = async () => {
    const url = new URL(`${API_BASE}${path}`);
    url.searchParams.set("initData", initData);
    const response = await fetch(url.toString());
    return await response.json();
  };

  try {
    return await postRequest();
  } catch (err) {
    try {
      return await getRequest();
    } catch (err2) {
      return { ok: false, error: "network" };
    }
  }
}

async function loadProfile() {
  if (!initData) {
    setStatus("Open this page from the Telegram bot.", true);
    return;
  }
  if (apiParam) {
    setStatus("Connected to FX-VM backend");
  }
  const data = await callApi("/api/profile");
  if (!data.ok) {
    setStatus(
      data.error === "network"
        ? "Network error. Check connection."
        : "Auth failed. Re-open from Telegram.",
      true
    );
    return;
  }
  const name =
    data.user.username ||
    [data.user.first_name, data.user.last_name].filter(Boolean).join(" ") ||
    `ID:${data.user.id}`;
  userNameEl.textContent = name;
  balanceEl.textContent = formatNumber(data.balance);
  tierEl.textContent = data.premium ? "Premium" : "Silver";
  hintEl.textContent = data.premium
    ? "Premium active"
    : "Premium gives 2x mining";
  setStatus("Tap the coin to mine");
  setCooldown(data.remainingSeconds || 0);
}

async function mine() {
  if (pending) {
    return;
  }
  pending = true;
  const data = await callApi("/api/mine");
  if (!data.ok) {
    if (data.error === "network") {
      setStatus("Network error. Try again.", true);
    } else {
      setStatus("Cooldown active");
    }
    setCooldown(data.remainingSeconds || 0);
  } else {
    balanceEl.textContent = formatNumber(data.balance);
    showGain(data.mined);
    setStatus("Nice tap");
    setCooldown(data.cooldownSeconds || 0);
  }
  pending = false;
}

if (tg) {
  tg.ready();
  tg.expand();
}

coinButton.addEventListener("click", mine);

loadProfile();
