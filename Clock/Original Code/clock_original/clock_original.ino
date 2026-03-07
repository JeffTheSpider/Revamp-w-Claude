#include <ESP8266WiFi.h>
#include <WiFiUDP.h>
#include <String.h>
#include <Wire.h>
#include <SSD1306.h>
#include <SSD1306Wire.h>
#include <NTPClient.h>
#include <Time.h>
#include <TimeLib.h>
#include <Timezone.h>
#include <NeoPixelBus.h>
#include <WiFiClient.h>
#include <ESP8266WebServer.h>
#include <EEPROM.h>
const int EEPROM_Size = 512;

// ***** NeoPixel *****//
const uint16_t PixelCount = 60;
#define colorSaturation 32 // 0 to 255
NeoPixelBus<NeoGrbFeature,NeoEsp8266BitBang800KbpsMethod> strip(PixelCount, 3); // BitBang on GPIO3 - avoids DMA serial conflict
RgbColor red(colorSaturation, 0, 0);
RgbColor green(0, colorSaturation, 0);
RgbColor blue(0, 0, colorSaturation);
RgbColor white(colorSaturation);
RgbColor black(0);
int Brightness;

// ***** Define NTP properties *****//
#define NTP_OFFSET   60 * 60    // In seconds
#define NTP_INTERVAL 60 * 1000    // In milliseconds
#define NTP_ADDRESS "uk.pool.ntp.org"
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, NTP_ADDRESS, NTP_OFFSET, NTP_INTERVAL);
unsigned long epochTime;
time_t local, utc;

// ***** Server objects *****//
String ClientRequest;
String Message, Mode, PrevMode;
WiFiClient client;
//WiFiServer server(80);
ESP8266WebServer server(80); //Server on port 80
String WiFiMode;
IPAddress newIP, sub, gate, CurrentIP;
const int IP_last_octet = 201;
String SSID_DropList;
String Password_selected;
String SSID_selected;

// ***** Display object *****//
SSD1306 display(0x3c, 0, 2); //0x3d for the Adafruit 1.3" OLED, 0x3C being the usual address of the OLED

// ***** WiFi Creds ***** //
//String ssid = "BK";
//String password = "Bioelectrical";
String ssid = "";
String password = "";

const char* ssid_AP = "Mirror"; // 192.168.4.1
const char* password_AP = "Livelong";

// ***** Time constants *****//
String date, t;
const char * days[] = {"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"} ;
const char * months[] = {"Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sep", "Oct", "Nov", "Dec"} ;
const char * ampm[] = {"AM", "PM"} ;
int PreviousHour, PreviousMin, PreviousSecond;
int i, j, Idle_Count;

void ConnectWiFi();
void UpdateClock();
void UpdateNTP();
void LED_Second();
void LED_Minute();
void LED_Hour();
void test_led();
void log1();
void DoOtherStuff();
void ResetClock();

void EEPROM_Write() {
  EEPROM.begin(EEPROM_Size);
  EEPROM.write(0,ssid.length());
  EEPROM.write(1,password.length());
  for (int n=2; n<ssid.length()+2; n++) {
    EEPROM.write(n, ssid[n-2]);
  }
  for (int n=ssid.length()+2; n<ssid.length()+2+password.length(); n++) {
    EEPROM.write(n,password[n-ssid.length()-2]);
  }
  EEPROM.write(500,Brightness);
  EEPROM.commit();
  EEPROM.end();
}

void EEPROM_Read() {
  EEPROM.begin(EEPROM_Size);
  int ssid_length, password_length;
  ssid_length = EEPROM.read(0);
  password_length = EEPROM.read(1);
  ssid = "";
  password = "";
  if (ssid_length>30 || password_length>30) {
    ssid = "rub";
    password = "ish";
  } else {
    for (int n=2; n<ssid_length+2; n++) {
      ssid += String(char(EEPROM.read(n)));
    }
    for (int n=ssid_length+2; n<ssid_length+2+password_length; n++) {
      password += String(char(EEPROM.read(n)));
      Serial.println("n=" + String(n) + " char=" + String(char(EEPROM.read(n))));
    }
    if (ssid == "BK") {
      Serial.println("SSID ok");
    } else {
      Serial.println("SSID diff <" + ssid + ">");
    }
    if (password == "Bioelectrical") {
      Serial.println("password ok");
    } else {
      Serial.println("password diff <" + password + ">");
    }
  }
  int Stored_Brightness;
  Stored_Brightness = EEPROM.read(500);
  if (Stored_Brightness < 251 && Stored_Brightness > -1) {
    Brightness = Stored_Brightness;
  } else {
    Brightness = 30;
    EEPROM.write(500,Brightness);
  }
  EEPROM.commit();
  EEPROM.end();
}

