# ChargeMesh

## Project Overview

**ChargeMesh** is a complete electricity metering and billing platform that connects real ESP32 power meters to a web dashboard, enabling landlords to monitor live consumption and tenants to view/manage their bills with Hedera Hashgraph blockchain payments.

Built for **ETHGlobal Mumbai 2026**, ChargeMesh bridges the physical and digital worlds by:
- 📊 **Real-time monitoring**: Live electricity usage from ESP32 devices (7.6-7.8W, 50Hz, PF 0.98-1.00)
- 👥 **Landlord/tenant management**: Separate dashboards with role-based access control
- 💳 **Hedera HCS payments**: Blockchain-verified electricity bills via Hedera Consensus Service
- 🏠 **Room-based access control**: Property-associated meter readings with Ed25519 signature verification

---

## How It Works - Execution Flow

### 1. **Data Collection Layer**

- **ESP32 Devices** install at each electrical meter location
- Devices continuously sample voltage, current, power, and energy consumption
- Data transmitted via WiFi to the ChargeMesh server
- Format: JSON payloads containing V (voltage), I (current), P (power), Eraw (energy), F (frequency), PF (power factor)
- Sampling rate: Every 5-10 seconds
- Typical readings: power 7.6-7.8W, voltage 238-239V, frequency 50.0Hz, power factor 0.98-1.00

### 2. **Server-Side Processing**

- **API Layer** (Node.js/TypeScript) receives and validates all meter readings
- Readings stored in **PostgreSQL database** across 6 schemas:
  - `identity` - users, sessions
  - `property` - properties, rooms, tenancies
  - `metering` - meters, meter_keys, readings
  - `billing` - tariffs, bills, disputes
  - `audit` - events, cre_reports
  - `system` - integration_state
- **HCS Integration**: All meter readings and payment events posted to Hedera Consensus Service topic `0.0.11169785` (44,802+ messages processed)
- Validation checks: JSON validity, required fields, room accessibility, meter-room association

### 3. **Frontend Dashboard**

- **React Web Application** (Vite + TypeScript)
- Two access levels:
  - **Landlord**: Full access to live monitoring, bill creation, tenant management
  - **Renter**: View assigned room, pay bills, report issues
- **Critical**: Hard refresh (Ctrl+F5) required after database changes to populate LiveUsageChart
- Chart auto-polls every 5 seconds and shows "Live" status after 5-10 seconds

---

## Step-by-Step Workflows

### 👤 **Landlord Workflow**

| Step | Action | Result |
|------|--------|--------|
| 1 | Login at `http://localhost:5173/` | Access dashboard with JWT session |
| 2 | Press **Ctrl+F5** (hard refresh) | Clears cache, fetches fresh data (CRITICAL) |
| 3 | Wait 5-10 seconds | 🟢 **"Live"** badge appears on LiveUsageChart |
| 4 | Navigate to **Overview** tab | Power reading displays (7.7W typical), 15-minute chart |
| 5 | Select room from dropdown | Chart updates to selected room's data |
| 6 | Go to **Bills** tab | View/create electricity bills |
| 7 | Click **Create Bill** | Generate bill with tariff rate (e.g., 12.5 NPR/kWh) |
| 8 | Assign to room/tenant | Bill sent to assigned renter |
| 9 | Monitor payments | Update status to "paid" (after HCS verification) |
| 10 | Navigate other tabs | Rooms, Readings, Disputes, Tenants, Settings |

**Key Landlord Features:**
- Live electricity usage monitoring (real-time, after Ctrl+F5)
- Room & meter management with propertyId association
- Bill creation and tariff setting (NPR per kWh)
- Tenant assignment & occupancy tracking
- Issue/dispute management (uphold/reject)
- Electricity rate configuration

### 👤 **Renter Workflow**

| Step | Action | Result |
|------|--------|--------|
| 1 | Login with renter credentials | Dashboard shows assigned room |
| 2 | View **My Bills** section | List of bills due with amounts/due dates |
| 3 | Click **Pay Bill** | Payment dialog opens with HashPack wallet |
| 4 | Scan QR code / Submit reference | Submit payment from HashPack testnet wallet |
| 5 | Enter transaction reference | Status updates to "pending verification" |
| 6 | Landlord verifies payment | Bill status → "paid" (after HCS confirmation) |
| 7 | View billing history | Past bills and payments |

**Key Renter Features:**
- View assigned room details (floor, type, rent status)
- View and pay bills (HashPack wallet integration)
- Make payments from wallet (QR scan or transaction ID)
- Submit payment references (Hedera transaction ID)
- Report issues on bills (landlord receives notification)
- View billing history (past bills, payments, issues)

