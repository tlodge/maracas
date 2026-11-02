/*********************************************************************
 Maracas - Feather nRF52840 Sense

 Streams accelerometer + gyroscope readings over BLE UART (Nordic UART
 Service) as one text line per sample:

   <millis> <ax> <ay> <az> <gx> <gy> <gz>\n

 accel in m/s^2, gyro in rad/s.

 Based on Adafruit's Bluefruit52 BLEUART example (MIT license).
*********************************************************************/
#include <bluefruit.h>
#include <Adafruit_LSM6DS33.h>
#include <Adafruit_LSM6DS3TRC.h>

// Give each maraca a different name if you are using a pair,
// e.g. "Maracas L" and "Maracas R". The node client connects to
// anything whose name starts with "Maracas".
#define DEVICE_NAME "Maracas"

// How often to send a sample. 20ms = 50Hz, which is fast enough to see
// individual shakes. The old sponge code used 500ms, which is far too slow.
#define SAMPLE_INTERVAL_MS 20

BLEDfu  bledfu;  // OTA DFU service
BLEDis  bledis;  // device information
BLEUart bleuart; // uart over ble
BLEBas  blebas;  // battery

// Older Feather Sense boards have an LSM6DS33, newer ones an LSM6DS3TR-C.
// Try both and use whichever answers.
Adafruit_LSM6DS33   lsm6ds33;
Adafruit_LSM6DS3TRC lsm6ds3trc;
Adafruit_LSM6DS    *imu = NULL;

void setup()
{
  Serial.begin(115200);

  if (lsm6ds33.begin_I2C()) {
    imu = &lsm6ds33;
  } else if (lsm6ds3trc.begin_I2C()) {
    imu = &lsm6ds3trc;
  } else {
    Serial.println("No LSM6DS accelerometer/gyro found");
    while (true) yield();
  }

  // Shaking a maraca easily exceeds the default ranges
  imu->setAccelRange(LSM6DS_ACCEL_RANGE_16_G);
  imu->setGyroRange(LSM6DS_GYRO_RANGE_2000_DPS);
  imu->setAccelDataRate(LSM6DS_RATE_104_HZ);
  imu->setGyroDataRate(LSM6DS_RATE_104_HZ);

  Bluefruit.autoConnLed(true);
  Bluefruit.configPrphBandwidth(BANDWIDTH_MAX);
  Bluefruit.begin();
  Bluefruit.setTxPower(4);
  Bluefruit.setName(DEVICE_NAME);
  Bluefruit.Periph.setConnInterval(6, 12); // 7.5ms - 15ms
  Bluefruit.Periph.setConnectCallback(connect_callback);
  Bluefruit.Periph.setDisconnectCallback(disconnect_callback);

  bledfu.begin();

  bledis.setManufacturer("Adafruit Industries");
  bledis.setModel("Bluefruit Feather52");
  bledis.begin();

  bleuart.begin();

  blebas.begin();
  blebas.write(100);

  startAdv();
}

void startAdv(void)
{
  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(bleuart);
  Bluefruit.ScanResponse.addName();

  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(32, 244);    // in unit of 0.625 ms
  Bluefruit.Advertising.setFastTimeout(30);      // number of seconds in fast mode
  Bluefruit.Advertising.start(0);                // 0 = advertise forever
}

void loop()
{
  static uint32_t lastSample = 0;

  uint32_t now = millis();
  if (now - lastSample < SAMPLE_INTERVAL_MS) {
    yield();
    return;
  }
  lastSample = now;

  // Nothing to do until a client has subscribed
  if (!Bluefruit.connected() || !bleuart.notifyEnabled()) {
    return;
  }

  sensors_event_t accel;
  sensors_event_t gyro;
  sensors_event_t temp;
  imu->getEvent(&accel, &gyro, &temp);

  // The old sketch used char buf[32], which overflowed. This line is
  // ~60 chars, so leave plenty of room.
  char buf[96];
  snprintf(buf, sizeof(buf), "%lu %s %s %s %s %s %s\n",
           (unsigned long)now,
           String(accel.acceleration.x, 2).c_str(),
           String(accel.acceleration.y, 2).c_str(),
           String(accel.acceleration.z, 2).c_str(),
           String(gyro.gyro.x, 2).c_str(),
           String(gyro.gyro.y, 2).c_str(),
           String(gyro.gyro.z, 2).c_str());
  bleuart.write(buf);
}

void connect_callback(uint16_t conn_handle)
{
  BLEConnection* connection = Bluefruit.Connection(conn_handle);

  char central_name[32] = { 0 };
  connection->getPeerName(central_name, sizeof(central_name));

  Serial.print("Connected to ");
  Serial.println(central_name);
}

void disconnect_callback(uint16_t conn_handle, uint8_t reason)
{
  (void) conn_handle;

  Serial.print("Disconnected, reason = 0x");
  Serial.println(reason, HEX);
}
