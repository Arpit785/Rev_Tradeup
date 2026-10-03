// ============================================================================
// 1. GLOBAL VARIABLES & STATE
// ============================================================================
const DB_NAME = 'CS2TradeUpDB';
const DB_VERSION = 1;

const TIER_ORDER = ["Consumer Grade", "Industrial Grade", "Mil-Spec Grade", "Restricted", "Classified", "Covert"];
const RARITY_COLORS = { "Industrial Grade": "var(--rarity-industrial)", "Mil-Spec Grade": "var(--rarity-milspec)", "Restricted": "var(--rarity-restricted)", "Classified": "var(--rarity-classified)", "Covert": "var(--rarity-covert)" };
const RARITY_HEX = { "Consumer Grade": "#b0c3d9", "Industrial Grade": "#5e98d9", "Mil-Spec Grade": "#4b69ff", "Restricted": "#8847ff", "Classified": "#d32ce6", "Covert": "#eb4b4b" };
const CURRENCIES = { INR: { symbol: "₹", rate: 88.0 }, USD: { symbol: "$", rate: 1.0 }, EUR: { symbol: "€", rate: 0.92 } };
const WEAR_RANGES = { FN: { min: 0.00, max: 0.07 }, MW: { min: 0.07, max: 0.15 }, FT: { min: 0.15, max: 0.38 }, WW: { min: 0.38, max: 0.45 }, BS: { min: 0.45, max: 1.00 } };

let allSkins = [], validTargetSkins = [], selectedTarget = null, sandboxTier = null, isStatTrak = false, targetCollInputs = [], selectedPrimaryIndex = 0, secondarySkin = null;
let slots = Array.from({ length: 10 }, () => ({ skin: null, float: 0.05, price: null }));
let priceCache = {};
let activeOutcomes = [], activeSlotDropdown = null, currentTotalInputCost = 0; 
let simStats = { runs: 0, wins: 0, losses: 0, profit: 0, invested: 0, hits: {} }, currentSimBatchSize = 1;

// ============================================================================
// 2. NATIVE INDEXED_DB WRAPPER
// ============================================================================
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('skins')) db.createObjectStore('skins');
            if (!db.objectStoreNames.contains('prices')) db.createObjectStore('prices');
            if (!db.objectStoreNames.contains('recipes')) db.createObjectStore('recipes');
            if (!db.objectStoreNames.contains('sim_history')) db.createObjectStore('sim_history');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function dbPut(storeName, key, value) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = key ? tx.objectStore(storeName).put(value, key) : tx.objectStore(storeName).put(value);
        req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
    });
}

async function dbGet(storeName, key) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
}

// ============================================================================
// 3. OFFLINE-FIRST DATA LOADING & LIVE SYNC
// ============================================================================
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initApp); } else { initApp(); }

async function initApp() {
    setupStickyFooter();
    await loadPrices();
    await loadSkins();
}

async function loadSkins() {
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = "Mounting Offline Database...";
    
    try {
        const cachedSkins = await dbGet('skins', 'master');
        if (cachedSkins && Array.isArray(cachedSkins) && cachedSkins.length > 0) {
            processLoadedSkins(cachedSkins);
            return; 
        }
    } catch (e) { console.warn("Skins DB read failed", e); }

    await fetchSkinsFromAPI(statusEl);
}

async function fetchSkinsFromAPI(statusEl) {
    if (statusEl) statusEl.textContent = "Syncing live database...";
    
    const endpoints = [
        "https://raw.githubusercontent.com/ByMyKel/CSGO-API/main/public/api/en/skins.json", 
        "https://bymykel.github.io/CSGO-API/api/en/skins.json"
    ];
    
    let fetchSuccess = false;
    for (const url of endpoints) {
        try {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) continue;
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                await dbPut('skins', 'master', data);
                processLoadedSkins(data);
                fetchSuccess = true;
                break;
            }
        } catch (err) { }
    }
    
    if (fetchSuccess) return true;

    if (validTargetSkins && validTargetSkins.length > 0) {
        if (statusEl) statusEl.textContent = `Ready: ${validTargetSkins.length} skins loaded.`;
        return false;
    }
    
    try {
        const cachedSkins = await dbGet('skins', 'master');
        if (cachedSkins && Array.isArray(cachedSkins) && cachedSkins.length > 0) {
            processLoadedSkins(cachedSkins);
            return false;
        }
    } catch(e) {}

    if (statusEl) statusEl.textContent = "Failed to load database. Check internet connection.";
    return false;
}

function processLoadedSkins(data) {
    allSkins = data;
    validTargetSkins = data.filter(s => s && s.rarity && ["Industrial Grade", "Mil-Spec Grade", "Restricted", "Classified", "Covert"].includes(s.rarity.name) && (s.collections || s.crates) && s.min_float !== null && s.max_float !== null);
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = `Ready: ${validTargetSkins.length} skins loaded.`;
    
    if (window.location.hash.length > 1) {
        checkUrlHashLoad();
    } else {
        goHome(); 
    }
}

async function loadPrices() {
    if (window.LOCAL_PRICES && Object.keys(window.LOCAL_PRICES).length > 0) {
        priceCache = window.LOCAL_PRICES;
        let ts = Date.now();
        if (typeof window.PRICES_UPDATED_AT !== 'undefined') ts = window.PRICES_UPDATED_AT;
        else if (typeof window.LOCAL_PRICES_TIMESTAMP !== 'undefined') ts = window.LOCAL_PRICES_TIMESTAMP;
        
        priceCache._timestamp = ts;
        await dbPut('prices', 'master', priceCache);
    } else {
        const cachedPrices = await dbGet('prices', 'master');
        if (cachedPrices) priceCache = cachedPrices;
    }
    updatePriceTimestampDisplay();
}

async function forceDatabaseSync() {
    const btn = document.getElementById("syncDataBtn");
    btn.classList.add("spinning");
    
    await fetchSkinsFromAPI(document.getElementById("status"));
    
    return new Promise((resolve) => {
        const oldScript = document.getElementById('prices-script-tag');
        if (oldScript) oldScript.remove();
        
        const script = document.createElement('script');
        script.id = 'prices-script-tag';
        
        let timeoutId = setTimeout(() => {
            console.warn("Price sync timed out. Falling back to cached prices.");
            updatePriceTimestampDisplay();
            btn.classList.remove("spinning");
            resolve();
        }, 4000);

        script.onload = async () => {
            clearTimeout(timeoutId);
            if (window.LOCAL_PRICES && Object.keys(window.LOCAL_PRICES).length > 0) {
                priceCache = window.LOCAL_PRICES;
                priceCache._timestamp = Date.now(); 
                await dbPut('prices', 'master', priceCache);
                updatePriceTimestampDisplay();
                if (selectedTarget || sandboxTier) {
                    onSettingChange();
                    updateFinancials();
                }
            }
            btn.classList.remove("spinning");
            resolve();
        };
        
        script.onerror = () => {
            clearTimeout(timeoutId);
            updatePriceTimestampDisplay();
            btn.classList.remove("spinning");
            resolve();
        };
        
        document.head.appendChild(script);
        script.src = 'prices.js?t=' + new Date().getTime(); 
    });
}

// ============================================================================
// 4. UTILITY FUNCTIONS & CRASH-PREVENTION HELPERS
// ============================================================================
function getSafeCollectionName(skin) {
    if (skin && skin.collections && skin.collections.length > 0) return skin.collections[0].name;
    if (skin && skin.crates && skin.crates.length > 0) return skin.crates[0].name;
    return "Standard Drop";
}

