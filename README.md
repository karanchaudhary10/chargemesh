# ChargeMesh - Hackathon Project README

## Project Overview

**ChargeMesh** is a complete electricity metering and billing platform that connects real ESP32 power meters to a web dashboard, enabling landlords to monitor live consumption and tenants to view/manage their bills with Hedera Hashgraph blockchain payments.

Built for **ETHGlobal Mumbai 2026**, ChargeMesh bridges the physical and digital worlds by:
- 📊 **Real-time monitoring**: Live electricity usage from ESP32 devices
- 👥 **Landlord/tenant management**: Separate dashboards with role-based access
- 💳 **Hedera HCS payments**: Blockchain-verified electricity bills
- 🏠 **Room-based access control**: Property-associated meter readings

---

## How It Works - Execution Flow

### 1. **Data Collection Layer**
- **ESP32 Devices** install at each electrical meter location
- Devices continuously sample voltage, current, power, and energy consumption
- Data transmitted via WiFi to the ChargeMesh server
- Format: JSON payloads containing V (voltage), I (current), P (power), Eraw (energy), F (frequency), PF (power factor)

### 2. **Server-Side Processing**
- **API Layer** (Node.js/TypeScript) receives and validates all meter readings
- Readings stored in **PostgreSQL database** across schemas:
  - `metering.readings` - raw meter data
  - `metering.meters` - meter configuration
  - `billing.bills` - generated electricity bills
  - `identity.users` - landlord/tenant accounts
  - `identity.user_wallets` - Hedera wallet accounts
- **HCS Integration**: All meter readings and payment events posted to Hedera Consensus Service topic `0.0.11169785` (44,802+ messages processed)

### 3. **Frontend Dashboard**
- **React Web Application** (Vite + TypeScript)
- Two access levels:
  - **Landlord**: Full access to live monitoring, bill creation, tenant management
  - **Renter**: View assigned room, pay bills, report issues

---

## Step-by-Step Workflow

### 👤 Landlord Workflow

| Step | Action | Result |
|------|--------|--------|
| 1 | Login at `http://localhost:5173/` | Access dashboard |
| 2 | Press **Ctrl+F5** (hard refresh) | Clears cache, fetches fresh data |
| 3 | Navigate to **Overview** tab | LiveUsageChart loads |
| 4 | Wait 5-10 seconds | 🟢 **"Live"** badge appears |
| 5 | View power readings (e.g., 7.7W) | Real-time display |
| 6 | Go to **Bills** tab | Create & manage bills |
| 7 | Click **Create Bill** | Generate electricity bill |
| 8 | Assign to room/tenant | Bill sent to renter |
| 9 | Monitor payments | Update status to "paid" |

### 👤 Renter Workflow

| Step | Action | Result |
|------|--------|--------|
| 1 | Login with renter credentials | Dashboard shows assigned room |
| 2 | View **My Bills** section | List of bills due |
| 3 | Click **Pay Bill** | Payment dialog opens |
| 4 | Scan QR code with HashPack wallet | Submit payment |
| 5 | Enter transaction reference | Status updates to "pending verification" |
| 6 | Landlord verifies payment | Bill status → "paid" |
| 7 | View billing history | Past bills and payments |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHARGEMesh ECOSYSTEM                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌────────────────────┐    ┌────────────┐ │
│  │   ESP32     │    │   ChargeMesh API   │    │ PostgreSQL │ │
│  │ (Meter)     │→→→│ (Node.js/TS)       │→→│ Database   │ │
│  └─────────────┘    └────────────────────┘    └────────────┘ │
│           │                ▲                      ▲           │
│           │                │                      │           │
│           ▼                ▼                      ▼           │
│  ┌─────────────────────┐                        ┌────────┐ │
│  │   React Dashboard   │                        │ HCS    │ │
│  │ (Landlord/Renter)   │                        │ Topic  │ │
│  └─────────────────────┘                        └────────┘ │
└─────────────────────────────────────────────────────────────────┘
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
- Live electricity usage monitoring (real-time)
- Room & meter management
- Bill creation and tariff setting
- Tenant assignment & occupancy tracking
- Issue/dispute management
- Electricity rate configuration

### ✅ **For Renters**
- View assigned room details
- Browse and review bills
- Make payments via HashPack wallet
- Submit payment references
- Report bill issues to landlord
- View billing history

### ✅ **Technical Features**
- **Hedera HCS Integration**: Consensus service for audit trails
- **HashPack Wallet**: testnet support for development
- **Real-time Updates**: WebSocket/polling every 5 seconds
- **Room Access Control**: Property-based permission system
- **Responsive Design**: Works on mobile and desktop

---

## Prerequisites

| Component | Requirement |
|-----------|-------------|
| **ESP32 Devices** | Pre-flashed with ChargeMesh firmware |
| **Internet** | WiFi connection for meter reading transmission |
| **Node.js** | v18+ for backend server |
| **Modern Browser** | Chrome, Firefox, Edge, or Safari |
| **HashPack Wallet** | Browser extension for payments (testnet) |

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
| Landlord | *(create account via registration)* | *(set during signup)* |
| Renter | *(register new account)* | *(set during registration)* |

