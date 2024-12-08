// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import "./leafletWorkaround.ts";
import luck from "./luck.ts";

// Types and interfaces
interface GlobalCell {
  i: number;
  j: number;
}

declare global {
  interface Window {
    game: GameManager;
  }
}
interface Coin {
  originI: number;
  originJ: number;
  serial: number;
  currentLocation: GlobalCell;
}

interface CacheMemento {
  coins: Array<Coin>;
}

// Constants
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;
const GAMEPLAY_ZOOM_LEVEL = 19;
const MOVEMENT_DELTA = 1e-4;

// Flyweight factory for cells
class CellFactory {
  private cells: Map<string, GlobalCell>;

  constructor() {
    this.cells = new Map();
  }

  getCellFromLatLng(lat: number, lng: number): GlobalCell {
    const i = Math.floor(lat * 10000);
    const j = Math.floor(lng * 10000);
    return this.getCell(i, j);
  }

  getCell(i: number, j: number): GlobalCell {
    const key = `${i},${j}`;
    if (!this.cells.has(key)) {
      this.cells.set(key, { i, j });
    }
    return this.cells.get(key)!;
  }
}

// Caretaker class for managing cache state mementos
class CacheStateCaretaker {
  private mementos: Map<string, CacheMemento> = new Map();

  saveState(cellKey: string, coins: Set<Coin>) {
    this.mementos.set(cellKey, {
      coins: Array.from(coins),
    });
  }

  getState(cellKey: string): Set<Coin> | undefined {
    const memento = this.mementos.get(cellKey);
    if (memento) {
      return new Set(memento.coins);
    }
    return undefined;
  }
}

interface GameState {
  playerCoins: Array<Coin>;
  locationHistory: Array<[number, number]>;
  cacheStates: Array<{
    cellKey: string;
    coins: Array<Coin>;
  }>;
}

class GameManager {
  private map: leaflet.Map;
  private playerMarker: leaflet.Marker;
  private statusPanel: HTMLDivElement;
  private cellFactory: CellFactory;
  private cacheStates: Map<string, Set<Coin>>;
  private playerCoins: Set<Coin>;
  private rectangles: Map<string, leaflet.Rectangle>;
  private caretaker: CacheStateCaretaker;
  private controlPanel!: HTMLDivElement;
  private locationHistory: leaflet.Polyline;
  private watchId: number | null = null;
  private pathCoordinates: leaflet.LatLng[] = [];