void ForceStaticIP() {
  // Check that IP address is set to static
  CurrentIP = WiFi.localIP();
  if (CurrentIP[3] != IP_last_octet) {
    newIP = CurrentIP;
    newIP[3] = IP_last_octet;
    sub = WiFi.subnetMask();
    gate = WiFi.gatewayIP();

    WiFi.config(newIP, gate, sub);
    Serial.println("");
    Serial.print("IP changed - ");
    Serial.print(WiFi.localIP());
    Serial.println("");
  }
}

void send_page() {
  String message = "<div style='font-size:36px'><form method=get action=/user_reply>";
  message += "Charlie's Mirror</div>";
  if (WiFiMode == "softAP") {
    SSID_DropList = "<option name='drop2' value=''>WiFi Name</option>";
    int n = WiFi.scanNetworks();
    Serial.println("scan done");
    if (n == 0) {
      Serial.println("no networks found");
      SSID_DropList = "";
    } else {
      Serial.println();
      Serial.println(" networks found");
      for (int i = 0; i < n; ++i) {
        SSID_DropList += "<option name='drop2' value='" + WiFi.SSID(i) + "'>" + WiFi.SSID(i) + "</option>";
        delay(10);
      }
    }
  }

  if (WiFi.status() != WL_CONNECTED) {
    message += "Mirror is not connected to the Internet.";
    message += "<br>";
    message += "Unable to sign in to Home WiFi.<br>";
    message += "Use the drop-down box to select correct WiFi.<br>";
    message += "Then enter the corresponding Password in the text box.<br>";
    message += "Then press the Submit button to attempt to sign in.<br><br>";
    message += "If you just wish to change mode,<br>leave the WiFi Name and Password blank,<br>";
    message += "select one of the modes and then press Submit.<br><br>";
    message +="<div style='font-size:24px'>WiFi Name:&nbsp;&nbsp;";
    if (SSID_DropList != "")
    {
      message += "<select id='SSID_selected' name='SSID_selected'>";
      message += SSID_DropList;
      message += "</select><br><br>    Password:&nbsp;&nbsp;";
      message += "<input type='text' name='Password_selected' size='15' value=''>";
    } else {
      message += "    No WiFi Found";
    }
  }

  message += "<br>Select Mode<br>";
  message += "<input type='radio' name=Mode value='CLOCK'> Clock<br>";
  message += "<input type='radio' name=Mode value='RED'> Red<br>";
  message += "<input type='radio' name=Mode value='BLUE'> Blue<br>";
  message += "<input type='radio' name=Mode value='GREEN'> Green<br>";
  message += "<input type='radio' name=Mode value='WHITE'> White<br>";
  message += "<input type='radio' name=Mode value='Special1'> Special 1<br>";
  message += "<input type='radio' name=Mode value='Special2'> Special 2<br>";
  message += "<input type='radio' name=Mode value='Special3'> Special 3<br>";
  message += "<input type='radio' name=Mode value='Special4'> Special 4<br>";
  message += "Current Brightness (0-255) = ";
  message += String(Brightness);
  message += "<br>";
  message += "<input type='radio' name=Mode value='Brighter'> Brighter<br>";
  message += "<input type='radio' name=Mode value='Dimmer'> Dimmer<br>";
  message += "<br><input type=submit value=Submit></form></div>";

  message += "<br><br>DEBUG DATA SECTION<br>";
  message += "URI: ";
  message += server.uri();
  message += "<br>Method: ";
  message += (server.method() == HTTP_GET)?"GET":"POST";
  message += "<br>Arguments: ";
  message += server.args();
  message += "<br>";
  for (uint8_t i =0; i<server.args(); i++){
    message += " " + server.argName(i) + ": " + server.arg(i) + "<br>";
    if (server.argName(i) == "Mode") {
      //Mode = server.arg(i);
    }
    if (server.argName(i) == "Password_selected") {
      Password_selected = server.arg(i);
    }
    if (server.argName(i) == "SSID_selected") {
      SSID_selected = server.arg(i);
    }
  }

  server.send(200, "text/html", message);
}

