// Import libraries and styles
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";

// Constants and variables
const TILE_DEGREES = 1e-4; // Tile size increment
const NEIGHBORHOOD_SIZE = 8; // Size of area for cache generation
const CACHE_SPAWN_PROBABILITY = 0.1; // Chance of spawning a cache
const PLAYER_START = leaflet.latLng(36.9895, -122.0628); // Player's starting location
let playerPoints = 0; // Player's score
let playerInventory = 0; // Player's coin count

// Initialize map
const map = leaflet.map("map", {
  center: PLAYER_START,
  zoom: 19,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Add OpenStreetMap tiles
leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    'Map data &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
}).addTo(map);

// Add player marker
const playerMarker = leaflet.marker(PLAYER_START).addTo(map);

// Status and Inventory updates
const statusPanel = document.querySelector("#statusPanel")!;
const inventoryPanel = document.querySelector("#inventory")!;

// Function to update status display
function updateStatus() {
  statusPanel.innerHTML = `Points: ${playerPoints}`;
  inventoryPanel.innerHTML = `Inventory: ${playerInventory} coins`;
}

// Generate caches randomly around the player
function spawnCache(i: number, j: number) {
  const origin = PLAYER_START;
  const bounds = leaflet.latLngBounds([
    [origin.lat + i * TILE_DEGREES, origin.lng + j * TILE_DEGREES],
    [origin.lat + (i + 1) * TILE_DEGREES, origin.lng + (j + 1) * TILE_DEGREES],
  ]);

  const rect = leaflet.rectangle(bounds).addTo(map);
  let cacheCoins = Math.floor(Math.random() * 5) + 1; // Random coin count (1-5)

  // Popup for cache details
  rect.bindPopup(() => {
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
      <div>Cache at (${i},${j})</div>
      <div>Coins available: <span id="coinCount">${cacheCoins}</span></div>
      <button id="collectCoins">Collect</button>
      <button id="depositCoins">Deposit</button>
    `;

    // Collect coins
    popupDiv.querySelector("#collectCoins")!.addEventListener("click", () => {
      if (cacheCoins > 0) {
        playerInventory += cacheCoins;
        cacheCoins = 0;
        updateStatus();
        popupDiv.querySelector("#coinCount")!.textContent = "0";
      }
    });

    // Deposit coins
    popupDiv.querySelector("#depositCoins")!.addEventListener("click", () => {
      if (playerInventory > 0) {
        cacheCoins += playerInventory;
        playerPoints += playerInventory;
        playerInventory = 0;
        updateStatus();
        popupDiv.querySelector("#coinCount")!.textContent = `${cacheCoins}`;
      }
    });

    return popupDiv; // Return the popup content
  });
}

// Generate caches in the neighborhood
for (let i = -NEIGHBORHOOD_SIZE; i <= NEIGHBORHOOD_SIZE; i++) {
  for (let j = -NEIGHBORHOOD_SIZE; j <= NEIGHBORHOOD_SIZE; j++) {
    if (Math.random() < CACHE_SPAWN_PROBABILITY) {
      spawnCache(i, j); // Spawn a cache at (i, j) if condition met
    }
  }
}

// Event listener for resetting the game
document.querySelector("#resetGame")!.addEventListener("click", () => {
  playerPoints = 0; // Reset player points
  playerInventory = 0; // Reset inventory
  updateStatus(); // Update the display
});
