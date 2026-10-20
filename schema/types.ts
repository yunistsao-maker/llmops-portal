/**
 * LLMOps Model Release Portal — data contract (v1)
 *
 * Source of truth for every JSON file under /data. The JSON Schema in
 * schema/llmops.schema.json is generated from this file:
 *   npx ts-json-schema-generator -p schema/types.ts -t '*' -o schema/llmops.schema.json
 *
 * Conventions
 * - Dates: ISO "YYYY-MM-DD" (ISODate) or full ISO 8601 (ISODateTime).
 * - Money: USD per 1M tokens unless a field says otherwise.
 * - Prose fields are Traditional Chinese (zh-TW) with English technical terms; see `locale` on each root.
 * - Every fact that can go stale carries `sources` (ids into data/sources.json) and `verification`.
 * - Nothing here is a secret. Keys, endpoints and tenant IDs belong in your gateway config, not in these files.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** @pattern ^\d{4}-\d{2}-\d{2}$ */
export type ISODate = string;
/** @format date-time */
export type ISODateTime = string;

export type Locale = "zh-TW" | "en";

export type Cloud = "aws" | "azure" | "gcp" | "vendor-direct";

export type Service =
  | "bedrock"
  | "foundry" // Microsoft Foundry (Azure OpenAI + Foundry Models)
  | "agent-platform" // Gemini Enterprise Agent Platform (formerly Vertex AI)
  | "anthropic-api"
  | "openai-api"
  | "gemini-api";

export type Vendor =
  | "anthropic"
  | "openai"
  | "google"
  | "amazon"
  | "meta"
  | "mistral"
  | "deepseek"
  | "xai"
  | "cohere"
  | "moonshot"
  | "ai21"
  | "twelvelabs"
  | "microsoft"
  | "other";

export type Modality = "text" | "image" | "pdf" | "audio" | "video" | "embedding";

/** CSP-side lifecycle state of a model on one channel. */
export type LifecycleStatus =
  | "announced"
  | "limited-access"
  | "preview"
  | "ga"
  | "legacy"
  | "deprecated"
  | "extended-access"
  | "retired";

/** How much to trust a fact. `derived` = computed by us from other official facts. */
export type Verification = "official" | "independent" | "community" | "derived" | "unverified" | "internal-test";

export type Priority = "P0" | "P1" | "P2";

/** Reference into data/sources.json. */
export interface SourceRef {
  id: string;
  /** Optional pointer inside the source, e.g. a table name or section. */
  note?: string;
}

export interface Source {
  id: string;
  title: string;
  url: string;
  publisher: string;
  type:
    | "vendor-doc"
    | "csp-doc"
    | "vendor-blog"
    | "csp-blog"
    | "benchmark"
    | "news"
    | "community"
    | "regulator"
    | "github"
    | "security-advisory";
  accessed: ISODate;
}

export interface SourcesFile {
  schema: "sources/v1";
  generatedAt: ISODateTime;
  sources: Source[];
}

// ---------------------------------------------------------------------------
// Catalog (research view of models and their CSP routes)
// ---------------------------------------------------------------------------

export interface CatalogFile {
  schema: "catalog/v1";
  generatedAt: ISODateTime;
  locale: Locale;
  /** Research cut-off for everything in this file. */
  asOf: ISODate;
  models: Model[];
  /** Announced or rumoured models we are tracking but cannot onboard yet. */
  watchlist: WatchItem[];
}

/** Internal platform decision for a model (your gateway), not the CSP state. */
export type PlatformStatus =
  | "watch"
  | "evaluating"
  | "beta"
  | "ga"
  | "restricted"
  | "deprecating"
  | "removed"
  | "not-planned";

export interface Model {
  /** Canonical slug, stable across CSPs, e.g. "claude-opus-5-5". */
  id: string;
  name: string;
  vendor: Vendor;
  family: string;
  tier: "frontier" | "balanced" | "efficient" | "specialized";
  /** First public release by the vendor (any channel). */
  releaseDate: ISODate;
  /** Decision on YOUR platform. Seeded as "evaluating" for new models. */
  platformStatus: PlatformStatus;
  predecessorId?: string;
  modalities: { input: Modality[]; output: Modality[] };
  contextWindow: number;
  maxOutputTokens: number;
  knowledgeCutoff?: string;
  reasoning: ReasoningSpec;
  /** Vendor first-party model id (Anthropic API / OpenAI API / Gemini API). */
  vendorModelId?: string;
  systemCardUrl?: string;
  modelCardUrl?: string;
  /** One-paragraph zh-TW summary for list views. */
  summary: string;
  strengths: string[];
  weaknesses: string[];
  bestFor: string[];
  avoidFor: string[];
  safety: SafetyProfile;
  offerings: Offering[];
  benchmarks: BenchmarkResult[];
  performanceReference: PerformanceReference[];
  litellm: LiteLLMModelCompat;
  tags: string[];
  sources: SourceRef[];
  lastVerified: ISODate;
}

