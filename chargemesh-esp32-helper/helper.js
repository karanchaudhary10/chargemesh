/**
 * ChargeMesh ESP32 PZEM004T Helper Utilities
 * 
 * Node.js scripts to help set up and test the ESP32 integration:
 * 1. Generate Ed25519 key pair for your meter (using ChargeMesh server API)
 * 2. Create test readings to verify the format
 * 3. Validate reading format before flashing to ESP32
 * 
 * NOTE: This helper validates reading format and provides structure.
 * Key generation is done via the ChargeMesh API or Node.js crypto API.
 */

const fs = require('fs');
const crypto = require('crypto');

// ============================================================
// 1. VALIDATE READING FORMAT
// ============================================================

/**
 * Validates that a reading payload has all required fields
 * for ChargeMesh acceptance.
 * 
 * Critical requirements for real (non-simulated) readings:
 * - deviceType must be "physical" (not "simulator")
 * - simulated must be false (not true)
 * - meterId must match a registered meter on the server
 * - Valid Ed25519 signature required
 */
function validateReadingFormat(reading) {
  const requiredFields = ['meterId', 'sequence', 'timestamp', 'cumulativeEnergyKwh'];
  const criticalFlags = ['deviceType', 'simulated'];
  
  let missing = [];
  let issues = [];
  
  for (const field of requiredFields) {
    if (!(field in reading)) {
      missing.push(field);
    }
  }
  
  // Check critical fields for real-reading mode
  if (reading.deviceType !== 'physical') {
    issues.push('deviceType should be "physical" (got: "' + reading.deviceType + '")');
    issues.push('⚠️  Readings with deviceType "simulator" will not be accepted as real meters');
  }
  
  if (reading.simulated !== false) {
    issues.push('simulated should be false (got: ' + reading.simulated + ')');
    issues.push('⚠️  Readings with simulated=true show "SIMULATED DATA ONLY" notice');
  }
  
  if (typeof reading.meterId !== 'string' || reading.meterId.length === 0) {
    issues.push('meterId should be a non-empty string');
  }
  
  // Check timestamp format
  const ts = Date.parse(reading.timestamp);
  if (isNaN(ts)) {
    issues.push('timestamp must be valid ISO 8601');
  }
  
  // Check sequence is a positive integer
  if (!Number.isInteger(reading.sequence) || reading.sequence < 1) {
    issues.push('sequence must be a positive integer');
  }
  
  // Check cumulative energy is a non-negative number
  if (!Number.isFinite(reading.cumulativeEnergyKwh) || reading.cumulativeEnergyKwh < 0) {
    issues.push('cumulativeEnergyKwh must be a finite non-negative number');
  }
  
  // Check for optional but expected fields
  if (reading.powerW !== undefined && typeof reading.powerW !== 'number') {
    issues.push('powerW should be a number if provided');
  }
  if (reading.voltage !== undefined && typeof reading.voltage !== 'number') {
    issues.push('voltage should be a number if provided');
  }
  if (reading.current !== undefined && typeof reading.current !== 'number') {
    issues.push('current should be a number if provided');
  }
  if (reading.nonce === undefined || reading.nonce.length === 0) {
    issues.push('nonce should be a non-empty string');
  }
  
  return {
    valid: issues.length === 0,
    missing,
    issues
  };
}

// ============================================================
// 2. CREATE A TEST READING PAYLOAD
// ============================================================

/**
 * Creates a test reading payload with the correct format.
 * The caller must sign this payload with Ed25519 before sending.
 * 
 * @param {Object} options - Reading options
 * @param {string} options.meterId - Must match registered meter on server
 * @param {string} [options.roomId] - Optional room ID
 * @param {number} options.sequence - Sequence number (increment per reading)
 * @param {string} options.timestamp - ISO 8601 timestamp
 * @param {number} options.cumulativeEnergyKwh - Cumulative kWh from PZEM004T
 * @param {number} [options.powerW] - Instantaneous power in watts
 * @param {number} [options.voltage] - Voltage in volts
 * @param {number} [options.current] - Current in amps
 * @param {string} [options.nonce] - UUID v4 or random string
 * @param {string} [options.deviceType="physical"] - MUST be "physical" for real readings
 * @param {boolean} [options.simulated=false] - MUST be false for real readings
 * @returns {Object} The test reading payload (unsigned - needs signature added)
 */