### 💳 **Payment & HCS Workflow (Detailed)**

**HashPack Wallet Configuration:**
- Default account: `0.0.11206800` (testnet)
- Network: testnet (matching HCS topic)
- Label: "HashPack (0.0.11206800)"
- 3 testnet accounts configured, first is default
- Browser extension for Hedera payments

**Payment Flow:**
1. Renter makes payment from HashPack testnet wallet
2. API posts transaction event to HCS topic `0.0.11169785`
3. HCS permanently stores the event with sequence number (44,802+ total)
4. Landlord dashboard polls HCS for payment verification
5. Bill status updates from `pending_verification` → `paid`
6. Both landlord & renter see updated status

**HCS Topic Details:**
- Topic ID: `0.0.11169785`
- Network: testnet
- Last Sequence: 44,802+ (growing)
- All payment events stored permanently
- Visible via Mirror Node: `https://mirrornode.testnet.hedera.com/api/v1/topics/0.0.11169785/messages`

**Bill Status Progression:**
- `issued` → `payment_pending_verification` → `verifying` → `paid`
- Auto-verification after HCS confirmation (no manual landlord action required)
- Both dashboards update simultaneously

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CHARGEMesh ECOSYSTEM                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────┐  │
│  │       ESP32         │    │   ChargeMesh API    │    │  PostgreSQL     │  │
│  │   (Power Meter)     │→→→ │ (Node.js/TS Server) │→→  │ (6 Schemas:)    │  │
│  │                     │    │                     │    │   identity,     │  │
│  │   Voltage/Current   │    │   API Endpoints     │    │   property,     │  │
│  │   Power/Energy      │    │   (/api/readings)   │    │   metering,     │  │
│  └─────────────────────┘    └─────────────────────┘    └─────────────────┘  │
│           │                      │                            │             │
│           │                      │                            │             │
│           ▼                      ▼                            ▼             │
│  ┌─────────────────────┐    ┌─────────────────────┐    ┌────────────────┐   │
│  │   React Dashboard   │    │   HCS (Consensus    │    │   system.config│   │
│  │ (Landlord/Renter)   │    │   Service Topic)    │    │   integration  │   │
│  │                     │    │  topic: 0.0.11169785│    │   state        │   │
│  └─────────────────────┘    └─────────────────────┘    └────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow Path

```
ESP32 Reading → API Validation → PostgreSQL Storage → 
React Component Polling (every 5s) → LiveUsageChart Update
```

### Payment Flow Path

```
Renter Wallet → Transaction Submission → API Receipt → 
Bill Status Update → HCS Event → Landlord Verification → 
Bill Status → "paid" (both dashboards update)
```

---

## Key Features

### ✅ **For Landlords**
- Live electricity usage monitoring (real-time, after Ctrl+F5)
- Room & meter management with propertyId access control
- Bill creation and tariff setting (NPR per kWh, e.g., 12.5)
- Tenant assignment & occupancy tracking
- Issue/dispute management (uphold/reject outcomes)
- Electricity rate configuration with effective dates
- View occupancy percentage (e.g., 67% full, 2 of 3 rooms)

### ✅ **For Renters**
- View assigned room details and occupancy status
- Browse and review bills with period, consumption, amount
- Make payments via HashPack wallet (testnet)
- Submit payment references (Hedera transaction ID)
- Report bill issues to landlord (with resolution tracking)
- View billing history (past bills, payments, issues)

### ✅ **Technical Features**
- **Hedera HCS Integration**: Consensus service for audit trails (44,802+ messages)
- **HashPack Wallet**: testnet support for development (3 accounts configured)
- **Real-time Updates**: WebSocket/polling every 5 seconds
- **Room Access Control**: Property-based permission system (propertyId JSON)
- **Responsive Design**: Works on mobile and desktop browsers
- **Ed25519 signature verification** for ESP32 meter readings
- **Rejection/quarantine rules** for invalid data

---

## Prerequisites

| Component | Requirement |
|-----------|-------------|
| **ESP32 Devices** | Pre-flashed with ChargeMesh firmware, WiFi connected |
| **Internet** | WiFi connection for meter reading transmission |
| **Node.js** | v18+ for backend server |
| **Modern Browser** | Chrome, Firefox, Edge, or Safari |
| **HashPack Wallet** | Browser extension for payments (testnet: 0.0.11206800) |
| **PostgreSQL** | Database with 6 schemas (identity, property, metering, billing, audit, system) |

---

## Local Development Setup

### 1. **Clone & Install**
```bash
# Navigate to project directory
cd /home/karan-chaudhary/Documents/ChargeMesh

# Install root dependencies
npm install

# Install backend dependencies
npm run dev:server  # or: cd packages/server && npm install

# Install frontend dependencies  
npm run dev:web     # or: cd packages/web && npm install
```

