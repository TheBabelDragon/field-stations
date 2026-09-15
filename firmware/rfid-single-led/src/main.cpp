/* Boundary stub. Real drivers land when the board is wired.
 * Host Python codec is the source of truth for the optical frame.
 */

#include "../station/station.h"

static station_t station;

void setup() {
    station_init(&station, 0x0001);
    led_init(2);
    led_set_mode(LED_IDLE);
}

void loop() {
    rfid_read_t read;
    led_set_mode(LED_DISCOVERING);
    if (rfid_poll(&read) && read.valid) {
        led_set_mode(LED_OBSERVING);
        station_on_tag(&station, &read);
    }
}