function createTestReadingPayload(options = {}) {
  const {
    meterId,
    roomId,
    sequence,
    timestamp,
    cumulativeEnergyKwh,
    powerW,
    voltage,
    current,
    nonce,
    deviceType = 'physical',
    simulated = false
  } = options;
  
  // Validate required fields
  if (!meterId || typeof meterId !== 'string') {
    throw new Error('meterId is required and must be a non-empty string');
  }
  
  if (sequence === undefined || !Number.isInteger(sequence) || sequence < 1) {
    throw new Error('sequence must be a positive integer');
  }
  
  if (!timestamp || isNaN(Date.parse(timestamp))) {
    throw new Error('timestamp must be a valid ISO 8601 string');
  }
  
  if (cumulativeEnergyKwh === undefined || !Number.isFinite(cumulativeEnergyKwh) || cumulativeEnergyKwh < 0) {
    throw new Error('cumulativeEnergyKwh must be a finite non-negative number');
  }
  
  const payload = {
    meterId: meterId.trim(),
    sequence,
    timestamp: timestamp.startsWith(' ') ? timestamp.trim() : timestamp,
    cumulativeEnergyKwh: Math.round(cumulativeEnergyKwh * 1_000_000) / 1_000_000, // 6 decimal precision
    deviceType,
    simulated,
    nonce: nonce || crypto.randomUUID()
  };
  
  // Add optional fields if provided
  if (roomId && typeof roomId === 'string') {
    payload.roomId = roomId.trim();
  }
  if (powerW !== undefined && typeof powerW === 'number') {
    payload.powerW = powerW;
  }
  if (voltage !== undefined && typeof voltage === 'number') {
    payload.voltage = voltage;
  }
  if (current !== undefined && typeof current === 'number') {
    payload.current = Math.round(current * 1000) / 1000; // 3 decimal precision
  }
  
  return payload;
}

// ============================================================
// 3. CANONICAL PAYLOAD CREATION
// ============================================================

/**
 * Creates canonical JSON payload (sorted keys, no whitespace).
 * This matches the ChargeMesh server's canonicalPayload function.
 * 
 * @param {Object} payload - The reading payload (without signature field)
 * @returns {string} Canonical JSON string ready for signing
 */
function createCanonicalPayload(payload) {
  // Remove signature field if present (shouldn't be in unsigned payload)
  const { signature: _signature, ...payloadWithoutSig } = payload;
  
  // Sort keys lexicographically and build sorted object
  const sortedKeys = Object.keys(payloadWithoutSig).sort();
  const sortedObj = {};
  
  for (const key of sortedKeys) {
    if (payloadWithoutSig[key] !== undefined) {
      sortedObj[key] = payloadWithoutSig[key];
    }
  }
  
  // Return compact JSON (no whitespace)
  return JSON.stringify(sortedObj);
}

// ============================================================
// 4. VALIDATE CANONICAL PAYLOAD
// ============================================================

/**
 * Validates that a canonical payload is properly formatted
 * for Ed25519 signing.
 */
function validateCanonicalPayload(canonicalStr) {
  if (typeof canonicalStr !== 'string' || canonicalStr.length === 0) {
    return { valid: false, reason: 'Canonical payload must be a non-empty string' };
  }
  
  try {
    // Should be valid JSON
    const parsed = JSON.parse(canonicalStr);
    return { valid: true, parsed };
  } catch (e) {
    return { valid: false, reason: 'Invalid JSON: ' + e.message };
  }
}

// ============================================================
// 5. QUICK START GUIDE
// ============================================================

/**
 * Prints the quick start setup guide for ESP32 + ChargeMesh integration.
 */
