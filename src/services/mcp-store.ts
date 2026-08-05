import { loadFromStorage, saveToStorage } from '@/utils';
import { clearPanelColSpanEntry, clearPanelSpanEntry } from '@/utils/panel-storage';

const STORAGE_KEY = 'wm-mcp-panels';
const MAX_PANELS = 10;

export interface McpPreset {
  name: string;
  icon: string;
  description: string;
  serverUrl: string;
  authNote?: string;
  /** Header template for simple API key mode. E.g. "Authorization: Bearer {key}" or "X-Goog-Api-Key: {key}".
   *  When present, the modal shows a single "API KEY" input instead of a raw header field. */
  apiKeyHeader?: string;
  defaultTool?: string;
  defaultArgs?: Record<string, unknown>;
  defaultTitle?: string;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    name: 'Exa Search',
    icon: '🔍',
    description: 'Real-time web search with clean, LLM-ready content from top results',
    serverUrl: 'https://mcp.exa.ai/mcp',
    authNote: 'Requires Authorization: Bearer <EXA_API_KEY> (free tier at exa.ai)',
    apiKeyHeader: 'Authorization: Bearer {key}',
    defaultTool: 'web_search_exa',
    defaultArgs: { query: 'latest geopolitical developments Middle East', numResults: 5 },
    defaultTitle: 'Web Intelligence',
  },
  {
    name: 'Tavily Search',
    icon: '🕵️',
    description: 'AI-optimized web search with source citations and real-time answers',
    serverUrl: 'https://mcp.tavily.com/mcp/',
    authNote: 'Requires Authorization: Bearer <TAVILY_API_KEY> (free tier at tavily.com)',
    apiKeyHeader: 'Authorization: Bearer {key}',
    defaultTool: 'tavily_search',
    defaultArgs: { query: 'breaking news today', search_depth: 'advanced', max_results: 5 },
    defaultTitle: 'Tavily Search',
  },
  {
    name: 'Perigon News',
    icon: '📰',
    description: 'Real-time global news search with journalist, company, and topic filters',
    serverUrl: 'https://mcp.perigon.io/v1/mcp',
    authNote: 'Requires Authorization: Bearer <PERIGON_API_KEY> (from perigon.io)',
    apiKeyHeader: 'Authorization: Bearer {key}',
    defaultTool: 'search_articles',
    defaultArgs: { q: 'conflict OR crisis', sortBy: 'date', size: 10 },
    defaultTitle: 'News Feed',
  },
  {
    name: 'Robtex',
    icon: '🛡️',
    description: 'Free DNS intelligence, IP reputation, BGP routing, and network threat data',
    serverUrl: 'https://mcp.robtex.com/mcp',
    defaultTool: 'ip_reputation',
    defaultArgs: { ip: '8.8.8.8' },
    defaultTitle: 'Network Intel',
  },
  {
    name: 'Pyth Price Feeds',
    icon: '📡',
    description: 'Free real-time price feeds for crypto, equities, and FX from Pyth Network',
    serverUrl: 'https://mcp.pyth.network/mcp',
    defaultTool: 'get_latest_price',
    defaultArgs: { symbol: 'Crypto.BTC/USD' },
    defaultTitle: 'Pyth Prices',
  },
  {
    name: 'LunarCrush',
    icon: '🌙',
    description: 'Crypto and stock social sentiment — mentions, engagement, and influencer signals',
    serverUrl: 'https://lunarcrush.ai/mcp',
    authNote: 'Requires Authorization: Bearer <LUNARCRUSH_API_KEY> (from lunarcrush.com)',
    apiKeyHeader: 'Authorization: Bearer {key}',
    defaultTool: 'Cryptocurrencies',
    defaultArgs: { sector: '', sort: 'social_dominance', limit: 20 },
    defaultTitle: 'Crypto Sentiment',
  },
  {
    name: 'Weather Forensics',
    icon: '🌦️',
    description: 'Free historical and current weather data — hourly, daily, and severe events',
    serverUrl: 'https://weatherforensics.dev/mcp/free',
    defaultTool: 'noaa_ncei_daily_weather_for_location_date',
    defaultArgs: { latitude: 33.8938, longitude: 35.5018, date: '2026-03-19' },
    defaultTitle: 'Weather',
  },
  {
    name: 'Alpha Vantage',
    icon: '📉',
    description: 'Stocks, forex, crypto, and commodities — real-time and historical market data',
    serverUrl: 'https://mcp.alphavantage.co/mcp',
    authNote: 'Requires X-API-Key: <ALPHAVANTAGE_API_KEY> (free at alphavantage.co)',
    // Measured 2026-08-04: this server 401s on Authorization: Bearer
    // ("invalid_token") and accepts X-API-Key. A ?apikey= query param also
    // works, but a header keeps the credential out of URLs and logs.
    apiKeyHeader: 'X-API-Key: {key}',
    defaultTool: 'get_quote',
    defaultArgs: { symbol: 'SPY' },
    defaultTitle: 'Market Data',
  },
  {
    name: 'GitHub',
    icon: '🐙',
    description: 'Your repos, issues, PRs, pull requests, and code reviews',
    serverUrl: 'https://api.githubcopilot.com/mcp/',
    authNote: 'Requires Authorization: Bearer <GITHUB_TOKEN>',
    apiKeyHeader: 'Authorization: Bearer {key}',
    defaultTool: 'list_issues',
    defaultArgs: { owner: 'your-org', repo: 'your-repo', state: 'open', per_page: 20 },
    defaultTitle: 'GitHub Issues',
  },
  {
    name: 'Cloudflare Radar',
    icon: '🌐',
    description: 'Live internet traffic, outages, BGP anomalies, and attack trends',
    // /sse returns HTTP 405 — Cloudflare moved these to streamable HTTP.
    serverUrl: 'https://radar.mcp.cloudflare.com/mcp',
    authNote: 'Requires Authorization: Bearer <CF_API_TOKEN> (from Cloudflare dashboard)',
    apiKeyHeader: 'Authorization: Bearer {key}',
    defaultTool: 'get_summary_attacks',
    defaultArgs: { limit: 10 },
    defaultTitle: 'Internet Radar',
  },
  {
    name: 'Google Maps',
    icon: '🗺️',
    description: 'Location search, place details, directions, and geocoding',
    serverUrl: 'https://mapstools.googleapis.com/mcp',
    authNote: 'Requires X-Goog-Api-Key: <GOOGLE_MAPS_API_KEY>',
    apiKeyHeader: 'X-Goog-Api-Key: {key}',
    defaultTool: 'maps_search_places',
    defaultArgs: { query: 'airports near Beirut', radius: 100000 },
    defaultTitle: 'Maps',
  },
  {
    name: 'Browser Fetch',
    icon: '📄',
    description: 'Fetch and read any public URL as plain text or markdown via Cloudflare Browser Rendering',
    serverUrl: 'https://browser.mcp.cloudflare.com/mcp',
    authNote: 'Requires Authorization: Bearer <CF_API_TOKEN> (from Cloudflare dashboard)',
    apiKeyHeader: 'Authorization: Bearer {key}',
    defaultTool: 'fetch',
    defaultArgs: { url: 'https://example.com', maxLength: 5000 },
    defaultTitle: 'Web Fetch',
  },
  {
    name: 'Linear',
    icon: '📋',
    description: 'Your issues, projects, cycles, and team roadmap',
    serverUrl: 'https://mcp.linear.app/mcp',
    authNote: 'Requires Authorization: Bearer <LINEAR_API_KEY>',
    apiKeyHeader: 'Authorization: Bearer {key}',
    defaultTool: 'list_issues',
    defaultArgs: { filter: { state: { type: { eq: 'started' } } }, first: 20 },
    defaultTitle: 'Linear Issues',
  },
  {
    name: 'Sentry',
    icon: '🐛',
    description: 'Live error rates, recent exceptions, and release health',
    serverUrl: 'https://mcp.sentry.dev/mcp',
    authNote: 'Requires Authorization: Bearer <SENTRY_AUTH_TOKEN>',
    apiKeyHeader: 'Authorization: Bearer {key}',
    defaultTool: 'get_issues',
    defaultArgs: { organization_slug: 'your-org', project_slug: 'your-project', limit: 20 },
    defaultTitle: 'Sentry Errors',
  },
  {
    name: 'PostHog',
    icon: '📊',
    description: 'Product analytics, session insights, feature flags, and error tracking',
    serverUrl: 'https://mcp.posthog.com/mcp',
    authNote: 'Requires Authorization: Bearer <POSTHOG_PERSONAL_API_KEY> (PostHog → Settings → Personal API keys)',
    apiKeyHeader: 'Authorization: Bearer {key}',
    // Measured against the live server: it exposes exactly ONE tool, `exec`,
    // taking a CLI-style { command } — tools | search | info | schema | call.
    // `tools` takes no arguments, is read-only, and is what the tool's own
    // description says to run first, so the panel always renders something
    // useful. Swap in e.g. "call insight-query {…}" for a real metric panel.
    defaultTool: 'exec',
    defaultArgs: { command: 'tools' },
    defaultTitle: 'PostHog Analytics',
  },
  {
    name: 'Stripe',
    icon: '💳',
    description: 'Revenue, charges, subscriptions, and payment activity',
    serverUrl: 'https://mcp.stripe.com/',
    authNote: 'Requires Authorization: Bearer <STRIPE_SECRET_KEY>',
    apiKeyHeader: 'Authorization: Bearer {key}',
    defaultTool: 'retrieve_balance',
    defaultArgs: {},
    defaultTitle: 'Stripe Balance',
  },
  {
    name: 'Notion',
    icon: '📝',
    description: 'Search and query your Notion databases, pages, and notes',
    serverUrl: 'https://mcp.notion.com/mcp',
    authNote: 'Requires Authorization: Bearer <NOTION_INTEGRATION_TOKEN>',
    apiKeyHeader: 'Authorization: Bearer {key}',
    defaultTool: 'search',
    defaultArgs: { query: '', filter: { value: 'database', property: 'object' }, page_size: 20 },
    defaultTitle: 'Notion',
  },
  {
    name: 'Data Commons',
    icon: '🌍',
    description: 'Google\'s open knowledge graph — global stats on health, economy, demographics, and more',
    serverUrl: 'https://api.datacommons.org/mcp',
    authNote: 'Requires x-api-key: <API_KEY> (free, self-service at apikeys.datacommons.org)',
    apiKeyHeader: 'x-api-key: {key}',
    defaultTool: 'search_indicators',
    defaultArgs: { query: 'GDP per capita' },
    defaultTitle: 'Data Commons',
  },
];

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpPanelSpec {
  id: string;
  title: string;
  serverUrl: string;
  customHeaders: Record<string, string>;
  toolName: string;
  toolArgs: Record<string, unknown>;
  refreshIntervalMs: number;
  createdAt: number;
  updatedAt: number;
}

export function loadMcpPanels(): McpPanelSpec[] {
  return loadFromStorage<McpPanelSpec[]>(STORAGE_KEY, []);
}

export function saveMcpPanel(spec: McpPanelSpec): void {
  const existing = loadMcpPanels().filter(p => p.id !== spec.id);
  const updated = [...existing, spec].slice(-MAX_PANELS);
  saveToStorage(STORAGE_KEY, updated);
}

export function deleteMcpPanel(id: string): void {
  const updated = loadMcpPanels().filter(p => p.id !== id);
  saveToStorage(STORAGE_KEY, updated);
  clearPanelSpanEntry(id);
  clearPanelColSpanEntry(id);
}

export function getMcpPanel(id: string): McpPanelSpec | null {
  return loadMcpPanels().find(p => p.id === id) ?? null;
}
