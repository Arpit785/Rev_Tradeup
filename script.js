// ============================================================================
// 1. GLOBAL VARIABLES & STATE
// ============================================================================
const TIER_ORDER = ["Consumer Grade", "Industrial Grade", "Mil-Spec Grade", "Restricted", "Classified", "Covert"];
const RARITY_COLORS = {
  "Industrial Grade": "var(--rarity-industrial)",
  "Mil-Spec Grade": "var(--rarity-milspec)",
  "Restricted": "var(--rarity-restricted)",
  "Classified": "var(--rarity-classified)",
  "Covert": "var(--rarity-covert)"
};
const RARITY_HEX = {
  "Consumer Grade": "#b0c3d9",
  "Industrial Grade": "#5e98d9",
  "Mil-Spec Grade": "#4b69ff",
  "Restricted": "#8847ff",
  "Classified": "#d32ce6",
  "Covert": "#eb4b4b"
};
const CURRENCIES = {
  INR: { symbol: "₹", rate: 88.0 },
  USD: { symbol: "$", rate: 1.0 },
  EUR: { symbol: "€", rate: 0.92 }
};
const WEAR_RANGES = {
  FN: { min: 0.00, max: 0.07 },
  MW: { min: 0.07, max: 0.15 },
  FT: { min: 0.15, max: 0.38 },
  WW: { min: 0.38, max: 0.45 },
  BS: { min: 0.45, max: 1.00 }
};

let allSkins = [];
let validTargetSkins = [];
let selectedTarget = null;
let isStatTrak = false;
let targetCollInputs = [];
let selectedPrimaryIndex = 0;
let secondarySkin = null;

let slots = Array.from({ length: 10 }, () => ({
  skin: null,
  float: 0.05,
  price: null
}));

let priceCache = window.LOCAL_PRICES || {};
let activeOutcomes = [];
let activeSlotDropdown = null;
let currentTotalInputCost = 0; 
let simStats = { runs: 0, wins: 0, losses: 0, profit: 0, invested: 0, hits: {} }; 
let currentSimBatchSize = 1;


// ============================================================================
// 2. INITIALIZATION & DATABASE LOADING
// ============================================================================
if (document.readyState === 'loading') { 
    document.addEventListener('DOMContentLoaded', initApp); 
} else { 
    initApp(); 
}

function initApp() {
    loadSkins();
    setupStickyFooter();
}

async function loadSkins() {
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = "Checking local browser cache...";
    try {
        const cachedData = localStorage.getItem("CS2_SKINS_DB");
        if (cachedData) {
            const parsed = JSON.parse(cachedData);
            if (Array.isArray(parsed) && parsed.length > 0) { processLoadedSkins(parsed); return; }
        }
    } catch (e) { localStorage.removeItem("CS2_SKINS_DB"); }

    if (statusEl) statusEl.textContent = "Downloading skin database...";
    const endpoints = ["https://raw.githubusercontent.com/ByMyKel/CSGO-API/main/public/api/en/skins.json", "https://bymykel.github.io/CSGO-API/api/en/skins.json", "https://cdn.jsdelivr.net/gh/ByMyKel/CSGO-API@main/public/api/en/skins.json"];
    for (const url of endpoints) {
        try {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) continue;
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                localStorage.setItem("CS2_SKINS_DB", JSON.stringify(data));
                processLoadedSkins(data);
                return;
            }
        } catch (err) {}
    }
    if (statusEl) statusEl.textContent = "Failed to load database. Check internet connection.";
}

function processLoadedSkins(data) {
    allSkins = data;
    validTargetSkins = data.filter(s => s && s.rarity && ["Industrial Grade", "Mil-Spec Grade", "Restricted", "Classified", "Covert"].includes(s.rarity.name) && Array.isArray(s.collections) && s.collections.length > 0 && s.min_float !== null && s.max_float !== null);
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = `Ready: ${validTargetSkins.length} skins & ${Object.keys(priceCache || {}).length.toLocaleString()} prices loaded.`;
    updatePriceTimestampDisplay();
    checkUrlHashLoad();
}

function formatTimeAgo(dateInput) {
    if (!dateInput) return null;
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return String(dateInput);
    const diffMs = Date.now() - date.getTime();
    if (diffMs < 0) return "Just now";
    const diffSec = Math.floor(diffMs / 1000), diffMin = Math.floor(diffSec / 60), diffHr = Math.floor(diffMin / 60), diffDays = Math.floor(diffHr / 24);
    if (diffSec < 60) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${diffDays}d ago`;
}

function updatePriceTimestampDisplay() {
    const badge = document.getElementById("priceTimestampBadge");
    if (!badge) return;
    const rawTimestamp = window.PRICES_UPDATED_AT || window.LOCAL_PRICES_TIMESTAMP || priceCache._timestamp || priceCache._updated_at || null;
    if (rawTimestamp) { badge.textContent = `⚡ Prices: ${formatTimeAgo(rawTimestamp)}`; badge.style.display = "inline-flex"; } 
    else if (Object.keys(priceCache).length > 0) { badge.textContent = `⚡ Cache Active`; badge.style.display = "inline-flex"; } 
    else { badge.style.display = "none"; }
}

function getCSFloatSearchUrl(marketHashName, minFloat, maxFloat) {
    const params = new URLSearchParams();
    params.set("market_hash_name", marketHashName);
    if (minFloat !== undefined && minFloat !== null) params.set("min_float", Number(minFloat).toFixed(4));
    if (maxFloat !== undefined && maxFloat !== null) params.set("max_float", Number(maxFloat).toFixed(4));
    params.set("sort_by", "lowest_price");
    return `https://csfloat.com/search?${params.toString()}`;
}

function getWearName(floatVal) {
    if (floatVal < 0.07) return "Factory New";
    if (floatVal < 0.15) return "Minimal Wear";
    if (floatVal < 0.38) return "Field-Tested";
    if (floatVal < 0.45) return "Well-Worn";
    return "Battle-Scarred";
}

function getMarketHash(skinName, wear) { return `${isStatTrak ? "StatTrak™ " : ""}${skinName} (${wear})`; }
function getSteamMarketUrl(marketHashName) { return `https://steamcommunity.com/market/listings/730/${encodeURIComponent(marketHashName)}`; }

function getSourceInfo(skin) {
    const coll = skin.collections && skin.collections[0] ? skin.collections[0].name : "";
    const crate = skin.crates && skin.crates[0] ? skin.crates[0].name : "";
    if (coll && crate) return `${coll} &bull; ${crate}`;
    if (coll) return coll;
    if (crate) return crate;
    return "Standard Weapon Drop";
}

function getActiveCurrency() { const curSelect = document.getElementById("currencySelect"); return CURRENCIES[curSelect ? curSelect.value : "INR"] || CURRENCIES.INR; }
function formatMoney(amount) { if (isNaN(amount) || amount === null) return "N/A"; return `${getActiveCurrency().symbol}${amount.toFixed(2)}`; }
function targetRarity(s) { return (s && s.rarity) ? s.rarity.name : ""; }

function getNormalizedTarget() {
    if (!selectedTarget) return 0;
    const maxLimit = parseFloat(document.getElementById("wearMaxInput").value) || 0.38;
    const bufferVal = parseFloat(document.getElementById("bufferSelect")?.value ?? "0.0005");
    const minF = selectedTarget.min_float ?? 0.00, maxF = selectedTarget.max_float ?? 1.00;
    if (maxF === minF) return 0;
    return Math.max(0, Math.min(1, (Math.max(minF, maxLimit - bufferVal) - minF) / (maxF - minF)));
}

function toggleSection(wrapperId, chevronId) {
    const wrapper = document.getElementById(wrapperId);
    const chevron = document.getElementById(chevronId);
    if (!wrapper || !chevron) return;
    if (wrapper.style.display === "none") { wrapper.style.display = ""; chevron.classList.remove("collapsed"); } 
    else { wrapper.style.display = "none"; chevron.classList.add("collapsed"); }
}

function setupStickyFooter() {
    const mainFinancialGrid = document.getElementById('mainFinancialGrid');
    const stickyFooter = document.getElementById('stickyFooter');
    if (!mainFinancialGrid || !stickyFooter) return;
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting && entry.boundingClientRect.top < 0) { stickyFooter.classList.add('visible'); } 
            else { stickyFooter.classList.remove('visible'); }
        });
    }, { threshold: 0 });
    observer.observe(mainFinancialGrid);
}

function toggleStatTrak() {
    isStatTrak = !isStatTrak;
    const btn = document.getElementById("stToggle");
    if (btn) btn.classList.toggle("active", isStatTrak);
    onSettingChange();
}

function onCurrencyChange() {
    if (!selectedTarget) return;
    const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget));
    if (tIdx <= 0) return;
    renderEligibleInputs(TIER_ORDER[tIdx - 1], getNormalizedTarget());
    renderSlotCards(TIER_ORDER[tIdx - 1]);
    renderOutcomeCards();
    updateFinancials();
}

function onSettingChange() {
    if (selectedTarget) {
        const targetNorm = getNormalizedTarget();
        const cur = getActiveCurrency();
        slots.forEach(slot => {
            if (slot.skin) {
                const sMin = slot.skin.min_float ?? 0, sMax = slot.skin.max_float ?? 1;
                slot.float = parseFloat(((targetNorm * (sMax - sMin)) + sMin).toFixed(4));
                const hash = getMarketHash(slot.skin.name, getWearName(slot.float));
                slot.price = priceCache[hash] ? parseFloat((priceCache[hash] * cur.rate).toFixed(2)) : null;
            }
        });
        const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget));
        if (tIdx > 0) renderSlotCards(TIER_ORDER[tIdx - 1]);
    }
    runCalculation();
}