function getContainerImage(skin) {
    if (skin && skin.collections && skin.collections.length > 0 && skin.collections[0].image) return skin.collections[0].image;
    if (skin && skin.crates && skin.crates.length > 0 && skin.crates[0].image) return skin.crates[0].image;
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%238492a6"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';
}

function formatTimeAgo(dateInput) {
    if (!dateInput) return null;
    let date = new Date(dateInput);
    if (typeof dateInput === 'number' && dateInput < 20000000000) date = new Date(dateInput * 1000);
    if (isNaN(date.getTime())) return String(dateInput);
    
    const diffMs = Date.now() - date.getTime();
    if (diffMs < 0) return "Just now";
    
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHr / 24);
    
    if (diffSec < 60) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${diffDays}d ago`;
}

function updatePriceTimestampDisplay() {
    const badge = document.getElementById("priceTimestampBadge");
    const syncBtn = document.getElementById("syncDataBtn");
    if (!badge) return;
    
    let rawTimestamp = null;
    if (priceCache._timestamp) rawTimestamp = priceCache._timestamp;
    else if (typeof window.PRICES_UPDATED_AT !== 'undefined') rawTimestamp = window.PRICES_UPDATED_AT;
    else if (typeof window.LOCAL_PRICES_TIMESTAMP !== 'undefined') rawTimestamp = window.LOCAL_PRICES_TIMESTAMP;
    
    if (rawTimestamp) { 
        badge.textContent = `⚡ Prices: ${formatTimeAgo(rawTimestamp)}`; 
        badge.style.display = "inline-flex"; 
    } else if (Object.keys(priceCache).length > 0) { 
        badge.textContent = `⚡ Cache Active`; 
        badge.style.display = "inline-flex"; 
    } else { 
        badge.style.display = "none"; 
    }
    if (syncBtn) syncBtn.style.display = "inline-block";
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
    const coll = skin && skin.collections && skin.collections.length > 0 ? skin.collections[0].name : "";
    const crate = skin && skin.crates && skin.crates.length > 0 ? skin.crates[0].name : "";
    if (coll && crate) return `${coll} &bull; ${crate}`;
    if (coll) return coll;
    if (crate) return crate;
    return "Standard Weapon Drop";
}

function getActiveCurrency() { const curSelect = document.getElementById("currencySelect"); return CURRENCIES[curSelect ? curSelect.value : "INR"] || CURRENCIES.INR; }
function formatMoney(amount) { if (isNaN(amount) || amount === null) return "N/A"; return `${getActiveCurrency().symbol}${amount.toFixed(2)}`; }
function targetRarity(s) { return (s && s.rarity) ? s.rarity.name : ""; }

function getNormalizedTarget() {
    if (!selectedTarget && !sandboxTier) return 0.5; // Neutral sandbox default
    const maxLimit = parseFloat(document.getElementById("wearMaxInput").value) || 0.38;
    const bufferVal = parseFloat(document.getElementById("bufferSelect")?.value ?? "0.0005");
    
    // In sandbox, if no selected target, base it purely on input bars without skin-specific caps
    if (!selectedTarget) {
        return Math.max(0, Math.min(1, maxLimit - bufferVal));
    }
    
    const minF = selectedTarget.min_float ?? 0.00, maxF = selectedTarget.max_float ?? 1.00;
    if (maxF === minF) return 0;
    return Math.max(0, Math.min(1, (Math.max(minF, maxLimit - bufferVal) - minF) / (maxF - minF)));
}

function getBasePrice(skin, floatVal) {
    if (!skin) return null;
    if (floatVal !== undefined) {
         let p = priceCache[getMarketHash(skin.name, getWearName(floatVal))];
         if (p !== undefined && p !== null) return p;
    }
    let floor = null;
    ["Field-Tested", "Minimal Wear", "Factory New", "Battle-Scarred", "Well-Worn"].forEach(w => {
        let p = priceCache[`${skin.name} (${w})`] || priceCache[`StatTrak™ ${skin.name} (${w})`];
        if (p !== undefined && p !== null && (floor === null || p < floor)) floor = p;
    });
    return floor;
}

function toggleSection(wrapperId, chevronId) {
    const wrapper = document.getElementById(wrapperId);
    const chevron = document.getElementById(chevronId);
    if (!wrapper || !chevron) return;
    if (wrapper.style.display === "none") { wrapper.style.display = ""; chevron.classList.remove("collapsed"); } 
    else { wrapper.style.display = "none"; chevron.classList.add("collapsed"); }
}

function toggleValidCollections() {
    const el = document.getElementById("validCollectionsList");
    if(el) { el.style.display = el.style.display === "block" ? "none" : "block"; }
}

function closeValidCollections() {
    const el = document.getElementById("validCollectionsList");
    if(el) el.style.display = "none";
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
    const inputEl = document.getElementById("skinInput");
    if (inputEl) inputEl.value = "";
    document.getElementById("dropdownResults").style.display = "none";
    onSettingChange();
}

function onCurrencyChange() {
    if (selectedTarget || sandboxTier) {
        renderSlotCards();
        computeAndRenderOutcomes();
        updateFinancials();
    }
}

function onSettingChange() {
    if (selectedTarget || sandboxTier) {
        const targetNorm = getNormalizedTarget();
        const cur = getActiveCurrency();
        slots.forEach(slot => {
            if (slot.skin) {
                const sMin = slot.skin.min_float ?? 0, sMax = slot.skin.max_float ?? 1;
                let dFloat = selectedTarget ? ((targetNorm * (sMax - sMin)) + sMin) : targetNorm;
                slot.float = parseFloat(dFloat.toFixed(4));
                const hash = getMarketHash(slot.skin.name, getWearName(slot.float));
                slot.price = priceCache[hash] ? parseFloat((priceCache[hash] * cur.rate).toFixed(2)) : null;
            }
        });
        renderSlotCards();
        runCalculation();
    }
}

function goHome() {
    closeValidCollections();
    selectedTarget = null; 
    selectedPrimaryIndex = 0; 
    secondarySkin = null; 
    sandboxTier = null;
    isStatTrak = false;
    
    slots.forEach(slot => { slot.skin = null; slot.float = 0.05; slot.price = null; });
    
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
    renderSlotCards(); // Render sandbox mode empty slots
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
    const tColl = getSafeCollectionName(selectedTarget);
    const primaryCount = slots.filter(s => s.skin && getSafeCollectionName(s.skin) === tColl).length;
    
    document.querySelectorAll(".preset-btn").forEach(btn => { 
        if (btn.classList.contains('btn-clear-all')) return;
        if (parseInt(btn.getAttribute("data-count")) === primaryCount) btn.classList.add("active"); 
        else btn.classList.remove("active"); 
    });
}

function ensureFillerSkinExists(inputTier) {
    if (!secondarySkin && selectedTarget) {
        const tColl = getSafeCollectionName(selectedTarget);
        const eligible = allSkins.filter(s => s && s.rarity && s.rarity.name === inputTier && s.min_float !== null && s.max_float !== null);
        secondarySkin = eligible.find(s => getSafeCollectionName(s) !== tColl) || eligible[0];
    }
}

function clearAllSlots() {
    closeValidCollections();
    slots.forEach(slot => { slot.skin = null; slot.float = 0.05; slot.price = null; });
    selectedPrimaryIndex = 0; secondarySkin = null;
    sandboxTier = null;
    
    if (selectedTarget) {
        const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget));
        if (tIdx > 0) { 
            runCalculation(); 
        }
    } else {
        document.getElementById("resultSection").style.display = "none";
        renderSlotCards();
    }
    updatePresetButtons(); updateUrlHash();
}

// ============================================================================
// 5. URL ROUTING & SEARCH LOGIC
// ============================================================================
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
    
    if (params.get("st") === "1") { isStatTrak = true; document.getElementById("stToggle").classList.add("active"); }
    if (params.get("buffer")) document.getElementById("bufferSelect").value = params.get("buffer");
    if (params.get("fee")) document.getElementById("feeSelect").value = params.get("fee");
    if (params.get("cur")) document.getElementById("currencySelect").value = params.get("cur");

    const fillerName = params.get("filler");
    
    if (targetName) {
        const match = validTargetSkins.find(s => s.name.toLowerCase() === targetName.toLowerCase());
        if (match) {
            selectedTarget = match;
            document.getElementById("skinInput").value = match.name;
            
            const targetCollName = getSafeCollectionName(match);
            const inputTier = TIER_ORDER[TIER_ORDER.indexOf(targetRarity(match)) - 1];
            
            targetCollInputs = allSkins.filter(s => s && s.rarity && s.rarity.name === inputTier && getSafeCollectionName(s) === targetCollName);
            selectedPrimaryIndex = 0; 

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

            if (fillerName) {
                const fMatch = allSkins.find(s => s.name.toLowerCase() === fillerName.toLowerCase());
                if (fMatch) secondarySkin = fMatch;
                applySplitPreset(5); 
            } else {
                applySplitPreset(10); 
            }
            runCalculation();
        }
    }
}

function handleSearch(query) {
    try {
        closeValidCollections(); 
        const dropdown = document.getElementById("dropdownResults");
        const cleanQuery = (query || "").trim().toLowerCase();
        
        if (!cleanQuery) { dropdown.style.display = "none"; dropdown.innerHTML = ""; return; }
        if (!validTargetSkins || validTargetSkins.length === 0) {
            dropdown.innerHTML = `<div class="dropdown-item" style="color: var(--accent-gold); cursor: default;">Loading database...</div>`;
            dropdown.style.display = "block"; return;
        }
        
        let normalizedQuery = cleanQuery.replace(/\bdeagle\b/g, "desert eagle");
        const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
        
        const matches = validTargetSkins.filter(skin => {
            if (!skin || !skin.name) return false;
            if (isStatTrak && !skin.stattrak) return false;
            return tokens.every(token => skin.name.toLowerCase().includes(token));
        }).slice(0, 25);
      
        if (matches.length === 0) {
            dropdown.innerHTML = `<div class="dropdown-item" style="color: var(--text-muted); cursor: default;">No matching skin found.</div>`;
            dropdown.style.display = "block"; return;
        }
        
        dropdown.innerHTML = "";
        matches.forEach(skin => {
            const item = document.createElement("div");
            item.className = "dropdown-item";
            
            const collName = getSafeCollectionName(skin);
            const rName = skin.rarity ? skin.rarity.name : "";
            const color = RARITY_COLORS[rName] || "var(--accent-cyan)";
            
            item.innerHTML = `
                <div class="dropdown-left">
                    <div class="dropdown-pill" style="background-color: ${color}"></div>
                    <img class="dropdown-thumb" src="${skin.image || ''}" onerror="this.style.display='none'">
                    <div class="dropdown-info">
                        <div class="dropdown-name">${skin.name}</div>
                        <div class="dropdown-coll">${collName} &bull; ${rName}</div>
                    </div>
                </div>`;
            
            item.onclick = () => selectSkin(skin);
            dropdown.appendChild(item);
        });
        dropdown.style.display = "block";
    } catch(e) {
        console.error("Search UI encountered an error:", e);
    }
}

function selectSkin(skin) {
    try {
        closeValidCollections(); 
        selectedTarget = skin;
        sandboxTier = null; // Clear sandbox rules
        document.getElementById("skinInput").value = skin.name;
        document.getElementById("dropdownResults").style.display = "none";
        
        const targetTierIndex = TIER_ORDER.indexOf(targetRarity(skin));
        if (targetTierIndex <= 0) return; 
        
        const inputTier = TIER_ORDER[targetTierIndex - 1];
        const targetCollName = getSafeCollectionName(skin);
        
        targetCollInputs = allSkins.filter(s => 
            s && s.rarity && s.rarity.name === inputTier && 
            getSafeCollectionName(s) === targetCollName
        );
        
        selectedPrimaryIndex = 0; 
        secondarySkin = null;
        applySplitPreset(10); 
        runCalculation();
    } catch(err) {
        console.error("Error executing skin selection:", err);
    }
}

// ============================================================================
// 6. DASHBOARD & HYBRID SANDBOX LOGIC
// ============================================================================
function runCalculation() {
    const resSection = document.getElementById("resultSection");
    const noticeBox = document.getElementById("uncraftableNotice");

    if (selectedTarget) {
        // --- REVERSE CALCULATOR MODE ---
        const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget));
        if (tIdx <= 0) { resSection.style.display = "none"; return; }
        const inputTier = TIER_ORDER[tIdx - 1];

        if (!targetCollInputs || targetCollInputs.length === 0) {
            resSection.style.display = "flex"; noticeBox.style.display = "block";
            noticeBox.innerHTML = `<b>Trade-Up Not Possible:</b> Case collections do not contain any <em>${inputTier}</em> skins for this target.`;
            document.getElementById("eligibleContainer").style.display = "none"; 
            document.getElementById("outcomesContainer").style.display = "none";
            document.getElementById("statVerdict").textContent = "UNCRAFTABLE"; 
            document.getElementById("statVerdict").className = "stat-value red"; 
            return;
        }

        noticeBox.style.display = "none";
        document.getElementById("eligibleContainer").style.display = "block"; 
        document.getElementById("outcomesContainer").style.display = "block";
        
        ensureFillerSkinExists(inputTier);
        renderEligibleInputs(inputTier, getNormalizedTarget()); 
        renderSlotCards(); 
        computeAndRenderOutcomes();
        
        resSection.style.display = "flex"; 
        updateUrlHash();

    } else {
        // --- SANDBOX (FORWARD) MODE ---
        const filledSlots = slots.filter(s => s.skin);
        if (filledSlots.length === 0) {
            sandboxTier = null; 
            resSection.style.display = "none";
            renderSlotCards(); 
            return;
        }

        sandboxTier = filledSlots[0].skin.rarity.name;
        const sIdx = TIER_ORDER.indexOf(sandboxTier);
        if (sIdx === TIER_ORDER.length - 1) { 
            resSection.style.display = "flex"; noticeBox.style.display = "block";
            noticeBox.innerHTML = `<b>Trade-Up Not Possible:</b> You cannot trade up Covert skins.`;
            document.getElementById("eligibleContainer").style.display = "none";
            document.getElementById("outcomesContainer").style.display = "none";
            renderSlotCards();
            return;
        }

        noticeBox.style.display = "none";
        document.getElementById("eligibleContainer").style.display = "none"; 
        document.getElementById("outcomesContainer").style.display = "block";
        
        renderSlotCards(); 
        computeAndRenderOutcomes();
        resSection.style.display = "flex"; 
    }
}

function renderEligibleInputs(inputTier, targetNorm) {
    const container = document.getElementById("eligibleList"); 
    container.innerHTML = "";
    if (!selectedTarget) return;
    
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
        let canCraft = lowerTierName && allSkins.some(s => s && s.rarity && s.rarity.name === lowerTierName && getSafeCollectionName(s) === getSafeCollectionName(skin));
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
    const pSkin = targetCollInputs[index], cur = getActiveCurrency(), targetNorm = getNormalizedTarget(), tColl = getSafeCollectionName(selectedTarget);
    const pMin = pSkin ? (pSkin.min_float ?? 0) : 0, pMax = pSkin ? (pSkin.max_float ?? 1) : 1;
    const pFloat = parseFloat(((targetNorm * (pMax - pMin)) + pMin).toFixed(4));
    
    slots.forEach(slot => {
        if (slot.skin && getSafeCollectionName(slot.skin) === tColl) {
            slot.skin = pSkin; slot.float = pFloat;
            if (pSkin) slot.price = priceCache[getMarketHash(pSkin.name, getWearName(pFloat))] ? parseFloat((priceCache[getMarketHash(pSkin.name, getWearName(pFloat))] * cur.rate).toFixed(2)) : null;
        }
    });
    
    runCalculation();
}

function onEligiblePriceChange(index, val) {
    const num = val === "" ? null : parseFloat(val);
    const cur = getActiveCurrency(), skin = targetCollInputs[index], targetNorm = getNormalizedTarget();
    let inMin = skin.min_float ?? 0, inMax = skin.max_float ?? 1;
    let hash = getMarketHash(skin.name, getWearName(Math.min(inMax, (targetNorm * (inMax - inMin)) + inMin)));
    
    priceCache[hash] = num !== null ? (num / cur.rate) : null;
    dbPut('prices', 'master', priceCache); // Permanent save
    
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

function renderSlotCards() {
    const container = document.getElementById("slotsGrid"); 
    container.innerHTML = "";
    
    const cur = getActiveCurrency();
    const tColl = selectedTarget ? getSafeCollectionName(selectedTarget) : null;
    let activeTier = null;
    
    if (selectedTarget) {
        activeTier = TIER_ORDER[TIER_ORDER.indexOf(targetRarity(selectedTarget)) - 1];
    } else if (sandboxTier) {
        activeTier = sandboxTier;
    }

    const batchPanel = document.getElementById("batchConfigPanel");
    if (selectedTarget) {
        batchPanel.style.display = "flex";
        const eligSkins = allSkins.filter(s => s && s.rarity && s.rarity.name === activeTier && s.min_float !== null && s.max_float !== null && getSafeCollectionName(s) !== "Standard Drop");
        const oInputs = eligSkins.filter(s => getSafeCollectionName(s) !== tColl);
        
        document.getElementById("primarySkinSelect").innerHTML = targetCollInputs.map((s, idx) => `<option value="${idx}" ${idx === selectedPrimaryIndex ? "selected" : ""}>${s.name}</option>`).join("");
        document.getElementById("fillerSkinSelect").innerHTML = oInputs.map(s => `<option value="${s.name}" ${secondarySkin && s.name === secondarySkin.name ? "selected" : ""}>${s.name} (${getSafeCollectionName(s)})</option>`).join("");
    } else {
        batchPanel.style.display = "none";
    }

    slots.forEach((slot, i) => {
        const skin = slot.skin; 
        const isTargetColl = selectedTarget && skin && getSafeCollectionName(skin) === tColl;
        const rarityHex = skin ? (RARITY_HEX[skin.rarity.name] || "#4b69ff") : "#262f40";

        const card = document.createElement("div"); 
        card.className = `slot-card ${!skin ? 'is-empty' : (isTargetColl ? 'is-target-coll' : 'is-other-coll')}`; 
        card.id = `slot-card-${i}`;
        
        if (!skin) {
            card.innerHTML = `
                <div class="slot-card-header"><span class="slot-num-badge">SLOT #${i + 1}</span></div>
                <div class="empty-slot-btn" id="slot-btn-${i}" onclick="toggleSlotDropdown(${i}, event)">
                    <div class="empty-plus">+</div><div>Add Skin</div>
                </div>
                <div class="slot-dropdown-panel" id="slot-panel-${i}">
                    <div class="slot-search-box"><input type="text" class="slot-search-input" id="slot-search-${i}" placeholder="Search skins..." onclick="event.stopPropagation()" oninput="populateSlotDropdown(${i}, this.value)"></div>
                    <div class="slot-options-scroll" id="slot-scroll-${i}"></div>
                </div>
            `;
        } else {
            const wearName = getWearName(slot.float);
            const markerPercent = Math.max(0, Math.min(100, slot.float * 100)).toFixed(1);
            const priceDisp = slot.price !== null && !isNaN(slot.price) ? slot.price.toFixed(2) : "";
            const hashName = getMarketHash(skin.name, wearName);
            const canCraft = activeTier && allSkins.some(s => s && s.rarity && s.rarity.name === activeTier && getSafeCollectionName(s) === getSafeCollectionName(skin));
            
            card.innerHTML = `
                <div class="slot-card-header">
                    <div style="display: flex; align-items: center; gap: 6px;"><span class="slot-num-badge">SLOT #${i + 1}</span>
                        <a href="${getSteamMarketUrl(hashName)}" id="slot-steam-${i}" target="_blank" class="slot-steam-link">Steam ↗</a>${canCraft ? `<a href="#target=${encodeURIComponent(skin.name)}&wearMax=${slot.float}" id="slot-tradeup-${i}" target="_blank" class="slot-slot-craft-link">Trade-Up ↗</a>` : ''}
                    </div>
                    ${selectedTarget ? `<span class="badge ${isTargetColl ? 'badge-best' : 'badge-secondary'}">${isTargetColl ? 'Primary' : 'Filler'}</span>` : ''}
                </div>
                <div class="slot-thumb-box" style="background: radial-gradient(circle at 50% 60%, ${rarityHex}38 0%, rgba(13, 17, 26, 0.96) 82%); border-bottom: 2px solid ${rarityHex};">
                    <img class="slot-thumb" src="${skin.image || ''}" onerror="this.style.display='none'">
                </div>
                <div class="slot-picker-wrap">
                    <button type="button" class="slot-picker-btn" id="slot-btn-${i}" onclick="toggleSlotDropdown(${i}, event)">
                        <span class="slot-picker-text">${skin.name}</span><span class="slot-picker-arrow">▼</span>
                    </button>
                    <div class="slot-dropdown-panel" id="slot-panel-${i}">
                        <div class="slot-search-box"><input type="text" class="slot-search-input" id="slot-search-${i}" placeholder="Search..." onclick="event.stopPropagation()" oninput="populateSlotDropdown(${i}, this.value)"></div>
                        <div class="slot-options-scroll" id="slot-scroll-${i}"></div>
                    </div>
                </div>
                <div class="slot-skin-coll">${getSafeCollectionName(skin)}</div>
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
        }
        container.appendChild(card);
    });
}

