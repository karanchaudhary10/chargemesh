/*
 * ChargeMesh ESP32 + PZEM-004T Firmware
 * -------------------------------------
 * Reads real electrical measurements from a PZEM-004T v3, signs each reading
 * with an Ed25519 key using libsodium (bundled with the ESP32 Arduino core),
 * and POSTs it to the ChargeMesh backend at /api/readings.
 *
 * Wiring (PZEM-004T -> ESP32)
 *   PZEM TX  -> GPIO16 (ESP32 RX2)
 *   PZEM RX  -> GPIO17 (ESP32 TX2)
 *   PZEM GND -> ESP32 GND          <-- common ground is mandatory
 *   PZEM 5V  -> ESP32 5V/VIN (or external 5V)
 *
 * The PZEM L/N terminals are connected to the AC circuit being measured.
 * The CT clamp goes around the live wire feeding the load (bulb).
 *
 * Serial Monitor: 115200 baud.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <PZEM004Tv30.h>
#include <Preferences.h>
#include <ESPmDNS.h>
#include <sodium.h>
#include <time.h>
#include <sys/time.h>

// ============================================================
// CONFIGURATION
// ============================================================

// --- WiFi ---------------------------------------------------
// Laptop-hosted 2.4 GHz hotspot (NetworkManager, ipv4.method=shared).
const char *WIFI_SSID = "Deep 5th floor";
const char *WIFI_PASSWORD = "9768775555";

// --- ChargeMesh backend -------------------------------------
// The firmware probes these hosts (in order) at boot and uses the first
// one whose /api/health responds. Update the first entry if your laptop's
// LAN IP changes. The mDNS hostname is used as a final fallback.
const char *API_HOST_CANDIDATES[] = {
    "192.168.0.109",  // current laptop LAN IP (enp8s0)
    "10.42.0.1",      // laptop hotspot gateway (fallback)
    "10.100.78.222",  // previous laptop LAN IP
};
const uint16_t API_PORT = 4000;
const char *LAPTOP_MDNS_HOSTNAME = "karan-chaudhary-Legion-5-15IRX10";

// --- Meter identity -----------------------------------------
const char *METER_ID = "esp32-pzem001";
const char *ROOM_ID = "room_1001_e8becc";

// --- Timing -------------------------------------------------
const uint32_t READING_INTERVAL_MS = 10000;  // one reading every 10 s
const uint32_t HTTP_TIMEOUT_MS = 15000;
const uint32_t WIFI_TIMEOUT_MS = 30000;
const uint32_t NTP_TIMEOUT_MS = 30000;

// --- PZEM pins ----------------------------------------------
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17

// --- Ed25519 private key ------------------------------------
// 32-byte seed extracted from the PKCS#8 private key. The matching public
// key must be registered on meter "esp32-pzem001" in ChargeMesh.
const uint8_t ED25519_SEED[32] = {
    0xe2, 0xdb, 0xae, 0xc8, 0x48, 0xcf, 0x46, 0xfd,
    0x71, 0xf4, 0x38, 0x3a, 0x35, 0x3b, 0xd0, 0x2b,
    0x1d, 0xa7, 0xbf, 0xa6, 0x4b, 0x37, 0x88, 0xeb,
    0x5b, 0x82, 0xb4, 0x05, 0x27, 0x5c, 0x4a, 0x0d};

// ============================================================
// GLOBALS
// ============================================================

PZEM004Tv30 pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);

uint8_t g_publicKey[crypto_sign_PUBLICKEYBYTES];
uint8_t g_secretKey[crypto_sign_SECRETKEYBYTES];

Preferences g_prefs;
String g_apiBase;

uint32_t g_sequence = 0;
float g_energyOffset = 0.0f;
float g_lastRawEnergy = -1.0f;

// ============================================================
// HELPERS
// ============================================================

// Format a number the way JavaScript's JSON.stringify would after parsing
// the same value: fixed decimals, then trim trailing zeros / dot.
static String fmtNumber(double value, int decimals) {
  char buf[40];
  snprintf(buf, sizeof(buf), "%.*f", decimals, value);

  char *dot = strchr(buf, '.');
  if (dot != nullptr) {
    char *end = buf + strlen(buf) - 1;
    while (end > dot && *end == '0') {
      *end = '\0';
      end--;
    }
    if (end == dot) {
      *end = '\0';
    }
  }
  if (strcmp(buf, "-0") == 0) {
    strcpy(buf, "0");
  }
  return String(buf);
}

static String isoNowUtc() {
  time_t now = time(nullptr);
  struct tm tmUtc;
  gmtime_r(&now, &tmUtc);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmUtc);
  return String(buf);
}

static String makeNonce() {
  uint32_t a = esp_random();
  uint32_t b = esp_random();
  char buf[17];
  snprintf(buf, sizeof(buf), "%08lx%08lx",
           (unsigned long)a, (unsigned long)b);
  return String(buf);
}

static bool timeIsValid() {
  return time(nullptr) > 1600000000;  // after 2020-09-13
}

// Build canonical JSON exactly like ChargeMesh's stableStringify():
// keys sorted alphabetically, no whitespace, undefined fields omitted.
static String buildCanonical(const String &timestamp, uint32_t sequence,
                             float energyKwh, float voltage, float current,
                             float powerW, const String &nonce) {
  String s = "{";

  s += "\"cumulativeEnergyKwh\":";
  s += fmtNumber(energyKwh, 3);

  s += ",\"current\":";
  s += fmtNumber(current, 3);

  s += ",\"deviceType\":\"physical\"";

  s += ",\"meterId\":\"";
  s += METER_ID;
  s += "\"";

  s += ",\"nonce\":\"";
  s += nonce;
  s += "\"";

  s += ",\"powerW\":";
  s += fmtNumber(powerW, 1);

  s += ",\"roomId\":\"";
  s += ROOM_ID;
  s += "\"";

  s += ",\"sequence\":";
  s += String(sequence);

  s += ",\"simulated\":false";

  s += ",\"timestamp\":\"";
  s += timestamp;
  s += "\"";

  s += ",\"voltage\":";
  s += fmtNumber(voltage, 1);

  s += "}";
  return s;
}

// Sign the canonical bytes with libsodium's Ed25519 (detached).
static String signCanonical(const String &canonical) {
  unsigned char sig[crypto_sign_BYTES];
  unsigned long long sigLen = 0;

  if (crypto_sign_ed25519_detached(
          sig, &sigLen,
          reinterpret_cast<const unsigned char *>(canonical.c_str()),
          canonical.length(), g_secretKey) != 0) {
    return String();
  }

  char b64[128];
  if (sodium_bin2base64(b64, sizeof(b64), sig, sigLen,
                        sodium_base64_VARIANT_ORIGINAL) == nullptr) {
    return String();
  }
  return String(b64);
}

static String buildRequestBody(const String &canonical,
                               const String &signature) {
  // canonical already ends with "}". Insert signature before the brace.
  String body = canonical.substring(0, canonical.length() - 1);
  body += ",\"signature\":\"";
  body += signature;
  body += "\"}";
  return body;
}

// ============================================================
// STATE PERSISTENCE (sequence + energy continuity)
// ============================================================

static void loadState() {
  g_prefs.begin("chargemesh", false);
  g_sequence = g_prefs.getUInt("seq", 0);
  g_energyOffset = g_prefs.getFloat("eoff", 0.0f);
  g_lastRawEnergy = g_prefs.getFloat("eraw", -1.0f);
}

static void saveState() {
  g_prefs.putUInt("seq", g_sequence);
  g_prefs.putFloat("eoff", g_energyOffset);
  g_prefs.putFloat("eraw", g_lastRawEnergy);
}

// Return a monotonic sequence that is greater than both the stored value
// and the current Unix time (seconds). Unix time makes replays after a
// reflash very unlikely.
static uint32_t nextSequence() {
  uint32_t nowSec = (uint32_t)time(nullptr);
  uint32_t seq = g_sequence + 1;
  if (nowSec > seq) {
    seq = nowSec;
  }
  if (seq == 0) {
    seq = 1;
  }
  g_sequence = seq;
  return seq;
}

// PZEM-004T energy resets to 0 when it loses power. Fold the previous raw
// value into an offset so the cumulative value sent to ChargeMesh never
// decreases (which the server rejects as "meter_reset").
static float trackEnergy(float rawKwh) {
  if (g_lastRawEnergy < 0.0f) {
    g_lastRawEnergy = rawKwh;
    return g_energyOffset + rawKwh;
  }

  if (rawKwh + 0.01f < g_lastRawEnergy) {
    g_energyOffset += g_lastRawEnergy;
    Serial.printf("PZEM energy reset detected (%.3f -> %.3f kWh). "
                  "Offset is now %.3f kWh\n",
                  g_lastRawEnergy, rawKwh, g_energyOffset);
  }

  g_lastRawEnergy = rawKwh;
  return g_energyOffset + rawKwh;
}

// ============================================================
// NETWORK
// ============================================================

// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's
// algorithm). Avoids relying on timegm(), which newlib does not expose.
static int64_t daysFromCivil(int year, unsigned month, unsigned day) {
  year -= month <= 2;
  const int era = (year >= 0 ? year : year - 399) / 400;
  const unsigned yoe = (unsigned)(year - era * 400);
  const unsigned doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return (int64_t)era * 146097 + (int64_t)doe - 719468;
}

static bool parseIsoUtc(const char *iso, time_t *out) {
  int year, month, day, hour, minute, second;
  if (sscanf(iso, "%4d-%2d-%2dT%2d:%2d:%2d",
             &year, &month, &day, &hour, &minute, &second) != 6) {
    return false;
  }
  if (year < 2020 || year > 2100 ||
      month < 1 || month > 12 ||
      day < 1 || day > 31 ||
      hour < 0 || hour > 23 ||
      minute < 0 || minute > 59 ||
      second < 0 || second > 60) {
    return false;
  }

  int64_t days = daysFromCivil(year, (unsigned)month, (unsigned)day);
  time_t epoch = (time_t)(days * 86400 + hour * 3600 + minute * 60 + second);
  if (epoch <= 0) {
    return false;
  }
  *out = epoch;
  return true;
}

// Set the ESP32 clock from ChargeMesh's /api/health response. This works
// even when the hotspot has no internet (and therefore no NTP).
static bool setClockFromHealthJson(const String &json) {
  int key = json.indexOf("\"time\":\"");
  if (key < 0) {
    return false;
  }
  int start = key + 8;
  int end = json.indexOf('"', start);
  if (end < 0) {
    return false;
  }

  String stamp = json.substring(start, end);
  time_t epoch = 0;
  if (!parseIsoUtc(stamp.c_str(), &epoch)) {
    return false;
  }

  struct timeval tv;
  tv.tv_sec = epoch;
  tv.tv_usec = 0;
  settimeofday(&tv, nullptr);

  Serial.print("Clock set from ChargeMesh: ");
  Serial.println(stamp);
  return true;
}

static bool probeHealth(const String &host) {
  HTTPClient http;
  http.setConnectTimeout(3000);
  http.setTimeout(3000);

  String url = "http://" + host + ":" + String(API_PORT) + "/api/health";
  if (!http.begin(url)) {
    http.end();
    return false;
  }
  int code = http.GET();
  if (code == 200) {
    String body = http.getString();
    setClockFromHealthJson(body);
  }
  http.end();
  return code == 200;
}

static String discoverApiBase() {
  for (size_t i = 0; i < sizeof(API_HOST_CANDIDATES) / sizeof(API_HOST_CANDIDATES[0]); i++) {
    String host = API_HOST_CANDIDATES[i];
    Serial.printf("Probing %s:%u ... ", host.c_str(), API_PORT);
    if (probeHealth(host)) {
      Serial.println("OK");
      return "http://" + host + ":" + String(API_PORT);
    }
    Serial.println("no response");
  }

  if (MDNS.begin("chargemesh-esp32")) {
    Serial.printf("Probing mDNS %s.local ... ", LAPTOP_MDNS_HOSTNAME);
    IPAddress ip = MDNS.queryHost(LAPTOP_MDNS_HOSTNAME, 3000);
    if ((uint32_t)ip != 0 && (uint32_t)ip != 0xFFFFFFFFu) {
      Serial.printf("OK (%s)\n", ip.toString().c_str());
      return "http://" + ip.toString() + ":" + String(API_PORT);
    }
    Serial.println("no response");
  }

  String fallback = "http://" + String(API_HOST_CANDIDATES[0]) + ":" + String(API_PORT);
  Serial.print("WARNING: no backend reachable, falling back to ");
  Serial.println(fallback);
  return fallback;
}

static bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  Serial.printf("Connecting to WiFi \"%s\" ", WIFI_SSID);
  WiFi.disconnect(true);
  delay(200);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT_MS) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi connection FAILED");
    return false;
  }

  Serial.print("WiFi connected. ESP32 IP: ");
  Serial.println(WiFi.localIP());
  return true;
}

static bool syncTime() {
  if (timeIsValid()) {
    return true;
  }

  Serial.print("Syncing time via NTP ");
  configTime(0, 0, "pool.ntp.org", "time.google.com");

  unsigned long start = millis();
  while (!timeIsValid() && millis() - start < NTP_TIMEOUT_MS) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (!timeIsValid()) {
    Serial.println("NTP sync FAILED - readings would be rejected as stale");
    return false;
  }

  time_t now = time(nullptr);
  struct tm tmUtc;
  gmtime_r(&now, &tmUtc);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmUtc);
  Serial.print("Time synced: ");
  Serial.println(buf);
  return true;
}

static int postReading(const String &body, String &responseOut) {
  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(HTTP_TIMEOUT_MS);

  String url = g_apiBase + "/api/readings";
  if (!http.begin(url)) {
    responseOut = "http.begin() failed";
    http.end();
    return -1;
  }

  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  responseOut = http.getString();
  http.end();
  return code;
}

// ============================================================
// SETUP
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("================================");
  Serial.println("   CHARGEMESH ESP32 + PZEM-004T");
  Serial.println("================================");

  // --- crypto ------------------------------------------------
  if (sodium_init() < 0) {
    Serial.println("FATAL: sodium_init() failed");
    while (true) {
      delay(1000);
    }
  }

  if (crypto_sign_ed25519_seed_keypair(g_publicKey, g_secretKey,
                                       ED25519_SEED) != 0) {
    Serial.println("FATAL: Ed25519 key setup failed");
    while (true) {
      delay(1000);
    }
  }

  char pkB64[64];
  sodium_bin2base64(pkB64, sizeof(pkB64), g_publicKey,
                    crypto_sign_PUBLICKEYBYTES,
                    sodium_base64_VARIANT_ORIGINAL);
  Serial.print("Ed25519 public key (raw base64): ");
  Serial.println(pkB64);

  // --- persisted state --------------------------------------
  loadState();
  Serial.printf("Stored sequence: %lu, energy offset: %.3f kWh\n",
                (unsigned long)g_sequence, g_energyOffset);

  // --- PZEM --------------------------------------------------
  Serial.println("Waiting for PZEM-004T to stabilise...");
  delay(2000);

  // --- WiFi / time / backend --------------------------------
  if (connectWiFi()) {
    // Probe the backend first: a successful /api/health response carries
    // the server clock, so the ESP32 gets a valid timestamp without NTP.
    g_apiBase = discoverApiBase();
    syncTime();  // NTP fallback if the backend clock was unavailable
    Serial.print("ChargeMesh API: ");
    Serial.println(g_apiBase);
  } else {
    Serial.println("Continuing offline; will retry in loop()");
  }

  Serial.println("Setup complete. Taking readings every 10 s.");
}

// ============================================================
// LOOP
// ============================================================

void loop() {
  static unsigned long lastReadingAt = 0;
  if (millis() - lastReadingAt < READING_INTERVAL_MS) {
    delay(100);
    return;
  }
  lastReadingAt = millis();

  // --- connectivity -----------------------------------------
  if (WiFi.status() != WL_CONNECTED) {
    if (!connectWiFi()) {
      return;
    }
    g_apiBase = discoverApiBase();
    syncTime();
  }
  if (!syncTime()) {
    return;
  }

  // --- read PZEM --------------------------------------------
  float voltage = pzem.voltage();
  float current = pzem.current();
  float powerW = pzem.power();
  float rawEnergyKwh = pzem.energy();
  float frequency = pzem.frequency();
  float pf = pzem.pf();

  if (isnan(voltage) || isnan(current) || isnan(powerW) ||
      isnan(rawEnergyKwh) || isnan(frequency) || isnan(pf)) {
    Serial.println("PZEM read failed (NaN). Check UART wiring/common GND.");
    return;
  }

  float cumulativeEnergyKwh = trackEnergy(rawEnergyKwh);

  Serial.println();
  Serial.println("---------- LIVE DATA ----------");
  Serial.printf("Voltage   : %.1f V\n", voltage);
  Serial.printf("Current   : %.3f A\n", current);
  Serial.printf("Power     : %.1f W\n", powerW);
  Serial.printf("Energy    : %.3f kWh (raw %.3f)\n",
                cumulativeEnergyKwh, rawEnergyKwh);
  Serial.printf("Frequency : %.1f Hz\n", frequency);
  Serial.printf("Power fact: %.2f\n", pf);

  // --- sign and send ----------------------------------------
  uint32_t sequence = nextSequence();
  String timestamp = isoNowUtc();
  String nonce = makeNonce();

  String canonical = buildCanonical(timestamp, sequence, cumulativeEnergyKwh,
                                    voltage, current, powerW, nonce);
  String signature = signCanonical(canonical);

  if (signature.length() == 0) {
    Serial.println("Ed25519 signing FAILED");
    return;
  }

  String body = buildRequestBody(canonical, signature);

  Serial.print("Sequence  : ");
  Serial.println(sequence);
  Serial.println("Canonical :");
  Serial.println(canonical);

  int code = -1;
  String response;

  // Retry once or twice on sequence conflicts / transient failures.
  for (int attempt = 0; attempt < 3; attempt++) {
    code = postReading(body, response);
    Serial.printf("HTTP %d\n", code);
    if (response.length() > 0) {
      Serial.println(response);
    }

    if (code == 201 || code == 202) {
      break;
    }

    if (code == 409 || code == -1) {
      // 409: sequence/duplicate conflict -> jump ahead and re-sign.
      // -1: transient network issue -> retry with a fresh payload.
      uint32_t bumped = nextSequence() + 1 + (esp_random() % 1000);
      g_sequence = bumped;
      timestamp = isoNowUtc();
      nonce = makeNonce();
      canonical = buildCanonical(timestamp, bumped, cumulativeEnergyKwh,
                                 voltage, current, powerW, nonce);
      signature = signCanonical(canonical);
      body = buildRequestBody(canonical, signature);
      continue;
    }

    break;  // 400/401/404/422: retrying will not help
  }

  if (code == 201) {
    Serial.println("Reading ACCEPTED by ChargeMesh");
    saveState();
  } else if (code == 202) {
    Serial.println("Reading QUARANTINED (stored, not billable)");
    saveState();
  } else {
    Serial.println("Reading NOT accepted - see HTTP response above");
    saveState();  // still persist the sequence so we never replay it
  }
}
