let badges = [];
let originalBadges = [];
let puzzleData = {
  puzzles: [],
  badgePuzzles: [],
  clears: [],
};
let selectedBadge = null;
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
let discordId = localStorage.getItem("discordId");
let clears = [];
let isExportMode = false;
let selectedForExport = new Set();
let badgeMetricsCache = new Map();
let badgeRatingsCache = new Map();
let currentSort = "id";
let isCalculating = false;
const CHUNK_SIZE = 50; // Number of badges to process per chunk
let dataLoaded = false;
let metricsCalculated = {
  rarity: false,
  difficulty: false,
};
let completionCache = new Map();
let clearsByJumper = new Map(); // Index clears by jumper
let clearsByPuzzle = new Map(); // Index clears by puzzle
let badgePuzzleRequirements = new Map(); // Cache puzzle requirements for badges

function getImageUrl(url) {
  if (!url) return "placeholder.png";
  // Get the extension from the original URL
  const extension = url.split(".").pop();
  // Use the badge ID from the current badge object
  return `sh-dump/badges/${selectedBadge.id}.${extension}`;
}

function sortById(a, b) {
  return parseInt(a.id) - parseInt(b.id);
}

async function loadData() {
  try {
    const [badgesResponse, badgePuzzlesResponse, puzzlesResponse, clearsResponse] = await Promise.all([fetch("sh-dump/badges.json"), fetch("sh-dump/badgePuzzles.json"), fetch("sh-dump/puzzles.json"), fetch("sh-dump/clears.json")]);

    originalBadges = await badgesResponse.json();
    puzzleData.badgePuzzles = await badgePuzzlesResponse.json();
    puzzleData.puzzles = await puzzlesResponse.json();
    puzzleData.clears = await clearsResponse.json();

    // Mark data as loaded
    dataLoaded = true;

    // Hide badge details initially
    document.getElementById("badgeDetails").style.display = "none";

    // Set initial sort by ID and show badges immediately
    badges = [...originalBadges].sort(sortById);
    await renderBadgeGrid();

    setupSearch();

    // Index the data after loading
    indexClearsData();
  } catch (error) {
    console.error("Error loading data:", error);
    document.body.innerHTML = '<div class="error">Error loading data. Please check if the JSON files are accessible.</div>';
  }
}

function calculateGridDimensions() {
  const container = document.querySelector(".badge-grid-container");
  const containerHeight = container.clientHeight - 32; // Subtract padding
  const containerWidth = container.clientWidth - 32;

  // Calculate optimal badge size based on container height
  // We want 4 rows, so divide height by 4 and account for gaps
  const optimalBadgeSize = Math.floor((containerHeight - 3 * 16) / 4); // 16px gap

  // Calculate how many columns can fit in the visible width
  const columnsPerPage = Math.floor((containerWidth + 16) / (optimalBadgeSize + 16));

  return {
    badgeSize: optimalBadgeSize,
    rows: 4,
    columnsPerPage,
  };
}

