const CARD_ASSET_BASE = "assets/card";
const CARD_PREFS_PREFIX = "badgeGuideCardPrefs:";
const CARD_TEMPLATE = {
  width: 953,
  height: 624,
  avatar: { x: 24, y: 78, width: 128, height: 128 },
  characterName: { x: 286.847, y: 96.3 },
  favoriteTitle: { x: 290, y: 129.44 },
  favoriteBadge: { x: 269, y: 285, width: 145, height: 145 },
  favoriteName: { x: 340, y: 434.258 },
  expBar: { x: 26, y: 516, width: 419, height: 28 },
  starText: [
    { rating: "1", x: 159.094, y: 289.8 },
    { rating: "2", x: 159.094, y: 332.8 },
    { rating: "3", x: 158.094, y: 374.8 },
    { rating: "4", x: 158.094, y: 415.8 },
    { rating: "5", x: 158.094, y: 457.8 },
  ],
  badgePositions: [
    { x: 572, y: 99 },
    { x: 768, y: 99 },
    { x: 573, y: 208 },
    { x: 769, y: 208 },
    { x: 572, y: 318 },
    { x: 768, y: 318 },
    { x: 572, y: 426 },
    { x: 768, y: 426 },
  ],
  badgeTextPositions: [
    { x: 611, y: 179.78 },
    { x: 806.5, y: 179.78 },
    { x: 612, y: 288.78 },
    { x: 807.5, y: 288.78 },
    { x: 611, y: 397.78 },
    { x: 806.5, y: 397.78 },
    { x: 611, y: 505.78 },
    { x: 806.5, y: 505.78 },
  ],
};

let originalBadges = [];
let cardSettings = [];
let puzzleData = {
  puzzles: [],
  badgePuzzles: [],
  clears: [],
};
function readInitialDiscordId() {
  const urlDiscordId = new URLSearchParams(window.location.search).get("discordId");
  if (urlDiscordId) return urlDiscordId.trim();
  try {
    return window.localStorage?.getItem("discordId") || "";
  } catch (_) {
    return "";
  }
}

let discordId = readInitialDiscordId();
let clearsByJumper = new Map();
let badgePuzzleRequirements = new Map();
let ownedBadges = [];
let cardPreviewRenderToken = 0;
let cardFontPromise = null;
const cardImageCache = new Map();

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function getBadgeImageUrl(badge) {
  if (!badge || !badge.imageUrl) return "placeholder.png";
  const extension = badge.imageUrl.split("?")[0].split(".").pop() || "png";
  return `sh-dump/badges/${badge.id}.${extension}`;
}

function cleanImageUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed, window.location.href);
    if (!["http:", "https:", "data:"].includes(url.protocol)) return "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function normalizeAvatarUrl(value) {
  const cleaned = cleanImageUrl(value);
  if (!cleaned) return "";

  try {
    const url = new URL(cleaned);
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);

    if ((host === "imgur.com" || host === "www.imgur.com") && segments.length === 1) {
      const fileMatch = segments[0].match(/^([a-z0-9]+)\.(png|jpe?g|webp|gif)$/i);
      if (fileMatch) {
        return `https://i.imgur.com/${fileMatch[1]}.${fileMatch[2].toLowerCase()}`;
      }

      if (/^[a-z0-9]+$/i.test(segments[0])) {
        return `https://i.imgur.com/${segments[0]}.png`;
      }
    }

    if (host === "i.imgur.com" && segments.length === 1 && /^[a-z0-9]+$/i.test(segments[0])) {
      return `https://i.imgur.com/${segments[0]}.png`;
    }
  } catch (_) {
    return cleaned;
  }

  return cleaned;
}