function goHome() {
    selectedTarget = null; selectedPrimaryIndex = 0; secondarySkin = null; isStatTrak = false;
    const stBtn = document.getElementById("stToggle"); if (stBtn) stBtn.classList.remove("active");
    const inputEl = document.getElementById("skinInput"); if (inputEl) inputEl.value = "";
    document.getElementById("exteriorSelect").value = "FT";
    document.getElementById("wearMinInput").value = "0.1500";
    document.getElementById("wearMaxInput").value = "0.3800";
    document.getElementById("bufferSelect").value = "0.0005";
    updateWearPointers();
    const dropEl = document.getElementById("dropdownResults"); if (dropEl) { dropEl.style.display = "none"; dropEl.innerHTML = ""; }
    const resSection = document.getElementById("resultSection"); if (resSection) resSection.style.display = "none";
    history.replaceState(null, "", window.location.pathname);
}

function onExteriorChange() {
    const val = document.getElementById("exteriorSelect").value;
    if (val && WEAR_RANGES[val]) { 
        document.getElementById("wearMinInput").value = WEAR_RANGES[val].min.toFixed(4); 
        document.getElementById("wearMaxInput").value = WEAR_RANGES[val].max.toFixed(4); 
    }
    updateWearPointers(); onSettingChange();
}

function onCustomWearInput() {
    const minVal = parseFloat(document.getElementById("wearMinInput").value) || 0;
    const maxVal = parseFloat(document.getElementById("wearMaxInput").value) || 1;
    let matched = "CUSTOM";
    for (const [key, range] of Object.entries(WEAR_RANGES)) { 
        if (Math.abs(minVal - range.min) < 0.0005 && Math.abs(maxVal - range.max) < 0.0005) { matched = key; break; } 
    }
    document.getElementById("exteriorSelect").value = matched; 
    updateWearPointers(); onSettingChange();
}

function updateWearPointers() {
    const minVal = Math.max(0, Math.min(1, parseFloat(document.getElementById("wearMinInput").value) || 0));
    const maxVal = Math.max(0, Math.min(1, parseFloat(document.getElementById("wearMaxInput").value) || 1));
    const cMin = document.getElementById("wearCaretMin"), cMax = document.getElementById("wearCaretMax");
    if (cMin) cMin.style.left = `${(minVal * 100).toFixed(1)}%`; 
    if (cMax) cMax.style.left = `${(maxVal * 100).toFixed(1)}%`;
}

function updatePresetButtons() {
    if (!selectedTarget) return;
    const tColl = selectedTarget.collections[0].name;
    const primaryCount = slots.filter(s => s.skin && s.skin.collections[0].name === tColl).length;
    document.querySelectorAll(".preset-btn").forEach(btn => { 
        if (btn.classList.contains('btn-clear-all')) return;
        if (parseInt(btn.getAttribute("data-count")) === primaryCount) btn.classList.add("active"); 
        else btn.classList.remove("active"); 
    });
}

function ensureFillerSkinExists(inputTier) {
    if (!secondarySkin && selectedTarget) {
        const tColl = selectedTarget.collections[0].name;
        const eligible = allSkins.filter(s => s.rarity && s.rarity.name === inputTier && s.collections && s.collections.length > 0 && s.min_float !== null && s.max_float !== null);
        secondarySkin = eligible.find(s => s.collections[0].name !== tColl) || eligible[0];
    }
}

function clearAllSlots() {
    slots.forEach(slot => { slot.skin = null; slot.float = 0.05; slot.price = null; });
    selectedPrimaryIndex = 0; secondarySkin = null;
    if (selectedTarget) {
        const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget));
        if (tIdx > 0) { const inputTier = TIER_ORDER[tIdx - 1]; renderSlotCards(inputTier); computeAndRenderOutcomes(inputTier); }
    }
    updatePresetButtons(); updateUrlHash();
}

function applySplitPreset(primaryCount) {
    const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget)); if (tIdx <= 0) return;
    const inputTier = TIER_ORDER[tIdx - 1]; ensureFillerSkinExists(inputTier);
    const targetNormalized = getNormalizedTarget();
    const pSkin = targetCollInputs[selectedPrimaryIndex];
    const cur = getActiveCurrency();
    const pMin = pSkin ? (pSkin.min_float ?? 0) : 0, pMax = pSkin ? (pSkin.max_float ?? 1) : 1;
    const sMin = secondarySkin ? (secondarySkin.min_float ?? 0) : 0, sMax = secondarySkin ? (secondarySkin.max_float ?? 1) : 1;
    const pFloat = parseFloat(((targetNormalized * (pMax - pMin)) + pMin).toFixed(4));
    const sFloat = parseFloat(((targetNormalized * (sMax - sMin)) + sMin).toFixed(4));

    for (let i = 0; i < 10; i++) {
        let skin = i < primaryCount ? pSkin : secondarySkin;
        let flt = i < primaryCount ? pFloat : sFloat;
        slots[i].skin = skin; slots[i].float = flt;
        if (skin) {
            let hash = getMarketHash(skin.name, getWearName(flt));
            slots[i].price = priceCache[hash] ? parseFloat((priceCache[hash] * cur.rate).toFixed(2)) : null;
        }
    }
    updatePresetButtons(); renderSlotCards(inputTier); computeAndRenderOutcomes(inputTier); updateUrlHash();
}

function applyMultiCheapestFiller() {
    if (!selectedTarget) return;
    const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget)); if (tIdx <= 0) return;
    const inputTier = TIER_ORDER[tIdx - 1], tColl = selectedTarget.collections[0].name, cur = getActiveCurrency(), targetNorm = getNormalizedTarget();
    const cFillers = allSkins.filter(s => s.rarity && s.rarity.name === inputTier && s.collections && s.collections.length > 0 && s.collections[0].name !== tColl && s.min_float !== null && s.max_float !== null);
    if (cFillers.length === 0) return;

    const pricedFillers = [];
    cFillers.forEach(s => {
        let minF = s.min_float ?? 0, maxF = s.max_float ?? 1, dFloat = minF + (maxF - minF) * targetNorm;
        let priceUSD = priceCache[getMarketHash(s.name, getWearName(dFloat))];
        if (priceUSD !== undefined && priceUSD !== null && !isNaN(priceUSD)) pricedFillers.push({ skin: s, priceUSD, dFloat });
    });
    pricedFillers.sort((a, b) => a.priceUSD - b.priceUSD);
    
    const topFillers = [], seen = new Set();
    for (const item of pricedFillers) { if (!seen.has(item.skin.name)) { seen.add(item.skin.name); topFillers.push(item); if (topFillers.length >= 4) break; } }
    if (topFillers.length === 0) return;
    secondarySkin = topFillers[0].skin;

    let pCount = slots.filter(s => s.skin && s.skin.collections[0].name === tColl).length;
    if (pCount >= 10 || pCount === 0) pCount = 1;
    
    const pSkin = targetCollInputs[selectedPrimaryIndex] || targetCollInputs[0];
    const pMin = pSkin ? (pSkin.min_float ?? 0) : 0, pMax = pSkin ? (pSkin.max_float ?? 1) : 1;
    const pFloat = parseFloat(((targetNorm * (pMax - pMin)) + pMin).toFixed(4));
    const pPriceLocal = pSkin && priceCache[getMarketHash(pSkin.name, getWearName(pFloat))] !== undefined ? parseFloat((priceCache[getMarketHash(pSkin.name, getWearName(pFloat))] * cur.rate).toFixed(2)) : null;

    for (let i = 0; i < 10; i++) {
        if (i < pCount) { 
            slots[i].skin = pSkin; slots[i].float = pFloat; slots[i].price = pPriceLocal; 
        } else {
            let fEntry = topFillers[(i - pCount) % topFillers.length];
            let fMin = fEntry.skin.min_float ?? 0, fMax = fEntry.skin.max_float ?? 1;
            let fFloat = parseFloat(((targetNorm * (fMax - fMin)) + fMin).toFixed(4));
            let fPriceUSD = priceCache[getMarketHash(fEntry.skin.name, getWearName(fFloat))];
            slots[i].skin = fEntry.skin; slots[i].float = fFloat; slots[i].price = fPriceUSD !== undefined && fPriceUSD !== null ? parseFloat((fPriceUSD * cur.rate).toFixed(2)) : null;
        }
    }
    updatePresetButtons(); renderSlotCards(inputTier); computeAndRenderOutcomes(inputTier); updateUrlHash();
}

