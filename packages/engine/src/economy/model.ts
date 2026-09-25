// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The player's economy (DESIGN.md §4.3): a simplified macro model, not general
 * equilibrium. Four sectors produce with Y = A·K^α·(H·L)^(1−α); labour comes from the
 * demography model; productivity grows with mild catch-up; a mean-reverting output gap
 * drives unemployment (Okun) and inflation (Phillips curve with slowly anchoring
 * expectations); a Taylor rule sets the policy rate; public finance accumulates debt;
 * the price level and exchange rate move with income and inflation.
 *
 * Real values are in PPP dollars at the start year's prices (the Factbook's constant
 * 2021 dollars); nominal values are in the world reference currency.
 */

import { detExp, detLog } from '../random/detmath.ts';
import type { NationStats } from '../worldgen/nation-stats.ts';

export const SECTORS = ['agriculture', 'industry', 'services', 'public'] as const;
export const AGRICULTURE = 0;
export const INDUSTRY = 1;
export const SERVICES = 2;
export const PUBLIC = 3;

export const ECONOMY_TUNING = {
  /** Capital share of income. */
  alpha: 0.35,
  /** Capital depreciation per year. */
  depreciation: 0.05,
  /** Mincerian return to a year of schooling. */
  schoolingReturn: 0.08,
  /**
   * Frontier growth of income per person per year from productivity (rising schooling adds
   * more through human capital), and extra growth per unit of log(frontier income / own
   * income). Productivity grows at (1 − α) times these, since
   * capital deepening follows productivity.
   */
  frontierGrowth: 0.009,
  catchUp: 0.004,
  /** GDP per person (PPP) treated as the frontier for catch-up. */
  frontierIncome: 60_000,
  /** Half-life (years) of the country-specific growth residual. */
  residualHalfLife: 5,
  /** Natural unemployment drifts toward this rate (%), with this half-life (years). */
  normalUnemployment: 6,
  unemploymentHalfLife: 25,
  /** Monthly persistence and shock size of the output gap. */
  gapPersistence: 0.97,
  gapShock: 0.004,
  /** Okun: unemployment points per point of output gap. */
  okun: 0.5,
  /** Phillips curve: inflation points per point of output gap. */
  phillips: 0.3,
  /** Inflation target, %/yr, and how fast expectations anchor to it (per year). */
  inflationTarget: 2.5,
  anchoring: 0.15,
  /** Neutral real interest rate, %. */
  neutralRate: 2,
  /** World (reference currency) inflation, %/yr. */
  worldInflation: 2.5,
  /** Price level elasticity to income (Balassa–Samuelson). */
  priceLevelElasticity: 0.3,
  /** Fiscal rule: primary balance target rises 0.06 points per point of debt above 60%. */
  debtAnchor: 60,
  debtResponse: 0.06,
  /** Months over which spending closes the gap to the fiscal rule. */
  fiscalAdjustmentMonths: 60,
  /** Risk premium on government debt per point of debt/GDP above the anchor, %, capped. */
  riskPremium: 0.03,
  maxRiskPremium: 15,
  maxDebtRate: 40,
  /**
   * Sovereign default: above this debt (% of GDP) the government restructures, writing off
   * this share of the debt, and pays this extra rate (points) as markets punish it.
   */
  defaultThreshold: 250,
  defaultHaircut: 0.5,
  defaultPenalty: 5,
  /** Relative labour productivity: industry, services, public (agriculture from income). */
  productivity: [0, 1.3, 1, 0.9],
  /** Target industry share of GDP (%), and yearly drift toward the targets. */
  industryTarget: 27,
  structuralDrift: 0.02,
  /** Income elasticities fed to demography (fertility, mortality). */
  fertilityIncomeElasticity: -0.15,
  mortalityIncomeElasticity: -0.25,
} as const;

const T = ECONOMY_TUNING;
const MONTHS = 12;

/** x^a for x > 0, deterministically. */
function pow(x: number, a: number): number {
  return x > 0 ? detExp(a * detLog(x)) : 0;
}

export interface SectorState {
  capital: number;
  tfp: number;
  /** Share of employment. */
  employment: number;
}