async function renderBadgeGrid() {
  const badgeGrid = document.getElementById("badgeGrid");
  badgeGrid.innerHTML = "";

  // Calculate grid dimensions
  const { badgeSize, rows, columnsPerPage } = calculateGridDimensions();

  // Set grid template and badge sizes
  badgeGrid.style.gridTemplateRows = `repeat(${rows}, ${badgeSize}px)`;

  // Create badge cards
  badges.forEach((badge) => {
    const card = document.createElement("div");
    card.className = "badge-card";
    const completion = getBadgeCompletion(badge);

    if (completion.completed) {
      card.classList.add("obtained");
    } else if (completion.percentage > 0) {
      card.classList.add("partial");
      card.setAttribute("data-progress", `${completion.percentage}%`);
    }

    card.style.width = `${badgeSize}px`;
    if (selectedBadge && selectedBadge.id === badge.id) {
      card.classList.add("selected");
    }
    card.innerHTML = `
      <img src="sh-dump/badges/${badge.id}.${badge.imageUrl.split(".").pop()}" alt="${badge.name}">
      <h3>${badge.name}</h3>
    `;
    card.addEventListener("click", () => {
      if (!dataLoaded) return; // Prevent clicks until data is loaded

      if (isExportMode) {
        if (hasUserCompletedBadge(badge)) {
          if (selectedForExport.has(badge.id)) {
            selectedForExport.delete(badge.id);
            card.classList.remove("export-selected");
          } else if (selectedForExport.size < 8) {
            selectedForExport.add(badge.id);
            card.classList.add("export-selected");
          }
          toggleBadge(badge);
        }
      } else {
        toggleBadge(badge);
      }
    });
    badgeGrid.appendChild(card);
  });

  // Add horizontal scroll behavior for mouse wheel
  badgeGrid.addEventListener(
    "wheel",
    (e) => {
      if (e.deltaY !== 0 && e.target.closest(".badge-grid")) {
        e.preventDefault();
        const pageWidth = columnsPerPage * (badgeSize + 16); // Include gap
        const direction = e.deltaY > 0 ? 1 : -1;
        badgeGrid.scrollLeft += pageWidth * direction;
      }
    },
    { passive: false }
  );

  // Handle window resize
  window.addEventListener(
    "resize",
    debounce(() => {
      const { badgeSize, rows } = calculateGridDimensions();
      badgeGrid.style.gridTemplateRows = `repeat(${rows}, ${badgeSize}px)`;
      document.querySelectorAll(".badge-card").forEach((card) => {
        card.style.width = `${badgeSize}px`;
      });
    }, 250)
  );
}

// Utility function to debounce resize events
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function toggleBadge(badge) {
  if (selectedBadge && selectedBadge.id === badge.id && !isExportMode) {
    // Only deselect if not in export mode
    selectedBadge = null;
    document.getElementById("badgeDetails").style.display = "none";
    document.querySelectorAll(".badge-card").forEach((card) => {
      if (card.querySelector("h3").textContent === badge.name) {
        card.classList.remove("selected");
      }
    });
  } else {
    // Always select and show details
    selectBadge(badge);
  }
}

function selectBadge(badge) {
  if (!dataLoaded) return;

  selectedBadge = badge;

  // Show badge details
  const badgeDetails = document.getElementById("badgeDetails");
  badgeDetails.style.display = "block";

  // Update badge details
  document.getElementById("selectedBadgeName").textContent = badge.name;
  const badgeImage = document.getElementById("selectedBadgeImage");
  badgeImage.style.backgroundImage = `url(${getImageUrl(badge.imageUrl)})`;

  // Clear existing metrics if any
  const existingMetrics = document.querySelector(".badge-metrics");
  if (existingMetrics) {
    existingMetrics.remove();
  }

  // Display badge info
  const requirementsList = document.getElementById("requirementsList");
  requirementsList.innerHTML = `
    <div class="badge-info-item">
      <strong>ID:</strong> ${badge.id}
      <strong>Title:</strong> ${badge.title}
    </div>
    <div class="badge-info-item">
      <strong>Description:</strong> ${badge.description}
    </div>
  `;

  // Display required puzzles
  const puzzlesList = document.getElementById("puzzlesList");
  const fragment = document.createDocumentFragment();

  const requirements = badgePuzzleRequirements.get(badge.id);

  if (requirements && requirements.length > 0) {
    const userClears = discordId ? clearsByJumper.get(discordId.padStart(20, "0")) || new Set() : new Set();
    console.log("User clears:", Array.from(userClears));

    requirements.forEach(({ puzzleId, puzzle }) => {
      const puzzleElement = document.createElement("div");
      puzzleElement.className = "puzzle-item";

      console.log("Checking puzzle:", puzzleId, "Type:", typeof puzzleId);
      console.log("Has clear:", userClears.has(puzzleId));

      if (discordId && userClears.has(puzzleId)) {
        puzzleElement.classList.add("cleared");
      }

      puzzleElement.innerHTML = `
        <div class="puzzle-main">
          <span class="puzzle-name">${puzzle.PuzzleName}</span>
          <span class="puzzle-id">#${puzzle.ID}</span>
        </div>
        <div class="puzzle-details">
          by ${puzzle.Builder} ${getDifficultyString(puzzle)} ${getRatingString(puzzle)}
          <div class="puzzle-address">
            <span>${puzzle.World} ${puzzle.Address}</span>
            <button class="copy-address" title="Copy teleport command" onclick="navigator.clipboard.writeText('${generateLifestreamCommand(puzzle.World, puzzle.Address)}')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
          ${puzzle.GoalsRules ? `<div class="puzzle-rules">${puzzle.GoalsRules}</div>` : ""}
        </div>
      `;
      fragment.appendChild(puzzleElement);
    });
  } else {
    const noPuzzles = document.createElement("div");
    noPuzzles.className = "no-puzzles";
    noPuzzles.textContent = "No puzzles required";
    fragment.appendChild(noPuzzles);
  }

  puzzlesList.innerHTML = "";
  puzzlesList.appendChild(fragment);

  // Update selected state in grid
  document.querySelectorAll(".badge-card").forEach((card) => {
    card.classList.remove("selected");
    if (card.querySelector("h3").textContent === badge.name) {
      card.classList.add("selected");
    }
  });

  // Add metrics before puzzles section
  const metrics = getBadgeMetrics(badge);
  const puzzles = document.querySelector(".puzzles");
  const metricsDiv = document.createElement("div");
  metricsDiv.className = "badge-metrics";
  metricsDiv.innerHTML = `
    <div class="metric-item">
      <span class="metric-value">${metrics.ownedBy}</span>
      <span class="metric-label">jumpers own this badge</span>
    </div>
  `;
  puzzles.insertBefore(metricsDiv, puzzles.firstChild);
}