void test_led() {
  for(int cell=0; cell < PixelCount; cell++) {
    strip.SetPixelColor(cell, red);
    strip.Show();
    delay(5);
    strip.SetPixelColor(cell, black);
    strip.Show();
  }

  for(int cell=0; cell < PixelCount; cell++) {
    strip.SetPixelColor(PixelCount - cell - 1, green);
    strip.Show();
    delay(5);
    strip.SetPixelColor(PixelCount - cell - 1, black);
    strip.Show();
  }
}

void LED_Special1() {
  ResetClock();
  long randNumber;
  while (Mode == "Special1")
  {
    RgbColor C1(0, 0, Brightness);
    randNumber = random(PixelCount);
    strip.SetPixelColor(randNumber, C1);
    strip.Show();
    if (PreviousSecond != second()) {
      UpdateClock();
    }
    DoOtherStuff();
    delay(100);
  }
}

void LED_Special2() {
  ResetClock();
  long randNumber, randCell, randColour1, randColour2, randColour3;
  //RgbColor randColour;
  while (Mode == "Special2")
  {
    randCell = random(PixelCount);
    randColour1 = random(Brightness);
    randColour2 = random(Brightness);
    randColour3 = random(Brightness);
    //strip.SetPixelColor(randCell, randColour1, randColour2, randColour3);
    RgbColor randColour(randColour1, randColour2, randColour3);
    strip.SetPixelColor(randCell, randColour);
    strip.Show();
    if (PreviousSecond != second()) {
      UpdateClock();
    }
    DoOtherStuff();
    delay(100);
  }
}

void LED_Special3() {
  ResetClock();
  i = 0;
  while (Mode == "Special3")
  {
    RgbColor C1(0, 0, i);
    strip.SetPixelColor(3,C1);
    Serial.println("Brightness=");
    Serial.print(i);
    strip.Show();
    i = i + 1;
    if (i > 255) {
      i = 0;
    }
    if (PreviousSecond != second()) {
      UpdateClock();
    }
    DoOtherStuff();
    delay(100);
  }
}

void LED_Special4() {
  ResetClock();
  while (Mode == "Special4")
  {
    if (PreviousSecond != second()) {
      UpdateClock();
    }
    DoOtherStuff();
    delay(100);
  }
}

void log1() {
  // Display the date and time
  Serial.print(date);
  Serial.print(" ");
  Serial.print(t);
  Serial.print(" ");
  Serial.print(second());
  Serial.print(" sec phour=");
  Serial.print(PreviousHour);
  Serial.print(" psecond=");
  Serial.print(PreviousSecond);
  Serial.print(" idle=");
  Serial.print(Idle_Count);
  Serial.print(" Message=");
  Serial.print(Message);
  Serial.print(" Mode=");
  Serial.println(Mode);
  Message = "";
}

void DoOtherStuff() {
  Idle_Count++;
  yield();
  //CheckForServerRequest();
  server.handleClient();        //Handle client requests
}

void UpdateNTP() {
  // update the NTP client and get the UNIX UTC timestamp
  Serial.println("");
  Serial.print("UpdateNTP = ");
  Serial.print(year());

  timeClient.update();
  epochTime = timeClient.getEpochTime();
  utc = epochTime; // convert received time stamp to time_t object

  // Then convert the UTC UNIX timestamp to local time
  TimeChangeRule uBST = {"BST", Second, Sun, Mar, 2, 0};
  TimeChangeRule uGMT = {"GMT", First, Sun, Nov, 2, -60};
  Timezone UKTime(uBST, uGMT);
  local = UKTime.toLocal(utc);
  setTime(local);

  Serial.print(" > ");
  Serial.print(year());
  Serial.println("");

  //PreviousMin = minute();
  //PreviousHour = hour();
  //PreviousHour = hourFormat12();
}

void UpdateClock() {
  PreviousHour = hourFormat12() % 12;
  PreviousMin = minute();
  PreviousSecond = second();
  // now format the Time variables into strings with proper names for month, day etc
  date = "";
  date += days[weekday()-1];
  date += ", ";
  date += months[month()-1];
  date += " ";
  date += day();
  date += ", ";
  date += year();

  // format the time to 12-hour format with AM/PM and no seconds
  t = "";
  t += hourFormat12(local);
  t += ":";
  if(minute() < 10)  // add a zero if minute is under 10
    t += "0";
  t += minute();
  t += " ";
  t += ampm[isPM()];

  String ss;
  ss = second();

  //LED_Second();

  //PreviousSecond = second();

  // print the date and time on the OLED
  display.clear();
  display.setTextAlignment(TEXT_ALIGN_CENTER);
  display.setFont(ArialMT_Plain_24);
  display.drawStringMaxWidth(64, 11, 128, t);
  display.setFont(ArialMT_Plain_10);
  //display.drawStringMaxWidth(64, 4, 128, String(Idle_Count));
  display.drawStringMaxWidth(64, 38, 128, date);
  display.setFont(ArialMT_Plain_16);
  display.drawString(10, 0, ss);
  display.display();
}