### 5. **First-Time Usage**

1. Landlord logs in
2. Press **Ctrl+F5** to refresh cache
3. Click **Overview** tab
4. Wait 5-10 seconds for LiveUsageChart to show "Live" status
5. Navigate other tabs to explore features

---

## Database Schema Highlights

### Core Tables

| Schema | Table | Key Purpose |
|--------|-------|-------------|
| `metering` | `readings` | Store ESP32 meter data (voltage, power, energy) |
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

---

## Troubleshooting Guide

### Common Issues & Solutions

| Symptom | Cause | Fix |
|---------|-------|-----|
| **"Offline" status** on chart | Stale browser cache | Press **Ctrl+F5** |
| **"Waiting" status** | No readings fetched yet | Wait 10 seconds after hard refresh |
| **Wrong room shown** | Room not associated with property | Landlord: update `propertyId` in room config |
| **Payments not verifying** | HCS topic not receiving | Check integration_state topic ID |
| **Cannot login** | Wrong credentials | Use registered landlord email/password or create new account |
| **API connection refused** | Server not running | Start: `npm run dev` |

### Debugging Commands

```bash
# Verify API health
curl http://localhost:4000/api/health

# Check readings endpoint
curl "http://localhost:4000/api/readings?roomId=room_1001_e8becc&limit=3"

# Verify rooms are accessible
curl "http://localhost:4000/api/rooms" -b "chargemesh_session=sess_..."

# Check HCS status
PGPASSWORD=chargemesh psql -h localhost -U chargemesh -d chargemesh -c "SELECT * FROM system.integration_state;"

# Login
# Use registered landlord email/password or create new account via /api/auth/register

# Hard refresh browser
# Ctrl+F5 (Windows/Linux) or Cmd+Shift+R (Mac)
```

---

## HCS & Wallet Integration Details

### Hedera Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| **HCS Topic ID** | `0.0.11169785` | Consensus service topic for all events |
| **Network** | **testnet** | Development/test network (not mainnet) |
| **Last Sequence** | `44,802+` | Total messages processed (growing) |
| **Wallet Type** | HashPack | Browser-based Hedera wallet |
| **Network Name** | testnet | Matching testnet topic and accounts |

### Payment Verification Flow

```
1. Renter submits payment → API receives transaction ID
2. API posts event to HCS topic
3. HCS stores event permanently (sequence #44,802+)
4. Landlord dashboard polls for updates
5. Bill status updates from "pending_verification" → "paid"
6. Both landlord & renter see updated status
```

### Wallet Account Structure

```
Wallet ID: wal_4f99b423-35d2-484d-8480-89eb56603176
Type: hashpack
Network: testnet
Account ID: 0.0.11206800
Label: HashPack (0.0.11206800)
Status: Active (isActive: true, isDefault: true)
```
### HashPack Wallet Configuration & HCS Audit

For demo purposes, **HashPack wallet** is the default payment method. Here's the configuration and audit setup:

| Configuration Aspect | Details |
|---------------------|---------|
| **Wallet Network** | testnet (matching HCS topic `0.0.11169785`) |
| **Account ID** | `0.0.11206800` (testnet) |
| **HCS Topic Link** | All payment transactions posted to `0.0.11169785` |
| **Audit Trail** | Each payment event sequence # stored in HCS (44,802+ total) |
| **Verification** | Landlord dashboard checks HCS events before updating bill status |
| **Default Wallet** | 3 testnet accounts configured, first is default (`wal_4f99b423`) |

**How It Works**:
1. Renter makes payment from HashPack testnet wallet
2. API posts transaction event to HCS topic `0.0.11169785`
3. HCS permanently stores the event with sequence number
4. Landlord dashboard polls HCS for payment verification
5. Bill status updates from `pending_verification` → `paid` only after HCS audit confirmation

---

## Project Status & Notes

### ✅ **Completed Features**
- ESP32 meter data reception and validation
- Room-to-property access control
- Live dashboard with real-time power readings
- Bill creation and management
- Hedera HCS integration (44,802+ messages)
- HashPack wallet payment processing
- Landlord/tenant role-based access
- Hard refresh requirement (Ctrl+F5) for data population

### 🔄 **Known Behaviors**
- **Hard refresh required**: First load after database changes needs Ctrl+F5
- **Testnet only**: All Hedera operations on testnet (appropriate for development)
- **Incremental readings**: ESP32 sends ~1 reading every 5 seconds
- **Cumulative energy**: kWh accumulates over time (not reset per reading)

### 📊 **Current Metrics**
- **Active Readings**: Continuous from ESP32 (7.6-7.8W typical)
- **HCS Messages**: 44,802+ stored events
- **Bills Generated**: Multiple bills with verified payments
- **Wallets Active**: 3 testnet HashPack accounts configured
- **Rooms Managed**: 4 rooms across 2 properties

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

# Login
# Use registered landlord email/password or create new account via /api/auth/register
# Renter: Register new account

# Hard refresh browser
# Ctrl+F5 (Windows/Linux) or Cmd+Shift+R (Mac)
```

---

## About

**Project**: ChargeMesh  
**Hackathon**: ETHGlobal Mumbai 2026