#!/usr/bin/env bun

/**
 * Generate TypeScript bindings for contracts
 *
 * Generates type-safe client bindings from deployed contracts
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { readEnvFile, getEnvValue } from "./utils/env";
import { getWorkspaceContracts, listContractNames, selectContracts } from "./utils/contracts";

function usage() {
  console.log(`
Usage: bun run bindings [contract-name...]

Examples:
  bun run bindings
  bun run bindings number-guess
  bun run bindings twenty-one number-guess
`);
}

console.log("📦 Generating TypeScript bindings...\n");

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const contracts = await getWorkspaceContracts();
const selection = selectContracts(contracts, args);
if (selection.unknown.length > 0 || selection.ambiguous.length > 0) {
  console.error("❌ Error: Unknown or ambiguous contract names.");
  if (selection.unknown.length > 0) {
    console.error("Unknown:");
    for (const name of selection.unknown) console.error(`  - ${name}`);
  }
  if (selection.ambiguous.length > 0) {
    console.error("Ambiguous:");
    for (const entry of selection.ambiguous) {
      console.error(`  - ${entry.target}: ${entry.matches.join(", ")}`);
    }
  }
  console.error(`\nAvailable contracts: ${listContractNames(contracts)}`);
  process.exit(1);
}

const contractsToBind = selection.contracts;
const contractIds: Record<string, string> = {};

let rpcUrl = 'https://soroban-testnet.stellar.org';
let networkPassphrase = 'Test SDF Network ; September 2015';

if (existsSync("deployment.json")) {
  const deploymentInfo = await Bun.file("deployment.json").json();
  if (deploymentInfo?.rpcUrl) rpcUrl = deploymentInfo.rpcUrl;
  if (deploymentInfo?.networkPassphrase) networkPassphrase = deploymentInfo.networkPassphrase;

  if (deploymentInfo?.contracts && typeof deploymentInfo.contracts === 'object') {
    Object.assign(contractIds, deploymentInfo.contracts);
  } else {
    // Backwards compatible fallback
    if (deploymentInfo?.mockGameHubId) contractIds["mock-game-hub"] = deploymentInfo.mockGameHubId;
    if (deploymentInfo?.twentyOneId) contractIds["twenty-one"] = deploymentInfo.twentyOneId;
    if (deploymentInfo?.numberGuessId) contractIds["number-guess"] = deploymentInfo.numberGuessId;
  }
} else {
  const env = await readEnvFile('.env');
  rpcUrl = getEnvValue(env, 'VITE_SOROBAN_RPC_URL', rpcUrl);
  networkPassphrase = getEnvValue(env, 'VITE_NETWORK_PASSPHRASE', networkPassphrase);

  for (const contract of contracts) {
    contractIds[contract.packageName] = getEnvValue(env, `VITE_${contract.envKey}_CONTRACT_ID`);
  }
}

const missing: string[] = [];
for (const contract of contractsToBind) {
  const id = contractIds[contract.packageName];
  if (!id) missing.push(`VITE_${contract.envKey}_CONTRACT_ID`);
}

if (missing.length > 0) {
  console.error("❌ Error: Missing contract IDs (need either deployment.json or .env):");
  for (const k of missing) console.error(`  - ${k}`);
  process.exit(1);
}

for (const contract of contractsToBind) {
  const contractId = contractIds[contract.packageName];
  console.log(`Generating bindings for ${contract.packageName}...`);
  try {
    let success = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await $`stellar contract bindings typescript --contract-id ${contractId} --output-dir ${contract.bindingsOutDir} --rpc-url ${rpcUrl} --network-passphrase ${networkPassphrase} --overwrite`;
        success = true;
        break;
      } catch (e) {
        if (attempt === 5) throw e;
        console.log(`  ⏳ RPC indexing contract, retrying in 3s (attempt ${attempt}/5)...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    console.log(`✅ ${contract.packageName} bindings generated\n`);
  } catch (error) {
    console.error(`❌ Failed to generate ${contract.packageName} bindings:`, error);
    process.exit(1);
  }
}

console.log("🎉 Bindings generated successfully!");
console.log("\nGenerated files:");
for (const contract of contractsToBind) {
  console.log(`  - ${contract.bindingsOutDir}/`);
}