export interface ReasoningSpec {
  supported: boolean;
  /** True when thinking cannot be switched off (e.g. Claude Opus 5.5). */
  alwaysOn?: boolean;
  effortLevels?: string[];
  defaultEffort?: string;
  /** Native parameter name(s), e.g. "output_config.effort", "reasoning.effort", "thinking_level". */
  parameter?: string;
  notes?: string[];
}

export interface SafetyProfile {
  /** Vendor risk classification, e.g. "OpenAI Preparedness: Cyber = Critical". */
  classifications: string[];
  /** Behaviours that change what the API returns (refusal routing, watermarking, etc.). */
  behaviours: string[];
  /** Trusted-access programmes relevant to security / life-science teams. */
  programmes: string[];
  sources: SourceRef[];
}

export type InferenceScope =
  | "in-region"
  | "geo"
  | "global"
  | "multi-region"
  | "data-zone"
  | "regional"
  | "vendor-default";

export interface InferenceTarget {
  scope: InferenceScope;
  /** The id you put in `model`, e.g. "jp.anthropic.claude-opus-5-5". */
  id: string;
  /** Human description of where data is processed, e.g. "Japan (ap-northeast-1/3)". */
  geography?: string;
}

export type ApiSurface =
  | "anthropic-messages"
  | "openai-chat-completions"
  | "openai-responses"
  | "bedrock-converse"
  | "bedrock-invoke"
  | "gemini-generate-content"
  | "batch";

export interface ApiEndpointSupport {
  /** e.g. "bedrock-runtime", "bedrock-mantle", "/openai/v1", "/anthropic", "aiplatform (global)". */
  endpoint: string;
  apis: ApiSurface[];
  notes?: string[];
}

export interface RegionAvailability {
  region: string;
  label: string;
  scopes: InferenceScope[];
  note?: string;
}

export type FeatureKey =
  | "streaming"
  | "tool-calling"
  | "forced-tool-choice"
  | "parallel-tool-calls"
  | "structured-outputs"
  | "vision"
  | "pdf-input"
  | "audio-input"
  | "video-input"
  | "prompt-caching"
  | "batch"
  | "reasoning-control"
  | "temperature"
  | "count-tokens"
  | "guardrails"
  | "computer-use"
  | "server-side-tools"
  | "fine-tuning"
  | "provisioned-throughput"
  | "priority-tier"
  | "flex-tier"
  | "fast-mode"
  | "zero-data-retention";

export interface FeatureSupport {
  feature: FeatureKey;
  status: "supported" | "partial" | "not-supported" | "unknown";
  note?: string;
  sources?: SourceRef[];
}

export interface DataProcessing {
  /** Who processes prompts/outputs on this route, e.g. "AWS (Bedrock)" or "Anthropic (independent processor)". */
  processor: string;
  residencyOptions: string[];
  /** Whether any option keeps processing inside Taiwan. */
  taiwanResidency: "yes" | "no" | "unknown";
  zdr: "available" | "on-request" | "not-available" | "unknown";
  retentionNotes: string[];
  sources: SourceRef[];
}