function getImageLoadCandidates(src) {
  const cleaned = normalizeAvatarUrl(src);
  if (!cleaned) return [];

  try {
    const url = new URL(cleaned);
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);

    if ((host === "imgur.com" || host === "www.imgur.com") && segments.length === 1) {
      const fileMatch = segments[0].match(/^([a-z0-9]+)\.(png|jpe?g|webp|gif)$/i);
      if (fileMatch) {
        return [`https://i.imgur.com/${fileMatch[1]}.${fileMatch[2].toLowerCase()}`];
      }

      if (!/^[a-z0-9]+$/i.test(segments[0])) return [cleaned];
      const id = segments[0];
      return [
        `https://i.imgur.com/${id}.png`,
        `https://i.imgur.com/${id}.jpg`,
        `https://i.imgur.com/${id}.jpeg`,
        `https://i.imgur.com/${id}.webp`,
        `https://i.imgur.com/${id}.gif`,
      ];
    }

    if (host === "i.imgur.com" && segments.length === 1 && /^[a-z0-9]+$/i.test(segments[0])) {
      const id = segments[0];
      return [
        `https://i.imgur.com/${id}.png`,
        `https://i.imgur.com/${id}.jpg`,
        `https://i.imgur.com/${id}.jpeg`,
        `https://i.imgur.com/${id}.webp`,
        `https://i.imgur.com/${id}.gif`,
      ];
    }
  } catch (_) {
    // Local paths are resolved by cleanImageUrl and should load as-is.
  }

  return [cleaned];
}

function readCardPreferences(userId = discordId) {
  if (!userId) return {};
  try {
    return JSON.parse(window.localStorage?.getItem(`${CARD_PREFS_PREFIX}${userId}`) || "{}");
  } catch (_) {
    return {};
  }
}

function saveCardPreferences(state) {
  if (!state?.userId) return;
  try {
    window.localStorage?.setItem(
      `${CARD_PREFS_PREFIX}${state.userId}`,
      JSON.stringify({
        cardPhotoUrl: state.cardPhotoUrl || "",
        autoShine: state.autoShine !== false,
      })
    );
  } catch (_) {
    // Embedded contexts may block storage; the encoded embed URL remains authoritative.
  }
}

function normalizeAvatarInputValue(input) {
  const normalizedUrl = normalizeAvatarUrl(input.value);
  if (normalizedUrl && normalizedUrl !== input.value.trim()) {
    input.value = normalizedUrl;
    updateCardEditorPreview();
  }
}

function sortById(a, b) {
  return parseInt(a.id, 10) - parseInt(b.id, 10);
}

function parseDisplayBadges(value) {
  if (Array.isArray(value)) {
    return value.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id));
  }

  if (typeof value !== "string" || value.trim() === "") return [];

  try {
    return parseDisplayBadges(JSON.parse(value));
  } catch (_) {
    return value
      .split(",")
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !Number.isNaN(id));
  }
}

function normalizeCardSetting(setting) {
  return {
    userId: String(setting?.userId || ""),
    characterName: setting?.characterName || "",
    cardPhotoUrl: setting?.cardPhotoUrl || "",
    favoriteBadge: setting?.favoriteBadge ? parseInt(setting.favoriteBadge, 10) : null,
    displayBadges: parseDisplayBadges(setting?.displayBadges).slice(0, 8),
  };
}

function getBadgeById(id) {
  const badgeId = parseInt(id, 10);
  if (Number.isNaN(badgeId)) return null;
  return originalBadges.find((badge) => parseInt(badge.id, 10) === badgeId) || null;
}

function isOwnedBadgeId(id) {
  const badgeId = parseInt(id, 10);
  return ownedBadges.some((badge) => parseInt(badge.id, 10) === badgeId);
}

