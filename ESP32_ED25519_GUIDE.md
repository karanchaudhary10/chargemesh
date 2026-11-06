# ESP32 Ed25519 Signing Implementation Guide

This guide covers the three approaches for Ed25519 signing on ESP32 to work with ChargeMesh.

## ⚠️ CRITICAL: Signature Verification is Mandatory

ChargeMesh server **must** verify the Ed25519 signature on every reading. Without a valid signature, readings will be rejected with `signature_invalid` flag.

---

## APPROACH A: ESP32-S2/S3 with ESP-IDF (RECOMMENDED)

**Best for:** ESP32-S2 or ESP32-S3 boards using ESP-IDF framework

### Advantages:
- Native mbedtls Ed25519 support
- Small code footprint (~5KB)
- Well-tested, production-ready
- Part of official ESP-IDF

### Code Example (ESP-IDF):

```c
#include <mbedtls/ed25519.h>

// Your 32-byte private key (already clamped)
const uint8_t private_key[32] = { ... };

void sign_reading(const uint8_t *canonical_payload, size_t payload_len,
                  uint8_t *signature_out) {
    mbedtls_ed25519_context ctx;
    mbedtls_ed25519_init(&ctx);
    
    // Parse the private key
    mbedtls_ed25519_parse_key(&ctx, private_key, 32, NULL, 0);
    
    // Sign the canonical payload
    mbedtls_ed25519_sign(signature_out, payload_len,
                         canonical_payload, &ctx);
    
    mbedtls_ed25519_free(&ctx);
}
```

### Arduino Core Port:
If using Arduino core (not ESP-IDF), you can still use mbedtls:
```c
#include <mbedtls/ed25519.h>
// Same API works on Arduino ESP32 if mbedtls is available
```

### How to Get Your 32-Byte Private Key:
1. Run on your computer: `node -e "const crypto=require('crypto'); console.log(crypto.generateKeyPairSync('ed25519').privateKey.export({type:'raw',format:'pem'}));"`
2. Or use our helper: `node helper.js generate-keys`
3. Extract the 32 raw bytes from the PEM output
4. Hardcode in firmware as `const uint8_t private_key[32] = { ... };`

---

## APPROACH B: Minimal Ed25519 Arduino Library

**Best for:** ESP32-S2/S3 with Arduino core, or any ESP32 board

### Recommended Library: `ed25519-arduino` by paulloz
- https://github.com/paulloz/ed25519-arduino
- ~8KB footprint
- Simple API

### Installation via Arduino Library Manager:
1. Open Arduino IDE -> Sketch -> Include Library -> Manage Libraries...
2. Search for "ed25519"
3. Install "ed25519" by paulloz

### Usage:

```cpp
#include <ed25519.h>

// Your private key as hex string or byte array
const char* private_key_hex = "your_32_bytes_hex_encoded_here";

// Or as byte array
uint8_t private_key[32] = { ... };

void setup() {
    // Initialize with private key
    ed25519_init_privatekey(private_key);
    
    // Create a message to sign
    const char *message = "your_canonical_payload_json_here";
    
    // Sign it
    uint8_t signature[64];
    ed25519_sign(message, strlen(message), signature);
    
    // signature is now 64 raw bytes
    // Convert to base64 for API transmission
    // Use ArduinoB64 or similar
}
```

### Alternative Libraries:
- `TinyCBOR` + `TweetNaCl` combination
- `aws-c-common` (larger but comprehensive)
- `nano-ed25519` (very small)

---

## APPROACH C: Pre-Sign on PC + Transport Signatures

**Best for:** Quick prototype, or when ESP32 lacks crypto capabilities

### How It Works:
1. **Generate signatures on your computer** (where you have full crypto libraries)
2. **Transport the signatures to ESP32** (via WiFi, OTA, or wired connection)
3. **ESP32 just sends the pre-computed signatures**

### Advantages:
- No Ed25519 implementation needed on ESP32
- Easier to get working initially
- Can use any language's crypto (Node.js, Python, etc.)

### Disadvantages:
- Signatures must be updated when keys rotate
- Less secure (private key exists on multiple devices)
- Not suitable for long-term production

### PC Signing Script:

```javascript
// node sign-reading.js
const crypto = require('crypto');
const fs = require('fs');

// Load private key PEM
const privateKeyPem = fs.readFileSync('meter-private-key.pem', 'utf8');
const key = crypto.createPrivateKey(privateKeyPem);

// Reading payload (unsigned)
const payload = {
    meterId: "esp32-pzem001",
    roomId: "room-123",
    sequence: 1,
    timestamp: new Date().toISOString(),
    cumulativeEnergyKwh: 12.5,
    powerW: 450,
    voltage: 230,
    current: 1.95,
    nonce: crypto.randomUUID(),
    deviceType: "physical",
    simulated: false
};

// Create canonical payload (same logic as server)
const { signature } = key.sign(
    Buffer.from(JSON.stringify(payload).replace('"signature"', '').replace(/,("signature":)/g, '').replace(/("signature": "?"?)/g, '')), 
    'utf8'
);

// But we need CANONICAL JSON, not regular JSON
// Use the ChargeMesh canonicalPayload function logic:
// Sort keys, no whitespace, omit signature

// Then:
const base64Sig = key.sign(
    canonical_payload_bytes, 
    null, 
    'base64'
);

console.log('Signature (base64):', base64Sig);
```