export interface PriceSheet {
  /** e.g. "global", "geo", "in-region", "data-zone-us", "data-zone-eu", "multi-region", "standard". */
  scope: string;
  currency: "USD";
  unit: "per_1m_tokens";
  input: number;
  output: number;
  cacheRead?: number;
  /** Cache write at the default TTL (5 min for Anthropic, 30 min for OpenAI on Bedrock). */
  cacheWrite?: number;
  cacheWrite1h?: number;
  longContext?: {
    thresholdInputTokens: number;
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  batchDiscountPct?: number;
  validFrom?: ISODate;
  /** Promotional price end date. */
  validUntil?: ISODate;
  /** Price that applies after `validUntil`. */
  thereafter?: { input: number; output: number; cacheRead?: number };
  notes?: string[];
  sources: SourceRef[];
  verification: Verification;
}

export interface QuotaNote {
  scope: string;
  rpm?: number;
  inputTpm?: number;
  outputTpm?: number;
  tpm?: number;
  note?: string;
  sources: SourceRef[];
  verification: Verification;
}

export interface OfferingLifecycle {
  eolNoSoonerThan?: ISODate;
  legacyPeriod?: string;
  deprecationDate?: ISODate;
  retirementDate?: ISODate;
  replacement?: string;
  notes?: string[];
}

/** One route: a model on one cloud service. */
export interface Offering {
  /** e.g. "claude-opus-5-5@bedrock". */
  id: string;
  cloud: Cloud;
  service: Service;
  status: LifecycleStatus;
  availableSince?: ISODate;
  providerModelId: string;
  inferenceTargets: InferenceTarget[];
  endpoints: ApiEndpointSupport[];
  /** Regions most relevant to a Taiwan-based enterprise (TW / JP / KR / SG / AU / IN). */
  apacAvailability: RegionAvailability[];
  regionNotes?: string[];
  dataProcessing: DataProcessing;
  features: FeatureSupport[];
  pricing: PriceSheet[];
  quotas: QuotaNote[];
  lifecycle: OfferingLifecycle;
  /** Suggested LiteLLM `litellm_params.model` string. */
  litellmModel?: string;
  onboardingNotes: string[];
  sources: SourceRef[];
  verification: Verification;
}

export interface BenchmarkResult {
  name: string;
  version?: string;
  /** Effort / harness / fallback settings the score was produced under. */
  variant?: string;
  score: number;
  unit: "index" | "percent" | "elo" | "usd";
  rank?: string;
  measuredBy: "vendor" | "independent" | "internal";
  date: ISODate;
  notes?: string;
  sources: SourceRef[];
}

/** External speed/latency reference (e.g. Artificial Analysis). Your own runs go in PerfRun. */
export interface PerformanceReference {
  provider: string;
  variant: string;
  outputTokensPerSec?: number;
  /** Seconds to first token as defined by the source (reasoning models: often includes thinking). */
  ttftSec?: number;
  costPerIndexTaskUsd?: number;
  indexOutputTokensMillions?: number;
  date: ISODate;
  notes?: string;
  sources: SourceRef[];
}

export interface WatchItem {
  name: string;
  vendor: Vendor;
  status: "announced" | "rumoured" | "limited-preview" | "coming-soon";
  expected?: string;
  note: string;
  sources: SourceRef[];
}

// ---------------------------------------------------------------------------
// Open-weight model radar (data/open-models.json)
// Models whose weights can be downloaded (or have been promised), tracked for
// market traction and for where the three CSPs host them. Separate from the
// catalog: an entry here is not an onboarding candidate until the platform
// team says so.
// ---------------------------------------------------------------------------

/**
 * Market traction, judged by the rules published in OpenModelsFile.method.
 * hit = already heavily used; rising = new and gaining; watch = tracked for another reason.
 */
export type OpenModelHeat = "hit" | "rising" | "watch";

export interface OpenModelSignal {
  kind: "openrouter-usage" | "hf-likes" | "hf-downloads" | "hf-trending" | "aa-index" | "press" | "other";
  /** Short human-readable value, e.g. "週用量第 2（28.4T tokens，+36%）". */
  value: string;
  asOf: ISODate;
  sources: SourceRef[];
}

/** One row per CSP service we track. "not-offered" rows are kept on purpose: absence is information. */
export interface OpenModelHosting {
  cloud: Cloud;
  service: Service;
  status: "ga" | "preview" | "restricted" | "not-offered" | "unknown";
  /** Model or inference-profile id on that service, when offered. */
  modelId?: string;
  note?: string;
  sources: SourceRef[];
}

export interface OpenModelWeights {
  /** true when the weights can be downloaded today. */
  available: boolean;
  /** Hugging Face repo ids (or another download location). */
  repos?: string[];
  /** SPDX-style id when standard ("apache-2.0", "mit"), otherwise the vendor's licence name. */
  license?: string;
  /** true when the licence is a vendor-specific text that legal must read before any use. */
  customLicense?: boolean;
  note?: string;
}

export interface OpenModel {
  /** Stable slug, e.g. "reflection-beam". */
  id: string;
  name: string;
  developer: string;
  vendor: Vendor;
  /** Where the developer is headquartered, as commonly reported (matters for procurement rules). */
  origin: string;
  /** First public release or announcement of this version. */
  releaseDate?: ISODate;
  /** released = weights downloadable now; preview = API or early access only, weights promised; announced = neither yet. */
  status: "released" | "preview" | "announced";
  weights: OpenModelWeights;
  /** e.g. "501B（23B active）MoE". */
  size?: string;
  contextWindow?: number;
  modalities: Modality[];
  heat: OpenModelHeat;
  /** One sentence: why this heat level, quoting the signals. */
  heatReason: string;
  summary: string;
  signals: OpenModelSignal[];
  hosting: OpenModelHosting[];
  /** Price points that help compare (CSP list price, vendor API, cost per benchmark task). Free text with units. */
  priceNotes?: string[];
  /** What a platform team should know before saying yes: licence, origin, safety, serving cost. */
  enterpriseNotes: string[];
  sources: SourceRef[];
  verification: Verification;
  lastVerified: ISODate;
}

export interface OpenModelsFile {
  schema: "open-models/v1";
  generatedAt: ISODateTime;
  locale: Locale;
  asOf: ISODate;
  /** How heat is judged and what each signal means; shown on the page. */
  method: string[];
  /** Short market read for this period. */
  marketNotes: string[];
  models: OpenModel[];
}

// ---------------------------------------------------------------------------
// LiteLLM compatibility & gateway security
// ---------------------------------------------------------------------------

export interface LiteLLMModelCompat {
  providerStrings: { service: Service; model: string; note?: string }[];
  /** Oldest version that can route the model when the remote cost map is reloaded. */
  minVersionRouting?: string;
  /** Oldest image with the model in the bundled cost map (LITELLM_LOCAL_MODEL_COST_MAP=true). */
  minVersionBundledCostMap?: string;
  /** Oldest version with correct parameter handling for this model family. */
  minVersionParams?: string;
  recommendedVersion: string;
  caveats: string[];
  configSnippet?: string;
  status: "researched" | "tested-pass" | "tested-partial" | "tested-fail" | "untested";
  sources: SourceRef[];
}

export interface LiteLLMRelease {
  version: string;
  date?: ISODate;
  channel: "stable" | "rc" | "patch";
  highlights: string[];
  /** Inside LiteLLM's "four most recent stable lines" window at `asOf`. */
  supported: boolean;
  caution?: string;
  sources: SourceRef[];
}

export interface SecurityAdvisory {
  id: string;
  title: string;
  affected: string;
  fixedIn?: string;
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  published?: ISODate;
  summary: string;
  action: string;
  sources: SourceRef[];
}

/**
 * What LiteLLM's documentation (and the CSPs' own docs) say about each API surface for each provider route - researched,
 * not measured. The measured counterpart is a gateway-csp run in runs/compat/ (tools/gateway_csp_check.py).
 */
export interface ProviderCompatibility {
  asOf: ISODate;
  providers: { id: string; title: string; litellmPrefix: string; cloud: Cloud; service?: Service; note?: string }[];
  surfaces: { id: GatewaySurface | string; title: string }[];
  cells: {
    provider: string;
    surface: string;
    status: "supported" | "partial" | "not-supported" | "unknown";
    note?: string;
    verification: Verification;
    sources: SourceRef[];
  }[];
  /** Open (or recently closed) upstream issues where a surface breaks for a provider. */
  knownIssues?: { title: string; provider: string; surface: string; state: "open" | "closed"; date?: ISODate; summary: string; sources: SourceRef[] }[];
}

export interface LiteLLMFile {
  schema: "litellm/v1";
  generatedAt: ISODateTime;
  locale: Locale;
  asOf: ISODate;
  supportPolicy: string;
  supportedLines: string[];
  recommended: { version: string; pinning: string; rationale: string[] };
  minimumBaseline: { version: string; rationale: string[] };
  avoid: { versions: string; reason: string; sources: SourceRef[] }[];
  releases: LiteLLMRelease[];
  advisories: SecurityAdvisory[];
  /** Cross-model parameter pitfalls seen through the gateway. */
  knownPitfalls: { title: string; affects: string; symptom: string; fix: string; sources: SourceRef[] }[];
  /** Documented API compatibility per LiteLLM provider route (測試結果 → Gateway → CSP, next to the measured runs). */
  providerCompatibility?: ProviderCompatibility;
  sources: SourceRef[];
}

// ---------------------------------------------------------------------------
// Lifecycle / EOL calendar (all channels, incl. models not in the catalog)
// ---------------------------------------------------------------------------

export type LifecycleEventType =
  | "legacy"
  | "deprecation"
  | "extended-access"
  | "retirement"
  | "eol-no-sooner-than"
  | "price-change";

export interface LifecycleEvent {
  id: string;
  modelName: string;
  vendor: Vendor;
  providerModelId: string;
  version?: string;
  cloud: Cloud;
  service: Service;
  event: LifecycleEventType;
  date: ISODate;
  replacement?: string;
  /** Regions / deployment types the event applies to. */
  scopeNote?: string;
  /**
   * Other published dates for the same event.
   *  - "conflicting": another current official page shows this date. Plan to the earliest
   *    (builders keep `date` = the earliest current date).
   *  - "superseded": an older announcement replaced by the current source. Show as history only
   *    (a reminder that dates move, sometimes earlier) — never count down to it.
   */
  conflicts?: { date: ISODate; kind: "conflicting" | "superseded"; note: string; sources: SourceRef[] }[];
  notes?: string[];
  sources: SourceRef[];
  verification: Verification;
}

export interface LifecycleFile {
  schema: "lifecycle/v1";
  generatedAt: ISODateTime;
  locale: Locale;
  asOf: ISODate;
  policies: { service: Service; summary: string; noticePeriod: string; sources: SourceRef[] }[];
  events: LifecycleEvent[];
}

// ---------------------------------------------------------------------------
// Deep dives & onboarding
// ---------------------------------------------------------------------------

export interface CodeSample {
  lang: "bash" | "python" | "typescript" | "yaml";
  title: string;
  code: string;
}

export interface OnboardingGuide {
  audience: string;
  prerequisites: string[];
  steps: { title: string; detail: string }[];
  /** Stable aliases on your gateway -> concrete targets. */
  aliases: { alias: string; target: string; note?: string }[];
  parameterGuidance: { parameter: string; guidance: string }[];
  codeSamples: CodeSample[];
  dataClassification: string;
  support: string;
}

export interface DeepDive {
  schema: "deep-dive/v1";
  modelId: string;
  title: string;
  locale: Locale;
  asOf: ISODate;
  tldr: string;
  whatsNew: { title: string; detail: string; sources: SourceRef[] }[];
  vsPredecessor?: {
    predecessorId: string;
    changes: { area: string; before: string; after: string; impact: string }[];
  };
  breakingChanges: {
    title: string;
    detail: string;
    migration: string;
    severity: "high" | "medium" | "low";
    sources: SourceRef[];
  }[];
  availabilityMatrix: { cloud: Cloud; service: Service; status: LifecycleStatus | "not-offered"; notes: string }[];
  apiCompatibility: {
    route: string;
    surface: string;
    status: "supported" | "partial" | "not-supported" | "unknown";
    note?: string;
  }[];
  strengths: string[];
  weaknesses: string[];
  bestFor: string[];
  avoidFor: string[];
  safetyAndCompliance: { item: string; detail: string; sources: SourceRef[] }[];
  /** Taiwan-enterprise specific notes: residency, zh-TW quality, regulation. */
  enterpriseNotes: string[];
  testPlanFocus: string[];
  onboarding: OnboardingGuide;
  openQuestions: string[];
  sources: SourceRef[];
}

// ---------------------------------------------------------------------------
// Requirements, release gates
// ---------------------------------------------------------------------------

export interface Requirement {
  id: string;
  title: string;
  origin: "user" | "gap";
  priority: Priority;
  verdict: "critical" | "important" | "nice-to-have";
  why: string;
  howToImplement: string[];
  acceptanceCriteria: string[];
  gate?: string;
  tooling: string[];
  sources: SourceRef[];
}

export interface ReleaseGate {
  id: string;
  name: string;
  owner: string;
  entryCriteria: string[];
  checks: string[];
  exitCriteria: string[];
  evidence: string[];
  requirementIds: string[];
}

export interface RequirementsFile {
  schema: "requirements/v1";
  generatedAt: ISODateTime;
  locale: Locale;
  asOf: ISODate;
  requirements: Requirement[];
  gates: ReleaseGate[];
  /** Standard definitions the portal should display next to performance numbers. */
  metricDefinitions: { metric: string; definition: string; howMeasured: string; pitfalls: string[] }[];
  securityTestCatalog: {
    id: string;
    category: string;
    owasp: string[];
    modaRiskCategory?: string;
    what: string;
    passCriteria: string;
    tools: string[];
  }[];
  sources: SourceRef[];
}

// ---------------------------------------------------------------------------
// Weekly digest (produced by the scheduled research task)
// ---------------------------------------------------------------------------

/**
 * Subject key of a digest entry: the same subject reported on different days carries the same topic and is merged
 * into ONE Release Radar card (latest wording + dated history). Format "<area>:<subject>[:<aspect>]", lowercase, e.g.
 * "pricing:claude-sonnet-5-5", "litellm:recommended-version", "cve:cve-2026-89032",
 * "lifecycle:gemini-api:gemini-3-1-flash-image".
 * @pattern ^[a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9._-]*){1,3}$
 * @maxLength 100
 */
export type RadarTopic = string;

export interface DigestItem {
  title: string;
  date?: ISODate;
  vendor?: Vendor;
  clouds?: Cloud[];
  detail: string;
  impact: "high" | "medium" | "low";
  sources: SourceRef[];
  /**
   * Same subject across days, merged into one Radar card (within the same section). Format
   * "<area>:<subject>[:<aspect>]", lowercase, e.g. "pricing:claude-sonnet-5-5", "litellm:recommended-version",
   * "cve:cve-2026-89032", "lifecycle:gemini-api:gemini-3-1-flash-image".
   */
  topic?: RadarTopic;
  /** true = coverage note ("checked, no change"): the Radar shows it under a separate collapsed block, not as news. */
  check?: boolean;
  /**
   * Exact titles of EARLIER digest entries of the same section that this entry updates; the Radar folds them into this entry.
   * @maxItems 10
   */
  merges?: string[];
}

export interface DigestActionItem {
  priority: Priority;
  action: string;
  due?: ISODate;
  relatedModelIds?: string[];
  /** Same task across days, merged into one Radar action item (same format as DigestItem.topic). */
  topic?: RadarTopic;
  /**
   * Exact `action` texts of EARLIER digest action items that this item updates; the Radar folds them into this item.
   * @maxItems 10
   */
  merges?: string[];
}

export interface DigestFile {
  schema: "digest/v1";
  id: string;
  locale: Locale;
  periodStart: ISODate;
  periodEnd: ISODate;
  generatedAt: ISODateTime;
  headline: string;
  newModels: DigestItem[];
  lifecycleChanges: DigestItem[];
  pricingChanges: DigestItem[];
  litellm: DigestItem[];
  security: DigestItem[];
  regulatory: DigestItem[];
  actionItems: DigestActionItem[];
  watchlist: WatchItem[];
  /** Facts the research job could not verify from a primary source. */
  unverified: string[];
}

// ---------------------------------------------------------------------------
// Release Radar roll-up (data/radar.json) — built by tools/build_radar.py, never by hand
// One current view merged from every digest: the daily digests stay as the immutable
// record of what each run found; the Radar page shows this file only, stamped with the
// newest digest date (the date is the version).
// ---------------------------------------------------------------------------

/** Where a merged entry came from. */
export interface RadarProvenance {
  /** Stable id: a hash of the normalised text (curation merges can point several texts at one id). */
  id: string;
  /** Digest id (date) where the entry first appeared. */
  firstSeen: ISODate;
  /** Newest digest that restated it. */
  lastSeen: ISODate;
  /** Every digest that carried it (oldest first). */
  seenIn: string[];
  /** true when firstSeen equals the roll-up's asOf. */
  isNew: boolean;
}

/** An earlier statement folded into a merged Radar news card (newest first; the card's current wording is not repeated). */
export interface RadarUpdate {
  /** Digest id (date) of the statement. */
  date: ISODate;
  title: string;
  detail?: string;
}

/** An earlier wording of a merged Radar action item (newest first; the item's current wording is not repeated). */
export interface RadarActionUpdate {
  /** Digest id (date) of the statement. */
  date: ISODate;
  action: string;
  priority: Priority;
  due?: ISODate;
}

export interface RadarActionItem extends RadarProvenance {
  priority: Priority;
  action: string;
  due?: ISODate;
  relatedModelIds?: string[];
  /** The subject key the item was merged by (DigestActionItem.topic or radar/curation.json `topics`). */
  topic?: RadarTopic;
  /** Earlier statements folded into this item, newest first, excluding the current one. */
  updates?: RadarActionUpdate[];
  /** "due" = has a due date not yet passed; "open" = no due date, still within the carry window. */
  state: "due" | "open";
}

export interface RadarItem extends Omit<DigestItem, "check" | "merges">, RadarProvenance {
  /** Earlier statements folded into this card, newest first, excluding the current one. */
  updates?: RadarUpdate[];
}

export type RadarSection = "newModels" | "lifecycleChanges" | "pricingChanges" | "litellm" | "security" | "regulatory";

/** A coverage note ("checked, no change"): DigestItem.check, or an entry listed in radar/curation.json `checks`. */
export interface RadarCheck {
  /** The entry's own id (hash of its section and normalised title), for radar/curation.json. */
  id: string;
  /** Digest id (date) of the note. */
  date: ISODate;
  section: RadarSection;
  title: string;
  detail: string;
  sources: SourceRef[];
}

export interface RadarFile {
  schema: "radar/v1";
  generatedAt: ISODateTime;
  locale: Locale;
  /** The version of this view = the newest digest id. */
  asOf: ISODate;
  headline: string;
  /** Earliest periodStart and newest periodEnd of the digests merged. */
  coverage: { start: ISODate; end: ISODate; digests: string[] };
  /** The merge rules in force (shown on the page). */
  rules: string[];
  actionItems: RadarActionItem[];
  /** Action items that dropped out in the last 14 days (expired due date, closed or stale) — shown collapsed. */
  retired: (RadarActionItem & { reason: "expired" | "closed" | "stale"; retiredOn: ISODate; note?: string })[];
  newModels: RadarItem[];
  lifecycleChanges: RadarItem[];
  pricingChanges: RadarItem[];
  litellm: RadarItem[];
  security: RadarItem[];
  regulatory: RadarItem[];
  /**
   * Coverage notes ("checked, no change") of the last 3 digests, newest first; per section only the notes of the newest
   * digest that has any. Never part of the news sections. Shown collapsed.
   */
  checks?: RadarCheck[];
  watchlist: WatchItem[];
  unverified: string[];
}

/** Human / agent decisions the roll-up applies (radar/curation.json — outside data/, which a release replaces). */
export interface RadarCuration {
  schema: "radar-curation/v1";
  /** Several texts that say the same thing: the entries listed in `ids` become one entry with the id `keep` (newest wording wins). */
  merge: { keep: string; ids: string[]; reason: string }[];
  /**
   * Action items done or no longer relevant before their due date. Applies to the item that contains `id` while no other
   * entry merged into it restated the subject after `id`'s last statement.
   */
  close: { id: string; on: ISODate; reason: string }[];
  /** New wording for an action item (e.g. a merged tracker without the models that launched). Ignored once a newer digest restates the item. */
  rewrite?: { id: string; on: ISODate; action: string; priority?: Priority; due?: ISODate | null; reason: string }[];
  /**
   * Topics for entries written before digests carried `topic`: every entry id listed (news "it-…" or action "ai-…";
   * an entry's own id or a card id) gets the topic, so entries of the same subject become one card.
   */
  topics?: { topic: RadarTopic; ids: string[]; reason: string }[];
  /** Legacy news entries that are coverage notes ("checked, no change"), as if they carried `check: true`. */
  checks?: { ids: string[]; reason: string }[];
}

// ---------------------------------------------------------------------------
// Internal test runs (written by tools/*.py) and platform inventory
// ---------------------------------------------------------------------------

export interface Percentiles {
  n: number;
  p50: number | null;
  p90: number | null;
  p99: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
}

/**
 * Why a test was run. "pre-release" = evidence for a release gate before a model (or a gateway change) goes live;
 * the model page's 內部測試 tab shows those first. Older run files have no purpose (shown as 未標示).
 */
export type TestPurpose = "pre-release" | "regression" | "adhoc";

export interface PerfRun {
  schema: "perf-run/v1";
  runId: string;
  startedAt: ISODateTime;
  finishedAt: ISODateTime;
  gateway: string;
  purpose?: TestPurpose;
  /** Catalog model id the run is about (otherwise matched from the route: "<modelId>" or "<modelId>@..."). */
  modelId?: string;
  litellmVersion?: string;
  /** Gateway alias that was called, e.g. "claude-opus-5-5@bedrock-jp". */
  route: string;
  clientLocation?: string;
  profile: {
    name: string;
    approxInputTokens: number;
    maxOutputTokens: number;
    reasoningEffort?: string;
    concurrency: number;
    requests: number;
    stream: boolean;
  };
  /** All latency values are milliseconds; throughput is tokens/second. */
  metrics: {
    ttftMs: Percentiles;
    ttfatMs: Percentiles;
    itlMs: Percentiles;
    ttltMs: Percentiles;
    outputTokensPerSec: Percentiles;
    aggregateOutputTokensPerSec: number;
    requestsPerSec: number;
    errorRate: number;
    errorsByType: Record<string, number>;
    goodputPct?: number;
  };
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number; cachedInputTokens: number };
  slo?: { ttfatMs?: number; ttltMs?: number };
  notes: string[];
}