function normalizeCardState(state = {}) {
  const displayBadges = Array.isArray(state.displayBadges)
    ? state.displayBadges.map((id) => (id ? parseInt(id, 10) : null))
    : parseDisplayBadges(state.displayBadges);

  while (displayBadges.length < 8) displayBadges.push(null);

  return {
    userId: String(state.userId || discordId || ""),
    characterName: state.characterName || "",
    cardPhotoUrl: normalizeAvatarUrl(state.cardPhotoUrl),
    autoShine: state.autoShine !== false,
    favoriteBadge: state.favoriteBadge ? parseInt(state.favoriteBadge, 10) : null,
    displayBadges: displayBadges.slice(0, 8).map((id) => {
      const parsed = parseInt(id, 10);
      return Number.isNaN(parsed) ? null : parsed;
    }),
  };
}

function getUserCardSetting(userId = discordId) {
  if (!userId) return null;
  return cardSettings
    .map(normalizeCardSetting)
    .find((setting) => setting.userId.padStart(20, "0") === userId.padStart(20, "0")) || null;
}

function getDefaultCardState() {
  const setting = getUserCardSetting();
  const preferences = readCardPreferences();
  const displayBadges = (setting?.displayBadges || []).filter(isOwnedBadgeId).slice(0, 8);
  const firstOwnedBadge = ownedBadges[0]?.id || null;
  const favoriteBadge = setting?.favoriteBadge && isOwnedBadgeId(setting.favoriteBadge) ? setting.favoriteBadge : displayBadges[0] || firstOwnedBadge;

  return normalizeCardState({
    userId: discordId,
    characterName: setting?.characterName || "",
    cardPhotoUrl: preferences.cardPhotoUrl ?? setting?.cardPhotoUrl ?? "",
    autoShine: preferences.autoShine ?? true,
    favoriteBadge,
    displayBadges,
  });
}

function indexData() {
  clearsByJumper = new Map();
  badgePuzzleRequirements = new Map();

  puzzleData.clears.forEach((clear) => {
    const paddedJumper = String(clear.jumper).padStart(20, "0");
    if (!clearsByJumper.has(paddedJumper)) {
      clearsByJumper.set(paddedJumper, new Set());
    }
    clearsByJumper.get(paddedJumper).add(clear.puzzleId);
  });

  originalBadges.forEach((badge) => {
    const requirements = puzzleData.badgePuzzles.filter((bp) => bp.badgeId === badge.id).map((bp) => bp.puzzleId);
    badgePuzzleRequirements.set(badge.id, requirements);
  });
}

function hasUserCompletedBadge(badge, userId = discordId) {
  if (!userId) return false;
  const requirements = badgePuzzleRequirements.get(badge.id) || [];
  if (requirements.length === 0) return false;
  const userClears = clearsByJumper.get(userId.padStart(20, "0")) || new Set();
  return requirements.every((puzzleId) => userClears.has(puzzleId));
}

function updateOwnedBadges() {
  ownedBadges = discordId ? originalBadges.filter((badge) => hasUserCompletedBadge(badge)).sort(sortById) : [];
}

function populateBadgeSelect(select, selectedValue = "", includeNone = true) {
  select.innerHTML = "";
  if (includeNone) {
    select.appendChild(new Option("None", ""));
  }

  ownedBadges.forEach((badge) => {
    select.appendChild(new Option(`#${badge.id} ${badge.name}`, String(badge.id)));
  });

  const value = selectedValue && isOwnedBadgeId(selectedValue) ? String(selectedValue) : "";
  select.value = value;
  select.disabled = ownedBadges.length === 0;
}

function buildSlotControls() {
  const slotControls = document.getElementById("cardSlotControls");
  slotControls.innerHTML = "";

  for (let index = 0; index < 8; index += 1) {
    const row = document.createElement("label");
    row.className = "slot-row";
    row.innerHTML = `<span>Slot ${index + 1}</span>`;
    const select = document.createElement("select");
    select.id = `cardSlot${index}`;
    select.dataset.slotIndex = String(index);
    row.appendChild(select);
    slotControls.appendChild(row);
  }
}