### 2. **Start Servers**
```bash
# Start both API and Web servers concurrently
npm run dev

# Or start separately:
# Terminal 1: npm run dev:server  (API on http://localhost:4000)
# Terminal 2: npm run dev:web     (Web on http://localhost:5173)
```

### 3. **Verify System**
```bash
# Check API is running
curl http://localhost:4000/api/health

# Check frontend accessibility
open http://localhost:5173/
```

### 4. **Login Credentials**

| Role | Email | Password |
|------|-------|----------|
| Landlord | *(create account via /api/auth/register)* | *(set during signup)* |
| Renter | *(register new account)* | *(set during registration)* |

### 5. **First-Time Usage**

1. Landlord logs in (or creates new account)
2. Press **Ctrl+F5** to refresh cache (ESSENTIAL)
3. Click **Overview** tab
4. Wait 5-10 seconds for LiveUsageChart to show "Live" status
5. Navigate other tabs to explore features

---

## Database Schema Highlights

### Core Tables

| Schema | Table | Key Purpose |
|--------|-------|-------------|
| `metering` | `readings` | Store ESP32 meter data (voltage, power, energy, PF, V, I, F) |
| `metering` | `meters` | Meter configuration & room association |
| `billing` | `bills` | Generated electricity bills with payment status |
| `identity` | `users` | Landlord/tenant account information |
| `identity` | `user_wallets` | Hedera wallet accounts (testnet) |
| `system` | `integration_state` | HCS topic configuration & status |
| `property` | `rooms` | Room metadata with propertyId associations |

### Key Relationships

```
Property → Rooms → Meters → Readings
     ↓
   Tenancies (assign renters)

User → Wallets (Hedera accounts)
     ↓
   Bills (issued & paid)
```

### Reading Storage Format

```json
{
  "nonce": "test001",
  "powerW": 7.7,
  "roomId": "room_1001_e8becc",
  "current": 0.034,
  "meterId": "esp32-pzem001",
  "voltage": 232.0,
  "sequence": 1793967400,
  "simulated": false,
  "timestamp": "2026-11-06T07:01:00Z",
  "deviceType": "physical",
  "cumulativeEnergyKwh": 0.074
}
```

### Bill Creation Calculation

```
consumptionKwh = endingCumulativeKwh - startingCumulativeKwh
electricityChargeNpr = consumptionKwh × rateNprPerKwh (e.g., 12.5)
electricityChargeNpr = round to nearest NPR cent (Math.round(value × 100) / 100)
```

---

## Troubleshooting Guide

### Common Issues & Solutions

| Symptom | Cause | Fix |
|---------|-------|-----|
| **"Offline" status** on chart | Stale browser cache or no ESP32 data | Press **Ctrl+F5**, check ESP32 connection |
| **"Waiting" status** | No readings fetched yet | Wait 10 seconds after hard refresh |
| **"404 Room not found"** | Room not associated with landlord's propertyId | Landlord: update property.rooms JSON data |
| **Payments not verifying** | HCS event not confirming | Check HCS topic, wait for sequence update (44,802+) |
| **Cannot login** | Wrong credentials or unregistered account | Use /api/auth/register to create new account |
| **API connection refused** | Server not running | Start: `npm run dev` |
| **Wrong room shown** | Selecting room from different property | Use room dropdown to select correct room |
| **Bill not generating** | No readings in billing period | Ensure ESP32 has been sending data (7.6-7.8W typical) |

### Debugging Commands

```bash
# Verify API is running
curl http://localhost:4000/api/health

# Check readings endpoint
curl "http://localhost:4000/api/readings?roomId=room_1001_e8becc&limit=3"

# Verify rooms are accessible
curl "http://localhost:4000/api/rooms" -b "chargemesh_session=sess_..."

# Check HCS status
PGPASSWORD=chargemesh psql -h localhost -U chargemesh -d chargemesh -c "SELECT * FROM system.integration_state;"

# Hard refresh instruction
# Press Ctrl+F5 (Windows/Linux) or Cmd+Shift+R (Mac)

# HCS Mirror Node
# https://mirrornode.testnet.hedera.com/api/v1/topics/0.0.11169785/messages
```

---

## HCS & Wallet Integration Details

### Hedera Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| **HCS Topic ID** | `0.0.11169785` | Consensus service topic for all events |
| **Network** | **testnet** | Development/test network (not mainnet) |
| **Last Sequence** | `44,802+` | Total messages processed (growing daily) |
| **Wallet Type** | HashPack | Browser-based Hedera wallet (testnet) |
| **Account ID** | `0.0.11206800` | Default testnet HashPack account |
| **Network Name** | testnet | Matching testnet topic and accounts |