export interface EconomyState {
  sectors: SectorState[];
  /** Output of each sector last month, annualized (real PPP dollars). */
  output: number[];
  /** Real GDP at the start (for income feedback) and population then. */
  readonly startGdp: number;
  readonly startPopulation: number;
  /** Starting price level and GDP per person (for the Balassa–Samuelson drift). */
  readonly startPriceLevel: number;
  readonly startIncome: number;
  priceLevel: number;
  /** Consumer price index, 1 at the start. */
  cpi: number;
  /** World reference-currency price index, 1 at the start. */
  worldPrices: number;
  /** Local currency per reference unit, 1 at the start. */
  exchangeIndex: number;
  inflation: number;
  expectedInflation: number;
  interestRate: number;
  /** Output gap as a fraction of potential. */
  outputGap: number;
  unemployment: number;
  naturalUnemployment: number;
  /** % of people 15+. */
  participation: number;
  /** Shares of GDP, %. */
  investmentShare: number;
  governmentConsumptionShare: number;
  revenueShare: number;
  primarySpendingShare: number;
  exportsShare: number;
  importsShare: number;
  gini: number;
  /** Public debt, reference currency. */
  debt: number;
  /** Effective interest rate on the debt, %. */
  debtRate: number;
  /** Country-specific productivity growth, per year (decays). */
  growthResidual: number;
  /** Nominal GDP, revenues, spending, and interest over the last month, annualized. */
  nominalGdp: number;
  interest: number;
  /** Deviation of sector output shares from their income targets at the start (decays). */
  structuralOffset: number[];
}

/** What the economy reads from demography each month. */
export interface LaborInputs {
  readonly population: number;
  /** People aged 15+. */
  readonly adults: number;
  /** Mean years of schooling of people 25–64. */
  readonly schoolingYears: number;
  /** People aged 10–14, who will join the adult population within five years. */
  readonly nearlyAdult?: number;
}

/** Yearly adult death rate assumed when estimating workforce growth at calibration. */
const ADULT_MORTALITY = 0.01;

export interface MonthPolicy {
  /** Multiplier on productivity (e.g. institutions, infrastructure, war damage). */
  readonly productivity: number;
  /** Additions, in points of GDP or percentage points. */
  readonly revenueShare: number;
  readonly spendingShare: number;
  readonly investmentShare: number;
  readonly participation: number;
  readonly naturalUnemployment: number;
  /** Demand shock added to the output gap this month (fraction). */
  readonly demandShock: number;
}

export const NO_POLICY: MonthPolicy = {
  productivity: 1,
  revenueShare: 0,
  spendingShare: 0,
  investmentShare: 0,
  participation: 0,
  naturalUnemployment: 0,
  demandShock: 0,
};

function stat(stats: NationStats, id: string, fallback: number): number {
  const v = stats[id];
  return v === undefined || !Number.isFinite(v) ? fallback : v;
}

function humanCapital(schoolingYears: number): number {
  return detExp(T.schoolingReturn * schoolingYears);
}

/** Relative labour productivity of agriculture: low in poor countries. */
function agricultureProductivity(income: number): number {
  return 0.35 + 0.5 * Math.min(1, income / T.frontierIncome);
}

/** Output shares (%) that income alone would suggest: agriculture falls as income rises. */
export function structuralTargets(income: number, publicShare: number): number[] {
  const agriculture = Math.min(45, 70_000 / Math.max(500, income));
  const industry = T.industryTarget;
  const services = Math.max(5, 100 - agriculture - industry - publicShare);
  const total = agriculture + industry + services + publicShare;
  return [agriculture, industry, services, publicShare].map((x) => (100 * x) / total);
}

function employmentShares(outputShares: readonly number[], income: number): number[] {
  const productivity = [agricultureProductivity(income), ...T.productivity.slice(1)];
  const raw = outputShares.map((s, k) => s / (productivity[k] as number));
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => x / total);
}

/** Growth of income per person per year that productivity alone would bring. */
function baseGrowth(income: number): number {
  const gap = detLog(T.frontierIncome / Math.max(500, income));
  return Math.max(0, Math.min(0.04, T.frontierGrowth + T.catchUp * Math.max(0, gap)));
}