function applyBudgetFiller() {
    if (!selectedTarget) return;
    const budgetInput = document.getElementById("budgetInput").value;
    const budgetLimit = parseFloat(budgetInput);
    if (isNaN(budgetLimit) || budgetLimit <= 0) return alert("Please enter a valid target budget.");

    const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget)); 
    if (tIdx <= 0) return;
    const inputTier = TIER_ORDER[tIdx - 1], tColl = selectedTarget.collections[0].name, cur = getActiveCurrency(), targetNorm = getNormalizedTarget();
    
    let pCount = slots.filter(s => s.skin && s.skin.collections[0].name === tColl).length;
    if (pCount >= 10 || pCount === 0) pCount = 1;
    
    const pSkin = targetCollInputs[selectedPrimaryIndex] || targetCollInputs[0];
    const pMin = pSkin ? (pSkin.min_float ?? 0) : 0, pMax = pSkin ? (pSkin.max_float ?? 1) : 1;
    const pFloat = parseFloat(((targetNorm * (pMax - pMin)) + pMin).toFixed(4));
    const pPriceUSD = priceCache[getMarketHash(pSkin.name, getWearName(pFloat))];
    const pPriceLocal = pPriceUSD !== undefined ? pPriceUSD * cur.rate : 0;

    const primaryTotalCost = pPriceLocal * pCount;
    const remainingBudget = budgetLimit - primaryTotalCost;
    const fillerCount = 10 - pCount;
    
    if (remainingBudget <= 0 && fillerCount > 0) {
        return alert(`Your primary skins alone cost ${formatMoney(primaryTotalCost)}, exceeding or eating up the entire budget.`);
    }

    const maxPerFiller = fillerCount > 0 ? (remainingBudget / fillerCount) / cur.rate : 0;
    
    const cFillers = allSkins.filter(s => s.rarity && s.rarity.name === inputTier && s.collections && s.collections.length > 0 && s.collections[0].name !== tColl && s.min_float !== null && s.max_float !== null);
    if (cFillers.length === 0) return;

    const pricedFillers = [];
    cFillers.forEach(s => {
        let minF = s.min_float ?? 0, maxF = s.max_float ?? 1, dFloat = minF + (maxF - minF) * targetNorm;
        let priceUSD = priceCache[getMarketHash(s.name, getWearName(dFloat))];
        if (priceUSD !== undefined && priceUSD !== null && !isNaN(priceUSD) && priceUSD <= maxPerFiller) {
            pricedFillers.push({ skin: s, priceUSD, dFloat });
        }
    });
    
    pricedFillers.sort((a, b) => b.priceUSD - a.priceUSD);
    
    const topFillers = [], seen = new Set();
    for (const item of pricedFillers) { 
        if (!seen.has(item.skin.name)) { seen.add(item.skin.name); topFillers.push(item); if (topFillers.length >= 4) break; } 
    }
    
    if (topFillers.length === 0 && fillerCount > 0) {
         return alert(`Could not find any fillers under the required budget of ${cur.symbol}${(maxPerFiller * cur.rate).toFixed(2)} each.`);
    }
    if (topFillers.length > 0) secondarySkin = topFillers[0].skin;

    for (let i = 0; i < 10; i++) {
        if (i < pCount) { 
            slots[i].skin = pSkin; slots[i].float = pFloat; slots[i].price = pPriceLocal > 0 ? parseFloat(pPriceLocal.toFixed(2)) : null; 
        } else {
            let fEntry = topFillers[(i - pCount) % topFillers.length];
            let fMin = fEntry.skin.min_float ?? 0, fMax = fEntry.skin.max_float ?? 1;
            let fFloat = parseFloat(((targetNorm * (fMax - fMin)) + fMin).toFixed(4));
            let fPriceUSD = priceCache[getMarketHash(fEntry.skin.name, getWearName(fFloat))];
            slots[i].skin = fEntry.skin; slots[i].float = fFloat; slots[i].price = fPriceUSD !== undefined && fPriceUSD !== null ? parseFloat((fPriceUSD * cur.rate).toFixed(2)) : null;
        }
    }
    updatePresetButtons(); renderSlotCards(inputTier); computeAndRenderOutcomes(inputTier); updateUrlHash();
}

function runCalculation() {
    if (!selectedTarget) return;
    const resSection = document.getElementById("resultSection"), noticeBox = document.getElementById("uncraftableNotice");
    const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget));
    
    if (tIdx <= 0) { resSection.style.display = "none"; return; }
    const inputTier = TIER_ORDER[tIdx - 1];

    if (!targetCollInputs || targetCollInputs.length === 0) {
        resSection.style.display = "flex"; noticeBox.style.display = "block";
        noticeBox.innerHTML = `<b>Trade-Up Not Possible:</b> Case collections do not contain any <em>${inputTier}</em> skins for this target.`;
        document.getElementById("eligibleContainer").style.display = "none"; 
        document.getElementById("recipeContainer").style.display = "none"; 
        document.getElementById("outcomesContainer").style.display = "none";
        document.getElementById("statVerdict").textContent = "UNCRAFTABLE"; 
        document.getElementById("statVerdict").className = "stat-value red"; 
        return;
    }

    noticeBox.style.display = "none";
    document.getElementById("eligibleContainer").style.display = "block"; 
    document.getElementById("recipeContainer").style.display = "block"; 
    document.getElementById("outcomesContainer").style.display = "block";
    
    ensureFillerSkinExists(inputTier);
    slots.forEach(slot => { if (!slot.skin) slot.skin = targetCollInputs[selectedPrimaryIndex]; });
    
    renderEligibleInputs(inputTier, getNormalizedTarget()); 
    renderSlotCards(inputTier); 
    computeAndRenderOutcomes(inputTier);
    
    resSection.style.display = "flex"; 
    updateUrlHash();
}

function renderEligibleInputs(inputTier, targetNorm) {
    const container = document.getElementById("eligibleList"); 
    container.innerHTML = "";
    
    const cur = getActiveCurrency();
    const feeVal = document.getElementById("feeSelect")?.value || "0.8696";
    const curCode = document.getElementById("currencySelect") ? document.getElementById("currencySelect").value : "INR";
    const rarityColor = RARITY_COLORS[inputTier] || "var(--accent-cyan)";
    const lowerTierName = TIER_ORDER[TIER_ORDER.indexOf(inputTier) - 1] || null;

    targetCollInputs.forEach((skin, index) => {
        let inMin = skin.min_float ?? 0, inMax = skin.max_float ?? 1;
        let rawCap = Math.min(inMax, (targetNorm * (inMax - inMin)) + inMin);
        let hash = getMarketHash(skin.name, getWearName(rawCap));
        let priceUSD = priceCache[hash];
        let priceDisp = priceUSD !== undefined && priceUSD !== null ? (priceUSD * cur.rate).toFixed(2) : "";
        let canCraft = lowerTierName && allSkins.some(s => s.collections && s.collections.some(c => c.name === skin.collections[0]?.name) && s.rarity && s.rarity.name === lowerTierName);
        let craftHash = `#target=${encodeURIComponent(skin.name)}&wearMax=${rawCap.toFixed(4)}&wearMin=${inMin.toFixed(4)}&st=${isStatTrak ? "1" : "0"}&fee=${feeVal}&cur=${curCode}`;

        const isSel = index === selectedPrimaryIndex;
        const row = document.createElement("div"); 
        row.className = `item-row selectable ${isSel ? "selected" : ""}`;
        row.onclick = (e) => { if (!e.target.closest("a") && !e.target.closest("input")) selectEligiblePrimary(index); };

        row.innerHTML = `
            <div class="item-left">
                <div class="rarity-pill" style="background-color: ${rarityColor}"></div>
                <img class="item-thumb" src="${skin.image || ''}" onerror="this.style.display='none'">
                <div class="item-details">
                    <div class="item-name">${skin.name} <span class="badge" style="color: ${rarityColor}; border: 1px solid ${rarityColor};">${inputTier}</span> ${isStatTrak ? '<span class="badge badge-st">StatTrak™</span>' : ''}</div>
                    <div class="item-source">${getSourceInfo(skin)}</div>
                    <div class="item-subtext">Max Float: &lt; ${rawCap.toFixed(4)} &bull; <b>${getWearName(rawCap)}</b></div>
                </div>
            </div>
            <div class="item-right">
                ${canCraft ? `<a href="${craftHash}" target="_blank" class="craft-link-btn" onclick="event.stopPropagation();">Trade-Up ↗</a>` : ''}
                <a href="${getCSFloatSearchUrl(hash, inMin, rawCap)}" target="_blank" class="csfloat-link-btn" onclick="event.stopPropagation();">CSFloat ↗</a>
                <a href="${getSteamMarketUrl(hash)}" target="_blank" class="market-link-btn" onclick="event.stopPropagation();">Steam Market ↗</a>
                <div class="price-input-group"><span class="currency-symbol">${cur.symbol}</span><input type="number" step="0.01" min="0" class="val-input" id="eligible-price-${index}" placeholder="N/A" value="${priceDisp}" oninput="onEligiblePriceChange(${index}, this.value)"></div>
                <button class="select-btn ${isSel ? "active" : ""}" onclick="event.stopPropagation(); selectEligiblePrimary(${index})">${isSel ? "Using x10" : "Use x10"}</button>
            </div>
        `;
        container.appendChild(row);
    });
}

function selectEligiblePrimary(index) {
    selectedPrimaryIndex = index;
    const pSkin = targetCollInputs[index], cur = getActiveCurrency(), targetNorm = getNormalizedTarget(), tColl = selectedTarget.collections[0].name;
    const pMin = pSkin ? (pSkin.min_float ?? 0) : 0, pMax = pSkin ? (pSkin.max_float ?? 1) : 1;
    const pFloat = parseFloat(((targetNorm * (pMax - pMin)) + pMin).toFixed(4));
    
    slots.forEach(slot => {
        if (slot.skin && slot.skin.collections[0].name === tColl) {
            slot.skin = pSkin; slot.float = pFloat;
            if (pSkin) slot.price = priceCache[getMarketHash(pSkin.name, getWearName(pFloat))] ? parseFloat((priceCache[getMarketHash(pSkin.name, getWearName(pFloat))] * cur.rate).toFixed(2)) : null;
        }
    });
    
    const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget));
    if (tIdx > 0) { 
        renderSlotCards(TIER_ORDER[tIdx - 1]); 
        computeAndRenderOutcomes(TIER_ORDER[tIdx - 1]); 
    }
}