function setupSearch() {
  const searchInput = document.getElementById("searchInput");
  searchInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase().trim();

    if (searchTerm === "") {
      badges = [...originalBadges];
      renderBadgeGrid();
      return;
    }

    // Create a map of badge IDs to their required puzzles
    const badgePuzzleMap = new Map();
    puzzleData.badgePuzzles.forEach((bp) => {
      const puzzle = puzzleData.puzzles.find((p) => p.ID === bp.puzzleId);
      if (puzzle) {
        if (!badgePuzzleMap.has(bp.badgeId)) {
          badgePuzzleMap.set(bp.badgeId, []);
        }
        badgePuzzleMap.get(bp.badgeId).push(puzzle.PuzzleName.toLowerCase());
      }
    });

    // Filter and sort badges based on search term
    badges = originalBadges
      .filter((badge) => {
        // Check badge name
        const nameMatch = badge.name.toLowerCase().includes(searchTerm);

        // Check puzzle names
        const puzzleNames = badgePuzzleMap.get(badge.id) || [];
        const puzzleMatch = puzzleNames.some((name) => name.includes(searchTerm));

        return nameMatch || puzzleMatch;
      })
      .sort((a, b) => {
        const aNameMatch = a.name.toLowerCase().includes(searchTerm);
        const bNameMatch = b.name.toLowerCase().includes(searchTerm);

        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;
        return 0;
      });

    renderBadgeGrid();
  });
}

function setupDiscordModal() {
  const modal = document.getElementById("discordModal");
  const button = document.getElementById("setDiscordId");
  const saveBtn = document.getElementById("saveDiscordId");
  const cancelBtn = document.getElementById("cancelDiscordId");
  const input = document.getElementById("discordIdInput");

  button.addEventListener("click", () => {
    modal.style.display = "flex";
    input.value = discordId || "";
  });

  saveBtn.addEventListener("click", () => {
    discordId = input.value.trim();
    localStorage.setItem("discordId", discordId);
    modal.style.display = "none";
    document.getElementById("exportMode").style.display = discordId ? "block" : "none";

    // Clear caches
    completionCache.clear();

    // Re-sort with current sorting method
    sortBadges(currentSort);

    if (selectedBadge) {
      selectBadge(selectedBadge);
    }
  });

  cancelBtn.addEventListener("click", () => {
    modal.style.display = "none";
  });

  window.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });
}

