let badges = [];
let originalBadges = [];
let badgePuzzles = [];
let puzzles = [];
let selectedBadge = null;
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

function getImageUrl(url) {
  if (!url) return "placeholder.png";
  // Get the extension from the original URL
  const extension = url.split(".").pop();
  // Use the badge ID from the current badge object
  return `sh-dump/badges/${selectedBadge.id}.${extension}`;
}

async function loadData() {
  try {
    const [badgesResponse, badgePuzzlesResponse, puzzlesResponse] = await Promise.all([fetch("sh-dump/badges.json"), fetch("sh-dump/badgePuzzles.json"), fetch("sh-dump/puzzles.json")]);

    originalBadges = await badgesResponse.json();
    badges = [...originalBadges];
    badgePuzzles = await badgePuzzlesResponse.json();
    puzzles = await puzzlesResponse.json();

    // Hide badge details initially
    document.getElementById("badgeDetails").style.display = "none";

    await renderBadgeGrid();
    setupSearch();
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
    card.style.width = `${badgeSize}px`;
    if (selectedBadge && selectedBadge.id === badge.id) {
      card.classList.add("selected");
    }
    card.innerHTML = `
      <img src="sh-dump/badges/${badge.id}.${badge.imageUrl.split(".").pop()}" alt="${badge.name}">
      <h3>${badge.name}</h3>
    `;
    card.addEventListener("click", () => toggleBadge(badge));
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
  if (selectedBadge && selectedBadge.id === badge.id) {
    // Deselect the badge
    selectedBadge = null;
    document.getElementById("badgeDetails").style.display = "none";
    document.querySelectorAll(".badge-card").forEach((card) => {
      if (card.querySelector("h3").textContent === badge.name) {
        card.classList.remove("selected");
      }
    });
  } else {
    // Select the badge
    selectBadge(badge);
  }
}

function selectBadge(badge) {
  selectedBadge = badge;

  // Show badge details
  const badgeDetails = document.getElementById("badgeDetails");
  badgeDetails.style.display = "block";

  // Update badge details
  document.getElementById("selectedBadgeName").textContent = badge.name;
  const badgeImage = document.getElementById("selectedBadgeImage");
  badgeImage.style.backgroundImage = `url(${getImageUrl(badge.imageUrl)})`;

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
  puzzlesList.innerHTML = "";

  // Get all puzzles required for this badge
  const badgePuzzleEntries = badgePuzzles.filter((bp) => bp.badgeId === badge.id);

  if (badgePuzzleEntries && badgePuzzleEntries.length > 0) {
    badgePuzzleEntries.forEach((entry) => {
      const puzzle = puzzles.find((p) => p.ID === entry.puzzleId);
      if (puzzle) {
        const puzzleElement = document.createElement("div");
        puzzleElement.className = "puzzle-item";

        // Create difficulty string from puzzle attributes
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

        const difficulty = difficultyAttrs.length > 0 ? `[${difficultyAttrs.join("")}]` : "";
        const rating = puzzle.Rating !== "-" ? `Rating: ${puzzle.Rating}` : "";

        puzzleElement.innerHTML = `
          <div class="puzzle-main">
            <span class="puzzle-name">${puzzle.PuzzleName}</span>
            <span class="puzzle-id">#${puzzle.ID}</span>
          </div>
          <div class="puzzle-details">
            by ${puzzle.Builder} ${difficulty} ${rating}
            ${puzzle.GoalsRules ? `<div class="puzzle-rules">${puzzle.GoalsRules}</div>` : ""}
          </div>
        `;
        puzzlesList.appendChild(puzzleElement);
      }
    });
  } else {
    puzzlesList.innerHTML = "<div class='no-puzzles'>No puzzles required</div>";
  }

  // Update selected state in grid
  document.querySelectorAll(".badge-card").forEach((card) => {
    card.classList.remove("selected");
    if (card.querySelector("h3").textContent === badge.name) {
      card.classList.add("selected");
    }
  });
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
    badgePuzzles.forEach((bp) => {
      const puzzle = puzzles.find((p) => p.ID === bp.puzzleId);
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

// Initialize the application
document.addEventListener("DOMContentLoaded", loadData);