function setCardEditorFormState(state) {
  const normalized = normalizeCardState(state);
  document.getElementById("cardCharacterName").value = normalized.characterName;
  document.getElementById("cardAvatarUrl").value = normalized.cardPhotoUrl;
  document.getElementById("cardAutoShine").checked = normalized.autoShine;
  populateBadgeSelect(document.getElementById("cardFavoriteBadge"), normalized.favoriteBadge, true);

  normalized.displayBadges.forEach((badgeId, index) => {
    const select = document.getElementById(`cardSlot${index}`);
    if (select) populateBadgeSelect(select, badgeId, true);
  });

  updateOwnedBadgeStatus();
  updateCardEditorPreview();
}

function getCardEditorFormState() {
  const displayBadges = [];
  for (let index = 0; index < 8; index += 1) {
    const value = document.getElementById(`cardSlot${index}`)?.value;
    displayBadges.push(value ? parseInt(value, 10) : null);
  }

  return normalizeCardState({
    userId: discordId,
    characterName: document.getElementById("cardCharacterName").value.trim(),
    cardPhotoUrl: document.getElementById("cardAvatarUrl").value.trim(),
    autoShine: document.getElementById("cardAutoShine").checked,
    favoriteBadge: document.getElementById("cardFavoriteBadge").value || null,
    displayBadges,
  });
}

function updateOwnedBadgeStatus() {
  const badgeCount = document.getElementById("ownedBadgeCount");
  const status = document.getElementById("cardEditorStatus");
  const discordInput = document.getElementById("editorDiscordId");
  if (discordInput) discordInput.value = discordId;

  if (!discordId) {
    badgeCount.textContent = "No Discord ID";
    if (status) status.textContent = "Set a Discord ID to choose owned badges.";
    return;
  }

  badgeCount.textContent = `${ownedBadges.length} owned badges`;
  if (status && ownedBadges.length === 0) {
    status.textContent = "No completed badges found for this Discord ID.";
  }
}

async function loadCardFonts() {
  if (!document.fonts) return;
  if (!cardFontPromise) {
    cardFontPromise = Promise.all([
      document.fonts.load('22px "Jupiter Pro"'),
      document.fonts.load('22px "OpenSans"'),
      document.fonts.load('22px "Miedinger"'),
    ]).then(() => document.fonts.ready);
  }
  await cardFontPromise;
}

function loadCanvasImage(src) {
  const candidates = getImageLoadCandidates(src);
  if (candidates.length === 0) return Promise.resolve(null);
  const cacheKey = candidates.join("|");
  if (cardImageCache.has(cacheKey)) return cardImageCache.get(cacheKey);

  const promise = new Promise((resolve) => {
    const tryCandidate = (index) => {
      if (index >= candidates.length) {
        resolve(null);
        return;
      }

      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => tryCandidate(index + 1);
      image.src = candidates[index];
    };

    tryCandidate(0);
  });

  cardImageCache.set(cacheKey, promise);
  return promise;
}

function getStampIndex(userId) {
  const parsed = Number.parseInt(userId || "0", 10);
  if (!Number.isFinite(parsed)) return 1;
  return (parsed % 24) + 1;
}

function getCardClearStats(userId) {
  const starCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const userClears = userId ? clearsByJumper.get(userId.padStart(20, "0")) || new Set() : new Set();

  puzzleData.puzzles.forEach((puzzle) => {
    if (!userClears.has(puzzle.ID)) return;
    const rating = String(puzzle.Rating || "").trim();
    if (starCounts[rating] !== undefined) {
      starCounts[rating] += 1;
    }
  });

  const totalClears = Object.values(starCounts).reduce((sum, count) => sum + count, 0);
  const totalPuzzles = puzzleData.puzzles.filter((puzzle) => puzzle.Rating !== "" && puzzle.Status === "Active").length || 1;
  const globalPercentage = Math.min(100, (totalClears / totalPuzzles) * 100);

  return { starCounts, globalPercentage };
}