export interface CompatResult {
  route: string;
  caseId: string;
  status: "pass" | "fail" | "error" | "skip";
  httpStatus?: number;
  latencyMs?: number;
  detail?: string;
  /** gateway-csp runs: the API surface the case belongs to (GatewaySurface). */
  surface?: GatewaySurface;
  /** gateway-csp runs: time to the first streamed content, ms. */
  ttftMs?: number;
  /** gateway-csp runs: the same case sent straight to the CSP endpoint behind the route (the baseline). */
  direct?: { status: "pass" | "fail" | "error" | "skip"; httpStatus?: number; latencyMs?: number; ttftMs?: number; detail?: string };
  /** gateway-csp runs: ok | gateway (fails only through the gateway) | provider (fails on the CSP too) | unknown (no baseline). */
  attribution?: "ok" | "gateway" | "provider" | "unknown";
  /** gateway-csp runs: HTTP 200, but the answer broke the contract (silent degradation). */
  silent?: boolean;
  /** gateway-csp runs: the gateway's x-litellm-* response headers (never a key). */
  headers?: Record<string, string>;
  usage?: { promptTokens?: number | null; completionTokens?: number | null; cachedTokens?: number | null };
}

/** The API surfaces a gateway-csp run groups its cases into (tools/gateway_csp_check.py SURFACES). */
export type GatewaySurface =
  | "chat" | "streaming" | "parameters" | "reasoning" | "tools" | "structured-output" | "vision" | "prompt-caching"
  | "responses-api" | "messages-api" | "error-mapping" | "observability";