void ConnectWiFi() {
  if (WiFi.status() != WL_CONNECTED && ssid != "rub") {
    // ***** Try to connect to WiFi *****
    delay(500);
    WiFiMode = "Connecting";
    Serial.println("");
    Serial.print("Connecting to " + ssid + " : " + password);
    display.clear();
    display.setTextAlignment(TEXT_ALIGN_CENTER);
    display.setFont(ArialMT_Plain_10);
    display.drawString(10, 11, "Connecting to " + String(ssid));
    display.display();
    WiFi.begin(ssid.c_str(), password.c_str());
    int LoopCounter = 0;
    while (WiFi.status() != WL_CONNECTED && LoopCounter <= 20)
    {
      delay(500);
      Serial.print(".");
      LoopCounter++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      WiFiMode = "Modem";
      ForceStaticIP();
      Serial.println("");
      Serial.print("Connected to WiFi at ");
      Serial.print(WiFi.localIP());
      Serial.println("");
      display.drawString(0, 24, "Connected.");
    } else {
      WiFiMode = "softAP";
      display.drawString(0, 24, "Not Connected.");
    }

    display.display();
    delay(500);
    server.begin();
  }
}

void Connect_SoftAP() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP_STA);
  WiFiMode = "softAP";
  Serial.println("");
  Serial.print("Connection to SoftAP ");
  Serial.print(WiFi.softAP(ssid_AP, password_AP));
  Serial.println("");
  Serial.print("SoftAP IP address: ");
  Serial.println(WiFi.softAPIP());
  server.begin();
}

void Update_Brightness(String Change) {
  EEPROM.begin(EEPROM_Size);
  int delta;
  if (Brightness > 99) {
    delta = 10;
  } else if (Brightness > 49) {
    delta = 5;
  } else {
    delta = 1;
  }

  if (Change == "Brighter" && Brightness < 241) {
    Brightness = Brightness + delta;
  } else if (Change == "Dimmer" && Brightness > 1) {
    Brightness = Brightness - delta;
  }

  if (Mode == "CLOCK") {
    LED_Hour();
  }

  EEPROM.write(500,Brightness);
  EEPROM.commit();
  EEPROM.end();
  RgbColor red(Brightness, 0, 0);
  RgbColor green(0, Brightness, 0);
  RgbColor blue(0, 0, Brightness);
}

void handleNotFound() {
  SSID_selected = "";
  Password_selected = "";
  if (server.uri() == "/user_reply") {
    Serial.println("handleNotFound user_reply no extract returned data");
    for (uint8_t i=0; i<server.args(); i++){
      if (server.argName(i) == "Mode" && server.arg(i) != "") {
        PrevMode = Mode;
        Mode = server.arg(i);
        if (server.arg(i) == "Brighter" || server.arg(i) == "Dimmer") {
          Update_Brightness(Mode);
          Mode = PrevMode;
        } else if (server.arg(i) == "CLOCK") {
          ResetClock();
        }
      } else if (server.argName(i) == "Password_selected" && server.arg(i) != "") {
        Password_selected = server.arg(i);
      } else if (server.argName(i) == "SSID_selected" && server.arg(i) != "") {
        SSID_selected = server.arg(i);
      }
    }
  } else {
    Serial.println("handleNotFound not user_reply!");
  }

  if (SSID_selected != "" && Password_selected != "") {
    ssid = SSID_selected;
    password = Password_selected;
    EEPROM_Write();
    send_page();
    ConnectWiFi();
    return;
  }

  send_page();
}

void handleRoot() {
  Serial.println("handleRoot Page Sent");
  send_page();
}

void setup() {
  Connect_SoftAP();
  // Serial.begin(115200); // Disabled - GPIO3 (RX) is used for NeoPixel data
  pinMode(0, INPUT);
  EEPROM_Read();
  Serial.println("WiFi credentials: " + String(ssid) + " " + String(password));
  ResetClock();
  Mode = "CLOCK";

  Wire.pins(0, 2);  // Start the OLED with GPIO 0 and 2
  Wire.begin(0, 2); // 0=sda, 2=scl
  display.init();
  display.flipScreenVertically();
  ConnectWiFi();
  server.on("/", handleRoot);   //Which routine to handle at root location
  server.onNotFound(handleNotFound);
  server.begin();           //Start server
  timeClient.begin();   // Start the NTP UDP client
  UpdateNTP();
  LED_Second();
  LED_Minute();
  LED_Hour();
}