/**
 * The starting economy, calibrated so GDP per person, sector shares, unemployment,
 * inflation, public finance, and trade match the nation's sampled statistics.
 */
export function calibrateEconomy(stats: NationStats, labor: LaborInputs): EconomyState {
  const income = stat(stats, 'economy.gdp_per_capita_ppp', 15_000);
  const gdp = income * labor.population;
  const agriculture = stat(stats, 'economy.sector_agriculture', 8);
  const industry = stat(stats, 'economy.sector_industry', 25);
  const servicesAll = Math.max(10, stat(stats, 'economy.sector_services', 60));
  const governmentConsumption = stat(stats, 'economy.government_consumption_share', 16);
  const publicShare = Math.min(0.8 * servicesAll, governmentConsumption);
  const rawShares = [agriculture, industry, servicesAll - publicShare, publicShare];
  const shareTotal = rawShares.reduce((a, b) => a + b, 0);
  const outputShares = rawShares.map((s) => s / shareTotal);

  const participation = stat(stats, 'economy.labor_participation', 60);
  const unemployment = Math.max(0.5, Math.min(40, stat(stats, 'economy.unemployment', 6)));
  const employed = labor.adults * (participation / 100) * (1 - unemployment / 100);
  const employment = employmentShares(outputShares, income);
  const investmentShare = Math.max(5, Math.min(45, stat(stats, 'economy.investment_share', 22)));
  const growth = stat(stats, 'economy.gdp_growth', 3) / 100;
  const populationGrowth = stat(stats, 'population.growth_rate', 1) / 100;
  const capitalOutput = Math.max(
    1.5,
    Math.min(4, investmentShare / 100 / (T.depreciation + Math.max(0.005, growth))),
  );
  const h = humanCapital(labor.schoolingYears);

  const sectors: SectorState[] = outputShares.map((share, k) => {
    const output = share * gdp;
    const capital = capitalOutput * output;
    const labour = Math.max(1, h * (employment[k] as number) * employed);
    const tfp = output / (pow(capital, T.alpha) * pow(labour, 1 - T.alpha));
    return { capital, tfp, employment: employment[k] as number };
  });

  const inflation = Math.max(-5, Math.min(200, stat(stats, 'economy.inflation', 3)));
  const priceLevel = Math.max(0.1, stat(stats, 'economy.price_level', 0.5));
  const nominalGdp = gdp * priceLevel;
  const debtShare = Math.max(0, stat(stats, 'economy.public_debt', 50));
  const revenueShare = stat(stats, 'economy.revenue_share_gdp', 25);
  const balance = stat(stats, 'economy.budget_balance_share', -2);
  // Debt is held in the reference currency, so it pays a real rate plus world inflation
  // (local inflation shows up in the exchange rate instead), plus any risk premium.
  const debtRate =
    T.neutralRate +
    T.worldInflation +
    Math.min(T.maxRiskPremium, T.riskPremium * Math.max(0, debtShare - T.debtAnchor));
  // Interest as a share of GDP (%): debt share × rate.
  const interestShare = (debtShare * debtRate) / 100;
  const targets = structuralTargets(income, (100 * publicShare) / shareTotal);

  return {
    sectors,
    output: outputShares.map((s) => s * gdp),
    startGdp: gdp,
    startPopulation: labor.population,
    startPriceLevel: priceLevel,
    startIncome: income,
    priceLevel,
    cpi: 1,
    worldPrices: 1,
    exchangeIndex: 1,
    inflation,
    expectedInflation: inflation,
    interestRate: Math.max(0, T.neutralRate + inflation + 0.5 * (inflation - T.inflationTarget)),
    outputGap: 0,
    unemployment,
    naturalUnemployment: unemployment,
    participation,
    investmentShare,
    governmentConsumptionShare: governmentConsumption,
    revenueShare,
    // Revenue − primary spending − interest = balance.
    primarySpendingShare: Math.max(0, revenueShare - balance - interestShare),
    exportsShare: stat(stats, 'economy.exports_share_gdp', 35),
    importsShare: stat(stats, 'economy.imports_share_gdp', 40),
    gini: stat(stats, 'economy.gini', 35),
    debt: (debtShare / 100) * nominalGdp,
    debtRate,
    // Per-person growth the model wouldn't produce on its own, fading over a few years:
    // productivity, plus the labour share of adults growing faster than the population
    // (large youth cohorts coming of age), must add up to the sampled growth.
    growthResidual: Math.max(
      -0.03,
      Math.min(
        0.03,
        growth -
          populationGrowth -
          baseGrowth(income) -
          (1 - T.alpha) *
            ((labor.nearlyAdult ?? 0) / 5 / Math.max(1, labor.adults) -
              ADULT_MORTALITY -
              populationGrowth),
      ),
    ),
    nominalGdp,
    interest: (debtShare / 100) * nominalGdp * (debtRate / 100),
    structuralOffset: outputShares.map((s, k) => 100 * s - (targets[k] as number)),
  };
}