export interface LatencyDelta { p50: number | null; p95: number | null; n: number }

/** One route's metrics in a gateway-csp run (definitions: requirements.json metricDefinitions, "Gateway → CSP"). */
export interface GatewayRouteMetrics {
  route: string;
  csp: string;
  service: string;
  applicable: number;
  pass: number;
  compatibilityRate: number | null;
  requiredPassRate: number | null;
  gatewayInduced: number;
  providerLimited: number;
  unattributed: number;
  silentDegradations: number;
  silentDegradationRate: number | null;
  errorMappingRate: number | null;
  costTrackingRate: number | null;
  fallbackRate: number | null;
  overheadMs: LatencyDelta;
  ttftOverheadMs: LatencyDelta;
  promptTokenDeltaPct: number | null;
}

export interface CompatRun {
  schema: "compat-run/v1";
  /** "routes" (tools/compat_suite.py, the default) or "gateway-csp" (tools/gateway_csp_check.py: gateway vs. the CSP itself). */
  kind?: "routes" | "gateway-csp";
  runId: string;
  startedAt: ISODateTime;
  finishedAt: ISODateTime;
  gateway: string;
  purpose?: TestPurpose;
  /** Catalog model ids the run is about (otherwise matched from the routes). */
  modelIds?: string[];
  litellmVersion?: string;
  /** gateway-csp runs: "direct" when the cases also ran straight against the CSP. */
  baseline?: "direct" | "none";
  routes: string[];
  /** gateway-csp runs: where each route goes (the direct baseline as protocol and host only). */
  routeInfo?: { route: string; modelId?: string; csp: string; service: string; region?: string; litellmModel?: string; direct?: { protocol: string; host: string } }[];
  cases: { id: string; title: string; required: boolean; surface?: GatewaySurface }[];
  results: CompatResult[];
  summary: { route: string; pass: number; fail: number; error: number; skip: number; requiredFailures: string[] }[];
  metrics?: {
    byRoute: GatewayRouteMetrics[];
    byCsp: {
      csp: string; routes: number; applicable: number; pass: number; compatibilityRate: number | null; requiredPassRate: number | null;
      gatewayInduced: number; providerLimited: number; silentDegradations: number; errorMappingRate: number | null;
      costTrackingRate: number | null; fallbackRate: number | null; overheadMsP50: number | null;
    }[];
    bySurface: { surface: GatewaySurface; title: string; applicable: number; pass: number; gatewayInduced: number }[];
  };
}

