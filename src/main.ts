import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";

// Constants and variables
const TILE_DEGREES = 1e-4; // Tile size increment
const NEIGHBORHOOD_SIZE = 8; // Size of area for cache generation
const CACHE_SPAWN_PROBABILITY = 0.1; // Chance of spawning a cache
const NULL_ISLAND = leaflet.latLng(0, 0); // Null Island as a geodetic datum reference point

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

// Status and Inventory HTML elements
const statusPanel = document.querySelector("#statusPanel");
const inventoryPanel = document.querySelector("#inventory");
const movementHistoryPanel = document.querySelector("#movementHistory");

const playerMarker = leaflet.marker(NULL_ISLAND);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

// Location Factory using Flyweight Pattern
class LocationFactory {
  private locations: { [key: string]: leaflet.LatLng } = {};

  getLocation(lat: number, lng: number): leaflet.LatLng {
    const key = `${lat},${lng}`;
    if (!this.locations[key]) {
      this.locations[key] = leaflet.latLng(lat, lng);
    }
    return this.locations[key];
  }
}

const locationFactory = new LocationFactory();

// Coin as a non-fungible token representation
type Coin = { i: number; j: number; serial: number };
let coinIdCounter = 0;

// Cache classes
class CacheMemento {
  constructor(public cacheCoins: Coin[]) {}
}

class Cache {
  private coins: Coin[] = [];
  
  constructor(public i: number, public j: number) {}

  addCoins(coins: Coin[]) {
    this.coins.push(...coins);
  }

  collectCoins() {
    const collectedCoins = this.coins.length;
    this.coins = [];
    return collectedCoins;
  }

  getCoins(): Coin[] {
    return this.coins;
  }

  setCoins(coins: Coin[]) {
    this.coins = coins;
  }

  get coinCount() {
    return this.coins.length;
  }
}

// Manages saving and restoring cache states
class CacheMementoManager {
  saveState(cache: Cache): CacheMemento {
    return new CacheMemento([...cache.getCoins()]);
  }

  restoreState(cache: Cache, memento: CacheMemento): void {
    cache.setCoins(memento.cacheCoins);
  }
}

// Manages the creation and global logic of caches
class CacheManager {
  private cacheMap: Map<string, Cache> = new Map();
  private mementoManager = new CacheMementoManager();

  spawnCache(i: number, j: number): Cache {
    const key = `${i},${j}`;
    if (this.cacheMap.has(key)) {
      return this.cacheMap.get(key)!;
    }

    const cache = new Cache(i, j);
    const cacheCoins = Array.from(
      { length: Math.floor(Math.random() * 5) + 1 },
      (_, serial) => ({ i, j, serial })
    );
    cache.addCoins(cacheCoins);

    this.cacheMap.set(key, cache);
    return cache;
  }

  collectCache(key: string): number {
    const cache = this.cacheMap.get(key);
    if (cache) {
      return cache.collectCoins();
    }
    return 0;
  }

  cleanUpCaches(playerPos: leaflet.LatLng): void {
    this.cacheMap.forEach((cache, key) => {
      const cacheLatLng = locationFactory.getLocation(
        NULL_ISLAND.lat + cache.i * TILE_DEGREES,
        NULL_ISLAND.lng + cache.j * TILE_DEGREES
      );

      if (
        playerPos.distanceTo(cacheLatLng) >
        TILE_DEGREES * NEIGHBORHOOD_SIZE * 2
      ) {
        const memento = this.mementoManager.saveState(cache);
        this.mementoManager.restoreState(cache, memento); // Just for example purposes
        this.cacheMap.delete(key);
      }
    });
  }

  getCaches(): Map<string, Cache> {
    return this.cacheMap;
  }
}

// Handles rendering of caches and their interactions on the map
class PopupHandler {
  constructor(private cacheManager: CacheManager, private map: leaflet.Map) {}

