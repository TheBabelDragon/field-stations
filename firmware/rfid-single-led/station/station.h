#pragma once
#include <stdint.h>
#include <stdbool.h>
#include "../rfid/rfid.h"
#include "../optical_tx/optical_tx.h"
#include "../led_driver/led_driver.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint16_t station_id;
    uint16_t sequence;
    led_mode_t mode;
} station_t;

void station_init(station_t *st, uint16_t station_id);
bool station_on_tag(station_t *st, const rfid_read_t *read);

#ifdef __cplusplus
}
#endif