function closeAllSlotDropdowns() { 
    document.querySelectorAll(".slot-dropdown-panel").forEach(p => p.classList.remove("open")); 
    document.querySelectorAll(".slot-picker-btn, .empty-slot-btn").forEach(b => b.classList.remove("active")); 
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
        populateSlotDropdown(idx, ''); // Auto-populate on open
    } 
}

function populateSlotDropdown(idx, query) {
    const scrollEl = document.getElementById(`slot-scroll-${idx}`);
    if (!scrollEl) return;
    
    const cur = getActiveCurrency();
    const cleanQuery = (query || "").trim().toLowerCase();
    const tokens = cleanQuery.replace(/\bdeagle\b/g, "desert eagle").split(/\s+/).filter(Boolean);
    
    let allowedTier = null;
    if (selectedTarget) {
        allowedTier = TIER_ORDER[TIER_ORDER.indexOf(targetRarity(selectedTarget)) - 1];
    } else if (sandboxTier) {
        allowedTier = sandboxTier;
    }
    
    let matches = allSkins.filter(s => {
        if (allowedTier && (!s.rarity || s.rarity.name !== allowedTier)) return false;
        if (getSafeCollectionName(s) === "Standard Drop") return false;
        if (s.min_float === null || s.max_float === null) return false;
        if (isStatTrak && !s.stattrak) return false;
        if (tokens.length > 0 && !tokens.every(t => s.name.toLowerCase().includes(t))) return false;
        return true;
    });
    
    const tColl = selectedTarget ? getSafeCollectionName(selectedTarget) : null;
    if (tColl) {
        matches.sort((a, b) => {
            const aMatch = getSafeCollectionName(a) === tColl;
            const bMatch = getSafeCollectionName(b) === tColl;
            if (aMatch && !bMatch) return -1;
            if (!aMatch && bMatch) return 1;
            return 0;
        });
    }
    
    matches = matches.slice(0, 50); // Performance cap
    let html = "";
    
    matches.forEach(s => {
        let p = getBasePrice(s, slots[idx].float);
        let pDisp = p ? formatMoney(p * cur.rate) : 'N/A';
        html += `<div class="slot-opt-item" onclick="onIndividualSlotSkinChange(${idx}, '${encodeURIComponent(s.name)}')">
            <div style="display:flex; justify-content:space-between; width:100%;">
                <span class="slot-opt-name">${s.name} <span style="color:var(--text-muted); font-size:9px;">(${getSafeCollectionName(s)})</span></span>
                <span style="color:var(--accent-green); font-size:10px; font-weight:800;">${pDisp}</span>
            </div>
        </div>`;
    });
    
    if (matches.length === 0) html = `<div style="padding: 10px; color: var(--text-muted); font-size: 11px; text-align: center;">No valid skins found.</div>`;
    scrollEl.innerHTML = html;
}

