# ReadingVerifier on Ethereum Sepolia

`ReadingVerifier` implements the CRE `IReceiver` entry point (`onReport`) and
accepts reports only from its configured Forwarder. The owner can rotate the
Forwarder, but cannot disable authorization by setting a zero address.

## Deploy

Install Foundry and set these variables in your local shell. Never commit or
paste the deployer key or RPC URL into source control or chat:

- `SEPOLIA_RPC_URL`
- `DEPLOYER_PRIVATE_KEY`
- `CRE_EVM_FORWARDER_ADDRESS` — the official Chainlink CRE Forwarder for
  Ethereum Sepolia, obtained from the current CRE network documentation

Then run:

```bash
./contracts/deploy-sepolia.sh
```

Set the returned contract address as `evm.contractAddress` in both CRE
configuration files. Keep `evm.chainSelectorName` set to
`ethereum-sepolia`. The CRE workflow writes an idempotent report and reads it
back from the latest block before attaching its transaction reference to the
API report.

On-chain status values are `0 = verified`, `1 = review`, and `2 = flagged`.
Duplicate writes with identical report contents succeed without changing state;
reusing a report ID for different contents reverts.
