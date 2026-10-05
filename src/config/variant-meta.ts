export interface VariantMeta {
  title: string;
  description: string;
  keywords: string;
  url: string;
  siteName: string;
  shortName: string;
  subject: string;
  classification: string;
  categories: string[];
  features: string[];
}

export const VARIANT_META: { full: VariantMeta; [k: string]: VariantMeta } = {
  full: {
    // Product name plus legal entity — by construction untranslatable, so the
    // shell title lives here (single source for document.title, the built
    // <title>, and the PWA manifest name), NOT in the locale files.
    title: 'the-synactic: Praxen Development & Engineering',
    description: 'Real-time global intelligence: conflicts, markets, military, OSINT signals — live in 190+ countries; structural resilience ranked for 170, in one view.',
    keywords: 'AI intelligence, AI-powered dashboard, global intelligence, geopolitical dashboard, world news, market data, military bases, nuclear facilities, undersea cables, conflict zones, real-time monitoring, situation awareness, OSINT, flight tracking, AIS ships, earthquake monitor, protest tracker, power outages, oil prices, government spending, polymarket predictions',
    url: 'https://www.worldmonitor.app/dashboard',
    siteName: 'the-synactic',
    shortName: 'the-synactic',
    subject: 'AI-Powered Global Intelligence and Situation Awareness',
    classification: 'AI Intelligence Dashboard, OSINT Tool, News Aggregator',
    categories: ['news', 'productivity'],
    features: [
      'Real-time news aggregation',
      'Stock market tracking',
      'Military flight monitoring',
      'Ship AIS tracking',
      'Earthquake alerts',
      'Protest tracking',
      'Power outage monitoring',
      'Oil price analytics',
      'Government spending data',
      'Prediction markets',
      'Infrastructure monitoring',
      'Geopolitical intelligence',
    ],
  },
  tech: {
    title: 'Tech Monitor - Real-Time AI & Tech Industry Dashboard',
    description: 'Real-time AI and tech industry dashboard tracking tech giants, AI labs, startup ecosystems, funding rounds, and technology events worldwide with live context.',
    keywords: 'tech dashboard, AI industry, startup ecosystem, tech companies, AI labs, venture capital, tech events, tech conferences, cloud infrastructure, datacenters, tech layoffs, funding rounds, unicorns, FAANG, tech HQ, accelerators, Y Combinator, tech news',
    url: 'https://tech.worldmonitor.app/dashboard',
    siteName: 'Tech Monitor',
    shortName: 'TechMonitor',
    subject: 'AI, Tech Industry, and Startup Ecosystem Intelligence',
    classification: 'Tech Dashboard, AI Tracker, Startup Intelligence',
    categories: ['news', 'business'],
    features: [
      'Tech news aggregation',
      'AI lab tracking',
      'Startup ecosystem mapping',
      'Tech HQ locations',
      'Conference & event calendar',
      'Cloud infrastructure monitoring',
      'Datacenter mapping',
      'Tech layoff tracking',
      'Funding round analytics',
      'Tech stock tracking',
      'Service status monitoring',
    ],
  },
  happy: {
    title: 'Happy Monitor - Good News & Global Progress',
    description: 'Curated positive news, global progress data, science breakthroughs, conservation wins, and uplifting stories from around the world with daily highlights.',
    keywords: 'good news, positive news, global progress, happy news, uplifting stories, human achievement, science breakthroughs, conservation wins',
    url: 'https://happy.worldmonitor.app/dashboard',
    siteName: 'Happy Monitor',
    shortName: 'HappyMonitor',
    subject: 'Good News, Global Progress, and Human Achievement',
    classification: 'Positive News Dashboard, Progress Tracker',
    categories: ['news', 'lifestyle'],
    features: [
      'Curated positive news',
      'Global progress tracking',
      'Live humanity counters',
      'Science breakthrough feed',
      'Conservation tracker',
      'Renewable energy dashboard',
    ],
  },
  finance: {
    title: 'Finance Monitor - Real-Time Markets & Trading Dashboard',
    description: 'Real-time finance and trading dashboard tracking global markets, stock exchanges, central banks, commodities, forex, crypto, and economic indicators worldwide.',
    keywords: 'finance dashboard, trading dashboard, stock market, forex, commodities, central banks, crypto, economic indicators, market news, financial centers, stock exchanges, bonds, derivatives, fintech, hedge funds, IPO tracker, market analysis',
    url: 'https://finance.worldmonitor.app/dashboard',
    siteName: 'Finance Monitor',
    shortName: 'FinanceMonitor',
    subject: 'Global Markets, Trading, and Financial Intelligence',
    classification: 'Finance Dashboard, Market Tracker, Trading Intelligence',
    categories: ['finance', 'news'],
    features: [
      'Real-time market data',
      'Stock exchange mapping',
      'Central bank monitoring',
      'Commodity price tracking',
      'Forex & currency news',
      'Crypto & digital assets',
      'Economic indicator alerts',
      'IPO & earnings tracking',
      'Financial center mapping',
      'Sector heatmap',
      'Market radar signals',
    ],
  },
  commodity: {
    title: 'Commodity Monitor - Real-Time Commodity Markets & Supply Chain Dashboard',
    description: 'Real-time commodity markets dashboard tracking mining sites, processing plants, commodity ports, supply chains, and global trade flows with live context.',
    keywords: 'commodity dashboard, mining sites, processing plants, commodity ports, supply chain, commodity markets, oil, gas, metals, agriculture, mining operations, commodity trade, logistics, infrastructure, resource tracking, commodity prices, futures markets',
    url: 'https://commodity.worldmonitor.app/dashboard',
    siteName: 'Commodity Monitor',
    shortName: 'CommodityMonitor',
    subject: 'Commodity Markets, Mining, and Supply Chain Intelligence',
    classification: 'Commodity Dashboard, Supply Chain Tracker, Resource Intelligence',
    categories: ['finance', 'business'],
    features: [
      'Mining site tracking',
      'Processing plant monitoring',
      'Commodity port mapping',
      'Supply chain visualization',
      'Commodity price tracking',
      'Trade flow analysis',
      'Resource extraction monitoring',
      'Logistics infrastructure',
      'Commodity market news',
      'Futures market data',
    ],
  },
  energy: {
    title: 'Energy Atlas - Real-Time Global Energy Intelligence Dashboard',
    description: 'Real-time global energy atlas tracking oil and gas pipelines, storage facilities, chokepoints, fuel shortages, tanker flows, and disruption events worldwide.',
    keywords: 'energy dashboard, oil pipeline tracker, gas pipeline map, LNG terminals, gas storage map, oil storage, SPR tracker, Strait of Hormuz, chokepoint monitor, fuel shortage tracker, pipeline disruption, energy crisis, OPEC, tanker tracking, energy infrastructure, natural gas storage, crude oil inventories, IEA oil stocks, days of cover, energy sanctions, petroleum, diesel, jet fuel, heating oil',
    url: 'https://energy.worldmonitor.app/dashboard',
    siteName: 'Energy Atlas',
    shortName: 'EnergyAtlas',
    subject: 'Global Energy Infrastructure, Supply, and Disruption Intelligence',
    classification: 'Energy Dashboard, Pipeline Tracker, Supply Disruption Monitor',
    categories: ['news', 'business'],
    features: [
      'Oil & gas pipeline registry with live status',
      'Storage facility map (UGS, LNG, SPR, tank farms)',
      'Chokepoint flow monitoring (Hormuz, Suez, Malacca, Bab el-Mandeb)',
      'Fuel shortage alerts (jet, petrol, diesel, heating oil)',
      'Pipeline & storage disruption timeline',
      'Oil & gas inventories (EU gas, US SPR, IEA stocks)',
      'Retail fuel prices by country',
      'Energy crisis policy tracker',
      'Evidence-based status badges with public revision log',
      'Country energy exposure drill-down',
    ],
  },
  trader: {
    title: 'Trader Monitor - Market Context & Geopolitical Signal Dashboard',
    description: 'Read-only trading context dashboard: live markets, macro regime and positioning signals, prediction markets, and the geopolitical, sanctions and supply-chain baseline a price feed cannot supply.',
    keywords: 'trading dashboard, market context, macro regime, market breadth, fear and greed, prediction markets, polymarket, sector heatmap, sanctions exposure, supply chain risk, chokepoint monitor, commodity hubs, stock exchanges, central banks, financial centers, crypto spot, market intelligence, OSINT for traders',
    // LOCAL-ONLY VARIANT — deliberately a loopback origin, unlike its siblings.
    // Trader mode is scoped by the charter (CONTEXT.md boundary 1, v7) to a
    // self-host dashboard plus MCP surface. There is no public subdomain, and
    // claiming one under worldmonitor.app would assert hosting on UPSTREAM's
    // domain that this fork neither controls nor serves.
    //
    // The deploy-config guardrails harvest secure variant origins out of this
    // file and then require vercel.json rewrites, a middleware host mapping,
    // crawler-stub copy, and CSP frame ancestry for each one — none of which
    // exist for trader, or should. Keeping the scheme non-secure is what opts
    // this entry out. Publishing trader means adding all of that and promoting
    // this origin in the same change.
    //
    // Do NOT write an example secure origin into this comment: those harvesters
    // regex the raw file, so a sample would be parsed as a real variant host.
    url: 'http://localhost:3000/dashboard',
    siteName: 'Trader Monitor',
    shortName: 'TraderMonitor',
    subject: 'Market Context and Geopolitical Signal Intelligence for Traders',
    classification: 'Trading Context Dashboard, Market Intelligence, Read-Only Signal Monitor',
    categories: ['finance', 'news'],
    features: [
      'Live market data across equities, commodities and crypto spot',
      'Macro regime and market-stress signals',
      'Fear & Greed and sector heatmap',
      'Prediction-market pricing',
      'Sanctions and supply-chain exposure',
      'Chokepoint, tanker and trade-route monitoring',
      'Stock exchange, central bank and financial centre mapping',
      'Power and internet outage tracking',
      'AI market insights and implications',
      'Read-only by design — execution lives in downstream systems',
    ],
  },
};
