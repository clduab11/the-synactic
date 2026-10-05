// Trader variant - trader.worldmonitor.app
// NOTE: This file is a structured canonical description for reference. The runtime
// wiring lives in src/config/panels.ts (TRADER_PANELS, TRADER_MAP_LAYERS,
// TRADER_MOBILE_MAP_LAYERS) — modify both if the variant shape changes. Parallel
// to energy.ts / commodity.ts / finance.ts / tech.ts / happy.ts / full.ts orphans.
//
// ─────────────────────────────────────────────────────────────────────────────
// CHARTER — read before extending this variant.
//
// Approved by the owner 2026-08-03 (CONTEXT.md v7 amendment to boundary 1).
// This variant is a DASHBOARD + MCP SURFACE. It renders market and OSINT context
// for the operator's own visibility, and the-synactic serves that intelligence
// over MCP to downstream repos (e.g. oanda-autobot) which hold their own venue
// accounts, their own licences, and their own trading authorization. THOSE repos
// execute; this one does not.
//
// NO order-placement, execution, transfer, or position-management code enters
// this repo — not stubbed, not "for testing". That line is unchanged and
// non-negotiable (CONTEXT.md boundary 1).
//
// It also wires NO new market-data upstream. Every panel here is an existing
// panel and every layer is an existing layer. OANDA, Binance, Coinbase and Pyth
// stay unwired; Kraken is the one authorized venue (boundary 1 v4 amendment),
// already integrated, and its quota condition is binding.
// ─────────────────────────────────────────────────────────────────────────────
import type { PanelConfig, MapLayers } from '@/types';
import type { VariantConfig } from './base';

// Re-export base config
export * from './base';

// ─────────────────────────────────────────────────────────────────────────────
// PANEL CONFIGURATION — market context + the OSINT baseline a price feed cannot
// reconstruct. IDs match existing panel registrations; no new panel components.
// ─────────────────────────────────────────────────────────────────────────────
export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  // Core
  map: { name: 'Trading Context Map', enabled: true, priority: 1 },
  'live-news': { name: 'Market Headlines', enabled: true, priority: 1 },
  insights: { name: 'AI Market Insights', enabled: true, priority: 1 },
  // Live market context (non-venue sources + Kraken, the one authorized venue)
  markets: { name: 'Live Markets', enabled: true, priority: 1 },
  'kraken-markets': { name: 'Kraken Spot', enabled: true, priority: 1 },
  commodities: { name: 'Metals & Materials', enabled: true, priority: 1 },
  'energy-complex': { name: 'Energy Complex', enabled: true, priority: 1 },
  heatmap: { name: 'Sector Heatmap', enabled: true, priority: 1 },
  // Regime / positioning / sentiment
  'macro-signals': { name: 'Market Regime', enabled: true, priority: 1 },
  'fear-greed': { name: 'Fear & Greed', enabled: true, priority: 1 },
  economic: { name: 'Macro Stress', enabled: true, priority: 1 },
  polymarket: { name: 'Prediction Markets', enabled: true, priority: 1 },
  // OSINT baseline
  'supply-chain': { name: 'Supply Chain', enabled: true, priority: 1 },
  // Research surfaces
  'stock-analysis': { name: 'Stock Analysis', enabled: true, priority: 1, premium: 'locked' as const },
  'stock-backtest': { name: 'Backtesting', enabled: true, priority: 1, premium: 'locked' as const },
  'chat-analyst': { name: 'WM Analyst', enabled: true, priority: 1, premium: 'locked' as const },
  'market-implications': { name: 'AI Market Implications', enabled: true, priority: 1, premium: 'locked' as const },
};

