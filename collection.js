const CURRENCIES = { INR: { symbol: "₹", rate: 88.0 }, USD: { symbol: "$", rate: 1.0 }, EUR: { symbol: "€", rate: 0.92 } };
const TIER_ORDER = ["Consumer Grade", "Industrial Grade", "Mil-Spec Grade", "Restricted", "Classified", "Covert"];
const RARITY_HEX = { "Consumer Grade": "#b0c3d9", "Industrial Grade": "#5e98d9", "Mil-Spec Grade": "#4b69ff", "Restricted": "#8847ff", "Classified": "#d32ce6", "Covert": "#eb4b4b" };

let currentCollectionName = "";
let allSkinsGlobal = [];
let collectionSkins = [];
let hubContainers = [];

let activeRarityFilter = "ALL";
let activeHubFilter = "ALL";
let priceCache = window.LOCAL_PRICES || {};

document.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(window.location.search);
    currentCollectionName = params.get("name") ? decodeURIComponent(params.get("name")) : "";
    const curParam = params.get("cur");
    if (curParam && CURRENCIES[curParam]) document.getElementById("currencySelect").value = curParam;

    await loadDatabaseAndRender();
});

// Non-Destructive Navigation (Feature 9)
function smartBack() {
    if (window.history.length > 1) window.history.back();
    else window.location.href = 'index.html';
}

function openAllCollections() {
    window.location.href = 'collection.html' + (document.getElementById("currencySelect") ? `?cur=${document.getElementById("currencySelect").value}` : '');
}

function getActiveCurrency() {
    const curSelect = document.getElementById("currencySelect");
    return CURRENCIES[curSelect ? curSelect.value : "INR"] || CURRENCIES.INR;
}

function formatMoney(amount) {
    if (isNaN(amount) || amount === null) return "N/A";
    return `${getActiveCurrency().symbol}${amount.toFixed(2)}`;
}

// Fallback Image Resolver (Feature 4)
function getResolvedImage(skin, cName) {
    if (skin.collections && skin.collections[0]?.name === cName && skin.collections[0]?.image) return skin.collections[0].image;
    if (skin.crates && skin.crates.length > 0) {
        let match = skin.crates.find(c => c.name === cName);
        if (match && match.image) return match.image;
        if (skin.crates[0].image) return skin.crates[0].image;
    }
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%238492a6"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';
}

async function loadDatabaseAndRender() {
    try {
        const cached = localStorage.getItem("CS2_SKINS_DB");
        if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
                processGlobalData(parsed);
                return;
            }
        }
    } catch(e) {}

    try {
        const res = await fetch("https://raw.githubusercontent.com/ByMyKel/CSGO-API/main/public/api/en/skins.json");
        const data = await res.json();
        if (Array.isArray(data)) {
            localStorage.setItem("CS2_SKINS_DB", JSON.stringify(data));
            processGlobalData(data);
        }
    } catch(err) {
        document.getElementById("heroTitle").textContent = "Failed to load skin database.";
    }
}

function processGlobalData(data) {
    allSkinsGlobal = data;
    if (currentCollectionName) {
        document.getElementById("hubView").style.display = "none";
        document.getElementById("detailView").style.display = "block";
        processDetailMode();
    } else {
        document.getElementById("detailView").style.display = "none";
        document.getElementById("hubView").style.display = "block";
        processHubMode();
    }
}

// ============================================================================
// HUB DIRECTORY MODE (Features 5 & 8)
// ============================================================================
function processHubMode() {
    const cMap = new Map();
    allSkinsGlobal.forEach(s => {
        if (s.collections && s.collections.length > 0) {
            let n = s.collections[0].name;
            if (!cMap.has(n)) cMap.set(n, { name: n, type: "Collection", img: s.collections[0].image, count: 0 });
            cMap.get(n).count++;
        }
        if (s.crates && s.crates.length > 0) {
            s.crates.forEach(c => {
                if (!cMap.has(c.name)) cMap.set(c.name, { name: c.name, type: c.name.includes("Souvenir") ? "Souvenir" : "Case", img: c.image, count: 0 });
                cMap.get(c.name).count++;
            });
        }
    });
    hubContainers = Array.from(cMap.values()).sort((a,b) => a.name.localeCompare(b.name));
    renderHubGrid();
}