  createPopupContent(i: number, j: number, cache: Cache): HTMLDivElement {
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
      <div>Cache at (${i},${j})</div>
      <div>Coins available: <span id="coinCount">${cache.coinCount}</span></div>
      <button id="collectCoins">Collect</button>
      <button id="depositCoins">Deposit</button>
      <button id="centerOnCache">Center on Cache</button>
    `;

    this.attachPopupListeners(popupDiv, i, j, cache);
    return popupDiv;
  }

  private attachPopupListeners(popupDiv: HTMLDivElement, i: number, j: number, cache: Cache): void {
    popupDiv.querySelector("#collectCoins")!.addEventListener("click", () => {
      if (cache.coinCount > 0) {
        playerState.addToInventory(this.cacheManager.collectCache(`${i},${j}`));
        updateStatus();
        popupDiv.querySelector("#coinCount")!.textContent = "0";
      }
    });

    popupDiv.querySelector("#depositCoins")!.addEventListener("click", () => {
      if (playerState.getInventory() > 0) {
        const depositCoins = Array.from(
          { length: playerState.getInventory() },
          (_, _serial) => ({ i, j, serial: coinIdCounter++ })
        );
        cache.addCoins(depositCoins);
        playerState.addPoints(playerState.getInventory());
        playerState.clearInventory();
        updateStatus();
        popupDiv.querySelector("#coinCount")!.textContent = `${cache.coinCount}`;
      }
    });

    popupDiv.querySelector("#centerOnCache")!.addEventListener("click", () => {
      this.map.panTo(locationFactory.getLocation(
        NULL_ISLAND.lat + i * TILE_DEGREES,
        NULL_ISLAND.lng + j * TILE_DEGREES
      ));
    });
  }
}

// Encapsulates player state handling
class PlayerState {
  private points = 0;
  private inventory = 0;
  private movementHistory: leaflet.LatLng[] = [];

  getPoints(): number {
    return this.points;
  }

  addPoints(points: number): void {
    this.points += points;
  }

  getInventory(): number {
    return this.inventory;
  }

  addToInventory(items: number): void {
    this.inventory += items;
  }

  clearInventory(): void {
    this.inventory = 0;
  }

  getMovementHistory(): leaflet.LatLng[] {
    return this.movementHistory;
  }

  addMovementHistory(position: leaflet.LatLng): void {
    this.movementHistory.push(position);
  }
}

// Instantiate CacheManager, PopupHandler, and PlayerState
const cacheManager = new CacheManager();
const popupHandler = new PopupHandler(cacheManager, map);
const playerState = new PlayerState();

// Update methods for specific UI panels
function updatePoints() {
  if (statusPanel) {
    statusPanel.innerHTML = `Points: ${playerState.getPoints()}`;
  }
}

function updateInventory() {
  if (inventoryPanel) {
    inventoryPanel.innerHTML = `Inventory: ${playerState.getInventory()} coins`;
  }
}

function updateMovementHistory() {
  if (movementHistoryPanel) {
    movementHistoryPanel.innerHTML = `Movement History: ${playerState.getMovementHistory().length} points`;
  }
}

function updateStatus() {
  updatePoints();
  updateInventory();
  updateMovementHistory();
}

// Regenerate caches and render them around the player
function regenerateCachesAround(playerPos: leaflet.LatLng) {
  map.eachLayer((layer: leaflet.Layer) => {
    if (layer instanceof leaflet.Rectangle) {
      map.removeLayer(layer);
    }
  });

  const playerI = Math.floor((playerPos.lat - NULL_ISLAND.lat) / TILE_DEGREES);
  const playerJ = Math.floor((playerPos.lng - NULL_ISLAND.lng) / TILE_DEGREES);

  for (let i = playerI - NEIGHBORHOOD_SIZE; i <= playerI + NEIGHBORHOOD_SIZE; i++) {
    for (let j = playerJ - NEIGHBORHOOD_SIZE; j <= playerJ + NEIGHBORHOOD_SIZE; j++) {
      const cache = cacheManager.spawnCache(i, j);
      const popupContent = popupHandler.createPopupContent(i, j, cache);

      const origin = locationFactory.getLocation(
        NULL_ISLAND.lat + i * TILE_DEGREES,
        NULL_ISLAND.lng + j * TILE_DEGREES
      );

      leaflet
        .rectangle([[origin.lat, origin.lng], [origin.lat + TILE_DEGREES, origin.lng + TILE_DEGREES]])
        .addTo(map)
        .bindPopup(popupContent);
    }
  }

  cacheManager.cleanUpCaches(playerPos);
}

// Document ready
document.addEventListener("DOMContentLoaded", () => {
  regenerateCachesAround(NULL_ISLAND);
  updateStatus();
});