function onEligiblePriceChange(index, val) {
    const num = val === "" ? null : parseFloat(val);
    const cur = getActiveCurrency(), skin = targetCollInputs[index], targetNorm = getNormalizedTarget();
    let inMin = skin.min_float ?? 0, inMax = skin.max_float ?? 1;
    let hash = getMarketHash(skin.name, getWearName(Math.min(inMax, (targetNorm * (inMax - inMin)) + inMin)));
    
    priceCache[hash] = num !== null ? (num / cur.rate) : null;
    
    if (index === selectedPrimaryIndex) {
        slots.forEach((slot, i) => { 
            if (slot.skin && slot.skin.name === skin.name) { 
                slot.price = num; 
                const pEl = document.getElementById(`slot-price-${i}`); 
                if (pEl) pEl.value = num !== null ? num.toFixed(2) : ""; 
            } 
        });
    }
    updateFinancials(); 
    updateUrlHash();
}

function renderSlotCards(inputTier) {
    const container = document.getElementById("slotsGrid"); 
    container.innerHTML = "";
    
    const cur = getActiveCurrency(), pSkin = targetCollInputs[selectedPrimaryIndex], tColl = selectedTarget.collections[0].name;
    if (!pSkin) return;

    const eligSkins = allSkins.filter(s => s.rarity && s.rarity.name === inputTier && s.collections && s.collections.length > 0 && s.min_float !== null && s.max_float !== null);
    const tInputs = eligSkins.filter(s => s.collections[0].name === tColl);
    const oInputs = eligSkins.filter(s => s.collections[0].name !== tColl);
    
    document.getElementById("primarySkinSelect").innerHTML = targetCollInputs.map((s, idx) => `<option value="${idx}" ${idx === selectedPrimaryIndex ? "selected" : ""}>${s.name}</option>`).join("");
    document.getElementById("fillerSkinSelect").innerHTML = oInputs.map(s => `<option value="${s.name}" ${secondarySkin && s.name === secondarySkin.name ? "selected" : ""}>${s.name} (${s.collections[0].name})</option>`).join("");
    
    const lowerTierName = TIER_ORDER[TIER_ORDER.indexOf(inputTier) - 1] || null;

    slots.forEach((slot, i) => {
        const skin = slot.skin || pSkin;
        const isTargetColl = skin && skin.collections[0]?.name === tColl;
        const wearName = getWearName(slot.float);
        const markerPercent = Math.max(0, Math.min(100, slot.float * 100)).toFixed(1);
        const priceDisp = slot.price !== null && !isNaN(slot.price) ? slot.price.toFixed(2) : "";
        const rarityHex = RARITY_HEX[(skin && skin.rarity ? skin.rarity.name : inputTier)] || "#4b69ff";
        const hashName = skin ? getMarketHash(skin.name, wearName) : "";
        const canCraft = lowerTierName && allSkins.some(s => s.collections && s.collections.some(c => c.name === (skin ? skin.collections[0]?.name : "")) && s.rarity && s.rarity.name === lowerTierName);
        
        let optHtml = `<div class="slot-optgroup-label">Target Collection</div>`;
        tInputs.forEach(s => { optHtml += `<div class="slot-opt-item ${skin && s.name === skin.name ? 'selected' : ''}" data-name="${s.name}" onclick="selectSlotSkin(${i}, '${encodeURIComponent(s.name)}')"><span class="slot-opt-name">${s.name}</span></div>`; });
        optHtml += `<div class="slot-optgroup-label">Other Collections</div>`;
        oInputs.forEach(s => { optHtml += `<div class="slot-opt-item ${skin && s.name === skin.name ? 'selected' : ''}" data-name="${s.name}" onclick="selectSlotSkin(${i}, '${encodeURIComponent(s.name)}')"><span class="slot-opt-name">${s.name}</span></div>`; });

        const card = document.createElement("div"); 
        card.className = `slot-card ${isTargetColl ? 'is-target-coll' : 'is-other-coll'}`; 
        card.id = `slot-card-${i}`;
        
        card.innerHTML = `
            <div class="slot-card-header">
                <div style="display: flex; align-items: center; gap: 6px;"><span class="slot-num-badge">SLOT #${i + 1}</span>
                    ${skin ? `<a href="${getSteamMarketUrl(hashName)}" id="slot-steam-${i}" target="_blank" class="slot-steam-link">Steam ↗</a>${canCraft ? `<a href="#target=${encodeURIComponent(skin.name)}&wearMax=${slot.float}" id="slot-tradeup-${i}" target="_blank" class="slot-slot-craft-link">Trade-Up ↗</a>` : ''}` : ''}
                </div>
                <span class="badge ${isTargetColl ? 'badge-best' : 'badge-secondary'}">${isTargetColl ? 'Primary' : 'Filler'}</span>
            </div>
            <div class="slot-thumb-box" style="background: radial-gradient(circle at 50% 60%, ${rarityHex}38 0%, rgba(13, 17, 26, 0.96) 82%); border-bottom: 2px solid ${rarityHex};">
                <img class="slot-thumb" src="${skin ? (skin.image || '') : ''}" onerror="this.style.display='none'">
            </div>
            <div class="slot-picker-wrap">
                <button type="button" class="slot-picker-btn" id="slot-btn-${i}" onclick="toggleSlotDropdown(${i}, event)">
                    <span class="slot-picker-text">${skin ? skin.name : 'Choose Skin'}</span><span class="slot-picker-arrow">▼</span>
                </button>
                <div class="slot-dropdown-panel" id="slot-panel-${i}">
                    <div class="slot-search-box"><input type="text" class="slot-search-input" id="slot-search-${i}" placeholder="Search..." onclick="event.stopPropagation()" oninput="filterSlotOptions(${i}, this.value)"></div>
                    <div class="slot-options-scroll" id="slot-scroll-${i}">${optHtml}</div>
                </div>
            </div>
            <div class="slot-skin-coll">${skin && skin.collections[0] ? skin.collections[0].name : ''}</div>
            <div class="slot-wear-bar-box">
                <div class="slot-wear-bar"><div class="wear-seg-fn"></div><div class="wear-seg-mw"></div><div class="wear-seg-ft"></div><div class="wear-seg-ww"></div><div class="wear-seg-bs"></div></div>
                <div class="slot-wear-marker" id="slot-marker-${i}" style="left: ${markerPercent}%;"></div>
            </div>
            <div class="slot-input-group">
                <div class="slot-input-lbl"><span>Float</span><span id="slot-wear-lbl-${i}" style="color: var(--accent-cyan); font-weight: 800;">${wearName}</span></div>
                <input type="number" step="0.0001" class="slot-input-field" value="${slot.float}" oninput="onSlotFloatChange(${i}, this.value)">
            </div>
            <div class="slot-input-group">
                <div class="slot-input-lbl"><span>Price (${cur.symbol})</span></div>
                <input type="number" step="0.01" class="slot-input-field" id="slot-price-${i}" placeholder="0.00" value="${priceDisp}" oninput="onSlotPriceChange(${i}, this.value)">
            </div>
        `;
        container.appendChild(card);
    });
}

function closeAllSlotDropdowns() { 
    document.querySelectorAll(".slot-dropdown-panel").forEach(p => p.classList.remove("open")); 
    document.querySelectorAll(".slot-picker-btn").forEach(b => b.classList.remove("active")); 
    activeSlotDropdown = null; 
}

function toggleSlotDropdown(idx, e) { 
    if(e) e.stopPropagation(); 
    const p = document.getElementById(`slot-panel-${idx}`); 
    const isOpen = p && p.classList.contains("open"); 
    closeAllSlotDropdowns(); 
    if(!isOpen && p) { 
        p.classList.add("open"); 
        document.getElementById(`slot-btn-${idx}`).classList.add("active"); 
        activeSlotDropdown = idx; 
    } 
}

function filterSlotOptions(idx, q) { 
    const s = document.getElementById(`slot-scroll-${idx}`); 
    if(!s) return; 
    const items = s.querySelectorAll(".slot-opt-item"); 
    items.forEach(i => { i.style.display = (!q || i.getAttribute("data-name").toLowerCase().includes(q.toLowerCase())) ? "flex" : "none"; }); 
}

function selectSlotSkin(idx, name) { 
    closeAllSlotDropdowns(); 
    onIndividualSlotSkinChange(idx, decodeURIComponent(name)); 
}

function onIndividualSlotSkinChange(idx, name) {
    const s = allSkins.find(x => x.name === name); if(!s) return;
    const targetNorm = getNormalizedTarget(); 
    slots[idx].skin = s;
    slots[idx].float = parseFloat(((targetNorm * ((s.max_float ?? 1) - (s.min_float ?? 0))) + (s.min_float ?? 0)).toFixed(4));
    
    const wear = getWearName(slots[idx].float);
    slots[idx].price = priceCache[getMarketHash(s.name, wear)] ? parseFloat((priceCache[getMarketHash(s.name, wear)] * getActiveCurrency().rate).toFixed(2)) : null;
    
    const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget)); 
    if (tIdx > 0) { renderSlotCards(TIER_ORDER[tIdx - 1]); computeAndRenderOutcomes(TIER_ORDER[tIdx - 1]); }
    
    updatePresetButtons(); 
    updateUrlHash();
}