function onIndividualSlotSkinChange(idx, name) {
    const s = allSkins.find(x => x.name === decodeURIComponent(name)); if(!s) return;
    
    if (!selectedTarget && !sandboxTier) sandboxTier = s.rarity.name; // Sandbox Tier Lock
    
    const targetNorm = getNormalizedTarget(); 
    let dFloat = targetNorm;
    
    if (selectedTarget) {
        dFloat = ((targetNorm * ((s.max_float ?? 1) - (s.min_float ?? 0))) + (s.min_float ?? 0));
    } else {
        let minL = parseFloat(document.getElementById("wearMinInput").value) || 0.15;
        let maxL = parseFloat(document.getElementById("wearMaxInput").value) || 0.38;
        dFloat = minL + (targetNorm * (maxL - minL)); // Approximate inside wear bar for sandbox
    }
    
    slots[idx].skin = s;
    slots[idx].float = parseFloat(dFloat.toFixed(4));
    
    const wear = getWearName(slots[idx].float);
    slots[idx].price = priceCache[getMarketHash(s.name, wear)] ? parseFloat((priceCache[getMarketHash(s.name, wear)] * getActiveCurrency().rate).toFixed(2)) : null;
    
    closeAllSlotDropdowns();
    updatePresetButtons(); 
    runCalculation();
}

