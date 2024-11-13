import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";

// Constants and variables
const TILE_DEGREES = 1e-4; // Tile size increment
const NEIGHBORHOOD_SIZE = 8; // Size of area for cache generation
const CACHE_SPAWN_PROBABILITY = 0.1; // Chance of spawning a cache
const NULL_ISLAND = leaflet.latLng(0, 0); // Null Island as a geodetic datum reference point
let playerPoints = 0; // Player's score
let playerInventory = 0; // Player's coin count
let playerMovementHistory: leaflet.LatLng[] = []; // Player's movement history

// Initialize map
const map = leaflet.map("map", {
  center: NULL_ISLAND,
  zoom: 19,
  zoomControl: true,
  scrollWheelZoom: true,
});

// Add OpenStreetMap tiles
leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: 'Map data &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
}).addTo(map);

// Status and Inventory updates
const statusPanel = document.querySelector("#statusPanel");
const inventoryPanel = document.querySelector("#inventory");
const movementHistoryPanel = document.querySelector("#movementHistory");

const playerMarker = leaflet.marker(NULL_ISLAND);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

// Function to update status display
function updateStatus() {
  if (statusPanel && inventoryPanel && movementHistoryPanel) {
    statusPanel.innerHTML = `Points: ${playerPoints}`;
    inventoryPanel.innerHTML = `Inventory: ${playerInventory} coins`;
    movementHistoryPanel.innerHTML = `Movement History: ${playerMovementHistory.length} points`;
  }
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

// Cache Memento class to store the state
class CacheMemento {
  constructor(public cacheCoins: Coin[]) {}
}

class Cache {
  private coins: Coin[] = [];
  private memento?: CacheMemento;

  constructor(public i: number, public j: number) {}

  // Save the current state into a memento
  saveState(): CacheMemento {
    this.memento = new CacheMemento([...this.coins]);
    return this.memento;
  }

  // Restore state from a memento
  restoreState(memento: CacheMemento) {
    this.coins = memento.cacheCoins;
  }

  // Example coin management
  addCoins(coins: Coin[]) {
    this.coins.push(...coins);
  }

  collectCoins() {
    const collectedCoins = this.coins.length;
    this.coins = [];
    return collectedCoins;
  }

  get coinCount() {
    return this.coins.length;
  }
}

const cacheMap: Map<string, Cache> = new Map();

// Function to spawn caches around NULL_ISLAND
function spawnCache(i: number, j: number) {
  const key = `${i},${j}`;
  const cache = new Cache(i, j);
  cacheMap.set(key, cache);

  const cacheCoins = Array.from(
    { length: Math.floor(Math.random() * 5) + 1 },
    (_, serial) => ({ i, j, serial })
  );
  cache.addCoins(cacheCoins);

  // Generate cache on map with popup
  const origin = NULL_ISLAND;
  const lat = origin.lat + i * TILE_DEGREES;
  const lng = origin.lng + j * TILE_DEGREES;

  const bounds = leaflet.latLngBounds([
    locationFactory.getLocation(lat, lng),
    locationFactory.getLocation(lat + TILE_DEGREES, lng + TILE_DEGREES),
  ]);

  const rect = leaflet.rectangle(bounds).addTo(map);
  rect.bindPopup(() => {
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
      <div>Cache at (${i},${j})</div>
      <div>Coins available: <span id="coinCount">${cache.coinCount}</span></div>
      <button id="collectCoins">Collect</button>
      <button id="depositCoins">Deposit</button>
      <button id="centerOnCache">Center on Cache</button>
    `;

    popupDiv.querySelector("#collectCoins")!.addEventListener("click", () => {
      if (cache.coinCount > 0) {
        playerInventory += cache.collectCoins();
        updateStatus();
        popupDiv.querySelector("#coinCount")!.textContent = "0";
      }
    });

    popupDiv.querySelector("#depositCoins")!.addEventListener("click", () => {
      if (playerInventory > 0) {
        const depositCoins = Array.from(
          { length: playerInventory },
          (_, _serial) => ({ i, j, serial: coinIdCounter++ })
        );
        cache.addCoins(depositCoins);
        playerPoints += playerInventory;
        playerInventory = 0;
        updateStatus();
        popupDiv.querySelector("#coinCount")!.textContent = `${cache.coinCount}`;
      }
    });

    popupDiv.querySelector("#centerOnCache")!.addEventListener("click", () => {
      map.panTo(locationFactory.getLocation(lat, lng));
    });

    return popupDiv;
  });
}

// Facade pattern to decouple player movement from specific mechanisms
interface PlayerMovementStrategy {
  getCurrentPosition(): leaflet.LatLng;
  startPositionTracking(): void;
  stopPositionTracking(): void;
}

class ManualPlayerMovement implements PlayerMovementStrategy {
  getCurrentPosition(): leaflet.LatLng {
    return playerMarker.getLatLng();
  }

  startPositionTracking(): void {
    // No-op for manual movement
  }

  stopPositionTracking(): void {
    // No-op for manual movement
  }
}

class AutomaticPlayerMovement implements PlayerMovementStrategy {
  private watchId: number | null = null;

  getCurrentPosition(): leaflet.LatLng {
    const pos = this.getCurrentGeolocation();
    return locationFactory.getLocation(pos.latitude, pos.longitude);
  }

  startPositionTracking(): void {
    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        this.onPositionUpdate(position);
      },
      (error) => {
        console.error("Error getting geolocation:", error);
      }
    );
  }

  stopPositionTracking(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  private getCurrentGeolocation(): GeolocationPosition {
    return navigator.geolocation.getCurrentPosition((position) => position);
  }

  private onPositionUpdate(position: GeolocationPosition): void {
    const newPos = locationFactory.getLocation(
      position.coords.latitude,
      position.coords.longitude
    );
    playerMarker.setLatLng(newPos);
    map.panTo(newPos);

    playerMovementHistory.push(newPos);
    updateStatus();
    updatePlayerPath();  // Update polyline path
  }
}

let playerMovementStrategy: PlayerMovementStrategy = new ManualPlayerMovement();
let playerPolyline = leaflet.polyline(playerMovementHistory, { color: 'blue' }).addTo(map);

// Function to update the polyline path as player moves
function updatePlayerPath() {
  playerPolyline.setLatLngs(playerMovementHistory);
}

// Functions to handle player movement
function movePlayer(dx: number, dy: number) {
  const newLat = playerMovementStrategy.getCurrentPosition().lat + dy;
  const newLng = playerMovementStrategy.getCurrentPosition().lng + dx;
  const newPos = locationFactory.getLocation(newLat, newLng);
  playerMarker.setLatLng(newPos);

  regenerateCachesAround(newPos);
  map.panTo(newPos);

  // Store the player's movement history
  playerMovementHistory.push(newPos);
  updateStatus();

  // Update the polyline path
  updatePlayerPath();
}
function togglePositionTracking() {
  if (playerMovementStrategy instanceof ManualPlayerMovement) {
    playerMovementStrategy = new AutomaticPlayerMovement();
    playerMovementStrategy.startPositionTracking();
  } else {
    playerMovementStrategy.stopPositionTracking();
    playerMovementStrategy = new ManualPlayerMovement();
  }
}

// Cache regeneration around the player
function regenerateCachesAround(playerPos: leaflet.LatLng) {
  // Clear existing cache markers
  map.eachLayer((layer: leaflet.Layer) => {
    if (layer instanceof leaflet.Rectangle) {
      map.removeLayer(layer);
    }
  });

  // Calculate the bounds around the player position
  const playerI = Math.floor((playerPos.lat - NULL_ISLAND.lat) / TILE_DEGREES);
  const playerJ = Math.floor((playerPos.lng - NULL_ISLAND.lng) / TILE_DEGREES);

  // Regenerate caches within the neighborhood
  for (let i = playerI - NEIGHBORHOOD_SIZE; i <= playerI + NEIGHBORHOOD_SIZE; i++) {
    for (let j = playerJ - NEIGHBORHOOD_SIZE; j <= playerJ + NEIGHBORHOOD_SIZE; j++) {
      const key = `${i},${j}`;
      
      // If cache exists at this location
      if (cacheMap.has(key)) {
        const cache = cacheMap.get(key)!;
        if (cache.memento) {
          cache.restoreState(cache.memento);
        }
        spawnCache(i, j);
      } 
      // If no cache exists and we meet spawn probability
      else if (Math.random() < CACHE_SPAWN_PROBABILITY) {
        spawnCache(i, j);
      }
    }
  }

  // Clean up caches that are too far away
  cacheMap.forEach((cache, key) => {
    const cacheLatLng = locationFactory.getLocation(
      NULL_ISLAND.lat + cache.i * TILE_DEGREES,
      NULL_ISLAND.lng + cache.j * TILE_DEGREES
    );

    if (playerPos.distanceTo(cacheLatLng) > TILE_DEGREES * NEIGHBORHOOD_SIZE * 2) {
      cache.saveState();
      cacheMap.delete(key);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Add event listeners for movement buttons
  document.querySelector("#moveUp")!.addEventListener("click", () => movePlayer(0, TILE_DEGREES));
  document.querySelector("#moveDown")!.addEventListener("click", () => movePlayer(0, -TILE_DEGREES));
  document.querySelector("#moveLeft")!.addEventListener("click", () => movePlayer(-TILE_DEGREES, 0));
  document.querySelector("#moveRight")!.addEventListener("click", () => movePlayer(TILE_DEGREES, 0));
  document.querySelector("#togglePositionTracking")!.addEventListener("click", togglePositionTracking);

  // Persist game state to local storage
  function loadGameState() {
    const savedState = localStorage.getItem("gameState");
    if (savedState) {
      const { playerPoints, playerInventory, playerMovementHistory } = JSON.parse(savedState);
      this.playerPoints = playerPoints;
      this.playerInventory = playerInventory;
      this.playerMovementHistory = playerMovementHistory.map((pos) =>
        locationFactory.getLocation(pos.lat, pos.lng)
      );
      updateStatus();
    }
  }

  function saveGameState() {
    localStorage.setItem(
      "gameState",
      JSON.stringify({
        playerPoints,
        playerInventory,
        playerMovementHistory: playerMovementHistory.map((pos) => pos.toJSON()),
      })
    );
  }

  // Event listener for resetting the game
  document.querySelector("#resetGame")!.addEventListener("click", () => {
    if (confirm("Are you sure you want to reset the game?")) {
      playerPoints = 0;
      playerInventory = 0;
      playerMovementHistory = [];
      cacheMap.forEach((cache) => cache.saveState());
      updateStatus();
      localStorage.removeItem("gameState");
  
      // Clear polyline path
      playerPolyline.setLatLngs([]);
    }
  });

  // Initial cache generation
  for (let i = -NEIGHBORHOOD_SIZE; i <= NEIGHBORHOOD_SIZE; i++) {
    for (let j = -NEIGHBORHOOD_SIZE; j <= NEIGHBORHOOD_SIZE; j++) {
      if (Math.random() < CACHE_SPAWN_PROBABILITY) {
        spawnCache(i, j); // Spawn a cache at (i, j) if probability condition is met
      }
    }
  }

  // Load the game state from local storage
  loadGameState();

  // Render the player's movement history as a polyline
  const movementHistoryLayer = leaflet.polyline(playerMovementHistory, {
    color: "red",
    weight: 3,
  }).addTo(map);
});