function getCardEffectSlots(inputState) {
  const state = normalizeCardState(inputState);
  const slots = [];
  const favoriteBadge = getBadgeById(state.favoriteBadge);
  if (favoriteBadge) {
    slots.push({
      key: "favorite",
      kind: "favorite",
      badge: favoriteBadge,
      imageUrl: getBadgeImageUrl(favoriteBadge),
      autoShine: state.autoShine,
      ...CARD_TEMPLATE.favoriteBadge,
    });
  }

  state.displayBadges.forEach((badgeId, index) => {
    const badge = getBadgeById(badgeId);
    if (!badge) return;
    slots.push({
      key: `slot-${index}`,
      kind: "display",
      badge,
      imageUrl: getBadgeImageUrl(badge),
      autoShine: state.autoShine,
      width: 78,
      height: 78,
      ...CARD_TEMPLATE.badgePositions[index],
    });
  });

  return slots;
}

function syncCardEffects(canvas, state) {
  const mount = canvas?.closest(".card-canvas-stage");
  if (!mount || !window.BadgePixiEffects?.syncCard) return;
  window.BadgePixiEffects.syncCard({
    mount,
    canvas,
    slots: getCardEffectSlots(state),
  });
}

async function renderPuzzleBotCard(canvas, inputState, options = {}) {
  const state = normalizeCardState(inputState);
  const drawBadges = options.drawBadges !== false;
  const ctx = canvas.getContext("2d");
  canvas.width = CARD_TEMPLATE.width;
  canvas.height = CARD_TEMPLATE.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  await loadCardFonts();

  const [template, blankImage, expBarFill] = await Promise.all([
    loadCanvasImage(`${CARD_ASSET_BASE}/Template.png`),
    loadCanvasImage(`${CARD_ASSET_BASE}/blank.png`),
    loadCanvasImage(`${CARD_ASSET_BASE}/ExpBarFill.png`),
  ]);

  if (template) {
    ctx.drawImage(template, 0, 0, canvas.width, canvas.height);
  }

  const stampImage = await loadCanvasImage(`${CARD_ASSET_BASE}/stamp${getStampIndex(state.userId)}.png`);
  if (stampImage) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.filter = "hue-rotate(-30deg)";
    ctx.globalAlpha = 0.75;
    ctx.drawImage(stampImage, 0, 5, 64, 64);
    ctx.drawImage(stampImage, canvas.width - 64, 5, 64, 64);
    ctx.restore();
  }

  const avatarAttempted = Boolean(state.cardPhotoUrl);
  const avatarImage = await loadCanvasImage(state.cardPhotoUrl);
  const avatar = avatarImage || blankImage;
  if (avatar) {
    const { x, y, width, height } = CARD_TEMPLATE.avatar;
    ctx.drawImage(avatar, x, y, width, height);
  }

  ctx.font = '22px "Jupiter Pro"';
  ctx.fillStyle = "rgb(118, 92, 73)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(state.characterName || "Adventurer", CARD_TEMPLATE.characterName.x, CARD_TEMPLATE.characterName.y);

  const favoriteBadge = getBadgeById(state.favoriteBadge);
  if (favoriteBadge) {
    if (drawBadges) {
      const favBadgeImage = (await loadCanvasImage(getBadgeImageUrl(favoriteBadge))) || blankImage;
      const { x, y, width, height } = CARD_TEMPLATE.favoriteBadge;
      if (favBadgeImage) ctx.drawImage(favBadgeImage, x, y, width, height);
    }

    ctx.font = '22px "OpenSans"';
    ctx.fillStyle = "rgb(118, 92, 73)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(`\u00ab${favoriteBadge.title}\u00bb`, CARD_TEMPLATE.favoriteTitle.x, CARD_TEMPLATE.favoriteTitle.y);

    ctx.font = '16px "OpenSans"';
    ctx.fillStyle = "rgb(106, 76, 58)";
    ctx.fillText(favoriteBadge.name, CARD_TEMPLATE.favoriteName.x, CARD_TEMPLATE.favoriteName.y);
  }

  for (let index = 0; index < CARD_TEMPLATE.badgePositions.length; index += 1) {
    const badge = getBadgeById(state.displayBadges[index]);
    if (!badge) continue;

    if (drawBadges) {
      const badgeImage = (await loadCanvasImage(getBadgeImageUrl(badge))) || blankImage;
      const position = CARD_TEMPLATE.badgePositions[index];
      if (badgeImage) ctx.drawImage(badgeImage, position.x, position.y, 78, 78);
    }

    const textPosition = CARD_TEMPLATE.badgeTextPositions[index];
    ctx.font = '14px "OpenSans"';
    ctx.fillStyle = "rgb(106, 76, 58)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(badge.name, textPosition.x, textPosition.y);
  }

  const { starCounts, globalPercentage } = getCardClearStats(state.userId);
  ctx.font = '22px "Miedinger"';
  ctx.fillStyle = "rgb(155, 129, 115)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  CARD_TEMPLATE.starText.forEach(({ rating, x, y }) => {
    ctx.fillText(starCounts[rating], x, y);
  });

  if (expBarFill) {
    const { x, y, width, height } = CARD_TEMPLATE.expBar;
    const progressWidth = (globalPercentage / 100) * width;
    if (progressWidth > 0) {
      ctx.drawImage(expBarFill, x, y, progressWidth, height);
    }
  }

  return {
    avatarAttempted,
    avatarLoaded: !avatarAttempted || Boolean(avatarImage),
  };
}