function onPrimarySkinDropdownChange(idx) { selectEligiblePrimary(idx); }

function onFillerSkinDropdownChange(name) {
    secondarySkin = allSkins.find(s => s.name === name);
    if (!selectedTarget) return;
    const inputTier = TIER_ORDER[TIER_ORDER.indexOf(targetRarity(selectedTarget)) - 1], targetNorm = getNormalizedTarget();
    
    slots.forEach(slot => {
        if (slot.skin && getSafeCollectionName(slot.skin) !== getSafeCollectionName(selectedTarget)) {
            slot.skin = secondarySkin;
            slot.float = parseFloat(((targetNorm * ((secondarySkin.max_float ?? 1) - (secondarySkin.min_float ?? 0))) + (secondarySkin.min_float ?? 0)).toFixed(4));
            slot.price = priceCache[getMarketHash(secondarySkin.name, getWearName(slot.float))] ? parseFloat((priceCache[getMarketHash(secondarySkin.name, getWearName(slot.float))] * getActiveCurrency().rate).toFixed(2)) : null;
        }
    });
    
    runCalculation(); 
}

function applySplitPreset(primaryCount) {
    if (!selectedTarget) return;
    const inputTier = TIER_ORDER[TIER_ORDER.indexOf(targetRarity(selectedTarget)) - 1]; 
    ensureFillerSkinExists(inputTier);
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
        slots[i] = { skin: skin, float: flt, price: null };
        if (skin) {
            let hash = getMarketHash(skin.name, getWearName(flt));
            slots[i].price = priceCache[hash] ? parseFloat((priceCache[hash] * cur.rate).toFixed(2)) : null;
        }
    }
    updatePresetButtons(); runCalculation(); 
}

function applyMultiCheapestFiller() {
    if (!selectedTarget) return alert("Please select a target skin first to use auto-fillers.");
    const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget)); if (tIdx <= 0) return;
    const inputTier = TIER_ORDER[tIdx - 1], tColl = getSafeCollectionName(selectedTarget), cur = getActiveCurrency(), targetNorm = getNormalizedTarget();
    
    const cFillers = allSkins.filter(s => s && s.rarity && s.rarity.name === inputTier && getSafeCollectionName(s) !== "Standard Drop" && getSafeCollectionName(s) !== tColl && s.min_float !== null && s.max_float !== null);
    if (cFillers.length === 0) return alert("No valid fillers found.");

    const pricedFillers = [];
    cFillers.forEach(s => {
        let minF = s.min_float ?? 0, maxF = s.max_float ?? 1, dFloat = minF + (maxF - minF) * targetNorm;
        let priceUSD = priceCache[getMarketHash(s.name, getWearName(dFloat))];
        if (priceUSD !== undefined && priceUSD !== null && !isNaN(priceUSD)) pricedFillers.push({ skin: s, priceUSD, dFloat });
    });
    pricedFillers.sort((a, b) => a.priceUSD - b.priceUSD);
    
    const topFillers = [], seen = new Set();
    for (const item of pricedFillers) { if (!seen.has(item.skin.name)) { seen.add(item.skin.name); topFillers.push(item); if (topFillers.length >= 4) break; } }
    if (topFillers.length === 0) return alert("No priced fillers available.");
    
    let pCount = slots.filter(s => s.skin && getSafeCollectionName(s.skin) === tColl).length;
    if (pCount >= 10 || pCount === 0) pCount = 1; // Strict Primary Lock Force
    
    const pSkin = targetCollInputs[selectedPrimaryIndex] || targetCollInputs[0];
    if (!pSkin) return alert("No primary skins available for this target.");
    
    const pMin = pSkin.min_float ?? 0, pMax = pSkin.max_float ?? 1;
    const pFloat = parseFloat(((targetNorm * (pMax - pMin)) + pMin).toFixed(4));
    const pPriceUSD = priceCache[getMarketHash(pSkin.name, getWearName(pFloat))];
    const pPriceLocal = pPriceUSD !== undefined && pPriceUSD !== null ? parseFloat((pPriceUSD * cur.rate).toFixed(2)) : null;

    // Strict Primary Overwrite Lock
    for (let i = 0; i < 10; i++) {
        if (i < pCount) { 
            slots[i] = { skin: pSkin, float: pFloat, price: pPriceLocal };
        } else {
            let fEntry = topFillers[(i - pCount) % topFillers.length];
            let fMin = fEntry.skin.min_float ?? 0, fMax = fEntry.skin.max_float ?? 1;
            let fFloat = parseFloat(((targetNorm * (fMax - fMin)) + fMin).toFixed(4));
            let fPriceUSD = priceCache[getMarketHash(fEntry.skin.name, getWearName(fFloat))];
            slots[i] = { skin: fEntry.skin, float: fFloat, price: fPriceUSD !== undefined && fPriceUSD !== null ? parseFloat((fPriceUSD * cur.rate).toFixed(2)) : null };
        }
    }
    
    secondarySkin = slots[pCount].skin; 
    updatePresetButtons(); runCalculation(); 
}