// ─────────────────────────────────────────────────────────────────────────────
// MAP LAYERS — the 12 owner-approved defaults.
// The picker offers a wider superset (see VARIANT_LAYER_ORDER.trader in
// src/config/map-layer-definitions.ts); those extras default to false here.
// ─────────────────────────────────────────────────────────────────────────────
export const DEFAULT_MAP_LAYERS: MapLayers = {
  // ── The approved 12 (ENABLED) ─────────────────────────────────────────────
  stockExchanges: true,     // Venue geography behind the tape
  centralBanks: true,       // Policy-setting institutions
  financialCenters: true,   // Liquidity centres / session overlap
  commodityHubs: true,      // Exchanges and physical pricing hubs
  waterways: true,          // Strategic chokepoints
  tradeRoutes: true,        // Physical trade flow
  ais: true,                // Vessel activity
  liveTankers: true,        // Tanker positions inside chokepoint bboxes
  pipelines: true,          // Energy transport infrastructure
  sanctions: true,          // Sanctions regimes affecting flow and counterparties
  natural: true,            // Earthquakes / natural events near infrastructure
  outages: true,            // Power and internet outages — system status

  // ── Picker superset, default OFF ──────────────────────────────────────────
  ucdpEvents: false,
  displacement: false,
  cyberThreats: false,
  economic: false,
  military: false,
  fires: false,
  weather: false,
  climate: false,

  // ── Not in this variant ───────────────────────────────────────────────────
  gpsJamming: false,
  satellites: false,
  iranAttacks: false,
  conflicts: false,
  bases: false,
  hotspots: false,
  nuclear: false,
  irradiators: false,
  spaceports: false,
  protests: false,
  flights: false,
  cables: false,
  datacenters: false,
  minerals: false,
  miningSites: false,
  processingPlants: false,
  commodityPorts: false,
  storageFacilities: false,
  fuelShortages: false,
  // Tech variant layers
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance variant layers
  gulfInvestments: false,
  // Happy variant layers
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  // Overlay
  dayNight: false,
  ciiChoropleth: false,
  resilienceScore: false,
  webcams: false,
  diseaseOutbreaks: false,
  // Upstream-added layers (Canada 511 roads/alerts): off by default here.
  canadaRoads: false,
  canadaAlerts: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// MOBILE MAP LAYERS — point layers kept, heavy vessel/line geometry dropped.
// ─────────────────────────────────────────────────────────────────────────────
export const MOBILE_DEFAULT_MAP_LAYERS: MapLayers = {
  stockExchanges: true,
  centralBanks: true,
  financialCenters: true,
  commodityHubs: true,
  waterways: true,
  natural: true,
  tradeRoutes: false,
  ais: false,
  liveTankers: false,
  pipelines: false,
  sanctions: false,
  outages: false,

  ucdpEvents: false,
  displacement: false,
  cyberThreats: false,
  economic: false,
  military: false,
  fires: false,
  weather: false,
  climate: false,

  gpsJamming: false,
  satellites: false,
  iranAttacks: false,
  conflicts: false,
  bases: false,
  hotspots: false,
  nuclear: false,
  irradiators: false,
  spaceports: false,
  protests: false,
  flights: false,
  cables: false,
  datacenters: false,
  minerals: false,
  miningSites: false,
  processingPlants: false,
  commodityPorts: false,
  storageFacilities: false,
  fuelShortages: false,
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  gulfInvestments: false,
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  dayNight: false,
  ciiChoropleth: false,
  resilienceScore: false,
  webcams: false,
  diseaseOutbreaks: false,
  // Upstream-added layers (Canada 511 roads/alerts): off by default here.
  canadaRoads: false,
  canadaAlerts: false,
};

export const VARIANT_CONFIG: VariantConfig = {
  name: 'trader',
  description: 'Trading context — market data, regime and positioning signals, prediction markets, and the geopolitical OSINT baseline a price feed cannot supply. Read-only: execution lives in downstream repos.',
  panels: DEFAULT_PANELS,
  mapLayers: DEFAULT_MAP_LAYERS,
  mobileMapLayers: MOBILE_DEFAULT_MAP_LAYERS,
};