function setupExportMode() {
  const exportButton = document.getElementById("exportMode");
  const exportControls = document.getElementById("exportControls");
  const confirmExport = document.getElementById("confirmExport");
  const cancelExport = document.getElementById("cancelExport");
  const exportModal = document.getElementById("exportModal");
  const closeExport = document.getElementById("closeExport");
  const copyButton = document.getElementById("copyBadges");
  const badgeGrid = document.getElementById("badgeGrid");

  // Show export button if Discord ID is set
  exportButton.style.display = discordId ? "block" : "none";

  exportButton.addEventListener("click", () => {
    isExportMode = !isExportMode;
    exportButton.classList.toggle("selected");
    exportControls.style.display = isExportMode ? "flex" : "none";

    // Filter badges when entering export mode
    if (isExportMode) {
      badges = originalBadges.filter((badge) => hasUserCompletedBadge(badge));
    } else {
      badges = [...originalBadges];
    }

    selectedForExport.clear();
    renderBadgeGrid();
  });

  confirmExport.addEventListener("click", () => {
    if (selectedForExport.size > 0) {
      const badgeIds = Array.from(selectedForExport).join(", ");
      document.getElementById("exportedBadges").textContent = badgeIds;
      navigator.clipboard.writeText(badgeIds);
      exportModal.style.display = "flex";
    }
  });

  cancelExport.addEventListener("click", () => {
    isExportMode = false;
    exportButton.classList.remove("selected");
    exportControls.style.display = "none";

    // Reset badges while maintaining current sort
    badges = [...originalBadges];
    sortBadges(currentSort);

    selectedForExport.clear();
  });

  closeExport.addEventListener("click", () => {
    exportModal.style.display = "none";
  });

  copyButton.addEventListener("click", () => {
    navigator.clipboard.writeText(document.getElementById("exportedBadges").textContent);
  });
}

// Add sorting functions
async function sortBadges(sortType) {
  currentSort = sortType;

  // Show loading overlay if metrics need to be calculated
  let loadingOverlay;
  if ((sortType === "rarity" && !metricsCalculated.rarity) || (sortType === "difficulty" && !metricsCalculated.difficulty)) {
    loadingOverlay = showLoadingOverlay(`Calculating ${sortType} metrics...`);
  }

  try {
    switch (sortType) {
      case "id":
        badges.sort(sortById);
        break;

      case "alphabetical":
        badges.sort((a, b) => a.name.localeCompare(b.name));
        break;

      case "rarity":
        if (!metricsCalculated.rarity) {
          await calculateRarityMetrics();
          metricsCalculated.rarity = true;
        }
        badges.sort((a, b) => {
          const aMetrics = badgeMetricsCache.get(a.id);
          const bMetrics = badgeMetricsCache.get(b.id);
          return aMetrics.ownedBy - bMetrics.ownedBy;
        });
        break;

      case "completion":
        if (discordId) {
          if (completionCache.size === 0) {
            await calculateCompletionMetrics();
          }
          badges.sort((a, b) => {
            const aCompletion = completionCache.get(a.id);
            const bCompletion = completionCache.get(b.id);
            if (aCompletion.completed !== bCompletion.completed) {
              return bCompletion.completed ? 1 : -1;
            }
            return bCompletion.percentage - aCompletion.percentage;
          });
        }
        break;

      case "difficulty":
        if (!metricsCalculated.difficulty) {
          await calculateDifficultyMetrics();
          metricsCalculated.difficulty = true;
        }
        badges.sort((a, b) => {
          const aRating = badgeRatingsCache.get(a.id);
          const bRating = badgeRatingsCache.get(b.id);
          return bRating - aRating;
        });
        break;
    }

    renderBadgeGrid();
  } finally {
    if (loadingOverlay) {
      loadingOverlay.remove();
    }
  }
}

// Split metric calculations into separate functions
async function calculateRarityMetrics() {
  const chunkSize = 50;
  for (let i = 0; i < originalBadges.length; i += chunkSize) {
    const chunk = originalBadges.slice(i, i + chunkSize);
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        chunk.forEach((badge) => {
          badgeMetricsCache.set(badge.id, getBadgeMetrics(badge));
        });
        resolve();
      });
    });
  }
}

async function calculateDifficultyMetrics() {
  const chunkSize = 50;
  for (let i = 0; i < originalBadges.length; i += chunkSize) {
    const chunk = originalBadges.slice(i, i + chunkSize);
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        chunk.forEach((badge) => {
          badgeRatingsCache.set(badge.id, getAverageRating(badge));
        });
        resolve();
      });
    });
  }
}