function applyBudgetFiller() {
    if (!selectedTarget) return alert("Please select a target skin first to use auto-fillers.");
    const budgetInput = document.getElementById("budgetInput").value;
    const budgetLimit = parseFloat(budgetInput);
    if (isNaN(budgetLimit) || budgetLimit <= 0) return alert("Please enter a valid target budget.");

    const tIdx = TIER_ORDER.indexOf(targetRarity(selectedTarget)); 
    if (tIdx <= 0) return;
    const inputTier = TIER_ORDER[tIdx - 1], tColl = getSafeCollectionName(selectedTarget), cur = getActiveCurrency(), targetNorm = getNormalizedTarget();
    
    let pCount = slots.filter(s => s.skin && getSafeCollectionName(s.skin) === tColl).length;
    if (pCount >= 10 || pCount === 0) pCount = 1; // Strict Primary Lock Force
    
    const pSkin = targetCollInputs[selectedPrimaryIndex] || targetCollInputs[0];
    if (!pSkin) return alert("No primary skins available for this target.");
    
    const pMin = pSkin.min_float ?? 0, pMax = pSkin.max_float ?? 1;
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
    
    const cFillers = allSkins.filter(s => s && s.rarity && s.rarity.name === inputTier && getSafeCollectionName(s) !== "Standard Drop" && getSafeCollectionName(s) !== tColl && s.min_float !== null && s.max_float !== null);
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
    secondarySkin = topFillers.length > 0 ? topFillers[0].skin : null;

    // Strict Primary Overwrite Lock
    for (let i = 0; i < 10; i++) {
        if (i < pCount) { 
            slots[i] = { skin: pSkin, float: pFloat, price: pPriceLocal > 0 ? parseFloat(pPriceLocal.toFixed(2)) : null };
        } else {
            let fEntry = topFillers[(i - pCount) % topFillers.length];
            let fMin = fEntry.skin.min_float ?? 0, fMax = fEntry.skin.max_float ?? 1;
            let fFloat = parseFloat(((targetNorm * (fMax - fMin)) + fMin).toFixed(4));
            let fPriceUSD = priceCache[getMarketHash(fEntry.skin.name, getWearName(fFloat))];
            slots[i] = { skin: fEntry.skin, float: fFloat, price: fPriceUSD !== undefined && fPriceUSD !== null ? parseFloat((fPriceUSD * cur.rate).toFixed(2)) : null };
        }
    }
    updatePresetButtons(); runCalculation(); 
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
    runCalculation(); 
}

async function onSlotPriceChange(idx, val) { 
    slots[idx].price = val === "" ? null : parseFloat(val); 
    
    const skin = slots[idx].skin;
    if (skin) {
        const hash = getMarketHash(skin.name, getWearName(slots[idx].float));
        priceCache[hash] = val === "" ? null : parseFloat(val) / getActiveCurrency().rate;
        await dbPut('prices', 'master', priceCache); // Permanent save
    }
    
    updateFinancials(); 
    updateUrlHash(); 
}

function focusMissingPrice() {
    const outcomesList = document.getElementById("outcomesList");
    if(outcomesList) outcomesList.scrollIntoView({ behavior: "smooth", block: "center" });
    
    document.querySelectorAll(".val-input").forEach(input => {
        if(!input.value || isNaN(parseFloat(input.value))) {
            input.parentElement.classList.add("missing-pulse");
            setTimeout(() => input.parentElement.classList.remove("missing-pulse"), 2500);
            input.focus();
        }
    });
}

function computeAndRenderOutcomes() {
    let targetTier = null;
    if (selectedTarget) {
        targetTier = targetRarity(selectedTarget);
    } else if (sandboxTier) {
        const tIdx = TIER_ORDER.indexOf(sandboxTier);
        targetTier = TIER_ORDER[tIdx + 1];
    }
    if (!targetTier) return; 

    activeOutcomes = []; 
    let totalW = 0, totalR = 0, collCounts = {};
    let collImages = {};
    let filledSlots = slots.filter(s => s.skin);
    
    filledSlots.forEach(slot => {
        let w = ((slot.skin.max_float ?? 1) !== (slot.skin.min_float ?? 0)) ? (slot.float - (slot.skin.min_float ?? 0)) / ((slot.skin.max_float ?? 1) - (slot.skin.min_float ?? 0)) : 0;
        totalW += w; 
        totalR += slot.float;
        let cName = getSafeCollectionName(slot.skin); 
        if (cName !== "Standard Drop") {
            collCounts[cName] = (collCounts[cName] || 0) + 1;
            if (!collImages[cName]) collImages[cName] = getContainerImage(slot.skin);
        }
    });
    
    const avgWeightedFloat = filledSlots.length > 0 ? totalW / filledSlots.length : 0;
    const avgRawFloat = filledSlots.length > 0 ? totalR / filledSlots.length : 0;
    
    const avgFloatEl = document.getElementById("statAvgFloat");
    if (avgFloatEl) {
        avgFloatEl.innerHTML = `<span style="color: var(--text-muted); font-size: 11px;">Raw:</span> ${avgRawFloat.toFixed(4)} &nbsp;&bull;&nbsp; <span style="color: var(--text-muted); font-size: 11px;">Weighted:</span> ${avgWeightedFloat.toFixed(4)}`;
        avgFloatEl.dataset.avg = avgWeightedFloat.toString();
    }

    const curCode = document.getElementById("currencySelect") ? document.getElementById("currencySelect").value : "INR";
    const originParam = selectedTarget ? `&originTarget=${encodeURIComponent(selectedTarget.name)}` : "";
    
    document.getElementById("collectionsListText").innerHTML = Object.entries(collCounts).map(([c, count]) => {
        let nativeUrl = `collection.html?name=${encodeURIComponent(c)}&cur=${curCode}${originParam}`;
        return `
            <a href="${nativeUrl}" target="_blank" class="active-coll-pill" title="Inspect Collection">
                <div class="coll-img-box"><img src="${collImages[c]}"></div>
                <div class="active-coll-info">
                    <span class="active-coll-name">${c}</span>
                    <span class="active-coll-count">${count} Slot${count > 1 ? 's' : ''} (${((count/filledSlots.length)*100).toFixed(0)}%)</span>
                </div>
            </a>`;
    }).join("") || "None";
    
    const validCollsMap = new Map();
    allSkins.forEach(s => {
        if (s && s.rarity && s.rarity.name === (sandboxTier || TIER_ORDER[TIER_ORDER.indexOf(targetRarity(selectedTarget))-1]) && getSafeCollectionName(s) !== "Standard Drop") {
            if (!validCollsMap.has(getSafeCollectionName(s))) {
                validCollsMap.set(getSafeCollectionName(s), getContainerImage(s));
            }
        }
    });
    
    const validCollsArray = Array.from(validCollsMap.entries()).sort((a,b) => a[0].localeCompare(b[0]));
    
    document.getElementById("validCollectionsList").innerHTML = `<div class="valid-coll-grid">` + validCollsArray.map(([cName, img]) => {
         let nativeUrl = `collection.html?name=${encodeURIComponent(cName)}&cur=${curCode}${originParam}`;
         return `
            <a href="${nativeUrl}" target="_blank" class="valid-coll-card" title="${cName}">
                <div class="valid-coll-thumb"><img src="${img}"></div>
                <span class="valid-coll-title">${cName}</span>
            </a>`;
    }).join("") + `</div>`;
    
    const avgMarker = document.getElementById("avgFloatMarker");
    if (avgMarker) {
        avgMarker.style.left = `${Math.max(0, Math.min(100, avgRawFloat * 100)).toFixed(1)}%`;
        const isRisky = (avgRawFloat > 0.14 && avgRawFloat < 0.15) || (avgRawFloat > 0.37 && avgRawFloat < 0.38) || (avgRawFloat > 0.44 && avgRawFloat < 0.45);
        avgMarker.style.backgroundColor = isRisky ? "#f59e0b" : "#fff";
        avgMarker.style.boxShadow = isRisky ? "0 0 6px #f59e0b" : "0 0 4px #0ff";
    }
  
    Object.entries(collCounts).forEach(([c, count]) => {
        const outs = allSkins.filter(s => s && s.rarity && s.rarity.name === targetTier && getSafeCollectionName(s) === c);
        const p = (count / filledSlots.length) / (outs.length || 1);
        outs.forEach(skin => activeOutcomes.push({ skin, probability: p, collection: c }));
    });
    
    renderOutcomeCards(avgWeightedFloat); 
}

