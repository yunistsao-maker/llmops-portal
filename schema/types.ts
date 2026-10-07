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

export interface DigestItem {
  title: string;
  date?: ISODate;
  vendor?: Vendor;
  clouds?: Cloud[];
  detail: string;
  impact: "high" | "medium" | "low";
  sources: SourceRef[];
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
  actionItems: { priority: Priority; action: string; due?: ISODate; relatedModelIds?: string[] }[];
  watchlist: WatchItem[];
  /** Facts the research job could not verify from a primary source. */
  unverified: string[];
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

export interface PerfRun {
  schema: "perf-run/v1";
  runId: string;
  startedAt: ISODateTime;
  finishedAt: ISODateTime;
  gateway: string;
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
}

export interface CompatRun {
  schema: "compat-run/v1";
  runId: string;
  startedAt: ISODateTime;
  finishedAt: ISODateTime;
  gateway: string;
  litellmVersion?: string;
  routes: string[];
  cases: { id: string; title: string; required: boolean }[];
  results: CompatResult[];
  summary: { route: string; pass: number; fail: number; error: number; skip: number; requiredFailures: string[] }[];
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