/** Real GDP (annualized PPP dollars) under current capital, labour, and productivity. */
function potential(state: EconomyState, employed: number, h: number): number[] {
  return state.sectors.map(
    (s) =>
      s.tfp * pow(s.capital, T.alpha) * pow(Math.max(1, h * s.employment * employed), 1 - T.alpha),
  );
}

export function realGdp(state: EconomyState): number {
  return state.output.reduce((a, b) => a + b, 0);
}

export interface MonthResult {
  /** The government defaulted on its debt this month. */
  readonly defaulted: boolean;
  readonly gdp: number;
  readonly employed: number;
  readonly laborForce: number;
  readonly revenue: number;
  readonly spending: number;
  readonly balance: number;
}

/**
 * One month. `shock` is a standard normal draw for the business cycle (from the
 * economy's sim stream).
 */
export function stepEconomy(
  state: EconomyState,
  labor: LaborInputs,
  policy: MonthPolicy,
  shock: number,
): MonthResult {
  // Business cycle.
  state.outputGap = T.gapPersistence * state.outputGap + T.gapShock * shock + policy.demandShock;
  state.outputGap = Math.max(-0.25, Math.min(0.15, state.outputGap));

  // Labour.
  const participation = Math.max(20, Math.min(95, state.participation + policy.participation));
  state.naturalUnemployment +=
    (T.normalUnemployment - state.naturalUnemployment) *
    (1 - detExp(-Math.LN2 / (T.unemploymentHalfLife * MONTHS)));
  const natural = Math.max(1, state.naturalUnemployment + policy.naturalUnemployment);
  state.unemployment = Math.max(0.5, Math.min(50, natural - T.okun * 100 * state.outputGap));
  const laborForce = labor.adults * (participation / 100);
  const employed = laborForce * (1 - state.unemployment / 100);
  const h = humanCapital(labor.schoolingYears);

  // Structural change: employment drifts toward the shares income suggests.
  const gdpBefore = realGdp(state);
  const income = gdpBefore / Math.max(1, labor.population);
  const publicShare = (100 * (state.output[PUBLIC] as number)) / Math.max(1, gdpBefore);
  const targets = structuralTargets(income, publicShare).map(
    (t, k) => t + (state.structuralOffset[k] as number),
  );
  const targetEmployment = employmentShares(
    targets.map((t) => Math.max(0.1, t)),
    income,
  );
  state.sectors.forEach((s, k) => {
    s.employment += ((targetEmployment[k] as number) - s.employment) * (T.structuralDrift / MONTHS);
  });
  const decay = detExp(-1 / (20 * MONTHS));
  state.structuralOffset = state.structuralOffset.map((o) => o * decay);

  // Productivity (labour-augmenting: per-person growth × (1 − α)).
  const growth = ((1 - T.alpha) * (baseGrowth(income) + state.growthResidual)) / MONTHS;
  for (const s of state.sectors) s.tfp *= detExp(growth);
  state.growthResidual *= detExp(-Math.LN2 / (T.residualHalfLife * MONTHS));

  // Output.
  const potentialOutput = potential(state, employed, h).map((y) => y * policy.productivity);
  state.output = potentialOutput.map((y) => y * (1 + state.outputGap));
  const gdp = realGdp(state);

  // Investment accumulates capital, allocated by output share.
  const investmentShare = Math.max(2, Math.min(50, state.investmentShare + policy.investmentShare));
  const investment = (investmentShare / 100) * gdp;
  state.sectors.forEach((s, k) => {
    const share = (state.output[k] as number) / Math.max(1, gdp);
    s.capital += (investment * share - T.depreciation * s.capital) / MONTHS;
  });

  // Prices: expectations anchor slowly; the gap moves inflation.
  state.expectedInflation += ((T.inflationTarget - state.expectedInflation) * T.anchoring) / MONTHS;
  state.inflation = state.expectedInflation + T.phillips * 100 * state.outputGap;
  state.cpi *= detExp(detLog(1 + Math.max(-0.5, state.inflation / 100)) / MONTHS);
  state.worldPrices *= detExp(detLog(1 + T.worldInflation / 100) / MONTHS);
  state.interestRate = Math.max(
    0,
    T.neutralRate +
      state.inflation +
      0.5 * (state.inflation - T.inflationTarget) +
      0.5 * 100 * state.outputGap,
  );

  // Price level (Balassa–Samuelson) and the exchange rate.
  const incomeNow = gdp / Math.max(1, labor.population);
  const previousLevel = state.priceLevel;
  state.priceLevel =
    state.startPriceLevel * pow(incomeNow / state.startIncome, T.priceLevelElasticity);
  // Local currency per reference unit moves with relative inflation, less real appreciation.
  state.exchangeIndex *=
    detExp(
      (detLog(1 + Math.max(-0.5, state.inflation / 100)) - detLog(1 + T.worldInflation / 100)) /
        MONTHS,
    ) *
    (previousLevel / state.priceLevel);

  // Public finance (annualized flows in the reference currency).
  state.nominalGdp = gdp * state.priceLevel * state.worldPrices;
  const debtShare = (100 * state.debt) / Math.max(1, state.nominalGdp);
  const marketRate =
    state.interestRate -
    state.inflation +
    T.worldInflation +
    Math.min(T.maxRiskPremium, T.riskPremium * Math.max(0, debtShare - T.debtAnchor));
  state.debtRate = Math.min(
    T.maxDebtRate,
    state.debtRate + (marketRate - state.debtRate) / (5 * MONTHS),
  );
  const revenueShare = Math.max(1, state.revenueShare + policy.revenueShare);
  const target = revenueShare - T.debtResponse * (debtShare - T.debtAnchor);
  state.primarySpendingShare +=
    (Math.max(0, target) - state.primarySpendingShare) / T.fiscalAdjustmentMonths;
  const primarySpendingShare = Math.max(0, state.primarySpendingShare + policy.spendingShare);
  const revenue = (revenueShare / 100) * state.nominalGdp;
  state.interest = state.debt * (state.debtRate / 100);
  const spending = (primarySpendingShare / 100) * state.nominalGdp + state.interest;
  const balance = revenue - spending;
  state.debt = Math.max(0, state.debt - balance / MONTHS);

  const defaulted = (100 * state.debt) / Math.max(1, state.nominalGdp) > T.defaultThreshold;
  if (defaulted) {
    state.debt *= 1 - T.defaultHaircut;
    state.debtRate = Math.min(T.maxDebtRate, state.debtRate + T.defaultPenalty);
  }

  return { defaulted, gdp, employed, laborForce, revenue, spending, balance };
}

/** Sector shares of GDP (%), with public folded into services as the Factbook does. */
export function sectorShares(state: EconomyState): {
  agriculture: number;
  industry: number;
  services: number;
} {
  const gdp = Math.max(1, realGdp(state));
  const share = (k: number) => (100 * (state.output[k] as number)) / gdp;
  return {
    agriculture: share(AGRICULTURE),
    industry: share(INDUSTRY),
    services: share(SERVICES) + share(PUBLIC),
  };
}

/** Multipliers demography should apply for income changes since the start. */
export function incomeFeedback(
  state: EconomyState,
  population: number,
): { fertility: number; mortality: number } {
  const income = realGdp(state) / Math.max(1, population);
  const ratio = income / (state.startGdp / Math.max(1, state.startPopulation));
  return {
    fertility: pow(ratio, T.fertilityIncomeElasticity),
    mortality: pow(ratio, T.mortalityIncomeElasticity),
  };
}
