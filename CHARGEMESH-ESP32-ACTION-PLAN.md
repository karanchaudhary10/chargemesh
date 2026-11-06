# ChargeMesh ESP32 + PZEM004T Integration - Action Plan

## 🎯 GOAL
Connect your real ESP32 + PZEM004T to ChargeMesh and show real meter readings instead of simulated data.

---

## 📋 PHASE 1: Server Setup (30 minutes)

### Step 1.1: Generate Ed25519 Key Pair
```bash
cd /home/karan-chaudhary/Documents/ChargeMesh
node chargemesh-esp32-helper/helper.js generate-keys
```
**Output:** `meter-private-key.pem` and `meter-public-key.pem` created

### Step 1.2: Upload Public Key to ChargeMesh Server
```bash
# POST /api/meters with your meter details
curl -X POST http://YOUR-INSTANCE.com/api/meters \
  -H "Content-Type: application/json" \
  -d '{
    "meterId": "esp32-pzem001",
    "roomId": "room-123",
    "publicKeyPem": "(contents of meter-public-key.pem)"
  }'
```

### Step 1.3: Verify Meter Created
```bash
curl http://YOUR-INSTANCE.com/api/meters
# Should show your meter with deviceType "physical"
```

### Step 1.4: Disable Simulator (optional but recommended)
```bash
curl -X PATCH http://YOUR-INSTANCE.com/api/simulator \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

---

## 📋 PHASE 2: ESP32 Firmware Configuration (60 minutes)

### Step 2.1: Open Firmware in Arduino IDE
```bash
cd /home/karan-chaudhary/Documents/ChargeMesh/esp32-pzem004t-chargemesh
code esp32-pzem004t-chargemesh.ino  # or open in Arduino IDE
```

### Step 2.2: CONFIGURE WIFI (line ~30)
```cpp
const char* WIFI_SSID = "your_wifi_ssid";
const char* WIFI_PASSWORD = "your_wifi_password";
```

### Step 2.3: CONFIGURE METER & API (line ~38-42)
```cpp
const char* METER_ID = "esp32-pzem001";          // Must match registered meter
const char* API_BASE_URL = "http://your-instance.com";  // Your ChargeMesh instance
const char* PRIVATE_KEY_PEM = 
  "-----BEGIN PRIVATE KEY-----\n"
  "...your 32-byte Ed25519 private key in PEM format...\n"
  "-----END PRIVATE KEY-----\n";
```

### Step 2.4: PZEM004T PINS (line ~48-52)
```cpp
#define PZEM_RX 16     // GPIO16 connect to PZEM004T TX
#define PZEM_TX 17     // GPIO17 connect to PZEM004T RX
```
**Verify your wiring:** PZEM TX → ESP32 RX16, PZEM RX → ESP32 TX17

### Step 2.4: ED25519 KEY IMPORT METHOD (choose one)

#### Option A: Hardcode PEM (Easiest - for development)
Just paste the PEM string from `meter-private-key.pem`. ⚠️ Not secure for production.

#### Option B: Use ESP32S2/S3 mbedTLS (Recommended)
1. Use ESP32-S2 or S3 board
2. Include `#include <mbedtls/ed25519.h>`
3. The firmware already has the structure - just ensure mbedtls is available in your Arduino core

#### Option C: Pre-sign on PC + Transport (Quickest Prototype)
1. Run: `node sign-reading.js` (see guide)
2. Hardcode the base64 signature in firmware
3. ESP32 just sends the pre-computed signature

---

## 📋 PHASE 3: Test Canonical Payload Format (10 minutes)

### Verify the payload format matches ChargeMesh expectations:
```bash
node chargemesh-esp32-helper/helper.js canonical
```
**Output should show:**
```json
{"cumulativeEnergyKwh":12.5,"current":1.95,"deviceType":"physical","meterId":"esp32-pzem001","nonce":"...","powerW":450,"roomId":"room-123","sequence":1,"simulated":false,"timestamp":"...","voltage":230}
```

### Verify critical fields:
- [ ] `deviceType: "physical"` (NOT "simulator")
- [ ] `simulated: false` (NOT true)
- [ ] Keys are alphabetically sorted
- [ ] No whitespace in JSON
- [ ] `cumulativeEnergyKwh` or `cumulativeKwh` present
- [ ] `timestamp` is valid ISO 8601

---

## 📋 PHASE 4: Test Reading Creation & Validation (10 minutes)

```bash
node chargemesh-esp32-helper/helper.js create-payload
```
**Output should validate:** ✅ Valid

```bash
node chargemesh-esp32-helper/helper.js validate
```
**Output should show:** Valid: true