function encodeCardState(state) {
  const json = JSON.stringify(normalizeCardState(state));
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeCardState(value) {
  if (!value) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return normalizeCardState(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    console.error("Unable to decode card state:", error);
    return null;
  }
}

function getCardEmbedUrl(state) {
  const url = new URL("card-editor.html", window.location.href);
  url.searchParams.set("embed", "card");
  url.searchParams.set("card", encodeCardState(state));
  return url.toString();
}

function updateCardEmbedCode(state) {
  const field = document.getElementById("cardEmbedCode");
  if (!field) return;
  const embedUrl = getCardEmbedUrl(state);
  field.value = `<iframe src="${embedUrl}" width="953" height="624" style="width:100%;max-width:953px;aspect-ratio:953/624;border:0;" loading="lazy"></iframe>`;
}

async function updateCardEditorPreview() {
  const canvas = document.getElementById("cardPreviewCanvas");
  const status = document.getElementById("cardEditorStatus");
  if (!canvas) return;

  const token = ++cardPreviewRenderToken;
  const state = getCardEditorFormState();
  saveCardPreferences(state);
  updateCardEmbedCode(state);
  if (status) status.textContent = "Rendering...";

  try {
    const renderResult = await renderPuzzleBotCard(canvas, state, { drawBadges: false });
    syncCardEffects(canvas, state);
    if (token === cardPreviewRenderToken && status) {
      if (ownedBadges.length === 0) {
        status.textContent = "Set a Discord ID with completed badges to fill the card.";
      } else if (renderResult.avatarAttempted && !renderResult.avatarLoaded) {
        status.textContent = "Ready. Avatar URL did not load; try a direct image link.";
      } else {
        status.textContent = "Ready";
      }
    }
  } catch (error) {
    console.error("Error rendering card preview:", error);
    if (token === cardPreviewRenderToken && status) {
      status.textContent = "Preview failed to render.";
    }
  }
}

async function copyCardEmbedCode() {
  const state = getCardEditorFormState();
  updateCardEmbedCode(state);
  const field = document.getElementById("cardEmbedCode");
  const status = document.getElementById("cardEditorStatus");
  await navigator.clipboard.writeText(field.value);
  if (status) status.textContent = "Embed copied.";
}

async function downloadCardPreview() {
  const canvas = document.createElement("canvas");
  const status = document.getElementById("cardEditorStatus");
  await renderPuzzleBotCard(canvas, getCardEditorFormState());

  try {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Canvas export failed");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "puzzlebot-card.png";
    link.click();
    URL.revokeObjectURL(link.href);
    if (status) status.textContent = "PNG downloaded.";
  } catch (error) {
    console.error("Unable to export card image:", error);
    if (status) status.textContent = "PNG export failed.";
  }
}

function refreshForDiscordId(nextDiscordId) {
  discordId = String(nextDiscordId || "").trim();
  try {
    if (discordId) {
      window.localStorage?.setItem("discordId", discordId);
    } else {
      window.localStorage?.removeItem("discordId");
    }
  } catch (_) {
    // Storage may be unavailable in some embedded contexts; the current page state still updates.
  }
  updateOwnedBadges();
  setCardEditorFormState(getDefaultCardState());
}

function setupEditorEvents() {
  buildSlotControls();
  document.getElementById("editorDiscordId").value = discordId;

  const renderSoon = debounce(() => updateCardEditorPreview(), 120);
  document.getElementById("cardEditorForm").addEventListener("input", renderSoon);
  document.getElementById("cardEditorForm").addEventListener("change", renderSoon);

  const avatarInput = document.getElementById("cardAvatarUrl");
  avatarInput.addEventListener("blur", (event) => normalizeAvatarInputValue(event.currentTarget));
  avatarInput.addEventListener("change", (event) => normalizeAvatarInputValue(event.currentTarget));
  avatarInput.addEventListener("paste", (event) => {
    setTimeout(() => normalizeAvatarInputValue(event.currentTarget), 0);
  });

  document.getElementById("saveEditorDiscordId").addEventListener("click", () => {
    refreshForDiscordId(document.getElementById("editorDiscordId").value);
  });

  document.getElementById("editorDiscordId").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      refreshForDiscordId(event.currentTarget.value);
    }
  });

  document.getElementById("downloadCard").addEventListener("click", downloadCardPreview);
  document.getElementById("copyCardEmbed").addEventListener("click", copyCardEmbedCode);
  document.getElementById("openCardEmbed").addEventListener("click", () => {
    window.open(getCardEmbedUrl(getCardEditorFormState()), "_blank", "noopener");
  });
}