function renderOutcomeCards(avgW) {
    const container = document.getElementById("outcomesList"); 
    container.innerHTML = "";
    
    const cur = getActiveCurrency();
    const targetTier = selectedTarget ? targetRarity(selectedTarget) : TIER_ORDER[TIER_ORDER.indexOf(sandboxTier) + 1];
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
        
        if (selectedTarget && entry.skin.name === selectedTarget.name) targetOdds += entry.probability * 100;
        
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
        const isTarget = selectedTarget && item.entry.skin.name === selectedTarget.name;
        
        row.innerHTML = `
            <div class="item-left">
                <div class="rarity-pill" style="background-color: ${color}"></div>
                <img class="item-thumb" src="${item.entry.skin.image || ''}" onerror="this.style.display='none'">
                <div class="item-details">
                    <div class="item-name">${item.entry.skin.name} <span class="badge" style="color: ${color}; border: 1px solid ${color};">${targetTier}</span> ${isTarget ? '<span class="badge badge-best">Target</span>' : ''} ${isStatTrak ? '<span class="badge badge-st">StatTrak™</span>' : ''}</div>
                    <div class="item-source">${getSourceInfo(item.entry.skin)}</div>
                    <div class="item-subtext">Float: ${item.outFloat.toFixed(4)} &bull; <span class="condition-pill ${item.safe ? 'match' : item.risky ? 'risky' : 'miss'}">${item.risky ? item.outWear + ' (Risky)' : item.outWear}</span> &bull; Odds: <b>${item.odds.toFixed(1)}%</b></div>
                </div>
            </div>
            <div class="item-right">
                <a href="${getCSFloatSearchUrl(item.hash)}" target="_blank" class="csfloat-link-btn" title="View listings on CSFloat">CSFloat ↗</a>
                <a href="${getSteamMarketUrl(item.hash)}" target="_blank" class="market-link-btn" title="View floor price on Steam Market">Steam Market ↗</a>
                <div class="price-input-group"><span class="currency-symbol">${cur.symbol}</span><input type="number" step="0.01" min="0" class="val-input" id="outcome-price-${item.originalIdx}" placeholder="N/A" value="${item.priceDisp}" oninput="onOutcomePriceChange(${item.originalIdx}, this.value)"></div>
                <span id="outcome-pnl-${item.originalIdx}" class="pnl-badge">N/A</span>
            </div>
        `;
        container.appendChild(row);
    });
    
    document.getElementById("statOdds").textContent = selectedTarget ? `${targetOdds.toFixed(1)}%` : "N/A (Sandbox)";
    
    updateFinancials();
}

async function onOutcomePriceChange(idx, val) {
    let totalW = 0;
    let filledSlots = slots.filter(s => s.skin);
    filledSlots.forEach(slot => { 
        totalW += ((slot.skin?.max_float ?? 1) !== (slot.skin?.min_float ?? 0)) ? (slot.float - (slot.skin?.min_float ?? 0)) / ((slot.skin?.max_float ?? 1) - (slot.skin?.min_float ?? 0)) : 0; 
    });
    let avgW = filledSlots.length > 0 ? totalW / filledSlots.length : 0;
    let entry = activeOutcomes[idx];
    let outFloat = (avgW * ((entry.skin.max_float ?? 1) - (entry.skin.min_float ?? 0))) + (entry.skin.min_float ?? 0);
    
    const hash = getMarketHash(entry.skin.name, getWearName(outFloat));
    priceCache[hash] = val === "" ? null : parseFloat(val) / getActiveCurrency().rate;
    await dbPut('prices', 'master', priceCache); // Permanent save
    
    updateFinancials();
}