/** One target's result for one security test item (tools/secsuite: aggregate counts only, never prompt or response text). */
export interface SecurityItemResult {
  n: number;
  pass: number;
  fail: number;
  review: number;
  error: number;
  scored: number;
  /** fail / scored (attack success rate or failure rate, per the item's KPI). */
  rate: number | null;
  ciLow?: number | null;
  ciHigh?: number | null;
  verdict: "pass" | "fail" | "review" | "nodata" | "info";
  verdictNote?: string;
  isIncumbent?: boolean;
  [extra: string]: unknown;
}

/** runs/security/<runId>.json: what `sec_suite.py run --publish-summary` writes (G6 AI 安全測試). */
export interface SecurityRunSummary {
  schema: "security-run/v1";
  runId: string;
  startedAt: ISODateTime;
  finishedAt: ISODateTime;
  purpose?: TestPurpose;
  tool?: { name: string; version?: string };
  /** true when the built-in simulator answered instead of a model. */
  simulated: boolean;
  config?: Record<string, unknown>;
  /** label: the column name in results; modelId: the catalog model it stands for (else matched from label / model). */
  targets: { label: string; provider: string; model: string; region?: string | null; effort?: string | null; modelId?: string }[];
  judge?: { label?: string; provider?: string; model?: string } | null;
  /** id = securityTestCatalog id (SEC-01 ...); results keyed by target label ("gateway" for platform items). */
  /** tier A = blocks the model's release when it fails (tools/secsuite/catalog.json). */
  items: {
    id: string;
    title?: string;
    tier?: "A" | "B" | "C" | "D";
    datasets: string[];
    /** what the item tests, how a case is scored, and the pass rule (from the catalog, for the page) */
    methodology?: string;
    scoring?: string;
    rule?: { type: string; threshold?: number };
    ruleText?: string;
    results: Record<string, SecurityItemResult>;
  }[];
  caseCount?: number;
}