async function loadData() {
  const [badgesResponse, badgePuzzlesResponse, puzzlesResponse, clearsResponse, cardSettingsResponse] = await Promise.all([
    fetch("sh-dump/badges.json"),
    fetch("sh-dump/badgePuzzles.json"),
    fetch("sh-dump/puzzles.json"),
    fetch("sh-dump/clears.json"),
    fetch("sh-dump/cardSettings.json"),
  ]);

  originalBadges = await badgesResponse.json();
  puzzleData.badgePuzzles = await badgePuzzlesResponse.json();
  puzzleData.puzzles = await puzzlesResponse.json();
  puzzleData.clears = await clearsResponse.json();
  cardSettings = await cardSettingsResponse.json();
  indexData();
  updateOwnedBadges();
}

async function renderEmbedCardFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("embed") !== "card") return false;

  document.body.classList.add("embed-mode");
  const view = document.getElementById("cardEmbedView");
  const canvas = document.getElementById("embedCardCanvas");
  if (!view || !canvas) return true;

  view.hidden = false;
  const state = decodeCardState(params.get("card")) || getDefaultCardState();
  await renderPuzzleBotCard(canvas, state, { drawBadges: false });
  syncCardEffects(canvas, state);
  return true;
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadData();
    if (await renderEmbedCardFromUrl()) return;
    setupEditorEvents();
    setCardEditorFormState(getDefaultCardState());
  } catch (error) {
    console.error("Error loading card editor:", error);
    document.body.innerHTML = '<div class="error">Error loading card editor data. Please check if the JSON files are accessible.</div>';
  }
});