### ESP32 Implementation (Simple):
```cpp
// Just hardcode the base64 signature received from PC
const char* signature_b64 = "GEnW...base64-signature-here...";

// In the reading payload, just add:
"signature": "GEnW...base64-signature-here..."
```

---

## 🔑 KEY MANAGEMENT FOR ESP32

### Option 1: Hardcode Private Key (Simplest)
```cpp
// In firmware - only for development!
const uint8_t PRIVATE_KEY[32] = {
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
    0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
    0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20
};
```
**⚠️ NOT RECOMMENDED for production** - key is visible in firmware binary

### Option 2: Secure Storage (PRODUCTION)
- Use ESP32's **NVS (Non-Volatile Storage)** to encrypt and store the key
- Use **Flash encryption** on ESP32
- Use **TPM or secure element** if using ESP32-S2/S3 with crypto hardware

### Option 3: Generate Onboard (Most Secure)
```cpp
// Generate a key pair using a CSPRNG
// Then use the private key for signing
// The public key is already on the server from when you created the meter
```

### Option 4: ChargeMesh Server-Side Key Management
- Generate meter via API (server creates key pair)
- **Only public key** goes to ESP32 (for verification on server)
- **Private key stays on server**
- ESP32 sends unsigned readings, server signs them
- **Note:** This changes the architecture - server becomes the signer

---

## 📊 CANONICAL PAYLOAD FORMAT (MUST MATCH)

The ChargeMesh server expects canonical JSON with these rules (from `canonicalPayload` function):

1. **Keys sorted lexicographically** at every level
2. **No whitespace** (compact JSON)
3. **Undefined properties omitted**
4. **Top-level signature field excluded** from the signed payload
5. **UTF-8 encoding**

### Example Canonical Payload (what the ESP32 signs):

```json
{"cumulativeKwh":12.500000,"current":1.950,"deviceType":"physical","meterId":"esp32-pzem001","nonce":"e26a902e-e845-4ef2-a66a-678f22978ac2","powerW":450,"roomId":"room-123","sequence":1,"simulated":false,"timestamp":"2026-11-05T10:30:00Z","voltage":230}
```

### Key Order (alphabetical):
`cumulativeKwh` → `current` → `deviceType` → `meterId` → `nonce` → `powerW` → `roomId` → `sequence` → `simulated` → `timestamp` → `voltage`

### Common Mistakes:
- ❌ Keys not sorted (e.g., `meterId` before `cumulativeKwh`)
- ❌ Whitespace in JSON (`{ "meterId": ... }` vs `{ "meterId":... }`)
- ❌ Signature field included in the signed payload
- ❌ `simulated: true` (should be `false` for real readings)
- ❌ `deviceType: "simulator"` (should be `"physical"`)

---

## 🛠️ TROUBLESHOOTING

### Reading Rejected with `signature_invalid`?
1. **Check key format** - Is it really Ed25519? (not RSA, not secp256k1)
2. **Check canonical format** - Are keys sorted? No whitespace?
3. **Check `simulated` field** - Must be `false`
4. **Check `deviceType`** - Must be `"physical"` (not `"simulator"`)
5. **Check timestamp freshness** - Must be within `staleAfterMs` (default 60s)
6. **Check sequence** - Must be greater than last accepted sequence

### Reading Rejected with `unregistered_meter`?
1. **Meter not created on server** - Use `/api/meters` endpoint first
2. **Wrong meterId** - Must match exactly what you registered
3. **Wrong public key** - The public key you uploaded must match the private key used for signing

### Reading Rejected with `room_mismatch`?
1. ** roomId doesn't match** - Either omit roomId, or match the registered room

### No WiFi Connection?
1. Check `WIFI_SSID` and `WIFI_PASSWORD` in firmware
2. Ensure signal strength is adequate
3. Consider adding WiFi reconnection logic (already included in firmware)

### PZEM004T Returning Garbage?
1. Verify baud rate: 9600 (default for PZEM004T)
2. Verify pins: RX→TX, TX→RX (crossed)
3. Check power supply to PZEM004T (needs 5V~3.3V)
4. Try different GPIO pins (some ESP32 pins have boot issues)

---

## 📋 QUICK START CHECKLIST

Before flashing firmware, verify:

- [ ] **Generated key pair** via `node helper.js generate-keys`
- [ ] **Public key uploaded** to ChargeMesh via `POST /api/meters`
- [ ] **Private key** properly loaded in firmware (Approach A, B, or C)
- [ ] **WiFi credentials** correct in firmware
- [ ] **API URL** points to your ChargeMesh instance
- [ ] **Meter ID** matches what you registered
- [ ] **PZEM004T pins** correctly connected to ESP32
- [ ] **Canonical payload format** tested with `node helper.js canonical`
- [ ] **Test reading created** with `node helper.js create-payload` (validates ✅)
- [ ] **Simulator disabled** if previously using fake readings: `PATCH /api/simulator { "enabled": false }`

---

## 🚀 RECOMMENDED FLOW

1. **Week 1:** Generate keys, upload public key, test canonical payload format
2. **Week 2:** Get PZEM004T communicating, read voltage/current/power
3. **Week 3:** Implement Ed25519 signing (Start with Approach C if needed, then migrate to A or B)
4. **Week 4:** Integrate everything, test end-to-end, disable simulator, monitor dashboard

---

Need help with any specific part? I can provide:
- Ed25519 library installation instructions
- Key generation scripts
- PZEM004T pin configurations for your specific ESP32 board
- API endpoint testing