/** One case of a security run as published: the text fields are empty for every case of a sensitive dataset. */
export interface SecurityCase {
  item: string;
  dataset: string;
  caseId: string;
  category?: string | null;
  lang?: string | null;
  /** target label (the column of the summary), "gateway" for SEC-16 */
  target: string;
  trial?: number;
  outcome: "pass" | "fail" | "review" | "error" | "info";
  label?: string;
  detail?: string;
  value?: number | null;
  stopReason?: string | null;
  refusalCategory?: string | null;
  /** model id the API reported */
  model?: string | null;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  system?: string | null;
  tools?: string[];
  prompt: { role: string; content: string }[];
  response: string;
  pair?: string | null;
  /** risk of the dataset (tools/secsuite/manifest.json); anything but none / low is never shown as text */
  risk: "none" | "low" | "medium" | "medium-high" | "high" | "highest" | "unknown";
  redacted: boolean;
}

/** runs/security/<runId>.cases.json: `sec_suite.py publish` - only the full portal shows it; the clean build leaves it out. */
export interface SecurityRunCases {
  schema: "security-cases/v1";
  runId: string;
  /** always true: the cases were redacted for a page many people can open */
  public: true;
  cases: SecurityCase[];
}

export interface InventoryDeployment {
  /** LiteLLM model_name (what apps call). */
  modelName: string;
  /** litellm_params.model with secrets removed. */
  litellmModel: string;
  catalogModelId?: string;
  matchedProviderModelId?: string;
  lifecycle?: { status?: string; nextEvent?: string; nextEventDate?: ISODate; replacement?: string };
  daysToNextEvent?: number;
  risk: "ok" | "watch" | "act-now" | "retired" | "unknown";
}

export interface PlatformInventory {
  schema: "platform-inventory/v1";
  generatedAt: ISODateTime;
  gateway: string;
  litellmVersion?: string;
  deployments: InventoryDeployment[];
}