function printQuickStartGuide() {
  console.log('\n=== Quick Start: ESP32 + PZEM004T + ChargeMesh ===\n');
  console.log('Step 1: Set up meter on ChargeMesh server');
  console.log('  POST /api/meters {');
  console.log('    "meterId": "esp32-pzem001",     // Your chosen ID');
  console.log('    "roomId": "room-123",           // Your room ID');
  console.log('    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----"');
  console.log('  }');
  console.log('');
  console.log('Step 2: Get the meter private key onto your ESP32');
  console.log('  - The private key must be Ed25519 format');
  console.log('  - ESP32 needs it to sign every reading');
  console.log('');
  console.log('Step 3: Flash the ESP32 firmware');
  console.log('  - Use: esp32-pzem004t-chargemesh/esp32-pzem004t-chargemesh.ino');
  console.log('  - Configure WiFi, PZEM pins, and API endpoint');
  console.log('');
  console.log('Step 4: Send readings');
  console.log('  - ESP32 reads PZEM004T every ~10s');
  console.log('  - Creates signed payload with: simulated=false, deviceType="physical"');
  console.log('  - Posts to: {API_BASE}/api/readings');
  console.log('');
  console.log('Step 5: Verify in ChargeMesh dashboard');
  console.log('  - Meter should show "Working" status');
  console.log('  - Real readings appear without "SIMULATED DATA ONLY" notice');
  console.log('');
  console.log('⚠️  CRITICAL FORMAT REQUIREMENTS:');
  console.log('  - deviceType: "physical" (not "simulator")');
  console.log('  - simulated: false (not true)');
  console.log('  - Valid Ed25519 signature on canonical payload');
  console.log('  - meterId matches a registered active meter');
  console.log('  - Sequence numbers must be monotonically increasing');
  console.log('  - Timestamps must be within freshness window (default 60s)');
  console.log('\n=== Example unsigned payload ===');
  
  // Print example
  const example = createTestReadingPayload({
    meterId: 'esp32-pzem001',
    roomId: 'room-123',
    sequence: 1,
    timestamp: new Date().toISOString(),
    cumulativeEnergyKwh: 12.5,
    powerW: 450,
    voltage: 230,
    current: 1.95
  });
  
  console.log(JSON.stringify(example, null, 2));
  console.log('\n(Above is unsigned - add "signature" field via Ed25519 signing)');
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('=== ChargeMesh ESP32 PZEM004T Helper ===\n');
  
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'validate':
      // Validate a reading from command line or file
      if (args[1]) {
        try {
          const reading = JSON.parse(fs.readFileSync(args[1], 'utf8'));
          const validation = validateReadingFormat(reading);
          console.log('\n📝 Validation result for', args[1] + ':');
          console.log('   Valid:', validation.valid);
          if (validation.missing.length > 0) {
            console.log('   Missing fields:', validation.missing);
          }
          if (validation.issues.length > 0) {
            console.log('   Issues:', validation.issues);
          }
        } catch (e) {
          console.error('❌ Error reading file:', e.message);
        }
      } else {
        // Validate an example
        const example = createTestReadingPayload({
          meterId: 'esp32-pzem001',
          roomId: 'room-123',
          sequence: 1,
          timestamp: new Date().toISOString(),
          cumulativeEnergyKwh: 12.5,
          powerW: 450,
          voltage: 230,
          current: 1.95
        });
        const validation = validateReadingFormat(example);
        console.log('\n📝 Example payload validation:');
        console.log('   Valid:', validation.valid);
        if (validation.issues.length > 0) {
          console.log('   Issues:', validation.issues);
        }
      }
      break;
      
    case 'guide':
      printQuickStartGuide();
      break;
      
    case 'create-payload':
      if (args[1]) {
        try {
          const payload = createTestReadingPayload(JSON.parse(args[1]));
          console.log('\n📝 Created payload:');
          console.log(JSON.stringify(payload, null, 2));
          // Validate it
          const v = validateReadingFormat(payload);
          console.log('   Validation:', v.valid ? '✅ Valid' : '❌ Invalid');
          if (!v.valid) {
            console.log('   Issues:', v.issues.join(', '));
          }
        } catch (e) {
          console.error('❌ Error:', e.message);
        }
      } else {
        const payload = createTestReadingPayload({
          meterId: 'esp32-pzem001',
          roomId: 'room-123',
          sequence: 1,
          timestamp: new Date().toISOString(),
          cumulativeEnergyKwh: 12.5,
          powerW: 450,
          voltage: 230,
          current: 1.95
        });
        console.log('\n📝 Created payload:');
        console.log(JSON.stringify(payload, null, 2));
        const v = validateReadingFormat(payload);
        console.log('   Validation:', v.valid ? '✅ Valid' : '❌ Invalid');
        if (!v.valid) {
          console.log('   Issues:', v.issues.join(', '));
        }
      }
      break;
      
    case 'canonical':
      // Test canonical payload creation
      const payload = createTestReadingPayload({
        meterId: 'esp32-pzem001',
        roomId: 'room-123',
        sequence: 1,
        timestamp: new Date().toISOString(),
        cumulativeEnergyKwh: 12.5,
        powerW: 450,
        voltage: 230,
        current: 1.95
      });
      const canonical = createCanonicalPayload(payload);
      console.log('\n📝 Canonical payload:');
      console.log(canonical);
      const v = validateCanonicalPayload(canonical);
      console.log('   Validation:', v.valid ? '✅ Valid JSON' : '❌ Invalid');
      break;
      
    default:
      console.log('Usage:');
      console.log('  node helper.js validate [file]      - Validate a reading JSON file');
      console.log('  node helper.js create-payload [json] - Create test reading payload');
      console.log('  node helper.js canonical            - Test canonical JSON creation');
      console.log('  node helper.js guide                  - Print quick start guide');
      console.log('\nExample:');
      console.log('  node helper.js create-payload');
      console.log('  node helper.js guide');
      break;
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});