function showLoadingOverlay(message) {
  const overlay = document.createElement("div");
  overlay.className = "loading-overlay";
  overlay.innerHTML = `
    <div class="loading-content">
      <div class="loading-spinner"></div>
      <div class="loading-message">${message}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function getAverageRating(badge) {
  const puzzleIds = puzzleData.badgePuzzles.filter((bp) => bp.badgeId === badge.id).map((bp) => bp.puzzleId);

  const ratings = puzzleIds
    .map((id) => puzzleData.puzzles.find((p) => p.ID === id))
    .filter((p) => p && p.Rating !== "-")
    .map((p) => parseFloat(p.Rating));

  if (ratings.length === 0) return 0;

  // Find highest difficulty
  const highestRating = Math.max(...ratings);

  // Calculate cumulative total
  const cumulativeTotal = ratings.reduce((sum, rating) => sum + rating, 0);

  // Return highest + (cumulative/1000)
  return highestRating + cumulativeTotal / 1000;
}

// Add to setupSearch or create new setup function
function setupSorting() {
  const sortSelect = document.getElementById("sortSelect");
  sortSelect.value = currentSort;
  sortSelect.addEventListener("change", (e) => {
    sortBadges(e.target.value);
  });
}

// Initialize the application
document.addEventListener("DOMContentLoaded", () => {
  loadData();
  setupDiscordModal();
  setupExportMode();
  setupSorting();
});

function getBadgeCompletion(badge) {
  if (!discordId) return { completed: false, percentage: 0 };

  // Check cache first
  if (completionCache.has(badge.id)) {
    return completionCache.get(badge.id);
  }

  // Calculate if not cached
  const requiredPuzzles = puzzleData.badgePuzzles.filter((bp) => bp.badgeId === badge.id).map((bp) => bp.puzzleId);
  if (requiredPuzzles.length === 0) return { completed: false, percentage: 0 };

  const completedCount = requiredPuzzles.filter((puzzleId) => puzzleData.clears.some((clear) => clear.jumper.padStart(20, "0") === discordId.padStart(20, "0") && clear.puzzleId === puzzleId)).length;

  const result = {
    completed: completedCount === requiredPuzzles.length,
    percentage: Math.round((completedCount / requiredPuzzles.length) * 100),
  };

  // Cache the result
  completionCache.set(badge.id, result);
  return result;
}

// Update the existing hasUserCompletedBadge to use the new function
function hasUserCompletedBadge(badge) {
  return getBadgeCompletion(badge).completed;
}

// Add this helper function
function getBadgeMetrics(badge) {
  const requirements = badgePuzzleRequirements.get(badge.id) || [];
  if (requirements.length === 0) return { ownedBy: 0 };

  const puzzleIds = requirements.map((r) => r.puzzleId);
  const jumperCounts = new Set();

  // Get jumpers who cleared the first puzzle
  const firstPuzzleClears = clearsByPuzzle.get(puzzleIds[0]) || new Set();

  // Check each jumper against other required puzzles
  firstPuzzleClears.forEach((jumper) => {
    const jumpersClears = clearsByJumper.get(jumper) || new Set();
    if (puzzleIds.every((pid) => jumpersClears.has(pid))) {
      jumperCounts.add(jumper);
    }
  });

  return { ownedBy: jumperCounts.size };
}

// Modify precalculateMetrics to use chunking
async function precalculateMetrics() {
  if (isCalculating) return;
  isCalculating = true;

  console.time("precalculate");
  badgeMetricsCache.clear();
  badgeRatingsCache.clear();

  const totalBadges = originalBadges.length;
  let processed = 0;

  // Create a loading indicator
  const header = document.querySelector("header");
  const loadingBar = document.createElement("div");
  loadingBar.className = "loading-bar";
  loadingBar.innerHTML = `
    <div class="loading-progress">
      <div class="progress-bar"></div>
    </div>
    <div class="loading-text">Calculating badge metrics...</div>
  `;
  header.appendChild(loadingBar);
  const progressBar = loadingBar.querySelector(".progress-bar");

  function processChunk() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        const chunk = originalBadges.slice(processed, processed + CHUNK_SIZE);

        chunk.forEach((badge) => {
          badgeMetricsCache.set(badge.id, getBadgeMetrics(badge));
          badgeRatingsCache.set(badge.id, getAverageRating(badge));
        });

        processed += chunk.length;
        const progress = (processed / totalBadges) * 100;
        progressBar.style.width = `${progress}%`;

        resolve();
      });
    });
  }

  // Process chunks with delays to prevent freezing
  while (processed < totalBadges) {
    await processChunk();
    // Small delay between chunks
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  console.timeEnd("precalculate");
  loadingBar.remove();
  isCalculating = false;

  // Re-sort with current sorting method if not alphabetical
  if (currentSort !== "alphabetical") {
    sortBadges(currentSort);
  }
}

// Add this function to calculate completion for all badges at once
async function calculateCompletionMetrics() {
  const loadingOverlay = showLoadingOverlay("Calculating completion metrics...");

  try {
    // Process in chunks to prevent UI freeze
    const chunkSize = 50;
    for (let i = 0; i < originalBadges.length; i += chunkSize) {
      const chunk = originalBadges.slice(i, i + chunkSize);
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          chunk.forEach((badge) => {
            if (!completionCache.has(badge.id)) {
              completionCache.set(badge.id, getBadgeCompletion(badge));
            }
          });
          resolve();
        });
      });
    }
  } finally {
    loadingOverlay.remove();
  }
}

// Add this function to index the clears data for faster lookups
function indexClearsData() {
  // Index by jumper - pad the jumper ID when indexing
  puzzleData.clears.forEach((clear) => {
    const paddedJumper = clear.jumper.padStart(20, "0");
    if (!clearsByJumper.has(paddedJumper)) {
      clearsByJumper.set(paddedJumper, new Set());
    }
    clearsByJumper.get(paddedJumper).add(clear.puzzleId);
  });

  // Index by puzzle
  puzzleData.clears.forEach((clear) => {
    if (!clearsByPuzzle.has(clear.puzzleId)) {
      clearsByPuzzle.set(clear.puzzleId, new Set());
    }
    clearsByPuzzle.get(clear.puzzleId).add(clear.jumper.padStart(20, "0"));
  });

  // Cache puzzle requirements for each badge
  originalBadges.forEach((badge) => {
    const requirements = puzzleData.badgePuzzles
      .filter((bp) => bp.badgeId === badge.id)
      .map((bp) => ({
        puzzleId: bp.puzzleId,
        puzzle: puzzleData.puzzles.find((p) => p.ID === bp.puzzleId),
      }))
      .filter((req) => req.puzzle); // Filter out any missing puzzles

    badgePuzzleRequirements.set(badge.id, requirements);
  });
}

function getDifficultyString(puzzle) {
  const difficultyAttrs = [];
  if (puzzle.M) difficultyAttrs.push("M");
  if (puzzle.E) difficultyAttrs.push("E");
  if (puzzle.S) difficultyAttrs.push("S");
  if (puzzle.P) difficultyAttrs.push("P");
  if (puzzle.V) difficultyAttrs.push("V");
  if (puzzle.J) difficultyAttrs.push("J");
  if (puzzle.G) difficultyAttrs.push("G");
  if (puzzle.L) difficultyAttrs.push("L");
  if (puzzle.X) difficultyAttrs.push("X");
  return difficultyAttrs.length > 0 ? `[${difficultyAttrs.join("")}]` : "";
}

function getRatingString(puzzle) {
  return puzzle.Rating !== "-" ? `Rating: ${puzzle.Rating}` : "";
}

// Add this utility function to generate the lifestream command
function generateLifestreamCommand(world, address) {
  // Initialize command parts
  let command = `/li ${world}`;

  // Extract location (Mist/Goblet/Lavender Beds)
  const location = address.split("Ward")[0].trim();
  command += ` ${location}`;

  // Extract ward number
  const wardMatch = address.match(/Ward (\d+)/);
  if (wardMatch) {
    command += ` w${wardMatch[1]}`;
  }

  // Check for Wing/Subdivision
  const wingMatch = address.match(/Wing (\d+)/);
  if (wingMatch) {
    command += ` s`; // Add subdivision indicator for apartments
  }

  // Extract plot or apartment number
  const plotMatch = address.match(/Plot (\d+)/);
  const apartmentMatch = address.match(/Apartment (\d+)/);

  if (plotMatch) {
    command += ` p${plotMatch[1]}`;
  } else if (apartmentMatch) {
    command += ` a${apartmentMatch[1]}`;
  }

  return command;
}