---

## 📋 PHASE 5: First Reading Test (30 minutes)

### Step 5.1: Upload Firmware to ESP32
```bash
# Using arduino-cli or Arduino IDE
arduino-cli upload -b esp32:esp32:esp32 --port /dev/tty.usbmodemXXXXYZ
```

### Step 5.2: Open Serial Monitor
```bash
# In Arduino IDE: Tools -> Serial Monitor at 115200 baud
# Or: screen /dev/tty.usbmodemXXXXYZ 115200
```

### Step 5.3: Observe Output
You should see:
```
Connecting to WiFi: your_wifi_ssid.
Connected! IP: 192.168.1.142
--- Taking reading ---
✅ Reading sent successfully to ChargeMesh
   Meter: esp32-pzem001, KWh: 12.345, W: 450, V: 2300, Seq: 1
```

### Step 5.4: Verify in ChargeMesh Dashboard
- Meter should show status "Working" or "Online"
- Real readings should appear (NO "SIMULATED DATA ONLY" notice)
- Energy consumption should start accumulating

### Step 5.5: Troubleshooting Checklist
If reading fails:

| Error | Likely Cause | Fix |
|-------|-------------|-----|
| `signature_invalid` | Ed25519 key/signature wrong | Verify key format, use Approach A/B/C from guide |
| `unregistered_meter` | meterId doesn't match registered | Check meterId matches exactly |
| `room_mismatch` | roomId doesn't match registered | Omit roomId or match registered room |
| `future_timestamp` | Clock skew | Ensure ESP32 time is synced or use server time |
| `stale_timestamp` | Too much time between readings | Reduce reading interval |
| `No response from PZEM004T` | Wrong pins/baud | Check wiring, try different GPIO pins |
| `WiFi disconnected` | Signal issues | Move ESP32 closer to router, check credentials |

---

## 📋 PHASE 6: Production Hardening (Optional - ongoing)

### 6.1: Secure Key Storage
- Use ESP32 NVS to encrypt and store the private key
- Or use flash encryption
- Or generate keys onboard and never transport them

### 6.2: OTA Update Support
- Ensure firmware over-the-air update capability
- Keep WiFi credentials and key management OTA-updatable

### 6.3: Reading Reliability
- Implement retry logic for failed API posts
- Add watchdog timer reset
- Add error logging to SPIFFS or SD card

### 6.4: Firmware Over-the-Air (OTA)
```cpp
// Enable Arduino OTA in setup():
 ArduinoOTA.begin();
// Add loop() handling for OTA
```

### 6.5: Power Loss Recovery
- Track cumulative kWh even after power cycles
- Use EEPROM or NVS to persist state
- On restart, continue from last saved kWh

---

## 🛠️ NEED HELP SPECIFIC?

### Help Topic 1: Ed25519 Library Installation
I can provide:
- Arduino Library Manager search terms
- Library code snippets
- mbedtls integration steps

### Help Topic 2: PZEM004T Wiring & Communication
I can provide:
- Pin mappings for your specific ESP32 board
- Protocol troubleshooting
- Error handling code

### Help Topic 3: Key Management
I can provide:
- PEM parsing code
- Secure storage techniques
- Key generation scripts

### Help Topic 4: API Troubleshooting
I can provide:
- cURL test commands
- Response parsing
- Error code meanings

### Help Topic 5: Complete Integration
I can help you:
- Walk through each phase step-by-step
- Debug specific error messages
- Optimize reading frequency
- Add additional features (load profiling, etc.)

---

## ⏱️ ESTIMATED TIMELINE

| Phase | Time | Status |
|-------|------|--------|
| Server key generation + upload | 15 min | ⭡ Pending |
| Firmware configuration | 30 min | ⭡ Pending |
| Canonical payload testing | 10 min | ⭡ Pending |
| Reading creation + validation | 10 min | ⭡ Pending |
| First ESP32 reading test | 30 min | ⭡ Pending |
| Troubleshooting & fixes | 30-60 min | ⭡ Pending |
| **Total** | **~2 hours** | **Start whenever ready** |

---

## 📞 ASK ME ANYTIME

You can ask me to:
1. Generate keys and show the exact commands
2. Walk through firmware configuration step-by-step
3. Help troubleshoot specific error messages from the serial monitor
4. Explain the canonical JSON format in detail
5. Provide alternative Ed25519 library recommendations
6. Test your reading payload format
7. Debug API submission responses
8. Optimize the setup for your specific hardware

**Just tell me what you're working on or what error you're seeing, and I'll help you solve it!**