function onPrimarySkinDropdownChange(idx) { selectEligiblePrimary(idx); }

function onFillerSkinDropdownChange(name) {
    secondarySkin = allSkins.find(s => s.name === name);
    const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget)); if (tIdx <= 0) return;
    const inputTier = TIER_ORDER[tIdx - 1], targetNorm = getNormalizedTarget();
    
    slots.forEach(slot => {
        if (slot.skin && slot.skin.collections[0].name !== selectedTarget.collections[0].name) {
            slot.skin = secondarySkin;
            slot.float = parseFloat(((targetNorm * ((secondarySkin.max_float ?? 1) - (secondarySkin.min_float ?? 0))) + (secondarySkin.min_float ?? 0)).toFixed(4));
            slot.price = priceCache[getMarketHash(secondarySkin.name, getWearName(slot.float))] ? parseFloat((priceCache[getMarketHash(secondarySkin.name, getWearName(slot.float))] * getActiveCurrency().rate).toFixed(2)) : null;
        }
    });
    
    renderSlotCards(inputTier); 
    computeAndRenderOutcomes(inputTier); 
    updateUrlHash();
}

function onSlotFloatChange(idx, val) {
    const s = slots[idx].skin;
    const newFloat = isNaN(parseFloat(val)) ? 0.05 : Math.max(s ? (s.min_float ?? 0) : 0, Math.min(s ? (s.max_float ?? 1) : 1, parseFloat(val)));
    slots[idx].float = newFloat;
    
    const wearName = getWearName(newFloat);
    const lbl = document.getElementById(`slot-wear-lbl-${idx}`);
    if (lbl) lbl.textContent = wearName;
    
    const marker = document.getElementById(`slot-marker-${idx}`);
    if (marker) marker.style.left = `${Math.max(0, Math.min(100, newFloat * 100)).toFixed(1)}%`;
    
    if (s) {
        const hashName = getMarketHash(s.name, wearName);
        const steamBtn = document.getElementById(`slot-steam-${idx}`);
        if (steamBtn) steamBtn.href = getSteamMarketUrl(hashName);
        
        const tradeupBtn = document.getElementById(`slot-tradeup-${idx}`);
        if (tradeupBtn) tradeupBtn.href = `#target=${encodeURIComponent(s.name)}&wearMax=${newFloat}`;
    }

    const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget)); 
    if (tIdx > 0) computeAndRenderOutcomes(TIER_ORDER[tIdx - 1]); 
    updateUrlHash();
}

function onSlotPriceChange(idx, val) { 
    slots[idx].price = val === "" ? null : parseFloat(val); 
    updateFinancials(); 
    updateUrlHash(); 
}

function computeAndRenderOutcomes(inputTier) {
    const targetTier = targetRarity(selectedTarget); if (!targetTier) return;
    activeOutcomes = []; 
    let totalW = 0, totalR = 0, collCounts = {};
    
    slots.forEach(slot => {
        if (!slot.skin) return;
        let w = ((slot.skin.max_float ?? 1) !== (slot.skin.min_float ?? 0)) ? (slot.float - (slot.skin.min_float ?? 0)) / ((slot.skin.max_float ?? 1) - (slot.skin.min_float ?? 0)) : 0;
        totalW += w; 
        totalR += slot.float;
        let cName = slot.skin.collections[0].name; 
        collCounts[cName] = (collCounts[cName] || 0) + 1;
    });
    
    const avgWeightedFloat = totalW / 10, avgRawFloat = totalR / 10;
    
    const avgFloatEl = document.getElementById("statAvgFloat");
    if (avgFloatEl) {
        avgFloatEl.innerHTML = `<span style="color: var(--text-muted); font-size: 11px;">Raw:</span> ${avgRawFloat.toFixed(4)} &nbsp;&bull;&nbsp; <span style="color: var(--text-muted); font-size: 11px;">Weighted:</span> ${avgWeightedFloat.toFixed(4)}`;
        avgFloatEl.dataset.avg = avgWeightedFloat.toString();
    }

    document.getElementById("collectionsListText").innerHTML = Object.entries(collCounts).map(([c, count]) => `&bull; ${c} (x${count})`).join("<br>") || "None";
    
    const avgMarker = document.getElementById("avgFloatMarker");
    if (avgMarker) {
        avgMarker.style.left = `${Math.max(0, Math.min(100, avgRawFloat * 100)).toFixed(1)}%`;
        const isRisky = (avgRawFloat > 0.14 && avgRawFloat < 0.15) || (avgRawFloat > 0.37 && avgRawFloat < 0.38) || (avgRawFloat > 0.44 && avgRawFloat < 0.45);
        avgMarker.style.backgroundColor = isRisky ? "#f59e0b" : "#fff";
        avgMarker.style.boxShadow = isRisky ? "0 0 6px #f59e0b" : "0 0 4px #0ff";
    }
  
    Object.entries(collCounts).forEach(([c, count]) => {
        const outs = allSkins.filter(s => s.collections && s.collections.some(x => x.name === c) && s.rarity && s.rarity.name === targetTier);
        const p = (count / 10) / (outs.length || 1);
        outs.forEach(skin => activeOutcomes.push({ skin, probability: p, collection: c }));
    });
    
    renderOutcomeCards(avgWeightedFloat); 
}

function renderOutcomeCards(avgW) {
    const container = document.getElementById("outcomesList"); 
    container.innerHTML = "";
    
    const cur = getActiveCurrency();
    const targetTier = targetRarity(selectedTarget);
    const maxL = parseFloat(document.getElementById("wearMaxInput").value) || 0.38;
    const minL = parseFloat(document.getElementById("wearMinInput").value) || 0;
    const buf = parseFloat(document.getElementById("bufferSelect")?.value ?? "0.0005");
    const color = RARITY_COLORS[targetTier] || "var(--accent-cyan)";
    const fee = parseFloat(document.getElementById("feeSelect").value) || 0.8696;
    const sortMode = document.getElementById("outcomeSort") ? document.getElementById("outcomeSort").value : "profit";
    
    let targetOdds = 0;
  
    let displayItems = activeOutcomes.map((entry, originalIdx) => {
        let outFloat = (avgW * ((entry.skin.max_float ?? 1) - (entry.skin.min_float ?? 0))) + (entry.skin.min_float ?? 0);
        let outWear = getWearName(outFloat);
        let hash = getMarketHash(entry.skin.name, outWear);
        
        if (entry.skin.name === selectedTarget.name) targetOdds += entry.probability * 100;
        
        let priceUSD = priceCache[hash];
        let priceDisp = priceUSD !== undefined && priceUSD !== null ? (priceUSD * cur.rate) : 0;
        let safe = outFloat <= (maxL - buf) && outFloat >= (minL - 0.0001);
        let risky = !safe && outFloat <= maxL && outFloat >= (minL - 0.0001);
        let expectedProfit = (priceDisp * fee) - currentTotalInputCost;

        return { entry, originalIdx, outFloat, outWear, hash, priceDisp: priceUSD !== undefined && priceUSD !== null ? priceDisp.toFixed(2) : "", safe, risky, expectedProfit, odds: entry.probability * 100 };
    });

    if (sortMode === "profit") displayItems.sort((a, b) => b.expectedProfit - a.expectedProfit);
    else if (sortMode === "odds") displayItems.sort((a, b) => b.odds - a.odds);

    displayItems.forEach((item) => {
        const row = document.createElement("div"); 
        row.className = "item-row";
        
        row.innerHTML = `
            <div class="item-left">
                <div class="rarity-pill" style="background-color: ${color}"></div>
                <img class="item-thumb" src="${item.entry.skin.image || ''}" onerror="this.style.display='none'">
                <div class="item-details">
                    <div class="item-name">${item.entry.skin.name} <span class="badge" style="color: ${color}; border: 1px solid ${color};">${targetTier}</span> ${item.entry.skin.name === selectedTarget.name ? '<span class="badge badge-best">Target</span>' : ''} ${isStatTrak ? '<span class="badge badge-st">StatTrak™</span>' : ''}</div>
                    <div class="item-source">${getSourceInfo(item.entry.skin)}</div>
                    <div class="item-subtext">Float: ${item.outFloat.toFixed(4)} &bull; <span class="condition-pill ${item.safe ? 'match' : item.risky ? 'risky' : 'miss'}">${item.risky ? item.outWear + ' (Risky)' : item.outWear}</span> &bull; Odds: <b>${item.odds.toFixed(1)}%</b></div>
                </div>
            </div>
            <div class="item-right">
                <a href="${getCSFloatSearchUrl(item.hash)}" target="_blank" class="csfloat-link-btn" title="View listings on CSFloat">CSFloat ↗</a>
                <a href="${getSteamMarketUrl(item.hash)}" target="_blank" class="market-link-btn" title="View floor price on Steam Market">Steam Market ↗</a>
                <div class="price-input-group"><span class="currency-symbol">${cur.symbol}</span><input type="number" step="0.01" class="val-input" id="outcome-price-${item.originalIdx}" placeholder="N/A" value="${item.priceDisp}" oninput="onOutcomePriceChange(${item.originalIdx}, this.value)"></div>
                <span id="outcome-pnl-${item.originalIdx}" class="pnl-badge">N/A</span>
            </div>
        `;
        container.appendChild(row);
    });
    
    document.getElementById("statOdds").textContent = `${targetOdds.toFixed(1)}%`;
    
    // FIXED: Trigger the math function immediately after redrawing the sorted rows to fill the N/A badges
    updateFinancials();
}