function updateFinancials() {
    const cur = getActiveCurrency(), fee = parseFloat(document.getElementById("feeSelect").value);
    
    let totalCost = 0, missing = false; 
    slots.forEach((s) => { 
        if (s.skin && (s.price === null || isNaN(s.price))) missing = true; 
        else if (s.skin) totalCost += s.price; 
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
        if (inputField && s.skin) {
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
        
        let targetEntry = activeOutcomes.find(o => selectedTarget && o.skin.name === selectedTarget.name);
        if(targetEntry && totalCost > 0) {
            let bePrice = totalCost / (targetEntry.probability * fee);
            bEl.innerHTML = `<span style="font-size: 10px; color: var(--text-muted); display: block; line-height: 1;">Target Break-Even</span>${formatMoney(bePrice)}`;
            bEl.className = "stat-value gold";
        } else {
            bEl.textContent = "N/A";
        }
        wrEl.textContent = "N/A"; 
        
        vEl.innerHTML = `<button class="action-btn" style="color: var(--accent-gold); border-color: var(--accent-gold); width: 100%; height: 24px; font-size: 10px;" onclick="focusMissingPrice()">⚠ Enter Missing Price</button>`;
        vEl.className = "stat-value";
        
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

// GLOBAL CLICKS
document.addEventListener("click", e => {
    const searchWrapper = document.querySelector(".search-wrapper");
    if (searchWrapper && !searchWrapper.contains(e.target)) { const drop = document.getElementById("dropdownResults"); if (drop) drop.style.display = "none"; }
    if (!e.target.closest(".slot-picker-wrap")) closeAllSlotDropdowns();
    
    const validFillersBtn = document.querySelector(".collection-action-btn");
    const validFillersList = document.getElementById("validCollectionsList");
    if (validFillersList && validFillersBtn && !validFillersList.contains(e.target) && !validFillersBtn.contains(e.target)) {
        closeValidCollections();
    }
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
    let filledSlots = slots.filter(s => s.skin);
    filledSlots.forEach(slot => { 
        totalW += ((slot.skin?.max_float ?? 1) !== (slot.skin?.min_float ?? 0)) ? (slot.float - (slot.skin?.min_float ?? 0)) / ((slot.skin?.max_float ?? 1) - (slot.skin?.min_float ?? 0)) : 0; 
    });
    const avgW = filledSlots.length > 0 ? totalW / filledSlots.length : 0;

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
        collEl.textContent = getSafeCollectionName(wonEntry.skin);
        
        wearNameEl.textContent = outWear;
        floatValEl.textContent = outFloat.toFixed(4);
        markerEl.style.left = `${Math.max(0, Math.min(100, outFloat * 100)).toFixed(1)}%`;
        priceTxt.textContent = `${cur.symbol}${outPriceLocal.toFixed(2)}`;
        
        let pnlSign = netProfit >= 0 ? '+' : '';
        pnl.textContent = `${pnlSign}${formatMoney(netProfit)}`; pnl.className = `sim-result-pnl ${netProfit < 0 ? 'loss' : ''}`;

        card.classList.add("stage-reveal"); await delay(200); card.classList.add("stage-details");

        simStats.runs++; simStats.invested += currentTotalInputCost; if (netProfit >= 0) simStats.wins++; else simStats.losses++; simStats.profit += netProfit;
    }
    
    let lifetime = await dbGet('sim_history', 'lifetime') || { runs: 0, wins: 0, losses: 0, profit: 0, invested: 0 };
    lifetime.runs += simStats.runs; lifetime.wins += simStats.wins; lifetime.losses += simStats.losses; lifetime.profit += simStats.profit; lifetime.invested += simStats.invested;
    await dbPut('sim_history', 'lifetime', lifetime);
    
    await delay(700); document.getElementById("simTitle").textContent = "Contract Executed"; await renderPostDashboard(lifetime);
}

async function renderPostDashboard(lifetime) {
    const dashContainer = document.getElementById("simPostDashboard");
    let winRate = ((simStats.wins / simStats.runs) * 100).toFixed(1), totalPnlSign = simStats.profit >= 0 ? '+' : '', totalPnlClass = simStats.profit >= 0 ? 'green' : 'red';
    let lifeWinRate = lifetime.runs > 0 ? ((lifetime.wins / lifetime.runs) * 100).toFixed(1) : "0.0";
    let lifePnlSign = lifetime.profit >= 0 ? '+' : '', lifePnlClass = lifetime.profit >= 0 ? 'green' : 'red';

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

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 6px;">
            <div class="sim-stats-container" style="opacity: 1; margin-top: 0;">
                <div style="font-size: 9px; text-transform: uppercase; font-weight: 800; color: var(--accent-cyan); text-align: center; margin-bottom: 4px;">Current Session</div>
                <div class="sim-stat-row">
                    <div class="sim-stat-box"><span class="sim-stat-lbl">Runs</span><span class="sim-stat-val">${simStats.runs}</span></div>
                    <div class="sim-stat-box"><span class="sim-stat-lbl">Win %</span><span class="sim-stat-val gold">${winRate}%</span></div>
                </div>
                <div class="sim-stat-row">
                    <div class="sim-stat-box" style="flex: 1;"><span class="sim-stat-lbl">Session P/L</span><span class="sim-stat-val large ${totalPnlClass}">${totalPnlSign}${formatMoney(simStats.profit)}</span></div>
                </div>
            </div>
            <div class="sim-stats-container" style="opacity: 1; margin-top: 0; border-color: rgba(245, 158, 11, 0.2); position: relative;">
                <button onclick="resetLifetimeStats()" style="position: absolute; top: 8px; right: 8px; background: rgba(239, 68, 68, 0.15); border: 1px solid var(--accent-red); color: var(--accent-red); border-radius: 4px; padding: 3px 6px; font-size: 8px; font-weight: 800; cursor: pointer; text-transform: uppercase; transition: all 0.2s;">🗑 Clear</button>
                <div style="font-size: 9px; text-transform: uppercase; font-weight: 800; color: var(--accent-gold); text-align: center; margin-bottom: 4px;">Lifetime Account</div>
                <div class="sim-stat-row">
                    <div class="sim-stat-box"><span class="sim-stat-lbl">Total Runs</span><span class="sim-stat-val">${lifetime.runs}</span></div>
                    <div class="sim-stat-box"><span class="sim-stat-lbl">Win %</span><span class="sim-stat-val gold">${lifeWinRate}%</span></div>
                </div>
                <div class="sim-stat-row">
                    <div class="sim-stat-box" style="flex: 1;"><span class="sim-stat-lbl">Lifetime P/L</span><span class="sim-stat-val large ${lifePnlClass}">${lifePnlSign}${formatMoney(lifetime.profit)}</span></div>
                </div>
            </div>
        </div>
        ${outcomesGridHtml}
    `;
    dashContainer.style.display = "block";
}

// ============================================================================
// 8. BINDER & SHARING
// ============================================================================
function copyShareUrl() {
    updateUrlHash(); 
    navigator.clipboard.writeText(window.location.href).then(() => {
        const el = document.getElementById("shareBtnText"); 
        el.textContent = "✔ Copied!"; 
        setTimeout(() => { el.textContent = "🔗 Link"; }, 2000);
    });
}

async function toggleBinder() {
    const panel = document.getElementById("binderPanel"), overlay = document.getElementById("binderOverlay");
    if (panel.classList.contains("open")) { 
        panel.classList.remove("open"); overlay.style.display = "none"; 
    } else { 
        await renderBinderList(); 
        panel.classList.add("open"); overlay.style.display = "block"; 
    }
}

async function saveCurrentRecipe() {
    if (!selectedTarget) return alert("Currently, only target-based reverse recipes can be saved to the binder."); 
    updateUrlHash();
    const currentHash = window.location.hash; if (!currentHash) return;
    
    let saved = await dbGet('recipes', 'saved_list') || [];
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
    
    await dbPut('recipes', 'saved_list', saved);
    const btn = document.getElementById("saveBinderText"); 
    btn.textContent = "✔ Saved!"; 
    setTimeout(() => { btn.textContent = "⭐ Save"; }, 2000);
}

async function renderBinderList() {
    const container = document.getElementById("binderContent");
    const saved = await dbGet('recipes', 'saved_list') || [];
    if (saved.length === 0) { container.innerHTML = `<div class="binder-empty">No saved recipes found.<br><br>Click ⭐ Save.</div>`; return; }
    container.innerHTML = "";
    saved.forEach(r => {
        const card = document.createElement("div"); card.className = "saved-card";
        card.innerHTML = `<div class="saved-card-title">${r.st ? 'StatTrak™ ' : ''}${r.name}</div><div class="saved-card-date">Target Wear: ${r.wear} &bull; Saved: ${r.date}</div><div class="saved-card-actions"><div class="saved-btn-load" onclick="loadSavedRecipe('${r.hash}')">Load Setup</div><button class="saved-btn-del" onclick="deleteSavedRecipe(${r.id})" title="Delete">🗑</button></div>`;
        container.appendChild(card);
    });
}

function loadSavedRecipe(hash) { toggleBinder(); history.replaceState(null, "", hash); checkUrlHashLoad(); }
async function deleteSavedRecipe(id) { 
    let saved = await dbGet('recipes', 'saved_list') || []; 
    await dbPut('recipes', 'saved_list', saved.filter(r => r.id !== id)); 
    renderBinderList(); 
}

// Function to permanently reset lifetime simulation data
async function resetLifetimeStats() {
    if (confirm("Are you sure you want to delete all your lifetime simulation data? This cannot be undone.")) {
        await dbPut('sim_history', 'lifetime', { runs: 0, wins: 0, losses: 0, profit: 0, invested: 0 });
        simStats = { runs: 0, wins: 0, losses: 0, profit: 0, invested: 0, hits: {} }; // Clear active session to prevent ghost math
        closeSimulator();
    }
}