void ResetClock() {
  strip.Begin();
  strip.Show();
  test_led();
  PreviousHour = -1;
  PreviousMin = -1;
  PreviousSecond = -1;
}

void loop() {
  if (PreviousSecond == second()) {
    DoOtherStuff(); //no change in time so do other stuff
  } else {
    TimeTick();
  }
}

void TimeTick() {
  if (WiFiMode == "Modem") {
    // ***** Connected to Modem *****
    if (second() % 10 == 0 && year() == 1970) {
      UpdateNTP();
    }
    if (PreviousHour != (hourFormat12() % 12)) {
      UpdateNTP(); //get a time update every hour
    }
  } else if (WiFiMode == "softAP") {
    // ***** Not Connected to Modem *****
    if (second() == 0) {
      ConnectWiFi();
    }
  } else {
    Serial.println("Unknown WiFi Mode: " + String(WiFiMode));
  }

  if (Mode == "CLOCK") {
    LED_CLOCK();
  } else if (Mode == "RED") {
    LED_RED();
  } else if (Mode == "BLUE") {
    LED_BLUE();
  } else if (Mode == "GREEN") {
    LED_GREEN();
  } else if (Mode == "WHITE") {
    LED_WHITE();
  } else if (Mode == "Special1") {
    LED_Special1();
  } else if (Mode == "Special2") {
    LED_Special2();
  } else if (Mode == "Special3") {
    LED_Special3();
  } else if (Mode == "Special4") {
    LED_Special4();
  }

  UpdateClock();
}

void LED_RED() {
  RgbColor C1(Brightness, 0, 0);
  for(int cell=0; cell < PixelCount; cell++) {
    strip.SetPixelColor(cell, C1);
  }
  strip.Show();
}

void LED_BLUE() {
  RgbColor C1(0, 0, Brightness);
  for(int cell=0; cell < PixelCount; cell++) {
    strip.SetPixelColor(cell, C1);
  }
  strip.Show();
}

void LED_GREEN() {
  RgbColor C1(0, Brightness, 0);
  for(int cell=0; cell < PixelCount; cell++) {
    strip.SetPixelColor(cell, C1);
  }
  strip.Show();
}

void LED_WHITE() {
  if (Brightness > 160) {
    Brightness = 160;
  }
  RgbColor C1(Brightness);
  for(int cell=0; cell < PixelCount; cell++) {
    strip.SetPixelColor(cell, C1);
  }
  strip.Show();
}

void LED_CLOCK() {
  if (PreviousHour != (hourFormat12() % 12)) {
    LED_Hour(); //update led hour + preH/M/S = H/M/S
  } else if (PreviousMin != minute()) {
    LED_Minute(); //update led min + preM/S = M/S
  } else {
    LED_Second(); //update led sec + preS = S
  }
}

void LED_Hour() {
  RgbColor C1(0, Brightness, 0);
  strip.SetPixelColor(5*PreviousHour, black);
  strip.SetPixelColor(5*(hourFormat12() % 12), C1);
  LED_Minute();
  LED_Second();
  //strip.Show();
}

void LED_Minute() {
  RgbColor C1(0, Brightness, 0);
  RgbColor C2(0, 0, Brightness);
  if (PreviousMin == 5*(hourFormat12() % 12)) {
    strip.SetPixelColor(PreviousMin, C1);
  } else {
    strip.SetPixelColor(PreviousMin, black);
  }
  strip.SetPixelColor(minute(), C2);
  LED_Second();
  //strip.Show();
}

void LED_Second() {
  RgbColor C1(0, Brightness, 0);
  RgbColor C2(0, 0, Brightness);
  RgbColor C3(Brightness, 0, 0);
  if (PreviousSecond == minute()) {
    strip.SetPixelColor(PreviousSecond, C2);
  } else if (PreviousSecond == 5*(hourFormat12() % 12)) {
    strip.SetPixelColor(PreviousSecond, C1);
  } else {
    strip.SetPixelColor(PreviousSecond, black);
  }
  strip.SetPixelColor(second(), C3);
  strip.Show();
}