function setHubFilter(type, btn) {
    activeHubFilter = type;
    document.querySelectorAll("#hubFilters .filter-pill").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    renderHubGrid();
}

function renderHubGrid() {
    const grid = document.getElementById("hubGrid");
    grid.innerHTML = "";
    const searchVal = (document.getElementById("hubSearchInput").value || "").toLowerCase();

    const filtered = hubContainers.filter(c => {
        if (activeHubFilter !== "ALL" && c.type !== activeHubFilter) return false;
        if (searchVal && !c.name.toLowerCase().includes(searchVal)) return false;
        return true;
    });

    filtered.forEach(c => {
        const card = document.createElement("a");
        card.className = "hub-card";
        const curCode = document.getElementById("currencySelect").value;
        card.href = `collection.html?name=${encodeURIComponent(c.name)}&cur=${curCode}`;
        
        let fallback = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%238492a6"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';
        
        card.innerHTML = `
            <div class="hub-thumb-box"><img class="hub-thumb" src="${c.img || fallback}" onerror="this.src='${fallback}'"></div>
            <div class="hub-title">${c.name}</div>
            <div class="hub-badge">${c.count} Skins</div>
        `;
        grid.appendChild(card);
    });
}

// ============================================================================
// DETAIL VIEWER MODE
// ============================================================================
function processDetailMode() {
    document.getElementById("heroTitle").textContent = currentCollectionName;
    
    collectionSkins = allSkinsGlobal.filter(s => {
        let inColl = s.collections && s.collections.some(c => c.name.toLowerCase() === currentCollectionName.toLowerCase());
        let inCrate = s.crates && s.crates.some(c => c.name.toLowerCase() === currentCollectionName.toLowerCase());
        return inColl || inCrate;
    });

    if (collectionSkins.length > 0) {
        document.getElementById("heroImg").src = getResolvedImage(collectionSkins[0], currentCollectionName);
    }
    
    document.getElementById("heroCount").textContent = `${collectionSkins.length} Skins Available`;
    filterCollectionSkins();
}

function getBasePrice(skin) {
    let floor = null;
    ["Field-Tested", "Minimal Wear", "Factory New", "Battle-Scarred"].forEach(w => {
        let p = priceCache[`${skin.name} (${w})`] || priceCache[`StatTrak™ ${skin.name} (${w})`];
        if (p !== undefined && p !== null && (floor === null || p < floor)) floor = p;
    });
    return floor;
}

// Upgrades To Path (Feature 10)
function getUpgradePathHTML(currentSkin) {
    let currentIdx = TIER_ORDER.indexOf(currentSkin.rarity?.name || "");
    if (currentIdx === -1 || currentIdx === TIER_ORDER.length - 1) return ''; 
    let nextTier = TIER_ORDER[currentIdx + 1];
    
    let upgrades = collectionSkins.filter(s => s.rarity?.name === nextTier);
    if (upgrades.length === 0) return '';
    
    return `<div class="upgrade-path">Upgrades to: ${upgrades.length} ${nextTier} skin${upgrades.length > 1 ? 's' : ''}</div>`;
}

