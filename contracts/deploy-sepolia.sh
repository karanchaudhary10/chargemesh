#!/usr/bin/env bash
set -euo pipefail

: "${SEPOLIA_RPC_URL:?Set SEPOLIA_RPC_URL in your local shell}"
: "${DEPLOYER_PRIVATE_KEY:?Set DEPLOYER_PRIVATE_KEY in your local shell}"
: "${CRE_EVM_FORWARDER_ADDRESS:?Set the official CRE Forwarder address for Ethereum Sepolia}"

if [[ ! "$CRE_EVM_FORWARDER_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] ||
  [[ "$CRE_EVM_FORWARDER_ADDRESS" == "0x0000000000000000000000000000000000000000" ]]; then
  printf '%s\n' "CRE_EVM_FORWARDER_ADDRESS must be a non-zero EVM address." >&2
  exit 1
fi

chain_id=$(cast chain-id --rpc-url "$SEPOLIA_RPC_URL")
if [[ "$chain_id" != "11155111" ]]; then
  printf 'Expected Ethereum Sepolia chain ID 11155111, received %s.\n' "$chain_id" >&2
  exit 1
fi

cd "$(dirname -- "$0")"
forge create src/ReadingVerifier.sol:ReadingVerifier \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --constructor-args "$CRE_EVM_FORWARDER_ADDRESS"