  constructor() {
    this.cellFactory = new CellFactory();
    this.cacheStates = new Map();
    this.playerCoins = new Set();
    this.rectangles = new Map();
    this.caretaker = new CacheStateCaretaker();

    // Initialize map centered at Oakes classroom
    const OAKES_CLASSROOM = leaflet.latLng(
      36.98949379578401,
      -122.06277128548504,
    );
    this.map = leaflet.map(document.getElementById("map")!, {
      center: OAKES_CLASSROOM,
      zoom: GAMEPLAY_ZOOM_LEVEL,
      minZoom: GAMEPLAY_ZOOM_LEVEL,
      maxZoom: GAMEPLAY_ZOOM_LEVEL,
      zoomControl: false,
      scrollWheelZoom: false,
    });

    // Add tile layer
    leaflet
      .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      })
      .addTo(this.map);

    // Initialize player marker
    this.playerMarker = leaflet.marker(OAKES_CLASSROOM);
    this.playerMarker.bindTooltip("Player Location");
    this.playerMarker.addTo(this.map);

    // Initialize location history polyline with initial position
    this.pathCoordinates = [OAKES_CLASSROOM];
    this.locationHistory = leaflet.polyline(this.pathCoordinates, {
      color: "blue",
      weight: 3,
      opacity: 0.5,
    }).addTo(this.map);

    // Initialize panels
    this.statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
    this.createControlPanel();

    // Load saved state or start fresh
    this.loadGameState();

    // Start game
    this.refreshVisibleArea();
    this.updateStatusPanel();
  }

  private movePlayer(direction: "north" | "south" | "east" | "west") {
    const currentPos = this.playerMarker.getLatLng();
    let newPos: leaflet.LatLng;

    switch (direction) {
      case "north":
        newPos = leaflet.latLng(
          currentPos.lat + MOVEMENT_DELTA,
          currentPos.lng,
        );
        break;
      case "south":
        newPos = leaflet.latLng(
          currentPos.lat - MOVEMENT_DELTA,
          currentPos.lng,
        );
        break;
      case "east":
        newPos = leaflet.latLng(
          currentPos.lat,
          currentPos.lng + MOVEMENT_DELTA,
        );
        break;
      case "west":
        newPos = leaflet.latLng(
          currentPos.lat,
          currentPos.lng - MOVEMENT_DELTA,
        );
        break;
    }

    this.updatePlayerPosition(newPos);
  }

  private updatePlayerPosition(newPos: leaflet.LatLng) {
    // Update player marker
    this.playerMarker.setLatLng(newPos);
    this.map.setView(newPos);

    // Update path coordinates and polyline
    this.pathCoordinates.push(newPos);
    this.locationHistory.setLatLngs(this.pathCoordinates);

    // Refresh visible caches
    this.refreshVisibleArea();

    // Save game state
    this.saveGameState();
  }

  private toggleGeolocation() {
    const locationButton = this.controlPanel.querySelector(
      "#toggleLocation",
    ) as HTMLButtonElement;

    if (this.watchId === null) {
      if ("geolocation" in navigator) {
        locationButton.style.backgroundColor = "#a0f0a0"; // Green background when active
        this.watchId = navigator.geolocation.watchPosition(
          (position) => {
            const newPos = leaflet.latLng(
              position.coords.latitude,
              position.coords.longitude,
            );
            this.updatePlayerPosition(newPos);
          },
          (error) => {
            console.error("Geolocation error:", error);
            this.watchId = null;
            locationButton.style.backgroundColor = ""; // Reset background on error
          },
          {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0,
          },
        );
      } else {
        alert("Geolocation is not supported by your browser");
      }
    } else {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      locationButton.style.backgroundColor = ""; // Reset background when disabled
    }
  }

  private resetGame() {
    if (
      confirm(
        "Are you sure you want to reset the game? This will return all coins to their original locations and clear your location history.",
      )
    ) {
      // Clear location history
      this.pathCoordinates = [this.playerMarker.getLatLng()];
      this.locationHistory.setLatLngs(this.pathCoordinates);

      // Return all coins to their original caches
      for (const coin of this.playerCoins) {
        const originCellKey = this.getCellKey(
          this.cellFactory.getCell(coin.originI, coin.originJ),
        );
        let originCache = this.cacheStates.get(originCellKey);
        if (!originCache) {
          originCache = new Set<Coin>();
          this.cacheStates.set(originCellKey, originCache);
        }
        originCache.add(coin);
      }

      // Clear player's inventory
      this.playerCoins.clear();

      // Clear local storage
      localStorage.removeItem("geocoinGame");

      // Refresh display
      this.refreshVisibleArea();
      this.updateStatusPanel();
    }
  }

  private saveGameState() {
    const gameState: GameState = {
      playerCoins: Array.from(this.playerCoins),
      locationHistory: this.pathCoordinates.map((pos) => [pos.lat, pos.lng]),
      cacheStates: Array.from(this.cacheStates.entries()).map((
        [cellKey, coins],
      ) => ({
        cellKey,
        coins: Array.from(coins),
      })),
    };

    localStorage.setItem("geocoinGame", JSON.stringify(gameState));
  }

  private loadGameState() {
    const savedState = localStorage.getItem("geocoinGame");
    if (savedState) {
      try {
        const gameState: GameState = JSON.parse(savedState);

        // Restore player coins
        this.playerCoins = new Set(gameState.playerCoins);

        // Restore location history
        this.pathCoordinates = gameState.locationHistory.map(([lat, lng]) =>
          leaflet.latLng(lat, lng)
        );
        this.locationHistory.setLatLngs(this.pathCoordinates);

        // If there's a history, move player to last position
        if (this.pathCoordinates.length > 0) {
          const lastPos = this.pathCoordinates[this.pathCoordinates.length - 1];
          this.playerMarker.setLatLng(lastPos);
          this.map.setView(lastPos);
        }

        // Restore cache states
        for (const { cellKey, coins } of gameState.cacheStates) {
          this.cacheStates.set(cellKey, new Set(coins));
        }
      } catch (error) {
        console.error("Error loading game state:", error);
        // If there's an error loading the state, start fresh
        localStorage.removeItem("geocoinGame");
      }
    }
  }

  private createControlPanel() {
    this.controlPanel = document.createElement("div");
    this.controlPanel.className = "control-panel";
    this.controlPanel.innerHTML = `
      <div class="movement-controls">
        <button id="moveNorth">⬆️</button>
        <button id="moveSouth">⬇️</button>
        <button id="moveWest">⬅️</button>
        <button id="moveEast">➡️</button>
        <button id="toggleLocation">🌐</button>
        <button id="resetGame">🚮</button>
      </div>
    `;
    document.body.appendChild(this.controlPanel);

    // Add movement event listeners
    this.controlPanel.querySelector("#moveNorth")!.addEventListener(
      "click",
      () => this.movePlayer("north"),
    );
    this.controlPanel.querySelector("#moveSouth")!.addEventListener(
      "click",
      () => this.movePlayer("south"),
    );
    this.controlPanel.querySelector("#moveWest")!.addEventListener(
      "click",
      () => this.movePlayer("west"),
    );
    this.controlPanel.querySelector("#moveEast")!.addEventListener(
      "click",
      () => this.movePlayer("east"),
    );

    // Add geolocation toggle
    this.controlPanel.querySelector("#toggleLocation")!.addEventListener(
      "click",
      () => this.toggleGeolocation(),
    );

    // Add reset button
    this.controlPanel.querySelector("#resetGame")!.addEventListener(
      "click",
      () => this.resetGame(),
    );
  }

  private refreshVisibleArea() {
    // Save current cache states
    for (const [cellKey, coins] of this.cacheStates.entries()) {
      this.caretaker.saveState(cellKey, coins);
    }

    // Clear current visible caches
    for (const rect of this.rectangles.values()) {
      rect.remove();
    }
    this.rectangles.clear();
    this.cacheStates.clear();

    // Get current player position and generate new visible area
    const playerPos = this.playerMarker.getLatLng();
    const centerCell = this.cellFactory.getCellFromLatLng(
      playerPos.lat,
      playerPos.lng,
    );

    for (let di = -NEIGHBORHOOD_SIZE; di < NEIGHBORHOOD_SIZE; di++) {
      for (let dj = -NEIGHBORHOOD_SIZE; dj < NEIGHBORHOOD_SIZE; dj++) {
        const cell = this.cellFactory.getCell(
          centerCell.i + di,
          centerCell.j + dj,
        );
        const cellKey = this.getCellKey(cell);

        // Check if we have saved state for this cell
        const savedState = this.caretaker.getState(cellKey);

        if (savedState) {
          // Restore saved cache
          this.cacheStates.set(cellKey, savedState);
          this.createCacheVisual(cell);
        } else if (
          luck([cell.i, cell.j].toString()) < CACHE_SPAWN_PROBABILITY
        ) {
          // Generate new cache
          this.createCache(cell);
        }
      }
    }
  }

  private createCache(cell: GlobalCell) {
    const cellKey = this.getCellKey(cell);

    // Initialize coin set for this cache
    const coins = new Set<Coin>();
    const numCoins =
      Math.floor(luck([cell.i, cell.j, "coins"].toString()) * 5) + 1;

    for (let serial = 0; serial < numCoins; serial++) {
      coins.add({
        originI: cell.i,
        originJ: cell.j,
        serial,
        currentLocation: cell,
      });
    }

    this.cacheStates.set(cellKey, coins);
    this.createCacheVisual(cell);
  }

  private createCacheVisual(cell: GlobalCell) {
    const cellKey = this.getCellKey(cell);
    const bounds = this.getCellBounds(cell);
    const rect = leaflet.rectangle(bounds, {
      color: "green",
      fillOpacity: 0.2,
    });

    this.rectangles.set(cellKey, rect);
    rect.addTo(this.map);
    rect.bindPopup(() => this.createCachePopup(cell));
  }

  private createCachePopup(cell: GlobalCell): HTMLDivElement {
    const cellKey = this.getCellKey(cell);
    const popupDiv = document.createElement("div");
    popupDiv.className = "cache-popup";

    popupDiv.innerHTML = `
        <h3>Cache at Global Cell {i: ${cell.i}, j: ${cell.j}}</h3>
        <h4>Coins in cache:</h4>
        <div id="cacheList" class="coin-list">${
      this.generateCacheCoinsHTML(cell)
    }</div>
        <h4>Your coins:</h4>
        <div id="playerList" class="coin-list">${
      this.generatePlayerCoinsHTML(cellKey)
    }</div>
        <div class="action-buttons">
            <button id="collectAllBtn">Collect All</button>
            <button id="depositAllBtn">Deposit All</button>
        </div>
    `;

    // Add event listeners for action buttons
    popupDiv.querySelector("#collectAllBtn")?.addEventListener("click", () => {
      const cacheCoins = this.cacheStates.get(cellKey) || new Set<Coin>();
      for (const coin of cacheCoins) {
        this.collectCoin(cellKey, coin.originI, coin.originJ, coin.serial);
      }
    });

    popupDiv.querySelector("#depositAllBtn")?.addEventListener("click", () => {
      for (const coin of this.playerCoins) {
        this.depositCoin(cellKey, coin.originI, coin.originJ, coin.serial);
      }
    });

    return popupDiv;
  }

  // Helper methods for generating HTML
  private generateCacheCoinsHTML(cell: GlobalCell): string {
    const cellKey = this.getCellKey(cell);
    const cacheCoins = this.cacheStates.get(cellKey) || new Set<Coin>();
    return Array.from(cacheCoins)
      .map((coin) => `
            <div class="coin-item">
                <span class="coin-info">Origin: {i: ${coin.originI}, j: ${coin.originJ}, serial: ${coin.serial}}</span>
                <button onclick="window.game.collectCoin('${cellKey}', ${coin.originI}, ${coin.originJ}, ${coin.serial})">
                    Collect
                </button>
            </div>`).join("");
  }

  private generatePlayerCoinsHTML(cellKey: string): string {
    return Array.from(this.playerCoins)
      .map((coin) => `
            <div class="coin-item">
                <span class="coin-info">Origin: {i: ${coin.originI}, j: ${coin.originJ}, serial: ${coin.serial}}</span>
                <button onclick="window.game.depositCoin('${cellKey}', ${coin.originI}, ${coin.originJ}, ${coin.serial})">
                    Deposit
                </button>
            </div>`).join("");
  }
  collectCoin(
    cellKey: string,
    originI: number,
    originJ: number,
    serial: number,
  ) {
    const cache = this.cacheStates.get(cellKey);
    if (!cache) return;

    const coin = Array.from(cache).find(
      (c) =>
        c.originI === originI && c.originJ === originJ && c.serial === serial,
    );

    if (coin) {
      cache.delete(coin);
      this.playerCoins.add(coin);
      this.updateCacheDisplay(cellKey);
    }
  }

  depositCoin(
    cellKey: string,
    originI: number,
    originJ: number,
    serial: number,
  ) {
    const coin = Array.from(this.playerCoins).find(
      (c) =>
        c.originI === originI && c.originJ === originJ && c.serial === serial,
    );

    if (coin) {
      this.playerCoins.delete(coin);
      const cache = this.cacheStates.get(cellKey) || new Set<Coin>();
      cache.add(coin);
      this.cacheStates.set(cellKey, cache);
      this.updateCacheDisplay(cellKey);
    }
  }

  private updateCacheDisplay(cellKey: string) {
    const cache = this.cacheStates.get(cellKey);
    const rect = this.rectangles.get(cellKey);

    if (rect && cache) {
      rect.setStyle({
        color: cache.size > 0 ? "green" : "gray",
      });
    }

    this.updateStatusPanel();
  }

  private updateStatusPanel() {
    this.statusPanel.innerHTML = `
      Player has ${this.playerCoins.size} coins<br>
      ${
      Array.from(this.playerCoins)
        .map((coin) =>
          `{i: ${coin.originI}, j: ${coin.originJ}, serial: ${coin.serial}}`
        )
        .join("<br>")
    }
    `;
  }

  private getCellKey(cell: GlobalCell): string {
    return `${cell.i},${cell.j}`;
  }

  private getCellBounds(cell: GlobalCell): leaflet.LatLngBounds {
    return leaflet.latLngBounds([
      [cell.i / 10000, cell.j / 10000],
      [(cell.i + 1) / 10000, (cell.j + 1) / 10000],
    ]);
  }
}

globalThis.addEventListener("load", () => {
  globalThis.game = new GameManager();
});
