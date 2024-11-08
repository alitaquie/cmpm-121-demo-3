import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";

// Constants and variables
const TILE_DEGREES = 1e-4; // Tile size increment
const NEIGHBORHOOD_SIZE = 8; // Size of area for cache generation
const CACHE_SPAWN_PROBABILITY = 0.1; // Chance of spawning a cache
const NULL_ISLAND = leaflet.latLng(0, 0); // Null Island as a geodetic datum reference point
const _PLAYER_START = leaflet.latLng(36.9895, -122.0628);
let playerPoints = 0; // Player's score
let playerInventory = 0; // Player's coin count

// Initialize map
const map = leaflet.map("map", {
  center: NULL_ISLAND, // Center map on Null Island for geodetic datum-based grid
  zoom: 19,
  zoomControl: true,
  scrollWheelZoom: true,
});

// Add OpenStreetMap tiles
leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    'Map data &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
}).addTo(map);

// Status and Inventory updates
const statusPanel = document.querySelector("#statusPanel")!;
const inventoryPanel = document.querySelector("#inventory")!;

const playerMarker = leaflet.marker(NULL_ISLAND);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

// Function to update status display
function updateStatus() {
  statusPanel.innerHTML = `Points: ${playerPoints}`;
  inventoryPanel.innerHTML = `Inventory: ${playerInventory} coins`;
}

// Location Factory using Flyweight Pattern
class LocationFactory {
  private locations: { [key: string]: leaflet.LatLng } = {};

  // Generate or retrieve an existing location based on coordinates
  getLocation(lat: number, lng: number): leaflet.LatLng {
    const key = `${lat},${lng}`;
    if (!this.locations[key]) {
      this.locations[key] = leaflet.latLng(lat, lng);
    }
    return this.locations[key];
  }
}

const locationFactory = new LocationFactory(); // Instantiate the factory

// Coin as a non-fungible token representation
type Coin = { i: number; j: number; serial: number }; // Unique ID based on cache coordinates and serial
let coinIdCounter = 0; // Global counter to ensure unique coin serials

// Function to spawn caches around NULL_ISLAND
function spawnCache(i: number, j: number) {
  const origin = NULL_ISLAND;
  const lat = origin.lat + i * TILE_DEGREES;
  const lng = origin.lng + j * TILE_DEGREES;

  // Use LocationFactory to create or retrieve unique locations
  const bounds = leaflet.latLngBounds([
    locationFactory.getLocation(lat, lng),
    locationFactory.getLocation(lat + TILE_DEGREES, lng + TILE_DEGREES),
  ]);

  // Create cache rectangle on the map
  const rect = leaflet.rectangle(bounds).addTo(map);
  let cacheCoins: Coin[] = Array.from({
    length: Math.floor(Math.random() * 5) + 1,
  }, (_, serial) => ({
    i,
    j,
    serial: serial, // Generate unique serial for each coin
  }));

  // Bind popup with cache details
  rect.bindPopup(() => {
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
      <div>Cache at (${i},${j})</div>
      <div>Coins available: <span id="coinCount">${cacheCoins.length}</span></div>
      <button id="collectCoins">Collect</button>
      <button id="depositCoins">Deposit</button>
    `;

    // Collect coins functionality
    popupDiv.querySelector("#collectCoins")!.addEventListener("click", () => {
      if (cacheCoins.length > 0) {
        playerInventory += cacheCoins.length;
        cacheCoins = []; // Clear collected coins
        updateStatus();
        popupDiv.querySelector("#coinCount")!.textContent = "0";
      }
    });

    // Deposit coins functionality
    popupDiv.querySelector("#depositCoins")!.addEventListener("click", () => {
      if (playerInventory > 0) {
        cacheCoins.push(
          ...Array.from(
            { length: playerInventory },
            (_, _serial) => ({ i, j, serial: coinIdCounter++ }),
          ),
        );
        playerPoints += playerInventory;
        playerInventory = 0;
        updateStatus();
        popupDiv.querySelector("#coinCount")!.textContent =
          `${cacheCoins.length}`;
      }
    });

    return popupDiv;
  });
}

// Generate caches in the neighborhood around NULL_ISLAND
for (let i = -NEIGHBORHOOD_SIZE; i <= NEIGHBORHOOD_SIZE; i++) {
  for (let j = -NEIGHBORHOOD_SIZE; j <= NEIGHBORHOOD_SIZE; j++) {
    if (Math.random() < CACHE_SPAWN_PROBABILITY) {
      spawnCache(i, j); // Spawn a cache at (i, j) if probability condition is met
    }
  }
}

// Event listener for resetting the game
document.querySelector("#resetGame")!.addEventListener("click", () => {
  playerPoints = 0; // Reset player points
  playerInventory = 0; // Reset inventory
  updateStatus(); // Update the display
});