function onOutcomePriceChange(idx, val) {
    let totalW = 0;
    slots.forEach(slot => { 
        totalW += ((slot.skin?.max_float ?? 1) !== (slot.skin?.min_float ?? 0)) ? (slot.float - (slot.skin?.min_float ?? 0)) / ((slot.skin?.max_float ?? 1) - (slot.skin?.min_float ?? 0)) : 0; 
    });
    let avgW = totalW / 10;
    let entry = activeOutcomes[idx];
    let outFloat = (avgW * ((entry.skin.max_float ?? 1) - (entry.skin.min_float ?? 0))) + (entry.skin.min_float ?? 0);
    
    priceCache[getMarketHash(entry.skin.name, getWearName(outFloat))] = val === "" ? null : parseFloat(val) / getActiveCurrency().rate;
    updateFinancials();
}

function updateFinancials() {
    const cur = getActiveCurrency(), fee = parseFloat(document.getElementById("feeSelect").value);
    
    let totalCost = 0, missing = false; 
    slots.forEach((s) => { 
        if (s.price === null || isNaN(s.price)) missing = true; 
        else totalCost += s.price; 
    });
    
    currentTotalInputCost = totalCost;
    document.getElementById("statInputCost").textContent = missing ? "N/A" : formatMoney(totalCost);
    document.getElementById("stickyCost").textContent = missing ? "N/A" : formatMoney(totalCost);

    let ev = 0, allPriced = true, profs = [], winProb = 0;
    
    activeOutcomes.forEach((entry, idx) => {
        let pEl = document.getElementById(`outcome-price-${idx}`);
        let p = parseFloat(pEl?.value);
        if (isNaN(p)) allPriced = false;
        else ev += p * entry.probability;
    });

    let maxSlotCost = (ev * fee) / 10;

    slots.forEach((s, i) => { 
        let inputField = document.getElementById(`slot-price-${i}`);
        if (inputField) {
            if (s.price === null || isNaN(s.price)) {
                inputField.style.borderColor = "var(--accent-red)";
                inputField.title = "Price missing";
            } else if (s.price > maxSlotCost && ev > 0) {
                inputField.style.borderColor = "var(--accent-gold)";
                inputField.title = "Warning: Expensive Input (Costs more than average expected return)";
            } else {
                inputField.style.borderColor = "var(--border-color)";
                inputField.title = "";
            }
        }
    });

    activeOutcomes.forEach((entry, idx) => {
        let pEl = document.getElementById(`outcome-price-${idx}`);
        let p = parseFloat(pEl?.value);
        let badge = document.getElementById(`outcome-pnl-${idx}`);
        let group = pEl?.parentElement;
        
        if (isNaN(p)) { 
            if(badge) { badge.textContent = "N/A"; badge.className = "pnl-badge"; } 
            if(group) group.style.borderColor = "var(--accent-red)";
        } else {
            if(group) group.style.borderColor = "var(--border-color)";
            if (!missing) { 
                let prof = (p * fee) - totalCost; 
                profs.push(prof); 
                if (prof > 0) winProb += entry.probability; 
                if (badge) { badge.textContent = `${prof >= 0 ? "+" : ""}${formatMoney(prof)}`; badge.className = `pnl-badge ${prof >= 0 ? "green" : "red"}`; } 
            } else if (badge) {
                badge.textContent = "N/A"; badge.className = "pnl-badge";
            }
        }
    });

    const evEl = document.getElementById("statEV"), pEl = document.getElementById("statProfit"), rEl = document.getElementById("statProfitability"), wEl = document.getElementById("statWinRate"), vEl = document.getElementById("statVerdict"), bEl = document.getElementById("statBestHit"), wrEl = document.getElementById("statWorstHit");
    const stickyProfitEl = document.getElementById("stickyProfit");
    
    if (!allPriced || missing) { 
        evEl.textContent = allPriced ? formatMoney(ev) : "N/A"; 
        pEl.textContent = "N/A"; pEl.className = "stat-value"; 
        rEl.textContent = "N/A"; rEl.className = "stat-value"; 
        wEl.textContent = "N/A"; wEl.className = "stat-value"; 
        vEl.textContent = missing ? "N/A (Input Price Empty)" : "N/A (Missing Prices)"; vEl.className = "stat-value"; 
        bEl.textContent = "N/A"; wrEl.textContent = "N/A"; 
        
        stickyProfitEl.textContent = "N/A";
        stickyProfitEl.style.color = "var(--text-main)";
        return; 
    }
  
    evEl.textContent = formatMoney(ev);
    let netProfit = (ev * fee) - totalCost, roi = totalCost > 0 ? ((ev * fee) / totalCost) * 100 : 0;
    
    pEl.textContent = `${netProfit >= 0 ? "+" : ""}${formatMoney(netProfit)}`; pEl.className = `stat-value ${netProfit >= 0 ? "green" : "red"}`;
    rEl.textContent = `${roi.toFixed(1)}%`; rEl.className = `stat-value ${roi >= 100 ? "green" : "red"}`;
    wEl.textContent = `${(winProb * 100).toFixed(1)}%`; wEl.className = winProb >= 0.5 ? "stat-value green" : winProb > 0 ? "stat-value gold" : "stat-value red";
    
    if (profs.length > 0) { 
        bEl.textContent = `${Math.max(...profs) >= 0 ? "+" : ""}${formatMoney(Math.max(...profs))}`; bEl.className = `stat-value ${Math.max(...profs) >= 0 ? "green" : "red"}`; 
        wrEl.textContent = `${Math.min(...profs) >= 0 ? "+" : ""}${formatMoney(Math.min(...profs))}`; wrEl.className = `stat-value ${Math.min(...profs) >= 0 ? "green" : "red"}`; 
    }
    
    vEl.textContent = netProfit > 0 ? "PROFITABLE" : "UNPROFITABLE"; vEl.className = `stat-value ${netProfit > 0 ? "green" : "red"}`;
    
    stickyProfitEl.textContent = `${netProfit >= 0 ? "+" : ""}${formatMoney(netProfit)}`;
    stickyProfitEl.style.color = netProfit >= 0 ? "var(--accent-green)" : "var(--accent-red)";
}

// ============================================================================
// 5. SEARCH LOGIC & URL ROUTING
// ============================================================================
function handleSearch(query) {
    const dropdown = document.getElementById("dropdownResults");
    const cleanQuery = (query || "").trim().toLowerCase();
    
    if (!cleanQuery) { dropdown.style.display = "none"; dropdown.innerHTML = ""; return; }
    if (!validTargetSkins || validTargetSkins.length === 0) {
        dropdown.innerHTML = `<div class="dropdown-item" style="color: var(--accent-gold); cursor: default;">Loading database...</div>`;
        dropdown.style.display = "block"; return;
    }
    
    let normalizedQuery = cleanQuery.replace(/\bdeagle\b/g, "desert eagle");
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const matches = validTargetSkins.filter(skin => tokens.every(token => skin.name.toLowerCase().includes(token))).slice(0, 25);
  
    if (matches.length === 0) {
        dropdown.innerHTML = `<div class="dropdown-item" style="color: var(--text-muted); cursor: default;">No matching skin found.</div>`;
        dropdown.style.display = "block"; return;
    }
    
    dropdown.innerHTML = "";
    matches.forEach(skin => {
        const item = document.createElement("div");
        item.className = "dropdown-item";
        const collName = skin.collections[0]?.name || "Standard Collection";
        const color = RARITY_COLORS[skin.rarity.name] || "var(--accent-cyan)";
        
        item.innerHTML = `
            <div class="dropdown-left">
                <div class="dropdown-pill" style="background-color: ${color}"></div>
                <img class="dropdown-thumb" src="${skin.image || ''}" onerror="this.style.display='none'">
                <div class="dropdown-info">
                    <div class="dropdown-name">${skin.name}</div>
                    <div class="dropdown-coll">${collName} &bull; ${skin.rarity.name}</div>
                </div>
            </div>`;
            
        item.onclick = () => selectSkin(skin);
        dropdown.appendChild(item);
    });
    dropdown.style.display = "block";
}

function selectSkin(skin) {
    selectedTarget = skin;
    document.getElementById("skinInput").value = skin.name;
    document.getElementById("dropdownResults").style.display = "none";
    const inputTier = TIER_ORDER[TIER_ORDER.indexOf(targetRarity(skin)) - 1];
    targetCollInputs = allSkins.filter(s => s.collections && s.collections.some(c => c.name === skin.collections[0].name) && s.rarity && s.rarity.name === inputTier);
    selectedPrimaryIndex = 0; secondarySkin = null;
    applySplitPreset(10); 
    runCalculation();
}

function updateUrlHash() {
    if (!selectedTarget) return;
    const params = new URLSearchParams();
    params.set("target", selectedTarget.name);
    params.set("wearMin", document.getElementById("wearMinInput").value);
    params.set("wearMax", document.getElementById("wearMaxInput").value);
    params.set("buffer", document.getElementById("bufferSelect").value);
    params.set("st", isStatTrak ? "1" : "0");
    params.set("fee", document.getElementById("feeSelect").value);
    params.set("cur", document.getElementById("currencySelect").value);
    history.replaceState(null, "", `#${params.toString()}`);
}