### Payment Verification Flow

```
1. Renter submits payment → API receives transaction ID
2. API posts event to HCS topic `0.0.11169785`
3. HCS stores event permanently (sequence #44,802+)
4. Landlord dashboard polls for updates (every 5-10s)
5. Bill status updates from "pending_verification" → "paid"
6. Both landlord & renter see updated status

### Wallet Account Structure

```
Wallet ID: wal_4f99b423-35d2-484d-8480-89eb56603176
Type: hashpack
Network: testnet
Account ID: 0.0.11206800
Label: HashPack (0.0.11206800)
Status: Active (isActive: true, isDefault: true)
```

### How It Works (Step-by-Step)

```
│  1. Renter makes payment from HashPack testnet wallet
│  │
│  2. API posts transaction event to HCS topic 0.0.11169785
│  │
│  3. HCS permanently stores the event with sequence number
│  │
│  4. Landlord dashboard polls HCS for payment verification
│  │
│  5. Bill status updates from pending_verification → paid
│  │
│  5. Both dashboards update simultaneously:
│     │   ├── Landlord: bill shows "paid"
│     │   ├── Renter: bill shows "paid"
│  │
│  6. HCS event permanent: sequence # stored on Hedera network forever
│
│  ✅ Verification is automatic after HCS confirmation
│  ✅ No manual landlord action required
│  ✅ Signature validated, transaction verified on-chain
```

---

## Project Status & Notes

### ✅ **Completed Features**
- ESP32 meter data reception and validation (7.6-7.8W, 50Hz, PF 0.98-1.00)
- Room-to-property access control (propertyId JSON in property.rooms)
- Live dashboard with real-time power readings (after Ctrl+F5)
- Bill creation and tariff setting (12.5 NPR/kWh typical)
- Hedera HCS integration (44,802+ messages on topic 0.0.11169785)
- HashPack wallet payment processing (testnet, 3 accounts)
- Landlord/tenant role-based access control
- Hard refresh requirement (Ctrl+F5) for data population
- Ed25519 signature verification for meter readings
- Rejection/quarantine rules for invalid data

### 🔄 **Known Behaviors**
- **Hard refresh required**: First load after database changes needs Ctrl+F5
- **Testnet only**: All Hedera operations on testnet (appropriate for development)
- **Incremental readings**: ESP32 sends ~1 reading every 5 seconds
- **Cumulative energy**: kWh accumulates over time (not reset per reading)
- **Property association**: Rooms must have correct propertyId to be accessible
- **Billboard chart**: LiveUsageChart updates every 5s, shows "Live" after 10s

### 📊 **Current Metrics**
- **Active Readings**: Continuous from ESP32 (7.6-7.8W typical, 50Hz, PF 0.98-1.00)
- **HCS Messages**: 44,802+ stored events on topic 0.0.11169785
- **Bills Generated**: Multiple bills with verified payments (paid, pending, issued)
- **Wallets Active**: 3 testnet HashPack accounts configured
- **Rooms Managed**: 4 rooms across 2 properties
- **Typical Power**: 7.7W, Voltage: 238-239V, Frequency: 50.0Hz, PF: 0.98-1.00

---

## Quick Reference Commands

```bash
# Start development
npm run dev

# Check API health
curl http://localhost:4000/api/health

# Verify readings
curl "http://localhost:4000/api/readings?roomId=room_1001_e8becc&limit=3"

# Check rooms
curl "http://localhost:4000/api/rooms" -b "chargemesh_session=sess_..."

# HCS status
PGPASSWORD=chargemesh psql -h localhost -U chargemesh -d chargemesh -c "SELECT * FROM system.integration_state;"

# Hard refresh browser
# Ctrl+F5 (Windows/Linux) or Cmd+Shift+R (Mac)

# HCS Mirror Node
# https://mirrornode.testnet.hedera.com/api/v1/topics/0.0.11169785/messages

# Login
# Landlord: register via /api/auth/register
# Renter: register new account

# Wallet
# HashPack testnet: account 0.0.11206800
```

---
**Contact**: For issues, questions, or contributions, refer to the project repository.

---

*ChargeMesh - Real-time electricity monitoring with Hedera blockchain verification.*

*Power data flow: ESP32 (7.6-7.8W, 50Hz) → API (PostgreSQL) → React Dashboard (Live after Ctrl+F5) → HCS (0.0.11169785, 44,802+ messages) → Wallet (HashPack testnet) → Bill Payments (verified, auto-updated)*