function renderSkinsGrid(skins) {
    const grid = document.getElementById("collectionGrid");
    grid.innerHTML = "";
    const cur = getActiveCurrency();
    
    skins.forEach(skin => {
        const rarityName = skin.rarity?.name || "Mil-Spec Grade";
        const rColor = RARITY_HEX[rarityName] || "#4b69ff";
        const minF = skin.min_float ?? 0.00, maxF = skin.max_float ?? 1.00;

        let floorPriceUSD = getBasePrice(skin);
        let hasWarning = floorPriceUSD === null || floorPriceUSD === 0; // Liquidity Warning (Feature 12)
        
        let priceDispHtml = hasWarning 
            ? `<span style="color: var(--accent-gold);" title="Low liquidity or missing price data. Check market manually.">⚠️ Unknown Price</span>` 
            : `Floor: ${formatMoney(floorPriceUSD * cur.rate)}`;

        const card = document.createElement("div");
        card.className = "skin-card";
        card.innerHTML = `
            <div class="skin-card-topbar" style="background-color: ${rColor};"></div>
            <div class="skin-card-body">
                <div class="skin-card-thumb-box">
                    <img class="skin-card-thumb" src="${skin.image || ''}" alt="" onerror="this.style.display='none'">
                </div>
                <div class="skin-card-info">
                    <div class="skin-card-name">
                        <span>${skin.name}</span>
                        ${skin.stattrak ? '<span class="badge badge-st" style="font-size:8px; padding:2px 4px;">ST</span>' : ''}
                    </div>
                    <div class="skin-card-meta">
                        <span>${rarityName}</span>
                        <span>Float: ${minF.toFixed(2)} - ${maxF.toFixed(2)}</span>
                    </div>
                    <div class="skin-card-price">${priceDispHtml}</div>
                    ${getUpgradePathHTML(skin)}
                </div>
            </div>
            <div class="skin-card-actions">
                <a href="https://csfloat.com/search?market_hash_name=${encodeURIComponent(skin.name + ' (Field-Tested)')}" target="_blank" class="csfloat-link-btn" style="text-align:center; justify-content:center;">CSFloat ↗</a>
                <a href="https://steamcommunity.com/market/listings/730/${encodeURIComponent(skin.name + ' (Field-Tested)')}" target="_blank" class="market-link-btn" style="text-align:center; justify-content:center;">Steam ↗</a>
                <button class="select-btn skin-card-full-btn" onclick="useAsTarget('${encodeURIComponent(skin.name)}')">🎯 Use as Target</button>
                <button class="select-btn skin-card-filler-btn" onclick="sendToFiller('${encodeURIComponent(skin.name)}')">➕ Send to Filler</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function setRarityFilter(tier, btn) {
    activeRarityFilter = tier;
    document.querySelectorAll("#rarityFilters .filter-pill").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    filterCollectionSkins();
}

function filterCollectionSkins() {
    const searchVal = (document.getElementById("skinSearchInput").value || "").toLowerCase();
    const sortMode = document.getElementById("priceSortSelect").value;

    let filtered = collectionSkins.filter(skin => {
        if (activeRarityFilter !== "ALL" && skin.rarity?.name !== activeRarityFilter) return false;
        if (searchVal && !skin.name.toLowerCase().includes(searchVal)) return false;
        return true;
    });

    // Dynamic Price Sorting (Feature 7)
    filtered.sort((a, b) => {
        if (sortMode === "price_asc" || sortMode === "price_desc") {
            let pA = getBasePrice(a) || 0, pB = getBasePrice(b) || 0;
            if (pA === 0) return 1; if (pB === 0) return -1; // Push missing prices to bottom
            return sortMode === "price_asc" ? pA - pB : pB - pA;
        } else {
            let tA = TIER_ORDER.indexOf(a.rarity?.name || ""), tB = TIER_ORDER.indexOf(b.rarity?.name || "");
            return tB - tA;
        }
    });

    renderSkinsGrid(filtered);
}

function onCurrencyChange() {
    if (currentCollectionName) filterCollectionSkins();
    else renderHubGrid();
}

// Action Buttons
function useAsTarget(skinName) {
    const curCode = document.getElementById("currencySelect").value;
    window.location.href = `index.html?target=${skinName}&cur=${curCode}#target=${skinName}`;
}

// Send to Filler Injection (Feature 11)
function sendToFiller(skinName) {
    const curCode = document.getElementById("currencySelect").value;
    window.location.href = `index.html?filler=${skinName}&cur=${curCode}#filler=${skinName}`;
}