function checkUrlHashLoad() {
    const hash = window.location.hash.substring(1);
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const targetName = params.get("target");
    if (!targetName) return;
    
    const match = validTargetSkins.find(s => s.name.toLowerCase() === targetName.toLowerCase());
    if (!match) return;
  
    if (params.get("st") === "1") { isStatTrak = true; document.getElementById("stToggle").classList.add("active"); }
    const wearMaxParam = params.get("wearMax") || params.get("wear");
    
    if (wearMaxParam) {
        const maxVal = parseFloat(wearMaxParam);
        document.getElementById("wearMaxInput").value = maxVal.toFixed(4);
        if (params.get("wearMin")) document.getElementById("wearMinInput").value = parseFloat(params.get("wearMin")).toFixed(4);
        let minVal = parseFloat(document.getElementById("wearMinInput").value);
        let matched = "CUSTOM";
        for (const [key, range] of Object.entries(WEAR_RANGES)) {
            if (Math.abs(minVal - range.min) < 0.0005 && Math.abs(maxVal - range.max) < 0.0005) { matched = key; break; }
        }
        document.getElementById("exteriorSelect").value = matched; 
        updateWearPointers();
    }
    
    if (params.get("buffer")) document.getElementById("bufferSelect").value = params.get("buffer");
    if (params.get("fee")) document.getElementById("feeSelect").value = params.get("fee");
    if (params.get("cur")) document.getElementById("currencySelect").value = params.get("cur");

    selectedTarget = match;
    document.getElementById("skinInput").value = match.name;
    targetCollInputs = allSkins.filter(s => s.collections && s.collections.some(c => c.name === match.collections[0].name) && s.rarity && s.rarity.name === TIER_ORDER[TIER_ORDER.indexOf(targetRarity(match)) - 1]);
    selectedPrimaryIndex = 0; 
    applySplitPreset(10); 
    runCalculation();
}

// ============================================================================
// 6. RECIPE BINDER LOGIC
// ============================================================================
function copyShareUrl() {
    updateUrlHash(); 
    navigator.clipboard.writeText(window.location.href).then(() => {
        const el = document.getElementById("shareBtnText"); 
        el.textContent = "✔ Copied!"; 
        setTimeout(() => { el.textContent = "🔗 Link"; }, 2000);
    });
}

function toggleBinder() {
    const panel = document.getElementById("binderPanel"), overlay = document.getElementById("binderOverlay");
    if (panel.classList.contains("open")) { panel.classList.remove("open"); overlay.style.display = "none"; }
    else { renderBinderList(); panel.classList.add("open"); overlay.style.display = "block"; }
}

function saveCurrentRecipe() {
    if (!selectedTarget) return; 
    updateUrlHash();
    const currentHash = window.location.hash; if (!currentHash) return;
    const saved = JSON.parse(localStorage.getItem("CS2_SAVED_RECIPES") || "[]");
    const existingIdx = saved.findIndex(r => r.hash === currentHash);
    if (existingIdx !== -1) saved.splice(existingIdx, 1);
    
    saved.unshift({ 
        id: Date.now(), 
        name: selectedTarget.name, 
        wear: getWearName((parseFloat(document.getElementById("wearMaxInput").value) || 0.38) - 0.0001), 
        st: isStatTrak, 
        hash: currentHash, 
        date: new Date().toLocaleDateString() 
    });
    
    localStorage.setItem("CS2_SAVED_RECIPES", JSON.stringify(saved));
    const btn = document.getElementById("saveBinderText"); 
    btn.textContent = "✔ Saved!"; 
    setTimeout(() => { btn.textContent = "⭐ Save"; }, 2000);
}

function renderBinderList() {
    const container = document.getElementById("binderContent"), saved = JSON.parse(localStorage.getItem("CS2_SAVED_RECIPES") || "[]");
    if (saved.length === 0) { container.innerHTML = `<div class="binder-empty">No saved recipes found.<br><br>Click ⭐ Save.</div>`; return; }
    container.innerHTML = "";
    saved.forEach(r => {
        const card = document.createElement("div"); card.className = "saved-card";
        card.innerHTML = `<div class="saved-card-title">${r.st ? 'StatTrak™ ' : ''}${r.name}</div><div class="saved-card-date">Target Wear: ${r.wear} &bull; Saved: ${r.date}</div><div class="saved-card-actions"><div class="saved-btn-load" onclick="loadSavedRecipe('${r.hash}')">Load Setup</div><button class="saved-btn-del" onclick="deleteSavedRecipe(${r.id})" title="Delete">🗑</button></div>`;
        container.appendChild(card);
    });
}

function loadSavedRecipe(hash) { toggleBinder(); history.replaceState(null, "", hash); checkUrlHashLoad(); }
function deleteSavedRecipe(id) { let saved = JSON.parse(localStorage.getItem("CS2_SAVED_RECIPES") || "[]"); localStorage.setItem("CS2_SAVED_RECIPES", JSON.stringify(saved.filter(r => r.id !== id))); renderBinderList(); }

// GLOBAL CLICKS
document.addEventListener("click", e => {
    const searchWrapper = document.querySelector(".search-wrapper");
    if (searchWrapper && !searchWrapper.contains(e.target)) { const drop = document.getElementById("dropdownResults"); if (drop) drop.style.display = "none"; }
    if (!e.target.closest(".slot-picker-wrap")) closeAllSlotDropdowns();
});

// ============================================================================
// 7. VIRTUAL SIMULATOR UI LOGIC
// ============================================================================
function openSimulator() {
    if (activeOutcomes.length === 0) return alert("No valid outcomes to simulate! Please fill your inputs.");
    if (slots.filter(s => s.skin).length < 10) return alert("You must fill all 10 slots before signing a contract.");
    if (slots.some(s => s.price === null || isNaN(s.price))) return alert("Ensure all 10 inputs have a price before simulating.");

    simStats = { runs: 0, wins: 0, losses: 0, profit: 0, invested: 0, hits: {} };
    currentSimBatchSize = 1; 

    const overlay = document.getElementById("simulatorOverlay"), revealBox = document.getElementById("simulatorReveal");
    
    revealBox.innerHTML = `
        <div class="sim-prep-text">Contract Ready. Waiting for Signature...</div>
        <div style="font-size: 11px; text-transform: uppercase; font-weight: 800; color: var(--text-muted); margin-bottom: 10px; width: 100%; text-align: center;">✍ Select Batch Size to Sign</div>
        <div style="display: flex; gap: 8px; width: 100%; justify-content: center;" id="simBatchSelectors">
            <button class="sim-batch-btn active" onclick="selectBatchSize(1)">1x</button>
            <button class="sim-batch-btn" onclick="selectBatchSize(2)">2x</button>
            <button class="sim-batch-btn" onclick="selectBatchSize(5)">5x</button>
            <button class="sim-batch-btn" onclick="selectBatchSize(10)">10x</button>
        </div>
        <button id="masterSimBtn" class="sim-action-btn" style="width: 100%; margin-top: 15px;" onclick="executeSimulation()">Sign Contract (1x)</button>
        <button class="action-btn" style="width: 100%; margin-top: 8px; border-color: var(--border-color); height: auto; padding: 10px;" onclick="closeSimulator()">Cancel</button>
    `;
    overlay.style.display = "flex";
}

function selectBatchSize(times) {
    currentSimBatchSize = times;
    const btnInitial = document.getElementById("masterSimBtn"), btnPost = document.getElementById("masterSimBtnPost");
    if (btnInitial) btnInitial.textContent = `Sign Contract (${times}x)`;
    if (btnPost) btnPost.textContent = `🔄 Simulate ${times}x`;
    document.querySelectorAll(".sim-batch-btn").forEach(btn => { if (parseInt(btn.textContent) === times) btn.classList.add("active"); else btn.classList.remove("active"); });
}

function closeSimulator() { document.getElementById("simulatorOverlay").style.display = "none"; }
const delay = ms => new Promise(res => setTimeout(res, ms));

async function executeSimulation() {
    let times = currentSimBatchSize;
    const revealBox = document.getElementById("simulatorReveal");
    
    let gridHtml = `
        <div class="sim-prep-text" id="simTitle">Executing ${times} Trade-Up${times > 1 ? 's' : ''}...</div>
        <div class="unbox-grid" id="unboxGrid">
    `;
    
    for(let i = 0; i < times; i++) {
        let cardClass = times === 1 ? 'single-view' : '';
        gridHtml += `
            <div class="unbox-card stage-pulse ${cardClass}" id="unbox-card-${i}">
                <div class="unbox-glow" id="unbox-glow-${i}"></div>
                <div class="unbox-content" id="unbox-content-${i}">
                    <img class="unbox-thumb" id="unbox-img-${i}" src="" alt="">
                    <div class="unbox-details" id="unbox-details-${i}">
                        <div style="background: rgba(0,0,0,0.4); border-radius: 6px; padding: 6px; width: 100%; border: 1px solid rgba(255,255,255,0.05);">
                            <div class="sim-result-name" id="unbox-name-${i}"></div>
                            <div style="font-size: 9px; color: var(--text-muted); text-align: center; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" id="unbox-coll-${i}"></div>
                            
                            <div class="slot-wear-bar-box" style="margin: 0 0 6px 0;">
                                <div class="slot-wear-bar"><div class="wear-seg-fn"></div><div class="wear-seg-mw"></div><div class="wear-seg-ft"></div><div class="wear-seg-ww"></div><div class="wear-seg-bs"></div></div>
                                <div class="slot-wear-marker" id="unbox-marker-${i}" style="left: 0%;"></div>
                            </div>
                            
                            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 4px;">
                                <div style="text-align: left;">
                                    <div style="font-size: 8px; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Float</div>
                                    <div id="unbox-float-val-${i}" style="font-family: monospace; font-size: 11px; font-weight: 700; color: #fff; margin-top: 1px;"></div>
                                </div>
                                <div style="text-align: right;">
                                    <div id="unbox-wear-name-${i}" style="font-size: 9px; font-weight: 800; text-transform: uppercase; color: var(--accent-cyan);"></div>
                                </div>
                            </div>

                            <div style="display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 4px;">
                                <div style="text-align: left;">
                                    <div style="font-size: 8px; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Price</div>
                                    <div id="unbox-price-${i}" style="font-family: monospace; font-size: 11px; font-weight: 700; color: #fff; margin-top: 1px;"></div>
                                </div>
                                <div style="text-align: right;">
                                    <div class="sim-result-pnl" id="unbox-pnl-${i}"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    gridHtml += `</div><div id="simPostDashboard" style="display:none; width: 100%;"></div>`;
    revealBox.innerHTML = gridHtml;

    const feeMultiplier = parseFloat(document.getElementById("feeSelect").value);
    const cur = getActiveCurrency();
    let totalW = 0;
    slots.forEach(slot => { 
        totalW += ((slot.skin?.max_float ?? 1) !== (slot.skin?.min_float ?? 0)) ? (slot.float - (slot.skin?.min_float ?? 0)) / ((slot.skin?.max_float ?? 1) - (slot.skin?.min_float ?? 0)) : 0; 
    });
    const avgW = totalW / 10;

    for (let i = 0; i < times; i++) {
        let roll = Math.random(), cumulative = 0, wonEntry = activeOutcomes[activeOutcomes.length - 1]; 
        for (let entry of activeOutcomes) { 
            cumulative += entry.probability; 
            if (roll <= cumulative) { wonEntry = entry; break; } 
        }
        simStats.hits[wonEntry.skin.name] = (simStats.hits[wonEntry.skin.name] || 0) + 1;

        const oMin = wonEntry.skin.min_float ?? 0, oMax = wonEntry.skin.max_float ?? 1;
        let outFloat = (avgW * (oMax - oMin)) + oMin;
        let outWear = getWearName(outFloat);
        const priceValUSD = priceCache[getMarketHash(wonEntry.skin.name, outWear)];
        let outPriceLocal = priceValUSD ? priceValUSD * cur.rate : 0;
        let netProfit = (outPriceLocal * feeMultiplier) - currentTotalInputCost;

        let card = document.getElementById(`unbox-card-${i}`), glow = document.getElementById(`unbox-glow-${i}`);
        let img = document.getElementById(`unbox-img-${i}`), name = document.getElementById(`unbox-name-${i}`);
        let collEl = document.getElementById(`unbox-coll-${i}`), pnl = document.getElementById(`unbox-pnl-${i}`);
        let wearNameEl = document.getElementById(`unbox-wear-name-${i}`), markerEl = document.getElementById(`unbox-marker-${i}`);
        let floatValEl = document.getElementById(`unbox-float-val-${i}`), priceTxt = document.getElementById(`unbox-price-${i}`);
        let rarityHex = RARITY_HEX[wonEntry.skin.rarity.name] || "#fff";

        await delay(times >= 10 ? (150 + Math.random() * 250) : (400 + Math.random() * 600));

        card.classList.remove("stage-pulse"); card.classList.add("stage-ignite");
        await delay(300); 

        glow.style.background = rarityHex; glow.style.boxShadow = `0 0 50px ${rarityHex}`; card.style.borderColor = rarityHex; card.style.background = `radial-gradient(circle at 50% 50%, ${rarityHex}22 0%, #0b0e14 80%)`;
        
        img.src = wonEntry.skin.image || '';
        name.textContent = (isStatTrak ? 'StatTrak™ ' : '') + wonEntry.skin.name;
        collEl.textContent = wonEntry.skin.collections[0]?.name || '';
        
        wearNameEl.textContent = outWear;
        floatValEl.textContent = outFloat.toFixed(4);
        markerEl.style.left = `${Math.max(0, Math.min(100, outFloat * 100)).toFixed(1)}%`;
        priceTxt.textContent = `${cur.symbol}${outPriceLocal.toFixed(2)}`;
        
        let pnlSign = netProfit >= 0 ? '+' : '';
        pnl.textContent = `${pnlSign}${formatMoney(netProfit)}`; pnl.className = `sim-result-pnl ${netProfit < 0 ? 'loss' : ''}`;

        card.classList.add("stage-reveal"); await delay(200); card.classList.add("stage-details");

        simStats.runs++; simStats.invested += currentTotalInputCost; if (netProfit >= 0) simStats.wins++; else simStats.losses++; simStats.profit += netProfit;
    }
    await delay(700); document.getElementById("simTitle").textContent = "Contract Executed"; renderPostDashboard();
}

function renderPostDashboard() {
    const dashContainer = document.getElementById("simPostDashboard");
    let winRate = ((simStats.wins / simStats.runs) * 100).toFixed(1), totalPnlSign = simStats.profit >= 0 ? '+' : '', totalPnlClass = simStats.profit >= 0 ? 'green' : 'red';
    let groupedMap = {}; activeOutcomes.forEach(e => { if (!groupedMap[e.skin.name]) groupedMap[e.skin.name] = { skin: e.skin, prob: 0 }; groupedMap[e.skin.name].prob += e.probability; });
    let groupedOutcomes = Object.values(groupedMap).sort((a,b) => b.prob - a.prob);

    let outcomesGridHtml = `<div class="sim-outcomes-header">Session Outcome Distribution</div><div class="sim-outcomes-grid">`;
    groupedOutcomes.forEach(entry => {
        let hits = simStats.hits[entry.skin.name] || 0, rHex = RARITY_HEX[entry.skin.rarity.name] || "#fff";
        outcomesGridHtml += `<div class="sim-outcome-mini-card ${hits > 0 ? 'hit' : ''}" style="${hits > 0 ? `border-bottom: 2px solid ${rHex}` : ''}" title="${entry.skin.name} (${(entry.prob*100).toFixed(1)}%)"><div class="sim-hit-badge ${hits > 0 ? '' : 'zero'}">${hits}</div><img class="sim-outcome-thumb" src="${entry.skin.image || ''}"></div>`;
    }); outcomesGridHtml += `</div>`;

    dashContainer.innerHTML = `
        <div style="display: flex; gap: 8px; width: 100%; align-items: stretch; margin-top: 10px;">
            <div style="display: flex; flex-direction: column; flex: 1; gap: 4px;">
                <div style="font-size: 9px; text-transform: uppercase; font-weight: 800; color: var(--text-muted); text-align: center;">Auto-Simulate</div>
                <div style="display: flex; gap: 4px; width: 100%; height: 100%;">
                    <button class="sim-batch-btn ${currentSimBatchSize === 1 ? 'active' : ''}" onclick="selectBatchSize(1)">1x</button>
                    <button class="sim-batch-btn ${currentSimBatchSize === 2 ? 'active' : ''}" onclick="selectBatchSize(2)">2x</button>
                    <button class="sim-batch-btn ${currentSimBatchSize === 5 ? 'active' : ''}" onclick="selectBatchSize(5)">5x</button>
                    <button class="sim-batch-btn ${currentSimBatchSize === 10 ? 'active' : ''}" onclick="selectBatchSize(10)">10x</button>
                </div>
            </div>
            <div style="display: flex; flex-direction: column; flex: 1.2; gap: 6px; justify-content: flex-end;">
                <button id="masterSimBtnPost" class="sim-action-btn" style="flex: 1; font-size: 13px;" onclick="executeSimulation()">🔄 Simulate ${currentSimBatchSize}x</button>
                <button class="action-btn" style="height: 28px; border-color: var(--border-color); font-size: 11px;" onclick="closeSimulator()">Close Simulator</button>
            </div>
        </div>

        <div class="sim-stats-container" style="opacity: 1;">
            <div class="sim-stat-row">
                <div class="sim-stat-box"><span class="sim-stat-lbl">Runs</span><span class="sim-stat-val">${simStats.runs}</span></div>
                <div class="sim-stat-box"><span class="sim-stat-lbl">Wins</span><span class="sim-stat-val green">${simStats.wins}</span></div>
                <div class="sim-stat-box"><span class="sim-stat-lbl">Losses</span><span class="sim-stat-val red">${simStats.losses}</span></div>
                <div class="sim-stat-box"><span class="sim-stat-lbl">Win %</span><span class="sim-stat-val gold">${winRate}%</span></div>
                <div class="sim-stat-box"><span class="sim-stat-lbl">Input Cost</span><span class="sim-stat-val">${formatMoney(currentTotalInputCost)}</span></div>
            </div>
            <div class="sim-stat-row">
                <div class="sim-stat-box" style="flex: 1;"><span class="sim-stat-lbl">Total Invested</span><span class="sim-stat-val large">${formatMoney(simStats.invested)}</span></div>
                <div class="sim-stat-box" style="flex: 1;"><span class="sim-stat-lbl">Session Net P/L</span><span class="sim-stat-val large ${totalPnlClass}">${totalPnlSign}${formatMoney(simStats.profit)}</span></div>
            </div>
        </div>
        ${outcomesGridHtml}
    `;
    dashContainer.style.display = "block";
}